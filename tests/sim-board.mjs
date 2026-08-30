// Full Tier-A integration: pin-level netlist simulation of the preset boards.
import { loadK, eq } from "./load.mjs";

const K = loadK();
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + (e.stack || e.message)); }
}

test("logic lab: ripple counter counts", () => {
  const { doc } = K.presetById("logic-counter").build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict violations");
  const sim = new K.Sim(doc);
  const ctr = sim.chips.find(c => c.def.type === "74LS393");
  // 2 Hz clock -> tickHz 4; sim.hz = 4. 8 full periods = 16 half-steps -> count 8.
  for (let i = 0; i < 16; i++) sim.stepHalf();
  if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
  eq(ctr.state.c1, 8, "counter value");
});

test("DRC catches VCC-GND short", () => {
  const doc = K.newDoc();
  const v = K.docAddComponent(doc, "VCC", 0, 0);
  const g = K.docAddComponent(doc, "GND", 0, 4);
  K.docConnect(doc, K.pinKey(v, "V"), K.pinKey(g, "G"));
  const drc = K.runDrc(doc);
  if (!drc.strict.some(f => f.explain === "vcc-gnd-short")) throw new Error("short not detected");
});

test("DRC catches output contention", () => {
  const doc = K.newDoc();
  const a = K.docAddComponent(doc, "74LS04", 0, 0);
  const b = K.docAddComponent(doc, "74LS04", 10, 0);
  K.docConnect(doc, K.pinKey(a, "1Y"), K.pinKey(b, "1Y"));
  const drc = K.runDrc(doc);
  if (!drc.strict.some(f => f.explain === "output-contention")) throw new Error("contention not detected");
});

test("minimal 8088 kit: DRC clean (no strict)", () => {
  const { doc } = K.presetById("min-8088").build();
  const drc = K.runDrc(doc);
  if (drc.strict.length) throw new Error("strict: " + drc.strict.map(f => f.msg).join(" | "));
});

test("minimal 8088 kit boots and blinks the port", () => {
  const preset = K.presetById("min-8088");
  const { doc, names } = preset.build();
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));

  const sim = new K.Sim(doc);
  const port = sim.chipFor(names.port.id);
  const cpuChip = sim.chipFor(names.cpu.id);
  const seen = new Set();
  let steps = 0;
  // Run until we've seen both LED patterns (or give up).
  while (seen.size < 2 && steps < 60000) {
    sim.stepHalf();
    steps++;
    if (sim.halted) throw new Error("halted at t=" + sim.t + ": " + JSON.stringify(sim.halted));
    if (port.state.q === 0x55 || port.state.q === 0xAA) seen.add(port.state.q);
  }
  if (seen.size < 2) {
    const core = cpuChip.runtime.core;
    throw new Error(`no blink after ${steps} half-steps; port=${port.state.q.toString(16)} ` +
      `CS:IP=${core.s[1].toString(16)}:${core.ip.toString(16)} insns=${core.insnCount} err=${core.error}`);
  }
  const core = cpuChip.runtime.core;
  if (core.insnCount < 5) throw new Error("suspiciously few instructions retired");
  console.log(`      (booted: ${core.insnCount} insns, ${core.cycleCount} cycles, ${steps} half-steps)`);
});

test("step-instruction and snapshot/restore round trip", () => {
  const preset = K.presetById("min-8088");
  const { doc, names } = preset.build();
  const asm = K.assemble(preset.defaultProgram);
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  for (let i = 0; i < 5; i++) sim.stepInstruction(20000);
  // compare BOUNDARY state — that's what snapshots save (the live core may
  // already be decoding into the next instruction)
  const bnd = sim.chipFor(names.cpu.id).runtime.core.boundary;
  const ipBefore = bnd.ip, axBefore = bnd.r[0];
  const snap = sim.serialize();
  for (let i = 0; i < 3; i++) sim.stepInstruction(20000);
  sim.restore(snap);
  const core2 = sim.chipFor(names.cpu.id).runtime.core;
  eq(core2.ip, ipBefore, "IP restored");
  eq(core2.r[0], axBefore, "AX restored");
  // and the restored sim still runs
  sim.stepInstruction(20000);
});

