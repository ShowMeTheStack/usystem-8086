"use strict";
(function (K) {
  K.chips = {};           // type -> def
  K.chipCategories = [];  // ordered category names for the library panel

  // Pin kinds:
  //  i  input          o  totem-pole output (always driving)
  //  t  tri-state output    oc open-collector output
  //  io bidirectional (tri-state)   p VCC   g GND   n NC   x crystal terminal
  const KINDS = { i: "in", o: "out", t: "ts", oc: "oc", io: "io", p: "pwr", g: "gnd", n: "nc", x: "xtal" };

  function parsePin(spec, num) {
    if (typeof spec === "object") return { num, ...spec };
    const m = /^([a-z]+):(.+)$/.exec(spec);
    K.assert(m && KINDS[m[1]], "bad pin spec " + spec);
    return { num, kind: KINDS[m[1]], name: m[2] };
  }

  // dipPins: pin specs in physical pin order (1..N). Produces left column 1..N/2
  // top-to-bottom and right column N..N/2+1 top-to-bottom, like a real DIP package.
  K.defineChip = function (def) {
    K.assert(!K.chips[def.type], "duplicate chip " + def.type);
    let pins;
    if (def.dip) {
      const n = def.dip.length;
      K.assert(n % 2 === 0, def.type + ": DIP needs even pin count");
      pins = def.dip.map((s, i) => parsePin(s, i + 1));
      for (let i = 0; i < n / 2; i++) { pins[i].side = "L"; pins[i].slot = i; }
      for (let i = n / 2; i < n; i++) { pins[i].side = "R"; pins[i].slot = n - 1 - i; }
      def.grid = def.grid || { w: def.wide ? 14 : 8, h: n / 2 + 1 };
    } else {
      pins = def.pins.map((s, i) => typeof s === "object" ? { num: i + 1, ...s } : parsePin(s, i + 1));
    }
    def.pins = pins;
    def.pinIndex = {};
    pins.forEach((p, i) => { K.assert(!(p.name in def.pinIndex) || p.name === "NC", def.type + ": dup pin " + p.name); def.pinIndex[p.name] = i; });
    def.edgePins = def.edgePins || [];
    def.props = def.props || {};
    K.chips[def.type] = def;
    if (!K.chipCategories.includes(def.category)) K.chipCategories.push(def.category);
    return def;
  };

  // Helper for multi-bit pin names: pinRange("A", 0, 15) -> ["A0",...,"A15"]
  K.pinRange = (prefix, from, to) => {
    const out = [];
    const step = from <= to ? 1 : -1;
    for (let i = from; i !== to + step; i += step) out.push(prefix + i);
    return out;
  };
})(globalThis.K8086 ??= {});
