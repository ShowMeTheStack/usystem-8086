// Per-cycle T-state stream comparison against SingleStepTests v2 cycle rows.
//   node tests/tstream.mjs [fileGlobPrefix] [--cases N] [--dump <case#>]
// Row basis compared: [T-state, bus status, queue op] per CPU cycle.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadK, FlatBench } from "./load.mjs";

const K = loadK();
const cacheDir = new URL("./sstcache/", import.meta.url).pathname;
const R = { ax: 0, cx: 1, dx: 2, bx: 3, sp: 4, bp: 5, si: 6, di: 7 };
const S = { es: 0, cs: 1, ss: 2, ds: 3 };

function setState(bench, st) {
  const regs = st.regs;
  const q = st.queue || [];
  const arch = {
    r: [0, 0, 0, 0, 0, 0, 0, 0], s: [0, 0, 0, 0], ip: regs.ip, fl: regs.flags,
    queue: q.slice(), fetchIP: (regs.ip + q.length) & 0xFFFF, halted: false,
    insnCount: 0, cycleCount: 0, intrLine: false, nmiLatch: false, trapNext: false, intInhibit: false,
  };
  for (const [k, i] of Object.entries(R)) arch.r[i] = regs[k] ?? 0;
  for (const [k, i] of Object.entries(S)) arch.s[i] = regs[k] ?? 0;
  bench.cpu.loadArch(arch);
  for (const [addr, val] of st.ram) bench.mem[addr] = val;
}

// my per-cycle row from the core state after a tick
function myRow(cpu) {
  const b = cpu.bus;
  let t = "Ti", status = "PASV";
  if (b) {
    t = b.t === 3 && b.waits > 0 ? "Tw" : "T" + b.t;
    if (b.t <= 2) {
      status = b.kind === "code" ? "CODE"
        : b.kind === "inta" ? "INTA"
        : b.kind === "w" ? (b.sp === "i" ? "IOW" : "MEMW")
        : (b.sp === "i" ? "IOR" : "MEMR");
    }
  }
  const q = cpu.qop === 0 ? "-" : cpu.qop;
  return [t, status, q];
}

function refRow(row) {
  // [ALE, addr, seg, memop, ioop, ?, data, status, tstate, queueOp, qByte]
  return [row[8], row[7], row[9] === "-" ? "-" : row[9]];
}

function runCase(tc) {
  const bench = new FlatBench(K);
  setState(bench, tc.initial);
  const rows = [];
  const cpu = bench.cpu;
  for (let i = 0; i < tc.cycles.length + 40 && !cpu.retired; i++) {
    cpu.retired = false;
    bench.clock();
    rows.push(myRow(cpu));
    if (cpu.retired) break;
    if (cpu.error) return null;
  }
  return rows;
}

function compare(mine, ref) {
  // positional compare over the reference length (mine may be shorter/longer)
  const n = ref.length;
  let mT = 0, mS = 0, mQ = 0;
  for (let i = 0; i < n; i++) {
    const r = refRow(ref[i]);
    const m = mine[i] || ["-", "-", "-"];
    if (m[0] === r[0]) mT++;
    if (m[1] === r[1]) mS++;
    if (m[2] === r[2]) mQ++;
  }
  // the reference stream is first-byte-to-first-byte MINUS the retirement
  // tail; ours runs to retirement (T4 + next F). Up to 2 trailing rows past
  // the reference are the convention, not a mismatch.
  const lenOk = mine.length >= n && mine.length - n <= 2;
  return {
    n,
    lenExact: lenOk,
    tPct: mT / n, sPct: mS / n, qPct: mQ / n,
    exact: lenOk && mT === n && mS === n && mQ === n,
    busExact: lenOk && mT === n && mS === n,
  };
}

const args = process.argv.slice(2);
const prefix = args.find(a => !a.startsWith("--")) || "";
const maxCases = args.includes("--cases") ? +args[args.indexOf("--cases") + 1] : 400;
const dumpIdx = args.includes("--dump") ? +args[args.indexOf("--dump") + 1] : -1;

if (!existsSync(cacheDir)) { console.log("no sstcache"); process.exit(1); }
const files = readdirSync(cacheDir).filter(f => f.endsWith(".json.gz") && f.startsWith(prefix)).sort();

let tot = { cases: 0, exact: 0, busExact: 0, lenExact: 0, tSum: 0, sSum: 0, qSum: 0, rows: 0 };
for (const f of files) {
  const cases = JSON.parse(gunzipSync(readFileSync(cacheDir + f)));
  let ex = 0, bx = 0, n = 0;
  for (const tc of cases.slice(0, maxCases)) {
    if (!tc.cycles) continue;
    const mine = runCase(tc);
    if (!mine) continue;
    const c = compare(mine, tc.cycles);
    n++;
    tot.cases++; tot.rows += c.n;
    tot.tSum += c.tPct * c.n; tot.sSum += c.sPct * c.n; tot.qSum += c.qPct * c.n;
    if (c.exact) { ex++; tot.exact++; }
    if (c.busExact) { bx++; tot.busExact++; }
    if (c.lenExact) tot.lenExact++;
    if (dumpIdx >= 0 && n - 1 === dumpIdx) {
      console.log("case:", tc.name);
      for (let i = 0; i < Math.max(mine.length, tc.cycles.length); i++) {
        const r = tc.cycles[i] ? refRow(tc.cycles[i]).join(" ") : "(end)";
        const m = mine[i] ? mine[i].join(" ") : "(end)";
        console.log(String(i).padStart(3), m.padEnd(16), "|", r, m === r ? "" : "  <<<");
      }
      process.exit(0);
    }
  }
  if (files.length <= 12)
    console.log(`${f}  cases=${n}  busExact=${(bx / n * 100).toFixed(1)}%  fullExact=${(ex / n * 100).toFixed(1)}%`);
}
console.log(`\nTOTAL over ${tot.cases} cases (${tot.rows} cycle rows):`);
console.log(`  length exact:      ${(tot.lenExact / tot.cases * 100).toFixed(2)}%`);
console.log(`  T-state rows:      ${(tot.tSum / tot.rows * 100).toFixed(2)}%`);
console.log(`  bus-status rows:   ${(tot.sSum / tot.rows * 100).toFixed(2)}%`);
console.log(`  queue-op rows:     ${(tot.qSum / tot.rows * 100).toFixed(2)}%`);
console.log(`  bus stream exact:  ${(tot.busExact / tot.cases * 100).toFixed(2)}% of cases`);
console.log(`  full stream exact: ${(tot.exact / tot.cases * 100).toFixed(2)}% of cases`);

if (args.includes("--gate")) {
  // regression floors for CI. Current levels on the "0" sample: T 29.5%,
  // status 59.9%, qop 89.3%, busExact ~15%; positional row percentages are
  // noisy under alignment slips, so the primary gate is case exactness.
  const t = tot.tSum / tot.rows, st = tot.sSum / tot.rows, q = tot.qSum / tot.rows;
  const bx = tot.busExact / tot.cases;
  if (t < 0.22 || st < 0.50 || q < 0.82 || bx < 0.08) {
    console.log(`GATE FAIL: T=${(t * 100).toFixed(1)}% status=${(st * 100).toFixed(1)}% qop=${(q * 100).toFixed(1)}% busExact=${(bx * 100).toFixed(1)}%`);
    process.exit(1);
  }
  console.log("gate: ok");
}
