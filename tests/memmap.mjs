// Memory-map analyzer: probe the minimal-8088 board's real decode through the netlist.
import { loadK, eq } from "./load.mjs";

const K = loadK();
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + (e.stack || e.message)); }
}

test("min-8088: analyzer finds RAM low / ROM high with aliasing", () => {
  const { doc, names } = K.presetById("min-8088").build();
  const map = K.analyzeMemoryMap(doc);
  eq(map.cpus.length, 1, "one CPU analyzed");
  const m = map.cpus[0];
  eq(m.conflicts.length, 0, "no decode conflicts");

  const primaries = m.segments.filter(s => !s.alias);
  const ramSeg = primaries.find(s => s.parts[0].compId === names.ram.id);
  const romSeg = primaries.find(s => s.parts[0].compId === names.rom.id);
  if (!ramSeg || !romSeg) throw new Error("missing primary segments: " + JSON.stringify(primaries));
  eq(ramSeg.start, 0x00000, "RAM primary at 00000");
  eq(ramSeg.end, 0x01FFF, "RAM primary is 8K");
  eq(romSeg.start, 0x80000, "ROM primary at 80000 (A19=1 partial decode)");

  const aliases = m.segments.filter(s => s.alias);
  const aliasParts = aliases.reduce((n, s) => n + s.parts.length, 0);
  if (aliases.length < 2 || aliasParts < 100)
    throw new Error(`expected heavy aliasing from partial decode (segs=${aliases.length}, parts=${aliasParts})`);
  const resetSeg = m.segments.find(s => s.resetVector);
  if (!resetSeg) throw new Error("no segment covers the reset vector");
  eq(resetSeg.parts[0].compId, names.rom.id, "reset vector resolves to ROM");
});

test("resolve: FFFF0 lands at ROM local 1FF0", () => {
  const { doc, names } = K.presetById("min-8088").build();
  const map = K.analyzeMemoryMap(doc);
  const r = K.memMapResolve(map.cpus[0], 0xFFFF0);
  eq(r.compId, names.rom.id, "chip");
  eq(r.local, 0x1FF0, "local offset");
  const r2 = K.memMapResolve(map.cpus[0], 0x00020);
  eq(r2.compId, names.ram.id, "vector table chip");
  eq(r2.local, 0x20, "vector table local");
});

test("irq-lab board analyzes identically", () => {
  const { doc, names } = K.presetById("irq-lab").build();
  const map = K.analyzeMemoryMap(doc);
  const m = map.cpus[0];
  eq(m.conflicts.length, 0, "no conflicts");
  const r = K.memMapResolve(m, 0xFE000);
  eq(r.compId, names.rom.id, "code start in ROM");
  eq(r.local, 0x0000, "code at local 0");
});

test("unified round trip: write via map, read via chip", () => {
  const preset = K.presetById("min-8088");
  const { doc, names } = preset.build();
  const asm = K.assemble(preset.defaultProgram);
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const map = K.analyzeMemoryMap(doc);
  const sim = new K.Sim(doc);
  const r = K.memMapResolve(map.cpus[0], 0x00345);
  const ram = sim.chipFor(names.ram.id);
  ram.state.mem[r.local] = 0x77;
  eq(ram.state.mem[0x345], 0x77, "identity mapping in low RAM");
});

test("max-mode board: analyzer poses the 8288 and proves the map", () => {
  const { doc, names } = K.presetById("max-8088").build();
  const map = K.analyzeMemoryMap(doc);
  const m = map.cpus[0];
  eq(m.conflicts.length, 0, "no conflicts");
  const r = K.memMapResolve(m, 0xFFFF0);
  eq(r.compId, names.rom.id, "reset vector chip");
  eq(r.local, 0x1FF0, "reset vector local");
  const r2 = K.memMapResolve(m, 0x00040);
  eq(r2.compId, names.ram.id, "low RAM chip");
});

test("8086 word machine: lane-aware analysis resolves even/odd correctly", () => {
  const { doc, names } = K.presetById("word-8086").build();
  const map = K.analyzeMemoryMap(doc);
  const m = map.cpus[0];
  eq(m.lanes, 2, "two byte lanes");
  eq(m.conflicts.length, 0, "no conflicts");
  const even = K.memMapResolve(m, 0xFFFF0);
  eq(even.compId, names.romL.id, "even byte -> low-lane ROM");
  eq(even.local, 0x1FF8, "romL local (word address)");
  const odd = K.memMapResolve(m, 0xFFFF1);
  eq(odd.compId, names.romH.id, "odd byte -> high-lane ROM");
  eq(odd.local, 0x1FF8, "romH local");
  const r0 = K.memMapResolve(m, 0x00100);
  eq(r0.compId, names.ramL.id, "RAM even lane");
  eq(r0.local, 0x80, "RAM local");
  const r1 = K.memMapResolve(m, 0x00103);
  eq(r1.compId, names.ramH.id, "RAM odd lane");
  eq(r1.local, 0x81, "RAM odd local");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
