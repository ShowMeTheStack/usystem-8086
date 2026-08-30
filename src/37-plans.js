"use strict";
(function (K) {
  // The autoconnect PLANNER: order-independent, state-driven offers.
  // After any placement: K.connPlans(doc, placed) enumerates every design
  // that is completable RIGHT NOW involving that chip — as the subject, or
  // as the missing piece something else was waiting for. Helper ICs (gates,
  // latches, decoders, rails…) are ingredients of plans, never subjects:
  // they stay silent. Every FUNCTIONAL chip yields offers, creating cheap
  // counterparts freely (a monitor for a video card, the keyboard chain, a
  // timer for the speaker). Zero plans = whisper only. With several CPUs the
  // chooser is pick-one per card, plus a single "one per CPU" card that
  // replicates the hookup everywhere. One accepted plan = one undo step.

  const pk = K.pinKey;

  // gates/latches/decoders/rails/clock parts are never plan subjects
  K.connIsHelper = function (type) {
    const def = K.chips[type];
    if (!def) return true;
    if (def.isCpu) return false;
    if (["Logic", "Power", "Clock"].includes(def.category)) return true;
    return ["BTN", "LED"].includes(type);
  };

  // chips that hook onto a CPU bus via the standard card/periph recipes
  const BUSDEV = ["8253", "8254", "8255", "8259A", "COM8250", "LPT378", "8237A", "UPD765", "XTIDE", "HGC"];
  const PRINTER_PAIRS = [["PD0", "PD0"], ["PD1", "PD1"], ["PD2", "PD2"], ["PD3", "PD3"], ["PD4", "PD4"],
    ["PD5", "PD5"], ["PD6", "PD6"], ["PD7", "PD7"], ["~STROBE", "~STROBE"], ["BUSY", "BUSY"],
    ["~ACK", "~ACK"], ["PE", "PE"], ["SLCT", "SLCT"], ["~ERROR", "~ERROR"]];

  function netsOf(doc) { return K.extractNets(doc).byPin; }
  function isWired(byPin, comp, pin) {
    const n = byPin.get(pk(comp, pin));
    return !!n && n.pins.length > 1;
  }
  const ref = (c) => c.props.ref || c.id;
  const byType = (doc, t) => doc.components.filter(c => c.type === t);
  const cpus = (doc) => doc.components.filter(c => K.chips[c.type].isCpu);

  function unclockedCpus(doc, byPin) {
    return cpus(doc).filter(c => !isWired(byPin, c, "CLK"));
  }
  function clockLoadOf(doc, byPin, cg) {
    // which CPUs does this 8284 already drive?
    const n = byPin.get(pk(cg, "CLK"));
    if (!n) return [];
    return n.pins.filter(p => K.chips[p.comp.type].isCpu).map(p => p.comp);
  }
  function strappedMax(doc, byPin, cpu) {
    const n = byPin.get(pk(cpu, "MN/~MX"));
    return !!n && n.pins.some(p => p.comp.type === "GND");
  }
  function has8288For(doc, byPin, cpu) {
    return byType(doc, "8288").some(ctl => {
      const a = byPin.get(pk(ctl, "~S0")), b = byPin.get(pk(cpu, "~DEN"));
      return a && a === b;
    });
  }
  function hasArbFor(doc, byPin, cpu) {
    return byType(doc, "8289").some(arb => {
      const a = byPin.get(pk(arb, "~S0")), b = byPin.get(pk(cpu, "~DEN"));
      return a && a === b;
    });
  }

  // ---- wiring routines (each is ONE plan execution = one undo step) --------
  // clock a CPU from a chosen 8284, in minimum or maximum mode
  function clockCpu(doc, cpu, cg, mode) {
    const A = K._acKit;
    const ctx = A.makeCtx(doc, cpu, null);
    const W = (a, b) => ctx.WifFree(a, b);
    W(pk(cg, "CLK"), pk(cpu, "CLK"));
    W(pk(cg, "RESET"), pk(cpu, "RESET"));
    W(pk(cg, "READY"), pk(cpu, "READY"));
    W(A.vccPin(ctx), pk(cpu, "~TEST"));
    W(A.gndPin(ctx), pk(cpu, "NMI"));
    W(A.gndPin(ctx), pk(cpu, "INTR"));
    if (!ctx.netOf(pk(cg, "X1"))) {
      const xt = ctx.find(c => c.type === "XTAL" && !ctx.wired(pk(c, "X1"))) || ctx.add("XTAL", { mhz: 14.31818 });
      ctx.W(pk(xt, "X1"), pk(cg, "X1"));
      ctx.W(pk(xt, "X2"), pk(cg, "X2"));
    }
    if (!ctx.netOf(pk(cg, "~RES"))) {
      ctx.W(A.railPin(ctx, "PULLUP", "P"), pk(cg, "~RES"));
      const btn = ctx.find(c => c.type === "BTN" && !ctx.wired(pk(c, "B")));
      if (btn) ctx.W(pk(btn, "B"), pk(cg, "~RES"));
    }
    if (mode === "max") {
      W(A.gndPin(ctx), pk(cpu, "MN/~MX"));
      W(A.vccPin(ctx), pk(cpu, "HOLD"));
      const ctl = ctx.add("8288");
      ctx.W(pk(cg, "CLK"), pk(ctl, "CLK"));
      const is86 = cpu.type === "8086";
      for (const [pin, sig] of [["~DEN", "~S0"], ["DT/~R", "~S1"], [is86 ? "M/~IO" : "IO/~M", "~S2"]])
        ctx.W(pk(cpu, pin), pk(ctl, sig));
      ctx.W(A.vccPin(ctx), pk(ctl, "CEN"));
      ctx.W(A.gndPin(ctx), pk(ctl, "IOB"));
      ctx.note(`maximum mode: added ${ref(ctl)} (8288) — memory/IO strobes come from its command pins`);
    } else {
      W(A.vccPin(ctx), pk(cpu, "MN/~MX"));
      W(A.gndPin(ctx), pk(cpu, "HOLD"));
    }
    return ctx;
  }

  function cascadeSlave(doc, slave, master, cpu) {
    K.autoconnect(doc, slave, cpu);                 // bus + a free IO window
    // strap as slave + cascade bus (the pic-cascade preset idiom)
    doc.wires = doc.wires.filter(w => ![w.a, w.b].includes(pk(slave, "~SP/~EN")));
    const A = K._acKit;
    const ctx = A.makeCtx(doc, slave, cpu);
    ctx.W(A.gndPin(ctx), pk(slave, "~SP/~EN"));
    ctx.WifFree(pk(slave, "INT"), pk(master, "IR2"));
    for (const c of ["CAS0", "CAS1", "CAS2"]) ctx.W(pk(master, c), pk(slave, c));
  }

  // the XT keyboard chain: keyboard -> shift register -> 8255 port A (+ IR1).
  // Creates the shift register and/or the 8255 (bus-wired) when missing.
  function kbdChain(d, cpuId, kbdId, shId) {
    const A = K._acKit;
    const cpu = cpuId ? K.docComp(d, cpuId) : null;
    const kbd = kbdId ? K.docComp(d, kbdId)
      : d.components.find(c => c.type === "XTKBD");
    let sh = shId ? K.docComp(d, shId) : null;
    const anchorNotes = [];
    const ctx = A.makeCtx(d, sh || kbd || cpu, cpu);
    if (!sh) { sh = ctx.add("KBDSHIFT"); anchorNotes.push(`added ${ref(sh)} — scancodes clock in bit by bit`); }
    let ppi = d.components.find(c => c.type === "8255" && ctx.same(pk(sh, "Q0"), pk(c, "PA0")))  // already serving this register
      || d.components.find(c => c.type === "8255" && !ctx.wired(pk(c, "PA0")) && !ctx.wired(pk(c, "PA7")));
    if (!ppi && cpu) {
      ppi = ctx.add("8255");
      const r = K.autoconnect(d, ppi, cpu);
      ctx.refresh();
      anchorNotes.push(`added ${ref(ppi)} on ${ref(cpu)}'s IO bus as the keyboard port`);
      if (r) anchorNotes.push(...r.notes.filter(n => /ports/.test(n)));
    }
    if (kbd) {
      ctx.WifFree(pk(kbd, "KDATA"), pk(sh, "SER"));
      ctx.WifFree(pk(kbd, "KCLK"), pk(sh, "CLK"));
    }
    if (ppi) {
      for (let i = 0; i < 8; i++) ctx.WifFree(pk(sh, "Q" + i), pk(ppi, "PA" + i), "ka");
      ctx.WifFree(pk(ppi, "PB7"), pk(sh, "CLR"));
      if (kbd) ctx.WifFree(pk(ppi, "PB6"), pk(kbd, "RST"));
    }
    const pic = d.components.find(c => c.type === "8259A" && ctx.wired(pk(c, "~INTA")));
    if (pic) {
      ctx.WifFree(pk(sh, "FULL"), pk(pic, "IR1"));
      ctx.note(`FULL raises ${ref(pic)}'s IR1 — the PC keyboard interrupt`);
    } else ctx.note("wire FULL to a PIC IR line for interrupts (IR1 on a PC)");
    ctx.notes.unshift(...anchorNotes);
    return ctx;
  }

  // 8289 bus arbiter alongside a max-mode CPU (the multiprocessor idiom)
  function serveArb(d, arb, cpu) {
    const A = K._acKit;
    const ctx = A.makeCtx(d, arb, null);
    const cg = ctx.find(c => c.type === "8284A" && ctx.same(pk(c, "CLK"), pk(cpu, "CLK")));
    const ctl = ctx.find(c => c.type === "8288" && ctx.same(pk(c, "~S0"), pk(cpu, "~DEN")));
    if (cg) ctx.WifFree(pk(cg, "CLK"), pk(arb, "CLK"));
    const is86 = cpu.type === "8086";
    for (const [pin, sig] of [["~DEN", "~S0"], ["DT/~R", "~S1"], [is86 ? "M/~IO" : "IO/~M", "~S2"]])
      ctx.WifFree(pk(cpu, pin), pk(arb, sig));
    if (ctl) ctx.WifFree(pk(arb, "~AEN"), pk(ctl, "~AEN"));
    if (cg) ctx.WifFree(pk(arb, "~AEN"), pk(cg, "~AEN1"));
    ctx.WifFree(pk(cpu, "~WR"), pk(arb, "~LOCK"));   // ~LOCK in max mode: atomic XCHG
    ctx.W(A.gndPin(ctx), pk(arb, "~BPRN"));
    let pu = ctx.find(c => c.type === "PULLUP" && !ctx.wired(pk(c, "P")));
    if (!pu) pu = ctx.add("PULLUP");
    ctx.WifFree(pk(pu, "P"), pk(arb, "~BUSY"));
    ctx.note("bus granted by default (~BPRN low) — daisy-chain a second 8289's ~BPRN from ~BPRO to share the bus");
    return ctx;
  }

  // preview what autoconnect WOULD do, without touching the board
  function dryNotes(doc, comp, cpu) {
    try {
      const clone = structuredClone(doc);
      const c2 = K.docComp(clone, comp.id);
      const p2 = cpu ? K.docComp(clone, cpu.id) : null;
      const r = K.autoconnect(clone, c2, p2);
      return r && r.notes.length ? r.notes.join(" · ") : "standard hookup";
    } catch { return "standard hookup"; }
  }

  // merge notes from an autoconnect result + a follow-on ctx
  const mergeNotes = (...parts) => ({ notes: parts.flatMap(p => (p && p.notes) || []) });

  // ---- the planner ----------------------------------------------------------
  // returns { cards: [{title, desc, run(doc)|action}], checklist: null|{...} }
  K.connPlans = function (doc, comp) {
    const type = comp.type;
    const def = K.chips[type];
    const byPin = netsOf(doc);
    const cards = [];
    const cpuList = cpus(doc);

    // ------ a CPU was placed: clock sources × mode --------------------------
    if (def.isCpu) {
      if (!isWired(byPin, comp, "CLK")) {
        for (const cg of byType(doc, "8284A")) {
          const load = clockLoadOf(doc, byPin, cg);
          const share = load.length ? ` (shares ${load.map(ref).join(", ")}'s clock)` : "";
          cards.push({
            title: `Clock from ${ref(cg)} — minimum mode${share}`,
            desc: "Crystal, CLK/RESET/READY, straps for simple direct bus signals — classic kit style.",
            run: (d) => clockCpu(d, K.docComp(d, comp.id), K.docComp(d, cg.id), "min"),
          });
          cards.push({
            title: `Clock from ${ref(cg)} — maximum mode${share}`,
            desc: "Adds an 8288 bus controller and straps MN/~MX low — the IBM PC way; needed for multi-CPU buses.",
            run: (d) => clockCpu(d, K.docComp(d, comp.id), K.docComp(d, cg.id), "max"),
          });
        }
      }
      return { cards, checklist: null };
    }

    // ------ an 8284A was placed: checklist of unclocked CPUs ----------------
    if (type === "8284A") {
      const targets = unclockedCpus(doc, byPin);
      if (!targets.length) return { cards, checklist: null };
      return {
        cards,
        checklist: {
          title: `Clock CPUs from ${ref(comp)}?`,
          intro: "Tick the CPUs to wire to this clock generator (crystal and reset circuit are created if missing).",
          rows: targets.map(c => ({ compId: c.id, label: `${ref(c)} (${c.type})`, modes: true })),
          run: (d, selection) => {
            const cg = K.docComp(d, comp.id);
            for (const s of selection) clockCpu(d, K.docComp(d, s.compId), cg, s.mode);
          },
        },
      };
    }

    // ------ an 8288 was placed: serve a max-strapped CPU --------------------
    if (type === "8288") {
      for (const cpu of cpuList)
        if (strappedMax(doc, byPin, cpu) && !has8288For(doc, byPin, cpu))
          cards.push({
            title: `Serve ${ref(cpu)} as its bus controller`,
            desc: "Wires CLK and the ~S2..~S0 status lines; command strobes replace the min-mode signals.",
            run: (d) => {
              const A = K._acKit;
              const ctx = A.makeCtx(d, K.docComp(d, comp.id), null);
              const c2 = K.docComp(d, cpu.id), ctl = K.docComp(d, comp.id);
              const cg = byType(d, "8284A")[0];
              if (cg) ctx.WifFree(pk(cg, "CLK"), pk(ctl, "CLK"));
              const is86 = c2.type === "8086";
              for (const [pin, sig] of [["~DEN", "~S0"], ["DT/~R", "~S1"], [is86 ? "M/~IO" : "IO/~M", "~S2"]])
                ctx.W(pk(c2, pin), pk(ctl, sig));
              ctx.W(A.vccPin(ctx), pk(ctl, "CEN"));
              ctx.W(A.gndPin(ctx), pk(ctl, "IOB"));
              return ctx;
            },
          });
      return { cards, checklist: null };
    }

    // ------ an 8289 was placed: arbitrate a max-mode CPU's bus --------------
    if (type === "8289") {
      for (const cpu of cpuList)
        if (strappedMax(doc, byPin, cpu) && has8288For(doc, byPin, cpu) && !hasArbFor(doc, byPin, cpu))
          cards.push({
            title: `Arbitrate ${ref(cpu)}'s system bus`,
            desc: "CLK + status into the arbiter; ~AEN gates the 8288 and the 8284's ready line — Multibus style, pair with a second 8289 to share one bus.",
            run: (d) => serveArb(d, K.docComp(d, comp.id), K.docComp(d, cpu.id)),
          });
      return { cards, checklist: null };
    }

    // ---- shared: per-CPU cards + the "one per CPU" replication card --------
    const onePerCpuCard = () => ({
      title: `One ${def.name} per CPU — this one to ${ref(cpuList[0])}, ${cpuList.length - 1} more added`,
      desc: "The same hookup replicated on every CPU's bus; all of it is one undo step.",
      run: (d) => {
        const parts = [K.autoconnect(d, K.docComp(d, comp.id), K.docComp(d, cpuList[0].id))];
        for (const c of cpuList.slice(1)) {
          const cc = K.docComp(d, c.id);
          const copy = K.docAddComponent(d, type, cc.x, cc.y + K.chips[cc.type].grid.h + 3);
          const r = K.autoconnect(d, copy, cc);
          parts.push({ notes: r ? [`${ref(copy)} for ${ref(cc)}: ` + r.notes.join(", ")] : [] });
        }
        return mergeNotes(...parts);
      },
    });

    // ------ memory: per-CPU hookup, or exact placement ----------------------
    if (def.category === "Memory") {
      for (const cpu of cpuList) {
        cards.push({
          title: `Wire to ${ref(cpu)} (${cpu.type})`,
          desc: dryNotes(doc, comp, cpu),
          run: (d) => K.autoconnect(d, K.docComp(d, comp.id), K.docComp(d, cpu.id)),
        });
        cards.push({
          title: `Exact address range on ${ref(cpu)}…`,
          desc: "Pick the base address; a precise decoder is synthesized and proved against the netlist.",
          action: { rangeCalc: true, cpuId: cpu.id },
        });
      }
      if (cpuList.length > 1) cards.push(onePerCpuCard());
      return { cards, checklist: null };
    }

    // ------ bus devices: per-CPU, plus type-specific variants ---------------
    if (BUSDEV.includes(type)) {
      for (const cpu of cpuList) {
        cards.push({
          title: `Wire to ${ref(cpu)} (${cpu.type})`,
          desc: dryNotes(doc, comp, cpu),
          run: (d) => K.autoconnect(d, K.docComp(d, comp.id), K.docComp(d, cpu.id)),
        });
        if (type === "HGC" && !byType(doc, "CRT").some(c => !isWired(byPin, c, "VIDEO")))
          cards.push({
            title: `Wire to ${ref(cpu)} + add a CRT monitor`,
            desc: "Full bus hookup, and a monochrome monitor created and cabled to the card.",
            run: (d) => {
              const ctx = K._acKit.makeCtx(d, K.docComp(d, comp.id), null);
              const crt = ctx.add("CRT");
              const r = K.autoconnect(d, K.docComp(d, comp.id), K.docComp(d, cpu.id));
              return mergeNotes(r, { notes: [`added ${ref(crt)}`] });
            },
          });
        if (type === "UPD765")
          cards.push({
            title: `Wire to ${ref(cpu)} + insert the FreeDOS floppy`,
            desc: "Same hookup, with the FreeDOS 1.3 install disk already in drive A: when the sim starts.",
            run: (d) => {
              const r = K.autoconnect(d, K.docComp(d, comp.id), K.docComp(d, cpu.id));
              K.docComp(d, comp.id).props.imageAsset = "freedos144";
              return mergeNotes(r, { notes: ["FreeDOS 1.3 floppy in the drive"] });
            },
          });
        if (type === "8259A") {
          const master = byType(doc, "8259A").find(p => p !== comp && isWired(byPin, p, "~INTA"));
          if (master) cards.push({
            title: `Cascade as SLAVE under ${ref(master)}`,
            desc: "Straps ~SP/~EN low, INT onto the master's IR2, CAS bus wired — 15 usable interrupt lines.",
            run: (d) => cascadeSlave(d, K.docComp(d, comp.id), K.docComp(d, master.id), K.docComp(d, cpu.id)),
          });
        }
      }
      if (cpuList.length > 1) cards.push(onePerCpuCard());
      return { cards, checklist: null };
    }

    // ------ the keyboard shift register: complete the chain -----------------
    if (type === "KBDSHIFT") {
      const kbd = byType(doc, "XTKBD").find(k => !isWired(byPin, k, "KCLK")) || null;
      const havePpi = byType(doc, "8255").some(p => !isWired(byPin, p, "PA0") && !isWired(byPin, p, "PA7"));
      if (kbd || havePpi || cpuList.length)
        for (const cpu of cpuList.length ? cpuList : [null]) {
          cards.push({
            title: cpu ? `Keyboard port on ${ref(cpu)}` : "Complete the keyboard chain",
            desc: "Keyboard serial line in, latched byte onto an 8255 port A (created and bus-wired if missing), FULL to the PIC's IR1.",
            run: (d) => kbdChain(d, cpu && cpu.id, kbd && kbd.id, comp.id),
          });
          if (!cpu) break;
        }
      return { cards, checklist: null };
    }

    // ------ end devices: cable to a partner, or create the partner ----------
    const straight = (pairs, aComp, bComp) => (d) => {
      const A = K._acKit;
      const ctx = A.makeCtx(d, K.docComp(d, aComp.id), null);
      for (const [pa, pb] of pairs) ctx.WifFree(pk(K.docComp(d, aComp.id), pa), pk(K.docComp(d, bComp.id), pb));
      return ctx;
    };
    if (type === "PRINTER") {
      for (const lpt of byType(doc, "LPT378"))
        if (!isWired(byPin, lpt, "~STROBE") || !isWired(byPin, comp, "~STROBE"))
          cards.push({
            title: `Cable to ${ref(lpt)} (LPT1 adapter)`,
            desc: "Data lines plus the STROBE/BUSY/ACK Centronics handshake.",
            run: straight(PRINTER_PAIRS, comp, lpt),
          });
      if (!cards.length)
        for (const cpu of cpuList)
          cards.push({
            title: `Add an LPT1 adapter on ${ref(cpu)} and cable the printer`,
            desc: "An LPT378 card is created and bus-wired at 378h; data + handshake cabled through.",
            run: (d) => {
              const ctx = K._acKit.makeCtx(d, K.docComp(d, comp.id), null);
              const lpt = ctx.add("LPT378");
              return mergeNotes(K.autoconnect(d, lpt, K.docComp(d, cpu.id)));
            },
          });
    }
    if (type === "CRT") {
      for (const hgc of byType(doc, "HGC"))
        if (!isWired(byPin, comp, "VIDEO"))
          cards.push({
            title: `Connect to ${ref(hgc)} (Hercules card)`,
            desc: "HSYNC, VSYNC and VIDEO — the monitor lights up when the card scans.",
            run: straight([["HSYNC", "HSYNC"], ["VSYNC", "VSYNC"], ["VIDEO", "VIDEO"]], comp, hgc),
          });
      if (!cards.length && !isWired(byPin, comp, "VIDEO"))
        for (const cpu of cpuList)
          cards.push({
            title: `Add a Hercules card on ${ref(cpu)} and cable this monitor`,
            desc: "An HGC is created and wired onto the full bus (VRAM at B0000h); sync + video cabled here.",
            run: (d) => {
              const ctx = K._acKit.makeCtx(d, K.docComp(d, comp.id), null);
              const hgc = ctx.add("HGC");
              return mergeNotes(K.autoconnect(d, hgc, K.docComp(d, cpu.id)));
            },
          });
    }
    if (type === "XTKBD") {
      for (const sh of byType(doc, "KBDSHIFT"))
        if (!isWired(byPin, sh, "SER"))
          cards.push({
            title: `Serial line to ${ref(sh)} (shift register)`,
            desc: "KDATA→SER, KCLK→CLK — scancodes clock in bit by bit; wire FULL to an IRQ yourself.",
            run: straight([["KDATA", "SER"], ["KCLK", "CLK"]], comp, sh),
          });
      if (!cards.length)
        for (const cpu of cpuList)
          cards.push({
            title: `Full keyboard chain on ${ref(cpu)}`,
            desc: "Shift register created for the serial line, an 8255 port A to read it (created and bus-wired if missing), FULL to the PIC's IR1.",
            run: (d) => kbdChain(d, cpu.id, comp.id, null),
          });
    }
    if (type === "SPKR") {
      const pits = [...byType(doc, "8253"), ...byType(doc, "8254")];
      for (const pit of pits) {
        cards.push({
          title: `Drive from ${ref(pit)} OUT0`,
          desc: "The timer's square wave straight into the cone — program mode 3 and play.",
          run: (d) => {
            const ctx = straight([["IN", "OUT0"]], comp, pit)(d);
            ctx.WifFree(K._acKit.gndPin(ctx), pk(K.docComp(d, comp.id), "GND"));
            return ctx;
          },
        });
        const ppi = byType(doc, "8255")[0];
        if (ppi) cards.push({
          title: `XT-style: ${ref(pit)} OUT2 gated by ${ref(ppi)} PB1`,
          desc: "AND gate ('08, created) mixes the timer with the software gate — exactly the PC speaker circuit.",
          run: (d) => {
            const A = K._acKit;
            const ctx = A.makeCtx(d, K.docComp(d, comp.id), null);
            const g = A.freeGate2(ctx, "74LS08");
            ctx.W(pk(K.docComp(d, pit.id), "OUT2"), g.a);
            ctx.W(pk(K.docComp(d, ppi.id), "PB1"), g.b);
            ctx.W(g.y, pk(K.docComp(d, comp.id), "IN"));
            ctx.WifFree(pk(K.docComp(d, ppi.id), "PB0"), pk(K.docComp(d, pit.id), "GATE2"));
            ctx.WifFree(A.gndPin(ctx), pk(K.docComp(d, comp.id), "GND"));
            return ctx;
          },
        });
      }
      if (!pits.length)
        for (const cpu of cpuList)
          cards.push({
            title: `Add an 8253 timer on ${ref(cpu)} and drive the speaker`,
            desc: "A timer is created and bus-wired; its OUT0 square wave goes straight into the cone.",
            run: (d) => {
              const A = K._acKit;
              const ctx = A.makeCtx(d, K.docComp(d, comp.id), null);
              const pit = ctx.add("8253");
              const r = K.autoconnect(d, pit, K.docComp(d, cpu.id));
              ctx.refresh();
              ctx.WifFree(pk(pit, "OUT0"), pk(K.docComp(d, comp.id), "IN"));
              ctx.WifFree(A.gndPin(ctx), pk(K.docComp(d, comp.id), "GND"));
              return mergeNotes(r, ctx);
            },
          });
    }
    if (type === "LED8" || type === "SEG7") {
      const pins = type === "LED8" ? ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]
        : ["a", "b", "c", "d", "e", "f", "g", "dp"];
      const wirePins = (ctx, d, srcComp, srcPins) => {
        const c2 = K.docComp(d, comp.id);
        pins.forEach((p, i) => ctx.W(pk(srcComp, srcPins + i), pk(c2, p)));
        ctx.W(K._acKit.gndPin(ctx), pk(c2, type === "LED8" ? "K" : "CC"));
      };
      for (const lat of byType(doc, "74LS373")) {
        const free = ["Q0", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"].every(q => !isWired(byPin, lat, q));
        if (free && isWired(byPin, lat, "LE"))
          cards.push({
            title: `Show ${ref(lat)}'s latched outputs`,
            desc: "Q0-7 onto the display" + (type === "SEG7" ? " segments (software segment table decides the digits)" : "") + "; cathode to GND.",
            run: (d) => {
              const ctx = K._acKit.makeCtx(d, K.docComp(d, comp.id), null);
              wirePins(ctx, d, K.docComp(d, lat.id), "Q");
              return ctx;
            },
          });
      }
      const ppi = byType(doc, "8255").find(p => ["PA0", "PA1"].every(q => !isWired(byPin, p, q)));
      if (ppi) cards.push({
        title: `On ${ref(ppi)} port A`,
        desc: "PA0-7 drive the display directly — OUT to the PPI's port A lights it.",
        run: (d) => {
          const ctx = K._acKit.makeCtx(d, K.docComp(d, comp.id), null);
          wirePins(ctx, d, K.docComp(d, ppi.id), "PA");
          return ctx;
        },
      });
      if (!cards.length)
        for (const cpu of cpuList)
          cards.push({
            title: `Add an 8255 on ${ref(cpu)}, show on its port A`,
            desc: "A PPI is created and bus-wired; OUT to its port A lights the display.",
            run: (d) => {
              const ctx = K._acKit.makeCtx(d, K.docComp(d, comp.id), null);
              const p = ctx.add("8255");
              const r = K.autoconnect(d, p, K.docComp(d, cpu.id));
              ctx.refresh();
              wirePins(ctx, d, p, "PA");
              return mergeNotes(r, ctx);
            },
          });
    }
    if (type === "SW8") {
      const wireSw = (ctx, d, p) => {
        const c2 = K.docComp(d, comp.id);
        for (let i = 0; i < 8; i++) ctx.W(pk(c2, "S" + i), pk(p, "PB" + i));
      };
      const ppi = byType(doc, "8255").find(p => ["PB0", "PB1"].every(q => !isWired(byPin, p, q)));
      if (ppi) cards.push({
        title: `Read on ${ref(ppi)} port B`,
        desc: "S0-7 to PB0-7 — program the 8255 with port B as input, then IN reads the switches.",
        run: (d) => {
          const ctx = K._acKit.makeCtx(d, K.docComp(d, comp.id), null);
          wireSw(ctx, d, K.docComp(d, ppi.id));
          return ctx;
        },
      });
      else for (const cpu of cpuList)
        cards.push({
          title: `Add an 8255 on ${ref(cpu)}, read on its port B`,
          desc: "A PPI is created and bus-wired; IN from its port B reads the switches.",
          run: (d) => {
            const ctx = K._acKit.makeCtx(d, K.docComp(d, comp.id), null);
            const p = ctx.add("8255");
            const r = K.autoconnect(d, p, K.docComp(d, cpu.id));
            ctx.refresh();
            wireSw(ctx, d, p);
            return mergeNotes(r, ctx);
          },
        });
    }
    return { cards, checklist: null };
  };

  // ---- the board-wide checkpoint sweep -------------------------------------
  // Every functional chip that is still unhooked, with its full plan list,
  // in dependency order (system chips before memory before cards before end
  // devices) so cross-chip pickups land: the FDC wired AFTER the PIC finds
  // IR6 free and takes it. Plans re-read the live board at run() time, so
  // executing the rows top-to-bottom is what makes the batch coherent.
  const HOOK = { CRT: "VIDEO", SPKR: "IN", LED8: "A0", SEG7: "a", SW8: "S0", XTKBD: "KCLK",
    KBDSHIFT: "SER", PRINTER: "~STROBE", "8288": "~S0", "8289": "~S0" };
  const hookPinOf = (c) => K.chips[c.type].isCpu ? "CLK" : (HOOK[c.type] || "D0");
  const SWEEP_RANK = (c) => {
    const t = c.type, def = K.chips[t];
    if (def.isCpu) return 0;
    if (t === "8288" || t === "8289") return 1;
    if (["8259A", "8237A", "8255", "8253", "8254"].includes(t)) return 2;
    if (def.category === "Memory") return 3;
    if (["HGC", "COM8250", "LPT378", "UPD765", "XTIDE", "KBDSHIFT"].includes(t)) return 4;
    return 5;                                       // end devices last
  };

  // -> [{comp, plans:[card…]}], empty when nothing on the board is completable
  K.connSweep = function (doc, excludeId) {
    const byPin = netsOf(doc);
    const out = [];
    // device hookups wait for a CLOCKED cpu: strobes/mode depend on its straps,
    // so the big checkpoint is the moment a CPU comes alive
    const ready = doc.components.some(c => K.chips[c.type].isCpu && isWired(byPin, c, "CLK"));
    for (const c of doc.components) {
      if (c.id === excludeId || K.connIsHelper(c.type)) continue;
      if (c.type === "8284A") continue;              // clocking shows up as the CPUs' own plans
      if (!K.chips[c.type].isCpu && !ready) continue;
      if (isWired(byPin, c, hookPinOf(c))) continue; // already hooked up
      const { cards } = K.connPlans(doc, c);
      const plans = cards.filter(k => !k.action);    // range-calc opens its own modal; not batchable
      if (plans.length) out.push({ comp: c, plans });
    }
    out.sort((a, b) => SWEEP_RANK(a.comp) - SWEEP_RANK(b.comp));
    return out;
  };

  // ---- repairs: dry-run diff over the standard recipes ---------------------
  // A chip that LOOKS hooked (hook pin wired) may still be damaged — a lane
  // snipped out of a bus, a strobe deleted, a glue chip removed. Instead of
  // hand-kept pin checklists, we clone the board, re-run the chip's own
  // hookup routine on the clone (everything goes through WifFree, which only
  // fills holes), and diff: the wires the dry run adds ARE the missing
  // connections. Zero added wires = intact. The heuristic for "accidental":
  // a missing pin whose numbered family (D0-D7, A0-A19, Q0-Q7…) is still
  // partially wired — nobody wants 7/8ths of a bus.
  function pairRepair(d, aId, bId, pairs) {
    const A = K._acKit;
    const a = K.docComp(d, aId), b = K.docComp(d, bId);
    const ctx = A.makeCtx(d, a, null);
    for (const [pa, pb] of pairs) ctx.WifFree(pk(a, pa), pk(b, pb));
    return ctx;
  }
  function partnerVia(doc, byPin, comp, myToTheirs, type) {
    for (const cand of byType(doc, type))
      for (const [mp, cp] of myToTheirs) {
        const n = byPin.get(pk(comp, mp));
        if (n && n.pins.length > 1 && n === byPin.get(pk(cand, cp))) return cand;
      }
    return null;
  }

  function repairActionFor(doc, byPin, comp) {
    const t = comp.type, def = K.chips[t];
    const clocked = cpus(doc).filter(c => isWired(byPin, c, "CLK"));
    if (def.isCpu)
      return byType(doc, "8284A").length
        ? { run: (d) => K.autoconnect(d, K.docComp(d, comp.id), null) } : null;
    if (def.category === "Memory" || BUSDEV.includes(t)) {
      const att = cpus(doc).find(c => {
        const n = byPin.get(pk(c, "AD0"));
        return n && n === byPin.get(pk(comp, "D0"));
      }) || clocked[0];
      return att ? { run: (d) => K.autoconnect(d, K.docComp(d, comp.id), K.docComp(d, att.id)) } : null;
    }
    if (t === "CRT") {
      const hgc = partnerVia(doc, byPin, comp, [["VIDEO", "VIDEO"], ["HSYNC", "HSYNC"], ["VSYNC", "VSYNC"]], "HGC");
      return hgc ? { run: (d) => pairRepair(d, comp.id, hgc.id, [["HSYNC", "HSYNC"], ["VSYNC", "VSYNC"], ["VIDEO", "VIDEO"]]) } : null;
    }
    if (t === "PRINTER") {
      const lpt = partnerVia(doc, byPin, comp, [["~STROBE", "~STROBE"], ["PD0", "PD0"], ["BUSY", "BUSY"]], "LPT378");
      return lpt ? { run: (d) => pairRepair(d, comp.id, lpt.id, PRINTER_PAIRS) } : null;
    }
    if (t === "XTKBD") {
      const sh = partnerVia(doc, byPin, comp, [["KDATA", "SER"], ["KCLK", "CLK"]], "KBDSHIFT");
      return sh ? { run: (d) => pairRepair(d, comp.id, sh.id, [["KDATA", "SER"], ["KCLK", "CLK"]]) } : null;
    }
    if (t === "KBDSHIFT") {
      const qPairs = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ["Q" + i, "PA" + i]);
      const ppi = partnerVia(doc, byPin, comp, qPairs, "8255");
      const kbd = partnerVia(doc, byPin, comp, [["SER", "KDATA"], ["CLK", "KCLK"]], "XTKBD");
      if (!ppi && !kbd) return null;
      return { run: (d) => {
        const ctx = K._acKit.makeCtx(d, K.docComp(d, comp.id), null);
        const sh2 = K.docComp(d, comp.id);
        if (kbd) {
          const k2 = K.docComp(d, kbd.id);
          ctx.WifFree(pk(k2, "KDATA"), pk(sh2, "SER"));
          ctx.WifFree(pk(k2, "KCLK"), pk(sh2, "CLK"));
        }
        if (ppi) {
          const p2 = K.docComp(d, ppi.id);
          for (let i = 0; i < 8; i++) ctx.WifFree(pk(sh2, "Q" + i), pk(p2, "PA" + i), "ka");
          ctx.WifFree(pk(p2, "PB7"), pk(sh2, "CLR"));
          if (kbd) ctx.WifFree(pk(p2, "PB6"), pk(K.docComp(d, kbd.id), "RST"));
        }
        return ctx;
      } };
    }
    if (t === "LED8" || t === "SEG7" || t === "SW8") {
      const disp = t === "LED8" ? ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]
        : t === "SEG7" ? ["a", "b", "c", "d", "e", "f", "g", "dp"]
        : ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7"];
      for (const [srcType, srcPin] of t === "SW8" ? [["8255", "PB"]] : [["74LS373", "Q"], ["8255", "PA"]]) {
        const src = partnerVia(doc, byPin, comp, disp.map((p, i) => [p, srcPin + i]), srcType);
        if (!src) continue;
        return { run: (d) => {
          const A = K._acKit;
          const ctx = A.makeCtx(d, K.docComp(d, comp.id), null);
          const c2 = K.docComp(d, comp.id), s2 = K.docComp(d, src.id);
          disp.forEach((p, i) => ctx.WifFree(pk(s2, srcPin + i), pk(c2, p)));
          if (t !== "SW8") ctx.WifFree(A.gndPin(ctx), pk(c2, t === "LED8" ? "K" : "CC"));
          return ctx;
        } };
      }
      return null;
    }
    if (t === "SPKR")
      return { run: (d) => {
        const A = K._acKit;
        const ctx = A.makeCtx(d, K.docComp(d, comp.id), null);
        ctx.WifFree(A.gndPin(ctx), pk(K.docComp(d, comp.id), "GND"));
        return ctx;
      } };
    return null;
  }

  // -> [{comp, pins, glue, accidental, run}] — chips whose standard hookup
  // has holes. onlyIds (a Set) limits the scan to specific components.
  K.connRepairs = function (doc, onlyIds) {
    const byPin = netsOf(doc);
    const out = [];
    for (const comp of doc.components) {
      if (K.connIsHelper(comp.type) || comp.type === "8284A") continue;
      if (onlyIds && !onlyIds.has(comp.id)) continue;
      if (!isWired(byPin, comp, hookPinOf(comp))) continue;  // fully unhooked -> connSweep's job
      const act = repairActionFor(doc, byPin, comp);
      if (!act) continue;
      let added;
      try {
        const clone = structuredClone(doc);
        const n = clone.wires.length;
        act.run(clone);
        added = clone.wires.slice(n);
      } catch { continue; }
      if (!added.length) continue;
      const mine = [];
      for (const w of added)
        for (const key of [w.a, w.b]) {
          const dot = key.indexOf(".");
          if (key.slice(0, dot) === comp.id) mine.push(key.slice(dot + 1));
        }
      const pins = [...new Set(mine)];
      const glue = added.filter(w => ![w.a, w.b].some(k => k.startsWith(comp.id + "."))).length;
      const accidental = pins.some(p => {
        const m = /^(.*?)(\d+)$/.exec(p);
        if (!m) return false;
        for (let i = 0; i < 20; i++)                     // any sibling lane still wired?
          if (String(i) !== m[2] && isWired(byPin, comp, m[1] + i)) return true;
        return false;
      });
      out.push({ comp, pins, glue, accidental, run: act.run });
    }
    return out;
  };

  // ---- whispers: one part away ---------------------------------------------
  K.connWhispers = function (doc) {
    const byPin = netsOf(doc);
    const out = [];
    const none = (t) => !byType(doc, t).length;
    const noCpu = !cpus(doc).length;
    for (const cpu of unclockedCpus(doc, byPin))
      if (none("8284A")) out.push(`place an 8284A to clock ${ref(cpu)}`);
    for (const cpu of cpus(doc))
      if (strappedMax(doc, byPin, cpu) && !has8288For(doc, byPin, cpu) && none("8288"))
        out.push(`${ref(cpu)} is strapped for maximum mode — place an 8288 bus controller`);
    if (noCpu && doc.components.some(c => K.chips[c.type].category === "Memory"))
      out.push("place a CPU and I'll offer to wire the memory");
    if (noCpu && doc.components.some(c => !K.connIsHelper(c.type) &&
        !K.chips[c.type].isCpu && K.chips[c.type].category !== "Memory" && c.type !== "8284A"))
      out.push("place a CPU — every device hookup starts from its bus");
    for (const p of byType(doc, "PRINTER"))
      if (!isWired(byPin, p, "~STROBE") && none("LPT378") && noCpu) out.push(`place an LPT378 adapter to drive ${ref(p)}`);
    for (const c of byType(doc, "CRT"))
      if (!isWired(byPin, c, "VIDEO") && none("HGC") && noCpu) out.push(`place a Hercules HGC card for ${ref(c)}`);
    for (const k of byType(doc, "XTKBD"))
      if (!isWired(byPin, k, "KCLK") && none("KBDSHIFT") && noCpu) out.push(`place a KBDSHIFT register for ${ref(k)}`);
    for (const s of byType(doc, "SPKR"))
      if (!isWired(byPin, s, "IN") && none("8253") && none("8254") && noCpu) out.push(`place an 8253/8254 timer to drive ${ref(s)}`);
    return [...new Set(out)];
  };
})(globalThis.K8086 ??= {});
