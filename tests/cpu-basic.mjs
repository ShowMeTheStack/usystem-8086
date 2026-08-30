// Basic CPU core sanity: reset vector, MOV/ALU/stack/jumps/flags/mul/div/string ops.
import { loadK, FlatBench, eq } from "./load.mjs";

const K = loadK();
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + e.message); }
}

// Fresh bench with reset far-jump to 0100:0000 and code loaded at linear 0x01000.
function bench(code, opts) {
  const b = new FlatBench(K, opts);
  b.load(0xFFFF0, [0xEA, 0x00, 0x00, 0x00, 0x01]); // JMP 0100:0000
  b.load(0x01000, code);
  b.runInsns(1); // the far jump
  return b;
}

test("reset state", () => {
  const b = new FlatBench(K);
  eq(b.cpu.s[1], 0xFFFF, "CS");
  eq(b.cpu.ip, 0, "IP");
});

test("mov/add/stack", () => {
  const b = bench([
    0xBC, 0x00, 0x80,       // MOV SP, 8000h
    0xB8, 0x34, 0x12,       // MOV AX, 1234h
    0x89, 0xC3,             // MOV BX, AX
    0x01, 0xD8,             // ADD AX, BX
    0x50,                   // PUSH AX
    0x59,                   // POP CX
    0xF4,                   // HLT
  ]);
  b.runInsns(7);
  eq(b.cpu.r[0], 0x2468, "AX");
  eq(b.cpu.r[1], 0x2468, "CX");
  eq(b.cpu.r[3], 0x1234, "BX");
  eq(b.cpu.r[4], 0x8000, "SP");
});

test("flags: sub/cmp/jcc", () => {
  const b = bench([
    0xB8, 0x05, 0x00,       // MOV AX, 5
    0x3D, 0x05, 0x00,       // CMP AX, 5
    0x74, 0x02,             // JZ +2
    0xB3, 0xFF,             // MOV BL, FFh   (skipped)
    0xB7, 0x77,             // MOV BH, 77h
    0xF4,
  ]);
  b.runInsns(5);
  eq(b.cpu.g8(7), 0x77, "BH");
  eq(b.cpu.g8(3), 0x00, "BL untouched");
  eq((b.cpu.fl >> 6) & 1, 1, "ZF");
});

test("memory write via moffs", () => {
  const b = bench([
    0xB8, 0xCD, 0xAB,       // MOV AX, ABCDh
    0xA3, 0x00, 0x20,       // MOV [2000h], AX   (DS=0)
    0xF4,
  ]);
  b.runInsns(3);
  eq(b.mem[0x2000], 0xCD, "lo byte");
  eq(b.mem[0x2001], 0xAB, "hi byte");
});

test("modrm ea: [bx+si+disp]", () => {
  const b = bench([
    0xBB, 0x00, 0x10,       // MOV BX, 1000h
    0xBE, 0x10, 0x00,       // MOV SI, 10h
    0xC6, 0x40, 0x05, 0x42, // MOV byte [BX+SI+5], 42h
    0x8A, 0x60, 0x05,       // MOV AH, [BX+SI+5]
    0xF4,
  ]);
  b.runInsns(5);
  eq(b.mem[0x1015], 0x42, "mem");
  eq(b.cpu.g8(4), 0x42, "AH");
});

test("mul/div", () => {
  const b = bench([
    0xB8, 0x00, 0x00,       // MOV AX, 0
    0xB0, 0x07,             // MOV AL, 7
    0xB3, 0x06,             // MOV BL, 6
    0xF6, 0xE3,             // MUL BL   -> AX = 42
    0xB3, 0x05,             // MOV BL, 5
    0xF6, 0xF3,             // DIV BL   -> AL=8 AH=2
    0xF4,
  ]);
  b.runInsns(7);
  eq(b.cpu.g8(0), 8, "AL quotient");
  eq(b.cpu.g8(4), 2, "AH remainder");
});

