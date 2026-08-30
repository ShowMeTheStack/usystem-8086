import { loadK } from "./load.mjs";
const K = loadK();

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok ", name); pass++; }
  catch (e) { console.log("FAIL ", name, "—", e.message); console.log(e.stack.split("\n").slice(1, 3).join("\n")); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };

function runUntilHalt(sim, cpuChip, maxHalves = 60000) {
  for (let i = 0; i < maxHalves; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("sim halted: " + JSON.stringify(sim.halted));
    if (cpuChip.runtime.core.euBlocked === "halt") return;
  }
  throw new Error("CPU never reached HLT");
}

function bareCluster(doc, cpuType) {
  const xt = K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
  const cg = K.docAddComponent(doc, "8284A", 2, 6);
  const cpu = K.docAddComponent(doc, cpuType, 16, 2);
  return { xt, cg, cpu };
}

// ---- 8088: CPU + ROM + RAM entirely from autoconnect --------------------------
test("autoconnect: bare 8088 + EPROM + SRAM boots and hits RAM", () => {
  const doc = K.newDoc();
  const { cpu } = bareCluster(doc, "8088");
  let r = K.autoconnect(doc, cpu, null);
  assert(r && r.wires > 6, "CPU recipe wired nothing");
  const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
  r = K.autoconnect(doc, rom, cpu);
  assert(r.notes.some(n => n.includes("E0000h-FFFFFh")), "ROM not at top window: " + r.notes.join(";"));
  const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
  r = K.autoconnect(doc, ram, cpu);
  assert(r.notes.some(n => n.includes("00000h-1FFFFh")), "RAM not at bottom window: " + r.notes.join(";"));

  const drc = K.runDrc(doc);
  assert(drc.strict.length === 0, "DRC strict: " + drc.strict.map(f => f.msg).join("; "));

  const asm = K.assemble([
    "        org 0xE000",
    "start:  cli",
    "        xor ax, ax",
    "        mov ds, ax",
    "        mov word [0x40], 0xBEEF",
    "        mov al, [0x41]",
    "        hlt",
  ].join("\n"));
  const img = new Uint8Array(8192).fill(0xFF);
  img.set(asm.bytes, asm.org & 0x1FFF);
  img.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0);
  K.programMemory(doc, rom.id, img);

  const sim = new K.Sim(doc);
  const cpuChip = sim.chips.find(c => c.def.isCpu);
  runUntilHalt(sim, cpuChip);
  const ramChip = sim.chipFor(ram.id);
  assert(ramChip.state.mem[0x40] === 0xEF && ramChip.state.mem[0x41] === 0xBE,
    "RAM word wrong: " + ramChip.state.mem[0x40] + "," + ramChip.state.mem[0x41]);
  assert(cpuChip.state.arch, "no arch snapshot at HLT");
});

// ---- 8088: peripheral via the IO decoder --------------------------------------
test("autoconnect: 8255 lands at 60h and takes mode + data writes", () => {
  const doc = K.newDoc();
  const { cpu } = bareCluster(doc, "8088");
  K.autoconnect(doc, cpu, null);
  const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
  K.autoconnect(doc, rom, cpu);
  const ppi = K.docAddComponent(doc, "8255", 50, 20);
  const r = K.autoconnect(doc, ppi, cpu);
  assert(r.notes.some(n => n.includes("60h-7Fh")), "8255 not at 60h: " + r.notes.join(";"));

  const drc = K.runDrc(doc);
  assert(drc.strict.length === 0, "DRC strict: " + drc.strict.map(f => f.msg).join("; "));

  const asm = K.assemble([
    "        org 0xE000",
    "start:  cli",
    "        mov al, 0x80      ; mode 0, all outputs",
    "        out 0x63, al",
    "        mov al, 0xA5",
    "        out 0x60, al      ; port A",
    "        hlt",
  ].join("\n"));
  const img = new Uint8Array(8192).fill(0xFF);
  img.set(asm.bytes, asm.org & 0x1FFF);
  img.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0);
  K.programMemory(doc, rom.id, img);

  const sim = new K.Sim(doc);
  const cpuChip = sim.chips.find(c => c.def.isCpu);
  runUntilHalt(sim, cpuChip);
  const ppiChip = sim.chipFor(ppi.id);
  assert(ppiChip.state.ctrl === 0x80, "ctrl=" + ppiChip.state.ctrl.toString(16));
  assert(ppiChip.state.a === 0xA5, "port A=" + ppiChip.state.a.toString(16));
});

