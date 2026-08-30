// The debugger engine, exhaustively: breakpoints (IP/physical/conditional/
// hit-count), memory + IO watchpoints, call-stack tracking through CALL/RET
// and INT/IRET, step-over/step-out plumbing, the trace ring, the watch
// evaluator, fastmode parity, and persistence.
import { loadK, eq } from "./load.mjs";

const K = loadK();
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")); }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };

// The test program: exercises loops, memory r/w, IO, CALL nesting, and a
// software interrupt. Runs on the stock min-8088 board (code at F000:E000).
const PROGRAM = `
        org 0
start:  mov sp, 0x1000
        xor ax, ax
        mov ds, ax
        mov ax, int21 + 0xE000
        mov [0x84], ax
        mov ax, 0xF000
        mov [0x86], ax
        xor ax, ax
        mov cx, 3
lp:     inc ax
        loop lp
        mov bx, 0x5A5A
        mov [0x40], bx
        mov dx, [0x40]
        call sub1
        out 0x42, al
        int 0x21
        mov di, 0x777
theend: hlt
sub1:   mov si, 0x111
        call sub2
        ret
sub2:   mov bp, 0x222
        ret
int21:  mov cx, 0xCAFE
        iret
`;

function buildDbgSim(opts = {}) {
  const preset = K.presetById("min-8088");
  const { doc, names } = preset.build();
  const asm = K.assemble(PROGRAM);
  if (asm.errors.length) throw new Error("asm: " + JSON.stringify(asm.errors));
  K.programMemory(doc, names.rom.id, preset.makeRom(asm.bytes, asm.org));
  const map = K.analyzeMemoryMap(doc);
  const sim = new K.Sim(doc);
  sim.setMemMap(map);
  if (opts.fast) { sim.fastMode = true; sim.setCapture(false); }
  const dbg = K.Debug.create(opts);
  dbg.symbols = asm.symbols;
  K.Debug.attach(sim, dbg);
  const cpu = sim.chipFor(names.cpu.id);
  return { sim, dbg, asm, names, cpu, map,
    ip16: (a) => (0xE000 + a) & 0xFFFF,
    arch: () => cpu.state.arch };
}
const runTo = (sim, n = 400000) => { sim.run(n); return sim.dbgStop; };
const resume = (sim, dbg) => { sim.dbgStop = false; dbg.hit = null; };
// HLT idles the CPU without halting the sim; the EU blocks before retiring,
// so the live core state is the signal, not the boundary snapshot
const cpuHalted = (cpu) => cpu.runtime.core.halted || cpu.runtime.core.euBlocked === "halt";
// listing.line is 1-BASED; find the entry for the source line containing `needle`
const entryFor = (asm, needle) =>
  asm.listing.find(l => l.len > 0 && (PROGRAM.split("\n")[l.line - 1] || "").includes(needle));

test("assembler exposes the line map and symbol table the debugger needs", () => {
  const asm = K.assemble(PROGRAM);
  eq(asm.errors.length, 0, "errors");
  assert(asm.symbols.start === 0 && asm.symbols.sub1 > 0 && asm.symbols.int21 > asm.symbols.sub2, "symbols");
  const entry = entryFor(asm, "lp:     inc ax");
  assert(entry && entry.addr === asm.symbols.lp, "line->addr agrees with the symbol: " + JSON.stringify(entry));
});

test("IP breakpoint: stops exactly at the target, resume does not re-trigger", () => {
  const { sim, dbg, asm, ip16, arch } = buildDbgSim();
  dbg.bpIp.set(ip16(asm.symbols.sub1), {});
  assert(runTo(sim), "hit");
  eq(dbg.hit.kind, "bp", "kind");
  eq(arch().ip, ip16(asm.symbols.sub1), "paused ABOUT to execute sub1");
  resume(sim, dbg);
  runTo(sim, 400000);
  assert(!dbg.hit && cpuHalted(sim.chipFor(sim.chips.find(c => c.def.isCpu).comp.id)), "ran to HLT without re-trigger: " + JSON.stringify(dbg.hit));
});