test("call/ret", () => {
  const b = bench([
    0xBC, 0x00, 0x80,       // MOV SP, 8000h
    0xE8, 0x04, 0x00,       // CALL +4 (to 000A)
    0xB3, 0x11,             // MOV BL, 11h   (after ret)
    0xF4,                   // HLT
    0x00,                   // pad -> sub at 000A? recompute below
  ]);
  // CALL at ip=3, len 3 -> next ip=6, target 6+4=10 (0x0A)
  b.load(0x0100A, [
    0xB7, 0x99,             // MOV BH, 99h
    0xC3,                   // RET
  ]);
  b.runInsns(6);
  eq(b.cpu.g8(7), 0x99, "BH set in sub");
  eq(b.cpu.g8(3), 0x11, "BL set after ret");
});

test("rep movsb", () => {
  const b = bench([
    0xBC, 0x00, 0x80,       // MOV SP, 8000h
    0xBE, 0x00, 0x30,       // MOV SI, 3000h
    0xBF, 0x00, 0x40,       // MOV DI, 4000h
    0xB9, 0x05, 0x00,       // MOV CX, 5
    0xFC,                   // CLD
    0xF3, 0xA4,             // REP MOVSB
    0xF4,
  ]);
  b.load(0x3000, [1, 2, 3, 4, 5]);
  b.runInsns(7);
  eq(b.mem[0x4000], 1, "byte0");
  eq(b.mem[0x4004], 5, "byte4");
  eq(b.cpu.r[1], 0, "CX");
  eq(b.cpu.r[6], 0x3005, "SI");
});

test("in/out", () => {
  const b = bench([
    0xB0, 0x5A,             // MOV AL, 5Ah
    0xE6, 0x42,             // OUT 42h, AL
    0xE4, 0x42,             // IN AL, 42h
    0x04, 0x01,             // ADD AL, 1
    0xE6, 0x43,             // OUT 43h, AL
    0xF4,
  ]);
  b.runInsns(6);
  eq(b.io.get(0x42), 0x5A, "port 42");
  eq(b.io.get(0x43), 0x5B, "port 43");
});

test("shifts and rotates", () => {
  const b = bench([
    0xB0, 0x81,             // MOV AL, 81h
    0xD0, 0xC0,             // ROL AL, 1  -> 03h, CF=1
    0xB3, 0x03,             // MOV BL, 3
    0xB1, 0x02,             // MOV CL, 2
    0xD2, 0xE3,             // SHL BL, CL -> 0Ch
    0xF4,
  ]);
  b.runInsns(6);
  eq(b.cpu.g8(0), 0x03, "ROL result");
  eq(b.cpu.g8(3), 0x0C, "SHL result");
});

test("int/iret via vector table", () => {
  const b = bench([
    0xBC, 0x00, 0x80,       // MOV SP, 8000h
    0xCD, 0x21,             // INT 21h
    0xB3, 0x55,             // MOV BL, 55h (after iret)
    0xF4,
  ]);
  // vector 21h -> 0200:0000 (linear 0x2000)
  b.load(0x21 * 4, [0x00, 0x00, 0x00, 0x02]);
  b.load(0x02000, [
    0xB7, 0xAA,             // MOV BH, AAh
    0xCF,                   // IRET
  ]);
  b.runInsns(6);
  eq(b.cpu.g8(7), 0xAA, "handler ran");
  eq(b.cpu.g8(3), 0x55, "resumed after iret");
  eq(b.cpu.r[4], 0x8000, "SP balanced");
});

test("prefetch queue fills and drains", () => {
  const b = bench([0x90, 0x90, 0x90, 0xF4]); // NOPs
  b.runInsns(3);
  if (b.cpu.queue.length > b.cpu.qsize) throw new Error("queue overflow");
  eq(b.cpu.qsize, 4, "8088 queue size");
  const b2 = new FlatBench(K, { is8086: true });
  eq(b2.cpu.qsize, 6, "8086 queue size");
});

test("cycle counting is plausible", () => {
  const b = bench([0xB8, 0x34, 0x12, 0xF4]); // MOV AX,imm; HLT
  const c0 = b.cpu.cycleCount;
  b.runInsns(1);
  const dc = b.cpu.cycleCount - c0;
  if (dc < 4 || dc > 40) throw new Error("MOV AX,imm took " + dc + " cycles");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