test("interrupt lab: PIT -> PIC -> INTA -> handler -> EOI", () => {
  const preset = K.presetById("irq-lab");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict violations");
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const port = sim.chipFor(names.port.id);
  const cpu = sim.chipFor(names.cpu.id);
  let ticksSeen = 0;
  for (let i = 0; i < 400000 && ticksSeen < 3; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
    ticksSeen = Math.max(ticksSeen, cpu.runtime.core.r[3]); // BX counts timer ISRs
  }
  if (ticksSeen < 3) throw new Error("timer interrupts not delivered (BX=" + ticksSeen + ")");
  // button -> IR1 -> vector 9 -> all LEDs on
  sim.applyInput(names.btnIr.id, { pressed: true });
  let flashed = false;
  for (let i = 0; i < 8000 && !flashed; i++) { sim.stepHalf(); flashed = port.state.q === 0xFF; }
  sim.applyInput(names.btnIr.id, { pressed: false });
  if (!flashed) throw new Error("button interrupt not delivered");
  console.log(`      (BX=${cpu.runtime.core.r[3]} timer ticks, ${cpu.runtime.core.insnCount} insns, mostly HLT)`);
});

test("max-mode 8088 + 8288 boots and blinks through command strobes", () => {
  const preset = K.presetById("max-8088");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict violations: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const port = sim.chipFor(names.port.id);
  const seen = new Set();
  for (let i = 0; i < 80000 && seen.size < 2; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted at t=" + sim.t + ": " + JSON.stringify(sim.halted));
    if (port.state.q === 0x55 || port.state.q === 0xAA) seen.add(port.state.q);
  }
  if (seen.size < 2) {
    const core = sim.chipFor(names.cpu.id).runtime.core;
    throw new Error(`no blink; port=${port.state.q.toString(16)} CS:IP=${core.s[1].toString(16)}:${core.ip.toString(16)} insns=${core.insnCount}`);
  }
  console.log(`      (max mode: ${sim.chipFor(names.cpu.id).runtime.core.insnCount} insns via 8288 strobes)`);
});

test("8086 word machine: byte lanes, odd word write, blink", () => {
  const preset = K.presetById("word-8086");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  for (const { comp, image } of preset.programImages(asm.bytes, asm.org))
    K.programMemory(doc, names[comp].id, image);
  const sim = new K.Sim(doc);
  const port = sim.chipFor(names.port.id);
  const seen = new Set();
  for (let i = 0; i < 100000 && seen.size < 2; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted at t=" + sim.t + ": " + JSON.stringify(sim.halted));
    if (port.state.q === 0x55 || port.state.q === 0xAA) seen.add(port.state.q);
  }
  if (seen.size < 2) {
    const core = sim.chipFor(names.cpu.id).runtime.core;
    throw new Error(`no blink; port=${port.state.q.toString(16)} CS:IP=${core.s[1].toString(16)}:${core.ip.toString(16)} insns=${core.insnCount}`);
  }
  // word [0x100]=0x1234 aligned: even bank gets 34 at local 0x80, odd bank 12
  const lo = sim.chipFor(names.ramL.id).state.mem, hi = sim.chipFor(names.ramH.id).state.mem;
  eq(lo[0x80], 0x34, "aligned lo byte in even bank");
  eq(hi[0x80], 0x12, "aligned hi byte in odd bank");
  // word [0x103]=0x5678 odd: 78 at addr 103 (odd bank local 0x81), 56 at 104 (even bank local 0x82)
  eq(hi[0x81], 0x78, "odd-word lo byte in odd bank");
  eq(lo[0x82], 0x56, "odd-word hi byte in even bank");
});

test("Hercules kit: text lands in VRAM, spinner spins, syncs tick", () => {
  const preset = K.presetById("hgc-8088");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const hgc = sim.chipFor(names.hgc.id);
  let spin0 = -1, spun = false;
  for (let i = 0; i < 200000; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
    const s = hgc.state.mem[320];
    if (hgc.state.mem[0] === 0x48 && spin0 === -1 && s) spin0 = s;
    if (spin0 !== -1 && s !== spin0) { spun = true; break; }
  }
  const txt = String.fromCharCode(...[...Array(12)].map((_, i) => hgc.state.mem[i * 2]));
  eq(txt, "HELLO FROM T", "VRAM text");
  eq(hgc.state.mem[1], 0x07, "attribute");
  if (!spun) throw new Error("spinner did not advance");
  if (hgc.state.scanline === 0 && hgc.state.frames === 0) throw new Error("sync counters not ticking");
  // analyzer sees the VRAM window
  const map = K.analyzeMemoryMap(doc);
  const r = K.memMapResolve(map.cpus[0], 0xB0000);
  eq(r.compId, names.hgc.id, "VRAM mapped at B0000");
  eq(r.local, 0, "VRAM local 0");
  console.log(`      (VRAM says: "${txt}…", scanline=${hgc.state.scanline})`);
});

