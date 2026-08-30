import { loadK } from "./load.mjs";
const K = loadK();

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok ", name); pass++; }
  catch (e) { console.log("FAIL ", name, "—", e.message); console.log(e.stack.split("\n").slice(1, 3).join("\n")); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };

function board8088() {
  const doc = K.newDoc();
  K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
  K.docAddComponent(doc, "8284A", 2, 6);
  const cpu = K.docAddComponent(doc, "8088", 16, 2);
  K.autoconnect(doc, cpu, null);
  const rom = K.docAddComponent(doc, "EPROM2764", 50, 2);
  K.autoconnect(doc, rom, cpu);
  return { doc, cpu, rom };
}

function runUntilHalt(sim, maxHalves = 60000) {
  const cpuChip = sim.chips.find(c => c.def.isCpu);
  for (let i = 0; i < maxHalves; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("sim halted: " + JSON.stringify(sim.halted));
    if (cpuChip.runtime.core.euBlocked === "halt") return;
  }
  throw new Error("CPU never reached HLT");
}

test("rangecalc: 8K SRAM lands exactly at 08000h (2x'138 + OR on A13)", () => {
  const { doc, cpu, rom } = board8088();
  const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
  const r = K.synthRange(doc, ram, cpu, 0x08000);
  assert(r.ok, "not ok: " + r.notes.join(";"));
  assert(r.notes.some(n => n.includes("08000h-09FFFh") && n.includes("no mirrors")), r.notes.join(";"));
  const drc = K.runDrc(doc);
  assert(drc.strict.length === 0, "DRC strict: " + drc.strict.map(f => f.msg).join("; "));

  const asm = K.assemble([
    "        org 0xE000",
    "start:  cli",
    "        mov ax, 0x0800",
    "        mov ds, ax",
    "        mov word [0x10], 0x55AA   ; phys 08010h",
    "        hlt",
  ].join("\n"));
  const img = new Uint8Array(8192).fill(0xFF);
  img.set(asm.bytes, asm.org & 0x1FFF);
  img.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0);
  K.programMemory(doc, rom.id, img);
  const sim = new K.Sim(doc);
  runUntilHalt(sim);
  const m = sim.chipFor(ram.id).state.mem;
  assert(m[0x10] === 0xAA && m[0x11] === 0x55, "RAM word wrong: " + m[0x10] + "," + m[0x11]);
});

test("rangecalc: exact decode means no mirrors anywhere in the map", () => {
  const { doc, cpu } = board8088();
  const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
  K.synthRange(doc, ram, cpu, 0x08000);
  const map = K.analyzeMemoryMap(doc);
  const entry = map.cpus.find(c => c.compId === cpu.id);
  const segs = entry.segments.filter(s => s.parts.some(p => p.compId === ram.id));
  assert(segs.length === 1, "segments: " + segs.map(s => s.start.toString(16) + "-" + s.end.toString(16) + (s.alias ? "A" : "")).join(","));
  assert(!segs[0].alias && segs[0].start === 0x08000 && segs[0].end === 0x09FFF, "wrong seg");
});

test("rangecalc: 32K SRAM at 18000h reuses the window, '138 on A15-16", () => {
  const { doc, cpu } = board8088();
  const ram = K.docAddComponent(doc, "SRAM62256", 50, 20);
  const r = K.synthRange(doc, ram, cpu, 0x18000);
  assert(r.ok, "not ok: " + r.notes.join(";"));
  const map = K.analyzeMemoryMap(doc);
  const entry = map.cpus.find(c => c.compId === cpu.id);
  const segs = entry.segments.filter(s => s.parts.some(p => p.compId === ram.id));
  assert(segs.length === 1 && !segs[0].alias && segs[0].start === 0x18000 && segs[0].end === 0x1FFFF,
    "segs: " + segs.map(s => s.start.toString(16) + "-" + s.end.toString(16)).join(","));
});

test("rangecalc: re-ranging an autoconnected chip replaces its select", () => {
  const { doc, cpu } = board8088();
  const ram = K.docAddComponent(doc, "SRAM6264", 50, 20);
  K.autoconnect(doc, ram, cpu);              // partial decode at window 0
  const r = K.synthRange(doc, ram, cpu, 0x04000);
  assert(r.ok, "not ok: " + r.notes.join(";"));
  assert(r.notes.some(n => n.includes("replaced the previous select")), r.notes.join(";"));
  const map = K.analyzeMemoryMap(doc);
  const entry = map.cpus.find(c => c.compId === cpu.id);
  const segs = entry.segments.filter(s => s.parts.some(p => p.compId === ram.id));
  assert(segs.length === 1 && segs[0].start === 0x04000 && segs[0].end === 0x05FFF,
    "segs: " + segs.map(s => s.start.toString(16) + "-" + s.end.toString(16) + (s.alias ? "A" : "")).join(","));
});

test("rangecalc: misaligned base and occupied window are refused", () => {
  const { doc, cpu } = board8088();
  const a = K.docAddComponent(doc, "SRAM6264", 50, 20);
  const b = K.docAddComponent(doc, "SRAM6264", 66, 20);
  assert(!K.synthRange(doc, a, cpu, 0x01234).ok, "misaligned accepted");
  assert(K.synthRange(doc, a, cpu, 0x08000).ok, "first chip refused");
  const r = K.synthRange(doc, b, cpu, 0x08000);
  assert(!r.ok && r.notes.some(n => n.includes("already decoded")), "occupied window accepted: " + r.notes.join(";"));
});

test("rangecalc: 8086 pair certified once both lanes are in", () => {
  const doc = K.newDoc();
  K.docAddComponent(doc, "XTAL", 2, 2, { mhz: 14.31818 });
  K.docAddComponent(doc, "8284A", 2, 6);
  const cpu = K.docAddComponent(doc, "8086", 16, 2);
  K.autoconnect(doc, cpu, null);
  const romL = K.docAddComponent(doc, "EPROM2764", 50, 2);
  const romH = K.docAddComponent(doc, "EPROM2764", 66, 2);
  K.autoconnect(doc, romL, cpu);
  K.autoconnect(doc, romH, cpu);
  const ramL = K.docAddComponent(doc, "SRAM6264", 50, 20);
  const ramH = K.docAddComponent(doc, "SRAM6264", 66, 20);
  const r1 = K.synthRange(doc, ramL, cpu, 0x10000);
  assert(r1.ok && r1.notes.some(n => n.includes("other byte lane")), "lone lane: " + r1.notes.join(";"));
  // the bare partner pairs up automatically as the odd/high lane
  const r2 = K.synthRange(doc, ramH, cpu, 0x10000);
  assert(r2.ok, "pair not ok: " + r2.notes.join(";"));
  assert(r2.notes.some(n => n.includes("paired as the odd/high byte lane")), r2.notes.join(";"));
  assert(r2.notes.some(n => n.includes("10000h-13FFFh") && n.includes("no mirrors")), r2.notes.join(";"));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
