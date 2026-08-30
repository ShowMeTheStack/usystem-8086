"use strict";
(function (K) {
  const { SIG } = K;
  const H = (io, n) => io.in(n) === SIG.H;

  // Quad 2-input gate pinout shared by 7400/08/32/86 (unit outputs at 3,6,8,11).
  function quadGate(type, name, fn) {
    K.defineChip({
      type, name, category: "Logic",
      dip: ["i:1A", "i:1B", "o:1Y", "i:2A", "i:2B", "o:2Y", "g:GND",
            "o:3Y", "i:3A", "i:3B", "o:4Y", "i:4A", "i:4B", "p:VCC"],
      evaluate(io) {
        for (const u of ["1", "2", "3", "4"])
          io.out(u + "Y", fn(H(io, u + "A") ? 1 : 0, H(io, u + "B") ? 1 : 0));
      },
    });
  }
  quadGate("74LS00", "Quad 2-in NAND", (a, b) => (a & b) ^ 1);
  quadGate("74LS02", "Quad 2-in NOR", (a, b) => (a | b) ^ 1);
  quadGate("74LS08", "Quad 2-in AND", (a, b) => a & b);
  quadGate("74LS32", "Quad 2-in OR", (a, b) => a | b);
  quadGate("74LS86", "Quad 2-in XOR", (a, b) => a ^ b);
  // 7402 actually routes Y,A,B differently (1Y=1, 1A=2, 1B=3...) — accepted deviation
  // for v0.1; noted so a purist pass can fix the physical pin numbers later.

  K.defineChip({
    type: "74LS04", name: "Hex inverter", category: "Logic",
    dip: ["i:1A", "o:1Y", "i:2A", "o:2Y", "i:3A", "o:3Y", "g:GND",
          "o:4Y", "i:4A", "o:5Y", "i:5A", "o:6Y", "i:6A", "p:VCC"],
    evaluate(io) { for (const u of ["1", "2", "3", "4", "5", "6"]) io.out(u + "Y", H(io, u + "A") ? 0 : 1); },
  });

  K.defineChip({
    type: "74LS138", name: "3-to-8 decoder", category: "Logic",
    dip: ["i:A", "i:B", "i:C", "i:~G2A", "i:~G2B", "i:G1", "o:Y7", "g:GND",
          "o:Y6", "o:Y5", "o:Y4", "o:Y3", "o:Y2", "o:Y1", "o:Y0", "p:VCC"],
    evaluate(io) {
      const en = H(io, "G1") && !H(io, "~G2A") && !H(io, "~G2B");
      const sel = (H(io, "A") ? 1 : 0) | (H(io, "B") ? 2 : 0) | (H(io, "C") ? 4 : 0);
      for (let i = 0; i < 8; i++) io.out("Y" + i, en && i === sel ? 0 : 1);
    },
  });

  K.defineChip({
    type: "74LS139", name: "Dual 2-to-4 decoder", category: "Logic",
    dip: ["i:~1G", "i:1A", "i:1B", "o:1Y0", "o:1Y1", "o:1Y2", "o:1Y3", "g:GND",
          "o:2Y3", "o:2Y2", "o:2Y1", "o:2Y0", "i:2B", "i:2A", "i:~2G", "p:VCC"],
    evaluate(io) {
      for (const u of ["1", "2"]) {
        const en = !H(io, `~${u}G`);
        const sel = (H(io, u + "A") ? 1 : 0) | (H(io, u + "B") ? 2 : 0);
        for (let i = 0; i < 4; i++) io.out(`${u}Y${i}`, en && i === sel ? 0 : 1);
      }
    },
  });

  K.defineChip({
    type: "74LS373", name: "Octal transparent latch", category: "Logic",
    dip: ["i:~OE", "t:Q0", "i:D0", "i:D1", "t:Q1", "t:Q2", "i:D2", "i:D3", "t:Q3", "g:GND",
          "i:LE", "t:Q4", "i:D4", "i:D5", "t:Q5", "t:Q6", "i:D6", "i:D7", "t:Q7", "p:VCC"],
    edgePins: ["LE"],
    init(state) { state.q = 0; },
    evaluate(io, state) {
      if (H(io, "LE")) state.q = io.num(K.pinRange("D", 0, 7));
      if (H(io, "~OE")) io.zBus(K.pinRange("Q", 0, 7));
      else io.outBus(K.pinRange("Q", 0, 7), state.q);
    },
    onEdge(pin, rising, io, state) { if (!rising) state.q = io.num(K.pinRange("D", 0, 7)); },
  });

  K.defineChip({
    type: "74LS374", name: "Octal D flip-flop", category: "Logic",
    dip: ["i:~OE", "t:Q0", "i:D0", "i:D1", "t:Q1", "t:Q2", "i:D2", "i:D3", "t:Q3", "g:GND",
          "i:CLK", "t:Q4", "i:D4", "i:D5", "t:Q5", "t:Q6", "i:D6", "i:D7", "t:Q7", "p:VCC"],
    edgePins: ["CLK"],
    init(state) { state.q = 0; },
    evaluate(io, state) {
      if (H(io, "~OE")) io.zBus(K.pinRange("Q", 0, 7));
      else io.outBus(K.pinRange("Q", 0, 7), state.q);
    },
    onEdge(pin, rising, io, state) { if (rising) state.q = io.num(K.pinRange("D", 0, 7)); },
  });

  K.defineChip({
    type: "74LS245", name: "Octal bus transceiver", category: "Logic",
    dip: ["i:DIR", "io:A0", "io:A1", "io:A2", "io:A3", "io:A4", "io:A5", "io:A6", "io:A7", "g:GND",
          "io:B7", "io:B6", "io:B5", "io:B4", "io:B3", "io:B2", "io:B1", "io:B0", "i:~G", "p:VCC"],
    evaluate(io) {
      const A = K.pinRange("A", 0, 7), B = K.pinRange("B", 0, 7);
      if (H(io, "~G")) { io.zBus(A); io.zBus(B); return; }
      if (H(io, "DIR")) { io.zBus(A); io.outBus(B, io.num(A)); }
      else { io.zBus(B); io.outBus(A, io.num(B)); }
    },
  });

  K.defineChip({
    type: "74LS244", name: "Octal buffer", category: "Logic",
    dip: ["i:~G1", "i:A0", "t:Y7", "i:A1", "t:Y6", "i:A2", "t:Y5", "i:A3", "t:Y4", "g:GND",
          "i:A4", "t:Y3", "i:A5", "t:Y2", "i:A6", "t:Y1", "i:A7", "t:Y0", "i:~G2", "p:VCC"],
    evaluate(io) {
      for (let i = 0; i < 4; i++) {
        if (H(io, "~G1")) io.z("Y" + i); else io.out("Y" + i, H(io, "A" + i) ? 1 : 0);
        if (H(io, "~G2")) io.z("Y" + (i + 4)); else io.out("Y" + (i + 4), H(io, "A" + (i + 4)) ? 1 : 0);
      }
    },
  });

  K.defineChip({
    type: "74LS157", name: "Quad 2:1 mux", category: "Logic",
    dip: ["i:S", "i:1A", "i:1B", "o:1Y", "i:2A", "i:2B", "o:2Y", "g:GND",
          "o:3Y", "i:3B", "i:3A", "o:4Y", "i:4B", "i:4A", "i:~G", "p:VCC"],
    evaluate(io) {
      const sel = H(io, "S");
      for (const u of ["1", "2", "3", "4"]) {
        if (H(io, "~G")) io.out(u + "Y", 0);
        else io.out(u + "Y", H(io, u + (sel ? "B" : "A")) ? 1 : 0);
      }
    },
  });

  K.defineChip({
    type: "74LS74", name: "Dual D flip-flop", category: "Logic",
    dip: ["i:~1CLR", "i:1D", "i:1CLK", "i:~1PRE", "o:1Q", "o:~1Q", "g:GND",
          "o:~2Q", "o:2Q", "i:~2PRE", "i:2CLK", "i:2D", "i:~2CLR", "p:VCC"],
    edgePins: ["1CLK", "2CLK"],
    init(state) { state.q1 = 0; state.q2 = 0; },
    evaluate(io, state) {
      for (const [u, q] of [["1", "q1"], ["2", "q2"]]) {
        if (!H(io, `~${u}CLR`)) state[q] = 0;
        else if (!H(io, `~${u}PRE`)) state[q] = 1;
        io.out(u + "Q", state[q]);
        io.out(`~${u}Q`, state[q] ^ 1);
      }
    },
    onEdge(pin, rising, io, state) {
      if (!rising) return;
      const u = pin[0], q = u === "1" ? "q1" : "q2";
      if (H(io, `~${u}CLR`) && H(io, `~${u}PRE`)) state[q] = H(io, u + "D") ? 1 : 0;
    },
  });

  K.defineChip({
    type: "74LS393", name: "Dual 4-bit ripple counter", category: "Logic",
    dip: ["i:1CLK", "i:1CLR", "o:1QA", "o:1QB", "o:1QC", "o:1QD", "g:GND",
          "o:2QD", "o:2QC", "o:2QB", "o:2QA", "i:2CLR", "i:2CLK", "p:VCC"],
    edgePins: ["1CLK", "2CLK"],
    init(state) { state.c1 = 0; state.c2 = 0; },
    evaluate(io, state) {
      if (H(io, "1CLR")) state.c1 = 0;
      if (H(io, "2CLR")) state.c2 = 0;
      for (const [u, c] of [["1", state.c1], ["2", state.c2]])
        ["QA", "QB", "QC", "QD"].forEach((n, b) => io.out(u + n, (c >> b) & 1));
    },
    onEdge(pin, rising, io, state) {
      if (rising) return; // counts on falling edge
      const u = pin[0];
      if (H(io, u + "CLR")) return;
      if (u === "1") state.c1 = (state.c1 + 1) & 15; else state.c2 = (state.c2 + 1) & 15;
    },
  });
})(globalThis.K8086 ??= {});
