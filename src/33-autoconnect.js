"use strict";
(function (K) {
  // Autoconnect: "wire this chip to which CPU?" — synthesizes the standard
  // hookup a kit designer would do by hand: address/data buses, strobes,
  // and (when a select is needed) a '138 decoder, creating latches, decoders
  // and spare gates on demand. Everything it adds is an ordinary component +
  // ordinary wires: the result is inspectable, DRC-checkable, and editable.
  //
  // The recipes copy the preset boards' idioms exactly:
  //   memory (8088):  A0-7 from the ALE '373, A8+ from CPU pins, D on AD0-7,
  //                   ~OE <- ~RD, ~WE <- ~WR, select from a '138 on A17-19
  //                   gated by IO/~M (partial decode, like the cheap kits).
  //   memory (8086):  same, but bank-addressed (chip A0 <- system A1) with
  //                   per-lane ~WE gating through a '74LS32 (word-8086 style).
  //   8253/8255/8259: D bus, A0/A1 from latched address, ~RD/~WR direct,
  //                   ~CS from an IO '138 on A5-7 gated by IO/~M.
  //   COM8250:        full A0-9 + IO-qualified ~IOR/~IOW (uart-lab style).
  //   8088/8086:      clock/RESET/READY from an 8284A + mode straps.

  const AUTO = {};                       // type -> recipe(ctx)
  K.autoRecipeFor = (type) => !!(AUTO[type] || (K.chips[type] && K.chips[type].category === "Memory"));

  // ---- context helpers ------------------------------------------------------
  function makeCtx(doc, comp, cpu) {
    const ctx = {
      doc, comp, cpu, wires: 0, notes: [], created: [],
      refresh() { const { byPin } = K.extractNets(doc); ctx.byPin = byPin; },
      // extractNets gives every pin a (possibly singleton) net; "wired" means
      // actually connected to something else.
      netOf(pinKey) { const n = ctx.byPin.get(pinKey); return n && n.pins.length > 1 ? n : null; },
      wired(pinKey) { const n = ctx.byPin.get(pinKey); return !!n && n.pins.length > 1; },
      same(a, b) { const n = ctx.netOf(a); return !!n && n === ctx.netOf(b); },
      W(a, b, bundle) { K.docConnect(doc, a, b, bundle); ctx.wires++; ctx.refresh(); },
      // connect only if the destination pin is still unwired (never fight
      // wiring the user already did by hand)
      WifFree(a, b, bundle) { if (!ctx.wired(b)) ctx.W(a, b, bundle); },
      add(type, props) {
        const c = K.docAddComponent(doc, type, ctx.nx, ctx.ny, props);
        const g = K.chips[type].grid;
        ctx.nx += g.w + 2;
        ctx.created.push(c);
        ctx.refresh();
        return c;
      },
      find(pred) { return doc.components.find(pred); },
      note(s) { ctx.notes.push(s); },
    };
    // place synthesized helpers in a fresh row below everything on the board
    let ymax = 0;
    for (const c of doc.components) ymax = Math.max(ymax, c.y + K.chips[c.type].grid.h);
    ctx.nx = comp.x; ctx.ny = ymax + 2;
    ctx.refresh();
    return ctx;
  }

  const pk = K.pinKey;

  function railPin(ctx, type, pin) {
    let c = ctx.find(c => c.type === type);
    if (!c) c = ctx.add(type);
    return pk(c, pin);
  }
  const vccPin = (ctx) => railPin(ctx, "VCC", "V");
  const gndPin = (ctx) => railPin(ctx, "GND", "G");

  // Allocate a spare 2-input gate ("74LS32" -> {a,b,y}) or inverter unit,
  // reusing any placed chip with an unwired output, else creating one.
  function freeGate2(ctx, type) {
    for (const c of ctx.doc.components) {
      if (c.type !== type) continue;
      for (let g = 1; g <= 4; g++)
        if (!ctx.wired(pk(c, g + "Y")))
          return { a: pk(c, g + "A"), b: pk(c, g + "B"), y: pk(c, g + "Y") };
    }
    const c = ctx.add(type);
    return { a: pk(c, "1A"), b: pk(c, "1B"), y: pk(c, "1Y") };
  }
  function freeInverter(ctx) {
    for (const c of ctx.doc.components) {
      if (c.type !== "74LS04") continue;
      for (let g = 1; g <= 6; g++)
        if (!ctx.wired(pk(c, g + "Y")))
          return { a: pk(c, g + "A"), y: pk(c, g + "Y") };
    }
    const c = ctx.add("74LS04");
    return { a: pk(c, "1A"), y: pk(c, "1Y") };
  }
  // Inverted copy of a signal, reusing an inverter already fed by it.
  function inverted(ctx, srcKey) {
    for (const c of ctx.doc.components) {
      if (c.type !== "74LS04") continue;
      for (let g = 1; g <= 6; g++)
        if (ctx.same(pk(c, g + "A"), srcKey) && ctx.wired(pk(c, g + "Y")))
          return pk(c, g + "Y");
    }
    const inv = freeInverter(ctx);
    ctx.W(srcKey, inv.a);
    return inv.y;
  }

  // ---- CPU bus discovery ----------------------------------------------------
  // Returns null with a note if the board can't support the hookup yet.
  function busInfo(ctx) {
    const cpu = ctx.cpu, doc = ctx.doc;
    const is8086 = cpu.type === "8086";
    const mnNet = ctx.netOf(pk(cpu, "MN/~MX"));
    const strap = mnNet && mnNet.pins.find(p => p.comp.type === "VCC" || p.comp.type === "GND");
    const maxMode = strap ? strap.comp.type === "GND" : false;
    if (!strap) ctx.note("MN/~MX is unstrapped — assuming minimum mode (strap it to VCC)");
    const info = { is8086, maxMode };

    if (maxMode) {
      const ctl = ctx.find(c => c.type === "8288" && ctx.same(pk(c, "~S0"), pk(cpu, "~DEN")));
      if (!ctl) { ctx.note("maximum mode but no 8288 sees this CPU's status — place and wire an 8288 first"); return null; }
      info.ctl = ctl;
      info.aleKey = pk(ctl, "ALE");
      info.memRd = pk(ctl, "~MRDC"); info.memWr = pk(ctl, "~MWTC");
      info.ioRd = pk(ctl, "~IORC"); info.ioWr = pk(ctl, "~IOWC");
      info.intaKey = pk(ctl, "~INTA");
    } else {
      info.aleKey = pk(cpu, "ALE");
      info.memRd = pk(cpu, "~RD"); info.memWr = pk(cpu, "~WR");
      info.ioRd = pk(cpu, "~RD"); info.ioWr = pk(cpu, "~WR");   // ~CS qualifies
      info.intaKey = pk(cpu, "~INTA");
      info.ioM = pk(cpu, is8086 ? "M/~IO" : "IO/~M");           // H=IO on 8088, H=mem on 8086
    }

    // demux latches: one per muxed byte, created on demand
    const latchFor = (bank) => {
      let lat = ctx.find(c => c.type === "74LS373" &&
        ctx.same(pk(c, "LE"), info.aleKey) && ctx.same(pk(c, "D0"), pk(cpu, "AD" + (bank * 8))));
      if (!lat) {
        lat = ctx.add("74LS373");
        for (let i = 0; i < 8; i++) ctx.W(pk(cpu, "AD" + (bank * 8 + i)), pk(lat, "D" + i), "aad" + bank);
        ctx.W(info.aleKey, pk(lat, "LE"));
        ctx.W(gndPin(ctx), pk(lat, "~OE"));
        ctx.note("added a '373 address latch for A" + bank * 8 + "-" + (bank * 8 + 7));
      }
      return lat;
    };
    info.addrKey = (bit) => {
      if (bit < 8) return pk(latchFor(0), "Q" + bit);
      if (is8086 && bit < 16) return pk(latchFor(1), "Q" + (bit - 8));
      return pk(cpu, "A" + bit);
    };
    info.dataKey = (bit) => pk(cpu, "AD" + bit);                // low lane; high lane = AD8-15 on 8086
    return info;
  }

  // ---- decoder synthesis ----------------------------------------------------
  // Memory: '138 on A17-19, gated so it only fires on memory cycles.
  function memDecoder(ctx, info) {
    let dec = ctx.find(c => c.type === "74LS138" &&
      ctx.same(pk(c, "C"), pk(ctx.cpu, "A19")) && ctx.same(pk(c, "A"), pk(ctx.cpu, "A17")));
    if (!dec) {
      dec = ctx.add("74LS138");
      ctx.W(pk(ctx.cpu, "A17"), pk(dec, "A"));
      ctx.W(pk(ctx.cpu, "A18"), pk(dec, "B"));
      ctx.W(pk(ctx.cpu, "A19"), pk(dec, "C"));
      if (info.maxMode) { ctx.W(vccPin(ctx), pk(dec, "G1")); ctx.W(gndPin(ctx), pk(dec, "~G2A")); }
      else if (info.is8086) { ctx.W(pk(ctx.cpu, "M/~IO"), pk(dec, "G1")); ctx.W(gndPin(ctx), pk(dec, "~G2A")); }
      else { ctx.W(vccPin(ctx), pk(dec, "G1")); ctx.W(pk(ctx.cpu, "IO/~M"), pk(dec, "~G2A")); }
      ctx.W(gndPin(ctx), pk(dec, "~G2B"));
      ctx.note("added a '138 memory decoder on A17-19 (eight 128K windows)");
    }
    return dec;
  }
  // IO: '138 on latched A5-7, so each output is a 32-port window.
  function ioDecoder(ctx, info) {
    let dec = ctx.find(c => c.type === "74LS138" &&
      ctx.same(pk(c, "A"), info.addrKey(5)) && ctx.same(pk(c, "B"), info.addrKey(6)));
    if (!dec) {
      dec = ctx.add("74LS138");
      ctx.W(info.addrKey(5), pk(dec, "A"));
      ctx.W(info.addrKey(6), pk(dec, "B"));
      ctx.W(info.addrKey(7), pk(dec, "C"));
      if (info.maxMode) { ctx.W(vccPin(ctx), pk(dec, "G1")); ctx.W(gndPin(ctx), pk(dec, "~G2A")); }
      else if (info.is8086) { ctx.W(vccPin(ctx), pk(dec, "G1")); ctx.W(pk(ctx.cpu, "M/~IO"), pk(dec, "~G2A")); }
      else { ctx.W(pk(ctx.cpu, "IO/~M"), pk(dec, "G1")); ctx.W(gndPin(ctx), pk(dec, "~G2A")); }
      ctx.W(gndPin(ctx), pk(dec, "~G2B"));
      ctx.note("added a '138 IO decoder on A5-7 (eight 32-port windows)");
    }
    return dec;
  }
  function freeY(ctx, dec, order) {
    for (const n of order) if (!ctx.wired(pk(dec, "Y" + n))) return n;
    return null;
  }
  const hex = (v, w) => v.toString(16).toUpperCase().padStart(w, "0");

  // Address, data and strobe wiring shared by autoconnect and the range
  // calculator; select wiring is the caller's business.
  function wireMemoryBus(ctx, info, lane, abits, hasWE) {
    const shift = info.is8086 ? 1 : 0;         // bank addressing: chip A0 <- system A1
    for (let i = 0; i < abits; i++) ctx.WifFree(info.addrKey(i + shift), pk(ctx.comp, "A" + i), "aca");
    for (let i = 0; i < 8; i++)
      ctx.WifFree(pk(ctx.cpu, "AD" + (lane ? 8 + i : i)), pk(ctx.comp, "D" + i), "acd");
    ctx.WifFree(info.memRd, pk(ctx.comp, "~OE"));
    if (hasWE && !ctx.wired(pk(ctx.comp, "~WE"))) {
      if (info.is8086) {
        // per-lane write gating, exactly like the word-8086 board
        const g = freeGate2(ctx, "74LS32");
        ctx.W(info.memWr, g.a);
        ctx.W(lane ? pk(ctx.cpu, "~BHE") : info.addrKey(0), g.b);
        ctx.W(g.y, pk(ctx.comp, "~WE"));
      } else {
        ctx.W(info.memWr, pk(ctx.comp, "~WE"));
      }
    }
  }

  // ---- recipes --------------------------------------------------------------
  function memoryRecipe(ctx) {
    const info = busInfo(ctx);
    if (!info) return;
    const def = K.chips[ctx.comp.type];
    const abits = def.pins.filter(p => /^A\d+$/.test(p.name)).length;
    const isRom = !!def.isRom;
    const cs = def.pinIndex["~CS1"] !== undefined ? "~CS1" : def.pinIndex["~CS"] !== undefined ? "~CS" : "~CE";
    const dec = memDecoder(ctx, info);
    // A ROM must answer at the top of memory (FFFF0 reset vector); RAM wants
    // the bottom (IVT). Y7 = E0000-FFFFF ... Y0 = 00000-1FFFF.
    const order = isRom ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    let y = null, lane = 0;
    if (info.is8086) {
      // join a window whose even/low bank exists but odd/high doesn't —
      // the second chip of a word-wide pair (word-8086 board style)
      for (const n of order) {
        const yNet = ctx.netOf(pk(dec, "Y" + n));
        if (!yNet) continue;
        const mems = yNet.pins.filter(p => p.comp !== ctx.comp && K.chips[p.comp.type].category === "Memory");
        if (!mems.length) continue;
        const kindOk = mems.some(p => !!K.chips[p.comp.type].isRom === isRom);
        const lowTaken = mems.some(p => ctx.same(pk(p.comp, "D0"), pk(ctx.cpu, "AD0")));
        const highTaken = mems.some(p => ctx.same(pk(p.comp, "D0"), pk(ctx.cpu, "AD8")));
        if (kindOk && lowTaken && !highTaken) { y = n; lane = 1; break; }
      }
    }
    if (y === null) {
      y = freeY(ctx, dec, order);
      if (y === null) { ctx.note("all eight '138 windows are in use — free one or add another decoder"); return; }
      if (isRom && y !== 7) ctx.note("top window (reset vector) was taken — check what the CPU will fetch at FFFF0");
    }
    wireMemoryBus(ctx, info, lane, abits, def.pinIndex["~WE"] !== undefined);
    ctx.WifFree(pk(dec, "Y" + y), pk(ctx.comp, cs));
    if (cs === "~CS1") ctx.WifFree(vccPin(ctx), pk(ctx.comp, "CS2"));
    const base = y << 17, top = base + (1 << 17) - 1;
    ctx.note(`${ctx.comp.props.ref || ctx.comp.type} responds in ${hex(base, 5)}h-${hex(top, 5)}h` +
      ` (partial decode${info.is8086 ? lane ? ", odd/high byte lane" : ", even/low byte lane" : ""})`);
    const foreign = ctx.doc.components.some(c => {
      if (c === ctx.comp || K.chips[c.type].category !== "Memory") return false;
      const d = K.chips[c.type];
      const sel = ctx.netOf(pk(c, d.pinIndex["~CS1"] !== undefined ? "~CS1" : d.pinIndex["~CS"] !== undefined ? "~CS" : "~CE"));
      return !!sel && sel.pins.every(p => p.comp !== dec);   // wired select, not via our '138
    });
    if (foreign) ctx.note("other memory uses its own decode — open the Memory map to check the ranges don't overlap");
    if (info.is8086 && lane === 0)
      ctx.note("8086 is word-wide: place a second identical chip and autoconnect it for the odd/high lane");
  }

  function periphRecipe(ctx, opts) {
    const info = busInfo(ctx);
    if (!info) return null;
    const dec = ioDecoder(ctx, info);
    const y = freeY(ctx, dec, opts.preferY || [1, 2, 3, 4, 5, 6, 7, 0]);
    if (y === null) { ctx.note("all eight IO windows are in use — free one or add another decoder"); return null; }
    for (let i = 0; i < 8; i++) ctx.WifFree(pk(ctx.cpu, "AD" + i), pk(ctx.comp, "D" + i), "acd");
    for (const bit of opts.abits || []) ctx.WifFree(info.addrKey(bit), pk(ctx.comp, "A" + bit));
    ctx.WifFree(info.ioRd, pk(ctx.comp, "~RD"));
    ctx.WifFree(info.ioWr, pk(ctx.comp, "~WR"));
    ctx.WifFree(pk(dec, "Y" + y), pk(ctx.comp, "~CS"));
    const base = y << 5;
    ctx.note(`${ctx.comp.props.ref || ctx.comp.type} at ports ${hex(base, 2)}h-${hex(base + 31, 2)}h`);
    return { info, dec, y, base };
  }

  AUTO["8253"] = (ctx) => {
    const r = periphRecipe(ctx, { abits: [0, 1], preferY: [2, 1, 3, 4, 5, 6, 7, 0] }); // 40h first, like the PC
    if (!r) return;
    const cg = ctx.find(c => c.type === "8284A" && ctx.same(pk(c, "CLK"), pk(ctx.cpu, "CLK")));
    if (cg && !ctx.wired(pk(ctx.comp, "CLK0"))) {
      ctx.W(pk(cg, "PCLK"), pk(ctx.comp, "CLK0"));
      ctx.note("CLK0 fed from the 8284's PCLK — wire CLK1/CLK2 and the GATEs to taste");
    }
    ctx.WifFree(vccPin(ctx), pk(ctx.comp, "GATE0"));
  };

  AUTO["8254"] = (ctx) => AUTO["8253"](ctx);

  AUTO["8255"] = (ctx) => {
    const r = periphRecipe(ctx, { abits: [0, 1], preferY: [3, 1, 2, 4, 5, 6, 7, 0] }); // 60h first, like the PC
    if (!r) return;
    ctx.WifFree(pk(ctx.cpu, "RESET"), pk(ctx.comp, "RESET"));
    ctx.note("ports PA/PB/PC are yours — switches in, LEDs out");
  };

  AUTO["8259A"] = (ctx) => {
    const r = periphRecipe(ctx, { abits: [0], preferY: [1, 2, 3, 4, 5, 6, 7, 0] }); // 20h first, like the PC
    if (!r) return;
    ctx.WifFree(vccPin(ctx), pk(ctx.comp, "~SP/~EN"));
    ctx.WifFree(r.info.intaKey, pk(ctx.comp, "~INTA"));
    const intrNet = ctx.netOf(pk(ctx.cpu, "INTR"));
    if (!intrNet) { ctx.W(pk(ctx.comp, "INT"), pk(ctx.cpu, "INTR")); }
    else if (intrNet.pins.some(p => p.comp.type === "GND"))
      ctx.note("CPU INTR is strapped to GND — delete that strap and wire INT to INTR to take interrupts");
    ctx.note("wire IR0-7 to your interrupt sources (unused IRs can float: they read as edges never)");
  };

  // Self-decoding IO cards (COM1, LPT1): full A0-9 + IO-qualified strobes.
  function cardRecipe(ctx, note) {
    const info = busInfo(ctx);
    if (!info) return;
    for (let i = 0; i < 8; i++) ctx.WifFree(info.addrKey(i), pk(ctx.comp, "A" + i));
    ctx.WifFree(pk(ctx.cpu, "A8"), pk(ctx.comp, "A8"));
    ctx.WifFree(pk(ctx.cpu, "A9"), pk(ctx.comp, "A9"));
    for (let i = 0; i < 8; i++) ctx.WifFree(pk(ctx.cpu, "AD" + i), pk(ctx.comp, "D" + i), "acd");
    ctx.WifFree(pk(ctx.cpu, "RESET"), pk(ctx.comp, "RESET"));
    if (info.maxMode) {
      ctx.WifFree(info.ioRd, pk(ctx.comp, "~IOR"));
      ctx.WifFree(info.ioWr, pk(ctx.comp, "~IOW"));
    } else {
      // the card decodes its own address but needs IO-qualified strobes
      const notIo = info.is8086 ? pk(ctx.cpu, "M/~IO") : inverted(ctx, info.ioM);
      for (const [strobe, pin] of [[info.ioRd, "~IOR"], [info.ioWr, "~IOW"]]) {
        if (ctx.wired(pk(ctx.comp, pin))) continue;
        const g = freeGate2(ctx, "74LS32");
        ctx.W(strobe, g.a);
        ctx.W(notIo, g.b);
        ctx.W(g.y, pk(ctx.comp, pin));
      }
    }
    ctx.note(note);
  }
  AUTO["COM8250"] = (ctx) => cardRecipe(ctx, "COM1 card decodes itself at 3F8h-3FFh; INTR left for you (IRQ4 on a PC)");
  AUTO["LPT378"] = (ctx) => {
    cardRecipe(ctx, "LPT1 card decodes itself at 378h-37Ah; wire the printer to the PD/handshake pins");
    // hook up a printer if one sits on the board unwired
    const pr = ctx.find(c => c.type === "PRINTER" && !ctx.wired(pk(c, "~STROBE")));
    if (pr) {
      for (let i = 0; i < 8; i++) ctx.W(pk(ctx.comp, "PD" + i), pk(pr, "PD" + i), "lptd");
      for (const p of ["~STROBE", "BUSY", "~ACK", "PE", "SLCT", "~ERROR"])
        ctx.W(pk(ctx.comp, p), pk(pr, p), "lpth");
      ctx.note("printer connected: data + STROBE/BUSY/ACK handshake");
    }
  };

  // Hercules card: self-decoding on the FULL bus (A0-19 + mem AND io strobes),
  // exactly the hgc-8088 preset idiom. Cables an un-cabled CRT if one is around.
  AUTO["HGC"] = (ctx) => {
    const info = busInfo(ctx);
    if (!info) return;
    for (let i = 0; i < 8; i++) ctx.WifFree(info.addrKey(i), pk(ctx.comp, "A" + i), "va");
    for (let i = 8; i <= 19; i++) ctx.WifFree(pk(ctx.cpu, "A" + i), pk(ctx.comp, "A" + i), "vah");
    for (let i = 0; i < 8; i++) ctx.WifFree(pk(ctx.cpu, "AD" + i), pk(ctx.comp, "D" + i), "vd");
    if (info.maxMode) {
      ctx.WifFree(info.memRd, pk(ctx.comp, "~MEMR"));
      ctx.WifFree(info.memWr, pk(ctx.comp, "~MEMW"));
      ctx.WifFree(info.ioRd, pk(ctx.comp, "~IOR"));
      ctx.WifFree(info.ioWr, pk(ctx.comp, "~IOW"));
    } else {
      // ISA-style qualified strobes: OR the CPU strobe with a signal that is
      // low during the right cycle kind (mem vs io).
      const notIo = info.is8086 ? pk(ctx.cpu, "M/~IO") : inverted(ctx, info.ioM);
      const notMem = info.is8086 ? inverted(ctx, pk(ctx.cpu, "M/~IO")) : pk(ctx.cpu, "IO/~M");
      for (const [strobe, qual, pin] of [
        [pk(ctx.cpu, "~RD"), notMem, "~MEMR"], [pk(ctx.cpu, "~WR"), notMem, "~MEMW"],
        [pk(ctx.cpu, "~RD"), notIo, "~IOR"], [pk(ctx.cpu, "~WR"), notIo, "~IOW"]]) {
        if (ctx.wired(pk(ctx.comp, pin))) continue;
        const g = freeGate2(ctx, "74LS32");
        ctx.W(strobe, g.a);
        ctx.W(qual, g.b);
        ctx.W(g.y, pk(ctx.comp, pin));
      }
    }
    ctx.note("Hercules card self-decodes: VRAM at B0000h-B7FFFh, CRTC at ports 3B4h-3BFh");
    const crt = ctx.find(c => c.type === "CRT" && !ctx.wired(pk(c, "VIDEO")));
    if (crt) {
      for (const p of ["HSYNC", "VSYNC", "VIDEO"]) ctx.W(pk(ctx.comp, p), pk(crt, p), "vmon");
      ctx.note(`monitor ${crt.props.ref || crt.id} cabled — double-click it once running`);
    }
  };

  AUTO["UPD765"] = (ctx) => {
    cardRecipe(ctx, "floppy controller self-decodes at 3F0h-3F7h — insert a disk from the Disk library");
    const pic = ctx.find(c => c.type === "8259A" && ctx.wired(pk(c, "~INTA")));
    if (pic && !ctx.wired(pk(ctx.comp, "INT"))) {
      ctx.WifFree(pk(ctx.comp, "INT"), pk(pic, "IR6"));
      ctx.note(`INT raises ${pic.props.ref || "the PIC"}'s IR6 — the PC floppy interrupt`);
    }
    const dma = ctx.find(c => c.type === "8237A" && ctx.wired(pk(c, "~CS")));
    if (dma) {
      ctx.WifFree(pk(ctx.comp, "DRQ"), pk(dma, "DREQ2"));
      ctx.note("DRQ requests DMA channel 2, PC style");
    }
  };

  AUTO["XTIDE"] = (ctx) =>
    cardRecipe(ctx, "XT-IDE card self-decodes at 300h (polled PIO) — attach a disk from the Disk library; booting from it needs the XTIDE option ROM");

  AUTO["8237A"] = (ctx) => {
    const info = busInfo(ctx);
    if (!info) return;
    const dec = ioDecoder(ctx, info);
    const y = freeY(ctx, dec, [0, 4, 5, 6, 7, 1, 2, 3]);   // 00h first, like the PC
    if (y === null) { ctx.note("all eight IO windows are in use — free one or add another decoder"); return; }
    for (let i = 0; i < 8; i++) ctx.WifFree(pk(ctx.cpu, "AD" + i), pk(ctx.comp, "D" + i), "acd");
    for (let i = 0; i < 4; i++) ctx.WifFree(info.addrKey(i), pk(ctx.comp, "A" + i));
    ctx.WifFree(info.ioRd, pk(ctx.comp, "~IOR"));
    ctx.WifFree(info.ioWr, pk(ctx.comp, "~IOW"));
    ctx.WifFree(pk(dec, "Y" + y), pk(ctx.comp, "~CS"));
    ctx.WifFree(pk(ctx.cpu, "RESET"), pk(ctx.comp, "RESET"));
    ctx.WifFree(gndPin(ctx), pk(ctx.comp, "HLDA"));
    ctx.note(`DMA registers at ports ${hex(y << 5, 2)}h-${hex((y << 5) + 31, 2)}h`);
    const y2 = freeY(ctx, dec, [4, 5, 6, 7]);
    if (y2 !== null && !ctx.wired(pk(ctx.comp, "~CSP"))) {
      ctx.W(pk(dec, "Y" + y2), pk(ctx.comp, "~CSP"));
      ctx.note(`page/POST registers at ${hex(y2 << 5, 2)}h`);
    }
    ctx.note("CLK left unwired on purpose — the register model doesn't use it, and a 4.77MHz net costs settle speed");
  };

  AUTO["8088"] = AUTO["8086"] = (ctx) => {
    // "connect the CPU itself": clock, reset, ready, and sane straps.
    const cpu = ctx.comp;
    const cg = ctx.find(c => c.type === "8284A");
    if (!cg) { ctx.note("no 8284A clock generator on the board — place one first"); return; }
    ctx.WifFree(pk(cg, "CLK"), pk(cpu, "CLK"));
    ctx.WifFree(pk(cg, "RESET"), pk(cpu, "RESET"));
    ctx.WifFree(pk(cg, "READY"), pk(cpu, "READY"));
    ctx.WifFree(vccPin(ctx), pk(cpu, "MN/~MX"));
    ctx.WifFree(vccPin(ctx), pk(cpu, "~TEST"));
    ctx.WifFree(gndPin(ctx), pk(cpu, "NMI"));
    ctx.WifFree(gndPin(ctx), pk(cpu, "INTR"));
    ctx.WifFree(gndPin(ctx), pk(cpu, "HOLD"));
    if (!ctx.netOf(pk(cg, "X1"))) {
      const xt = ctx.find(c => c.type === "XTAL" && !ctx.wired(pk(c, "X1"))) || ctx.add("XTAL", { mhz: 14.31818 });
      ctx.W(pk(xt, "X1"), pk(cg, "X1"));
      ctx.W(pk(xt, "X2"), pk(cg, "X2"));
    }
    if (!ctx.netOf(pk(cg, "~RES"))) {
      ctx.W(railPin(ctx, "PULLUP", "P"), pk(cg, "~RES"));
      const btn = ctx.find(c => c.type === "BTN" && !ctx.wired(pk(c, "B")));
      if (btn) ctx.W(pk(btn, "B"), pk(cg, "~RES"));
      ctx.note("8284 ~RES pulled up (add a button on the same net for a reset switch)");
    }
    ctx.note("strapped for minimum mode; re-strap MN/~MX to GND + add an 8288 for max mode");
  };

  // internal kit shared with the range calculator (src/34-rangecalc.js)
  K._acKit = { makeCtx, busInfo, memDecoder, ioDecoder, freeGate2, freeInverter,
               inverted, vccPin, gndPin, railPin, freeY, wireMemoryBus };

  // ---- entry point ----------------------------------------------------------
  // K.autoconnect(doc, comp, cpuComp) -> { wires, notes, created } | null
  K.autoconnect = function (doc, comp, cpuComp) {
    const def = K.chips[comp.type];
    if (!def) return null;
    const recipe = AUTO[comp.type] || (def.category === "Memory" ? memoryRecipe : null);
    if (!recipe) return null;
    const ctx = makeCtx(doc, comp, cpuComp);
    recipe(ctx);
    return { wires: ctx.wires, notes: ctx.notes, created: ctx.created };
  };
})(globalThis.K8086 ??= {});