test("physical-address breakpoint via memory-map mirrors", () => {
  const { sim, dbg, asm, names, map, arch } = buildDbgSim();
  const cpuMap = map.cpus.find(c => c.compId === names.cpu.id);
  const mirrors = K.Debug.physOf(cpuMap, names.rom.id, asm.symbols.sub2 & 0x1FFF);
  assert(mirrors.includes(0xFE000 + asm.symbols.sub2), "execution address among mirrors: " + mirrors.map(m => m.toString(16)).join(","));
  const bp = {};
  for (const m of mirrors) dbg.bpAddr.set(m, bp);
  assert(runTo(sim), "hit");
  eq(arch().ip & 0xFFFF, (0xE000 + asm.symbols.sub2) & 0xFFFF, "paused at sub2");
});

test("conditional breakpoint: 'CX==2' in a countdown loop", () => {
  const { sim, dbg, asm, ip16, arch } = buildDbgSim();
  dbg.bpIp.set(ip16(asm.symbols.lp), { cond: "CX==2" });
  assert(runTo(sim), "hit");
  eq(arch().r[1], 2, "CX at stop");
  eq(arch().ip, ip16(asm.symbols.lp), "at the loop body");
});

test("hit-count breakpoint: third visit only", () => {
  const { sim, dbg, asm, ip16, arch } = buildDbgSim();
  const bp = { hitLimit: 3 };
  dbg.bpIp.set(ip16(asm.symbols.lp), bp);
  assert(runTo(sim), "hit");
  eq(bp.hits, 3, "counted");
  eq(arch().r[1], 1, "CX on the third arrival");
});

test("memory WRITE watchpoint: stops after the storing instruction, with value", () => {
  const { sim, dbg, arch } = buildDbgSim();
  dbg.wps.push({ from: 0x40, to: 0x41, mode: "w" });
  assert(runTo(sim), "hit");
  eq(dbg.hit.kind, "memwatch", "kind");
  eq(dbg.hit.mode, "w", "mode");
  eq(dbg.hit.addr, 0x40, "address");
  eq(dbg.hit.val, 0x5A5A, "written value seen");
  eq(arch().r[3], 0x5A5A, "the store already completed (BX)");
  eq(arch().r[2] === 0x5A5A, false, "but the READ has not run yet (DX)");
});

test("memory READ watchpoint: mode filtering works", () => {
  const { sim, dbg, arch } = buildDbgSim();
  dbg.wps.push({ from: 0x40, to: 0x41, mode: "r" });
  assert(runTo(sim), "hit");
  eq(dbg.hit.mode, "r", "the WRITE did not trip it");
  eq(arch().r[2], 0x5A5A, "the read completed into DX");
});

test("IO watchpoint on the OUT port", () => {
  const { sim, dbg } = buildDbgSim();
  dbg.ioWps.push({ from: 0x42, to: 0x42, mode: "w" });
  assert(runTo(sim), "hit");
  eq(dbg.hit.kind, "iowatch", "kind");
  eq(dbg.hit.addr, 0x42, "port");
});

test("call stack: two nested CALL frames at sub2; empty again at HLT", () => {
  const { sim, dbg, asm, ip16, cpu } = buildDbgSim();
  dbg.bpIp.set(ip16(asm.symbols.sub2), {});
  assert(runTo(sim), "hit");
  const stack = cpu.runtime.dbgStack;
  eq(stack.length, 2, "depth");
  assert(stack.every(f => f.kind === "call"), "kinds");
  eq(stack[1].to.ip, ip16(asm.symbols.sub2), "innermost target");
  resume(sim, dbg);
  runTo(sim);
  assert(cpuHalted(cpu), "reached HLT");
  eq(cpu.runtime.dbgStack.length, 0, "all frames popped (RETs and IRET)");
});

test("software INT pushes an int frame with its vector; IRET pops it", () => {
  const { sim, dbg, asm, ip16, cpu } = buildDbgSim();
  dbg.bpIp.set(ip16(asm.symbols.int21), {});
  assert(runTo(sim), "hit inside the handler");
  const stack = cpu.runtime.dbgStack;
  eq(stack.length, 1, "one frame");
  eq(stack[0].kind, "int", "kind");
  eq(stack[0].vec, 0x21, "vector recorded");
});

