"use strict";
(function (K) {
  const { SIG, DRV } = K;
  const MAX_SETTLE = 200, MAX_EDGE_ROUNDS = 16;

  // Tier A engine: full pin-level netlist evaluation.
  // Timebase: sim.hz ticks/second = 2x the fastest clock chip (half-cycle resolution).
  K.Sim = class Sim {
    constructor(doc, opts = {}) {
      this.doc = doc;
      this.opts = opts;
      const { nets, byPin } = K.extractNets(doc);
      this.nets = nets;
      this.byPin = byPin;
      this.netVal = new Uint8Array(nets.length);
      this.t = 0;                 // half-cycle counter
      this.halted = null;         // {reason, detail} on runtime strict violation / HLT-with-no-INTR
      this.inputLog = [];
      this.captureEnabled = true; // waveform ring capture (off in turbo)
      this.fastMode = false;      // Tier B: memory bus cycles bypass the netlist
      this.memMap = null;         // set via setMemMap() to enable the fast path
      this.dbg = null;            // debugger state (K.Debug), installed by the app
      this.dbgStop = false;       // a breakpoint/watchpoint asked the run loops to stop
      this._fastChips = new Map();

      // Instantiate chips.
      this.chips = doc.components.map((comp, ci) => {
        const def = K.chips[comp.type];
        const chip = {
          ci, comp, def,
          state: {},          // serializable — snapshots clone this
          runtime: {},        // NOT serialized (e.g. live CPU core); rebuilt via onRestore
          drives: new Uint8Array(def.pins.length),
          pinNet: new Int32Array(def.pins.length).fill(-1),
          edgePrev: {},
          tickAcc: 0,
        };
        def.pins.forEach((pin, pi) => {
          const net = byPin.get(K.pinKey(comp, pin.name));
          if (net) chip.pinNet[pi] = net.id;
        });
        return chip;
      });

      // net -> driver/reader chip indices for dirty propagation.
      this.netDrivers = nets.map(() => []);
      this.netReaders = nets.map(() => []);
      for (const chip of this.chips) {
        chip.def.pins.forEach((pin, pi) => {
          const n = chip.pinNet[pi];
          if (n < 0) return;
          if (["out", "ts", "oc", "io", "pwr", "gnd"].includes(pin.kind)) this.netDrivers[n].push([chip.ci, pi]);
          if (["in", "io"].includes(pin.kind)) this.netReaders[n].push(chip.ci);
        });
      }

      this.dirtyNets = new Set(nets.map(n => n.id));
      this._contended = new Set();
      this.postSettleChips = this.chips.filter(c => c.def.postSettle);
      this.pendingChips = new Set(this.chips.map(c => c.ci));
      // flat edge-dispatch table: avoids per-half-cycle name lookups.
      // CPUs are dispatched (and settled) before everything else so that bus
      // controllers/peripherals sample the CPU's freshly-driven status lines on
      // the same clock edge — like real parts tracking the CPU's output delay.
      this.edgeList = [];
      for (const chip of this.chips)
        for (const pinName of chip.def.edgePins) {
          const n = chip.pinNet[chip.def.pinIndex[pinName]];
          if (n >= 0) this.edgeList.push({ chip, pinName, net: n, prev: -1, cpu: !!chip.def.isCpu });
        }
      this.edgeList.sort((a, b) => (b.cpu ? 1 : 0) - (a.cpu ? 1 : 0));
      this.edgeCpuCount = this.edgeList.filter(e => e.cpu).length;
      // net-subscription dispatch: an edge entry is only visited when its net
      // actually toggles (settle marks toggles) — the old full scan of every
      // entry per half-cycle was the single biggest cost in turbo.
      for (const e of this.edgeList) e.mark = 0;
      this.netEdgeSubs = nets.map(() => []);
      for (const e of this.edgeList) this.netEdgeSubs[e.net].push(e);
      this._toggledNets = new Set();
      this._markGen = 0;
      // seed: first dispatch visits every entry once (initializes e.prev
      // without firing — identical to the old first full scan)
      for (const e of this.edgeList) this._toggledNets.add(e.net);
      this.ios = this.chips.map(chip => this._makeIo(chip));
      this.tickers = this.chips.filter(c => c.def.tickHz);
      this.hz = Math.max(1, ...this.tickers.map(c => c.def.tickHz(c.comp)));

      // Waveform ring buffer: 2-bit values stored as bytes, one lane per net.
      // Target 2^18 half-steps (131k cycles of history); shrink on huge boards
      // to keep the buffer under ~48MB, never below the old 2^16.
      if (opts.ringSize) this.ringSize = opts.ringSize;
      else {
        let size = 1 << 18;
        while (size > (1 << 16) && nets.length * size > 48 * (1 << 20)) size >>= 1;
        this.ringSize = size;
      }
      this.trace = new Uint8Array(nets.length * this.ringSize);
      this.traceStart = 0;        // t of oldest valid sample

      for (const chip of this.chips) chip.def.init?.(chip.state, chip.comp.props, chip);
      this.settle();
      this._captureSample();
    }

    _makeIo(chip) {
      const sim = this, idx = chip.def.pinIndex;
      const pi = (name) => { const i = idx[name]; K.assert(i !== undefined, chip.def.type + ": no pin " + name); return i; };
      const set = (i, d) => {
        if (chip.drives[i] !== d) {
          chip.drives[i] = d;
          const n = chip.pinNet[i];
          if (n >= 0) sim.dirtyNets.add(n);
        }
      };
      return {
        chip,
        sim,
        raw: (name) => { const n = chip.pinNet[pi(name)]; return n < 0 ? SIG.Z : sim.netVal[n]; },
        in: (name) => { const n = chip.pinNet[pi(name)]; return K.ttlRead(n < 0 ? SIG.Z : sim.netVal[n]); },
        num(names) { let v = 0; for (let b = names.length - 1; b >= 0; b--) v = (v << 1) | (this.in(names[b]) === SIG.H ? 1 : 0); return v; },
        out: (name, bit) => set(pi(name), bit ? DRV.D1 : DRV.D0),
        oc: (name, bit) => set(pi(name), bit ? DRV.NONE : DRV.D0),
        w1: (name) => set(pi(name), DRV.W1),
        z: (name) => set(pi(name), DRV.NONE),
        outBus(names, value) { for (let b = 0; b < names.length; b++) this.out(names[b], (value >> b) & 1); },
        zBus(names) { for (const n of names) this.z(n); },
        halt: (reason, detail) => { sim.halted = { reason, detail }; },
      };
    }

    _recomputeNet(n) {
      const drivers = this.netDrivers[n];
      let s0 = false, s1 = false, w0 = false, w1 = false;
      for (const [ci, pi] of drivers) {
        const d = this.chips[ci].drives[pi];
        if (d === DRV.D0) s0 = true;
        else if (d === DRV.D1) s1 = true;
        else if (d === DRV.W1) w1 = true;
        else if (d === DRV.W0) w0 = true;
      }
      if (s0 && s1) {
        // possibly just a propagation glitch mid-settle — flag it and decide
        // after the netlist converges (real logic glitches for nanoseconds too)
        this._contended.add(n);
        return SIG.X;
      }
      return s0 ? SIG.L : s1 ? SIG.H : (w0 && w1) ? SIG.X : w1 ? SIG.H : w0 ? SIG.L : SIG.Z;
    }

    settle() {
      this._contended.clear();
      for (let iter = 0; iter < MAX_SETTLE; iter++) {
        // Propagate dirty nets to reader chips.
        if (this.dirtyNets.size) {
          for (const n of this.dirtyNets) {
            const v = this._recomputeNet(n);
            if (v !== this.netVal[n]) {
              this.netVal[n] = v;
              for (const ci of this.netReaders[n]) this.pendingChips.add(ci);
              if (this.netEdgeSubs[n].length) this._toggledNets.add(n);
            }
          }
          this.dirtyNets.clear();
        }
        if (!this.pendingChips.size) return this._afterSettle();
        const batch = [...this.pendingChips];
        this.pendingChips.clear();
        for (const ci of batch) {
          const chip = this.chips[ci];
          chip.def.evaluate?.(this.ios[ci], chip.state, chip.comp.props, chip);
        }
        if (!this.dirtyNets.size && !this.pendingChips.size) return this._afterSettle();
      }
      this.halted = { reason: "oscillation", detail: "combinational loop did not settle" };
    }

    _afterSettle() {
      this._checkContention();
      if (this.halted) return;
      // level-sensitive commits (e.g. SRAM writes) act on SETTLED values only:
      // combinational glitches inside the settle are shorter than any real
      // part's minimum pulse width and must not change state.
      for (const chip of this.postSettleChips)
        chip.def.postSettle(this.ios[chip.ci], chip.state, chip.comp.props, chip);
    }

    // After the netlist converges: any net STILL fought over is a real short.
    _checkContention() {
      if (!this._contended.size) return;
      for (const n of this._contended) {
        let s0 = false, s1 = false;
        for (const [ci, pi] of this.netDrivers[n]) {
          const d = this.chips[ci].drives[pi];
          if (d === DRV.D0) s0 = true;
          else if (d === DRV.D1) s1 = true;
        }
        if (s0 && s1) {
          this.halted = { reason: "contention", detail: this.nets[n].name, net: n };
          return;
        }
      }
      this._contended.clear();
    }

    _dispatchEdges() {
      const nv = this.netVal;
      for (let round = 0; round < MAX_EDGE_ROUNDS; round++) {
        if (!this._toggledNets.size) return;
        const gen = ++this._markGen;
        const cpuA = [], periA = [];
        // partition subscribed entries of toggled nets; CPU entries toggled
        // later in the round wait for the next round (old slice semantics)
        for (const n of this._toggledNets) {
          for (const e of this.netEdgeSubs[n]) {
            if (e.mark === gen) continue;
            e.mark = gen;
            (e.cpu ? cpuA : periA).push(e);
          }
        }
        this._toggledNets.clear();
        let fired = false;
        const visit = (arr) => {
          for (const e of arr) {
            let v = nv[e.net];
            if (v === SIG.Z) v = SIG.H;       // TTL float reads high
            if (v === e.prev) continue;
            const prev = e.prev;
            e.prev = v;
            if (prev !== -1 && (v === SIG.H || v === SIG.L)) {
              const chip = e.chip;
              chip.def.onEdge(e.pinName, v === SIG.H, this.ios[chip.ci], chip.state, chip.comp.props, chip);
              this.pendingChips.add(chip.ci); // state may have changed -> re-derive outputs
              if (this._edgeLog) this._edgeLog.push({ ci: chip.ci, pin: e.pinName, rising: v === SIG.H });
              fired = true;
            }
          }
        };
        visit(cpuA);                          // CPUs first...
        if (fired) { this.settle(); if (this.halted) return; }
        // ...then peripherals, including any whose nets the CPU settle just
        // toggled (carry nets with unvisited CPU subscribers to next round)
        for (const n of this._toggledNets) {
          for (const e of this.netEdgeSubs[n]) {
            if (e.cpu || e.mark === gen) continue;
            e.mark = gen;
            periA.push(e);
          }
        }
        for (const n of [...this._toggledNets])
          if (!this.netEdgeSubs[n].some(e => e.cpu && e.mark !== gen)) this._toggledNets.delete(n);
        fired = false;
        visit(periA);
        if (fired) { this.settle(); if (this.halted) return; }
      }
    }

    _captureSample() {
      if (!this.captureEnabled) return;
      const slot = this.t % this.ringSize;
      const base = slot * this.nets.length;
      this.trace.set(this.netVal, base);
      if (this.t - this.traceStart >= this.ringSize) this.traceStart = this.t - this.ringSize + 1;
    }

    setCapture(on) {
      this.captureEnabled = on;
      if (on) this.traceStart = this.t;   // history before re-enable is invalid
    }

    // ---- Tier B fast path: memory access through the proved map ------------
    setMemMap(map) { this.memMap = map; this._fastChips.clear(); }
    _fastChip(compId) {
      let c = this._fastChips.get(compId);
      if (c === undefined) { c = this.chipFor(compId) || null; this._fastChips.set(compId, c); }
      return c;
    }
    fastRead(cpuCompId, addr) {
      const m = this.memMap && this.memMap.cpus.find(c => c.compId === cpuCompId);
      if (!m) return 0xFF;
      const r = K.memMapResolve(m, addr & 0xFFFFF);
      if (!r) return 0xFF;                 // unmapped: floating bus reads high
      const chip = this._fastChip(r.compId);
      return chip && chip.state.mem ? chip.state.mem[r.local] : 0xFF;
    }
    fastWrite(cpuCompId, addr, val) {
      const m = this.memMap && this.memMap.cpus.find(c => c.compId === cpuCompId);
      if (!m) return;
      const r = K.memMapResolve(m, addr & 0xFFFFF);
      if (!r) return;
      const chip = this._fastChip(r.compId);
      if (chip && chip.state.mem && chip.def.probe && chip.def.probe.writable)
        chip.state.mem[r.local] = val & 0xFF;
    }

    // One half-cycle of the fastest clock.
    stepHalf() {
      if (this.halted) return;
      this.t++;
      for (const chip of this.tickers) {
        chip.tickAcc += chip.def.tickHz(chip.comp) / this.hz;
        while (chip.tickAcc >= 0.999999) {
          chip.tickAcc -= 1;
          chip.def.tick(this.ios[chip.ci], chip.state, chip.comp.props, chip);
        }
      }
      this.settle();
      if (!this.halted) this._dispatchEdges();
      this._captureSample();
    }

    stepCycle() { this.stepHalf(); this.stepHalf(); }

    // Run until any CPU retires an instruction (or maxHalf half-cycles pass).
    stepInstruction(maxHalf = 4000) {
      const cpus = this.chips.filter(c => c.def.isCpu);
      for (const c of cpus) c.runtime.retired = false;
      for (let i = 0; i < maxHalf && !this.halted; i++) {
        this.stepHalf();
        if (cpus.some(c => c.runtime.retired)) return true;
      }
      return false;
    }

    run(halfCycles) {
      if (this.dbgStop) return;               // a debugger stop is pending: stay put
      if (this.fastMode && !this.captureEnabled) return this._runFast(halfCycles);
      for (let i = 0; i < halfCycles && !this.halted && !this.dbgStop; i++) this.stepHalf();
    }

    // ---- Tier B+ compiled clock tree ---------------------------------------
    // In turbo the only per-half netlist activity on a quiet board is the
    // clock chain (8284 -> CLK/PCLK -> dividers). We identify that periodic
    // subgraph, RECORD one period of it generically (net values + the edges
    // it delivers to consumer chips), verify the pattern repeats exactly,
    // then REPLAY it: a few array writes and direct onEdge calls per half.
    // Everything non-periodic (IO cycles, PIT outputs, interrupts, keyboard)
    // still flows through the normal settle/dispatch machinery, which the
    // replay invokes only when something actually became dirty.
    _invalidateSchedule() {
      if (!this._sched) return;
      this._sched = null;
      // resync edge bookkeeping with reality: one non-firing visit for all
      for (const e of this.edgeList) {
        let v = this.netVal[e.net];
        e.prev = v === SIG.Z ? SIG.H : v;
      }
      this._toggledNets.clear();
    }
    _classifyClockTree() {
      // quasi-static sources: rails, pulls, and human inputs (buttons and
      // switches only change through applyInput, which drops the schedule)
      const PASSIVE = ["VCC", "GND", "PULLUP", "NETLABEL", "XTAL", "BTN", "SW8"];
      const constNet = this.nets.map(net =>
        net.pins.every(p => PASSIVE.includes(p.comp.type) ||
                            !["out", "ts", "oc", "io", "pwr", "gnd"].includes(p.pin.kind)));
      const clockChip = new Array(this.chips.length).fill(false);
      const clockNet = new Array(this.nets.length).fill(false);
      let changed = true;
      while (changed) {
        changed = false;
        for (const chip of this.chips) {
          if (clockChip[chip.ci] || chip.def.isCpu) continue;
          const own = new Set();
          chip.def.pins.forEach((p, pi) => { const n = chip.pinNet[pi]; if (n >= 0) own.add(n); });
          // qualifies if driven by time alone (a ticker) or purely by clock nets
          const inputsOk = chip.def.pins.every((p, pi) => {
            if (!["in", "io"].includes(p.kind)) return true;
            const n = chip.pinNet[pi];
            if (n < 0 || constNet[n] || clockNet[n]) return true;
            // self-feedback (divider wiring) is fine
            return this.nets[n].pins.every(q => q.comp === chip.comp || PASSIVE.includes(q.comp.type));
          });
          if (!(chip.def.tickHz ? inputsOk : (inputsOk && chip.def.edgePins && chip.def.edgePins.length))) continue;
          clockChip[chip.ci] = true;
          changed = true;
          // its exclusively-driven nets become clock nets
          chip.def.pins.forEach((p, pi) => {
            const n = chip.pinNet[pi];
            if (n < 0 || !["out", "ts", "oc", "io"].includes(p.kind)) return;
            // clock net only if this chip is its sole strong driver
            const soleDriver = this.nets[n].pins
              .filter(z => ["out", "ts", "oc", "io"].includes(z.pin.kind) && !PASSIVE.includes(z.comp.type))
              .every(z => z.comp === chip.comp);
            if (soleDriver && !clockNet[n]) { clockNet[n] = true; changed = true; }
          });
        }
      }
      return { clockChip, clockNet };
    }
    _clockChipState(idx) {
      return JSON.stringify(idx.map(ci => this.chips[ci].state));
    }
    _buildSchedule() {
      const { clockChip, clockNet } = this._classifyClockTree();
      const chipIdx = [];
      clockChip.forEach((v, ci) => { if (v) chipIdx.push(ci); });
      const netIdx = [];
      clockNet.forEach((v, n) => { if (v) netIdx.push(n); });
      if (!chipIdx.length || !netIdx.length) return null;
      if (!chipIdx.some(ci => this.chips[ci].def.tickHz)) return null;
      // inputs of clock chips that could invalidate the pattern if they move
      const guard = new Set();
      for (const ci of chipIdx) {
        const chip = this.chips[ci];
        chip.def.pins.forEach((p, pi) => {
          const n = chip.pinNet[pi];
          if (n >= 0 && !clockNet[n] && ["in", "io"].includes(p.kind)) guard.add(n);
        });
      }
      const P = 16;                        // covers 8284 pclkDiv wrap + /2 dividers
      // phase-align to t ≡ 0 (mod P): tickers at full rate are t-locked
      while (this.t % P) { this.stepHalf(); if (this.halted) return null; }
      const state0 = this._clockChipState(chipIdx);
      const rec = [];                      // per half: { vals: Uint8Array, edges: [...] , states: [...] }
      for (let period = 0; period < 2; period++) {
        for (let k = 0; k < P; k++) {
          this._edgeLog = [];
          this.stepHalf();
          if (this.halted) { this._edgeLog = null; return null; }
          const edges = this._edgeLog.filter(ev => !clockChip[ev.ci]);
          // any edge to a clock chip other than by clock nets, or non-clock
          // machinery firing during recording, makes this board non-quiet
          rec.push({
            vals: Uint8Array.from(netIdx.map(n => this.netVal[n])),
            edges,
            states: chipIdx.map(ci => K.clone(this.chips[ci].state)),
          });
        }
        if (period === 0 && this._clockChipState(chipIdx) !== state0) { this._edgeLog = null; return null; }
      }
      this._edgeLog = null;
      // verify exact repetition of the two periods
      for (let k = 0; k < P; k++) {
        const a = rec[k], b = rec[k + P];
        if (a.vals.length !== b.vals.length || !a.vals.every((v, i) => v === b.vals[i])) return null;
        if (a.edges.length !== b.edges.length ||
            !a.edges.every((e, i) => e.ci === b.edges[i].ci && e.pin === b.edges[i].pin && e.rising === b.edges[i].rising))
          return null;
      }
      if (this._clockChipState(chipIdx) !== state0) return null;
      // rec[k] describes the half-cycle with t %% P == (k+1) %% P — rotate so
      // slots[m] is exactly the entry for t %% P == m
      const slots = new Array(P);
      for (let k = 0; k < P; k++) slots[(k + 1) % P] = rec[k];
      // compile each slot: only the nets that CHANGE from the previous slot,
      // and edge deliveries grouped per chip (one projection per chip)
      for (let k = 0; k < P; k++) {
        const prev = slots[(k + P - 1) % P], cur = slots[k];
        const dIdx = [], dVal = [];
        for (let j = 0; j < netIdx.length; j++)
          if (cur.vals[j] !== prev.vals[j]) { dIdx.push(netIdx[j]); dVal.push(cur.vals[j]); }
        cur.dIdx = dIdx; cur.dVal = dVal;
        const calls = [];
        for (const ev of cur.edges) {
          let c = calls.length && calls[calls.length - 1].ci === ev.ci ? calls[calls.length - 1] : null;
          if (!c) {
            const def = this.chips[ev.ci].def;
            c = { ci: ev.ci, events: [], project: !def.isCpu && !!def.evaluate, cpu: !!def.isCpu };
            calls.push(c);
          }
          c.events.push(ev);
        }
        // a parked CPU's falling edge is a no-op — skippable at run time
        for (const c of calls) c.cpuFall = c.cpu && c.events.every(ev => !ev.rising);
        cur.calls = calls;
      }
      // EU batching segments: maximal runs of slots that touch ONLY the CPU
      // (rising ticks + skippable fallings). Inside a run nothing else can
      // execute, so INTR/RESET are read once and the core ticks back-to-back.
      const cpuCis = new Set();
      for (const sl of slots) for (const c of sl.calls) if (c.cpu) cpuCis.add(c.ci);
      const segAt = new Array(P).fill(null);
      if (cpuCis.size === 1) {
        const cpuCi = [...cpuCis][0];
        const cpuOnly = (sl) => sl.calls.every(c => c.ci === cpuCi);
        for (let start = 0; start < P; start++) {
          let len = 0, ticks = [];
          while (len < P) {
            const sl = slots[(start + 1 + len) % P];      // slot for half t+1+len
            if (!cpuOnly(sl)) break;
            for (const c of sl.calls) if (!c.cpuFall) ticks.push(len);
            len++;
          }
          if (len >= 2 && ticks.length) segAt[start] = { len, ticks, cpuCi };
        }
      }
      return { P, netIdx, chipIdx, guard, slots, segAt };
    }
    _runFast(halfCycles) {
      let budget = halfCycles;
      if (this._schedFailed && this.t >= this._schedFailed) this._schedFailed = 0;
      if (!this._sched && !this._schedFailed) {
        const before = this.t;
        this._sched = this._buildSchedule();
        if (!this._sched) this._schedFailed = this.t + 4096;   // retry soon (IO noise passes)
        budget -= this.t - before;
      }
      let s = this._sched;
      if (!s) {
        // step generically, but re-attempt compilation at each retry point
        while (budget > 0 && !this.halted && !this.dbgStop) {
          const chunk = Math.min(budget, Math.max(64, (this._schedFailed || this.t) - this.t));
          for (let i = 0; i < chunk && !this.halted && !this.dbgStop; i++) this.stepHalf();
          budget -= chunk;
          if (this._schedFailed && this.t >= this._schedFailed) {
            this._schedFailed = 0;
            const before = this.t;
            this._sched = this._buildSchedule();
            budget -= this.t - before;
            if (!this._sched) this._schedFailed = this.t + 4096;
            else break;
          }
        }
        s = this._sched;
        if (!s || budget <= 0 || this.halted) return;
      }
      const { P, netIdx, slots, guard, chipIdx } = s;
      const otherTickers = this.tickers.filter(c => !chipIdx.includes(c.ci));
      const rates = otherTickers.map(c => c.def.tickHz(c.comp) / this.hz);
      // ticker decimation: accumulate in bulk, fire only when due
      let tickerAt = this.t;
      const flushTickers = () => {
        const dt = this.t - tickerAt;
        tickerAt = this.t;
        for (let x = 0; x < otherTickers.length; x++) {
          const chip = otherTickers[x];
          chip.tickAcc += rates[x] * dt;
          while (chip.tickAcc >= 0.999999) {
            chip.tickAcc -= 1;
            chip.def.tick(this.ios[chip.ci], chip.state, chip.comp.props, chip);
          }
        }
      };
      const tickerGap = () => {
        let g = 1 << 20;
        for (let x = 0; x < otherTickers.length; x++)
          g = Math.min(g, Math.ceil((0.999999 - otherTickers[x].tickAcc) / rates[x]));
        return Math.max(1, g);
      };
      let tickerIn = otherTickers.length ? tickerGap() : (1 << 30);
      const nv = this.netVal;
      const pMask = (P & (P - 1)) === 0 ? P - 1 : 0;
      const dirty = this.dirtyNets, pend = this.pendingChips, chips = this.chips, ios = this.ios;
      const segAt = s.segAt || [];
      for (let i = 0; i < budget && !this.halted && !this.dbgStop; i++) {
        // ---- EU batching: consume a whole cpu-only segment at once --------
        const seg = segAt[pMask ? (this.t & pMask) : (this.t % P)];
        if (seg && budget - i >= seg.len && tickerIn > seg.len && !dirty.size && !pend.size) {
          const chip = chips[seg.cpuCi];
          if (chip.runtime.parked && chip.def.fastBurst) {
            const consumed = chip.def.fastBurst(ios[seg.cpuCi], chip.state, chip.comp.props, chip, seg);
            if (consumed > 0) {
              // sync time and the clock nets to wherever the burst stopped
              this.t += consumed;
              tickerIn -= consumed;
              i += consumed - 1;
              const vals = slots[pMask ? (this.t & pMask) : (this.t % P)].vals;
              for (let j = 0; j < netIdx.length; j++) nv[netIdx[j]] = vals[j];
              if (this.halted) break;
              // an abort into an IO cycle drove real pins (ALE + address):
              // they must settle NOW, within this half, or the address latch
              // never sees ALE high
              if (dirty.size || pend.size) {
                this.settle();
                if (this.halted) break;
                if (this._toggledNets.size) this._dispatchEdges();
                if (this.halted) break;
              }
              continue;
            }
          }
        }
        this.t++;
        const slot = slots[pMask ? (this.t & pMask) : (this.t % P)];
        const dIdx = slot.dIdx, dVal = slot.dVal;
        for (let j = 0; j < dIdx.length; j++) nv[dIdx[j]] = dVal[j];
        for (const call of slot.calls) {
          const chip = chips[call.ci];
          if (call.cpuFall && chip.runtime.parked) { chip.runtime.atBoundary = false; continue; }
          // deliver the edges and project outputs once per chip (what settle's
          // pendingChips pass would do) — the settle machinery only runs if
          // this actually changed a net
          const io = ios[call.ci];
          for (const ev of call.events)
            chip.def.onEdge(ev.pin, ev.rising, io, chip.state, chip.comp.props, chip);
          if (call.project) chip.def.evaluate(io, chip.state, chip.comp.props, chip);
        }
        if (--tickerIn <= 0) {
          flushTickers();
          tickerIn = tickerGap();
        }
        if (dirty.size || pend.size) {
          this.settle();
          if (this.halted) break;
          if (this._toggledNets.size) {
            // guard: if anything drove into a clock chip's input, the pattern
            // is no longer trustworthy — resync and fall back to generic
            let tripped = false;
            for (const n of this._toggledNets) if (guard.has(n)) { tripped = true; break; }
            this._dispatchEdges();
            if (this.halted) break;
            if (tripped) {
              // restore this offset's clock-chip states, then bail
              flushTickers();
              const k = this.t % P;
              chipIdx.forEach((ci, x) => { this.chips[ci].state = K.clone(slots[k].states[x]); });
              this._invalidateSchedule();
              this._schedFailed = this.t + 4096;
              for (; i < budget - 1 && !this.halted; i++) this.stepHalf();
              return;
            }
          }
        }
      }
      // leaving fast mode mid-pattern: make the generic machinery consistent
      if (this._sched) {
        flushTickers();
        const k = this.t % P;
        chipIdx.forEach((ci, x) => {
          Object.assign(this.chips[ci].state, K.clone(slots[k].states[x]));
        });
        for (const e of this.edgeList) {
          let v = nv[e.net];
          e.prev = v === SIG.Z ? SIG.H : v;
        }
      }
    }

    // --- probing -------------------------------------------------------------
    netValue(netId) { return this.netVal[netId]; }
    probe(pinKey) { const net = this.byPin.get(pinKey); return net ? this.netVal[net.id] : SIG.Z; }
    traceAt(netId, t) {
      if (t < this.traceStart || t > this.t) return SIG.Z;
      return this.trace[(t % this.ringSize) * this.nets.length + netId];
    }
    chipFor(compId) { return this.chips.find(c => c.comp.id === compId); }

    // --- inputs & determinism ------------------------------------------------
    applyInput(compId, patch) {
      this.inputLog.push({ t: this.t, compId, patch: K.clone(patch) });
      this._invalidateSchedule();
      this._applyPatch(compId, patch);
    }
    _applyPatch(compId, patch) {
      const chip = this.chipFor(compId);
      if (!chip) return;
      // Chips with an onInput hook consume events (e.g. keyboard scancodes into a
      // queue); everything else treats the patch as a props update. Both flow
      // through the input log, so rewind/replay reproduces them deterministically.
      if (chip.def.onInput) chip.def.onInput(chip.state, patch, chip.comp.props, chip);
      else Object.assign(chip.comp.props, patch);
      this.pendingChips.add(chip.ci);
      this.settle();
      this._captureSample();
    }

    // Step forward to an absolute half-cycle t, re-applying logged inputs on the way.
    replayTo(target) {
      const pending = this.inputLog.filter(e => e.t > this.t && e.t <= target).sort((a, b) => a.t - b.t);
      let pi = 0;
      while (this.t < target && !this.halted) {
        this.stepHalf();
        while (pi < pending.length && pending[pi].t === this.t) {
          this._applyPatch(pending[pi].compId, pending[pi].patch);
          pi++;
        }
      }
    }

    serialize() {
      return {
        t: this.t,
        netVal: this.netVal.slice(),
        edgePrev: this.edgeList.map(e => e.prev),
        chips: this.chips.map(c => ({ state: K.clone(c.state), drives: c.drives.slice(), tickAcc: c.tickAcc, props: K.clone(c.comp.props) })),
        halted: K.clone(this.halted),
      };
    }
    restore(snap) {
      this.t = snap.t;
      this.netVal.set(snap.netVal);
      if (snap.edgePrev) snap.edgePrev.forEach((v, i) => { if (this.edgeList[i]) this.edgeList[i].prev = v; });
      snap.chips.forEach((s, i) => {
        const c = this.chips[i];
        c.state = K.clone(s.state);
        c.drives.set(s.drives);
        c.tickAcc = s.tickAcc;
        c.comp.props = K.clone(s.props);
      });
      this.halted = K.clone(snap.halted);
      if (this.traceStart > this.t) this.traceStart = this.t; // rewound past capture start
      this.dirtyNets.clear();
      this.pendingChips.clear();
      this._sched = null;
      // re-arm edge dispatch: every subscribed net gets one (non-firing) visit
      this._toggledNets.clear();
      for (const e of this.edgeList) this._toggledNets.add(e.net);
      this.chips.forEach((c, i) => c.def.onRestore?.(this.ios[i], c.state, c.comp.props, c));
      this.settle();
    }
  };
})(globalThis.K8086 ??= {});