test("PC typewriter: serial scancode -> IRQ1 -> handler -> screen", () => {
  const preset = K.presetById("kbd-8088");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const hgc = sim.chipFor(names.hgc.id);
  const shift = sim.chipFor(names.kbshift.id);
  // boot until the prompt is on screen
  let booted = false;
  for (let i = 0; i < 200000 && !booted; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
    booted = hgc.state.mem[0] === 0x52; // 'R' of READY
  }
  if (!booted) throw new Error("prompt never appeared");
  // press 'h' (make 0x23), release (0xA3)
  sim.applyInput(names.kbd.id, { scan: 0x23 });
  for (let i = 0; i < 60000 && hgc.state.mem[320] !== 0x68; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted mid-key: " + JSON.stringify(sim.halted));
  }
  sim.run(4000); // let the ISR finish (attribute write is one insn later)
  eq(hgc.state.mem[320], 0x68, "'h' on screen (serial->shift->IRQ1->port 60h->VRAM)");
  eq(hgc.state.mem[321], 0x0F, "bright attribute");
  sim.applyInput(names.kbd.id, { scan: 0xA3 });
  sim.run(40000);
  // 'i' then Enter then 'x' -> 'x' starts on the next row
  sim.applyInput(names.kbd.id, { scan: 0x17 });
  sim.run(60000);
  eq(hgc.state.mem[322], 0x69, "'i' followed");
  sim.applyInput(names.kbd.id, { scan: 0x97 });
  sim.run(40000);
  sim.applyInput(names.kbd.id, { scan: 0x1C }); // Enter
  sim.run(60000);
  sim.applyInput(names.kbd.id, { scan: 0x9C });
  sim.run(40000);
  sim.applyInput(names.kbd.id, { scan: 0x2D }); // 'x'
  sim.run(60000);
  eq(hgc.state.mem[480], 0x78, "'x' on the next row after Enter");
  console.log(`      (typed "hi⏎x" through the serial keyboard; ${shift.state.data.toString(16)} last in shift reg)`);
});

test("XT-IDE: IDENTIFY model string, 8-bit mode, sector round trip", () => {
  const preset = K.presetById("pc-xt");
  const { doc, names } = preset.build();
  for (const { comp, image } of preset.programImages()) K.programMemory(doc, names[comp].id, image);
  const sim = new K.Sim(doc);
  const ide = sim.chipFor(names.ide.id);
  const st = ide.state;
  eq(ide.runtime.hdd.length, K.XTIDE_CAP, "blank 10.4MB disk auto-attached");
  // SET FEATURES: 8-bit PIO
  st.dh = 0xA0; st.feat = 1;
  ide.def._exec(st, ide, 0xEF);
  eq(st.eightBit, true, "8-bit mode enabled");
  // IDENTIFY carries our model string
  ide.def._exec(st, ide, 0xEC);
  eq((st.status & 0x08) !== 0, true, "IDENTIFY raises DRQ");
  let name = "";
  for (let i = 54; i < 94; i += 2) name += String.fromCharCode(ide.runtime.buf[i + 1], ide.runtime.buf[i]);
  if (!name.includes("uSYSTEM")) throw new Error("model string: " + name);
  // WRITE SECTORS then READ SECTORS round trip at CHS 0/0/1
  st.sc = 1; st.sn = 1; st.cl = 0; st.ch = 0; st.dh = 0xA0;
  ide.def._exec(st, ide, 0x30);
  eq(st.bufDir, 2, "write phase open");
  for (let i = 0; i < 512; i++) ide.runtime.buf[i] = (i * 3) & 0xFF;
  ide.runtime.hdd.set(ide.runtime.buf.subarray(0, 512), 0);   // commit (port path does this at drain)
  st.bufDir = 0;
  ide.def._exec(st, ide, 0x20);
  eq(st.bufDir, 1, "read phase open");
  for (let i = 0; i < 512; i += 31) eq(ide.runtime.buf[i], (i * 3) & 0xFF, "byte " + i);
  // option ROM header present in the mapped XUB window
  const xub = sim.chipFor(names.xubrom.id);
  eq(xub.state.mem[0], 0x55, "XUB 55");
  eq(xub.state.mem[1], 0xAA, "XUB AA");
});

