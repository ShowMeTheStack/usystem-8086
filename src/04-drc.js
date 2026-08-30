"use strict";
(function (K) {
  // Design rule check. Strict violations prevent simulation; weak ones warn but run.
  // Each finding: { msg, refs: [pinKey|compId], explain } — explain keys map to the
  // teaching blurbs in K.explains.
  K.runDrc = function (doc) {
    const { nets, byPin } = K.extractNets(doc);
    const strict = [], weak = [];
    const F = (list, msg, refs, explain) => list.push({ msg, refs: refs || [], explain });

    for (const net of nets) {
      const kinds = { pwr: [], gnd: [], out: [], ts: [], oc: [], io: [], in: [], pull: [] };
      let hasVccSym = false, hasGndSym = false, hasPullComp = false;
      for (const p of net.pins) {
        if (p.comp.type === "VCC") { hasVccSym = true; continue; }  // rail symbols are
        if (p.comp.type === "GND") { hasGndSym = true; continue; }  // not "outputs"
        if (K.chips[p.comp.type].isPull) hasPullComp = true;
        (kinds[p.pin.kind] || (kinds[p.pin.kind] = [])).push(p);
      }
      const key = (p) => K.pinKey(p.comp, p.pin.name);

      if ((hasVccSym || kinds.pwr.length) && (hasGndSym || kinds.gnd.length))
        F(strict, `Power short: VCC and GND joined on net "${net.name}"`, net.pins.map(key), "vcc-gnd-short");

      if (kinds.out.length >= 2)
        F(strict, `Two totem-pole outputs fight on net "${net.name}" (${kinds.out.map(p => p.comp.id + "." + p.pin.name).join(", ")})`,
          kinds.out.map(key), "output-contention");

      if (kinds.out.length && (hasVccSym || hasGndSym))
        F(strict, `Totem-pole output ${key(kinds.out[0])} tied directly to ${hasVccSym ? "VCC" : "GND"}`,
          kinds.out.map(key), "output-to-rail");

      if (kinds.oc.length && !kinds.out.length && !kinds.ts.length && !kinds.io.length && !hasPullComp && !hasVccSym)
        F(weak, `Open-collector net "${net.name}" has no pull-up resistor`, kinds.oc.map(key), "oc-no-pullup");
    }

    for (const comp of doc.components) {
      const def = K.chips[comp.type];
      const netOf = (name) => byPin.get(K.pinKey(comp, name));
      const isFloating = (name) => { const n = netOf(name); return !n || n.pins.length <= 1; };

      // Power pins wired to the wrong rail.
      for (const pin of def.pins) {
        const n = netOf(pin.name);
        if (!n || n.pins.length <= 1) continue;
        const onVcc = n.name === "VCC", onGnd = n.name === "GND";
        if (pin.kind === "pwr" && onGnd)
          F(strict, `${comp.id} ${pin.name} (power) is wired to GND`, [K.pinKey(comp, pin.name)], "vcc-gnd-short");
        if (pin.kind === "gnd" && onVcc)
          F(strict, `${comp.id} ${pin.name} (ground) is wired to VCC`, [K.pinKey(comp, pin.name)], "vcc-gnd-short");
      }

      for (const req of def.required || [])
        if (isFloating(req))
          F(strict, `${def.type} ${comp.id}: required pin ${req} is unconnected`, [K.pinKey(comp, req)], "required-pin");

      if (def.needsCrystal) {
        const xnet = netOf(def.needsCrystal[0]);
        const hasXtal = xnet && xnet.pins.some(p => K.chips[p.comp.type].isCrystal);
        if (!hasXtal)
          F(strict, `${def.type} ${comp.id}: no crystal on ${def.needsCrystal.join("/")}`, [comp.id], "no-crystal");
      }

      const floating = def.pins.filter(p => p.kind === "in" && !(def.required || []).includes(p.name) && isFloating(p.name));
      if (floating.length && !def.noFloatWarn)
        F(weak, `${def.type} ${comp.id}: floating input${floating.length > 1 ? "s" : ""} ${floating.map(p => p.name).join(", ")} will read as logic 1`,
          floating.map(p => K.pinKey(comp, p.name)), "floating-input");

      // a push button pulls low but floats when released — it needs a pull-up
      if (comp.type === "BTN") {
        const n = netOf("B");
        if (n && n.pins.length > 1 && !n.pins.some(p => K.chips[p.comp.type].isPull || p.comp.type === "VCC"))
          F(weak, `Button ${comp.id} has no pull-up on its net "${n.name}"`, [K.pinKey(comp, "B")], "btn-no-pullup");
      }
    }
    return { strict, weak, nets, byPin };
  };

  K.explains = {
    "vcc-gnd-short": "Connecting VCC to GND is a dead short across the power supply. On a real board this browns out the supply, overheats traces, and can destroy chips. The simulator refuses to start.",
    "output-contention": "Two totem-pole TTL outputs on one wire fight whenever they disagree: one transistor pulls the wire high while the other pulls it low, and a large current flows through both. Real chips overheat and lie about the logic level. Use tri-state or open-collector outputs (with a pull-up) to share a wire.",
    "output-to-rail": "An output tied straight to a supply rail will fight the rail whenever it drives the opposite level — effectively a short through the output stage.",
    "oc-no-pullup": "Open-collector outputs can only pull a wire low; something must pull it high when everyone lets go. Without a pull-up resistor the wire floats. TTL happens to read a floating wire as 1, but slowly and unreliably — real designs always add the resistor.",
    "required-pin": "The CPU cannot run without this signal: a processor with no clock does nothing, and one whose RESET floats starts from an undefined state.",
    "no-crystal": "The 8284A divides a crystal frequency by 3 to make the CPU clock. With no crystal there is no timebase and nothing in the system moves.",
    "floating-input": "A floating TTL input drifts to roughly 1.4–1.8 V and reads as logic 1 — but it is an antenna, and nearby switching can flip it. Fine for a quick experiment; real designs tie unused inputs high or low.",
    "partial-decode": "Only some address lines take part in chip select, so the same chip answers at many address ranges (aliasing). Classic kits did this on purpose to save a decoder — just know the ghosts are there.",
    "btn-no-pullup": "A push button only pulls the wire LOW while pressed; released, it lets the wire float. TTL happens to read a float as 1, so the circuit may seem to work — until noise flips it. Put a pull-up resistor on the net so the released state is a solid 1.",
  };
})(globalThis.K8086 ??= {});
