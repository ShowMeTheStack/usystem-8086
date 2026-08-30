"use strict";
(function (K) {
  // Document model:
  //  doc = { components: [{id, type, x, y, props, label}],
  //          wires: [{id, a: "compId.PIN", b: "compId.PIN", bundle}] }
  // Wires are logical pin-to-pin connections; geometry is auto-routed by the UI.
  // Special component types: VCC / GND power symbols (all instances of each join one
  // global net) and NETLABEL (same-name labels join one net).

  K.newDoc = () => ({ components: [], wires: [] });

  K.docAddComponent = function (doc, type, x, y, props) {
    const def = K.chips[type];
    K.assert(def, "unknown chip " + type);
    const comp = { id: K.uid("c"), type, x, y, props: { ...def.props, ...(props || {}) } };
    doc.components.push(comp);
    return comp;
  };

  K.docComp = (doc, id) => doc.components.find(c => c.id === id);

  K.docConnect = function (doc, a, b, bundle) {
    if (a === b) return null;
    if (doc.wires.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a))) return null;
    const w = { id: K.uid("w"), a, b };
    if (bundle) w.bundle = bundle;
    doc.wires.push(w);
    return w;
  };

  K.pinKey = (comp, pinName) => comp.id + "." + pinName;

  // Net extraction via union-find over pin endpoints.
  // Returns { nets: [{id, pins:[{comp,def,pinIdx,pin}], name}], byPin: Map(pinKey->net) }
  K.extractNets = function (doc) {
    const parent = new Map();
    const find = (x) => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
      return r;
    };
    const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
    const union = (a, b) => { add(a); add(b); parent.set(find(a), find(b)); };

    // Register every pin of every component.
    const pinInfo = new Map(); // key -> {comp, def, pinIdx, pin}
    for (const comp of doc.components) {
      const def = K.chips[comp.type];
      def.pins.forEach((pin, pinIdx) => {
        const key = K.pinKey(comp, pin.name);
        pinInfo.set(key, { comp, def, pinIdx, pin });
        add(key);
      });
    }
    for (const w of doc.wires) {
      if (pinInfo.has(w.a) && pinInfo.has(w.b)) union(w.a, w.b);
    }
    // Unify power symbols and same-name net labels.
    const rails = new Map(); // railName -> representative key
    for (const comp of doc.components) {
      let rail = null;
      if (comp.type === "VCC") rail = "VCC";
      else if (comp.type === "GND") rail = "GND";
      else if (comp.type === "NETLABEL") rail = "LBL:" + (comp.props.name || "?");
      if (rail) {
        const key = K.pinKey(comp, K.chips[comp.type].pins[0].name);
        if (rails.has(rail)) union(rails.get(rail), key);
        else rails.set(rail, key);
      }
    }

    const groups = new Map();
    for (const key of parent.keys()) {
      const root = find(key);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(pinInfo.get(key));
    }
    const nets = [];
    const byPin = new Map();
    for (const pins of groups.values()) {
      const net = { id: nets.length, pins, name: null };
      // Name the net: explicit label > power rail > a representative driver pin.
      for (const p of pins) {
        if (p.comp.type === "NETLABEL") { net.name = p.comp.props.name; break; }
        if (p.comp.type === "VCC") net.name = "VCC";
        else if (p.comp.type === "GND") net.name = "GND";
      }
      if (!net.name) {
        const drv = pins.find(p => ["out", "ts", "oc", "io"].includes(p.pin.kind)) || pins[0];
        net.name = drv ? drv.comp.id + "." + drv.pin.name : "n" + net.id;
      }
      nets.push(net);
      for (const p of pins) byPin.set(K.pinKey(p.comp, p.pin.name), net);
    }
    return { nets, byPin };
  };
})(globalThis.K8086 ??= {});