test("step-over plumbing: temp breakpoint after a CALL skips the subroutine", () => {
  const { sim, dbg, asm, ip16, arch, names } = buildDbgSim();
  const callEntry = entryFor(asm, "call sub1");
  dbg.bpIp.set(ip16(callEntry.addr), {});
  assert(runTo(sim), "at the CALL");
  resume(sim, dbg);
  dbg.bpIp.set(ip16(callEntry.addr + callEntry.len), { temp: true });
  assert(runTo(sim), "landed after the call");
  eq(arch().ip, ip16(callEntry.addr + callEntry.len), "return address");
  eq(arch().r[6], 0x111, "the subroutine DID run (SI)");
  assert(!dbg.bpIp.has(ip16(callEntry.addr + callEntry.len)), "temp bp consumed");
});

test("step-out plumbing: until-predicate leaves the frame", () => {
  const { sim, dbg, asm, ip16, cpu, arch } = buildDbgSim();
  dbg.bpIp.set(ip16(asm.symbols.sub2), {});
  assert(runTo(sim), "inside sub2");
  const depth0 = cpu.runtime.dbgStack.length;
  resume(sim, dbg);
  dbg.until = (s, chip) => chip.runtime.dbgStack.length < depth0;
  assert(runTo(sim), "stopped");
  eq(dbg.hit.kind, "until", "kind");
  eq(cpu.runtime.dbgStack.length, depth0 - 1, "one frame up");
  eq(arch().r[5], 0x222, "sub2 completed (BP)");
});

test("trace ring: cycle costs, register history, opcode classes, monotonic time", () => {
  const { sim, dbg, cpu } = buildDbgSim();
  runTo(sim);
  assert(cpuHalted(cpu), "ran to HLT");
  const n = dbg.trace.n;
  assert(n > 20, "entries: " + n);
  let lastT = -1, sawCall = false, sawBx = false, sawInt = false;
  for (let i = 0; i < n; i++) {
    const e = K.Debug.traceEntry(dbg, i);
    assert(e.cyc > 0, "cycle cost at " + i);
    assert(e.t >= lastT, "time monotonic");
    lastT = e.t;
    if (e.op === 0xE8) sawCall = true;
    if (e.r[3] === 0x5A5A) sawBx = true;
    if (e.vec === 0x21) sawInt = true;
  }
  assert(sawCall, "CALL recorded");
  assert(sawBx, "register history shows BX load");
  assert(sawInt, "interrupt vector annotated");
});

test("a pending stop halts sim.run mid-batch", () => {
  const { sim, dbg, asm, ip16 } = buildDbgSim();
  dbg.bpIp.set(ip16(asm.symbols.sub1), {});
  sim.run(500000);
  assert(sim.dbgStop && !sim.halted, "stopped by the debugger, not HLT");
  assert(sim.t < 500000, "well before the batch budget: t=" + sim.t);
  const t = sim.t;
  sim.run(1000);
  eq(sim.t, t, "run() is inert while a stop is pending");
});

test("fastmode parity: same breakpoint, same boundary state as pin-level", () => {
  const a = buildDbgSim();
  const b = buildDbgSim({ fast: true });
  for (const x of [a, b]) x.dbg.bpIp.set(x.ip16(x.asm.symbols.sub2), {});
  runTo(a.sim);
  runTo(b.sim);
  assert(a.sim.dbgStop && b.sim.dbgStop, "both hit");
  eq(b.arch().ip, a.arch().ip, "IP");
  for (let i = 0; i < 8; i++) eq(b.arch().r[i], a.arch().r[i], "reg " + i);
  eq(b.cpu.runtime.dbgStack.length, a.cpu.runtime.dbgStack.length, "stack depth");
});

