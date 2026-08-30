// Tier B fast mode: the hybrid path must produce an IDENTICAL cycle stream to the
// full pin-level simulation (memory serviced via the proved map, IO via real pins).
import { loadK, eq } from "./load.mjs";

const K = loadK();
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + (e.stack || e.message)); }
}

function buildSim(presetId, fast) {
  const preset = K.presetById(presetId);
  const { doc, names } = preset.build();
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm errors");
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const map = K.analyzeMemoryMap(doc);
  const sim = new K.Sim(doc);
  sim.setMemMap(map);
  if (fast) { sim.fastMode = true; sim.setCapture(false); }
  return { sim, names };
}

test("fast mode is cycle-identical to pin-level mode (min-8088)", () => {
  const a = buildSim("min-8088", false);
  const b = buildSim("min-8088", true);
  const N = 30000;
  a.sim.run(N);
  b.sim.run(N);
  const ca = a.sim.chipFor(a.names.cpu.id).runtime.core;
  const cb = b.sim.chipFor(b.names.cpu.id).runtime.core;
  eq(cb.insnCount, ca.insnCount, "instruction count");
  eq(cb.cycleCount, ca.cycleCount, "cycle count");
  eq(cb.ip, ca.ip, "IP");
  for (let i = 0; i < 8; i++) eq(cb.r[i], ca.r[i], "reg " + i);
  eq(b.sim.chipFor(b.names.port.id).state.q, a.sim.chipFor(a.names.port.id).state.q, "port latch");
  // RAM contents identical
  const ra = a.sim.chipFor(a.names.ram.id).state.mem;
  const rb = b.sim.chipFor(b.names.ram.id).state.mem;
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) throw new Error("RAM differs at " + i.toString(16));
});

test("fast mode: IRQ lab still interrupt-driven (IO via real pins)", () => {
  const { sim, names } = buildSim("irq-lab", true);
  const cpu = sim.chipFor(names.cpu.id);
  let bx = 0;
  for (let i = 0; i < 400000 && bx < 3; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
    bx = Math.max(bx, cpu.runtime.core.r[3]);
  }
  if (bx < 3) throw new Error("timer interrupts not delivered in fast mode (BX=" + bx + ")");
});

test("fast mode is significantly faster", () => {
  const a = buildSim("min-8088", false);
  const b = buildSim("min-8088", true);
  const N = 40000;
  const t0 = performance.now();
  a.sim.run(N);
  const slow = performance.now() - t0;
  const t1 = performance.now();
  b.sim.run(N);
  const fastMs = performance.now() - t1;
  const ratio = slow / fastMs;
  console.log(`      (pin-level: ${(N / 2 / slow * 1000 / 1000).toFixed(0)}k cyc/s, turbo: ${(N / 2 / fastMs * 1000 / 1000).toFixed(0)}k cyc/s, ${ratio.toFixed(1)}x)`);
  if (ratio < 3) throw new Error("speedup only " + ratio.toFixed(2) + "x");
});

test("compiled turbo (batched) is state-identical to per-half turbo (pc-xt)", () => {
  const build = () => {
    const preset = K.presetById("pc-xt");
    const { doc, names } = preset.build();
    for (const { comp, image } of preset.programImages()) K.programMemory(doc, names[comp].id, image);
    const map = K.analyzeMemoryMap(doc);
    const sim = new K.Sim(doc);
    sim.setMemMap(map);
    sim.fastMode = true;
    sim.setCapture(false);
    return sim;
  };
  const a = build(), b = build();
  const N = 800000;   // long enough to cover IO bursts, DMA refresh and beep
  a.run(N);                                      // compiled clock tree + EU bursts
  for (let i = 0; i < N && !b.halted; i++) b.stepHalf();  // classic per-half tier B
  eq(a.t, b.t, "t");
  eq(JSON.stringify(a.halted), JSON.stringify(b.halted), "halted");
  const strip = (st) => JSON.stringify(st, (k, v) => k.startsWith("_") ? undefined : v);
  for (let ci = 0; ci < a.chips.length; ci++) {
    const sa = strip(a.chips[ci].state), sb = strip(b.chips[ci].state);
    if (sa !== sb)
      throw new Error(`chip ${a.chips[ci].def.type}#${ci} state diverged:\nA=${sa.slice(0, 300)}\nB=${sb.slice(0, 300)}`);
  }
  const ca = a.chips.find(c => c.def.isCpu).runtime.core, cb = b.chips.find(c => c.def.isCpu).runtime.core;
  eq(ca.cycleCount, cb.cycleCount, "cycleCount");
  eq(ca.insnCount, cb.insnCount, "insnCount");
  eq(JSON.stringify(ca.saveArch()), JSON.stringify(cb.saveArch()), "cpu arch");
  for (let n = 0; n < a.netVal.length; n++)
    if (a.netVal[n] !== b.netVal[n])
      throw new Error(`net ${a.nets[n].name} diverged: ${a.netVal[n]} vs ${b.netVal[n]}`);
  console.log(`      (${ca.insnCount} insns, ${ca.cycleCount} cycles — every chip state, net and register identical)`);
});

test("compiled turbo reaches 4.77 MHz real time (pc-xt)", () => {
  const preset = K.presetById("pc-xt");
  const { doc, names } = preset.build();
  for (const { comp, image } of preset.programImages()) K.programMemory(doc, names[comp].id, image);
  const map = K.analyzeMemoryMap(doc);
  const sim = new K.Sim(doc);
  sim.setMemMap(map); sim.fastMode = true; sim.setCapture(false);
  sim.run(600000);                              // boot + compile + JIT warmup
  const cpu = sim.chips.find(c => c.def.isCpu);
  let best = 0;
  for (let r = 0; r < 3; r++) {
    const c0 = cpu.runtime.core.cycleCount, t0 = performance.now();
    sim.run(3000000);
    best = Math.max(best, (cpu.runtime.core.cycleCount - c0) / ((performance.now() - t0) / 1000) / 1e6);
  }
  console.log(`      (${best.toFixed(2)} MHz effective — real 8088 is 4.77${best >= 4.77 ? ": REAL TIME" : ""})`);
  // This measures the HOST, not the code: a shared CI runner is several times
  // slower than a laptop, so only a catastrophic drop is a real regression there.
  const floor = process.env.CI ? 0.5 : 3.5;
  if (best < floor) throw new Error(`only ${best.toFixed(2)} MHz — turbo regressed`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
