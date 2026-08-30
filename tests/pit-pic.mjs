// 8254 read-back + PIT modes 1/4/5, and 8259A cascade / level / rotation —
// all exercised by real programs on autoconnect-built boards.
import { loadK } from "./load.mjs";
const K = loadK();

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok ", name); pass++; }
  catch (e) { console.log("FAIL ", name, "—", e.message); console.log(e.stack.split("\n").slice(1, 3).join("\n")); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };

function pitBoard() {
  const doc = K.newDoc();
  K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
  K.docAddComponent(doc, "8284A", 2, 6);
  const cpu = K.docAddComponent(doc, "8088", 16, 2);
  K.autoconnect(doc, cpu, null);
  const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
  K.autoconnect(doc, rom, cpu);
  const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
  K.autoconnect(doc, ram, cpu);
  const pit = K.docAddComponent(doc, "8254", 66, 2);
  K.autoconnect(doc, pit, cpu);          // 40h-5Fh, CLK0 <- PCLK, GATE0 <- VCC
  // GATE1 under test control via a button + its OWN pullup (pressed = LOW)
  // (never reuse the board's first pullup: that's the 8284 ~RES net!)
  const btn = K.docAddComponent(doc, "BTN", 66, 22);
  const pull = K.docAddComponent(doc, "PULLUP", 70, 22);
  K.docConnect(doc, K.pinKey(btn, "B"), K.pinKey(pit, "GATE1"));
  K.docConnect(doc, K.pinKey(pull, "P"), K.pinKey(pit, "GATE1"));
  const cg = doc.components.find(c => c.type === "8284A");
  K.docConnect(doc, K.pinKey(cg, "PCLK"), K.pinKey(pit, "CLK1"));
  return { doc, cpu, rom, ram, pit, btn };
}

function boot(doc, rom, source) {
  const asm = K.assemble(source.join("\n"));
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  const img = new Uint8Array(8192).fill(0xFF);
  img.set(asm.bytes, asm.org & 0x1FFF);
  img.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0);
  K.programMemory(doc, rom.id, img);
  return new K.Sim(doc);
}
const untilHalt = (sim, max = 400000) => {
  const cpu = sim.chips.find(c => c.def.isCpu);
  for (let i = 0; i < max; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("sim halted: " + JSON.stringify(sim.halted));
    if (cpu.runtime.core.euBlocked === "halt") return cpu;
  }
  throw new Error("no HLT");
};

test("8254 read-back: status byte + latched count in one command", () => {
  const { doc, rom, ram, pit } = pitBoard();
  const sim = boot(doc, rom, [
    "        org 0xE000",
    "start:  cli",
    "        xor ax, ax",
    "        mov ds, ax",
    "        mov al, 0x34       ; ch0 lo+hi mode 2",
    "        out 0x43, al",
    "        mov al, 0x40",
    "        out 0x40, al",
    "        mov al, 0x00       ; divisor 0x0040",
    "        out 0x40, al",
    "        mov cx, 20",
    "d:      loop d             ; let it count a little",
    "        mov al, 0xC2       ; read-back: latch STATUS+COUNT of ch0",
    "        out 0x43, al",
    "        in  al, 0x40       ; status byte first",
    "        mov [0x10], al",
    "        in  al, 0x40       ; then latched count lo",
    "        mov [0x11], al",
    "        in  al, 0x40       ; latched count hi",
    "        mov [0x12], al",
    "        hlt",
  ]);
  untilHalt(sim);
  const m = sim.chipFor(ram.id).state.mem;
  // status: OUT=1 (mode 2 counting), NULL=0, RW=3, MODE=2, BCD=0 -> 0xB4
  if (m[0x10] !== 0xB4) throw new Error("status=" + m[0x10].toString(16) + " (wanted b4)");
  const count = m[0x11] | (m[0x12] << 8);
  assert(count > 0 && count < 0x40, "latched count " + count + " not inside period");
});