test("serial console: banner out, typed bytes echoed back", () => {
  const preset = K.presetById("uart-lab");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const com = sim.chipFor(names.com.id);
  for (let i = 0; i < 200000 && !com.state.tx.includes("echoes>"); i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
  }
  if (!com.state.tx.includes("uSYSTEM 8086 serial console")) throw new Error("no banner: " + JSON.stringify(com.state.tx.slice(0, 60)));
  // type "hi" + Enter down the line
  for (const ch of "hi") sim.applyInput(names.com.id, { rx: ch.charCodeAt(0) });
  sim.applyInput(names.com.id, { rx: 0x0D });
  const before = com.state.tx.length;
  sim.run(120000);
  const echoed = com.state.tx.slice(before);
  if (!echoed.includes("hi\r\n")) throw new Error("echo missing: " + JSON.stringify(echoed));
  console.log(`      (terminal says: ${JSON.stringify(com.state.tx.slice(0, 40))}…)`);
});

test("dual 8088: two CPUs share one RAM through 8289 arbitration", () => {
  const preset = K.presetById("dual-8088");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const ram = sim.chipFor(names.ram.id);
  const arbA = sim.chipFor(names.aarb.id);
  const arbB = sim.chipFor(names.barb.id);
  const w = (o) => ram.state.mem[o] | (ram.state.mem[o + 1] << 8);
  for (let i = 0; i < 800000 && !(w(0x20) > 3 && w(0x22) > 3); i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted at t=" + sim.t + ": " + JSON.stringify(sim.halted));
  }
  if (!(w(0x20) > 3)) throw new Error("CPU#1 counter stuck at " + w(0x20) + " (cpu2=" + w(0x22) + ")");
  if (!(w(0x22) > 3)) throw new Error("CPU#2 counter stuck at " + w(0x22) + " (cpu1=" + w(0x20) + ")");
  eq(ram.state.mem[0x10], 1, "identity claim byte");
  if (arbA.state.grants < 20 || arbB.state.grants < 20)
    throw new Error(`arbitration lopsided: A=${arbA.state.grants} B=${arbB.state.grants}`);
  console.log(`      (counters ${w(0x20)}/${w(0x22)}, grants A=${arbA.state.grants} B=${arbB.state.grants} — no coherence, pure arbitration)`);
});


test("traffic-8255: autoconnect-built board cycles the light", () => {
  const preset = K.presetById("traffic-8255");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const ppi = sim.chipFor(names.ppi.id);
  const seen = new Set();
  for (let i = 0; i < 400000 && seen.size < 4; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
    if (ppi.state.ctrl === 0x80 && ppi.state.a) seen.add(ppi.state.a);
  }
  for (const want of [1, 3, 4, 2]) {
    if (!seen.has(want)) throw new Error("light states seen: " + [...seen].join(",") + " (missing " + want + ")");
  }
});

test("dip-echo: switches land on the LEDs, live flips follow", () => {
  const preset = K.presetById("dip-echo");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const port = sim.chipFor(names.port.id);
  for (let i = 0; i < 40000 && port.state.q !== 0x55; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
  }
  eq(port.state.q, 0x55, "initial switch value not echoed");
  sim.applyInput(names.sw.id, { bits: 0x3C });
  for (let i = 0; i < 40000 && port.state.q !== 0x3C; i++) sim.stepHalf();
  eq(port.state.q, 0x3C, "flipped switches not echoed");
});

test("seg7-count: the digit walks the segment table", () => {
  const preset = K.presetById("seg7-count");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const port = sim.chipFor(names.port.id);
  const digits = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F];
  const seen = [];
  for (let i = 0; i < 500000 && seen.length < 5; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
    const q = port.state.q;
    if (digits.includes(q) && seen[seen.length - 1] !== q) seen.push(q);
  }
  if (seen.length < 5) throw new Error("digits seen: " + seen.map(d => d.toString(16)).join(","));
  for (let i = 1; i < seen.length; i++) {
    const a = digits.indexOf(seen[i - 1]), b = digits.indexOf(seen[i]);
    if ((a + 1) % 10 !== b) throw new Error("not counting in order: " + seen.map(d => d.toString(16)).join(","));
  }
});

