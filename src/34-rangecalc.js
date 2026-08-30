"use strict";
(function (K) {
  // RAM range calculator: pick a memory chip and a target base address, get
  // an EXACT decoder synthesized from real parts and then proved correct by
  // driving the actual netlist (the same prober the memory map uses).
  //
  // Decode plan (all real-world idioms):
  //   level 1: shared '138 on A17-19, memory-cycle gated  -> one 128K window
  //   level 2: '138 inside that window on the next bits   -> chip-size window
  //            (A14-16 for 8K/16K, A15-16 for 32K, A16 for 64K)
  //   level 3: 8K chips burn one OR gate on A13 to pick the half-window
  //   >=128K chips skip the '138s: a NAND on the top bit(s) + cycle qualifier.
  // The synthesized select REPLACES whatever select wiring the chip had; all
  // other pins are only wired if still free.

  const pk = K.pinKey;
  const hex5 = (v) => v.toString(16).toUpperCase().padStart(5, "0");

  function removePinWires(doc, pinKey) {
    const n = doc.wires.length;
    doc.wires = doc.wires.filter(w => w.a !== pinKey && w.b !== pinKey);
    return n - doc.wires.length;
  }

  // K.synthRange(doc, comp, cpuComp, base) ->
  //   { ok, wires, notes, created, range: {start,end} | null }
  K.synthRange = function (doc, comp, cpuComp, base) {
    const A = K._acKit;
    const def = K.chips[comp.type];
    const ctx = A.makeCtx(doc, comp, cpuComp);
    const fail = (msg) => { ctx.note(msg); return { ok: false, wires: ctx.wires, notes: ctx.notes, created: ctx.created, range: null }; };
    if (!def || def.category !== "Memory") return fail("not a memory chip");
    const info = A.busInfo(ctx);
    if (!info) return { ok: false, wires: ctx.wires, notes: ctx.notes, created: ctx.created, range: null };

    const size = def.probe.size;
    const abits = Math.log2(size);
    const shift = info.is8086 ? 1 : 0;
    const span = size << shift;                     // system bytes the chip covers
    if (base % span) return fail(`base must be a multiple of the chip's ${span >= 1024 ? span / 1024 + "K" : span} span`);
    if (base + span > 0x100000) return fail("range runs past the 1MB address space");

    const csName = def.pinIndex["~CS1"] !== undefined ? "~CS1" : def.pinIndex["~CS"] !== undefined ? "~CS" : "~CE";
    const removed = removePinWires(doc, pk(comp, csName));
    if (removed) { ctx.refresh(); ctx.note("replaced the previous select wiring (" + removed + " wire" + (removed > 1 ? "s" : "") + ")"); }

    // Memory chips whose select derives from this decoder output — directly,
    // or through one gate (the 8K chips' half-window OR).
    const csOf = (c) => {
      const d = K.chips[c.type];
      return d.pinIndex["~CS1"] !== undefined ? "~CS1" : d.pinIndex["~CS"] !== undefined ? "~CS" : "~CE";
    };
    const laneOf = (c) => ctx.same(pk(c, "D0"), pk(cpuComp, "AD8")) ? 1 : 0;
    const selectConsumers = (subKey) => {
      const subNet = ctx.netOf(subKey);
      if (!subNet) return [];
      const out = [];
      for (const c of doc.components) {
        if (c === comp || K.chips[c.type].category !== "Memory") continue;
        const selNet = ctx.netOf(pk(c, csOf(c)));
        if (!selNet) continue;
        if (selNet === subNet) { out.push(c); continue; }
        const gateOut = selNet.pins.find(p => /^74LS(00|02|08|32)$/.test(p.comp.type) && p.pin.name.endsWith("Y"));
        if (gateOut) {
          const u = gateOut.pin.name[0];
          if (ctx.same(pk(gateOut.comp, u + "A"), subKey) || ctx.same(pk(gateOut.comp, u + "B"), subKey)) out.push(c);
        }
      }
      return out;
    };

    // ---- build the exact select --------------------------------------------
    const matchLow = abits + shift;                 // first system address bit to decode
    let sel;                                        // pinKey that goes to the chip select
    let lane = 0;                                   // 8086 byte lane, decided below
    if (matchLow >= 17) {
      if (info.is8086 && ctx.same(pk(comp, "D0"), pk(cpuComp, "AD8"))) lane = 1;
      // huge chip: qualify the memory cycle + up to one top bit with a NAND
      const qual = info.maxMode ? A.vccPin(ctx)
        : info.is8086 ? pk(cpuComp, "M/~IO")
        : A.inverted(ctx, info.ioM);
      if (matchLow >= 20) {
        sel = A.inverted(ctx, qual);                // whole space: select on any memory cycle
      } else {
        const terms = [];
        for (let b = matchLow; b <= 19; b++)
          terms.push((base >> b) & 1 ? pk(cpuComp, "A" + b) : A.inverted(ctx, pk(cpuComp, "A" + b)));
        if (terms.length > 1) return fail("decode wider than one NAND — split the range across smaller chips");
        const g = A.freeGate2(ctx, "74LS00");
        ctx.W(qual, g.a);
        ctx.W(terms[0], g.b);
        sel = g.y;
      }
    } else {
      const dec = A.memDecoder(ctx, info);
      const winKey = pk(dec, "Y" + ((base >> 17) & 7));
      // level 2: a '138 enabled by the window, on the bits below A17
      const lo2 = Math.max(matchLow, 14);           // its lowest input bit
      const inBits = [lo2, lo2 + 1, lo2 + 2].filter(b => b <= 16);
      let lvl2 = ctx.find(c => c.type === "74LS138" &&
        ctx.same(pk(c, "~G2A"), winKey) && ctx.same(pk(c, "A"), info.addrKey(lo2)));
      if (!lvl2) {
        lvl2 = ctx.add("74LS138");
        ctx.W(info.addrKey(lo2), pk(lvl2, "A"));
        ctx.W(inBits[1] !== undefined ? info.addrKey(inBits[1]) : A.gndPin(ctx), pk(lvl2, "B"));
        ctx.W(inBits[2] !== undefined ? info.addrKey(inBits[2]) : A.gndPin(ctx), pk(lvl2, "C"));
        ctx.W(A.vccPin(ctx), pk(lvl2, "G1"));
        ctx.W(winKey, pk(lvl2, "~G2A"));
        ctx.W(A.gndPin(ctx), pk(lvl2, "~G2B"));
        ctx.note(`added a second '138 on A${lo2}-${inBits[inBits.length - 1]} inside the ${hex5((base >> 17) << 17)}h window`);
      }
      const yIdx = (base >> lo2) & ((1 << inBits.length) - 1);
      const subKey = pk(lvl2, "Y" + yIdx);
      const consumers = selectConsumers(subKey);
      if (info.is8086) {
        // lane: from existing data wiring, else pair up with the resident chip
        if (ctx.same(pk(comp, "D0"), pk(cpuComp, "AD8"))) lane = 1;
        else if (!ctx.wired(pk(comp, "D0")) && consumers.some(c => laneOf(c) === 0)) {
          lane = 1;
          ctx.note("paired as the odd/high byte lane with " +
            (consumers.find(c => laneOf(c) === 0).props.ref || "the resident chip"));
        }
        const clash = consumers.find(c => laneOf(c) === lane);
        if (clash) return fail(`that window's ${lane ? "odd" : "even"} lane is already ${clash.props.ref || clash.type} — pick another base or rewire it first`);
      } else if (consumers.length) {
        return fail(`that window is already decoded to ${consumers[0].props.ref || consumers[0].type} — pick another base or rewire it first`);
      }
      if (matchLow < lo2) {
        // 8K chip: half-window picked by A13 through an OR gate
        const bitKey = info.addrKey(13);
        const term = (base >> 13) & 1 ? A.inverted(ctx, bitKey) : bitKey;
        const g = A.freeGate2(ctx, "74LS32");
        ctx.W(subKey, g.a);
        ctx.W(term, g.b);
        sel = g.y;
      } else {
        sel = subKey;
      }
    }
    A.wireMemoryBus(ctx, info, lane, abits, def.pinIndex["~WE"] !== undefined);
    ctx.W(sel, pk(comp, csName));
    if (csName === "~CS1") ctx.WifFree(A.vccPin(ctx), pk(comp, "CS2"));

    // ---- prove it against the netlist --------------------------------------
    const start = base, end = base + span - 1;
    let verified = false, partnered = true;
    const map = K.analyzeMemoryMap(doc);
    const entry = map.cpus.find(c => c.compId === cpuComp.id);
    const segs = entry ? entry.segments.filter(s => s.parts.some(p => p.compId === comp.id)) : [];
    if (info.is8086) {
      const selNet = ctx.netOf(pk(comp, csName));
      partnered = !!(selNet && selNet.pins.some(p => p.comp !== comp && K.chips[p.comp.type].category === "Memory"));
    }
    if (segs.length === 1 && !segs[0].alias && segs[0].start === start && segs[0].end === end) {
      verified = true;
      ctx.note(`${comp.props.ref || comp.type} responds at ${hex5(start)}h-${hex5(end)}h — proved on the netlist, exact, no mirrors`);
    } else if (info.is8086 && !partnered) {
      ctx.note(`wired for ${hex5(start)}h-${hex5(end)}h — the prober needs the other byte lane in place to certify it (add the partner chip)`);
    } else if (!segs.length) {
      ctx.note("synthesized, but the prober can't see the chip respond — check strobes and the chip's power-on wiring");
    } else {
      ctx.note("responds at: " + segs.map(s => `${hex5(s.start)}h-${hex5(s.end)}h${s.alias ? " (mirror)" : ""}`).join(", ") + " — expected exactly " + hex5(start) + "h-" + hex5(end) + "h");
    }
    return {
      ok: verified || (info.is8086 && !partnered),
      wires: ctx.wires, notes: ctx.notes, created: ctx.created,
      range: { start, end },
    };
  };
})(globalThis.K8086 ??= {});