// ---- 8086: two-lane memory with bank addressing -------------------------------
test("autoconnect: 8086 word board — both lanes, word write lands split", () => {
  const doc = K.newDoc();
  const { cpu } = bareCluster(doc, "8086");
  K.autoconnect(doc, cpu, null);
  const romL = K.docAddComponent(doc, "EPROM2764", 50, 2);
  const romH = K.docAddComponent(doc, "EPROM2764", 66, 2);
  const ramL = K.docAddComponent(doc, "SRAM6264", 50, 20);
  const ramH = K.docAddComponent(doc, "SRAM6264", 66, 20);
  let r = K.autoconnect(doc, romL, cpu);
  assert(r.notes.some(n => n.includes("low byte lane")), "romL lane: " + r.notes.join(";"));
  r = K.autoconnect(doc, romH, cpu);
  assert(r.notes.some(n => n.includes("high byte lane")), "romH lane: " + r.notes.join(";"));
  K.autoconnect(doc, ramL, cpu);
  r = K.autoconnect(doc, ramH, cpu);
  assert(r.notes.some(n => n.includes("high byte lane")), "ramH lane: " + r.notes.join(";"));

  const drc = K.runDrc(doc);
  assert(drc.strict.length === 0, "DRC strict: " + drc.strict.map(f => f.msg).join("; "));

  const asm = K.assemble([
    "        org 0xE000",
    "start:  cli",
    "        xor ax, ax",
    "        mov ds, ax",
    "        mov word [0x40], 0xCAFE",
    "        mov bx, [0x40]",
    "        mov [0x50], bx",
    "        hlt",
  ].join("\n"));
  // split program + reset vector across the byte lanes (bank addr = phys >> 1)
  const lo = new Uint8Array(8192).fill(0xFF), hi = new Uint8Array(8192).fill(0xFF);
  const put = (phys, byte) => { (phys & 1 ? hi : lo)[(phys >> 1) & 0x1FFF] = byte; };
  asm.bytes.forEach((b, i) => put(0xFE000 + i, b));
  [0xEA, 0x00, 0xE0, 0x00, 0xF0].forEach((b, i) => put(0xFFFF0 + i, b));
  K.programMemory(doc, romL.id, lo);
  K.programMemory(doc, romH.id, hi);

  const sim = new K.Sim(doc);
  const cpuChip = sim.chips.find(c => c.def.isCpu);
  runUntilHalt(sim, cpuChip);
  const l = sim.chipFor(ramL.id).state.mem, h = sim.chipFor(ramH.id).state.mem;
  assert(l[0x20] === 0xFE && h[0x20] === 0xCA, "write split wrong: " + l[0x20] + "," + h[0x20]);
  assert(l[0x28] === 0xFE && h[0x28] === 0xCA, "read-back copy wrong: " + l[0x28] + "," + h[0x28]);
});

// ---- multi-CPU targeting ------------------------------------------------------
test("autoconnect: with two CPUs, wiring goes to the chosen one", () => {
  const doc = K.newDoc();
  const a = bareCluster(doc, "8088");
  const b = { xt: K.docAddComponent(doc, "XTAL", 2, 40, { mhz: 14.31818 }),
              cg: K.docAddComponent(doc, "8284A", 2, 44),
              cpu: K.docAddComponent(doc, "8088", 16, 40) };
  K.autoconnect(doc, a.cpu, null);
  K.autoconnect(doc, b.cpu, null);
  const ram = K.docAddComponent(doc, "SRAM6264", 50, 40);
  K.autoconnect(doc, ram, b.cpu);
  const { byPin } = K.extractNets(doc);
  const oeNet = byPin.get(K.pinKey(ram, "~OE"));
  assert(oeNet && oeNet === byPin.get(K.pinKey(b.cpu, "~RD")), "~OE not on CPU B's ~RD");
  assert(oeNet !== byPin.get(K.pinKey(a.cpu, "~RD")), "~OE wrongly shared with CPU A");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
