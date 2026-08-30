"use strict";
(function (K) {
  const { SIG } = K;

  // Memory-map analyzer: proves what the wired decode actually does.
  //
  // For each CPU on the board we build a throwaway probe simulation, take manual
  // control of that CPU's pins, and walk the address space chunk by chunk: present
  // the address exactly like a real T1 (ALE pulse so the '373s latch), then assert
  // a memory read like T2, settle the netlist, and observe every memory chip's
  // select/OE state and local address pins. Nothing is assumed about the glue —
  // whatever the student wired is what gets measured.
  //
  // 8086 boards are lane-aware: byte lanes D0-7 / D8-15 carry even/odd bytes into
  // separate banks, so two chips answering one address on different lanes is a
  // 16-bit bus, not a conflict. Each chip's lane is derived from which CPU AD
  // lines its data pins actually reach.
  //
  // Returns { cpus: [{ compId, ref, chunk, lanes, chunks, segments, conflicts }] }
  //   chunks[i][lane] = null | { comp, local, stride }   for address i*chunk + lane
  //   segments = merged regions: { start, end, alias, resetVector,
  //              parts: [{ compId, lane, cpuStart, localStart, size }] }
  K.analyzeMemoryMap = function (doc) {
    const cpus = doc.components.filter(c => K.chips[c.type].isCpu);
    const memComps = doc.components.filter(c => K.chips[c.type].probe);
    const out = { cpus: [] };
    if (!cpus.length || !memComps.length) return out;

    for (const cpuComp of cpus) {
      let sim;
      try { sim = new K.Sim(doc); } catch { continue; }
      const cpu = sim.chipFor(cpuComp.id);
      const io = sim.ios[cpu.ci];
      const is8086 = !!K.chips[cpuComp.type].is8086;
      const lanes = is8086 ? 2 : 1;
      cpu.state.resetting = false;   // wrapper must not overwrite our manual drives
      const AD = is8086 ? K.pinRange("AD", 0, 15) : K.pinRange("AD", 0, 7);
      const AHI = is8086 ? [] : K.pinRange("A", 8, 15);
      const ATOP = ["A16", "A17", "A18", "A19"];
      const conflicts = [];

      // which byte lane does each memory chip's data bus reach?
      const laneOf = new Map();
      for (const mc of memComps) {
        const net = sim.byPin.get(K.pinKey(mc, "D0"));
        let lane = 0;
        if (net && is8086) {
          for (const p of net.pins) {
            if (p.comp !== cpuComp) continue;
            const m = /^AD(\d+)$/.exec(p.pin.name);
            if (m) lane = +m[1] >= 8 ? 1 : 0;
          }
        }
        laneOf.set(mc.id, lane);
      }

      const chunkSize = Math.max(2048, Math.min(...memComps.map(c => K.chips[c.type].probe.size)) * lanes);

      const ctls = doc.components.filter(c => c.type === "8288").map(c => sim.chipFor(c.id));
      const poseCtls = (phase, cmd) => {
        for (const ctl of ctls) {
          ctl.state.phase = phase;
          ctl.state.cmd = cmd;
          ctl.state.ale = phase === 1 ? 1 : 0;
          sim.pendingChips.add(ctl.ci);
        }
      };
      const driveAddr = (addr) => {
        io.outBus(AD, addr & (is8086 ? 0xFFFF : 0xFF));
        if (!is8086) io.outBus(AHI, (addr >> 8) & 0xFF);
        io.outBus(ATOP, (addr >> 16) & 0xF);
        if (is8086) io.out("~BHE", (addr & 1) ? 0 : 1);
      };
      // probe one byte address; returns hits on the matching lane only
      const probe = (addr) => {
        io.out(is8086 ? "M/~IO" : "IO/~M", is8086 ? 1 : 0);
        io.out("~RD", 1); io.out("~WR", 1); io.out("~DEN", 1); io.out("DT/~R", 0);
        io.out("ALE", 1);
        poseCtls(1, 5);
        driveAddr(addr);
        sim.settle();
        io.out("ALE", 0);
        poseCtls(2, 5);
        sim.settle();
        io.zBus(AD);
        io.out("~RD", 0); io.out("~DEN", 0);
        sim.settle();
        sim.halted = null;
        const wantLane = is8086 ? (addr & 1) : 0;
        const hits = [];
        for (const mc of memComps) {
          if (laneOf.get(mc.id) !== wantLane) continue;
          const chip = sim.chipFor(mc.id);
          const mio = sim.ios[chip.ci];
          const pr = chip.def.probe;
          if (pr.selected(mio) && mio.in(pr.readPin || "~OE") === SIG.L)
            hits.push({ comp: mc, local: mio.num(pr.addrPins) & (pr.size - 1) });
        }
        io.out("~RD", 1); io.out("~DEN", 1);
        poseCtls(0, 7);
        sim.settle();
        sim.halted = null;
        return hits;
      };

      const nChunks = Math.ceil(0x100000 / chunkSize);
      const chunks = new Array(nChunks).fill(null);
      for (let i = 0; i < nChunks; i++) {
        const base = i * chunkSize;
        const perLane = [];
        let ok = true;
        for (let lane = 0; lane < lanes; lane++) {
          const a0 = base + lane;
          const hits = probe(a0);
          if (hits.length > 1) {
            conflicts.push({ addr: a0, chips: hits.map(x => x.comp.props.ref || x.comp.id) });
            ok = false;
            break;
          }
          if (hits.length !== 1) { ok = false; break; }
          const h = hits[0];
          // verify linear wiring across the chunk on this lane
          const aEnd = base + chunkSize - lanes + lane;
          const endHits = probe(aEnd);
          const eh = endHits.length === 1 ? endHits[0] : null;
          const size = K.chips[h.comp.type].probe.size;
          const span = (aEnd - a0) / lanes;
          if (!eh || eh.comp !== h.comp || eh.local !== ((h.local + span) & (size - 1))) { ok = false; break; }
          perLane.push({ comp: h.comp, local: h.local, stride: lanes });
        }
        if (ok && perLane.length === lanes) chunks[i] = perLane;
      }

      // merge chunks into segments; first occurrence of a mapping pattern is
      // primary, repeats are aliases (partial decode)
      const seen = new Set();
      const segments = [];
      let cur = null;
      for (let i = 0; i < nChunks; i++) {
        const c = chunks[i];
        const base = i * chunkSize;
        if (!c) { cur = null; continue; }
        const key = c.map(l => l.comp.id + ":" + l.local).join("|");
        const alias = seen.has(key);
        if (!alias) seen.add(key);
        const contiguous = cur && cur.end + 1 === base && cur.alias === alias;
        // does this chunk continue the previous parts linearly?
        let continues = false;
        if (contiguous) {
          continues = c.every((l, lane) => {
            const part = cur.parts.findLast(p => p.lane === lane);
            const size = K.chips[l.comp.type].probe.size;
            const expected = (part.localStart + (base - part.cpuStart) / lanes) & (size - 1);
            return part.compId === l.comp.id && l.local === expected && (base - part.cpuStart) / lanes < size;
          });
        }
        if (continues) {
          for (const p of cur.parts) p.size += chunkSize / lanes;
          cur.end = base + chunkSize - 1;
        } else if (contiguous) {
          for (let lane = 0; lane < lanes; lane++)
            cur.parts.push({ compId: c[lane].comp.id, lane, cpuStart: base, localStart: c[lane].local, size: chunkSize / lanes });
          cur.end = base + chunkSize - 1;
        } else {
          cur = {
            start: base, end: base + chunkSize - 1, alias,
            parts: c.map((l, lane) => ({ compId: l.comp.id, lane, cpuStart: base, localStart: l.local, size: chunkSize / lanes })),
          };
          segments.push(cur);
        }
      }
      for (const s of segments) s.resetVector = s.start <= 0xFFFF0 && 0xFFFF0 <= s.end;

      out.cpus.push({ compId: cpuComp.id, ref: cpuComp.props.ref || cpuComp.id, chunk: chunkSize, lanes, chunks, segments, conflicts });
    }
    return out;
  };

  // Resolve a CPU-space address through an analyzed map -> {compId, local} | null
  K.memMapResolve = function (cpuMap, addr) {
    addr &= 0xFFFFF;
    const c = cpuMap.chunks[Math.floor(addr / cpuMap.chunk)];
    if (!c) return null;
    const lanes = cpuMap.lanes || 1;
    const lane = lanes === 2 ? (addr & 1) : 0;
    const l = c[lane];
    if (!l) return null;
    const size = K.chips[l.comp.type].probe.size;
    const ofs = Math.floor((addr % cpuMap.chunk) / lanes);
    return { compId: l.comp.id, local: (l.local + ofs) & (size - 1) };
  };
})(globalThis.K8086 ??= {});