test("watch evaluator: registers, flags, numbers, symbols, derefs, precedence", () => {
  const { sim, dbg, asm, cpu } = buildDbgSim();
  runTo(sim);                                          // to HLT: known final state
  const ctx = K.Debug.ctxFor(sim, cpu, cpu.state.arch);
  const ev = (e) => K.Debug.evalExpr(e, ctx);
  eq(ev("DI"), 0x777, "reg");
  eq(ev("CX"), 0xCAFE, "reg set by the int handler");
  eq(ev("CL"), 0xFE, "low byte");
  eq(ev("CH"), 0xCA, "high byte");
  eq(ev("SI + 1"), 0x112, "arithmetic");
  eq(ev("0x10 + 10h + 16"), 48, "number formats");
  eq(ev("0b101"), 5, "binary");
  eq(ev("sub1"), asm.symbols.sub1, "symbol");
  eq(ev("w[0x40]"), 0x5A5A, "word deref");
  eq(ev("b[0x40]"), 0x5A, "byte deref");
  eq(ev("[0x40]"), 0x5A5A, "bare deref is a word");
  eq(ev("w[0:0x40]"), 0x5A5A, "seg:off deref");
  eq(ev("DI == 0x777"), 1, "equality");
  eq(ev("DI > 0x776 && CX != 0"), 1, "logic");
  eq(ev("(1+2)*3"), 9, "precedence");
  eq(ev("0xF0 & 0x3C"), 0x30, "bitwise and");
  eq(ev("1 << 4 | 2"), 18, "shift/or");
  eq(ev("ZF"), (cpu.state.arch.fl >> 6) & 1, "flag bit");
  let threw = false;
  try { ev("nonsense_name"); } catch { threw = true; }
  assert(threw, "unknown name throws");
});

test("persistence round-trip keeps breakpoints, conditions, watchpoints, watches", () => {
  const dbg = K.Debug.create();
  dbg.bpIp.set(0xE010, { cond: "AX==5", line: 7, hitLimit: 2 });
  dbg.bpAddr.set(0xFE020, { enabled: false });
  dbg.bpIp.set(0xE099, { temp: true });                // temp bps must NOT persist
  dbg.wps.push({ from: 0x40, to: 0x4F, mode: "w" });
  dbg.ioWps.push({ from: 0x42, to: 0x42, mode: "rw" });
  dbg.watches.push("AX", "w[counter]");
  const d2 = K.Debug.deserialize(JSON.parse(JSON.stringify(K.Debug.serialize(dbg))));
  eq(d2.bpIp.get(0xE010).cond, "AX==5", "condition");
  eq(d2.bpIp.get(0xE010).hitLimit, 2, "hit limit");
  eq(d2.bpIp.get(0xE010).line, 7, "line");
  eq(d2.bpAddr.get(0xFE020).enabled, false, "disabled state");
  assert(!d2.bpIp.has(0xE099), "temp bp dropped");
  eq(d2.wps.length, 1, "watchpoints");
  eq(d2.watches.length, 2, "watches");
});

test("rewind support: onSeek truncates the trace and rebuilds the call stack", () => {
  const { sim, dbg, asm, ip16, cpu } = buildDbgSim();
  dbg.bpIp.set(ip16(asm.symbols.sub2), {});
  runTo(sim);
  const depthAtSub2 = cpu.runtime.dbgStack.length;
  const tAtSub2 = sim.t;
  resume(sim, dbg);
  runTo(sim);
  assert(cpuHalted(cpu), "ran on to HLT");
  const nAll = dbg.trace.n;
  const realT = sim.t;
  sim.t = tAtSub2;                                     // pretend we rewound
  K.Debug.onSeek(sim);
  assert(dbg.trace.n < nAll, "future entries dropped");
  eq(cpu.runtime.dbgStack.length, depthAtSub2, "stack rebuilt to the old depth");
  sim.t = realT;
});

test("disassembly helper decodes straight out of mapped memory", () => {
  const { sim, dbg, asm, names } = buildDbgSim();
  runTo(sim);
  const rows = K.Debug.disasmAt(sim, names.cpu.id, 0xFE000 + asm.symbols.sub1, 3);
  eq(rows.length, 3, "rows");
  assert(/mov\s+si/i.test(rows[0].text), "first insn of sub1: " + rows[0].text);
  assert(/call/i.test(rows[1].text), "then the nested call: " + rows[1].text);
  eq(rows[1].addr, 0xFE000 + asm.symbols.sub1 + rows[0].len, "addresses chain by length");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
