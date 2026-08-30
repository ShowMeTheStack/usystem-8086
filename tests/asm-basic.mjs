// Assembler round-trip: assemble source, run it on the CPU core, check results.
import { loadK, FlatBench, eq } from "./load.mjs";

const K = loadK();
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + (e.stack || e.message)); }
}

function asm(src) {
  const r = K.assemble(src);
  if (r.errors.length) throw new Error("asm errors: " + r.errors.map(e => `L${e.line}: ${e.msg}`).join("; "));
  return r;
}

function runProgram(src, insns) {
  const b = new FlatBench(K);
  const r = asm(src);
  b.load(0xFFFF0, [0xEA, 0x00, 0x00, 0x00, 0x01]); // JMP 0100:0000
  b.load(0x01000 + r.org, r.bytes);
  b.runInsns(insns + 1, 2_000_000);
  return b;
}

test("bytes: mov/alu encodings", () => {
  const r = asm(`
    mov ax, 0x1234
    mov bl, 5
    add ax, bx
    cmp al, 0x12
    xor cx, cx
  `);
  const want = [0xB8, 0x34, 0x12, 0xB3, 0x05, 0x03, 0xC3, 0x3C, 0x12, 0x33, 0xC9];
  eq(r.bytes.length, want.length, "length");
  want.forEach((v, i) => eq(r.bytes[i], v, "byte " + i));
});

test("labels and jumps", () => {
  const b = runProgram(`
      mov sp, 0x8000
      mov cx, 3
      xor ax, ax
    top:
      add ax, cx
      loop top
      hlt
  `, 30);
  eq(b.cpu.r[0], 6, "AX = 3+2+1");
});

test("memory operands with labels (data)", () => {
  const b = runProgram(`
      mov sp, 0x8000
      mov ax, cs
      mov ds, ax        ; data lives in the code segment
      mov si, msg
      mov al, [si]
      mov bl, [si+1]
      hlt
    msg: db 'H', 'i'
  `, 12);
  eq(b.cpu.g8(0), 0x48, "AL = 'H'");
  eq(b.cpu.g8(3), 0x69, "BL = 'i'");
});

test("db string, dw, equ, org", () => {
  const r = asm(`
    org 0x10
    port equ 0x42
    db "AB", 0
    dw 0x1234, label
    label:
    mov al, port
  `);
  eq(r.org, 0x10, "org");
  eq(r.bytes[0], 0x41, "A");
  eq(r.bytes[1], 0x42, "B");
  eq(r.bytes[2], 0x00, "nul");
  eq(r.bytes[3], 0x34, "dw lo");
  eq(r.bytes[5], 0x17, "label lo (0x10+7)");
  eq(r.bytes[7], 0xB0, "mov al opcode");
  eq(r.bytes[8], 0x42, "equ value");
});

test("call/ret + stack ops", () => {
  const b = runProgram(`
      mov sp, 0x8000
      mov ax, 7
      call double
      call double
      hlt
    double:
      add ax, ax
      ret
  `, 30);
  eq(b.cpu.r[0], 28, "AX doubled twice");
});

test("byte/word ptr and seg override", () => {
  const b = runProgram(`
      mov sp, 0x8000
      mov ax, 0x0200
      mov es, ax
      mov bx, 4
      mov byte [bx], 0xAA
      mov word es:[bx], 0x55AA
      hlt
  `, 10);
  eq(b.mem[0x0004], 0xAA, "DS byte");
  eq(b.mem[0x2004], 0xAA, "ES lo");
  eq(b.mem[0x2005], 0x55, "ES hi");
});

test("in/out round trip", () => {
  const b = runProgram(`
      mov al, 0x3C
      out 0x60, al
      in al, 0x60
      mov dx, 0x3F8
      out dx, al
      hlt
  `, 10);
  eq(b.io.get(0x60), 0x3C, "port 60h");
  eq(b.io.get(0x3F8), 0x3C, "port 3F8h");
});

test("rep movsb via assembler", () => {
  const b = runProgram(`
      mov sp, 0x8000
      mov ax, cs
      mov ds, ax
      mov ax, 0
      mov es, ax
      cld
      mov si, src
      mov di, 0x4000
      mov cx, count
      rep movsb
      hlt
    src: db "HELLO"
    count equ 5
  `, 25);
  eq(String.fromCharCode(...b.mem.slice(0x4000, 0x4005)), "HELLO", "copied");
});

test("shifts, mul, div", () => {
  const b = runProgram(`
      mov al, 3
      shl al, 1
      mov cl, 2
      shl al, cl    ; 24
      mov bl, 5
      mul bl        ; AX = 120
      mov bl, 7
      div bl        ; AL=17 AH=1
      hlt
  `, 20);
  eq(b.cpu.g8(0), 17, "quotient");
  eq(b.cpu.g8(4), 1, "remainder");
});

test("forward reference to data with 16-bit disp", () => {
  const b = runProgram(`
      mov sp, 0x8000
      mov ax, cs
      mov ds, ax
      mov bx, 0
      mov ax, [bx+table]
      hlt
    table: dw 0xBEEF
  `, 12);
  eq(b.cpu.r[0], 0xBEEF, "AX");
});

test("int through vector", () => {
  const b = new FlatBench(K);
  const r = asm(`
      mov sp, 0x8000
      mov ax, 0
      mov es, ax
      mov word es:[0x21*4], handler
      mov word es:[0x21*4+2], 0x0100
      int 0x21
      hlt
    handler:
      mov bh, 0xEE
      iret
  `);
  b.load(0xFFFF0, [0xEA, 0x00, 0x00, 0x00, 0x01]);
  b.load(0x01000, r.bytes);
  b.runInsns(12, 2_000_000);
  eq(b.cpu.g8(7), 0xEE, "handler ran");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