test("wait-state: '74 chain inserts a real Tw into every bus cycle", () => {
  const preset = K.presetById("wait-state");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const cpuChip = sim.chips.find(c => c.def.isCpu);
  let waited = 0, cycles = 0, last = null;
  for (let i = 0; i < 40000; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
    const b = cpuChip.runtime.core.bus;
    if (b && b !== last && b.t === 4) { cycles++; if (b.waits > 0) waited++; last = b; }
  }
  if (cycles < 50) throw new Error("too few bus cycles: " + cycles);
  if (waited < cycles * 0.9) throw new Error(`only ${waited}/${cycles} cycles saw a Tw`);
  if (cpuChip.runtime.core.insnCount < 50) throw new Error("CPU not executing");
});

test("mixed masters: 8086 + 8088 share one word-wide RAM", () => {
  const preset = K.presetById("mixed-cpu");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  for (const { comp, image } of preset.programImages(asm.bytes, asm.org))
    K.programMemory(doc, names[comp].id, image);
  const sim = new K.Sim(doc);
  const ramL = sim.chipFor(names.ramL.id), ramH = sim.chipFor(names.ramH.id);
  const arbA = sim.chipFor(names.aarb.id), arbB = sim.chipFor(names.barb.id);
  // system word at even address a: low byte in ramL[a>>1], high in ramH[a>>1]
  const w = (a) => ramL.state.mem[a >> 1] | (ramH.state.mem[a >> 1] << 8);
  for (let i = 0; i < 1000000 && !(w(0x20) > 3 && w(0x22) > 3); i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted at t=" + sim.t + ": " + JSON.stringify(sim.halted));
  }
  if (!(w(0x20) > 3)) throw new Error("first CPU counter stuck at " + w(0x20) + " (other=" + w(0x22) + ")");
  if (!(w(0x22) > 3)) throw new Error("second CPU counter stuck at " + w(0x22) + " (other=" + w(0x20) + ")");
  eq(ramL.state.mem[0x10 >> 1], 1, "identity claim byte");
  if (arbA.state.grants < 10 || arbB.state.grants < 10)
    throw new Error(`arbitration lopsided: A=${arbA.state.grants} B=${arbB.state.grants}`);
  console.log(`      (counters ${w(0x20)}/${w(0x22)}, grants 8086=${arbA.state.grants} 8088=${arbB.state.grants})`);
});

test("pc-speaker: PIT mode 3 plays four distinct notes", () => {
  const preset = K.presetById("pc-speaker");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const spk = sim.chipFor(names.spk.id);
  for (let i = 0; i < 900000 && spk.state.log.length < 8; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
  }
  const expected = [5423, 4063, 3616, 2711].map(d => 2386363 / d);
  const heard = spk.state.log.map(e => e.f);
  for (const f of expected) {
    if (!heard.some(h => Math.abs(h - f) < f * 0.12))
      throw new Error(`note ${Math.round(f)} Hz not heard; log: ` + heard.map(Math.round).join(","));
  }
  console.log(`      (tones heard: ${heard.slice(-8).map(Math.round).join(", ")} Hz)`);
});

test("lpt-printer: Centronics handshake prints the message", () => {
  const preset = K.presetById("lpt-printer");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "strict: " + drc.strict.map(f => f.msg).join(" | "));
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const prn = sim.chipFor(names.prn.id);
  const cpuChip = sim.chips.find(c => c.def.isCpu);
  for (let i = 0; i < 900000 && cpuChip.runtime.core.euBlocked !== "halt"; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
  }
  eq(prn.state.paper, "HELLO 8088!\n", "paper: " + JSON.stringify(prn.state.paper));
  console.log(`      (the paper says: ${JSON.stringify(prn.state.paper.trim())})`);
});

