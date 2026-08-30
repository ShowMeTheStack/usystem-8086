// Runs the SingleStepTests/8088 suite (https://github.com/SingleStepTests/8088)
// against the CPU core: functional check of final registers/flags/RAM, plus a
// cycle-count delta report (exact per-cycle bus validation is the phase-2 goal).
//
//   node tests/singlestep.mjs --download          # fetch test files (v2) to tests/sstcache/
//   node tests/singlestep.mjs 00 01 D4            # run specific opcodes
//   node tests/singlestep.mjs                     # run everything cached
//
// Test data is MIT-licensed by its authors; it is cached locally, never shipped.
import { loadK, FlatBench } from "./load.mjs";
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const cacheDir = fileURLToPath(new URL("./sstcache", import.meta.url));
const BASE = "https://raw.githubusercontent.com/SingleStepTests/8088/main/v2";
const K = loadK();

const OPCODES = [];
for (let i = 0; i < 256; i++) {
  if ([0x26, 0x2E, 0x36, 0x3E, 0xF0, 0xF1, 0xF2, 0xF3, 0x9B].includes(i)) continue; // prefixes/wait have no files
  OPCODES.push(i.toString(16).toUpperCase().padStart(2, "0"));
}
// grouped opcodes have sub-files like F6.0..F6.7
const GROUPS = { "80": 8, "81": 8, "82": 8, "83": 8, "D0": 8, "D1": 8, "D2": 8, "D3": 8, F6: 8, F7: 8, FE: 2, FF: 8 };

async function download() {
  mkdirSync(cacheDir, { recursive: true });
  const files = [];
  for (const op of OPCODES) {
    if (GROUPS[op]) for (let s = 0; s < GROUPS[op]; s++) files.push(`${op}.${s}`);
    else files.push(op);
  }
  let done = 0;
  for (const f of files) {
    const dest = join(cacheDir, f + ".json.gz");
    if (existsSync(dest)) { done++; continue; }
    const res = await fetch(`${BASE}/${f}.json.gz`);
    if (!res.ok) { console.log(`skip ${f}: HTTP ${res.status}`); continue; }
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    done++;
    if (done % 25 === 0) console.log(`${done}/${files.length} fetched`);
  }
  console.log(`cache ready: ${done} files in tests/sstcache/`);
}

const R = { ax: 0, cx: 1, dx: 2, bx: 3, sp: 4, bp: 5, si: 6, di: 7 };
const S = { es: 0, cs: 1, ss: 2, ds: 3 };

function setState(bench, st) {
  const cpu = bench.cpu;
  const regs = st.regs;
  const q = st.queue || [];
  const arch = {
    r: [0, 0, 0, 0, 0, 0, 0, 0], s: [0, 0, 0, 0], ip: regs.ip, fl: regs.flags,
    queue: q.slice(), fetchIP: (regs.ip + q.length) & 0xFFFF, halted: false,
    insnCount: 0, cycleCount: 0, intrLine: false, nmiLatch: false,
  };
  for (const [k, i] of Object.entries(R)) arch.r[i] = regs[k] ?? 0;
  for (const [k, i] of Object.entries(S)) arch.s[i] = regs[k] ?? 0;
  cpu.loadArch(arch);
  cpu.trapNext = false; // tests never begin mid-trap
  for (const [addr, val] of st.ram) bench.mem[addr % 0x100000] = val;
}

function checkState(bench, fin, flagMask) {
  const a = bench.cpu.boundary, errs = []; // state exactly at the instruction boundary
  const regs = fin.regs || {};
  for (const [k, i] of Object.entries(R))
    if (k in regs && a.r[i] !== regs[k]) errs.push(`${k}=${a.r[i].toString(16)} want ${regs[k].toString(16)}`);
  for (const [k, i] of Object.entries(S))
    if (k in regs && a.s[i] !== regs[k]) errs.push(`${k}=${a.s[i].toString(16)} want ${regs[k].toString(16)}`);
  if ("ip" in regs && a.ip !== regs.ip) errs.push(`ip=${a.ip.toString(16)} want ${regs.ip.toString(16)}`);
  let flagErr = null;
  if ("flags" in regs) {
    const mask = 0x0FD5 & flagMask;
    if ((a.fl & mask) !== (regs.flags & mask))
      flagErr = `flags=${(a.fl & mask).toString(16)} want ${(regs.flags & mask).toString(16)} (mask ${mask.toString(16)})`;
  }
  for (const [addr, val] of fin.ram || [])
    if (bench.mem[addr % 0x100000] !== val)
      errs.push(`[${addr.toString(16)}]=${bench.mem[addr % 0x100000].toString(16)} want ${val.toString(16)}`);
  return { errs, flagErr };
}

