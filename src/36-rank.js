"use strict";
(function (K) {
  // Connection-target ranking for the tabular wiring UI: given one pin of one
  // chip, order every other chip on the board by how likely it is to be the
  // thing this pin should connect to — and suggest the exact pin over there.
  //
  // Signals, strongest first:
  //   * siblings: other bits of this pin's family already wired to a chip
  //     (AD0-2 go to U3, so AD3 almost certainly does too)
  //   * name pairing: exact same name, or a known signal couple
  //     (~RD -> ~OE, ALE -> LE, CLK -> CLK, INT -> INTR, D <-> AD/Q ...)
  //   * electrical fit: an input wants a driver over there, and vice versa
  //   * an existing relationship (any wire already joins the two chips)
  //   * proximity on the canvas
  // Rails (VCC/GND/PULLUP) rank via strap knowledge, not geometry.

  const fam = (name) => {
    const m = /^(.*?)(\d+)$/.exec(name);
    return m ? { prefix: m[1], bit: +m[2] } : null;
  };

  // families that habitually connect to each other (either direction)
  const FAMILY_PAIRS = [
    ["AD", "D"], ["AD", "A"], ["A", "A"], ["D", "D"], ["Q", "D"], ["Q", "A"],
    ["AD", "AD"], ["Y", "A"], ["Y", "~CS"], ["OUT", "IR"], ["PA", "A"],
    ["PB", "A"], ["PC", "A"], ["S", "A"], ["Q", "Q"], ["B", "D"], ["PD", "PD"],
  ];
  // signal couples: pinName (or prefix before digits) -> likely partner names
  const COUPLES = {
    "CLK": ["CLK", "CLK0", "CLK1", "CLK2", "PCLK", "OSC"],
    "PCLK": ["CLK0", "CLK1", "CLK2", "CLK"],
    "RESET": ["RESET", "~RES"],
    "~RES": ["P", "B", "RESET"],
    "READY": ["READY", "RDY1", "RDY2"],
    "RDY1": ["READY"],
    "ALE": ["LE", "ALE"],
    "LE": ["ALE"],
    "~RD": ["~OE", "~RD", "~IOR"],
    "~WR": ["~WE", "~WR", "~IOW", "~LOCK"],
    "~OE": ["~RD", "~MRDC", "Y"],
    "~WE": ["~WR", "~MWTC"],
    "~MRDC": ["~OE"],
    "~MWTC": ["~WE"],
    "~IORC": ["~IOR", "~RD"],
    "~IOWC": ["~IOW", "~WR"],
    "INT": ["INTR", "IR"],
    "INTR": ["INT"],
    "~INTA": ["~INTA"],
    "IR": ["OUT", "INT", "B"],
    "~CS": ["Y"],
    "~CE": ["Y"],
    "~CS1": ["Y"],
    "CS2": ["V"],
    "X1": ["X1"], "X2": ["X2"],
    "GATE": ["V", "B", "OUT"],
    "D": ["~Q", "Q", "AD"],           // '74 feedback and latch loops
    "~BPRN": ["~BPRO", "G"],
    "~BPRO": ["~BPRN"],
    "~BUSY": ["~BUSY", "P"],
    "~AEN": ["~AEN", "~AEN1", "~AEN2", "~OE", "~G1", "~G2", "~G"],
    "~S0": ["~DEN"], "~S1": ["DT/~R"], "~S2": ["IO/~M", "M/~IO"],
    "~DEN": ["~S0"], "DT/~R": ["~S1", "DIR"], "IO/~M": ["~S2", "~G2A", "G1"],
    "M/~IO": ["~S2", "G1", "~G2A"],
    "HOLD": ["V", "G", "HRQ"], "HLDA": ["HLDA"],
    "MN/~MX": ["V", "G"], "~TEST": ["V"], "NMI": ["G"],
    "~STROBE": ["~STROBE"], "BUSY": ["BUSY"], "~ACK": ["~ACK"],
    "KCLK": ["KCLK"], "KDATA": ["KDATA"],
  };
  const STRAP_RAIL = { "MN/~MX": 1, "~TEST": 1, "NMI": 1, "INTR": 1, "HOLD": 1, "CS2": 1, "GATE0": 1, "GATE1": 1, "GATE2": 1, "~G2B": 1, "G1": 1, "~SP/~EN": 1, "~PRE": 1, "~CLR": 1, "~1PRE": 1, "~1CLR": 1, "~2PRE": 1, "~2CLR": 1 };

  const DRIVER_KINDS = ["out", "ts", "oc", "io", "pwr", "gnd"];
  const READER_KINDS = ["in", "io"];

  function coupleNames(pinName) {
    if (COUPLES[pinName]) return COUPLES[pinName];
    const f = fam(pinName);
    if (f && COUPLES[f.prefix]) return COUPLES[f.prefix];
    return [];
  }

  // score a candidate pin on the target chip for our pin; higher = better
  function pinScore(myName, myKind, theirPin, theirWired) {
    let s = 0;
    const myF = fam(myName), tF = fam(theirPin.name);
    if (theirPin.name === myName) s += 30;
    const couples = coupleNames(myName);
    // gate pins use a unit-digit prefix ("2Y", "1A"): strip it for matching
    const tBare = theirPin.name.replace(/^\d+/, "");
    if (couples.includes(theirPin.name) || (tBare && couples.includes(tBare))) s += 34;
    else if (tF && couples.includes(tF.prefix)) s += 24;
    if (myF && tF) {
      const pairOk = FAMILY_PAIRS.some(([a, b]) =>
        (a === myF.prefix && b === tF.prefix) || (b === myF.prefix && a === tF.prefix));
      if (pairOk) s += 14;
      if (pairOk && tF.bit === myF.bit) s += 16;        // AD3 -> D3, not D5
    }
    // electrical direction: inputs want drivers, outputs want readers
    if (READER_KINDS.includes(myKind) && DRIVER_KINDS.includes(theirPin.kind)) s += 6;
    if (["out", "ts", "oc"].includes(myKind) && READER_KINDS.includes(theirPin.kind)) s += 6;
    if (theirWired) s -= 4;                             // prefer free pins, gently
    return s;
  }

  // K.rankConnTargets(doc, comp, pin) ->
  //   [{ comp, score, bestPin, pinOrder: [pinName...] }] sorted best-first
  K.rankConnTargets = function (doc, comp, pin) {
    const myF = fam(pin.name);
    const wiredPins = new Set();
    for (const w of doc.wires) { wiredPins.add(w.a); wiredPins.add(w.b); }

    // sibling evidence: where do the OTHER bits of my family go?
    const siblingTo = new Map();          // compId -> count
    if (myF) {
      for (const w of doc.wires) {
        for (const [me, other] of [[w.a, w.b], [w.b, w.a]]) {
          if (!me.startsWith(comp.id + ".")) continue;
          const mf = fam(me.slice(me.indexOf(".") + 1));
          if (!mf || mf.prefix !== myF.prefix) continue;
          const oc = other.slice(0, other.indexOf("."));
          if (oc !== comp.id) siblingTo.set(oc, (siblingTo.get(oc) || 0) + 1);
        }
      }
    }
    // existing relationships: any wire between the two chips
    const related = new Set();
    for (const w of doc.wires) {
      const ca = w.a.slice(0, w.a.indexOf(".")), cb = w.b.slice(0, w.b.indexOf("."));
      if (ca === comp.id) related.add(cb);
      if (cb === comp.id) related.add(ca);
    }

    const out = [];
    for (const target of doc.components) {
      const def = K.chips[target.type];
      if (!def || !def.pins.length) continue;
      let best = -1, bestPin = null;
      const scored = [];
      for (const tp of def.pins) {
        if (target === comp && tp.name === pin.name) continue;  // not to itself
        const s = pinScore(pin.name, pin.kind, tp, wiredPins.has(target.id + "." + tp.name));
        scored.push([s, tp.name]);
        if (s > best) { best = s; bestPin = tp.name; }
      }
      scored.sort((a, b) => b[0] - a[0]);
      let score = best;
      const sib = siblingTo.get(target.id);
      if (sib) score += 60 + Math.min(sib, 8) * 10;     // the dominant signal
      if (related.has(target.id)) score += 8;
      const isRail = ["VCC", "GND", "PULLUP"].includes(target.type);
      if (isRail && STRAP_RAIL[pin.name]) score += 20;
      if (isRail && !STRAP_RAIL[pin.name] && best < 20) score -= 10;
      if (target === comp) score -= 6;                  // self-wiring is rare
      // proximity: nearby chips edge out distant ties
      const dx = (target.x || 0) - (comp.x || 0), dy = (target.y || 0) - (comp.y || 0);
      score += Math.max(0, 12 - Math.hypot(dx, dy) * 0.12);
      out.push({ comp: target, score, bestPin, pinOrder: scored.map(x => x[1]) });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  };
})(globalThis.K8086 ??= {});