test("pc-xt speaker path: OUT 61h/43h/42h beeps the cone like the BIOS", () => {
  const preset = K.presetById("pc-xt");
  const { doc, names } = preset.build();
  // replace GLaBIOS with a minimal BEEP: PPI config, ch2 mode 3 div 1331, PB|=3
  const asm = K.assemble([
    "        org 0xE000",
    "start:  cli",
    "        mov al, 0x99",
    "        out 0x63, al       ; PPI: A in, B out, C in (XT config)",
    "        mov al, 0xB6",
    "        out 0x43, al       ; ch2, lo+hi, mode 3",
    "        mov al, 0x33",
    "        out 0x42, al",
    "        mov al, 0x05",
    "        out 0x42, al       ; divisor 1331",
    "        in  al, 0x61",
    "        or  al, 3",
    "        out 0x61, al       ; gate timer 2 + speaker enable",
    "spin:   jmp spin",
  ].join("\n"));
  const img = new Uint8Array(8192).fill(0xFF);      // 2764, mapped at FE000-FFFFF
  img.set(asm.bytes, asm.org & 0x1FFF);
  img.set([0xEA, 0x00, 0xE0, 0x00, 0xF0], 0x1FF0);
  K.programMemory(doc, names.rom.id, img);
  const sim = new K.Sim(doc);
  const spkr = sim.chipFor(names.spkr.id);
  for (let i = 0; i < 600000 && spkr.state.toggles < 60; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
  }
  if (spkr.state.toggles < 60) throw new Error("cone never moved: " + spkr.state.toggles);
  const f = spkr.state.freq, want = 1193182 / 1331;  // ~896 Hz, the classic beep
  if (Math.abs(f - want) > want * 0.15) throw new Error(`beep at ${f} Hz, wanted ~${Math.round(want)}`);
  console.log(`      (beep measured at ${f} Hz through the real 61h/43h/42h path)`);
});

test("preset library: 21 boards (incl. blank), all build, DRC-strict clean, explainers exist", () => {
  eq(K.presets.length, 21, "preset count");
  for (const p of K.presets) {
    const { doc } = p.build();
    const drc = K.runDrc(doc);
    if (drc.strict.length)
      throw new Error(p.id + " strict: " + drc.strict.map(f => f.msg).join(" | "));
    for (const f of [...drc.strict, ...drc.weak])
      if (!K.explains[f.explain]) throw new Error(p.id + ": warning without explainer: " + f.msg + " (" + f.explain + ")");
    if (p.defaultProgram) {
      const asm = K.assemble(p.defaultProgram);
      if (asm.errors.length) throw new Error(p.id + " asm: " + asm.errors.map(e => e.msg).join(";"));
    }
  }
  const labs = K.presets.filter(p => p.lab && p.lab.length >= 4);
  if (labs.length < 8) throw new Error("only " + labs.length + " presets have guided labs");
});

