"use strict";
(function (K) {
  // Compact 8086 disassembler. K.disasm(bytes, offset, ip) -> {text, len}
  // `bytes` is an array-like of available bytes; if the instruction runs past the
  // end, text ends with "…" and len is what was consumed so far.
  const R8 = ["al", "cl", "dl", "bl", "ah", "ch", "dh", "bh"];
  const R16 = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"];
  const SR = ["es", "cs", "ss", "ds"];
  const EA = ["bx+si", "bx+di", "bp+si", "bp+di", "si", "di", "bp", "bx"];
  const ALU = ["add", "or", "adc", "sbb", "and", "sub", "xor", "cmp"];
  const SHIFT = ["rol", "ror", "rcl", "rcr", "shl", "shr", "setmo", "sar"];
  const JCC = ["jo", "jno", "jb", "jnb", "jz", "jnz", "jbe", "ja", "js", "jns", "jp", "jnp", "jl", "jge", "jle", "jg"];
  const hx = (v, w) => v.toString(16).toUpperCase().padStart(w || 2, "0") + "h";

  K.disasm = function (bytes, off, ip) {
    let i = off;
    const short = { text: "…", len: 0 };
    const need = (n) => i + n <= bytes.length;
    const b = () => bytes[i++];
    const w = () => { const l = bytes[i++]; return l | (bytes[i++] << 8); };
    const sx8 = (v) => v < 0x80 ? v : v - 0x100;

    let seg = "", rep = "", lock = "";
    let op;
    for (;;) {
      if (!need(1)) return short;
      op = b();
      if (op === 0x26) seg = "es:";
      else if (op === 0x2E) seg = "cs:";
      else if (op === 0x36) seg = "ss:";
      else if (op === 0x3E) seg = "ds:";
      else if (op === 0xF3) rep = "rep ";
      else if (op === 0xF2) rep = "repne ";
      else if (op === 0xF0) lock = "lock ";
      else break;
    }
    const pre = lock + rep;

    // modrm helpers
    let mod, reg, rm;
    function modrm() {
      if (!need(1)) return false;
      const m = b();
      mod = m >> 6; reg = (m >> 3) & 7; rm = m & 7;
      return true;
    }
    function rmStr(wide) {
      if (mod === 3) return wide ? R16[rm] : R8[rm];
      if (mod === 0 && rm === 6) { if (!need(2)) return null; return `${seg}[${hx(w(), 4)}]`; }
      let d = "";
      if (mod === 1) { if (!need(1)) return null; const v = sx8(b()); d = v < 0 ? "-" + hx(-v) : "+" + hx(v); }
      else if (mod === 2) { if (!need(2)) return null; d = "+" + hx(w(), 4); }
      return `${seg}[${EA[rm]}${d}]`;
    }
    const fin = (text) => ({ text: pre + text, len: i - off });
    const cut = () => ({ text: pre + "…", len: i - off });
    const imm8 = () => need(1) ? hx(b()) : null;
    const imm16 = () => need(2) ? hx(w(), 4) : null;
    const rel = (v) => hx((ip + (i - off) + v) & 0xFFFF, 4);

    // ALU family + acc/imm
    if (op < 0x40 && (op & 7) < 6 && ((op & 0x38) >> 3) < 8 && (op & 0xC0) === 0) {
      const fam = ALU[(op >> 3) & 7], wd = op & 1, dir = (op >> 1) & 1, form = op & 7;
      if (form < 4) {
        if (!modrm()) return cut();
        const r = wd ? R16[reg] : R8[reg], m = rmStr(wd);
        if (m === null) return cut();
        return fin(dir ? `${fam} ${r}, ${m}` : `${fam} ${m}, ${r}`);
      }
      const v = wd ? imm16() : imm8();
      if (v === null) return cut();
      return fin(`${fam} ${wd ? "ax" : "al"}, ${v}`);
    }
    switch (op & 0xF8) {
      case 0x40: return fin("inc " + R16[op & 7]);
      case 0x48: return fin("dec " + R16[op & 7]);
      case 0x50: return fin("push " + R16[op & 7]);
      case 0x58: return fin("pop " + R16[op & 7]);
      case 0x90: if (op === 0x90) return fin("nop"); return fin("xchg ax, " + R16[op & 7]);
      case 0xB0: { const v = imm8(); return v === null ? cut() : fin(`mov ${R8[op & 7]}, ${v}`); }
      case 0xB8: { const v = imm16(); return v === null ? cut() : fin(`mov ${R16[op & 7]}, ${v}`); }
    }
    if (op >= 0x60 && op <= 0x7F) { // jcc (60-6F alias)
      if (!need(1)) return cut();
      return fin(`${JCC[op & 15]} ${rel(sx8(b()))}`);
    }
    switch (op) {
      case 0x06: case 0x0E: case 0x16: case 0x1E: return fin("push " + SR[(op >> 3) & 3]);
      case 0x07: case 0x0F: case 0x17: case 0x1F: return fin("pop " + SR[(op >> 3) & 3]);
      case 0x27: return fin("daa"); case 0x2F: return fin("das");
      case 0x37: return fin("aaa"); case 0x3F: return fin("aas");
      case 0x80: case 0x81: case 0x82: case 0x83: {
        const wd = op & 1;
        if (!modrm()) return cut();
        const m = rmStr(wd);
        if (m === null) return cut();
        const v = op === 0x83 ? (need(1) ? hx(sx8(b()) & 0xFFFF, 4) : null) : (wd ? imm16() : imm8());
        if (v === null) return cut();
        return fin(`${ALU[reg]} ${mod === 3 ? "" : wd ? "word " : "byte "}${m}, ${v}`);
      }
      case 0x84: case 0x85: {
        if (!modrm()) return cut();
        const m = rmStr(op & 1);
        return m === null ? cut() : fin(`test ${m}, ${(op & 1) ? R16[reg] : R8[reg]}`);
      }
      case 0x86: case 0x87: {
        if (!modrm()) return cut();
        const m = rmStr(op & 1);
        return m === null ? cut() : fin(`xchg ${(op & 1) ? R16[reg] : R8[reg]}, ${m}`);
      }
      case 0x88: case 0x89: case 0x8A: case 0x8B: {
        if (!modrm()) return cut();
        const wd = op & 1, r = wd ? R16[reg] : R8[reg], m = rmStr(wd);
        if (m === null) return cut();
        return fin((op & 2) ? `mov ${r}, ${m}` : `mov ${m}, ${r}`);
      }
      case 0x8C: { if (!modrm()) return cut(); const m = rmStr(true); return m === null ? cut() : fin(`mov ${m}, ${SR[reg & 3]}`); }
      case 0x8E: { if (!modrm()) return cut(); const m = rmStr(true); return m === null ? cut() : fin(`mov ${SR[reg & 3]}, ${m}`); }
      case 0x8D: { if (!modrm()) return cut(); const m = rmStr(true); return m === null ? cut() : fin(`lea ${R16[reg]}, ${m}`); }
      case 0x8F: { if (!modrm()) return cut(); const m = rmStr(true); return m === null ? cut() : fin(`pop ${m}`); }
      case 0x98: return fin("cbw"); case 0x99: return fin("cwd");
      case 0x9A: { const o = imm16(), s = imm16(); return s === null ? cut() : fin(`call ${s}:${o}`); }
      case 0x9B: return fin("wait");
      case 0x9C: return fin("pushf"); case 0x9D: return fin("popf");
      case 0x9E: return fin("sahf"); case 0x9F: return fin("lahf");
      case 0xA0: { const v = imm16(); return v === null ? cut() : fin(`mov al, ${seg}[${v}]`); }
      case 0xA1: { const v = imm16(); return v === null ? cut() : fin(`mov ax, ${seg}[${v}]`); }
      case 0xA2: { const v = imm16(); return v === null ? cut() : fin(`mov ${seg}[${v}], al`); }
      case 0xA3: { const v = imm16(); return v === null ? cut() : fin(`mov ${seg}[${v}], ax`); }
      case 0xA4: return fin("movsb"); case 0xA5: return fin("movsw");
      case 0xA6: return fin("cmpsb"); case 0xA7: return fin("cmpsw");
      case 0xA8: { const v = imm8(); return v === null ? cut() : fin(`test al, ${v}`); }
      case 0xA9: { const v = imm16(); return v === null ? cut() : fin(`test ax, ${v}`); }
      case 0xAA: return fin("stosb"); case 0xAB: return fin("stosw");
      case 0xAC: return fin("lodsb"); case 0xAD: return fin("lodsw");
      case 0xAE: return fin("scasb"); case 0xAF: return fin("scasw");
      case 0xC0: case 0xC2: { const v = imm16(); return v === null ? cut() : fin(`ret ${v}`); }
      case 0xC1: case 0xC3: return fin("ret");
      case 0xC8: case 0xCA: { const v = imm16(); return v === null ? cut() : fin(`retf ${v}`); }
      case 0xC9: case 0xCB: return fin("retf");
      case 0xC4: { if (!modrm()) return cut(); const m = rmStr(true); return m === null ? cut() : fin(`les ${R16[reg]}, ${m}`); }
      case 0xC5: { if (!modrm()) return cut(); const m = rmStr(true); return m === null ? cut() : fin(`lds ${R16[reg]}, ${m}`); }
      case 0xC6: case 0xC7: {
        const wd = op & 1;
        if (!modrm()) return cut();
        const m = rmStr(wd);
        if (m === null) return cut();
        const v = wd ? imm16() : imm8();
        return v === null ? cut() : fin(`mov ${mod === 3 ? "" : wd ? "word " : "byte "}${m}, ${v}`);
      }
      case 0xCC: return fin("int3");
      case 0xCD: { const v = imm8(); return v === null ? cut() : fin(`int ${v}`); }
      case 0xCE: return fin("into"); case 0xCF: return fin("iret");
      case 0xD0: case 0xD1: case 0xD2: case 0xD3: {
        const wd = op & 1;
        if (!modrm()) return cut();
        const m = rmStr(wd);
        if (m === null) return cut();
        return fin(`${SHIFT[reg]} ${mod === 3 ? "" : wd ? "word " : "byte "}${m}, ${(op & 2) ? "cl" : "1"}`);
      }
      case 0xD4: { const v = imm8(); return v === null ? cut() : fin(v === "0Ah" ? "aam" : `aam ${v}`); }
      case 0xD5: { const v = imm8(); return v === null ? cut() : fin(v === "0Ah" ? "aad" : `aad ${v}`); }
      case 0xD6: return fin("salc");
      case 0xD7: return fin("xlat");
      case 0xD8: case 0xD9: case 0xDA: case 0xDB: case 0xDC: case 0xDD: case 0xDE: case 0xDF: {
        if (!modrm()) return cut();
        const m = rmStr(true);
        return m === null ? cut() : fin(`esc ${m}`);
      }
      case 0xE0: { if (!need(1)) return cut(); return fin(`loopne ${rel(sx8(b()))}`); }
      case 0xE1: { if (!need(1)) return cut(); return fin(`loope ${rel(sx8(b()))}`); }
      case 0xE2: { if (!need(1)) return cut(); return fin(`loop ${rel(sx8(b()))}`); }
      case 0xE3: { if (!need(1)) return cut(); return fin(`jcxz ${rel(sx8(b()))}`); }
      case 0xE4: { const v = imm8(); return v === null ? cut() : fin(`in al, ${v}`); }
      case 0xE5: { const v = imm8(); return v === null ? cut() : fin(`in ax, ${v}`); }
      case 0xE6: { const v = imm8(); return v === null ? cut() : fin(`out ${v}, al`); }
      case 0xE7: { const v = imm8(); return v === null ? cut() : fin(`out ${v}, ax`); }
      case 0xE8: { if (!need(2)) return cut(); const v = w(); return fin(`call ${rel((v ^ 0x8000) - 0x8000)}`); }
      case 0xE9: { if (!need(2)) return cut(); const v = w(); return fin(`jmp ${rel((v ^ 0x8000) - 0x8000)}`); }
      case 0xEA: { const o = imm16(), s = imm16(); return s === null ? cut() : fin(`jmp ${s}:${o}`); }
      case 0xEB: { if (!need(1)) return cut(); return fin(`jmp short ${rel(sx8(b()))}`); }
      case 0xEC: return fin("in al, dx"); case 0xED: return fin("in ax, dx");
      case 0xEE: return fin("out dx, al"); case 0xEF: return fin("out dx, ax");
      case 0xF4: return fin("hlt"); case 0xF5: return fin("cmc");
      case 0xF6: case 0xF7: {
        const wd = op & 1;
        if (!modrm()) return cut();
        const m = rmStr(wd);
        if (m === null) return cut();
        const ops2 = ["test", "test", "not", "neg", "mul", "imul", "div", "idiv"];
        const sz = mod === 3 ? "" : wd ? "word " : "byte ";
        if (reg < 2) { const v = wd ? imm16() : imm8(); return v === null ? cut() : fin(`test ${sz}${m}, ${v}`); }
        return fin(`${ops2[reg]} ${sz}${m}`);
      }
      case 0xF8: return fin("clc"); case 0xF9: return fin("stc");
      case 0xFA: return fin("cli"); case 0xFB: return fin("sti");
      case 0xFC: return fin("cld"); case 0xFD: return fin("std");
      case 0xFE: {
        if (!modrm()) return cut();
        const m = rmStr(false);
        return m === null ? cut() : fin(`${reg === 0 ? "inc" : "dec"} byte ${m}`);
      }
      case 0xFF: {
        if (!modrm()) return cut();
        const m = rmStr(true);
        if (m === null) return cut();
        const g = ["inc", "dec", "call", "call far", "jmp", "jmp far", "push", "push"];
        return fin(`${g[reg]} ${mod === 3 ? "" : "word "}${m}`);
      }
    }
    return fin(`db ${hx(op)}`);
  };
})(globalThis.K8086 ??= {});