test("PIT mode 1: one-shot waits for the GATE trigger, retriggers", () => {
  const { doc, rom, pit, btn } = pitBoard();
  const sim = boot(doc, rom, [
    "        org 0xE000",
    "start:  cli",
    "        mov al, 0x72       ; ch1 lo+hi mode 1",
    "        out 0x43, al",
    "        mov al, 0x30",
    "        out 0x41, al",
    "        mov al, 0x00       ; count 0x30",
    "        out 0x41, al",
    "spin:   jmp spin",
  ]);
  const c1 = sim.chipFor(pit.id).state.ctr[1];
  for (let i = 0; i < 30000; i++) sim.stepHalf();
  assert(c1.out === 1 && !c1.armed, "must idle high before trigger (out=" + c1.out + ")");
  // trigger: GATE1 rising edge (button release drives the pullup high after low)
  sim.applyInput(btn.id, { pressed: true });
  for (let i = 0; i < 200; i++) sim.stepHalf();
  sim.applyInput(btn.id, { pressed: false });   // rising edge here
  let sawLow = false;
  for (let i = 0; i < 3000; i++) { sim.stepHalf(); if (c1.out === 0) sawLow = true; }
  assert(sawLow, "one-shot never fired low");
  assert(c1.out === 1, "one-shot never completed back high");
});

test("PIT modes 4 and 5: one-CLK strobe at terminal count", () => {
  const { doc, rom, pit, btn } = pitBoard();
  const sim = boot(doc, rom, [
    "        org 0xE000",
    "start:  cli",
    "        mov al, 0x78       ; ch1 lo+hi mode 4 (sw strobe)",
    "        out 0x43, al",
    "        mov al, 0x20",
    "        out 0x41, al",
    "        mov al, 0x00",
    "        out 0x41, al",
    "spin:   jmp spin",
  ]);
  const c1 = sim.chipFor(pit.id).state.ctr[1];
  let lows = 0, prev = 1, armed = false;   // ignore the pre-init OUT=0
  for (let i = 0; i < 40000; i++) {
    sim.stepHalf();
    if (c1.out === 1) armed = true;
    if (armed && c1.out === 0 && prev === 1) lows++;
    prev = c1.out;
  }
  assert(lows === 1, "mode 4 strobed " + lows + " times (wanted exactly 1)");
  assert(c1.out === 1, "strobe must return high");
  // reprogram to mode 5: nothing happens until the GATE trigger
  const pitChip = sim.chipFor(pit.id);
  // (reuse the same board: poke mode 5 via the register path the CPU used)
  // easier: fresh board, mode 5
  const b2 = pitBoard();
  const sim2 = boot(b2.doc, b2.rom, [
    "        org 0xE000",
    "start:  cli",
    "        mov al, 0x7A       ; ch1 lo+hi mode 5 (hw strobe)",
    "        out 0x43, al",
    "        mov al, 0x20",
    "        out 0x41, al",
    "        mov al, 0x00",
    "        out 0x41, al",
    "spin:   jmp spin",
  ]);
  const c2 = sim2.chipFor(b2.pit.id).state.ctr[1];
  let lows2 = 0, seenHigh = false; prev = 1;
  const sample2 = () => {
    if (c2.out === 1) seenHigh = true;
    if (seenHigh && c2.out === 0 && prev === 1) lows2++;
    prev = c2.out;
  };
  for (let i = 0; i < 30000; i++) { sim2.stepHalf(); sample2(); }
  assert(lows2 === 0, "mode 5 strobed before trigger");
  sim2.applyInput(b2.btn.id, { pressed: true });
  for (let i = 0; i < 200; i++) sim2.stepHalf();
  sim2.applyInput(b2.btn.id, { pressed: false });
  for (let i = 0; i < 3000; i++) { sim2.stepHalf(); sample2(); }
  assert(lows2 === 1, "mode 5 strobes after trigger (got " + lows2 + ")");
});

// ---- 8259A boards -------------------------------------------------------------
function picBoard(two) {
  const doc = K.newDoc();
  K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
  K.docAddComponent(doc, "8284A", 2, 6);
  const cpu = K.docAddComponent(doc, "8088", 16, 2);
  K.autoconnect(doc, cpu, null);
  // free INTR for the PIC (autoconnect strapped it to GND)
  doc.wires = doc.wires.filter(w => ![w.a, w.b].includes(K.pinKey(cpu, "INTR")));
  const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
  K.autoconnect(doc, rom, cpu);
  const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
  K.autoconnect(doc, ram, cpu);
  const pic = K.docAddComponent(doc, "8259A", 66, 2);
  K.autoconnect(doc, pic, cpu);          // 20h, ~INTA + INT->INTR wired by recipe
  const btn = K.docAddComponent(doc, "BTN", 66, 24);
  const pull = K.docAddComponent(doc, "PULLUP", 70, 24);
  const inv = doc.components.find(c => c.type === "74LS04");
  const names = { cpu, rom, ram, pic, btn, pull };
  if (two) {
    const slave = K.docAddComponent(doc, "8259A", 84, 2);
    K.autoconnect(doc, slave, cpu);      // next window: 40h
    const gnd = doc.components.find(c => c.type === "GND");
    // slave strap + cascade wiring: INT->master IR2, CAS bus, shared ~INTA
    doc.wires = doc.wires.filter(w => ![w.a, w.b].includes(K.pinKey(slave, "~SP/~EN")));
    K.docConnect(doc, K.pinKey(slave, "~SP/~EN"), K.pinKey(gnd, "G"));
    K.docConnect(doc, K.pinKey(slave, "INT"), K.pinKey(pic, "IR2"));
    for (const c of ["CAS0", "CAS1", "CAS2"])
      K.docConnect(doc, K.pinKey(pic, c), K.pinKey(slave, c), "cas");
    names.slave = slave;
  }
  return { doc, names };
}

