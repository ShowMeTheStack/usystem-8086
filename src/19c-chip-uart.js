"use strict";
(function (K) {
  const { SIG } = K;
  const H = (io, n) => io.in(n) === SIG.H;
  const D = K.pinRange("D", 0, 7);

  // 8250 UART on a COM1 card: self-decodes 3F8h-3FFh, IRQ4 on INTR. The full
  // register file (RBR/THR, DLAB divisor latch, IER/IIR/LCR/MCR/LSR/MSR/scratch);
  // transmitted bytes accumulate in state.tx (the Terminal view renders them),
  // received bytes arrive deterministically through the input log (applyInput
  // {rx: byte}) so rewind replays serial input like everything else.
  K.defineChip({
    type: "COM8250", name: "8250 UART (COM1 card)", category: "I/O", isUart: true,
    pins: [
      ...K.pinRange("A", 0, 9).map((n, i) => ({ name: n, kind: "in", side: "L", slot: i })),
      { name: "~IOR", kind: "in", side: "L", slot: 11 },
      { name: "~IOW", kind: "in", side: "L", slot: 12 },
      { name: "RESET", kind: "in", side: "L", slot: 13 },
      ...D.map((n, i) => ({ name: n, kind: "io", side: "R", slot: i })),
      { name: "INTR", kind: "out", side: "R", slot: 9 },
      { name: "SOUT", kind: "out", side: "R", slot: 11 },
      { name: "SIN", kind: "in", side: "R", slot: 12 },
    ],
    grid: { w: 12, h: 15 },
    edgePins: ["~IOR", "~IOW", "RESET"],
    noFloatWarn: true,
    init(state) {
      state.ier = 0; state.lcr = 0; state.mcr = 0; state.scratch = 0;
      state.dll = 12; state.dlm = 0;                     // 9600 baud default
      state.rxQ = [];
      state.tx = "";
      state.txCount = 0;
    },
    inspect(state) {
      const baud = Math.round(1843200 / (16 * Math.max(1, (state.dlm << 8) | state.dll)));
      return [
        { key: "baud (divisor)", kind: "num", get: () => (state.dlm << 8) | state.dll, set: (v) => { state.dll = v & 0xFF; state.dlm = (v >> 8) & 0xFF; } },
        { key: "baud rate = " + baud, kind: "num", get: () => baud, set: () => {} },
        { key: "IER", kind: "num", get: () => state.ier, set: (v) => { state.ier = v & 0xFF; } },
        { key: "LCR", kind: "num", get: () => state.lcr, set: (v) => { state.lcr = v & 0xFF; } },
        { key: "rx queued", kind: "num", get: () => state.rxQ.length, set: () => {} },
        { key: "tx bytes", kind: "num", get: () => state.txCount, set: () => {} },
      ];
    },
    onInput(state, patch) {
      if (patch.rx != null && state.rxQ.length < 256) state.rxQ.push(patch.rx & 0xFF);
      if (patch.rxs) for (const c of patch.rxs) if (state.rxQ.length < 256) state.rxQ.push(c.charCodeAt(0) & 0xFF);
    },
    _port(io) { return io.num(K.pinRange("A", 0, 9)); },
    evaluate(io, state) {
      const dr = state.rxQ.length > 0;
      io.out("INTR", (state.ier & 1) && dr ? 1 : 0);
      io.out("SOUT", 1);                                 // idle mark
      const port = this._port(io);
      if ((port & 0x3F8) !== 0x3F8) { io.zBus(D); return; }
      if (!H(io, "~IOR")) {
        const r = port & 7;
        const dlab = (state.lcr & 0x80) !== 0;
        let v = 0xFF;
        if (r === 0) v = dlab ? state.dll : (dr ? state.rxQ[0] : 0);
        else if (r === 1) v = dlab ? state.dlm : state.ier;
        else if (r === 2) v = (state.ier & 1) && dr ? 0x04 : 0x01;   // IIR: RX avail / none
        else if (r === 3) v = state.lcr;
        else if (r === 4) v = state.mcr;
        else if (r === 5) v = 0x60 | (dr ? 1 : 0);                   // LSR: THRE|TEMT|DR
        else if (r === 6) v = 0xB0;                                   // MSR: DCD|DSR|CTS
        else if (r === 7) v = state.scratch;
        io.outBus(D, v & 0xFF);
        return;
      }
      io.zBus(D);
    },
    onEdge(pin, rising, io, state, props, chip) {
      if (pin === "RESET") { if (rising) this.init(state); return; }
      if (!rising) return;
      const port = this._port(io);
      if ((port & 0x3F8) !== 0x3F8) return;
      const r = port & 7;
      const dlab = (state.lcr & 0x80) !== 0;
      if (pin === "~IOR") {
        if (r === 0 && !dlab && state.rxQ.length) state.rxQ.shift();
        return;
      }
      const v = io.num(D);
      if (r === 0) {
        if (dlab) state.dll = v;
        else {
          state.tx += String.fromCharCode(v);
          if (state.tx.length > 8192) state.tx = state.tx.slice(-4096);
          state.txCount++;
        }
      }
      else if (r === 1) { if (dlab) state.dlm = v; else state.ier = v; }
      else if (r === 3) state.lcr = v;
      else if (r === 4) state.mcr = v;
      else if (r === 7) state.scratch = v;
    },
  });
})(globalThis.K8086 ??= {});
