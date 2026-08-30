"use strict";
(function (K) {
  K.presets = [];

  // Wiring helpers used by preset builders and by autoconnect.
  function W(doc, a, b, bundle) { return K.docConnect(doc, a, b, bundle); }
  function pk(comp, pin) { return K.pinKey(comp, pin); }
  function bus(doc, ca, pa, cb, pb, from, to, bundle) {
    const id = bundle || K.uid("b");
    for (let i = from; i <= to; i++) W(doc, pk(ca, pa + i), pk(cb, pb + i), id);
  }
  K.wireHelpers = { W, pk, bus };

  // ---------------------------------------------------------------------------
  // Logic lab: clock module driving a ripple counter into LEDs. No CPU at all —
  // the smallest thing that exercises the engine, waveforms, and probing.
  // widen a finished board uniformly: same topology, roomier bus channels
  const spread = (doc, fx, fy) => {
    for (const c of doc.components) { c.x = Math.round(c.x * fx); c.y = Math.round(c.y * fy); }
  };

  K.presets.push({
    id: "logic-counter",
    name: "Logic lab: ripple counter",
    blurb: "A 1 Hz clock module clocks half of a 74LS393; four LEDs show the count. Probe the outputs and watch the ripple in the waveform analyzer.",
    build() {
      const doc = K.newDoc();
      const osc = K.docAddComponent(doc, "OSC", 6, 10, { hz: 2 });
      const ctr = K.docAddComponent(doc, "74LS393", 16, 8);
      const led = K.docAddComponent(doc, "LED8", 28, 6);
      const gnd = K.docAddComponent(doc, "GND", 16, 18);
      W(doc, pk(osc, "OUT"), pk(ctr, "1CLK"));
      W(doc, pk(ctr, "1CLR"), pk(gnd, "G"));
      ["1QA", "1QB", "1QC", "1QD"].forEach((q, i) => W(doc, pk(ctr, q), pk(led, "A" + i)));
      W(doc, pk(led, "K"), pk(gnd, "G"));
      return { doc };
    },
  });

  // ---------------------------------------------------------------------------
  // Minimal 8088 kit: 8284A clock, 8088 in min mode, demultiplexed A0-7 via a
  // 74LS373, 2764 EPROM high (A19=1, partially decoded), 6264 SRAM low (A19=0),
  // and a latched output port on any OUT instruction driving an LED bar.
  K.presets.push({
    id: "min-8088",
    name: "Minimal 8088 kit",
    blurb: "The classic single-board computer: 8284A + 8088 + EPROM + SRAM + one latched LED port. Partial address decoding, exactly like the cheap kits did it.",
    lab: [
      "Press Start: the LEDs blink. Now press ⏸ pause and step by INSTRUCTION — watch CS:IP advance in the CPU tab and the next opcode decode.",
      "Step by CYCLE instead: one T-state at a time. Open the waveform analyzer and find ALE, ~RD, AD0-7 — a complete bus cycle every 4 clocks.",
      "Hover any wire while paused: the probe shows its live logic level. Follow an address bit from the CPU through the '373 latch.",
      "Open the memory map (▦): the analyzer PROVED where ROM and RAM answer, by driving the real decode gates. Note the mirrors — partial decoding.",
      "Double-click the SRAM while running: live hex. Find the stack (the top of RAM) changing as CALLs push.",
    ],
    defaultProgram: [
      "; Minimal 8088 kit — blink the LED port",
      "; EPROM lives at F000:E000 (A19=1, partly decoded).",
      "        org 0",
      "start:  mov al, 0x55",
      "        out 0x00, al       ; any OUT hits the port latch",
      "        mov cx, 4",
      "d1:     loop d1            ; short delay",
      "        mov al, 0xAA",
      "        out 0x00, al",
      "        mov cx, 4",
      "d2:     loop d2",
      "        jmp start",
    ].join("\n"),
    romComp: "rom",
    build() {
      const doc = K.newDoc();
      const xt = K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
      const cg = K.docAddComponent(doc, "8284A", 2, 6);
      const cpu = K.docAddComponent(doc, "8088", 16, 2);
      const latA = K.docAddComponent(doc, "74LS373", 34, 2);
      const inv = K.docAddComponent(doc, "74LS04", 34, 16);
      const nand = K.docAddComponent(doc, "74LS00", 34, 26);
      const and8 = K.docAddComponent(doc, "74LS08", 34, 36);
      const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
      const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
      const port = K.docAddComponent(doc, "74LS373", 50, 38);
      const led = K.docAddComponent(doc, "LED8", 64, 38);
      const vcc = K.docAddComponent(doc, "VCC", 2, 20);
      const gnd = K.docAddComponent(doc, "GND", 2, 24);
      const pull = K.docAddComponent(doc, "PULLUP", 2, 28);
      const btn = K.docAddComponent(doc, "BTN", 2, 32);
      const names = { xt, cg, cpu, latA, inv, nand, and8, rom, ram, port, led, vcc, gnd, pull, btn };

      // clock + reset
      W(doc, pk(xt, "X1"), pk(cg, "X1"));
      W(doc, pk(xt, "X2"), pk(cg, "X2"));
      W(doc, pk(cg, "CLK"), pk(cpu, "CLK"));
      W(doc, pk(cg, "RESET"), pk(cpu, "RESET"));
      W(doc, pk(cg, "READY"), pk(cpu, "READY"));
      W(doc, pk(cg, "~RES"), pk(pull, "P"));
      W(doc, pk(cg, "~RES"), pk(btn, "B"));
      // strapping
      W(doc, pk(cpu, "MN/~MX"), pk(vcc, "V"));
      W(doc, pk(cpu, "~TEST"), pk(vcc, "V"));
      W(doc, pk(cpu, "NMI"), pk(gnd, "G"));
      W(doc, pk(cpu, "INTR"), pk(gnd, "G"));
      W(doc, pk(cpu, "HOLD"), pk(gnd, "G"));
      // address demux: AD0-7 -> 373 -> A0-7
      bus(doc, cpu, "AD", latA, "D", 0, 7, "ad");
      W(doc, pk(cpu, "ALE"), pk(latA, "LE"));
      W(doc, pk(latA, "~OE"), pk(gnd, "G"));
      // memory decode: nIOM = NOT(IO/~M); ROM ~CE = NAND(A19, nIOM); RAM ~CS1 = NAND(NOT A19, nIOM)
      W(doc, pk(cpu, "IO/~M"), pk(inv, "1A"));
      W(doc, pk(inv, "1Y"), pk(nand, "1B"));
      W(doc, pk(inv, "1Y"), pk(nand, "2B"));
      W(doc, pk(cpu, "A19"), pk(nand, "1A"));
      W(doc, pk(cpu, "A19"), pk(inv, "2A"));
      W(doc, pk(inv, "2Y"), pk(nand, "2A"));
      W(doc, pk(nand, "1Y"), pk(rom, "~CE"));
      W(doc, pk(nand, "2Y"), pk(ram, "~CS1"));
      W(doc, pk(ram, "CS2"), pk(vcc, "V"));
      // addresses: latched A0-7 plus CPU A8-12
      bus(doc, latA, "Q", rom, "A", 0, 7, "alo");
      bus(doc, latA, "Q", ram, "A", 0, 7, "alo2");
      for (let i = 8; i <= 12; i++) {
        W(doc, pk(cpu, "A" + i), pk(rom, "A" + i), "ahi");
        W(doc, pk(cpu, "A" + i), pk(ram, "A" + i), "ahi2");
      }
      // data bus straight onto AD0-7
      bus(doc, cpu, "AD", rom, "D", 0, 7, "d1");
      bus(doc, cpu, "AD", ram, "D", 0, 7, "d2");
      // strobes
      W(doc, pk(cpu, "~RD"), pk(rom, "~OE"));
      W(doc, pk(cpu, "~RD"), pk(ram, "~OE"));
      W(doc, pk(cpu, "~WR"), pk(ram, "~WE"));
      // output port: LE = IO/~M AND (NOT ~WR); latches on ~WR rising edge
      W(doc, pk(cpu, "~WR"), pk(inv, "3A"));
      W(doc, pk(cpu, "IO/~M"), pk(and8, "1A"));
      W(doc, pk(inv, "3Y"), pk(and8, "1B"));
      W(doc, pk(and8, "1Y"), pk(port, "LE"));
      W(doc, pk(port, "~OE"), pk(gnd, "G"));
      bus(doc, cpu, "AD", port, "D", 0, 7, "d3");
      bus(doc, port, "Q", led, "A", 0, 7, "q");
      W(doc, pk(led, "K"), pk(gnd, "G"));
      spread(doc, 1.15, 1.08);
      return { doc, names };
    },
    // Build the 8K EPROM image: program at offset (org & 1FFF) — with org E000h
    // the code lands at linear FE000 = F000:E000 — plus the reset far-jump at
    // offset 1FF0 (= linear FFFF0).
    makeRom(programBytes, programOrg) {
      const rom = new Uint8Array(8192).fill(0xFF);
      rom.set(programBytes.slice(0, 8192 - 16), (programOrg || 0) & 0x1FFF);
      rom.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0); // JMP F000:E000
      return rom;
    },
  });

  // ---------------------------------------------------------------------------
  // Interrupt & timer lab: the minimal kit plus a 74LS138 IO decoder, an 8259A
  // PIC at port 20h, an 8253 PIT at 40h (clocked by PCLK), and a button on IR1.
  // The program idles in HLT and counts timer interrupts on the LED bar.
  K.presets.push({
    id: "irq-lab",
    name: "Interrupt & timer lab",
    blurb: "8259A + 8253 wired PC-style (ports 20h/40h). The CPU sleeps in HLT; the timer's square wave raises IR0 through the PIC, the button raises IR1. Watch INTR/~INTA on the waveforms.",
    lab: [
      "Run: the LEDs count timer ticks while the CPU spends its life in HLT. Open the CPU tab: IP parked on the HLT, waking only for interrupts.",
      "Press the IR1 button: the ISR flashes all LEDs. That is a hardware interrupt delivered through a real INTA sequence.",
      "Double-click the 8259A while running: IRR bits flicker as requests arrive, ISR shows the level being serviced.",
      "Waveform: watch INTR rise, then TWO ~INTA pulses — the second carries the vector on AD0-7. Zoom in and read the byte.",
      "Pause and set a bit in the 8259A's IMR (mask) grid. Resume: that interrupt is now ignored. Unmask it and the world resumes.",
    ],
    defaultProgram: [
      "; Interrupt lab — PIC at 20h, PIT at 40h, LED latch at 00h",
      "        org 0xE000",
      "start:  cli",
      "        xor ax, ax",
      "        mov ds, ax",
      "        mov ss, ax",
      "        mov sp, 0x1F00",
      "        ; vectors 8 (timer) and 9 (button) in RAM at 00000",
      "        mov word [8*4], timer_isr",
      "        mov word [8*4+2], 0xF000",
      "        mov word [9*4], button_isr",
      "        mov word [9*4+2], 0xF000",
      "        ; 8259A: ICW1 edge/single/ICW4, vectors 08h, 8086 mode",
      "        mov al, 0x13",
      "        out 0x20, al",
      "        mov al, 0x08",
      "        out 0x21, al",
      "        mov al, 0x01",
      "        out 0x21, al",
      "        mov al, 0xFC       ; unmask IR0+IR1",
      "        out 0x21, al",
      "        ; 8253 ch0: mode 3 square wave, divisor 512 (from PCLK)",
      "        mov al, 0x36",
      "        out 0x43, al",
      "        mov al, 0x00",
      "        out 0x40, al",
      "        mov al, 0x02",
      "        out 0x40, al",
      "        xor bx, bx",
      "        sti",
      "idle:   hlt                ; sleep until an interrupt",
      "        jmp idle",
      "",
      "timer_isr:",
      "        inc bx",
      "        mov al, bl",
      "        out 0x00, al       ; LED bar counts ticks",
      "        mov al, 0x20       ; non-specific EOI",
      "        out 0x20, al",
      "        iret",
      "",
      "button_isr:",
      "        mov al, 0xFF       ; button flashes all LEDs",
      "        out 0x00, al",
      "        mov al, 0x20",
      "        out 0x20, al",
      "        iret",
    ].join("\n"),
    romComp: "rom",
    build() {
      const doc = K.newDoc();
      const xt = K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
      const cg = K.docAddComponent(doc, "8284A", 2, 6);
      const cpu = K.docAddComponent(doc, "8088", 16, 2);
      const latA = K.docAddComponent(doc, "74LS373", 34, 2);
      const inv = K.docAddComponent(doc, "74LS04", 34, 16);
      const nand = K.docAddComponent(doc, "74LS00", 34, 26);
      const nor = K.docAddComponent(doc, "74LS02", 34, 36);
      const io138 = K.docAddComponent(doc, "74LS138", 34, 46);
      const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
      const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
      const pic = K.docAddComponent(doc, "8259A", 66, 2);
      const pit = K.docAddComponent(doc, "8253", 66, 20);
      const port = K.docAddComponent(doc, "74LS373", 50, 38);
      const led = K.docAddComponent(doc, "LED8", 64, 38);
      const vcc = K.docAddComponent(doc, "VCC", 2, 20);
      const gnd = K.docAddComponent(doc, "GND", 2, 24);
      const pull = K.docAddComponent(doc, "PULLUP", 2, 28);
      const btn = K.docAddComponent(doc, "BTN", 2, 32);
      const pullIr = K.docAddComponent(doc, "PULLUP", 2, 38);
      const btnIr = K.docAddComponent(doc, "BTN", 2, 42);
      const names = { xt, cg, cpu, latA, inv, nand, nor, io138, rom, ram, pic, pit, port, led, vcc, gnd, pull, btn, pullIr, btnIr };

      // clock + reset + strapping
      W(doc, pk(xt, "X1"), pk(cg, "X1"));
      W(doc, pk(xt, "X2"), pk(cg, "X2"));
      W(doc, pk(cg, "CLK"), pk(cpu, "CLK"));
      W(doc, pk(cg, "RESET"), pk(cpu, "RESET"));
      W(doc, pk(cg, "READY"), pk(cpu, "READY"));
      W(doc, pk(cg, "~RES"), pk(pull, "P"));
      W(doc, pk(cg, "~RES"), pk(btn, "B"));
      W(doc, pk(cpu, "MN/~MX"), pk(vcc, "V"));
      W(doc, pk(cpu, "~TEST"), pk(vcc, "V"));
      W(doc, pk(cpu, "NMI"), pk(gnd, "G"));
      W(doc, pk(cpu, "HOLD"), pk(gnd, "G"));
      // address demux
      bus(doc, cpu, "AD", latA, "D", 0, 7, "ad");
      W(doc, pk(cpu, "ALE"), pk(latA, "LE"));
      W(doc, pk(latA, "~OE"), pk(gnd, "G"));
      // memory decode (as the minimal kit)
      W(doc, pk(cpu, "IO/~M"), pk(inv, "1A"));
      W(doc, pk(inv, "1Y"), pk(nand, "1B"));
      W(doc, pk(inv, "1Y"), pk(nand, "2B"));
      W(doc, pk(cpu, "A19"), pk(nand, "1A"));
      W(doc, pk(cpu, "A19"), pk(inv, "2A"));
      W(doc, pk(inv, "2Y"), pk(nand, "2A"));
      W(doc, pk(nand, "1Y"), pk(rom, "~CE"));
      W(doc, pk(nand, "2Y"), pk(ram, "~CS1"));
      W(doc, pk(ram, "CS2"), pk(vcc, "V"));
      bus(doc, latA, "Q", rom, "A", 0, 7, "alo");
      bus(doc, latA, "Q", ram, "A", 0, 7, "alo2");
      for (let i = 8; i <= 12; i++) {
        W(doc, pk(cpu, "A" + i), pk(rom, "A" + i), "ahi");
        W(doc, pk(cpu, "A" + i), pk(ram, "A" + i), "ahi2");
      }
      bus(doc, cpu, "AD", rom, "D", 0, 7, "d1");
      bus(doc, cpu, "AD", ram, "D", 0, 7, "d2");
      W(doc, pk(cpu, "~RD"), pk(rom, "~OE"));
      W(doc, pk(cpu, "~RD"), pk(ram, "~OE"));
      W(doc, pk(cpu, "~WR"), pk(ram, "~WE"));
      // IO decode: 138 on latched A5..A7, enabled by IO/~M
      W(doc, pk(latA, "Q5"), pk(io138, "A"));
      W(doc, pk(latA, "Q6"), pk(io138, "B"));
      W(doc, pk(latA, "Q7"), pk(io138, "C"));
      W(doc, pk(cpu, "IO/~M"), pk(io138, "G1"));
      W(doc, pk(io138, "~G2A"), pk(gnd, "G"));
      W(doc, pk(io138, "~G2B"), pk(gnd, "G"));
      // LED port at 00h: LE = NOR(Y0, ~WR)
      W(doc, pk(io138, "Y0"), pk(nor, "1A"));
      W(doc, pk(cpu, "~WR"), pk(nor, "1B"));
      W(doc, pk(nor, "1Y"), pk(port, "LE"));
      W(doc, pk(port, "~OE"), pk(gnd, "G"));
      bus(doc, cpu, "AD", port, "D", 0, 7, "d3");
      bus(doc, port, "Q", led, "A", 0, 7, "q");
      W(doc, pk(led, "K"), pk(gnd, "G"));
      // 8259A at 20h
      W(doc, pk(io138, "Y1"), pk(pic, "~CS"));
      W(doc, pk(cpu, "~WR"), pk(pic, "~WR"));
      W(doc, pk(cpu, "~RD"), pk(pic, "~RD"));
      bus(doc, cpu, "AD", pic, "D", 0, 7, "d4");
      W(doc, pk(latA, "Q0"), pk(pic, "A0"));
      W(doc, pk(cpu, "~INTA"), pk(pic, "~INTA"));
      W(doc, pk(pic, "INT"), pk(cpu, "INTR"));
      W(doc, pk(pic, "~SP/~EN"), pk(vcc, "V"));
      // 8253 at 40h, ch0 clocked by PCLK
      W(doc, pk(io138, "Y2"), pk(pit, "~CS"));
      W(doc, pk(cpu, "~WR"), pk(pit, "~WR"));
      W(doc, pk(cpu, "~RD"), pk(pit, "~RD"));
      bus(doc, cpu, "AD", pit, "D", 0, 7, "d5");
      W(doc, pk(latA, "Q0"), pk(pit, "A0"));
      W(doc, pk(latA, "Q1"), pk(pit, "A1"));
      W(doc, pk(cg, "PCLK"), pk(pit, "CLK0"));
      W(doc, pk(pit, "GATE0"), pk(vcc, "V"));
      W(doc, pk(pit, "OUT0"), pk(pic, "IR0"));
      // button -> inverter -> IR1 (pressed = high)
      W(doc, pk(btnIr, "B"), pk(pullIr, "P"));
      W(doc, pk(btnIr, "B"), pk(inv, "3A"));
      W(doc, pk(inv, "3Y"), pk(pic, "IR1"));
      spread(doc, 1.2, 1.1);
      return { doc, names };
    },
    makeRom(programBytes, programOrg) {
      const rom = new Uint8Array(8192).fill(0xFF);
      rom.set(programBytes.slice(0, 8192 - 16), (programOrg || 0) & 0x1FFF);
      rom.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0);
      return rom;
    },
  });

  // ---------------------------------------------------------------------------
  // Max-mode 8088 + 8288: the CPU emits encoded status on ~S2..~S0 and the 8288
  // decodes it into ALE/~MRDC/~MWTC/~IOWC — how every multi-processor and 8087
  // system had to do it. Note there is no memory/IO gating logic at all: the
  // command strobes already know the difference.
  K.presets.push({
    id: "max-8088",
    name: "Max-mode 8088 + 8288",
    blurb: "MN/~MX strapped low: the CPU's ~S2..~S0 status is decoded by an 8288 bus controller into ALE and separate memory/IO command strobes. Watch ~MRDC/~MWTC on the waveforms.",
    defaultProgram: [
      "; Max-mode blinky — same program, different bus plumbing",
      "        org 0xE000",
      "start:  mov al, 0x55",
      "        out 0x00, al",
      "        mov cx, 4",
      "d1:     loop d1",
      "        mov al, 0xAA",
      "        out 0x00, al",
      "        mov cx, 4",
      "d2:     loop d2",
      "        jmp start",
    ].join("\n"),
    romComp: "rom",
    build() {
      const doc = K.newDoc();
      const xt = K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
      const cg = K.docAddComponent(doc, "8284A", 2, 6);
      const cpu = K.docAddComponent(doc, "8088", 16, 2);
      const busctl = K.docAddComponent(doc, "8288", 16, 28);
      const latA = K.docAddComponent(doc, "74LS373", 34, 2);
      const inv = K.docAddComponent(doc, "74LS04", 34, 16);
      const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
      const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
      const port = K.docAddComponent(doc, "74LS373", 50, 38);
      const led = K.docAddComponent(doc, "LED8", 64, 38);
      const vcc = K.docAddComponent(doc, "VCC", 2, 20);
      const gnd = K.docAddComponent(doc, "GND", 2, 24);
      const pull = K.docAddComponent(doc, "PULLUP", 2, 28);
      const btn = K.docAddComponent(doc, "BTN", 2, 32);
      const names = { xt, cg, cpu, busctl, latA, inv, rom, ram, port, led, vcc, gnd, pull, btn };

      W(doc, pk(xt, "X1"), pk(cg, "X1"));
      W(doc, pk(xt, "X2"), pk(cg, "X2"));
      W(doc, pk(cg, "CLK"), pk(cpu, "CLK"));
      W(doc, pk(cg, "CLK"), pk(busctl, "CLK"));
      W(doc, pk(cg, "RESET"), pk(cpu, "RESET"));
      W(doc, pk(cg, "READY"), pk(cpu, "READY"));
      W(doc, pk(cg, "~RES"), pk(pull, "P"));
      W(doc, pk(cg, "~RES"), pk(btn, "B"));
      // maximum mode strap + status bus into the 8288
      W(doc, pk(cpu, "MN/~MX"), pk(gnd, "G"));
      W(doc, pk(cpu, "~TEST"), pk(vcc, "V"));
      W(doc, pk(cpu, "NMI"), pk(gnd, "G"));
      W(doc, pk(cpu, "INTR"), pk(gnd, "G"));
      W(doc, pk(cpu, "HOLD"), pk(vcc, "V"));     // ~RQ/~GT0 inactive
      W(doc, pk(cpu, "~DEN"), pk(busctl, "~S0"));
      W(doc, pk(cpu, "DT/~R"), pk(busctl, "~S1"));
      W(doc, pk(cpu, "IO/~M"), pk(busctl, "~S2"));
      W(doc, pk(busctl, "~AEN"), pk(gnd, "G"));
      W(doc, pk(busctl, "CEN"), pk(vcc, "V"));
      W(doc, pk(busctl, "IOB"), pk(gnd, "G"));
      // address demux driven by the 8288's ALE
      bus(doc, cpu, "AD", latA, "D", 0, 7, "ad");
      W(doc, pk(busctl, "ALE"), pk(latA, "LE"));
      W(doc, pk(latA, "~OE"), pk(gnd, "G"));
      // selects: pure A19 split (commands already separate memory from IO)
      W(doc, pk(cpu, "A19"), pk(inv, "1A"));
      W(doc, pk(inv, "1Y"), pk(rom, "~CE"));
      W(doc, pk(cpu, "A19"), pk(ram, "~CS1"));
      W(doc, pk(ram, "CS2"), pk(vcc, "V"));
      bus(doc, latA, "Q", rom, "A", 0, 7, "alo");
      bus(doc, latA, "Q", ram, "A", 0, 7, "alo2");
      for (let i = 8; i <= 12; i++) {
        W(doc, pk(cpu, "A" + i), pk(rom, "A" + i), "ahi");
        W(doc, pk(cpu, "A" + i), pk(ram, "A" + i), "ahi2");
      }
      bus(doc, cpu, "AD", rom, "D", 0, 7, "d1");
      bus(doc, cpu, "AD", ram, "D", 0, 7, "d2");
      // command strobes from the bus controller
      W(doc, pk(busctl, "~MRDC"), pk(rom, "~OE"));
      W(doc, pk(busctl, "~MRDC"), pk(ram, "~OE"));
      W(doc, pk(busctl, "~MWTC"), pk(ram, "~WE"));
      // output port latches on any IO write (~IOWC)
      W(doc, pk(busctl, "~IOWC"), pk(inv, "2A"));
      W(doc, pk(inv, "2Y"), pk(port, "LE"));
      W(doc, pk(port, "~OE"), pk(gnd, "G"));
      bus(doc, cpu, "AD", port, "D", 0, 7, "d3");
      bus(doc, port, "Q", led, "A", 0, 7, "q");
      W(doc, pk(led, "K"), pk(gnd, "G"));
      spread(doc, 1.2, 1.1);
      return { doc, names };
    },
    makeRom(programBytes, programOrg) {
      const rom = new Uint8Array(8192).fill(0xFF);
      rom.set(programBytes.slice(0, 8192 - 16), (programOrg || 0) & 0x1FFF);
      rom.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0);
      return rom;
    },
  });

  // ---------------------------------------------------------------------------
  // 8086 word machine: a true 16-bit bus with two banks per memory — even bytes
  // on D0-7, odd bytes on D8-15. Reads drive both lanes (separate wires, no
  // contention); writes are gated per lane by latched A0 and ~BHE through OR
  // gates. The ROM image is split byte-wise across two 2764s.
  K.presets.push({
    id: "word-8086",
    name: "8086 word machine (byte lanes)",
    blurb: "16-bit data bus done the real way: two banks, even bytes low lane, odd bytes high lane, ~BHE/A0 gating the writes. Try a word write to an ODD address and count the bus cycles.",
    defaultProgram: [
      "; 8086 word machine — exercise both byte lanes",
      "        org 0xE000",
      "start:  xor ax, ax",
      "        mov ds, ax",
      "        mov word [0x100], 0x1234   ; aligned word: ONE bus cycle",
      "        mov word [0x103], 0x5678   ; odd word: TWO byte cycles",
      "        mov al, 0x55",
      "        out 0x00, al",
      "        mov cx, 4",
      "d1:     loop d1",
      "        mov al, 0xAA",
      "        out 0x00, al",
      "        mov cx, 4",
      "d2:     loop d2",
      "        jmp start",
    ].join("\n"),
    build() {
      const doc = K.newDoc();
      const xt = K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
      const cg = K.docAddComponent(doc, "8284A", 2, 6);
      const cpu = K.docAddComponent(doc, "8086", 16, 2);
      const lat0 = K.docAddComponent(doc, "74LS373", 34, 2);
      const lat1 = K.docAddComponent(doc, "74LS373", 34, 16);
      const inv = K.docAddComponent(doc, "74LS04", 34, 30);
      const or32 = K.docAddComponent(doc, "74LS32", 34, 40);
      const nor02 = K.docAddComponent(doc, "74LS02", 34, 50);
      const romL = K.docAddComponent(doc, "EPROM2764", 50, 2);
      const romH = K.docAddComponent(doc, "EPROM2764", 66, 2);
      const ramL = K.docAddComponent(doc, "SRAM6264", 50, 20);
      const ramH = K.docAddComponent(doc, "SRAM6264", 66, 20);
      const port = K.docAddComponent(doc, "74LS373", 50, 38);
      const led = K.docAddComponent(doc, "LED8", 64, 38);
      const vcc = K.docAddComponent(doc, "VCC", 2, 20);
      const gnd = K.docAddComponent(doc, "GND", 2, 24);
      const pull = K.docAddComponent(doc, "PULLUP", 2, 28);
      const btn = K.docAddComponent(doc, "BTN", 2, 32);
      const names = { xt, cg, cpu, lat0, lat1, inv, or32, nor02, romL, romH, ramL, ramH, port, led, vcc, gnd, pull, btn };

      W(doc, pk(xt, "X1"), pk(cg, "X1"));
      W(doc, pk(xt, "X2"), pk(cg, "X2"));
      W(doc, pk(cg, "CLK"), pk(cpu, "CLK"));
      W(doc, pk(cg, "RESET"), pk(cpu, "RESET"));
      W(doc, pk(cg, "READY"), pk(cpu, "READY"));
      W(doc, pk(cg, "~RES"), pk(pull, "P"));
      W(doc, pk(cg, "~RES"), pk(btn, "B"));
      W(doc, pk(cpu, "MN/~MX"), pk(vcc, "V"));
      W(doc, pk(cpu, "~TEST"), pk(vcc, "V"));
      W(doc, pk(cpu, "NMI"), pk(gnd, "G"));
      W(doc, pk(cpu, "INTR"), pk(gnd, "G"));
      W(doc, pk(cpu, "HOLD"), pk(gnd, "G"));
      // two address latches for the 16 muxed lines
      bus(doc, cpu, "AD", lat0, "D", 0, 7, "adL");
      for (let i = 0; i < 8; i++) W(doc, pk(cpu, "AD" + (8 + i)), pk(lat1, "D" + i), "adH");
      W(doc, pk(cpu, "ALE"), pk(lat0, "LE"));
      W(doc, pk(cpu, "ALE"), pk(lat1, "LE"));
      W(doc, pk(lat0, "~OE"), pk(gnd, "G"));
      W(doc, pk(lat1, "~OE"), pk(gnd, "G"));
      // selects: A19 splits ROM (high) from RAM (low)
      W(doc, pk(cpu, "A19"), pk(inv, "1A"));
      for (const rom of [romL, romH]) W(doc, pk(inv, "1Y"), pk(rom, "~CE"));
      for (const ram of [ramL, ramH]) {
        W(doc, pk(cpu, "A19"), pk(ram, "~CS1"));
        W(doc, pk(ram, "CS2"), pk(vcc, "V"));
      }
      // word addressing: bank A0..A12 <- latched A1..A13
      for (const chip of [romL, romH, ramL, ramH]) {
        for (let i = 0; i < 7; i++) W(doc, pk(lat0, "Q" + (i + 1)), pk(chip, "A" + i), "wal");
        for (let i = 0; i < 6; i++) W(doc, pk(lat1, "Q" + i), pk(chip, "A" + (i + 7)), "wah");
        W(doc, pk(cpu, "~RD"), pk(chip, "~OE"));
      }
      // data lanes
      bus(doc, cpu, "AD", romL, "D", 0, 7, "dl1");
      bus(doc, cpu, "AD", ramL, "D", 0, 7, "dl2");
      for (let i = 0; i < 8; i++) {
        W(doc, pk(cpu, "AD" + (8 + i)), pk(romH, "D" + i), "dh1");
        W(doc, pk(cpu, "AD" + (8 + i)), pk(ramH, "D" + i), "dh2");
      }
      // write gating per lane: ~WE = ~WR OR (lane disqualifier)
      W(doc, pk(cpu, "~WR"), pk(or32, "1A"));
      W(doc, pk(lat0, "Q0"), pk(or32, "1B"));     // A0=1 -> low lane not written
      W(doc, pk(or32, "1Y"), pk(ramL, "~WE"));
      W(doc, pk(cpu, "~WR"), pk(or32, "2A"));
      W(doc, pk(cpu, "~BHE"), pk(or32, "2B"));    // ~BHE=1 -> high lane not written
      W(doc, pk(or32, "2Y"), pk(ramH, "~WE"));
      // 8-bit output port on the low lane: LE = NOR(M/~IO, ~WR)
      W(doc, pk(cpu, "M/~IO"), pk(nor02, "1A"));
      W(doc, pk(cpu, "~WR"), pk(nor02, "1B"));
      W(doc, pk(nor02, "1Y"), pk(port, "LE"));
      W(doc, pk(port, "~OE"), pk(gnd, "G"));
      bus(doc, cpu, "AD", port, "D", 0, 7, "dp");
      bus(doc, port, "Q", led, "A", 0, 7, "q");
      W(doc, pk(led, "K"), pk(gnd, "G"));
      spread(doc, 1.2, 1.1);
      return { doc, names };
    },
    // Split a linear 16K top-of-memory image byte-wise across the two 2764s.
    programImages(programBytes, programOrg) {
      const lin = new Uint8Array(16384).fill(0xFF);
      lin.set(programBytes.slice(0, 16384 - 16), (programOrg || 0) & 0x3FFF);
      lin.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x3FF0); // FFFF0: JMP F000:E000
      const even = new Uint8Array(8192), odd = new Uint8Array(8192);
      for (let i = 0; i < 8192; i++) { even[i] = lin[i * 2]; odd[i] = lin[i * 2 + 1]; }
      return [{ comp: "romL", image: even }, { comp: "romH", image: odd }];
    },
  });

  // ---------------------------------------------------------------------------
  // Hercules video kit: the minimal 8088 plus an HGC card at B0000 and a mono
  // CRT. Command strobes (~MEMR/~MEMW/~IOR/~IOW) are built from ~RD/~WR + IO/~M
  // with four OR gates — the classic ISA-style bus interface.
  K.presets.push({
    id: "hgc-8088",
    speedIdx: 8,
    name: "Hercules video kit",
    blurb: "An 8088 writing straight into video memory at B000:0000. The monitor shows a live picture right on the board — double-click it for the full phosphor CRT.",
    defaultProgram: [
      "; Write text into HGC video RAM at B000:0000",
      "        org 0xE000",
      "start:  mov ax, 0xB000",
      "        mov es, ax",
      "        mov ax, cs",
      "        mov ds, ax",
      "        cld",
      "        xor di, di",
      "        mov si, msg",
      "ploop:  lodsb",
      "        test al, al",
      "        jz frame",
      "        stosb",
      "        mov al, 0x07       ; normal attribute",
      "        stosb",
      "        jmp ploop",
      "frame:  mov di, 160*2      ; row 2: spinning character",
      "        mov byte es:[di], 0x41",
      "spin:   inc byte es:[di]",
      "        mov al, 0x0F",
      "        mov es:[di+1], al  ; bright",
      "        mov cx, 2000",
      "d1:     loop d1",
      "        jmp spin",
      "",
      "msg:    db \"HELLO FROM THE HERCULES CARD\", 0",
    ].join("\n"),
    romComp: "rom",
    build() {
      const doc = K.newDoc();
      const xt = K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
      const cg = K.docAddComponent(doc, "8284A", 2, 6);
      const cpu = K.docAddComponent(doc, "8088", 16, 2);
      const latA = K.docAddComponent(doc, "74LS373", 34, 2);
      const inv = K.docAddComponent(doc, "74LS04", 34, 16);
      const dec = K.docAddComponent(doc, "74LS138", 34, 26);
      const or32 = K.docAddComponent(doc, "74LS32", 34, 36);
      const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
      const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
      const hgc = K.docAddComponent(doc, "HGC", 66, 2);
      const crt = K.docAddComponent(doc, "CRT", 84, 6);
      const vcc = K.docAddComponent(doc, "VCC", 2, 20);
      const gnd = K.docAddComponent(doc, "GND", 2, 24);
      const pull = K.docAddComponent(doc, "PULLUP", 2, 28);
      const btn = K.docAddComponent(doc, "BTN", 2, 32);
      const names = { xt, cg, cpu, latA, inv, dec, or32, rom, ram, hgc, crt, vcc, gnd, pull, btn };

      W(doc, pk(xt, "X1"), pk(cg, "X1"));
      W(doc, pk(xt, "X2"), pk(cg, "X2"));
      W(doc, pk(cg, "CLK"), pk(cpu, "CLK"));
      W(doc, pk(cg, "RESET"), pk(cpu, "RESET"));
      W(doc, pk(cg, "READY"), pk(cpu, "READY"));
      W(doc, pk(cg, "~RES"), pk(pull, "P"));
      W(doc, pk(cg, "~RES"), pk(btn, "B"));
      W(doc, pk(cpu, "MN/~MX"), pk(vcc, "V"));
      W(doc, pk(cpu, "~TEST"), pk(vcc, "V"));
      W(doc, pk(cpu, "NMI"), pk(gnd, "G"));
      W(doc, pk(cpu, "INTR"), pk(gnd, "G"));
      W(doc, pk(cpu, "HOLD"), pk(gnd, "G"));
      bus(doc, cpu, "AD", latA, "D", 0, 7, "ad");
      W(doc, pk(cpu, "ALE"), pk(latA, "LE"));
      W(doc, pk(latA, "~OE"), pk(gnd, "G"));
      // proper 128K-granule decode: the VRAM window must not collide with ROM,
      // so a '138 on A17..A19 carves the map — RAM at Y0, ROM at Y7 (E0000+)
      W(doc, pk(cpu, "IO/~M"), pk(inv, "1A"));
      W(doc, pk(cpu, "A17"), pk(dec, "A"));
      W(doc, pk(cpu, "A18"), pk(dec, "B"));
      W(doc, pk(cpu, "A19"), pk(dec, "C"));
      W(doc, pk(inv, "1Y"), pk(dec, "G1"));
      W(doc, pk(dec, "~G2A"), pk(gnd, "G"));
      W(doc, pk(dec, "~G2B"), pk(gnd, "G"));
      W(doc, pk(dec, "Y7"), pk(rom, "~CE"));
      W(doc, pk(dec, "Y0"), pk(ram, "~CS1"));
      W(doc, pk(ram, "CS2"), pk(vcc, "V"));
      bus(doc, latA, "Q", rom, "A", 0, 7, "alo");
      bus(doc, latA, "Q", ram, "A", 0, 7, "alo2");
      for (let i = 8; i <= 12; i++) {
        W(doc, pk(cpu, "A" + i), pk(rom, "A" + i), "ahi");
        W(doc, pk(cpu, "A" + i), pk(ram, "A" + i), "ahi2");
      }
      bus(doc, cpu, "AD", rom, "D", 0, 7, "d1");
      bus(doc, cpu, "AD", ram, "D", 0, 7, "d2");
      W(doc, pk(cpu, "~RD"), pk(rom, "~OE"));
      W(doc, pk(cpu, "~RD"), pk(ram, "~OE"));
      W(doc, pk(cpu, "~WR"), pk(ram, "~WE"));
      // ISA-style command strobes for the card
      W(doc, pk(cpu, "~RD"), pk(or32, "1A"));
      W(doc, pk(cpu, "IO/~M"), pk(or32, "1B"));
      W(doc, pk(or32, "1Y"), pk(hgc, "~MEMR"));
      W(doc, pk(cpu, "~WR"), pk(or32, "2A"));
      W(doc, pk(cpu, "IO/~M"), pk(or32, "2B"));
      W(doc, pk(or32, "2Y"), pk(hgc, "~MEMW"));
      W(doc, pk(cpu, "~RD"), pk(or32, "3A"));
      W(doc, pk(inv, "1Y"), pk(or32, "3B"));
      W(doc, pk(or32, "3Y"), pk(hgc, "~IOR"));
      W(doc, pk(cpu, "~WR"), pk(or32, "4A"));
      W(doc, pk(inv, "1Y"), pk(or32, "4B"));
      W(doc, pk(or32, "4Y"), pk(hgc, "~IOW"));
      // full address bus into the card (low 8 latched, upper direct)
      bus(doc, latA, "Q", hgc, "A", 0, 7, "va");
      for (let i = 8; i <= 19; i++) W(doc, pk(cpu, "A" + i), pk(hgc, "A" + i), "vah");
      bus(doc, cpu, "AD", hgc, "D", 0, 7, "vd");
      // monitor
      W(doc, pk(hgc, "HSYNC"), pk(crt, "HSYNC"));
      W(doc, pk(hgc, "VSYNC"), pk(crt, "VSYNC"));
      W(doc, pk(hgc, "VIDEO"), pk(crt, "VIDEO"));
      spread(doc, 1.25, 1.12);
      return { doc, names };
    },
    makeRom(programBytes, programOrg) {
      const rom = new Uint8Array(8192).fill(0xFF);
      rom.set(programBytes.slice(0, 8192 - 16), (programOrg || 0) & 0x1FFF);
      rom.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0);
      return rom;
    },
  });

  // ---------------------------------------------------------------------------
  // PC typewriter: the closest board yet to a real PC. XT keyboard streams serial
  // scancodes into a shift register, which raises IRQ1 through the 8259A; the
  // handler reads the code from the 8255 at port 60h, acks via PB7, translates,
  // and writes the character into HGC video RAM. Type on your real keyboard.
  K.presets.push({
    id: "kbd-8088",
    speedIdx: 8,
    name: "PC typewriter (keyboard + video)",
    blurb: "Serial keyboard → '322 shift register → IRQ1 → 8259A → INT 9 handler → port 60h → video RAM. Probe KCLK/KDATA to watch scancodes fly bit by bit.",
    defaultProgram: [
      "; PC typewriter — INT 9 keyboard handler writing to the HGC",
      "        org 0xE000",
      "start:  cli",
      "        cld",
      "        xor ax, ax",
      "        mov ds, ax",
      "        mov ss, ax",
      "        mov sp, 0x1F00",
      "        mov word [9*4], kb_isr     ; vector 9 = IRQ1",
      "        mov word [9*4+2], 0xF000",
      "        mov word [0x200], 320      ; cursor -> row 2",
      "        mov al, 0x13               ; 8259A: edge, single, ICW4",
      "        out 0x20, al",
      "        mov al, 0x08",
      "        out 0x21, al",
      "        mov al, 0x01",
      "        out 0x21, al",
      "        mov al, 0xFD               ; unmask IRQ1 only",
      "        out 0x21, al",
      "        mov al, 0x90               ; 8255: A=in (scancode), B=out (ack)",
      "        out 0x63, al",
      "        mov al, 0x00",
      "        out 0x61, al               ; PB7 low: shift register armed",
      "        mov ax, 0xB000",
      "        mov es, ax",
      "        mov ax, cs",
      "        mov ds, ax",
      "        mov si, msg",
      "        xor di, di",
      "ploop:  lodsb",
      "        test al, al",
      "        jz pdone",
      "        stosb",
      "        mov al, 0x07",
      "        stosb",
      "        jmp ploop",
      "pdone:  xor ax, ax",
      "        mov ds, ax",
      "        sti",
      "idle:   hlt",
      "        jmp idle",
      "",
      "kb_isr: push ax",
      "        push bx",
      "        push cx",
      "        push dx",
      "        push si",
      "        push di",
      "        push es",
      "        in al, 0x60                ; scancode from the shift register",
      "        mov bl, al",
      "        mov al, 0x80               ; ack: pulse PB7",
      "        out 0x61, al",
      "        mov al, 0x00",
      "        out 0x61, al",
      "        test bl, 0x80              ; ignore break codes",
      "        jnz kdone",
      "        cmp bl, 0x39",
      "        ja kdone",
      "        mov al, bl",
      "        xor ah, ah",
      "        mov si, ax",
      "        mov al, cs:[si+sctab]",
      "        test al, al",
      "        jz kdone",
      "        cmp al, 0x0D",
      "        je knl",
      "        mov bh, al                 ; save the char before AX is reloaded",
      "        mov ax, 0xB000",
      "        mov es, ax",
      "        mov di, [0x200]",
      "        mov es:[di], bh",
      "        mov byte es:[di+1], 0x0F",
      "        add di, 2",
      "        mov [0x200], di",
      "        jmp kdone",
      "knl:    mov ax, [0x200]            ; carriage return: next row",
      "        xor dx, dx",
      "        mov cx, 160",
      "        div cx",
      "        inc ax",
      "        mul cx",
      "        mov [0x200], ax",
      "kdone:  mov al, 0x20               ; EOI",
      "        out 0x20, al",
      "        pop es",
      "        pop di",
      "        pop si",
      "        pop dx",
      "        pop cx",
      "        pop bx",
      "        pop ax",
      "        iret",
      "",
      "sctab:  db 0, 0",
      "        db \"1234567890-=\"",
      "        db 0, 0",
      "        db \"qwertyuiop[]\"",
      "        db 0x0D, 0",
      "        db \"asdfghjkl;'\"",
      "        db 0x60, 0, 0x5C",
      "        db \"zxcvbnm,./\"",
      "        db 0, 0x2A, 0, 0x20",
      "msg:    db \"READY - TYPE ON YOUR KEYBOARD\", 0",
    ].join("\n"),
    romComp: "rom",
    build() {
      const doc = K.newDoc();
      const xt = K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
      const cg = K.docAddComponent(doc, "8284A", 2, 6);
      const cpu = K.docAddComponent(doc, "8088", 16, 2);
      const latA = K.docAddComponent(doc, "74LS373", 34, 2);
      const inv = K.docAddComponent(doc, "74LS04", 34, 16);
      const dec = K.docAddComponent(doc, "74LS138", 34, 26);
      const io138 = K.docAddComponent(doc, "74LS138", 34, 36);
      const or32 = K.docAddComponent(doc, "74LS32", 34, 46);
      const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
      const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
      const pic = K.docAddComponent(doc, "8259A", 66, 2);
      const ppi = K.docAddComponent(doc, "8255", 66, 20);
      const kbshift = K.docAddComponent(doc, "KBDSHIFT", 60, 44);
      const kbd = K.docAddComponent(doc, "XTKBD", 30, 58);
      const hgc = K.docAddComponent(doc, "HGC", 84, 2);
      const crt = K.docAddComponent(doc, "CRT", 102, 6);
      const vcc = K.docAddComponent(doc, "VCC", 2, 20);
      const gnd = K.docAddComponent(doc, "GND", 2, 24);
      const pull = K.docAddComponent(doc, "PULLUP", 2, 28);
      const btn = K.docAddComponent(doc, "BTN", 2, 32);
      const names = { xt, cg, cpu, latA, inv, dec, io138, or32, rom, ram, pic, ppi, kbshift, kbd, hgc, crt, vcc, gnd, pull, btn };

      W(doc, pk(xt, "X1"), pk(cg, "X1"));
      W(doc, pk(xt, "X2"), pk(cg, "X2"));
      W(doc, pk(cg, "CLK"), pk(cpu, "CLK"));
      W(doc, pk(cg, "RESET"), pk(cpu, "RESET"));
      W(doc, pk(cg, "READY"), pk(cpu, "READY"));
      W(doc, pk(cg, "~RES"), pk(pull, "P"));
      W(doc, pk(cg, "~RES"), pk(btn, "B"));
      W(doc, pk(cpu, "MN/~MX"), pk(vcc, "V"));
      W(doc, pk(cpu, "~TEST"), pk(vcc, "V"));
      W(doc, pk(cpu, "NMI"), pk(gnd, "G"));
      W(doc, pk(cpu, "HOLD"), pk(gnd, "G"));
      bus(doc, cpu, "AD", latA, "D", 0, 7, "ad");
      W(doc, pk(cpu, "ALE"), pk(latA, "LE"));
      W(doc, pk(latA, "~OE"), pk(gnd, "G"));
      // memory decode: RAM at 00000 (Y0), ROM at E0000+ (Y7)
      W(doc, pk(cpu, "IO/~M"), pk(inv, "1A"));
      W(doc, pk(cpu, "A17"), pk(dec, "A"));
      W(doc, pk(cpu, "A18"), pk(dec, "B"));
      W(doc, pk(cpu, "A19"), pk(dec, "C"));
      W(doc, pk(inv, "1Y"), pk(dec, "G1"));
      W(doc, pk(dec, "~G2A"), pk(gnd, "G"));
      W(doc, pk(dec, "~G2B"), pk(gnd, "G"));
      W(doc, pk(dec, "Y7"), pk(rom, "~CE"));
      W(doc, pk(dec, "Y0"), pk(ram, "~CS1"));
      W(doc, pk(ram, "CS2"), pk(vcc, "V"));
      bus(doc, latA, "Q", rom, "A", 0, 7, "alo");
      bus(doc, latA, "Q", ram, "A", 0, 7, "alo2");
      for (let i = 8; i <= 12; i++) {
        W(doc, pk(cpu, "A" + i), pk(rom, "A" + i), "ahi");
        W(doc, pk(cpu, "A" + i), pk(ram, "A" + i), "ahi2");
      }
      bus(doc, cpu, "AD", rom, "D", 0, 7, "d1");
      bus(doc, cpu, "AD", ram, "D", 0, 7, "d2");
      W(doc, pk(cpu, "~RD"), pk(rom, "~OE"));
      W(doc, pk(cpu, "~RD"), pk(ram, "~OE"));
      W(doc, pk(cpu, "~WR"), pk(ram, "~WE"));
      // IO decode on latched A5..A7: Y1=20h PIC, Y3=60h PPI
      W(doc, pk(latA, "Q5"), pk(io138, "A"));
      W(doc, pk(latA, "Q6"), pk(io138, "B"));
      W(doc, pk(latA, "Q7"), pk(io138, "C"));
      W(doc, pk(cpu, "IO/~M"), pk(io138, "G1"));
      W(doc, pk(io138, "~G2A"), pk(gnd, "G"));
      W(doc, pk(io138, "~G2B"), pk(gnd, "G"));
      // 8259A at 20h
      W(doc, pk(io138, "Y1"), pk(pic, "~CS"));
      W(doc, pk(cpu, "~WR"), pk(pic, "~WR"));
      W(doc, pk(cpu, "~RD"), pk(pic, "~RD"));
      bus(doc, cpu, "AD", pic, "D", 0, 7, "d3");
      W(doc, pk(latA, "Q0"), pk(pic, "A0"));
      W(doc, pk(cpu, "~INTA"), pk(pic, "~INTA"));
      W(doc, pk(pic, "INT"), pk(cpu, "INTR"));
      W(doc, pk(pic, "~SP/~EN"), pk(vcc, "V"));
      // 8255 at 60h: PA <- scancode, PB7 -> ack/clear
      W(doc, pk(io138, "Y3"), pk(ppi, "~CS"));
      W(doc, pk(cpu, "~RD"), pk(ppi, "~RD"));
      W(doc, pk(cpu, "~WR"), pk(ppi, "~WR"));
      W(doc, pk(cg, "RESET"), pk(ppi, "RESET"));
      W(doc, pk(latA, "Q0"), pk(ppi, "A0"));
      W(doc, pk(latA, "Q1"), pk(ppi, "A1"));
      bus(doc, cpu, "AD", ppi, "D", 0, 7, "d4");
      bus(doc, kbshift, "Q", ppi, "PA", 0, 7, "ka");
      W(doc, pk(ppi, "PB7"), pk(kbshift, "CLR"));
      // serial keyboard link
      W(doc, pk(kbd, "KDATA"), pk(kbshift, "SER"));
      W(doc, pk(kbd, "KCLK"), pk(kbshift, "CLK"));
      W(doc, pk(kbshift, "FULL"), pk(pic, "IR1"));
      // HGC + CRT with ISA-style strobes
      W(doc, pk(cpu, "~RD"), pk(or32, "1A"));
      W(doc, pk(cpu, "IO/~M"), pk(or32, "1B"));
      W(doc, pk(or32, "1Y"), pk(hgc, "~MEMR"));
      W(doc, pk(cpu, "~WR"), pk(or32, "2A"));
      W(doc, pk(cpu, "IO/~M"), pk(or32, "2B"));
      W(doc, pk(or32, "2Y"), pk(hgc, "~MEMW"));
      W(doc, pk(cpu, "~RD"), pk(or32, "3A"));
      W(doc, pk(inv, "1Y"), pk(or32, "3B"));
      W(doc, pk(or32, "3Y"), pk(hgc, "~IOR"));
      W(doc, pk(cpu, "~WR"), pk(or32, "4A"));
      W(doc, pk(inv, "1Y"), pk(or32, "4B"));
      W(doc, pk(or32, "4Y"), pk(hgc, "~IOW"));
      bus(doc, latA, "Q", hgc, "A", 0, 7, "va");
      for (let i = 8; i <= 19; i++) W(doc, pk(cpu, "A" + i), pk(hgc, "A" + i), "vah");
      bus(doc, cpu, "AD", hgc, "D", 0, 7, "vd");
      W(doc, pk(hgc, "HSYNC"), pk(crt, "HSYNC"));
      W(doc, pk(hgc, "VSYNC"), pk(crt, "VSYNC"));
      W(doc, pk(hgc, "VIDEO"), pk(crt, "VIDEO"));
      spread(doc, 1.25, 1.12);
      return { doc, names };
    },
    makeRom(programBytes, programOrg) {
      const rom = new Uint8Array(8192).fill(0xFF);
      rom.set(programBytes.slice(0, 8192 - 16), (programOrg || 0) & 0x1FFF);
      rom.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0);
      return rom;
    },
  });

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Serial console lab: an 8250 UART card at 3F8h. The program brings the line
  // up at 9600 8N1, prints a prompt, and echoes whatever arrives — open the
  // terminal (double-click the COM card) and talk to your own machine.
  K.presets.push({
    id: "uart-lab",
    name: "Serial console (8250 UART)",
    speedIdx: 8,
    blurb: "Polled serial I/O the way BIOSes did it: LSR bit 5 gates transmit, bit 0 signals receive. Double-click the COM card for a live terminal.",
    defaultProgram: [
      "; 8250 echo console at 3F8h",
      "        org 0xE000",
      "start:  cli",
      "        xor ax, ax",
      "        mov ss, ax",
      "        mov sp, 0x1F00",
      "        mov dx, 0x3FB      ; LCR: DLAB on",
      "        mov al, 0x80",
      "        out dx, al",
      "        mov dx, 0x3F8      ; divisor 12 -> 9600 baud",
      "        mov al, 12",
      "        out dx, al",
      "        mov dx, 0x3F9",
      "        mov al, 0",
      "        out dx, al",
      "        mov dx, 0x3FB      ; 8N1, DLAB off",
      "        mov al, 0x03",
      "        out dx, al",
      "        mov ax, cs",
      "        mov ds, ax",
      "        mov si, msg",
      "ploop:  lodsb",
      "        test al, al",
      "        jz echo",
      "        call putc",
      "        jmp ploop",
      "echo:   mov dx, 0x3FD      ; LSR: data ready?",
      "        in al, dx",
      "        test al, 1",
      "        jz echo",
      "        mov dx, 0x3F8",
      "        in al, dx          ; read the byte",
      "        call putc          ; and echo it back",
      "        cmp al, 0x0D",
      "        jne echo",
      "        mov al, 0x0A       ; CR -> also send LF",
      "        call putc",
      "        jmp echo",
      "",
      "putc:   push ax",
      "pwait:  mov dx, 0x3FD      ; wait for THRE",
      "        in al, dx",
      "        test al, 0x20",
      "        jz pwait",
      "        pop ax",
      "        mov dx, 0x3F8",
      "        out dx, al",
      "        ret",
      "",
      "msg:    db \"uSYSTEM 8086 serial console\", 0x0D, 0x0A, \"you type, the 8088 echoes> \", 0",
    ].join("\n"),
    romComp: "rom",
    build() {
      const doc = K.newDoc();
      const xt = K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
      const cg = K.docAddComponent(doc, "8284A", 2, 6);
      const cpu = K.docAddComponent(doc, "8088", 16, 2);
      const latA = K.docAddComponent(doc, "74LS373", 34, 2);
      const inv = K.docAddComponent(doc, "74LS04", 34, 16);
      const nand = K.docAddComponent(doc, "74LS00", 34, 26);
      const or32 = K.docAddComponent(doc, "74LS32", 34, 36);
      const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
      const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
      const com = K.docAddComponent(doc, "COM8250", 66, 2);
      const vcc = K.docAddComponent(doc, "VCC", 2, 20);
      const gnd = K.docAddComponent(doc, "GND", 2, 24);
      const pull = K.docAddComponent(doc, "PULLUP", 2, 28);
      const btn = K.docAddComponent(doc, "BTN", 2, 32);
      const names = { xt, cg, cpu, latA, inv, nand, or32, rom, ram, com, vcc, gnd, pull, btn };
      W(doc, pk(xt, "X1"), pk(cg, "X1"));
      W(doc, pk(xt, "X2"), pk(cg, "X2"));
      W(doc, pk(cg, "CLK"), pk(cpu, "CLK"));
      W(doc, pk(cg, "RESET"), pk(cpu, "RESET"));
      W(doc, pk(cg, "READY"), pk(cpu, "READY"));
      W(doc, pk(cg, "~RES"), pk(pull, "P"));
      W(doc, pk(cg, "~RES"), pk(btn, "B"));
      W(doc, pk(cpu, "MN/~MX"), pk(vcc, "V"));
      W(doc, pk(cpu, "~TEST"), pk(vcc, "V"));
      W(doc, pk(cpu, "NMI"), pk(gnd, "G"));
      W(doc, pk(cpu, "INTR"), pk(gnd, "G"));
      W(doc, pk(cpu, "HOLD"), pk(gnd, "G"));
      bus(doc, cpu, "AD", latA, "D", 0, 7, "ad");
      W(doc, pk(cpu, "ALE"), pk(latA, "LE"));
      W(doc, pk(latA, "~OE"), pk(gnd, "G"));
      W(doc, pk(cpu, "IO/~M"), pk(inv, "1A"));
      W(doc, pk(inv, "1Y"), pk(nand, "1B"));
      W(doc, pk(inv, "1Y"), pk(nand, "2B"));
      W(doc, pk(cpu, "A19"), pk(nand, "1A"));
      W(doc, pk(cpu, "A19"), pk(inv, "2A"));
      W(doc, pk(inv, "2Y"), pk(nand, "2A"));
      W(doc, pk(nand, "1Y"), pk(rom, "~CE"));
      W(doc, pk(nand, "2Y"), pk(ram, "~CS1"));
      W(doc, pk(ram, "CS2"), pk(vcc, "V"));
      bus(doc, latA, "Q", rom, "A", 0, 7, "alo");
      bus(doc, latA, "Q", ram, "A", 0, 7, "alo2");
      for (let i = 8; i <= 12; i++) {
        W(doc, pk(cpu, "A" + i), pk(rom, "A" + i), "ahi");
        W(doc, pk(cpu, "A" + i), pk(ram, "A" + i), "ahi2");
      }
      bus(doc, cpu, "AD", rom, "D", 0, 7, "d1");
      bus(doc, cpu, "AD", ram, "D", 0, 7, "d2");
      W(doc, pk(cpu, "~RD"), pk(rom, "~OE"));
      W(doc, pk(cpu, "~RD"), pk(ram, "~OE"));
      W(doc, pk(cpu, "~WR"), pk(ram, "~WE"));
      // strobes for the card
      W(doc, pk(cpu, "~RD"), pk(or32, "3A"));
      W(doc, pk(inv, "1Y"), pk(or32, "3B"));
      W(doc, pk(or32, "3Y"), pk(com, "~IOR"));
      W(doc, pk(cpu, "~WR"), pk(or32, "4A"));
      W(doc, pk(inv, "1Y"), pk(or32, "4B"));
      W(doc, pk(or32, "4Y"), pk(com, "~IOW"));
      for (let i = 0; i <= 7; i++) W(doc, pk(latA, "Q" + i), pk(com, "A" + i), "ca");
      W(doc, pk(cpu, "A8"), pk(com, "A8"));
      W(doc, pk(cpu, "A9"), pk(com, "A9"));
      W(doc, pk(cg, "RESET"), pk(com, "RESET"));
      bus(doc, cpu, "AD", com, "D", 0, 7, "cd");
      spread(doc, 1.2, 1.1);
      return { doc, names };
    },
    makeRom(programBytes, programOrg) {
      const rom = new Uint8Array(8192).fill(0xFF);
      rom.set(programBytes.slice(0, 8192 - 16), (programOrg || 0) & 0x1FFF);
      rom.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0);
      return rom;
    },
  });

  // THE PC/XT: 8088 + 512K SRAM + GLaBIOS in the EPROM + 8237A DMA + µPD765
  // floppy + 8259A + 8253 (PCLK/2 = 1.19 MHz via a '74) + 8255 with real XT DIP
  // switches muxed onto port 62h by a '157 + XT keyboard + Hercules video.
  // Boots GLaBIOS, then FreeDOS from the embedded 1.44M floppy image.
  K.presets.push({
    id: "pc-xt",
    name: "PC/XT — boots FreeDOS",
    speedIdx: 9,
    blurb: "A full XT-class machine wired chip by chip. GLaBIOS (GPL-3, 640KB.github.io) POSTs, reads the boot sector over DMA channel 2 from the µPD765, and FreeDOS (GPL) comes up on the phosphor. The Code tab is unused — the machine runs its own BIOS.",
    lab: [
      "Press Start, then ⚡ turbo, and wait for GLaBIOS to POST. The full inventory — RAM, COM, keyboard, the XTIDE option ROM — is real emulated hardware.",
      "The POST beep is real too: PIT channel 2, gated by PPI port B, through an AND gate into the speaker. Double-click the speaker to see the tone.",
      "Let FreeDOS boot from the embedded floppy. Type on YOUR keyboard: keystrokes travel the serial keyboard protocol into IRQ1.",
      "Double-click the floppy controller: watch the DMA channel move sectors while DIR is listing. Then double-click the XTIDE card and browse the hard disk.",
      "Insert your own floppy image (Disk tools) and boot something else entirely.",
    ],
    defaultProgram: [
      "; This board runs GLaBIOS from the EPROM — no user program needed.",
      "; POST -> INT 19h -> boot sector at 0000:7C00 -> FreeDOS.",
      "; Watch POST codes in the 8237A's programmer's view (port 80h).",
    ].join("\n"),
    build() {
      const doc = K.newDoc();
      const xt = K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
      const cg = K.docAddComponent(doc, "8284A", 2, 6);
      const cpu = K.docAddComponent(doc, "8088", 16, 2);
      const latA = K.docAddComponent(doc, "74LS373", 34, 2);
      const inv = K.docAddComponent(doc, "74LS04", 34, 16);
      const dec = K.docAddComponent(doc, "74LS138", 34, 26);
      const io138 = K.docAddComponent(doc, "74LS138", 34, 36);
      const or32 = K.docAddComponent(doc, "74LS32", 34, 46);
      const or2 = K.docAddComponent(doc, "74LS32", 34, 56);
      const div74 = K.docAddComponent(doc, "74LS74", 34, 66);
      const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
      const ram = K.docAddComponent(doc, "SRAM628512", 50, 20);
      const dma = K.docAddComponent(doc, "8237A", 66, 2);
      const pic = K.docAddComponent(doc, "8259A", 66, 22);
      const pit = K.docAddComponent(doc, "8253", 66, 40);
      const and08 = K.docAddComponent(doc, "74LS08", 60, 56);
      const spkr = K.docAddComponent(doc, "SPKR", 74, 56);
      const ppi = K.docAddComponent(doc, "8255", 84, 40);
      const mux = K.docAddComponent(doc, "74LS157", 100, 44);
      const sw = K.docAddComponent(doc, "SW8", 110, 44, { bits: 0x3D }); // floppy, no FPU, 256K, MDA, 1 drive
      const fdc = K.docAddComponent(doc, "UPD765", 50, 44);
      const dec2 = K.docAddComponent(doc, "74LS138", 34, 76);
      const xubrom = K.docAddComponent(doc, "EPROM27128", 50, 62);
      const ide = K.docAddComponent(doc, "XTIDE", 66, 58);
      const com = K.docAddComponent(doc, "COM8250", 84, 58);
      const kbshift = K.docAddComponent(doc, "KBDSHIFT", 100, 56);
      const kbd = K.docAddComponent(doc, "XTKBD", 74, 72, {});
      const hgc = K.docAddComponent(doc, "HGC", 84, 2);
      const crt = K.docAddComponent(doc, "CRT", 102, 6);
      const vcc = K.docAddComponent(doc, "VCC", 2, 20);
      const gnd = K.docAddComponent(doc, "GND", 2, 24);
      const pull = K.docAddComponent(doc, "PULLUP", 2, 28);
      const btn = K.docAddComponent(doc, "BTN", 2, 32);
      const names = { xt, cg, cpu, latA, inv, dec, dec2, io138, or32, or2, div74, and08, spkr, rom, xubrom, ram, dma, pic, pit, ppi, mux, sw, fdc, ide, com, kbshift, kbd, hgc, crt, vcc, gnd, pull, btn };
      fdc.props.imageAsset = "freedos144";

      // clock, reset, straps
      W(doc, pk(xt, "X1"), pk(cg, "X1"));
      W(doc, pk(xt, "X2"), pk(cg, "X2"));
      W(doc, pk(cg, "CLK"), pk(cpu, "CLK"));
      W(doc, pk(cg, "RESET"), pk(cpu, "RESET"));
      W(doc, pk(cg, "READY"), pk(cpu, "READY"));
      W(doc, pk(cg, "~RES"), pk(pull, "P"));
      W(doc, pk(cg, "~RES"), pk(btn, "B"));
      W(doc, pk(cpu, "MN/~MX"), pk(vcc, "V"));
      W(doc, pk(cpu, "~TEST"), pk(vcc, "V"));
      W(doc, pk(cpu, "NMI"), pk(gnd, "G"));
      W(doc, pk(cpu, "HOLD"), pk(gnd, "G"));
      // address demux
      bus(doc, cpu, "AD", latA, "D", 0, 7, "ad");
      W(doc, pk(cpu, "ALE"), pk(latA, "LE"));
      W(doc, pk(latA, "~OE"), pk(gnd, "G"));
      // memory decode: ROM (Y7 of A17-19 decode = E0000+), RAM = OR(A19, IO/~M)
      W(doc, pk(cpu, "IO/~M"), pk(inv, "1A"));
      W(doc, pk(cpu, "A17"), pk(dec, "A"));
      W(doc, pk(cpu, "A18"), pk(dec, "B"));
      W(doc, pk(cpu, "A19"), pk(dec, "C"));
      W(doc, pk(inv, "1Y"), pk(dec, "G1"));
      W(doc, pk(dec, "~G2A"), pk(gnd, "G"));
      W(doc, pk(dec, "~G2B"), pk(gnd, "G"));
      W(doc, pk(dec, "Y7"), pk(rom, "~CE"));
      // XTIDE Universal BIOS option ROM: exactly one 16K window at D0000
      W(doc, pk(dec, "Y6"), pk(dec2, "~G2A"));
      W(doc, pk(dec2, "~G2B"), pk(gnd, "G"));
      W(doc, pk(dec2, "G1"), pk(vcc, "V"));
      W(doc, pk(cpu, "A14"), pk(dec2, "A"));
      W(doc, pk(cpu, "A15"), pk(dec2, "B"));
      W(doc, pk(cpu, "A16"), pk(dec2, "C"));
      W(doc, pk(dec2, "Y4"), pk(xubrom, "~CE"));
      W(doc, pk(cpu, "A19"), pk(or2, "1A"));
      W(doc, pk(cpu, "IO/~M"), pk(or2, "1B"));
      W(doc, pk(or2, "1Y"), pk(ram, "~CE"));
      bus(doc, latA, "Q", rom, "A", 0, 7, "alo");
      bus(doc, latA, "Q", xubrom, "A", 0, 7, "alo3");
      bus(doc, latA, "Q", ram, "A", 0, 7, "alo2");
      for (let i = 8; i <= 12; i++) W(doc, pk(cpu, "A" + i), pk(rom, "A" + i), "ahi");
      for (let i = 8; i <= 13; i++) W(doc, pk(cpu, "A" + i), pk(xubrom, "A" + i), "ahi3");
      for (let i = 8; i <= 18; i++) W(doc, pk(cpu, "A" + i), pk(ram, "A" + i), "ahi2");
      bus(doc, cpu, "AD", rom, "D", 0, 7, "d1");
      bus(doc, cpu, "AD", ram, "D", 0, 7, "d2");
      W(doc, pk(cpu, "~RD"), pk(rom, "~OE"));
      W(doc, pk(cpu, "~RD"), pk(xubrom, "~OE"));
      bus(doc, cpu, "AD", xubrom, "D", 0, 7, "d1b");
      W(doc, pk(cpu, "~RD"), pk(ram, "~OE"));
      W(doc, pk(cpu, "~WR"), pk(ram, "~WE"));
      // ISA-style command strobes
      W(doc, pk(cpu, "~RD"), pk(or32, "1A"));
      W(doc, pk(cpu, "IO/~M"), pk(or32, "1B"));
      const MEMR = pk(or32, "1Y");
      W(doc, pk(cpu, "~WR"), pk(or32, "2A"));
      W(doc, pk(cpu, "IO/~M"), pk(or32, "2B"));
      const MEMW = pk(or32, "2Y");
      W(doc, pk(cpu, "~RD"), pk(or32, "3A"));
      W(doc, pk(inv, "1Y"), pk(or32, "3B"));
      const IOR = pk(or32, "3Y");
      W(doc, pk(cpu, "~WR"), pk(or32, "4A"));
      W(doc, pk(inv, "1Y"), pk(or32, "4B"));
      const IOW = pk(or32, "4Y");
      // IO decode (ports 000-1FF only: ~G2A gated by A9)
      W(doc, pk(latA, "Q5"), pk(io138, "A"));
      W(doc, pk(latA, "Q6"), pk(io138, "B"));
      W(doc, pk(latA, "Q7"), pk(io138, "C"));
      W(doc, pk(cpu, "IO/~M"), pk(io138, "G1"));
      W(doc, pk(cpu, "A9"), pk(io138, "~G2A"));
      W(doc, pk(io138, "~G2B"), pk(gnd, "G"));
      // 8237A at 00h + page/POST registers at 80h
      W(doc, pk(io138, "Y0"), pk(dma, "~CS"));
      W(doc, pk(io138, "Y4"), pk(dma, "~CSP"));
      W(doc, IOR, pk(dma, "~IOR"));
      W(doc, IOW, pk(dma, "~IOW"));
      W(doc, pk(cg, "RESET"), pk(dma, "RESET"));
      // (8237 CLK deliberately unwired: the register model does not use it, and a
      // 4.77MHz net input would force a chip re-evaluate every half-cycle)
      W(doc, pk(dma, "HLDA"), pk(gnd, "G"));
      for (let i = 0; i <= 3; i++) W(doc, pk(latA, "Q" + i), pk(dma, "A" + i), "da");
      bus(doc, cpu, "AD", dma, "D", 0, 7, "dd");
      // 8259A at 20h
      W(doc, pk(io138, "Y1"), pk(pic, "~CS"));
      W(doc, pk(cpu, "~WR"), pk(pic, "~WR"));
      W(doc, pk(cpu, "~RD"), pk(pic, "~RD"));
      bus(doc, cpu, "AD", pic, "D", 0, 7, "d3");
      W(doc, pk(latA, "Q0"), pk(pic, "A0"));
      W(doc, pk(cpu, "~INTA"), pk(pic, "~INTA"));
      W(doc, pk(pic, "INT"), pk(cpu, "INTR"));
      W(doc, pk(pic, "~SP/~EN"), pk(vcc, "V"));
      // 8253 at 40h, clocked at PCLK/2 = 1.193 MHz via half a '74
      W(doc, pk(io138, "Y2"), pk(pit, "~CS"));
      W(doc, pk(cpu, "~WR"), pk(pit, "~WR"));
      W(doc, pk(cpu, "~RD"), pk(pit, "~RD"));
      bus(doc, cpu, "AD", pit, "D", 0, 7, "d5");
      W(doc, pk(latA, "Q0"), pk(pit, "A0"));
      W(doc, pk(latA, "Q1"), pk(pit, "A1"));
      W(doc, pk(cg, "PCLK"), pk(div74, "1CLK"));
      W(doc, pk(div74, "~1Q"), pk(div74, "1D"));
      W(doc, pk(div74, "~1CLR"), pk(vcc, "V"));
      W(doc, pk(div74, "~1PRE"), pk(vcc, "V"));
      W(doc, pk(div74, "1Q"), pk(pit, "CLK0"), "ptc");
      W(doc, pk(div74, "1Q"), pk(pit, "CLK1"), "ptc");
      W(doc, pk(div74, "1Q"), pk(pit, "CLK2"), "ptc");
      W(doc, pk(pit, "GATE0"), pk(vcc, "V"));
      W(doc, pk(pit, "GATE1"), pk(vcc, "V"));
      // XT speaker: PB0 gates timer 2, PB1 ANDs with OUT2 into the cone
      W(doc, pk(ppi, "PB0"), pk(pit, "GATE2"));
      W(doc, pk(pit, "OUT2"), pk(and08, "1A"));
      W(doc, pk(ppi, "PB1"), pk(and08, "1B"));
      W(doc, pk(and08, "1Y"), pk(spkr, "IN"));
      W(doc, pk(spkr, "GND"), pk(gnd, "G"));
      W(doc, pk(pit, "OUT0"), pk(pic, "IR0"));
      W(doc, pk(pit, "OUT1"), pk(dma, "DREQ0"));  // DRAM refresh request chain
      // 8255 at 60h: keyboard on PA, switches muxed onto PC0-3 by PB3
      W(doc, pk(io138, "Y3"), pk(ppi, "~CS"));
      W(doc, pk(cpu, "~RD"), pk(ppi, "~RD"));
      W(doc, pk(cpu, "~WR"), pk(ppi, "~WR"));
      W(doc, pk(cg, "RESET"), pk(ppi, "RESET"));
      W(doc, pk(latA, "Q0"), pk(ppi, "A0"));
      W(doc, pk(latA, "Q1"), pk(ppi, "A1"));
      bus(doc, cpu, "AD", ppi, "D", 0, 7, "d4");
      bus(doc, kbshift, "Q", ppi, "PA", 0, 7, "ka");
      W(doc, pk(ppi, "PB7"), pk(kbshift, "CLR"));
      W(doc, pk(ppi, "PB6"), pk(kbd, "RST"));   // clock enable/reset -> keyboard sends AA
      W(doc, pk(ppi, "PB3"), pk(mux, "S"));
      W(doc, pk(mux, "~G"), pk(gnd, "G"));
      for (let i = 0; i < 4; i++) {
        W(doc, pk(sw, "S" + i), pk(mux, (i + 1) + "A"), "swa");
        W(doc, pk(sw, "S" + (i + 4)), pk(mux, (i + 1) + "B"), "swb");
        W(doc, pk(mux, (i + 1) + "Y"), pk(ppi, "PC" + i), "swy");
        W(doc, pk(ppi, "PC" + (i + 4)), pk(gnd, "G"));   // no parity/cassette flags
      }
      // serial keyboard
      W(doc, pk(kbd, "KDATA"), pk(kbshift, "SER"));
      W(doc, pk(kbd, "KCLK"), pk(kbshift, "CLK"));
      W(doc, pk(kbshift, "FULL"), pk(pic, "IR1"));
      // µPD765 floppy at 3F0-3F7 + DMA channel 2 + IRQ6
      for (let i = 0; i <= 7; i++) W(doc, pk(latA, "Q" + i), pk(fdc, "A" + i), "fa");
      W(doc, pk(cpu, "A8"), pk(fdc, "A8"));
      W(doc, pk(cpu, "A9"), pk(fdc, "A9"));
      W(doc, IOR, pk(fdc, "~IOR"));
      W(doc, IOW, pk(fdc, "~IOW"));
      W(doc, pk(cg, "RESET"), pk(fdc, "RESET"));
      bus(doc, cpu, "AD", fdc, "D", 0, 7, "fd");
      W(doc, pk(fdc, "INT"), pk(pic, "IR6"));
      W(doc, pk(fdc, "DRQ"), pk(dma, "DREQ2"));
      // XT-IDE card at 300h (self-decoded, polled PIO)
      for (let i = 0; i <= 7; i++) W(doc, pk(latA, "Q" + i), pk(ide, "A" + i), "ia");
      W(doc, pk(cpu, "A8"), pk(ide, "A8"));
      W(doc, pk(cpu, "A9"), pk(ide, "A9"));
      W(doc, IOR, pk(ide, "~IOR"));
      W(doc, IOW, pk(ide, "~IOW"));
      W(doc, pk(cg, "RESET"), pk(ide, "RESET"));
      bus(doc, cpu, "AD", ide, "D", 0, 7, "id");
      // COM1 card at 3F8h, IRQ4
      for (let i = 0; i <= 7; i++) W(doc, pk(latA, "Q" + i), pk(com, "A" + i), "ca");
      W(doc, pk(cpu, "A8"), pk(com, "A8"));
      W(doc, pk(cpu, "A9"), pk(com, "A9"));
      W(doc, IOR, pk(com, "~IOR"));
      W(doc, IOW, pk(com, "~IOW"));
      W(doc, pk(cg, "RESET"), pk(com, "RESET"));
      bus(doc, cpu, "AD", com, "D", 0, 7, "cd");
      W(doc, pk(com, "INTR"), pk(pic, "IR4"));
      // Hercules video + CRT
      W(doc, MEMR, pk(hgc, "~MEMR"));
      W(doc, MEMW, pk(hgc, "~MEMW"));
      W(doc, IOR, pk(hgc, "~IOR"));
      W(doc, IOW, pk(hgc, "~IOW"));
      bus(doc, latA, "Q", hgc, "A", 0, 7, "va");
      for (let i = 8; i <= 19; i++) W(doc, pk(cpu, "A" + i), pk(hgc, "A" + i), "vah");
      bus(doc, cpu, "AD", hgc, "D", 0, 7, "vd");
      W(doc, pk(hgc, "HSYNC"), pk(crt, "HSYNC"));
      W(doc, pk(hgc, "VSYNC"), pk(crt, "VSYNC"));
      W(doc, pk(hgc, "VIDEO"), pk(crt, "VIDEO"));
      spread(doc, 1.32, 1.18);
      return { doc, names };
    },
    // The EPROM holds GLaBIOS; the user's Code tab is not used on this board.
    programImages() {
      const out = [];
      const bios = K.assetBytes("glabios");
      if (bios) out.push({ comp: "rom", image: bios });
      const xub = K.assetBytes("xub");
      if (xub) out.push({ comp: "xubrom", image: xub });
      return out;
    },
  });

  // ---------------------------------------------------------------------------
  // Dual 8088 sharing one RAM through 8289 bus arbiters. Each CPU runs in max
  // mode with its own 8288; the arbiters fight over the open-collector ~BUSY
  // line (serial priority: A over B) and enable exactly one CPU's latches,
  // transceiver and command drivers onto the shared bus. The loser's 8284
  // holds READY low, so it waits in real Tw states. Both CPUs run the SAME ROM
  // and claim their identity with an atomic XCHG in shared RAM. No cache, no
  // coherence — exactly like the era.
  K.presets.push({
    id: "dual-8088",
    name: "Dual 8088 — shared RAM (8289)",
    speedIdx: 8,
    blurb: "Two processors, one memory, zero coherence. Watch ~BUSY and the two ~AEN lines interleave in the waveform analyzer while both counters climb in shared RAM.",
    lab: [
      "Run: both counters climb in shared RAM with NO cache and NO coherence protocol — just an arbitrated bus.",
      "Waveform: put both arbiters' ~AEN side by side with ~BUSY. Exactly one low at a time; the bus changes hands between cycles.",
      "The claim byte at [0010] was taken with XCHG — the CPU asserts ~LOCK for it. Find ~LOCK dipping low in the waveform: that's what makes it atomic.",
      "Double-click each 8289: grant counts stay near-equal. Fairness comes from the bus-exchange cooldown, not from luck.",
      "Open the unified memory view at 00020h: two counters interleaved by two CPUs, byte by byte. This is why real systems needed locks.",
    ],
    defaultProgram: [
      "; Both CPUs boot this same ROM. An atomic XCHG in shared RAM decides who",
      "; is who; then each increments its own counter word forever.",
      "        org 0xE000",
      "start:  cli",
      "        xor ax, ax",
      "        mov ds, ax",
      "        mov al, 1",
      "        xchg al, [0x10]    ; bus is held across XCHG: atomic claim",
      "        test al, al",
      "        jz first",
      "        mov si, 0x22       ; CPU #2 counts at [0022]",
      "        jmp go",
      "first:  mov si, 0x20       ; CPU #1 counts at [0020]",
      "go:     inc word [si]",
      "        mov ax, [si]",
      "        out 0, al          ; whoever holds the bus flashes the LEDs",
      "        jmp go",
    ].join("\n"),
    romComp: "rom",
    build() {
      const doc = K.newDoc();
      const add = (t, x, y, pr) => K.docAddComponent(doc, t, x, y, pr);
      // shared infrastructure
      const rom = add("EPROM2764", 96, 2);
      const ram = add("SRAM6264", 96, 20);
      const inv = add("74LS04", 82, 40);
      const nand = add("74LS00", 82, 50);
      const port = add("74LS373", 96, 38);
      const led = add("LED8", 110, 38);
      const vcc = add("VCC", 2, 2);
      const gnd = add("GND", 2, 6);
      const pull = add("PULLUP", 2, 10);
      const btn = add("BTN", 2, 14);
      const pullBusy = add("PULLUP", 2, 20);
      const pullRd = add("PULLUP", 2, 24);
      const pullWr = add("PULLUP", 2, 28);
      const pullIo = add("PULLUP", 2, 32);
      const names = { rom, ram, inv, nand, port, led, vcc, gnd, pull, btn, pullBusy, pullRd, pullWr, pullIo };

      const cluster = (tag, ox, oy) => {
        const xt = add("XTAL", ox, oy, { mhz: 14.31818 });
        const cg = add("8284A", ox, oy + 4);
        const cpu = add("8088", ox + 14, oy);
        const ctl = add("8288", ox + 14, oy + 26);
        const arb = add("8289", ox + 24, oy + 26);
        const lat = add("74LS373", ox + 32, oy);
        const buf = add("74LS244", ox + 32, oy + 14);
        const xcv = add("74LS245", ox + 42, oy);
        names[tag + "xt"] = xt; names[tag + "cg"] = cg; names[tag + "cpu"] = cpu;
        names[tag + "ctl"] = ctl; names[tag + "arb"] = arb;
        names[tag + "lat"] = lat; names[tag + "buf"] = buf; names[tag + "xcv"] = xcv;
        W(doc, pk(xt, "X1"), pk(cg, "X1"));
        W(doc, pk(xt, "X2"), pk(cg, "X2"));
        W(doc, pk(cg, "CLK"), pk(cpu, "CLK"));
        W(doc, pk(cg, "CLK"), pk(ctl, "CLK"));
        W(doc, pk(cg, "CLK"), pk(arb, "CLK"));
        W(doc, pk(cg, "RESET"), pk(cpu, "RESET"));
        W(doc, pk(cg, "READY"), pk(cpu, "READY"));
        W(doc, pk(cg, "~RES"), pk(pull, "P"));
        W(doc, pk(cg, "~RES"), pk(btn, "B"));
        W(doc, pk(cg, "RDY1"), pk(vcc, "V"));          // waits come from ~AEN gating
        W(doc, pk(arb, "~AEN"), pk(cg, "~AEN1"));
        // maximum mode strap + status to controller and arbiter
        W(doc, pk(cpu, "MN/~MX"), pk(gnd, "G"));
        W(doc, pk(cpu, "~TEST"), pk(vcc, "V"));
        W(doc, pk(cpu, "NMI"), pk(gnd, "G"));
        W(doc, pk(cpu, "INTR"), pk(gnd, "G"));
        W(doc, pk(cpu, "HOLD"), pk(vcc, "V"));
        for (const [pin, sig] of [["~DEN", "~S0"], ["DT/~R", "~S1"], ["IO/~M", "~S2"]]) {
          W(doc, pk(cpu, pin), pk(ctl, sig), tag + "st");
          W(doc, pk(cpu, pin), pk(arb, sig), tag + "st2");
        }
        W(doc, pk(arb, "~AEN"), pk(ctl, "~AEN"));
        W(doc, pk(cpu, "~WR"), pk(arb, "~LOCK"), tag + "lk"); // ~LOCK holds the bus across XCHG
        W(doc, pk(ctl, "CEN"), pk(vcc, "V"));
        W(doc, pk(ctl, "IOB"), pk(gnd, "G"));
        // local address capture, shared-bus drive gated by the grant
        bus(doc, cpu, "AD", lat, "D", 0, 7, tag + "ad");
        W(doc, pk(ctl, "ALE"), pk(lat, "LE"));
        W(doc, pk(arb, "~AEN"), pk(lat, "~OE"));
        for (let i = 0; i < 8; i++) W(doc, pk(cpu, "A" + (8 + i)), pk(buf, "A" + i), tag + "ab");
        W(doc, pk(arb, "~AEN"), pk(buf, "~G1"));
        W(doc, pk(arb, "~AEN"), pk(buf, "~G2"));
        // data transceiver: enabled when granted AND 8288 DEN active
        bus(doc, cpu, "AD", xcv, "A", 0, 7, tag + "xd");
        W(doc, pk(ctl, "DT/~R"), pk(xcv, "DIR"));
        return { cg, cpu, ctl, arb, lat, buf, xcv };
      };

      const A = cluster("a", 8, 2);
      const B = cluster("b", 8, 44);
      // grant logic: ~G(245) = NAND(DEN, granted); granted = NOT(~AEN)
      W(doc, pk(A.arb, "~AEN"), pk(inv, "1A"));
      W(doc, pk(A.ctl, "DEN"), pk(nand, "1A"));
      W(doc, pk(inv, "1Y"), pk(nand, "1B"));
      W(doc, pk(nand, "1Y"), pk(A.xcv, "~G"));
      W(doc, pk(B.arb, "~AEN"), pk(inv, "2A"));
      W(doc, pk(B.ctl, "DEN"), pk(nand, "2A"));
      W(doc, pk(inv, "2Y"), pk(nand, "2B"));
      W(doc, pk(nand, "2Y"), pk(B.xcv, "~G"));
      // arbitration: open-collector ~BUSY + serial priority A -> B
      W(doc, pk(A.arb, "~BUSY"), pk(B.arb, "~BUSY"), "busy");
      W(doc, pk(A.arb, "~BUSY"), pk(pullBusy, "P"));
      W(doc, pk(A.arb, "~BPRN"), pk(gnd, "G"));       // A has top priority
      W(doc, pk(A.arb, "~BPRO"), pk(B.arb, "~BPRN"));
      // shared bus: SA0-15 (latch + buffer of each cluster), SD0-7 via '245 B side
      for (const C of [A, B]) {
        bus(doc, C.lat, "Q", rom, "A", 0, 7, "sa");
        bus(doc, C.lat, "Q", ram, "A", 0, 7, "sa2");
        for (let i = 0; i < 5; i++) {
          W(doc, pk(C.buf, "Y" + i), pk(rom, "A" + (8 + i)), "sah");
          W(doc, pk(C.buf, "Y" + i), pk(ram, "A" + (8 + i)), "sah2");
        }
        bus(doc, C.xcv, "B", rom, "D", 0, 7, "sd");
        bus(doc, C.xcv, "B", ram, "D", 0, 7, "sd2");
        bus(doc, C.xcv, "B", port, "D", 0, 7, "sd3");
        // shared command lines (tri-stated by ~AEN, pulled up)
        W(doc, pk(C.ctl, "~MRDC"), pk(pullRd, "P"), "cmdr");
        W(doc, pk(C.ctl, "~MWTC"), pk(pullWr, "P"), "cmdw");
        W(doc, pk(C.ctl, "~IOWC"), pk(pullIo, "P"), "cmdi");
      }
      // memory decode on the shared bus: A15 splits ROM (high) from RAM (low)
      const sa15 = (C) => pk(C.buf, "Y7");
      for (const C of [A, B]) {
        W(doc, sa15(C), pk(inv, "3A"), "sa15");
        W(doc, sa15(C), pk(ram, "~CS1"), "sa15b");
      }
      W(doc, pk(inv, "3Y"), pk(rom, "~CE"));
      W(doc, pk(ram, "CS2"), pk(vcc, "V"));
      W(doc, pk(pullRd, "P"), pk(rom, "~OE"), "cmdr2");
      W(doc, pk(pullRd, "P"), pk(ram, "~OE"), "cmdr3");
      W(doc, pk(pullWr, "P"), pk(ram, "~WE"), "cmdw2");
      // shared LED port: any IO write latches
      W(doc, pk(pullIo, "P"), pk(inv, "4A"), "cmdi2");
      W(doc, pk(inv, "4Y"), pk(port, "LE"));
      W(doc, pk(port, "~OE"), pk(gnd, "G"));
      bus(doc, port, "Q", led, "A", 0, 7, "lq");
      W(doc, pk(led, "K"), pk(gnd, "G"));
      // A8-15 buffered: wire Y5..Y7 only Y7 used for decode; Y5/Y6 join shared A13/A14 (unused by 8K parts)
      spread(doc, 1.22, 1.12);
      return { doc, names };
    },
    makeRom(programBytes, programOrg) {
      const rom = new Uint8Array(8192).fill(0xFF);
      rom.set(programBytes.slice(0, 8192 - 16), (programOrg || 0) & 0x1FFF);
      rom.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0);
      return rom;
    },
  });


  // ---------------------------------------------------------------------------
  // Four teaching boards built the honest way: with the same autoconnect the
  // user gets, plus a handful of hand wires for the parts autoconnect leaves
  // to taste. Everything on them is inspectable and editable.
  const romImage8k = (programBytes, programOrg) => {
    const rom = new Uint8Array(8192).fill(0xFF);
    rom.set(programBytes.slice(0, 8192 - 16), (programOrg || 0) & 0x1FFF);
    rom.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0);
    return rom;
  };
  const autoKit8088 = (doc) => {
    K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
    K.docAddComponent(doc, "8284A", 2, 6);
    const cpu = K.docAddComponent(doc, "8088", 16, 2);
    K.autoconnect(doc, cpu, null);
    const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
    K.autoconnect(doc, rom, cpu);
    return { cpu, rom };
  };

  K.presets.push({
    id: "traffic-8255",
    name: "Traffic light (8255)",
    speedIdx: 5,
    blurb: "An 8255 PPI drives a traffic light from port A. The whole board was wired by autoconnect — double-click the PPI while it runs to watch the mode register and ports.",
    defaultProgram: [
      "; Traffic light on 8255 port A: PA0=red PA1=yellow PA2=green",
      "        org 0xE000",
      "start:  cli",
      "        mov al, 0x80       ; 8255 mode 0, A/B/C all outputs",
      "        out 0x63, al",
      "loop:   mov al, 1          ; red",
      "        call show",
      "        mov al, 3          ; red+yellow",
      "        call show",
      "        mov al, 4          ; green",
      "        call show",
      "        mov al, 2          ; yellow",
      "        call show",
      "        jmp loop",
      "show:   out 0x60, al",
      "        mov cx, 40",
      "d:      loop d",
      "        ret",
    ].join("\n"),
    romComp: "rom",
    makeRom: romImage8k,
    build() {
      const doc = K.newDoc();
      const { cpu, rom } = autoKit8088(doc);
      // stack for CALL/RET
      const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
      K.autoconnect(doc, ram, cpu);
      const ppi = K.docAddComponent(doc, "8255", 66, 2);
      K.autoconnect(doc, ppi, cpu);
      const led = K.docAddComponent(doc, "LED8", 84, 2);
      for (let i = 0; i < 3; i++) W(doc, pk(ppi, "PA" + i), pk(led, "A" + i), "tl");
      W(doc, pk(led, "K"), pk(K.docAddComponent(doc, "GND", 84, 12), "G"));
      return { doc, names: { cpu, rom, ram, ppi, led } };
    },
  });

  K.presets.push({
    id: "dip-echo",
    name: "DIP switches → LEDs",
    speedIdx: 5,
    blurb: "The simplest input port there is: a '244 buffer gates the DIP switches onto the bus for ANY IO read (partial decoding — one gate, zero '138s), and a '373 latches them back out to the LEDs. Flip the switches while it runs.",
    defaultProgram: [
      "; Copy the DIP switches to the LEDs, forever.",
      "        org 0xE000",
      "start:  cli",
      "loop:   in al, 0           ; '244 answers every IO read",
      "        out 0, al          ; '373 latches every IO write",
      "        jmp loop",
    ].join("\n"),
    romComp: "rom",
    makeRom: romImage8k,
    build() {
      const doc = K.newDoc();
      const { cpu, rom } = autoKit8088(doc);
      const sw = K.docAddComponent(doc, "SW8", 50, 20, { bits: 0x55 });
      const inbuf = K.docAddComponent(doc, "74LS244", 58, 20);
      const port = K.docAddComponent(doc, "74LS373", 72, 20);
      const led = K.docAddComponent(doc, "LED8", 88, 20);
      const inv = K.docAddComponent(doc, "74LS04", 50, 32);
      const or32 = K.docAddComponent(doc, "74LS32", 60, 32);
      const and8 = K.docAddComponent(doc, "74LS08", 70, 32);
      const gnd = doc.components.find(c => c.type === "GND") || K.docAddComponent(doc, "GND", 2, 30);
      // input port: Y -> AD, enabled on IO reads only (~G = ~RD OR NOT(IO/~M))
      for (let i = 0; i < 8; i++) {
        W(doc, pk(sw, "S" + i), pk(inbuf, "A" + i), "sw");
        W(doc, pk(inbuf, "Y" + i), pk(cpu, "AD" + i), "swy");
      }
      W(doc, pk(cpu, "IO/~M"), pk(inv, "1A"));
      W(doc, pk(cpu, "~RD"), pk(or32, "1A"));
      W(doc, pk(inv, "1Y"), pk(or32, "1B"));
      W(doc, pk(or32, "1Y"), pk(inbuf, "~G1"));
      W(doc, pk(or32, "1Y"), pk(inbuf, "~G2"));
      // output port: LE = IO/~M AND NOT(~WR), like the minimal kit
      W(doc, pk(cpu, "~WR"), pk(inv, "2A"));
      W(doc, pk(cpu, "IO/~M"), pk(and8, "1A"));
      W(doc, pk(inv, "2Y"), pk(and8, "1B"));
      W(doc, pk(and8, "1Y"), pk(port, "LE"));
      W(doc, pk(port, "~OE"), pk(gnd, "G"));
      for (let i = 0; i < 8; i++) {
        W(doc, pk(cpu, "AD" + i), pk(port, "D" + i), "pd");
        W(doc, pk(port, "Q" + i), pk(led, "A" + i), "pq");
      }
      W(doc, pk(led, "K"), pk(gnd, "G"));
      return { doc, names: { cpu, rom, sw, inbuf, port, led } };
    },
  });

  K.presets.push({
    id: "seg7-count",
    name: "7-segment counter",
    speedIdx: 5,
    blurb: "A '373 output port drives a common-cathode 7-segment digit; the program walks a segment table 0-9. Software segment decoding, exactly like every kit manual taught it.",
    defaultProgram: [
      "; Count 0-9 on the 7-segment digit (a=bit0 .. g=bit6)",
      "        org 0xE000",
      "start:  cli",
      "        xor ax, ax",
      "        mov ds, ax",
      "loop:   mov si, 0",
      "digit:  mov al, [cs:table+si]",
      "        out 0, al",
      "        mov cx, 40",
      "d:      loop d",
      "        inc si",
      "        cmp si, 10",
      "        jnz digit",
      "        jmp loop",
      "table:  db 0x3F, 0x06, 0x5B, 0x4F, 0x66",
      "        db 0x6D, 0x7D, 0x07, 0x7F, 0x6F",
    ].join("\n"),
    romComp: "rom",
    makeRom: romImage8k,
    build() {
      const doc = K.newDoc();
      const { cpu, rom } = autoKit8088(doc);
      const port = K.docAddComponent(doc, "74LS373", 50, 20);
      const seg = K.docAddComponent(doc, "SEG7", 66, 20);
      const inv = K.docAddComponent(doc, "74LS04", 50, 32);
      const and8 = K.docAddComponent(doc, "74LS08", 60, 32);
      const gnd = doc.components.find(c => c.type === "GND") || K.docAddComponent(doc, "GND", 2, 30);
      W(doc, pk(cpu, "~WR"), pk(inv, "1A"));
      W(doc, pk(cpu, "IO/~M"), pk(and8, "1A"));
      W(doc, pk(inv, "1Y"), pk(and8, "1B"));
      W(doc, pk(and8, "1Y"), pk(port, "LE"));
      W(doc, pk(port, "~OE"), pk(gnd, "G"));
      for (let i = 0; i < 8; i++) W(doc, pk(cpu, "AD" + i), pk(port, "D" + i), "pd");
      const segs = ["a", "b", "c", "d", "e", "f", "g", "dp"];
      for (let i = 0; i < 8; i++) W(doc, pk(port, "Q" + i), pk(seg, segs[i]), "sg");
      W(doc, pk(seg, "CC"), pk(gnd, "G"));
      return { doc, names: { cpu, rom, port, seg } };
    },
  });

  K.presets.push({
    id: "wait-state",
    name: "Wait-state generator",
    speedIdx: 5,
    blurb: "Three '74 flip-flops make the classic wait-state shift register: ALE clears the chain, CLK marches a 1 through it, and READY comes up one clock too late — every bus cycle stretches by one Tw. Watch READY and the extra T-states in the waveforms.",
    lab: [
      "Run, then open the waveform on CLK, ALE and READY. Every bus cycle: ALE pulse, READY dips low, one extra T-state (Tw) appears.",
      "Compare with the minimal kit: same program, measurably slower. Count clocks between two ALE pulses in each preset.",
      "The three '74 flip-flops are a shift register: ALE clears it, CLK marches a 1 toward RDY1. Probe each Q while stepping by cycle.",
      "Move RDY1 to the second flip-flop's Q instead of the third: fewer wait states. To zero — what changes in the waveform?",
    ],
    defaultProgram: [
      "; The same blinker as the minimal kit — now with one wait state per cycle.",
      "        org 0xE000",
      "start:  mov al, 0x55",
      "        out 0, al",
      "        mov cx, 4",
      "d1:     loop d1",
      "        mov al, 0xAA",
      "        out 0, al",
      "        mov cx, 4",
      "d2:     loop d2",
      "        jmp start",
    ].join("\n"),
    romComp: "rom",
    makeRom: romImage8k,
    build() {
      const doc = K.newDoc();
      const { cpu, rom } = autoKit8088(doc);
      const cg = doc.components.find(c => c.type === "8284A");
      const port = K.docAddComponent(doc, "74LS373", 50, 20);
      const led = K.docAddComponent(doc, "LED8", 66, 20);
      const inv = K.docAddComponent(doc, "74LS04", 50, 32);
      const and8 = K.docAddComponent(doc, "74LS08", 60, 32);
      const ws1 = K.docAddComponent(doc, "74LS74", 70, 32);
      const ws2 = K.docAddComponent(doc, "74LS74", 80, 32);
      const vcc = doc.components.find(c => c.type === "VCC");
      const gnd = doc.components.find(c => c.type === "GND") || K.docAddComponent(doc, "GND", 2, 30);
      // wait-state shift register: cleared while ALE is high, then shifts VCC
      // through three stages; READY (RDY1) rises after the third CLK edge.
      W(doc, pk(cpu, "ALE"), pk(inv, "3A"));
      for (const [ff, u] of [[ws1, "1"], [ws1, "2"], [ws2, "1"]]) {
        W(doc, pk(cg, "CLK"), pk(ff, u + "CLK"), "wclk");
        W(doc, pk(inv, "3Y"), pk(ff, "~" + u + "CLR"), "wclr");
        W(doc, pk(vcc, "V"), pk(ff, "~" + u + "PRE"), "wpre");
      }
      W(doc, pk(vcc, "V"), pk(ws1, "1D"));
      W(doc, pk(ws1, "1Q"), pk(ws1, "2D"));
      W(doc, pk(ws1, "2Q"), pk(ws2, "1D"));
      W(doc, pk(ws2, "1Q"), pk(cg, "RDY1"));
      W(doc, pk(cg, "~AEN1"), pk(gnd, "G"));   // unused ~AEN1 must be grounded to arm RDY1
      // remove autoconnect's RDY1-free assumption: RDY1 is wired now, so the
      // 8284 gates READY through the chain (that is the whole point)
      // output port, as on the minimal kit
      W(doc, pk(cpu, "~WR"), pk(inv, "1A"));
      W(doc, pk(cpu, "IO/~M"), pk(and8, "1A"));
      W(doc, pk(inv, "1Y"), pk(and8, "1B"));
      W(doc, pk(and8, "1Y"), pk(port, "LE"));
      W(doc, pk(port, "~OE"), pk(gnd, "G"));
      for (let i = 0; i < 8; i++) W(doc, pk(cpu, "AD" + i), pk(port, "D" + i), "pd");
      for (let i = 0; i < 8; i++) W(doc, pk(port, "Q" + i), pk(led, "A" + i), "pq");
      W(doc, pk(led, "K"), pk(gnd, "G"));
      return { doc, names: { cpu, rom, port, led, ws1, ws2 } };
    },
  });

  // ---------------------------------------------------------------------------
  // MIXED MASTERS: an 8088 and an 8086 arbitrating for ONE word-wide memory.
  // The bus itself is 16-bit (even/odd banks, word-8086 style). The 8086 is a
  // native word master: two '245 lanes, ~BHE driven onto the shared BHEN line.
  // The 8088 is a byte master with byte-swap glue: its AD0-7 reaches the even
  // bank directly and the odd bank through a crossed '245, steered by latched
  // A0; BHEN = NOT(A0) through its own tri-state buffer. Bank writes are
  // qualified by SA0/BHEN exactly like the word machine. Same 8289/~BUSY/~LOCK
  // arbitration as the dual-8088 board — and the same total lack of coherence.
  K.presets.push({
    id: "mixed-cpu",
    name: "Mixed 8086 + 8088 — shared RAM",
    speedIdx: 8,
    blurb: "A word-wide shared bus with two different masters: the 8086 moves words in one cycle, the 8088 pays two cycles and a byte-swap '245. Same program, same RAM, an atomic XCHG deciding who is who.",
    lab: [
      "Two DIFFERENT processors, one memory. Run and watch both counters climb: the 8086 moves words in one bus cycle, the 8088 pays two.",
      "Waveform: compare the two ~AEN lines during an inc — the 8088 holds the bus roughly twice as long for the same work.",
      "Find the byte-swap '245: when the 8088 touches an ODD address, its D0-7 data crosses to the odd bank's D8-15 lane through it. Probe both sides.",
      "BHEN on the shared bus: the 8086 drives it from ~BHE; the 8088 synthesizes it as NOT(A0). Watch it gate the odd bank's ~WE.",
    ],
    defaultProgram: [
      "; Both CPUs boot this same ROM. An atomic XCHG in shared RAM decides who",
      "; is who; then each increments its own counter word forever.",
      "        org 0xE000",
      "start:  cli",
      "        xor ax, ax",
      "        mov ds, ax",
      "        mov al, 1",
      "        xchg al, [0x10]    ; bus is held across XCHG: atomic claim",
      "        test al, al",
      "        jz first",
      "        mov si, 0x22       ; second CPU counts at [0022]",
      "        jmp go",
      "first:  mov si, 0x20       ; first CPU counts at [0020]",
      "go:     inc word [si]",
      "        mov ax, [si]",
      "        out 0, al          ; whoever holds the bus flashes the LEDs",
      "        jmp go",
    ].join("\n"),
    programImages(programBytes, programOrg) {
      const lo = new Uint8Array(8192).fill(0xFF), hi = new Uint8Array(8192).fill(0xFF);
      const put = (phys, byte) => { ((phys & 1) ? hi : lo)[(phys >> 1) & 0x1FFF] = byte; };
      Array.from(programBytes).forEach((b, i) => put(0xE000 + i, b));
      [0xEA, 0x00, 0xE0, 0x00, 0xF0].forEach((b, i) => put(0xFFF0 + i, b));
      return [{ comp: "romL", image: lo }, { comp: "romH", image: hi }];
    },
    build() {
      const doc = K.newDoc();
      const add = (t, x, y, pr) => K.docAddComponent(doc, t, x, y, pr);
      // shared infrastructure
      const romL = add("EPROM2764", 106, 2);
      const romH = add("EPROM2764", 122, 2);
      const ramL = add("SRAM6264", 106, 20);
      const ramH = add("SRAM6264", 122, 20);
      const inv = add("74LS04", 92, 40);
      const nand = add("74LS00", 92, 50);
      const or32 = add("74LS32", 102, 44);
      const port = add("74LS373", 106, 38);
      const led = add("LED8", 122, 38);
      const vcc = add("VCC", 2, 2);
      const gnd = add("GND", 2, 6);
      const pull = add("PULLUP", 2, 10);
      const btn = add("BTN", 2, 14);
      const pullBusy = add("PULLUP", 2, 20);
      const pullRd = add("PULLUP", 2, 24);
      const pullWr = add("PULLUP", 2, 28);
      const pullIo = add("PULLUP", 2, 32);
      const pullBhe = add("PULLUP", 2, 36);
      const names = { romL, romH, ramL, ramH, inv, nand, or32, port, led, vcc, gnd, pull, btn,
                      pullBusy, pullRd, pullWr, pullIo, pullBhe };

      const cluster = (tag, type, ox, oy) => {
        const is86 = type === "8086";
        const xt = add("XTAL", ox, oy, { mhz: 14.31818 });
        const cg = add("8284A", ox, oy + 4);
        const cpu = add(type, ox + 14, oy);
        const ctl = add("8288", ox + 14, oy + 26);
        const arb = add("8289", ox + 24, oy + 26);
        names[tag + "xt"] = xt; names[tag + "cg"] = cg; names[tag + "cpu"] = cpu;
        names[tag + "ctl"] = ctl; names[tag + "arb"] = arb;
        W(doc, pk(xt, "X1"), pk(cg, "X1"));
        W(doc, pk(xt, "X2"), pk(cg, "X2"));
        W(doc, pk(cg, "CLK"), pk(cpu, "CLK"));
        W(doc, pk(cg, "CLK"), pk(ctl, "CLK"));
        W(doc, pk(cg, "CLK"), pk(arb, "CLK"));
        W(doc, pk(cg, "RESET"), pk(cpu, "RESET"));
        W(doc, pk(cg, "READY"), pk(cpu, "READY"));
        W(doc, pk(cg, "~RES"), pk(pull, "P"));
        W(doc, pk(cg, "~RES"), pk(btn, "B"));
        W(doc, pk(cg, "RDY1"), pk(vcc, "V"));          // waits come from ~AEN gating
        W(doc, pk(arb, "~AEN"), pk(cg, "~AEN1"));
        W(doc, pk(cpu, "MN/~MX"), pk(gnd, "G"));
        W(doc, pk(cpu, "~TEST"), pk(vcc, "V"));
        W(doc, pk(cpu, "NMI"), pk(gnd, "G"));
        W(doc, pk(cpu, "INTR"), pk(gnd, "G"));
        W(doc, pk(cpu, "HOLD"), pk(vcc, "V"));
        for (const [pin, sig] of [["~DEN", "~S0"], ["DT/~R", "~S1"], [is86 ? "M/~IO" : "IO/~M", "~S2"]]) {
          W(doc, pk(cpu, pin), pk(ctl, sig), tag + "st");
          W(doc, pk(cpu, pin), pk(arb, sig), tag + "st2");
        }
        W(doc, pk(cpu, "~WR"), pk(arb, "~LOCK"), tag + "lk");
        W(doc, pk(arb, "~AEN"), pk(ctl, "~AEN"));
        W(doc, pk(ctl, "CEN"), pk(vcc, "V"));
        W(doc, pk(ctl, "IOB"), pk(gnd, "G"));
        // shared command lines (tri-stated by ~AEN, pulled up)
        W(doc, pk(ctl, "~MRDC"), pk(pullRd, "P"), "cmdr");
        W(doc, pk(ctl, "~MWTC"), pk(pullWr, "P"), "cmdw");
        W(doc, pk(ctl, "~IOWC"), pk(pullIo, "P"), "cmdi");
        // low address byte: '373 latch onto SA0-7
        const lat0 = add("74LS373", ox + 34, oy);
        names[tag + "lat0"] = lat0;
        bus(doc, cpu, "AD", lat0, "D", 0, 7, tag + "ad");
        W(doc, pk(ctl, "ALE"), pk(lat0, "LE"));
        W(doc, pk(arb, "~AEN"), pk(lat0, "~OE"));
        // shared low address: SA1-7 anchor on the even bank's A0-6 (banks
        // decode SA1-13: word addressing), SA0 anchors at the write-gate OR
        for (let i = 1; i < 8; i++) W(doc, pk(lat0, "Q" + i), pk(romL, "A" + (i - 1)), "sa" + i);
        W(doc, pk(lat0, "Q0"), pk(or32, "1B"), "sa0");
        return { is86, xt, cg, cpu, ctl, arb, lat0 };
      };

      const A = cluster("a", "8086", 8, 2);
      const B = cluster("b", "8088", 8, 46);

      // grant-qualified data enable per cluster: dataEn_n = NAND(DEN, NOT ~AEN)
      const dataEnN = (C, iu, nu) => {
        W(doc, pk(C.arb, "~AEN"), pk(inv, iu + "A"));
        W(doc, pk(C.ctl, "DEN"), pk(nand, nu + "A"));
        W(doc, pk(inv, iu + "Y"), pk(nand, nu + "B"));
        return pk(nand, nu + "Y");
      };
      const enA = dataEnN(A, "1", "1");
      const enB = dataEnN(B, "2", "2");

      // ---- 8086 master: native word interface -------------------------------
      {
        const lat1 = add("74LS373", 44, 2);        // AD8-15 -> SA8-15
        const bufB = add("74LS244", 44, 16);       // ~BHE -> BHEN (tri-state)
        const xcvL = add("74LS245", 58, 2);
        const xcvH = add("74LS245", 58, 16);
        names.alat1 = lat1; names.abufB = bufB; names.axcvL = xcvL; names.axcvH = xcvH;
        for (let i = 0; i < 8; i++) W(doc, pk(A.cpu, "AD" + (8 + i)), pk(lat1, "D" + i), "aadh");
        W(doc, pk(A.ctl, "ALE"), pk(lat1, "LE"));
        W(doc, pk(A.arb, "~AEN"), pk(lat1, "~OE"));
        for (let i = 0; i < 6; i++) W(doc, pk(lat1, "Q" + i), pk(romL, "A" + (7 + i)), "sahm" + i); // SA8-13 -> A7-12
        W(doc, pk(A.cpu, "~BHE"), pk(bufB, "A0"));
        W(doc, pk(bufB, "Y0"), pk(pullBhe, "P"), "bhen");
        W(doc, pk(A.arb, "~AEN"), pk(bufB, "~G1"));
        W(doc, pk(A.arb, "~AEN"), pk(bufB, "~G2"));
        bus(doc, A.cpu, "AD", xcvL, "A", 0, 7, "axl");
        for (let i = 0; i < 8; i++) W(doc, pk(A.cpu, "AD" + (8 + i)), pk(xcvH, "A" + i), "axh");
        for (const x of [xcvL, xcvH]) {
          W(doc, pk(A.ctl, "DT/~R"), pk(x, "DIR"));
          W(doc, enA, pk(x, "~G"));
        }
        for (let i = 0; i < 8; i++) {
          W(doc, pk(xcvL, "B" + i), pk(romL, "D" + i), "sdl");
          W(doc, pk(xcvH, "B" + i), pk(romH, "D" + i), "sdh");
        }
      }

      // ---- 8088 master: byte interface with swap ----------------------------
      {
        const buf = add("74LS244", 44, 46);        // A8-15 -> SA8-15
        const bufB = add("74LS244", 44, 60);       // BHEN = NOT(SA0), tri-state
        const xcv = add("74LS245", 58, 46);        // AD0-7 <-> SD0-7 (even)
        const swap = add("74LS245", 58, 60);       // AD0-7 <-> SD8-15 (odd)
        names.bbuf = buf; names.bbufB = bufB; names.bxcv = xcv; names.bswap = swap;
        for (let i = 0; i < 8; i++) W(doc, pk(B.cpu, "A" + (8 + i)), pk(buf, "A" + i), "bah");
        W(doc, pk(B.arb, "~AEN"), pk(buf, "~G1"));
        W(doc, pk(B.arb, "~AEN"), pk(buf, "~G2"));
        for (let i = 0; i < 8; i++) W(doc, pk(buf, "Y" + i), pk(names.alat1, "Q" + i), "sah" + i);
        // BHEN and swap steering from latched A0 (shared SA0 while granted)
        W(doc, pk(B.lat0, "Q0"), pk(inv, "4A"), "sa0i");
        W(doc, pk(inv, "4Y"), pk(bufB, "A0"));
        W(doc, pk(bufB, "Y0"), pk(pullBhe, "P"), "bhen2");
        W(doc, pk(B.arb, "~AEN"), pk(bufB, "~G1"));
        W(doc, pk(B.arb, "~AEN"), pk(bufB, "~G2"));
        bus(doc, B.cpu, "AD", xcv, "A", 0, 7, "bxl");
        bus(doc, B.cpu, "AD", swap, "A", 0, 7, "bxs");
        W(doc, pk(B.ctl, "DT/~R"), pk(xcv, "DIR"));
        W(doc, pk(B.ctl, "DT/~R"), pk(swap, "DIR"));
        // even lane when A0=0, odd lane (crossed) when A0=1
        W(doc, enB, pk(or32, "3A"));
        W(doc, pk(B.lat0, "Q0"), pk(or32, "3B"), "sa0a");
        W(doc, pk(or32, "3Y"), pk(xcv, "~G"));
        W(doc, enB, pk(or32, "4A"));
        W(doc, pk(inv, "4Y"), pk(or32, "4B"));
        W(doc, pk(or32, "4Y"), pk(swap, "~G"));
        for (let i = 0; i < 8; i++) {
          W(doc, pk(xcv, "B" + i), pk(romL, "D" + i), "sdl2");
          W(doc, pk(swap, "B" + i), pk(romH, "D" + i), "sdh2");
        }
      }

      // arbitration: open-collector ~BUSY, serial priority A (8086) over B
      W(doc, pk(A.arb, "~BUSY"), pk(B.arb, "~BUSY"), "busy");
      W(doc, pk(A.arb, "~BUSY"), pk(pullBusy, "P"));
      W(doc, pk(A.arb, "~BPRN"), pk(gnd, "G"));
      W(doc, pk(A.arb, "~BPRO"), pk(B.arb, "~BPRN"));

      // ---- shared word memory: even/odd banks on SA1-13 ---------------------
      // all four bank chips share the same 13 bank-address pins,
      // and each RAM joins its lane's shared data bus
      for (const chip of [romH, ramL, ramH]) {
        for (let i = 0; i < 13; i++) W(doc, pk(romL, "A" + i), pk(chip, "A" + i), "ba" + i);
      }
      for (let i = 0; i < 8; i++) {
        W(doc, pk(romL, "D" + i), pk(ramL, "D" + i), "bdl" + i);
        W(doc, pk(romH, "D" + i), pk(ramH, "D" + i), "bdh" + i);
      }
      // decode: SA15 (alat1 Q7) splits ROM (high) from RAM (low)
      W(doc, pk(names.alat1, "Q7"), pk(inv, "3A"), "sa15");
      W(doc, pk(inv, "3Y"), pk(romL, "~CE"));
      W(doc, pk(inv, "3Y"), pk(romH, "~CE"), "romce");
      W(doc, pk(names.alat1, "Q7"), pk(ramL, "~CS1"), "ramcs");
      W(doc, pk(names.alat1, "Q7"), pk(ramH, "~CS1"), "ramcs2");
      W(doc, pk(ramL, "CS2"), pk(vcc, "V"));
      W(doc, pk(ramH, "CS2"), pk(vcc, "V"));
      for (const chip of [romL, romH, ramL, ramH]) W(doc, pk(pullRd, "P"), pk(chip, "~OE"), "moe");
      // write gating per lane: even needs SA0=0, odd needs BHEN=0
      W(doc, pk(pullWr, "P"), pk(or32, "1A"), "wg1");
      W(doc, pk(or32, "1Y"), pk(ramL, "~WE"));
      W(doc, pk(pullWr, "P"), pk(or32, "2A"), "wg2");
      W(doc, pk(pullBhe, "P"), pk(or32, "2B"), "wg2b");
      W(doc, pk(or32, "2Y"), pk(ramH, "~WE"));
      // shared LED port on the even lane: any IO write latches
      W(doc, pk(pullIo, "P"), pk(inv, "5A"), "cmdi2");
      W(doc, pk(inv, "5Y"), pk(port, "LE"));
      W(doc, pk(port, "~OE"), pk(gnd, "G"));
      for (let i = 0; i < 8; i++) W(doc, pk(romL, "D" + i), pk(port, "D" + i), "pd" + i);
      bus(doc, port, "Q", led, "A", 0, 7, "lq");
      W(doc, pk(led, "K"), pk(gnd, "G"));
      spread(doc, 1.22, 1.12);
      return { doc, names };
    },
  });


  K.presets.push({
    id: "pc-speaker",
    name: "PIT speaker (music)",
    speedIdx: 8,
    blurb: "The 8253 in mode 3 is a square-wave synthesizer: reprogram the divisor, change the note. The speaker symbol shows the live frequency — double-click it to listen.",
    defaultProgram: [
      "; Four notes on PIT channel 0, mode 3 (square wave), CLK0 = PCLK",
      "; f = 2386363 / divisor",
      "        org 0xE000",
      "start:  cli",
      "        xor ax, ax",
      "        mov ds, ax",
      "loop:   mov bx, 5423       ; A4  440 Hz",
      "        call note",
      "        mov bx, 4063       ; ~E5 587 Hz",
      "        call note",
      "        mov bx, 3616       ; ~A5 660 Hz",
      "        call note",
      "        mov bx, 2711       ; A5  880 Hz",
      "        call note",
      "        jmp loop",
      "note:   mov al, 0x36       ; ch0, lo+hi, mode 3",
      "        out 0x43, al",
      "        mov al, bl",
      "        out 0x40, al",
      "        mov al, bh",
      "        out 0x40, al",
      "        mov cx, 900",
      "d:      loop d",
      "        ret",
    ].join("\n"),
    romComp: "rom",
    makeRom: romImage8k,
    build() {
      const doc = K.newDoc();
      const { cpu, rom } = autoKit8088(doc);
      const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
      K.autoconnect(doc, ram, cpu);
      const pit = K.docAddComponent(doc, "8253", 66, 2);
      K.autoconnect(doc, pit, cpu);           // 40h-5Fh, CLK0 <- PCLK, GATE0 <- VCC
      const spk = K.docAddComponent(doc, "SPKR", 84, 2);
      const gnd = doc.components.find(c => c.type === "GND");
      W(doc, pk(pit, "OUT0"), pk(spk, "IN"));
      W(doc, pk(spk, "GND"), pk(gnd, "G"));
      return { doc, names: { cpu, rom, ram, pit, spk } };
    },
  });

  K.presets.push({
    id: "lpt-printer",
    name: "LPT1 printer",
    speedIdx: 6,
    blurb: "Centronics the honest way: poll BUSY in the status register, latch a byte, pulse STROBE from the control register, and the printer answers with BUSY/ACK. Double-click the printer to read the paper.",
    defaultProgram: [
      "; Print a line to LPT1 (378h data, 379h status, 37Ah control)",
      "        org 0xE000",
      "start:  cli",
      "        xor ax, ax",
      "        mov ds, ax",
      "        mov si, 0",
      "next:   mov al, [cs:msg+si]",
      "        test al, al",
      "        jz done",
      "wait:   mov dx, 0x379      ; bit7 = NOT busy",
      "        in al, dx",
      "        test al, 0x80",
      "        jz wait",
      "        mov al, [cs:msg+si]",
      "        mov dx, 0x378",
      "        out dx, al         ; data latch",
      "        mov dx, 0x37A",
      "        mov al, 0x0D       ; STROBE on (+INIT high, SLCTIN)",
      "        out dx, al",
      "        mov al, 0x0C       ; STROBE off",
      "        out dx, al",
      "        inc si",
      "        jmp next",
      "done:   hlt",
      "msg:    db 0x48, 0x45, 0x4C, 0x4C, 0x4F, 0x20, 0x38, 0x30, 0x38, 0x38, 0x21, 0x0A, 0",
    ].join("\n"),
    romComp: "rom",
    makeRom: romImage8k,
    build() {
      const doc = K.newDoc();
      const { cpu, rom } = autoKit8088(doc);
      const prn = K.docAddComponent(doc, "PRINTER", 68, 20);
      const lpt = K.docAddComponent(doc, "LPT378", 66, 2);
      K.autoconnect(doc, lpt, cpu);           // card + printer handshake in one go
      return { doc, names: { cpu, rom, lpt, prn } };
    },
  });


  K.presets.push({
    id: "pic-cascade",
    name: "Cascaded 8259As (15 IRQs)",
    speedIdx: 6,
    blurb: "Master and slave interrupt controllers, exactly like the PC/AT: the slave's INT feeds master IR2, the CAS bus carries the slave's ID during INTA, and the CPU sees 15 usable request lines. Press either button and watch which vector lands on the LEDs.",
    lab: [
      "Run the board, then press the MASTER button (IR4). The LEDs show the vector: 0Ch (base 08h + 4).",
      "Press the SLAVE button (its IR3). Now the LEDs show 73h — the SLAVE's base 70h + 3, delivered through the CAS bus.",
      "Double-click each 8259A while running: watch IRR/ISR light up, and see the master's ISR bit 2 set while the slave is in service.",
      "Open the waveform analyzer on ~INTA and the CAS lines: two INTA pulses, and the slave's ID (2) on CAS during the second one.",
      "In the code, find the ICW3 pair: 04h to the master (bitmask: slave on IR2) and 02h to the slave (my ID is 2). Change the slave to IR5 on both sides and re-wire INT accordingly — the vector still arrives.",
    ],
    defaultProgram: [
      "; Cascaded PICs: master at 20h (base 08), slave at 40h (base 70h) on IR2.",
      "        org 0xE000",
      "start:  cli",
      "        xor ax, ax",
      "        mov ds, ax",
      "        mov word [0x0C*4], m4      ; master IR4 -> INT 0Ch",
      "        mov [0x0C*4+2], cs",
      "        mov word [0x73*4], s3      ; slave IR3 -> INT 73h",
      "        mov [0x73*4+2], cs",
      "        mov al, 0x11               ; master ICW1: cascade, ICW4",
      "        out 0x20, al",
      "        mov al, 0x08",
      "        out 0x21, al",
      "        mov al, 0x04               ; ICW3: slave hangs on IR2",
      "        out 0x21, al",
      "        mov al, 0x01",
      "        out 0x21, al",
      "        mov al, 0x11               ; slave ICW1",
      "        out 0x40, al",
      "        mov al, 0x70",
      "        out 0x41, al",
      "        mov al, 0x02               ; slave ICW3: my ID = 2",
      "        out 0x41, al",
      "        mov al, 0x01",
      "        out 0x41, al",
      "        xor al, al",
      "        out 0x21, al               ; unmask all",
      "        out 0x41, al",
      "        sti",
      "idle:   hlt",
      "        jmp idle",
      "; NOTE: the display latch grabs EVERY IO write (one-gate decode),",
      "; so the vector must be the LAST thing written.",
      "m4:     push ax",
      "        mov al, 0x20",
      "        out 0x20, al               ; EOI master",
      "        mov al, 0x0C",
      "        out 0, al                  ; vector on the LEDs (last write)",
      "        pop ax",
      "        iret",
      "s3:     push ax",
      "        mov al, 0x20",
      "        out 0x41, al               ; EOI slave, then master",
      "        out 0x20, al",
      "        mov al, 0x73",
      "        out 0, al                  ; vector on the LEDs (last write)",
      "        pop ax",
      "        iret",
    ].join("\n"),
    romComp: "rom",
    makeRom: romImage8k,
    build() {
      const doc = K.newDoc();
      const { cpu, rom } = autoKit8088(doc);
      // free INTR (the CPU recipe straps it) for the master PIC
      doc.wires = doc.wires.filter(w => ![w.a, w.b].includes(pk(cpu, "INTR")));
      const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
      K.autoconnect(doc, ram, cpu);
      const pic = K.docAddComponent(doc, "8259A", 66, 2);
      K.autoconnect(doc, pic, cpu);                 // 20h, INT->INTR, ~INTA
      const slave = K.docAddComponent(doc, "8259A", 88, 2);
      K.autoconnect(doc, slave, cpu);               // next window: 40h
      const gnd = doc.components.find(c => c.type === "GND");
      doc.wires = doc.wires.filter(w => ![w.a, w.b].includes(pk(slave, "~SP/~EN")));
      W(doc, pk(slave, "~SP/~EN"), pk(gnd, "G"));   // strap as SLAVE
      W(doc, pk(slave, "INT"), pk(pic, "IR2"));
      for (const c of ["CAS0", "CAS1", "CAS2"]) W(doc, pk(pic, c), pk(slave, c), "cas");
      // two buttons with their own pull-ups
      const btnM = K.docAddComponent(doc, "BTN", 66, 26);
      const pullM = K.docAddComponent(doc, "PULLUP", 70, 26);
      W(doc, pk(btnM, "B"), pk(pic, "IR4"));
      W(doc, pk(pullM, "P"), pk(pic, "IR4"));
      const btnS = K.docAddComponent(doc, "BTN", 88, 26);
      const pullS = K.docAddComponent(doc, "PULLUP", 92, 26);
      W(doc, pk(btnS, "B"), pk(slave, "IR3"));
      W(doc, pk(pullS, "P"), pk(slave, "IR3"));
      // vector display: '373 latched by any IO write + LEDs
      const port = K.docAddComponent(doc, "74LS373", 106, 2);
      const led = K.docAddComponent(doc, "LED8", 122, 2);
      const inv = doc.components.find(c => c.type === "74LS04") || K.docAddComponent(doc, "74LS04", 106, 30);
      const and8 = K.docAddComponent(doc, "74LS08", 106, 16);
      W(doc, pk(cpu, "~WR"), pk(inv, "6A"));
      W(doc, pk(cpu, "IO/~M"), pk(and8, "1A"));
      W(doc, pk(inv, "6Y"), pk(and8, "1B"));
      W(doc, pk(and8, "1Y"), pk(port, "LE"));
      W(doc, pk(port, "~OE"), pk(gnd, "G"));
      for (let i = 0; i < 8; i++) {
        W(doc, pk(cpu, "AD" + i), pk(port, "D" + i), "vd");
        W(doc, pk(port, "Q" + i), pk(led, "A" + i), "vq");
      }
      W(doc, pk(led, "K"), pk(gnd, "G"));
      return { doc, names: { cpu, rom, ram, pic, slave, btnM, btnS, port, led } };
    },
  });

  K.presets.push({
    id: "pit-modes",
    name: "8254 timer modes",
    speedIdx: 6,
    blurb: "Channel 0 free-runs a mode-3 square wave; channel 1 is a mode-1 one-shot: press its GATE button and the LED stretches your press into one clean timed pulse. Double-click the 8254 to watch the counters live — and the program uses the 8254-only read-back command.",
    lab: [
      "Run the board. LED bit 0 blinks: channel 0, mode 3, dividing PCLK by 40000.",
      "Press and release the GATE button. LED bit 1 lights for one timed pulse — mode 1, a hardware one-shot. Press again mid-pulse: it retriggers.",
      "Double-click the 8254: watch count race downward and reload. Pause and edit the reload value, resume — the blink speed follows.",
      "The program's read-back command (0xE2 to port 43h) latches channel 0's status: find where the status byte lands in RAM with the unified memory viewer at 00100h.",
      "Waveform: put OUT0 and OUT1 side by side; measure the one-shot width against the square wave period with cursors.",
    ],
    defaultProgram: [
      "; ch0: mode 3 square wave (blink). ch1: mode 1 one-shot on the GATE button.",
      "        org 0xE000",
      "start:  cli",
      "        xor ax, ax",
      "        mov ds, ax",
      "        mov al, 0x36       ; ch0 lo+hi mode 3",
      "        out 0x43, al",
      "        mov al, 0x40",
      "        out 0x40, al",
      "        mov al, 0x9C       ; divisor 40000 -> ~60 Hz from PCLK",
      "        out 0x40, al",
      "        mov al, 0x72       ; ch1 lo+hi mode 1 (hw one-shot)",
      "        out 0x43, al",
      "        mov al, 0x00",
      "        out 0x41, al",
      "        mov al, 0x60       ; pulse length 0x6000 counts",
      "        out 0x41, al",
      "        mov al, 0xE2       ; 8254 READ-BACK: latch ch0 STATUS",
      "        out 0x43, al",
      "        in  al, 0x40",
      "        mov [0x100], al    ; stash the status byte for the lab",
      "spin:   jmp spin",
    ].join("\n"),
    romComp: "rom",
    makeRom: romImage8k,
    build() {
      const doc = K.newDoc();
      const { cpu, rom } = autoKit8088(doc);
      const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
      K.autoconnect(doc, ram, cpu);
      const pit = K.docAddComponent(doc, "8254", 66, 2);
      K.autoconnect(doc, pit, cpu);                 // 40h; CLK0 <- PCLK, GATE0 <- VCC
      const cg = doc.components.find(c => c.type === "8284A");
      const vcc = doc.components.find(c => c.type === "VCC");
      const gnd = doc.components.find(c => c.type === "GND");
      W(doc, pk(cg, "PCLK"), pk(pit, "CLK1"));
      // GATE button with its own pull-up
      const btn = K.docAddComponent(doc, "BTN", 66, 24);
      const pull = K.docAddComponent(doc, "PULLUP", 70, 24);
      W(doc, pk(btn, "B"), pk(pit, "GATE1"));
      W(doc, pk(pull, "P"), pk(pit, "GATE1"));
      const led = K.docAddComponent(doc, "LED8", 84, 2);
      W(doc, pk(pit, "OUT0"), pk(led, "A0"));
      W(doc, pk(pit, "OUT1"), pk(led, "A1"));
      W(doc, pk(led, "K"), pk(gnd, "G"));
      return { doc, names: { cpu, rom, ram, pit, btn, led } };
    },
  });

  K.presets.push({
    id: "fixit-lab",
    name: "Fix this board!",
    speedIdx: 5,
    blurb: "Someone wired this kit in a hurry: the CPU runs, the program is fine, and yet the LEDs stay dark and the reset button is living on luck. Open the DRC tab, read the explainers, and repair it with two wires.",
    lab: [
      "Press Start. The simulation runs (no strict violations) — but the LEDs never light. A working program on a broken board.",
      "Open the DRC tab. Two weak warnings: read both explainers.",
      "First bug: the '373 output port's ~OE pin floats. Floating TTL reads 1 = outputs disabled — the latch faithfully stores every OUT, and shows nothing. Stop, wire ~OE to GND, run: the blinker appears.",
      "Second bug: the reset button has no pull-up. It 'works' because a floating wire happens to read 1 — until it doesn't. Wire the PULLUP onto the ~RES net to make it solid.",
      "Re-run DRC: clean. This is the whole point of the tool — the board TELLS you what a scope tech would find.",
    ],
    defaultProgram: [
      "; The classic blinker. The PROGRAM is not the problem.",
      "        org 0xE000",
      "start:  mov al, 0x55",
      "        out 0, al",
      "        mov cx, 4",
      "d1:     loop d1",
      "        mov al, 0xAA",
      "        out 0, al",
      "        mov cx, 4",
      "d2:     loop d2",
      "        jmp start",
    ].join("\n"),
    romComp: "rom",
    makeRom: romImage8k,
    build() {
      const doc = K.newDoc();
      const xt = K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
      const cg = K.docAddComponent(doc, "8284A", 2, 6);
      const cpu = K.docAddComponent(doc, "8088", 16, 2);
      K.autoconnect(doc, cpu, null);
      // sabotage #2: pull the reset button's pull-up OFF the ~RES net
      const pull = doc.components.find(c => c.type === "PULLUP");
      doc.wires = doc.wires.filter(w => ![w.a, w.b].includes(pk(pull, "P")));
      const btn = doc.components.find(c => c.type === "BTN");
      if (!btn) {
        const b = K.docAddComponent(doc, "BTN", 2, 30);
        W(doc, pk(b, "B"), pk(cg, "~RES"));
      } else W(doc, pk(btn, "B"), pk(cg, "~RES"));
      const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
      K.autoconnect(doc, rom, cpu);
      // output port — with sabotage #1: ~OE left floating
      const port = K.docAddComponent(doc, "74LS373", 50, 20);
      const led = K.docAddComponent(doc, "LED8", 66, 20);
      const inv = doc.components.find(c => c.type === "74LS04") || K.docAddComponent(doc, "74LS04", 50, 32);
      const and8 = K.docAddComponent(doc, "74LS08", 58, 32);
      const gnd = doc.components.find(c => c.type === "GND");
      W(doc, pk(cpu, "~WR"), pk(inv, "6A"));
      W(doc, pk(cpu, "IO/~M"), pk(and8, "1A"));
      W(doc, pk(inv, "6Y"), pk(and8, "1B"));
      W(doc, pk(and8, "1Y"), pk(port, "LE"));
      // (no ~OE wire — that is the bug)
      for (let i = 0; i < 8; i++) {
        W(doc, pk(cpu, "AD" + i), pk(port, "D" + i), "pd");
        W(doc, pk(port, "Q" + i), pk(led, "A" + i), "pq");
      }
      W(doc, pk(led, "K"), pk(gnd, "G"));
      return { doc, names: { cpu, rom, port, led, btn: doc.components.find(c => c.type === "BTN"), pull } };
    },
  });

  // The empty bench: start from nothing, wire by canvas or by table.
  K.presets.unshift({
    id: "blank",
    name: "— blank board —",
    speedIdx: 5,
    blurb: "An empty bench. Place chips from the library, let autoconnect do the standard hookups, or wire pin-by-pin from each chip's connection table.",
    defaultProgram: [
      "; A blank board. Place a CPU, clock and memory, then write code here.",
      "        org 0xE000",
      "start:  hlt",
    ].join("\n"),
    build() { return { doc: K.newDoc(), names: {} }; },
  });

  K.presetById = (id) => K.presets.find(p => p.id === id);
})(globalThis.K8086 ??= {});
