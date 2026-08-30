"use strict";
(function (K) {
  const { SIG } = K;
  const H = (io, n) => io.in(n) === SIG.H;
  const D = K.pinRange("D", 0, 7);

  // ------------------------------------------------------------- 8259A PIC ----
  // 8086 vectoring; single AND cascade mode (master drives the CAS bus during
  // INTA, the addressed slave answers with its own vector), edge- and level-
  // triggered, rotating priority (all OCW2 commands), auto-EOI. Master/slave
  // role comes from the ~SP/~EN strap (non-buffered mode: high = master).
  K.defineChip({
    type: "8259A", name: "8259A interrupt controller", category: "System", wide: true,
    dip: ["i:~CS", "i:~WR", "i:~RD", "io:D7", "io:D6", "io:D5", "io:D4", "io:D3", "io:D2",
          "io:D1", "io:D0", "io:CAS0", "io:CAS1", "g:GND", "io:CAS2", "i:~SP/~EN", "o:INT",
          "i:IR0", "i:IR1", "i:IR2", "i:IR3", "i:IR4", "i:IR5", "i:IR6", "i:IR7",
          "i:~INTA", "i:A0", "p:VCC"],
    edgePins: ["~WR", "~INTA", "IR0", "IR1", "IR2", "IR3", "IR4", "IR5", "IR6", "IR7"],
    noFloatWarn: true,
    init(state) {
      state.irr = 0; state.isr = 0; state.imr = 0;
      state.base = 8; state.icwStep = 0; state.needIcw4 = 0;
      state.single = 1; state.ltim = 0; state.icw3 = 0; state.aeoi = 0;
      state.bottom = 7;           // rotating priority: highest = (bottom+1)&7
      state.rotAeoi = 0;
      state.readSel = 0;          // 0 = IRR, 1 = ISR (OCW3)
      state.intaPhase = 0;        // 0 idle, 1 = first pulse seen, 2 = vector phase
      state.curIrq = 7;
      state.casMatch = false;     // slave: our ID was on CAS for this INTA
      state.intOut = 0;
    },
    _isSlave(io) { return io.in("~SP/~EN") === SIG.L; },    // non-buffered mode strap
    _resolve(state) {
      const pending = state.irr & ~state.imr;
      for (let k = 1; k <= 8; k++) {                        // rotating priority order
        const i = (state.bottom + k) & 7;
        if (state.isr & (1 << i)) { state.intOut = 0; return -1; }
        if (pending & (1 << i)) { state.intOut = 1; return i; }
      }
      state.intOut = 0;
      return -1;
    },
    _eoiTop(state) {              // highest-priority in-service level, rotating order
      for (let k = 1; k <= 8; k++) {
        const i = (state.bottom + k) & 7;
        if (state.isr & (1 << i)) return i;
      }
      return -1;
    },
    evaluate(io, state) {
      this._resolve(state);
      io.out("INT", state.intOut);
      const slave = this._isSlave(io);
      const cascade = !state.single;
      // CAS bus: the master drives the granted level during the INTA sequence
      const CAS = ["CAS0", "CAS1", "CAS2"];
      if (!slave && cascade && state.intaPhase > 0) io.outBus(CAS, state.curIrq);
      else io.zBus(CAS);
      const selected = !H(io, "~CS");
      if (selected && !H(io, "~RD") && H(io, "~WR")) {
        const a0 = H(io, "A0") ? 1 : 0;
        io.outBus(D, a0 ? state.imr : (state.readSel ? state.isr : state.irr));
        return;
      }
      if (!H(io, "~INTA") && state.intaPhase === 2) {
        // vector phase: a master defers to the slave on a cascaded line;
        // a slave answers only if its ID was on the CAS bus
        const deferred = !slave && cascade && ((state.icw3 >> state.curIrq) & 1);
        const active = slave ? state.casMatch : !deferred;
        if (active) { io.outBus(D, (state.base & 0xF8) + state.curIrq); return; }
      }
      io.zBus(D);
    },
    _finishInta(state) {
      if (state.aeoi) {
        state.isr &= ~(1 << state.curIrq);                  // automatic EOI
        if (state.rotAeoi) state.bottom = state.curIrq;     // rotate in AEOI mode
      }
      state.intaPhase = 0;
      state.casMatch = false;
    },
    onEdge(pin, rising, io, state) {
      if (pin.startsWith("IR")) {
        const n = +pin.slice(2);
        if (rising) state.irr |= 1 << n;
        else if (state.ltim) state.irr &= ~(1 << n);        // level mode: IRR follows the pin
        return;
      }
      if (pin === "~WR") {
        if (!rising || H(io, "~CS")) return;                // latch on rising edge
        const a0 = H(io, "A0") ? 1 : 0;
        const v = io.num(D);
        if (a0 === 0) {
          if (v & 0x10) {                                   // ICW1
            state.icwStep = 1; state.needIcw4 = v & 1;
            state.single = (v >> 1) & 1; state.ltim = (v >> 3) & 1;
            state.irr = 0; state.isr = 0; state.imr = 0; state.readSel = 0;
            state.bottom = 7; state.aeoi = 0; state.rotAeoi = 0;
          } else if ((v & 0x18) === 0) {                    // OCW2
            const cmd = v >> 5, lvl = v & 7;
            if (cmd === 1) {                                // non-specific EOI
              const t = this._eoiTop(state);
              if (t >= 0) state.isr &= ~(1 << t);
            } else if (cmd === 3) state.isr &= ~(1 << lvl); // specific EOI
            else if (cmd === 5) {                           // rotate on non-specific EOI
              const t = this._eoiTop(state);
              if (t >= 0) { state.isr &= ~(1 << t); state.bottom = t; }
            } else if (cmd === 7) { state.isr &= ~(1 << lvl); state.bottom = lvl; } // rotate on specific EOI
            else if (cmd === 6) state.bottom = lvl;         // set priority
            else if (cmd === 4) state.rotAeoi = 1;          // rotate in AEOI mode on
            else if (cmd === 0) state.rotAeoi = 0;          //                    off
          } else if (v & 0x08) {                            // OCW3
            if (v & 2) state.readSel = v & 1;
          }
        } else {
          if (state.icwStep === 1) { state.base = v; state.icwStep = state.single ? (state.needIcw4 ? 3 : 0) : 2; }
          else if (state.icwStep === 2) { state.icw3 = v; state.icwStep = state.needIcw4 ? 3 : 0; }
          else if (state.icwStep === 3) { state.aeoi = (v >> 1) & 1; state.icwStep = 0; } // ICW4 (8086 mode assumed)
          else state.imr = v;                               // OCW1
        }
        return;
      }
      if (pin === "~INTA") {
        const slave = this._isSlave(io);
        if (!rising) {                                      // falling edge: pulse begins
          if (state.intaPhase === 0) {
            const irq = this._resolve(state);
            state.curIrq = irq >= 0 ? irq : 7;              // spurious -> IR7
            state.intaPhase = 1;
            if (!slave) {
              state.isr |= 1 << state.curIrq;
              if (!state.ltim) state.irr &= ~(1 << state.curIrq);
            }
          } else {
            state.intaPhase = 2;                            // 2nd pulse: vector phase
            if (slave) {
              state.casMatch = io.num(["CAS0", "CAS1", "CAS2"]) === (state.icw3 & 7);
              if (state.casMatch) {
                state.isr |= 1 << state.curIrq;
                if (!state.ltim) state.irr &= ~(1 << state.curIrq);
              }
            }
          }
        } else if (state.intaPhase === 2) {
          this._finishInta(state);                          // sequence complete
        }
      }
    },
  });

  // ------------------------------------------------------------- 8253 PIT ----
  // 8253/8254 programmable interval timer. The 8254 adds the read-back
  // command (status + count latching for several counters at once).
  const definePit = (type, name, is8254) => K.defineChip({
    type, name, category: "System", wide: true,
    dip: ["io:D7", "io:D6", "io:D5", "io:D4", "io:D3", "io:D2", "io:D1", "io:D0",
          "i:CLK0", "o:OUT0", "i:GATE0", "g:GND", "o:OUT1", "i:GATE1", "i:CLK1",
          "i:GATE2", "o:OUT2", "i:CLK2", "i:A1", "i:A0", "i:~CS", "i:~RD", "i:~WR", "p:VCC"],
    edgePins: ["~WR", "~RD", "CLK0", "CLK1", "CLK2", "GATE0", "GATE1", "GATE2"],
    noFloatWarn: true,
    init(state) {
      state.ctr = [0, 1, 2].map(() => ({
        mode: 0, rw: 3, count: 0, reload: 0, out: 0, loadPhase: 0, readPhase: 0,
        latched: null, statusLatched: null, armed: false, loaded: false,
        trig: false, strobed: false,
      }));
    },
    inspect(state) {
      const out = [];
      state.ctr.forEach((c, i) => {
        out.push({ key: `ctr${i}.count`, kind: "num", get: () => c.count, set: (v) => { c.count = v & 0xFFFF; } });
        out.push({ key: `ctr${i}.reload`, kind: "num", get: () => c.reload, set: (v) => { c.reload = v & 0xFFFF; } });
        out.push({ key: `ctr${i}.mode`, kind: "num", get: () => c.mode, set: (v) => { c.mode = v & 7; } });
        out.push({ key: `ctr${i}.out`, kind: "num", get: () => c.out, set: (v) => { c.out = v & 1; } });
      });
      return out;
    },
    _status(c) {
      // OUT | NULLCOUNT | RW1 RW0 | M2 M1 M0 | BCD
      return (c.out << 7) | ((c.loaded ? 0 : 1) << 6) | (c.rw << 4) | (c.mode << 1);
    },
    evaluate(io, state) {
      // fast path for the endless CLK-edge projections: outs unchanged and
      // chip not selected -> nothing external can differ, skip the pin work
      const okey = state.ctr[0].out | (state.ctr[1].out << 1) | (state.ctr[2].out << 2);
      const sel = !H(io, "~CS");
      if (!sel && !state._selWas && state._okey === okey) return;
      state._okey = okey; state._selWas = sel;
      for (let i = 0; i < 3; i++) io.out("OUT" + i, state.ctr[i].out);
      if (sel && !H(io, "~RD") && H(io, "~WR")) {
        const sel = (H(io, "A0") ? 1 : 0) | (H(io, "A1") ? 2 : 0);
        if (sel < 3) {
          const c = state.ctr[sel];
          if (c.statusLatched !== null) { io.outBus(D, c.statusLatched); return; }
          const v = c.latched !== null ? c.latched : c.count;
          let byte;
          if (c.rw === 1) byte = v & 0xFF;
          else if (c.rw === 2) byte = (v >> 8) & 0xFF;
          else byte = c.readPhase === 0 ? v & 0xFF : (v >> 8) & 0xFF;
          io.outBus(D, byte);
        } else io.zBus(D);
      } else io.zBus(D);
    },
    onEdge(pin, rising, io, state) {
      if (pin.startsWith("GATE")) {
        // hardware trigger for modes 1/5; mode 2/3 reload on the rising edge
        if (!rising) return;
        const c = state.ctr[+pin.slice(4)];
        if (c.mode === 1 || c.mode === 5) { if (c.loaded) c.trig = true; }
        else if ((c.mode === 2 || c.mode === 3) && c.loaded) c.count = c.reload === 0 ? 0xFFFF : c.reload;
        return;
      }
      if (pin === "~RD") {
        // a completed read advances the LSB/MSB phase and releases latches
        if (!rising || H(io, "~CS")) return;
        const sel = (H(io, "A0") ? 1 : 0) | (H(io, "A1") ? 2 : 0);
        if (sel > 2) return;
        const c = state.ctr[sel];
        if (c.statusLatched !== null) { c.statusLatched = null; return; }  // one status byte
        if (c.rw === 3) {
          c.readPhase ^= 1;
          if (c.readPhase === 0 && c.latched !== null) c.latched = null;
        } else if (c.latched !== null) c.latched = null;
        return;
      }
      if (pin === "~WR") {
        if (!rising || H(io, "~CS")) return;
        const sel = (H(io, "A0") ? 1 : 0) | (H(io, "A1") ? 2 : 0);
        const v = io.num(D);
        if (sel === 3) {                                    // control word
          const cn = v >> 6;
          if (cn === 3) {                                   // read-back (8254 only)
            if (!is8254) return;
            for (let i = 0; i < 3; i++) {
              if (!(v & (2 << i))) continue;
              const c = state.ctr[i];
              if (!(v & 0x20) && c.latched === null) { c.latched = c.count; c.readPhase = 0; }
              if (!(v & 0x10) && c.statusLatched === null) c.statusLatched = this._status(c);
            }
            return;
          }
          const c = state.ctr[cn];
          const rw = (v >> 4) & 3;
          if (rw === 0) { c.latched = c.count; c.readPhase = 0; return; } // latch cmd
          c.rw = rw; c.mode = (v >> 1) & 7;
          if (c.mode > 5) c.mode -= 4;
          c.loadPhase = 0; c.readPhase = 0; c.latched = null; c.statusLatched = null;
          c.loaded = false; c.armed = false; c.trig = false; c.strobed = false;
          c.out = c.mode === 0 ? 0 : 1;                     // modes 1-5 idle high
        } else {
          const c = state.ctr[sel];
          if (c.rw === 1) { c.reload = v; c.loaded = true; }            // LSB only: MSB = 0
          else if (c.rw === 2) { c.reload = v << 8; c.loaded = true; }  // MSB only: LSB = 0
          else if (c.loadPhase === 0) { c.reload = (c.reload & 0xFF00) | v; c.loadPhase = 1; }
          else { c.reload = (c.reload & 0x00FF) | (v << 8); c.loadPhase = 0; c.loaded = true; }
          if (c.loaded) {
            c.count = c.reload === 0 ? 0xFFFF : c.reload;  // reload 0 counts as 65536
            c.strobed = false;
            // modes 1 and 5 wait for a GATE trigger; the rest start counting now
            c.armed = c.mode !== 1 && c.mode !== 5;
            if (c.mode === 0) c.out = 0;
          }
        }
        return;
      }
      if (pin.startsWith("CLK") && !rising) {               // count on falling edge
        const i = +pin.slice(3);
        // channels sharing one clock net are batched into the first's edge
        const chip = io.chip;
        let cg = chip.runtime._cg;
        if (!cg) {
          const ix = chip.def.pinIndex;
          const byNet = new Map();
          cg = chip.runtime._cg = [null, null, null];
          for (let ch = 0; ch < 3; ch++) {
            const n = chip.pinNet[ix["CLK" + ch]];
            if (n >= 0 && byNet.has(n)) byNet.get(n).push(ch);
            else { const l = [ch]; byNet.set(n, l); cg[ch] = l; }
          }
        }
        const chans = cg[i];
        if (!chans) return;                                 // a peer channel handles this net
        for (const che of chans) this._clkFall(io, state, che);
        return;
      }
    },
    _clkFall(io, state, i) {
      {
        const c = state.ctr[i];
        // hardware trigger consumed on the next CLK: (re)load and run
        if (c.trig) {
          c.trig = false;
          c.count = c.reload === 0 ? 0xFFFF : c.reload;
          c.armed = true;
          c.strobed = false;
          if (c.mode === 1) c.out = 0;                      // one-shot goes low now
        }
        if (!c.armed) return;                               // cheap-out before pin reads
        const chip = io.chip;
        let gn = chip.runtime._gn;
        if (!gn) {
          const ix = chip.def.pinIndex;
          gn = chip.runtime._gn = [chip.pinNet[ix.GATE0], chip.pinNet[ix.GATE1], chip.pinNet[ix.GATE2]];
        }
        const gv = gn[i] < 0 ? SIG.Z : io.sim.netVal[gn[i]];
        const gate = gv !== SIG.L;                          // floating gate counts
        // gate level: pauses 0/2/3/4; modes 1/5 count regardless once triggered
        if (!gate && c.mode !== 1 && c.mode !== 5) return;
        switch (c.mode) {
          case 0:                                           // interrupt on terminal count
            c.count = (c.count - 1) & 0xFFFF;
            if (c.count === 0) c.out = 1;
            break;
          case 1:                                           // hw retriggerable one-shot
            c.count = (c.count - 1) & 0xFFFF;
            if (c.count === 0) c.out = 1;
            break;
          case 2:                                           // rate generator
            c.count = (c.count - 1) & 0xFFFF;
            if (c.count === 1) c.out = 0;
            else if (c.count === 0) { c.out = 1; c.count = c.reload; }
            else c.out = 1;
            break;
          case 3:                                           // square wave
            c.count = (c.count - 2) & 0xFFFF;
            if (c.count === 0 || c.count >= 0xFFFE) { c.out ^= 1; c.count = (c.reload || 0xFFFE) & ~1; }
            break;
          case 4: case 5:                                    // strobe: one CLK low at TC
            if (c.strobed) { c.out = 1; c.strobed = false; c.armed = c.mode === 4 && false; break; }
            c.count = (c.count - 1) & 0xFFFF;
            if (c.count === 0) { c.out = 0; c.strobed = true; }
            break;
        }
      }
    },
  });
  definePit("8253", "8253 timer (3ch)", false);
  definePit("8254", "8254 timer (read-back)", true);

  // ------------------------------------------------------------- 8255 PPI ----
  K.defineChip({
    type: "8255", name: "8255 PPI (mode 0)", category: "System", wide: true,
    dip: ["io:PA3", "io:PA2", "io:PA1", "io:PA0", "i:~RD", "i:~CS", "g:GND", "i:A1", "i:A0",
          "io:PC7", "io:PC6", "io:PC5", "io:PC4", "io:PC0", "io:PC1", "io:PC2", "io:PC3",
          "io:PB0", "io:PB1", "io:PB2", "io:PB3", "io:PB4", "io:PB5", "io:PB6", "io:PB7",
          "p:VCC", "io:D7", "io:D6", "io:D5", "io:D4", "io:D3", "io:D2", "io:D1", "io:D0",
          "i:RESET", "i:~WR", "io:PA7", "io:PA6", "io:PA5", "io:PA4"],
    edgePins: ["~WR", "RESET"],
    noFloatWarn: true,
    init(state) { state.ctrl = 0x9B; state.a = 0; state.b = 0; state.c = 0; },
    _dirs(state) {
      return {
        aIn: (state.ctrl >> 4) & 1, bIn: (state.ctrl >> 1) & 1,
        clIn: state.ctrl & 1, chIn: (state.ctrl >> 3) & 1,
      };
    },
    evaluate(io, state) {
      const PA = K.pinRange("PA", 0, 7), PB = K.pinRange("PB", 0, 7), PC = K.pinRange("PC", 0, 7);
      const d = this._dirs(state);
      if (d.aIn) io.zBus(PA); else io.outBus(PA, state.a);
      if (d.bIn) io.zBus(PB); else io.outBus(PB, state.b);
      for (let i = 0; i < 8; i++) {
        const isIn = i < 4 ? d.clIn : d.chIn;
        if (isIn) io.z("PC" + i); else io.out("PC" + i, (state.c >> i) & 1);
      }
      if (!H(io, "~CS") && !H(io, "~RD") && H(io, "~WR")) {
        const sel = (H(io, "A0") ? 1 : 0) | (H(io, "A1") ? 2 : 0);
        if (sel === 0) io.outBus(D, d.aIn ? io.num(PA) : state.a);
        else if (sel === 1) io.outBus(D, d.bIn ? io.num(PB) : state.b);
        else if (sel === 2) {
          let v = 0;
          for (let i = 0; i < 8; i++) {
            const isIn = i < 4 ? d.clIn : d.chIn;
            v |= (isIn ? (io.in("PC" + i) === SIG.H ? 1 : 0) : (state.c >> i) & 1) << i;
          }
          io.outBus(D, v);
        } else io.outBus(D, state.ctrl);
      } else io.zBus(D);
    },
    onEdge(pin, rising, io, state) {
      if (pin === "RESET") { if (rising) { state.ctrl = 0x9B; state.a = state.b = state.c = 0; } return; }
      if (pin !== "~WR" || !rising || H(io, "~CS")) return;
      const sel = (H(io, "A0") ? 1 : 0) | (H(io, "A1") ? 2 : 0);
      const v = io.num(D);
      if (sel === 0) state.a = v;
      else if (sel === 1) state.b = v;
      else if (sel === 2) state.c = v;
      else if (v & 0x80) state.ctrl = v;
      else {                                                // BSR: set/reset a PC bit
        const bit = (v >> 1) & 7;
        if (v & 1) state.c |= 1 << bit; else state.c &= ~(1 << bit);
      }
    },
  });
})(globalThis.K8086 ??= {});
