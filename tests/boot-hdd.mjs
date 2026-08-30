// THE acceptance test for the synthesized FreeDOS hard disk: boot the PC/XT
// with NO floppy — GLaBIOS must fall through to the XTIDE HDD, the MBR stub
// must chain the FreeDOS boot sector, and the kernel must reach C:\>.
//   node tests/boot-hdd.mjs [maxMinutes]
import { loadK } from "./load.mjs";

const K = loadK();
const maxMin = parseFloat(process.argv[2]) || 15;

const preset = K.presetById("pc-xt");
const { doc, names } = preset.build();
for (const { comp, image } of preset.programImages()) K.programMemory(doc, names[comp].id, image);
const map = K.analyzeMemoryMap(doc);
const sim = new K.Sim(doc);
sim.setMemMap(map);
sim.fastMode = true;
sim.setCapture(false);
// no fdcInsert — the floppy stays out. Attach the synthesized system disk:
const hdd = K.buildFreeDosHdd(K.assetBytes("freedos144"));
if (!hdd) { console.log("SYNTHESIS FAILED"); process.exit(1); }
sim.chipFor(names.ide.id).runtime.hdd = hdd;
console.log(`synthesized HDD: ${(hdd.length / 1048576).toFixed(1)} MB, booting with no floppy...`);

const hgc = sim.chipFor(names.hgc.id);
const cpu = sim.chipFor(names.cpu.id);
function screenText() {
  const rows = [];
  for (let r = 0; r < 25; r++) {
    let line = "";
    for (let c = 0; c < 80; c++) {
      const ch = hgc.state.mem[(r * 80 + c) * 2];
      line += ch >= 0x20 && ch < 0x7F ? String.fromCharCode(ch) : " ";
    }
    rows.push(line.trimEnd());
  }
  return rows;
}

const t0 = Date.now();
let lastSig = "";
for (;;) {
  sim.run(600000);
  if (sim.halted) { console.log("SIM HALTED:", JSON.stringify(sim.halted)); process.exit(1); }
  const rows = screenText();
  const sig = rows.join("|");
  const mins = (Date.now() - t0) / 60000;
  if (sig !== lastSig) {
    console.log(`[${mins.toFixed(1)}m] cs:ip=${cpu.runtime.core.s[1].toString(16)}:${cpu.runtime.core.ip.toString(16)}`);
    for (const r of rows.filter(Boolean).slice(-6)) console.log("   │" + r);
    lastSig = sig;
  }
  const all = sig;
  if (/C:\\>/.test(all) || /synthesized on demand/.test(all)) {
    console.log("\n=== BOOTED FROM THE SYNTHESIZED HDD TO C:\\> ===");
    for (const r of rows.filter(Boolean)) console.log("   │" + r);
    process.exit(0);
  }
  if (mins > maxMin) {
    console.log("TIMEOUT");
    for (const r of rows) console.log("   │" + r);
    process.exit(1);
  }
}