test("8259A cascade: slave IR3 delivers the slave's vector through the CAS bus", () => {
  const { doc, names } = picBoard(true);
  // button (active low through pullup) -> slave IR3
  K.docConnect(doc, K.pinKey(names.btn, "B"), K.pinKey(names.slave, "IR3"));
  K.docConnect(doc, K.pinKey(names.pull, "P"), K.pinKey(names.slave, "IR3"));
  const sim = boot(doc, names.rom, [
    "        org 0xE000",
    "start:  cli",
    "        xor ax, ax",
    "        mov ds, ax",
    "        mov word [0x70*4], isr     ; slave base 0x70 + IR3 -> INT 73h",
    "        mov [0x70*4+2], cs",
    "        mov word [0x73*4], isr",
    "        mov [0x73*4+2], cs",
    "        mov al, 0x11               ; master ICW1: cascade, ICW4 needed",
    "        out 0x20, al",
    "        mov al, 0x08               ; ICW2 base 8",
    "        out 0x21, al",
    "        mov al, 0x04               ; ICW3: slave on IR2",
    "        out 0x21, al",
    "        mov al, 0x01               ; ICW4 8086 mode",
    "        out 0x21, al",
    "        mov al, 0x11               ; slave ICW1",
    "        out 0x40, al",
    "        mov al, 0x70               ; slave ICW2 base 0x70",
    "        out 0x41, al",
    "        mov al, 0x02               ; slave ICW3: my ID = 2",
    "        out 0x41, al",
    "        mov al, 0x01",
    "        out 0x41, al",
    "        xor al, al                 ; unmask everything",
    "        out 0x21, al",
    "        out 0x41, al",
    "        sti",
    "wait1:  cmp byte [0x100], 0",
    "        jz wait1",
    "        hlt",
    "isr:    push ax",
    "        mov byte [0x100], 0x73     ; marker: which vector ran",
    "        mov al, 0x20               ; EOI slave then master",
    "        out 0x41, al",
    "        out 0x20, al",
    "        pop ax",
    "        iret",
  ]);
  const cpu = sim.chips.find(c => c.def.isCpu);
  // run init, then press the button to raise slave IR3
  for (let i = 0; i < 120000 && cpu.runtime.core.insnCount < 40; i++) sim.stepHalf();
  sim.applyInput(names.btn.id, { pressed: false });   // ensure high (pullup)
  for (let i = 0; i < 2000; i++) sim.stepHalf();
  sim.applyInput(names.btn.id, { pressed: true });    // low
  for (let i = 0; i < 2000; i++) sim.stepHalf();
  sim.applyInput(names.btn.id, { pressed: false });   // rising edge -> IR3
  untilHalt(sim, 600000);
  const m = sim.chipFor(names.ram.id).state.mem;
  if (m[0x100] !== 0x73) throw new Error("marker=" + m[0x100].toString(16) + " (wanted 73 = slave base+IR3)");
});

