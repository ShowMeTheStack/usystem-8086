// The big one: boot GLaBIOS from the EPROM, then FreeDOS from the floppy,
// on the fully wired PC/XT board. Not part of the default battery (long run).
//   node tests/boot-dos.mjs [maxMinutes] [--trace]
import { loadK } from "./load.mjs";

const K = loadK();
const maxMin = parseFloat(process.argv[2]) || 20;
const trace = process.argv.includes("--trace");

const preset = K.presetById("pc-xt");
const { doc, names } = preset.build();

const drc = K.runDrc(doc);
if (drc.strict.length) {
  console.log("STRICT DRC:", drc.strict.map(f => f.msg));
  process.exit(1);
}
for (const { comp, image } of preset.programImages()) K.programMemory(doc, names[comp].id, image);

const map = K.analyzeMemoryMap(doc);
const m = map.cpus[0];
console.log("memory map:", m.segments.filter(s => !s.alias).map(s =>
  `${s.start.toString(16)}-${s.end.toString(16)}`).join(", "),
  "conflicts:", m.conflicts.length);

const sim = new K.Sim(doc);
sim.setMemMap(map);
sim.fastMode = true;
sim.setCapture(false);
K.fdcInsert(sim, names.fdc.id, K.assetBytes("freedos144"));

const hgc = sim.chipFor(names.hgc.id);
const dma = sim.chipFor(names.dma.id);
const fdc = sim.chipFor(names.fdc.id);
const cpu = sim.chipFor(names.cpu.id);

function screenText() {
  const rows = [];
  for (let r = 0; r < 25; r++) {
    let line = "";
    for (let c = 0; c < 80; c++) {
      const ch = hgc.state.mem[(r * 80 + c) * 2];
      line += ch >= 0x20 && ch < 0x7F ? String.fromCharCode(ch) : " ";
    }
    line = line.trimEnd();
    if (line) rows.push(line);
  }
  return rows;
}

const t0 = Date.now();
let lastPost = -1, lastScreenSig = "", lastReads = 0;
const CHUNK = 400000;
for (let iter = 0; ; iter++) {
  sim.run(CHUNK);
  if (sim.halted && sim.halted.reason) {
    console.log("SIM HALTED:", JSON.stringify(sim.halted));
    break;
  }
  const core = cpu.runtime.core;
  const post = dma.state.page[0];
  const rows = screenText();
  const sig = rows.join("|");
  const mins = (Date.now() - t0) / 60000;
  if (post !== lastPost || sig !== lastScreenSig || fdc.state.stats.reads !== lastReads || trace) {
    console.log(`[${mins.toFixed(1)}m] cyc=${(core.cycleCount / 1e6).toFixed(1)}M post=${post.toString(16).padStart(2, "0")} ` +
      `cs:ip=${core.s[1].toString(16)}:${core.ip.toString(16)} reads=${fdc.state.stats.reads} halted=${core.halted}`);
    for (const r of rows.slice(0, 8)) console.log("   │" + r);
    lastPost = post; lastScreenSig = sig; lastReads = fdc.state.stats.reads;
  }
  const all = sig.toLowerCase();
  if (all.includes("a:\\") || all.includes("welcome to freedos") || all.includes("freecom") ||
      all.includes("commandline") || all.includes("select") || all.includes("install")) {
    console.log("\n=== FreeDOS BOOTED TO USERSPACE ===");
    for (const r of rows) console.log("   │" + r);
    const spkr = sim.chips.find(c => c.def.type === "SPKR");
    const beeped = spkr && spkr.state.log.some(e => e.f > 500 && e.f < 1500);
    console.log(spkr ? `POST beep: ${beeped ? "heard (" + spkr.state.log.map(e => e.f).join(",") + " Hz)" : "NOT heard"}` : "no speaker");
    process.exit(beeped ? 0 : 1);
  }
  if (mins > maxMin) {
    console.log("TIMEOUT after", mins.toFixed(1), "minutes");
    for (const r of rows) console.log("   │" + r);
    process.exit(2);
  }
}
process.exit(3);
