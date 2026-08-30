"use strict";
(function (K) {
  const { SIG } = K;

  K.defineChip({
    type: "VCC", name: "VCC rail", category: "Power", noFloatWarn: true,
    pins: [{ name: "V", kind: "out", side: "B", slot: 0 }], grid: { w: 2, h: 2 }, symbol: "vcc",
    evaluate(io) { io.out("V", 1); },
  });
  K.defineChip({
    type: "GND", name: "GND rail", category: "Power", noFloatWarn: true,
    pins: [{ name: "G", kind: "out", side: "T", slot: 0 }], grid: { w: 2, h: 2 }, symbol: "gnd",
    evaluate(io) { io.out("G", 0); },
  });
  K.defineChip({
    type: "NETLABEL", name: "Net label", category: "Power", noFloatWarn: true,
    pins: [{ name: "N", kind: "nc", side: "L", slot: 0 }], grid: { w: 3, h: 1 }, symbol: "label",
    props: { name: "NET" },
  });
  K.defineChip({
    type: "PULLUP", name: "Pull-up 4.7k", category: "Power", isPull: true, noFloatWarn: true,
    pins: [{ name: "P", kind: "oc", side: "B", slot: 0 }], grid: { w: 2, h: 2 }, symbol: "pullup",
    evaluate(io) { io.w1("P"); },
  });
  K.defineChip({
    type: "XTAL", name: "Crystal", category: "Clock", isCrystal: true, noFloatWarn: true,
    pins: [{ name: "X1", kind: "xtal", side: "L", slot: 0 }, { name: "X2", kind: "xtal", side: "R", slot: 0 }],
    grid: { w: 3, h: 1 }, symbol: "xtal",
    props: { mhz: 14.31818 },
  });
  // Standalone can oscillator for logic-only labs (no 8284A needed).
  K.defineChip({
    type: "OSC", name: "Clock module", category: "Clock",
    pins: [{ name: "OUT", kind: "out", side: "R", slot: 0 }], grid: { w: 4, h: 2 }, symbol: "osc",
    props: { hz: 1 },
    tickHz: (comp) => 2 * comp.props.hz,
    init(state) { state.phase = 0; },
    tick(io, state) { state.phase ^= 1; io.out("OUT", state.phase); },
    evaluate(io, state) { io.out("OUT", state.phase); },
  });

  K.defineChip({
    type: "LED", name: "LED", category: "I/O",
    pins: [{ name: "A", kind: "in", side: "L", slot: 0 }, { name: "K", kind: "in", side: "R", slot: 0 }],
    grid: { w: 3, h: 1 }, symbol: "led", noFloatWarn: true,
    props: { color: "red" },
    // Lit when anode net is high and cathode net is low; rendering reads the probes.
  });
  K.defineChip({
    type: "LED8", name: "LED bar x8", category: "I/O", noFloatWarn: true,
    pins: [...K.pinRange("A", 0, 7).map((n, i) => ({ name: n, kind: "in", side: "L", slot: i })),
           { name: "K", kind: "in", side: "B", slot: 0 }],
    grid: { w: 4, h: 9 }, symbol: "led8",
  });
  K.defineChip({
    type: "SEG7", name: "7-segment (CC)", category: "I/O", noFloatWarn: true,
    pins: ["a", "b", "c", "d", "e", "f", "g", "dp"].map((n, i) => ({ name: n, kind: "in", side: "L", slot: i }))
      .concat([{ name: "CC", kind: "in", side: "B", slot: 0 }]),
    grid: { w: 6, h: 9 }, symbol: "seg7",
  });
  K.defineChip({
    type: "SW8", name: "DIP switch x8", category: "I/O", noFloatWarn: true,
    pins: K.pinRange("S", 0, 7).map((n, i) => ({ name: n, kind: "out", side: "R", slot: i })),
    grid: { w: 4, h: 8 }, symbol: "sw8",
    props: { bits: 0 },
    evaluate(io, state, props) { io.outBus(K.pinRange("S", 0, 7), props.bits & 0xFF); },
  });
  K.defineChip({
    type: "BTN", name: "Push button", category: "I/O", noFloatWarn: true,
    pins: [{ name: "B", kind: "oc", side: "R", slot: 0 }], grid: { w: 3, h: 2 }, symbol: "btn",
    props: { pressed: false },
    // Pulls low while pressed, floats when released — pair it with a PULLUP (a lesson).
    evaluate(io, state, props) { io.oc("B", props.pressed ? 0 : 1); },
  });
})(globalThis.K8086 ??= {});