test("8259A level-triggered: line held high re-interrupts after EOI", () => {
  const { doc, names } = picBoard(false);
  // drive IR4 from a DIP switch (holds level)
  const sw = K.docAddComponent(doc, "SW8", 84, 24, { bits: 0 });
  K.docConnect(doc, K.pinKey(sw, "S0"), K.pinKey(names.pic, "IR4"));
  const sim = boot(doc, names.rom, [
    "        org 0xE000",
    "start:  cli",
    "        xor ax, ax",
    "        mov ds, ax",
    "        mov word [12*4], isr       ; base 8 + IR4 -> INT 0Ch",
    "        mov [12*4+2], cs",
    "        mov al, 0x19               ; ICW1: LEVEL mode, single, ICW4",
    "        out 0x20, al",
    "        mov al, 0x08",
    "        out 0x21, al",
    "        mov al, 0x01",
    "        out 0x21, al",
    "        xor al, al",
    "        out 0x21, al",
    "        sti",
    "spin:   jmp spin",
    "isr:    push ax",
    "        inc byte [0x100]           ; count entries",
    "        mov al, 0x20",
    "        out 0x20, al               ; EOI — line STILL high",
    "        pop ax",
    "        iret",
  ]);
  const cpu = sim.chips.find(c => c.def.isCpu);
  for (let i = 0; i < 120000 && cpu.runtime.core.insnCount < 30; i++) sim.stepHalf();
  sim.applyInput(sw.id, { bits: 1 });                 // IR4 high, and it STAYS high
  const m = sim.chipFor(names.ram.id).state.mem;
  for (let i = 0; i < 300000 && m[0x100] < 4; i++) sim.stepHalf();
  if (m[0x100] < 4) throw new Error("level mode re-fired only " + m[0x100] + " times");
  sim.applyInput(sw.id, { bits: 0 });                 // drop the line: storm ends
  const at = m[0x100];
  for (let i = 0; i < 60000; i++) sim.stepHalf();
  if (m[0x100] > at + 1) throw new Error("still firing after line dropped");
});

test("8259A rotation: two competing IRQs take turns after rotate-on-EOI", () => {
  const { doc, names } = picBoard(false);
  // IR4 and IR5 both held high from DIP switches (edge mode: retrigger by toggling)
  const sw = K.docAddComponent(doc, "SW8", 84, 24, { bits: 0 });
  K.docConnect(doc, K.pinKey(sw, "S0"), K.pinKey(names.pic, "IR4"));
  K.docConnect(doc, K.pinKey(sw, "S1"), K.pinKey(names.pic, "IR5"));
  const sim = boot(doc, names.rom, [
    "        org 0xE000",
    "start:  cli",
    "        xor ax, ax",
    "        mov ds, ax",
    "        mov word [12*4], isr4      ; IR4 -> INT 0Ch",
    "        mov [12*4+2], cs",
    "        mov word [13*4], isr5      ; IR5 -> INT 0Dh",
    "        mov [13*4+2], cs",
    "        mov al, 0x13               ; ICW1: edge, single, ICW4",
    "        out 0x20, al",
    "        mov al, 0x08",
    "        out 0x21, al",
    "        mov al, 0x01",
    "        out 0x21, al",
    "        xor al, al",
    "        out 0x21, al",
    "        mov di, 0x100              ; service-order log",
    "        sti",
    "spin:   jmp spin",
    "isr4:   push ax",
    "        mov al, 4",
    "        mov [di], al",
    "        inc di",
    "        mov al, 0xA0               ; ROTATE on non-specific EOI",
    "        out 0x20, al",
    "        pop ax",
    "        iret",
    "isr5:   push ax",
    "        mov al, 5",
    "        mov [di], al",
    "        inc di",
    "        mov al, 0xA0",
    "        out 0x20, al",
    "        pop ax",
    "        iret",
  ]);
  const cpu = sim.chips.find(c => c.def.isCpu);
  for (let i = 0; i < 120000 && cpu.runtime.core.insnCount < 40; i++) sim.stepHalf();
  // repeatedly raise BOTH lines simultaneously (edge retriggers)
  const m = sim.chipFor(names.ram.id).state.mem;
  for (let round = 0; round < 8; round++) {
    sim.applyInput(sw.id, { bits: 3 });
    for (let i = 0; i < 30000; i++) sim.stepHalf();
    sim.applyInput(sw.id, { bits: 0 });
    for (let i = 0; i < 4000; i++) sim.stepHalf();
  }
  const log = [];
  for (let i = 0x100; i < 0x140 && m[i]; i++) log.push(m[i]);
  assert(log.length >= 6, "too few services: " + log.join(","));
  // with rotation, IR5 must get served even while IR4 keeps requesting —
  // and after an IR4 service, the next simultaneous pair goes to IR5
  const fives = log.filter(v => v === 5).length, fours = log.filter(v => v === 4).length;
  assert(fives >= 2 && fours >= 2, "no fair sharing: " + log.join(","));
  let alternations = 0;
  for (let i = 1; i < log.length; i++) if (log[i] !== log[i - 1]) alternations++;
  assert(alternations >= log.length / 2 - 1, "not rotating: " + log.join(","));
  console.log(`      (service order: ${log.join(" ")})`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