function runFile(file, metadata) {
  let cases;
  try { cases = JSON.parse(gunzipSync(readFileSync(join(cacheDir, file)))); }
  catch { return { file, n: 0, pass: 0, fail: 0, flagsOnly: 0, cycAvg: 0, firstFail: "unreadable (404 body? delete it)" }; }
  const opHex = file.split(".")[0];
  const meta = metadata && metadata[opHex.toLowerCase()] || metadata && metadata[opHex] || null;
  const sub = file.includes(".") ? file.split(".")[1] : null;
  let flagMask = 0xFFFF;
  let m = meta;
  if (m && sub !== null && m.reg && m.reg[sub]) m = m.reg[sub];
  if (m && m["flags-mask"] != null) flagMask = m["flags-mask"];

  let pass = 0, fail = 0, flagsOnly = 0, cycSum = 0, cycSigned = 0, cycN = 0, firstFail = null;
  for (const tc of cases) {
    const bench = new FlatBench(K);
    setState(bench, tc.initial);
    try {
      bench.runInsns(1, 4000);
    } catch (e) {
      fail++;
      if (!firstFail) firstFail = `${tc.name}: ${e.message}`;
      continue;
    }
    const { errs, flagErr } = checkState(bench, tc.final, flagMask);
    if (errs.length) {
      fail++;
      if (!firstFail) firstFail = `${tc.name}: ${errs[0]}`;
    } else if (flagErr) {
      flagsOnly++;
      if (!firstFail) firstFail = `${tc.name}: ${flagErr}`;
    } else pass++;
    if (tc.cycles) {
      // -1: the retirement tick is the first cycle of the next instruction
      // (steady-state spacing is exact; the boundary reading over-attributes 1).
      const d = (bench.cpu.boundary.cycleCount - 1) - tc.cycles.length;
      cycSum += Math.abs(d);
      cycSigned += d;
      cycN++;
    }
  }
  return { file, n: cases.length, pass, fail, flagsOnly, cycAvg: cycN ? (cycSum / cycN) : 0, cycMean: cycN ? (cycSigned / cycN) : 0, firstFail };
}

const args = process.argv.slice(2);
if (args.includes("--download")) {
  await download();
} else {
  if (!existsSync(cacheDir)) {
    console.log("no cache — run: node tests/singlestep.mjs --download");
    process.exit(1);
  }
  let metadata = null;
  const metaFile = join(cacheDir, "metadata.json");
  if (!existsSync(metaFile)) {
    try {
      const res = await fetch(`${BASE}/metadata.json`);
      if (res.ok) writeFileSync(metaFile, Buffer.from(await res.arrayBuffer()));
    } catch { /* offline is fine */ }
  }
  if (existsSync(metaFile)) {
    const mj = JSON.parse(readFileSync(metaFile, "utf8"));
    metadata = mj.opcodes || mj;
  }
  const wanted = args.length
    ? readdirSync(cacheDir).filter(f => f.endsWith(".json.gz") && args.some(a => f.toUpperCase().startsWith(a.toUpperCase())))
    : readdirSync(cacheDir).filter(f => f.endsWith(".json.gz"));
  let totPass = 0, totFail = 0, totFlags = 0, totN = 0, totCycAbs = 0, totCycMean = 0, totCycFiles = 0;
  const rows = [];
  for (const f of wanted.sort()) {
    const r = runFile(f, metadata);
    totPass += r.pass; totFail += r.fail; totFlags += r.flagsOnly; totN += r.n;
    if (r.n) { totCycAbs += r.cycAvg; totCycMean += r.cycMean; totCycFiles++; }
    rows.push(r);
    const pct = ((r.pass / r.n) * 100).toFixed(1);
    console.log(`${r.file.padEnd(14)} ${String(r.pass).padStart(5)}/${String(r.n).padEnd(5)} ${pct.padStart(5)}%  flags-only:${String(r.flagsOnly).padStart(4)}  cycΔ:${r.cycAvg.toFixed(1).padStart(6)} (${(r.cycMean >= 0 ? "+" : "") + r.cycMean.toFixed(1)})  ${r.fail && r.firstFail ? "e.g. " + r.firstFail.slice(0, 80) : ""}`);
  }
  console.log(`\nTOTAL: ${totPass}/${totN} exact (${((totPass / Math.max(1, totN)) * 100).toFixed(2)}%), ${totFlags} flags-only misses, ${totFail} hard fails`);
  if (totCycFiles) console.log(`CYCLES: mean |Δ| ${(totCycAbs / totCycFiles).toFixed(2)}/insn, mean signed ${(totCycMean / totCycFiles).toFixed(2)}/insn over ${totCycFiles} files`);
}
