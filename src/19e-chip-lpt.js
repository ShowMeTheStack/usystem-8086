"use strict";
(function (K) {
  const { SIG } = K;
  const H = (io, n) => io.in(n) === SIG.H;
  const D = K.pinRange("D", 0, 7);
  const PD = K.pinRange("PD", 0, 7);

  // LPT1 printer adapter: self-decodes 378h-37Ah exactly like the IBM MDA/LPT
  // card. Data latch at 378h drives PD0-7; status at 379h reads the printer's
  // handshake lines (BUSY inverted, as on the real register); control at 37Ah
  // drives ~STROBE/~AUTOFX/~INIT/~SLCTIN (bits 0,1,3 inverted on the wire).
  K.defineChip({
    type: "LPT378", name: "LPT1 printer adapter", category: "I/O",
    pins: [
      ...K.pinRange("A", 0, 9).map((n, i) => ({ name: n, kind: "in", side: "L", slot: i })),
      { name: "~IOR", kind: "in", side: "L", slot: 11 },
      { name: "~IOW", kind: "in", side: "L", slot: 12 },
      { name: "RESET", kind: "in", side: "L", slot: 13 },
      ...D.map((n, i) => ({ name: n, kind: "io", side: "R", slot: i })),
      { name: "IRQ", kind: "out", side: "R", slot: 9 },
      ...PD.map((n, i) => ({ name: n, kind: "out", side: "B", slot: i })),
      { name: "~STROBE", kind: "out", side: "B", slot: 9 },
      { name: "~AUTOFX", kind: "out", side: "B", slot: 10 },
      { name: "~INIT", kind: "out", side: "B", slot: 11 },
      { name: "~SLCTIN", kind: "out", side: "B", slot: 12 },
      { name: "BUSY", kind: "in", side: "B", slot: 14 },
      { name: "~ACK", kind: "in", side: "B", slot: 15 },
      { name: "PE", kind: "in", side: "B", slot: 16 },
      { name: "SLCT", kind: "in", side: "B", slot: 17 },
      { name: "~ERROR", kind: "in", side: "B", slot: 18 },
    ],
    grid: { w: 12, h: 19 },
    edgePins: ["~IOW", "RESET"],
    noFloatWarn: true,
    init(state) { state.data = 0; state.ctrl = 0x0C; },   // SLCTIN+INIT idle
    inspect(state) {
      return [
        { key: "data latch (378h)", kind: "num", get: () => state.data, set: (v) => { state.data = v & 0xFF; } },
        { key: "control (37Ah)", kind: "num", get: () => state.ctrl, set: (v) => { state.ctrl = v & 0x1F; } },
      ];
    },
    _port(io) { return io.num(K.pinRange("A", 0, 9)); },
    evaluate(io, state) {
      io.outBus(PD, state.data);
      io.out("~STROBE", state.ctrl & 1 ? 0 : 1);          // written 1 = asserted low
      io.out("~AUTOFX", state.ctrl & 2 ? 0 : 1);
      io.out("~INIT", state.ctrl & 4 ? 1 : 0);            // NOT inverted
      io.out("~SLCTIN", state.ctrl & 8 ? 0 : 1);
      io.out("IRQ", (state.ctrl & 0x10) && io.raw("~ACK") === SIG.L ? 1 : 0);
      const port = this._port(io);
      if ((port & 0x3FC) === 0x378 && !H(io, "~IOR")) {
        const r = port & 3;
        let v = 0xFF;
        if (r === 0) v = state.data;
        else if (r === 1) {
          v = 0x07 |
            (H(io, "BUSY") ? 0 : 0x80) |                  // register bit is ~BUSY
            (io.raw("~ACK") !== SIG.L ? 0x40 : 0) |
            (H(io, "PE") ? 0x20 : 0) |
            (H(io, "SLCT") ? 0x10 : 0) |
            (io.raw("~ERROR") !== SIG.L ? 0x08 : 0);
        } else if (r === 2) v = 0xE0 | state.ctrl;
        io.outBus(D, v & 0xFF);
        return;
      }
      io.zBus(D);
    },
    onEdge(pin, rising, io, state) {
      if (pin === "RESET") { if (rising) this.init(state); return; }
      if (!rising) return;                                // latch on ~IOW rising
      const port = this._port(io);
      if ((port & 0x3FC) !== 0x378) return;
      const r = port & 3;
      if (r === 0) state.data = io.num(D);
      else if (r === 2) state.ctrl = io.num(D) & 0x1F;
    },
  });

  // Dot-matrix printer: latches PD0-7 on the ~STROBE falling edge, goes BUSY
  // for a realistic moment, then pulses ~ACK. The paper lives in state.paper —
  // double-click the printer to read it.
  K.defineChip({
    type: "PRINTER", name: "Dot-matrix printer", category: "I/O",
    pins: [
      ...PD.map((n, i) => ({ name: n, kind: "in", side: "L", slot: i })),
      { name: "~STROBE", kind: "in", side: "L", slot: 9 },
      { name: "BUSY", kind: "out", side: "R", slot: 0 },
      { name: "~ACK", kind: "out", side: "R", slot: 1 },
      { name: "PE", kind: "out", side: "R", slot: 2 },
      { name: "SLCT", kind: "out", side: "R", slot: 3 },
      { name: "~ERROR", kind: "out", side: "R", slot: 4 },
    ],
    grid: { w: 10, h: 10 }, symbol: "printer",
    edgePins: ["~STROBE"],
    noFloatWarn: true,
    tickHz: () => 100000,                                 // handshake timing base
    init(state) { state.paper = ""; state.chars = 0; state.busyT = 0; state.ackT = 0; },
    inspect(state) {
      return [
        { key: "characters printed", kind: "num", get: () => state.chars, set: () => {} },
        { key: "busy", kind: "bool", get: () => state.busyT > 0, set: () => {} },
      ];
    },
    onEdge(pin, rising, io, state) {
      if (pin !== "~STROBE" || rising || state.busyT > 0) return;
      const b = io.num(PD);
      state.paper += b === 13 ? "" : String.fromCharCode(b);
      if (state.paper.length > 8000) state.paper = state.paper.slice(-8000);
      state.chars++;
      state.busyT = 12;                                   // ~120 us at the tick base
    },
    tick(io, state) {
      if (state.busyT > 0 && --state.busyT === 0) state.ackT = 3;
      else if (state.ackT > 0) state.ackT--;
      this.evaluate(io, state);
    },
    evaluate(io, state) {
      io.out("BUSY", state.busyT > 0 ? 1 : 0);
      io.out("~ACK", state.ackT > 0 ? 0 : 1);
      io.out("PE", 0);
      io.out("SLCT", 1);
      io.out("~ERROR", 1);
    },
  });

  // Speaker: measures the frequency on its input from toggle spacing (the
  // interval is in engine half-cycles, sim.hz of them per second). Keeps a
  // short log of distinct tones so a whole beep survives to be inspected.
  K.defineChip({
    type: "SPKR", name: "Speaker", category: "I/O",
    pins: [
      { name: "IN", kind: "in", side: "L", slot: 1 },
      { name: "GND", kind: "gnd", side: "L", slot: 3 },
    ],
    grid: { w: 6, h: 6 }, symbol: "spkr",
    noFloatWarn: true,
    init(state) { state.last = 0; state.lastT = -1; state.freq = 0; state.toggles = 0; state.log = []; },
    inspect(state) {
      return [
        { key: "frequency (Hz)", kind: "num", get: () => state.freq, set: () => {} },
        { key: "toggles", kind: "num", get: () => state.toggles, set: () => {} },
      ];
    },
    evaluate(io, state) {
      const v = io.in("IN") === SIG.H ? 1 : 0;
      if (v === state.last) return;
      state.last = v;
      const t = io.sim.t;
      if (state.lastT >= 0) {
        const dt = t - state.lastT;
        if (dt > 0) {
          const f = Math.round(io.sim.hz / (2 * dt));
          state.freq = f;
          const last = state.log[state.log.length - 1];
          if (!last || Math.abs(last.f - f) > last.f * 0.05) {
            state.log.push({ t, f });
            if (state.log.length > 64) state.log.shift();
          }
        }
      }
      state.lastT = t;
      state.toggles++;
    },
  });
})(globalThis.K8086 ??= {});