test("pic-cascade preset: both buttons land their vectors on the LEDs", () => {
  const preset = K.presetById("pic-cascade");
  const { doc, names } = preset.build();
  const asm = K.assemble(preset.defaultProgram);
  if (asm.errors.length) throw new Error("asm: " + asm.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const port = sim.chipFor(names.port.id);
  const cpu = sim.chips.find(c => c.def.isCpu);
  for (let i = 0; i < 200000 && cpu.runtime.core.euBlocked !== "halt"; i++) sim.stepHalf();
  const press = (btn) => {
    sim.applyInput(btn.id, { pressed: true });
    for (let i = 0; i < 2000; i++) sim.stepHalf();
    sim.applyInput(btn.id, { pressed: false });     // rising edge -> IR
    for (let i = 0; i < 30000; i++) sim.stepHalf();
  };
  press(names.btnM);
  eq(port.state.q, 0x0C, "master IR4 vector on LEDs");
  press(names.btnS);
  eq(port.state.q, 0x73, "slave IR3 vector on LEDs (through the CAS bus)");
});

test("pit-modes preset: mode 3 blinks, mode 1 one-shot follows the button", () => {
  const preset = K.presetById("pit-modes");
  const { doc, names } = preset.build();
  const asm = K.assemble(preset.defaultProgram);
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const ctr = sim.chipFor(names.pit.id).state.ctr;
  const ram = sim.chipFor(names.ram.id);
  let t1lows = 0, prev1 = 1, seen1High = false, seen0 = new Set();
  for (let i = 0; i < 200000; i++) {
    sim.stepHalf();
    seen0.add(ctr[0].out);
    if (ctr[1].out === 1) seen1High = true;             // ignore pre-init OUT=0
    if (seen1High && ctr[1].out === 0 && prev1 === 1) t1lows++;
    prev1 = ctr[1].out;
  }
  if (seen0.size < 2) throw new Error("mode 3 never toggled");
  eq(t1lows, 0, "one-shot must wait for its trigger");
  // 8254 read-back stashed ch0 status at [0x100]: OUT+RW=3+mode3 -> x6/B6
  const status = ram.state.mem[0x100];
  if ((status & 0x3F) !== 0x36) throw new Error("read-back status=" + status.toString(16));
  sim.applyInput(names.btn.id, { pressed: true });
  for (let i = 0; i < 400; i++) sim.stepHalf();
  sim.applyInput(names.btn.id, { pressed: false });
  let sawLow = false;
  for (let i = 0; i < 200000 && !sawLow; i++) { sim.stepHalf(); if (ctr[1].out === 0) sawLow = true; }
  if (!sawLow) throw new Error("one-shot never fired after the button");
});

test("fixit-lab: runs, LEDs stay dark, exactly the two designed warnings", () => {
  const preset = K.presetById("fixit-lab");
  const { doc, names } = preset.build();
  const drc = K.runDrc(doc);
  eq(drc.strict.length, 0, "must be strict-clean: " + drc.strict.map(f => f.msg).join(" | "));
  const kinds = drc.weak.map(f => f.explain).sort();
  if (!kinds.includes("floating-input") || !kinds.includes("btn-no-pullup"))
    throw new Error("designed warnings missing: " + kinds.join(","));
  const asm = K.assemble(preset.defaultProgram);
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const cpu = sim.chips.find(c => c.def.isCpu);
  const led = sim.chipFor(names.led.id);
  const port = sim.chipFor(names.port.id);
  const litEver = () => {
    const n = sim.byPin.get(K.pinKey(names.led, "A0"));
    return n && sim.netVal[n.id] === K.SIG.H;
  };
  let lit = false;
  for (let i = 0; i < 60000; i++) { sim.stepHalf(); if (litEver()) lit = true; }
  if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
  if (cpu.runtime.core.insnCount < 100) throw new Error("CPU not running");
  if (port.state.q !== 0x55 && port.state.q !== 0xAA) throw new Error("latch never captured the blink");
  if (lit) throw new Error("LEDs lit — the bug is supposed to keep them dark");
  // now FIX bug #1 the way the lab tells the student to: wire ~OE to GND
  const gnd = doc.components.find(c => c.type === "GND");
  K.docConnect(doc, K.pinKey(names.port, "~OE"), K.pinKey(gnd, "G"));
  const sim2 = new K.Sim(doc);
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  let lit2 = false;
  const lit2f = () => {
    const n = sim2.byPin.get(K.pinKey(names.led, "A0"));
    return n && sim2.netVal[n.id] === K.SIG.H;
  };
  for (let i = 0; i < 60000 && !lit2; i++) { sim2.stepHalf(); if (lit2f()) lit2 = true; }
  if (!lit2) throw new Error("fix did not light the LEDs");
});

test("max mode: QS0/QS1 report queue first/subsequent/flush on real pins", () => {
  const preset = K.presetById("max-8088");
  const { doc, names } = preset.build();
  const asm = K.assemble(preset.defaultProgram);
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const sim = new K.Sim(doc);
  const cpu = sim.chipFor(names.cpu.id);
  const pinNet = (name) => cpu.pinNet[cpu.def.pinIndex[name]];
  const qs0 = pinNet("ALE"), qs1 = pinNet("~INTA");   // dual-role in max mode
  const seen = new Set();
  for (let i = 0; i < 40000; i++) {
    sim.stepHalf();
    if (sim.halted) throw new Error("halted: " + JSON.stringify(sim.halted));
    const v = (sim.netVal[qs1] === K.SIG.H ? 2 : 0) | (sim.netVal[qs0] === K.SIG.H ? 1 : 0);
    seen.add(v);
  }
  for (const [code, name] of [[1, "first byte (01)"], [3, "subsequent (11)"], [2, "flush (10)"]])
    if (!seen.has(code)) throw new Error("queue-status " + name + " never seen; saw " + [...seen].join(","));
  console.log(`      (QS codes observed on the pins: ${[...seen].sort().join(",")} — probe them in the waveform analyzer)`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
