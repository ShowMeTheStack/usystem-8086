"use strict";
(function (K) {
  const { SIG } = K;
  const H = (io, n) => io.in(n) === SIG.H;

  // XT mechanical keyboard: scancodes stream out serially on KDATA, clocked by
  // KCLK at ~16 kHz — probe the pins and watch the protocol in the waveform
  // analyzer. Key events arrive from the user's real keyboard via sim.applyInput
  // (deterministic: logged and replayed like any other input).
  // v1 sends 8 data bits LSB-first per code, then an inter-byte gap; the XT
  // start bit is a phase-4 refinement.
  K.defineChip({
    type: "XTKBD", name: "XT keyboard", category: "I/O",
    pins: [
      { name: "KCLK", kind: "out", side: "R", slot: 2 },
      { name: "KDATA", kind: "out", side: "R", slot: 3 },
      { name: "RST", kind: "in", side: "R", slot: 5 },   // clock-inhibit/reset from PPI PB6
    ],
    grid: { w: 24, h: 9 }, symbol: "keyboard",
    edgePins: ["RST"],
    noFloatWarn: true,
    init(state) {
      state.queue = [];
      state.cur = 0;
      state.bit = -1;        // -1 idle, 0..7 sending
      state.phase = 0;
      state.gap = 0;
      state.clk = 0;
      state.data = 0;
      state.sent = 0;
    },
    inspect(state) {
      return [
        { key: "queued codes", kind: "num", get: () => state.queue.length, set: () => {} },
        { key: "sending bit", kind: "num", get: () => state.bit, set: () => {} },
        { key: "codes sent", kind: "num", get: () => state.sent, set: () => {} },
      ];
    },
    onInput(state, patch) {
      if (patch.scan != null && state.queue.length < 32) state.queue.push(patch.scan & 0xFF);
    },
    onEdge(pin, rising, io, state) {
      // XT keyboard reset: when the host releases the clock line (PB6 high after
      // reset/inhibit), the keyboard runs its BAT and sends 0xAA.
      if (pin === "RST" && rising) {
        state.queue = [0xAA];
        state.bit = -1;
        state.phase = 0;
        state.gap = 8;
      }
    },
    tickHz: () => 2 * 16000,   // ~16 kHz bit clock
    tick(io, state) {
      if (io.raw("RST") === SIG.L) { state.clk = 0; this.evaluate(io, state); return; } // clock held
      if (state.gap > 0) { state.gap--; }
      else if (state.bit >= 8) {
        // the 8th rising edge must be visible for a full tick before the clock
        // returns low — dropping it in the same tick would swallow the edge
        state.bit = -1;
        state.clk = 0;
        state.data = 0;
        state.gap = 40;
        state.sent++;
      } else if (state.bit < 0) {
        if (state.queue.length) { state.cur = state.queue.shift(); state.bit = 0; state.phase = 0; }
      } else if (state.phase === 0) {
        state.data = (state.cur >> state.bit) & 1;   // LSB first, data valid before clock
        state.clk = 0;
        state.phase = 1;
      } else {
        state.clk = 1;                               // rising edge: receiver samples
        state.phase = 0;
        state.bit++;
      }
      this.evaluate(io, state);
    },
    evaluate(io, state) {
      io.out("KCLK", state.clk);
      io.out("KDATA", state.data);
    },
  });

  // Keyboard shift register — the IBM PC's SN74LS322 + "byte ready" flip-flop as
  // one teaching module: serial in from the keyboard, parallel out to an 8255
  // port, FULL raises the interrupt line until the host clears via CLR (PB7).
  K.defineChip({
    type: "KBDSHIFT", name: "Keyboard shift register ('322+FF)", category: "I/O",
    pins: [
      { name: "SER", kind: "in", side: "L", slot: 1 },
      { name: "CLK", kind: "in", side: "L", slot: 2 },
      { name: "CLR", kind: "in", side: "L", slot: 4 },
      ...K.pinRange("Q", 0, 7).map((n, i) => ({ name: n, kind: "out", side: "R", slot: i })),
      { name: "FULL", kind: "out", side: "B", slot: 2 },
    ],
    grid: { w: 6, h: 9 },
    edgePins: ["CLK"],
    noFloatWarn: true,
    init(state) { state.data = 0; state.count = 0; state.full = 0; },
    inspect(state) {
      return [
        { key: "data", kind: "num", get: () => state.data, set: (v) => { state.data = v & 0xFF; } },
        { key: "count", kind: "num", get: () => state.count, set: (v) => { state.count = v & 15; } },
        { key: "full", kind: "num", get: () => state.full, set: (v) => { state.full = v & 1; } },
      ];
    },
    evaluate(io, state) {
      if (H(io, "CLR")) { state.data = 0; state.count = 0; state.full = 0; }
      io.outBus(K.pinRange("Q", 0, 7), state.data);
      io.out("FULL", state.full);
    },
    onEdge(pin, rising, io, state) {
      if (!rising || H(io, "CLR") || state.full) return;
      state.data = ((state.data >> 1) | (H(io, "SER") ? 0x80 : 0)) & 0xFF; // LSB arrives first
      state.count++;
      if (state.count >= 8) { state.full = 1; state.count = 0; }
    },
  });
})(globalThis.K8086 ??= {});
