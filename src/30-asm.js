"use strict";
(function (K) {
  // Two-operand 8086 assembler: single pass with fixups for forward references.
  // Supports labels, ORG/DB/DW/EQU, byte/word ptr, segment overrides, char/hex/bin
  // literals, $ (current address), and simple +-*/ expressions.
  // K.assemble(src) -> { bytes: Uint8Array, org, errors: [{line, msg}], listing, symbols }

  const R8 = { al: 0, cl: 1, dl: 2, bl: 3, ah: 4, ch: 5, dh: 6, bh: 7 };
  const R16 = { ax: 0, cx: 1, dx: 2, bx: 3, sp: 4, bp: 5, si: 6, di: 7 };
  const SREG = { es: 0, cs: 1, ss: 2, ds: 3 };
  const JCC = {
    jo: 0x70, jno: 0x71, jb: 0x72, jc: 0x72, jnae: 0x72, jnb: 0x73, jnc: 0x73, jae: 0x73,
    je: 0x74, jz: 0x74, jne: 0x75, jnz: 0x75, jbe: 0x76, jna: 0x76, ja: 0x77, jnbe: 0x77,
    js: 0x78, jns: 0x79, jp: 0x7A, jpe: 0x7A, jnp: 0x7B, jpo: 0x7B,
    jl: 0x7C, jnge: 0x7C, jge: 0x7D, jnl: 0x7D, jle: 0x7E, jng: 0x7E, jg: 0x7F, jnle: 0x7F,
  };
  const ALU = { add: 0, or: 1, adc: 2, sbb: 3, and: 4, sub: 5, xor: 6, cmp: 7 };
  const SHIFT = { rol: 0, ror: 1, rcl: 2, rcr: 3, shl: 4, sal: 4, shr: 5, sar: 7 };
  const SIMPLE = {
    nop: [0x90], hlt: [0xF4], wait: [0x9B], fwait: [0x9B], cbw: [0x98], cwd: [0x99],
    pushf: [0x9C], popf: [0x9D], sahf: [0x9E], lahf: [0x9F], salc: [0xD6],
    xlat: [0xD7], xlatb: [0xD7], clc: [0xF8], stc: [0xF9], cmc: [0xF5],
    cli: [0xFA], sti: [0xFB], cld: [0xFC], std: [0xFD], iret: [0xCF],
    into: [0xCE], int3: [0xCC], aaa: [0x37], aas: [0x3F], daa: [0x27], das: [0x2F],
    movsb: [0xA4], movsw: [0xA5], cmpsb: [0xA6], cmpsw: [0xA7],
    stosb: [0xAA], stosw: [0xAB], lodsb: [0xAC], lodsw: [0xAD],
    scasb: [0xAE], scasw: [0xAF], ret: [0xC3], retf: [0xCB], lock: [0xF0],
  };
  const PREFIX = { rep: 0xF3, repe: 0xF3, repz: 0xF3, repne: 0xF2, repnz: 0xF2, lock: 0xF0 };

  K.assemble = function (src) {
    const errors = [], listing = [], symbols = {};
    const fixups = [];         // {at, size, rel, base, expr, line}
    let out = [];              // absolute-addressed byte list from baseOrg
    let baseOrg = null, pos = 0;

    function err(line, msg) { errors.push({ line, msg }); }
    function here() { return pos; }
    function ensureOrg() { if (baseOrg === null) { baseOrg = 0; pos = 0; } }
    function emitB(b) { ensureOrg(); out[pos - baseOrg] = b & 0xFF; pos++; }
    function emitW(w) { emitB(w); emitB(w >> 8); }

    // ---- expressions ----
    function evalExpr(str, lineNo, allowUnknown) {
      let i = 0;
      const s = str;
      function ws() { while (i < s.length && /\s/.test(s[i])) i++; }
      function atom() {
        ws();
        if (s[i] === "(") { i++; const v = expr(); ws(); if (s[i] === ")") i++; else throw "missing )"; return v; }
        if (s[i] === "+") { i++; return atom(); }
        if (s[i] === "-") { i++; const v = atom(); return v === null ? null : -v; }
        if (s[i] === "~") { i++; const v = atom(); return v === null ? null : ~v; }
        if (s[i] === "$") { i++; return here(); }
        if (s[i] === "'" || s[i] === '"') {
          const q = s[i++]; let v = 0;
          while (i < s.length && s[i] !== q) v = (v << 8) | s.charCodeAt(i++);
          if (s[i] !== q) throw "unterminated char literal";
          i++;
          return v;
        }
        const m = /^[A-Za-z_.@?][A-Za-z0-9_.@?]*|^[0-9][A-Za-z0-9]*/.exec(s.slice(i));
        if (!m) throw "bad expression at '" + s.slice(i) + "'";
        i += m[0].length;
        const t = m[0];
        if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16);
        if (/^[0-9a-f]+h$/i.test(t)) return parseInt(t.slice(0, -1), 16);
        if (/^0b[01]+$/i.test(t)) return parseInt(t.slice(2), 2);
        if (/^[01]+b$/i.test(t)) return parseInt(t.slice(0, -1), 2);
        if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
        const key = t.toLowerCase();
        if (key in symbols) return symbols[key];
        if (allowUnknown) return null;
        throw "undefined symbol '" + t + "'";
      }
      function term() {
        let v = atom();
        for (;;) {
          ws();
          if (s[i] === "*") { i++; const b = atom(); v = v === null || b === null ? null : v * b; }
          else if (s[i] === "/") { i++; const b = atom(); v = v === null || b === null ? null : Math.floor(v / b); }
          else return v;
        }
      }
      function expr() {
        let v = term();
        for (;;) {
          ws();
          if (s[i] === "+") { i++; const b = term(); v = v === null || b === null ? null : v + b; }
          else if (s[i] === "-") { i++; const b = term(); v = v === null || b === null ? null : v - b; }
          else return v;
        }
      }
      const v = expr();
      ws();
      if (i < s.length) throw "unexpected '" + s.slice(i) + "'";
      return v;
    }
    function tryEval(str, lineNo) {
      try { return evalExpr(str, lineNo, true); }
      catch (e) { err(lineNo, String(e)); return 0; }
    }
    // Emit a value now or record a fixup for later resolution.
    function emitVal(str, size, lineNo, rel, relBase) {
      const v = tryEval(str, lineNo);
      if (v === null) {
        fixups.push({ at: pos - baseOrg, size, rel: !!rel, base: relBase, expr: str, line: lineNo });
        for (let k = 0; k < size; k++) emitB(0);
      } else {
        let x = rel ? v - relBase : v;
        if (rel && size === 1 && (x < -128 || x > 127)) err(lineNo, "jump target out of range (" + x + ")");
        if (size === 1) emitB(x);
        else emitW(x);
      }
      return v;
    }

    // ---- operand parsing ----
    // Returns {kind:'r8'|'r16'|'sreg'|'mem'|'imm', reg, seg, rm parts, disp, expr, size}
    function parseOperand(tok, lineNo) {
      let t = tok.trim();
      let sizeHint = null;
      let m;
      if ((m = /^(byte|word)\s+(ptr\s+)?/i.exec(t))) { sizeHint = m[1].toLowerCase() === "byte" ? 1 : 2; t = t.slice(m[0].length).trim(); }
      let segOv = null;
      if ((m = /^(es|cs|ss|ds)\s*:\s*/i.exec(t)) && !/^\s*(es|cs|ss|ds)\s*$/i.test(t)) {
        segOv = SREG[m[1].toLowerCase()];
        t = t.slice(m[0].length).trim();
      }
      const low = t.toLowerCase();
      if (low in R8) return { kind: "r8", reg: R8[low] };
      if (low in R16) return { kind: "r16", reg: R16[low] };
      if (low in SREG) return { kind: "sreg", reg: SREG[low] };
      if (t.startsWith("[")) {
        if (!t.endsWith("]")) { err(lineNo, "missing ]"); return { kind: "imm", expr: "0" }; }
        let inner = t.slice(1, -1).trim();
        if ((m = /^(es|cs|ss|ds)\s*:\s*/i.exec(inner))) { segOv = SREG[m[1].toLowerCase()]; inner = inner.slice(m[0].length); }
        // split on +/- at top level, pull out base/index regs
        const parts = [];
        let depth = 0, cur = "", sign = "+";
        for (const ch of inner) {
          if (ch === "(") depth++;
          if (ch === ")") depth--;
          if ((ch === "+" || ch === "-") && depth === 0) { parts.push([sign, cur]); sign = ch; cur = ""; }
          else cur += ch;
        }
        parts.push([sign, cur]);
        let bx = false, bp = false, si = false, di = false;
        const dispTerms = [];
        for (const [sg, raw] of parts) {
          const p = raw.trim().toLowerCase();
          if (p === "bx" && sg === "+" && !bx) bx = true;
          else if (p === "bp" && sg === "+" && !bp) bp = true;
          else if (p === "si" && sg === "+" && !si) si = true;
          else if (p === "di" && sg === "+" && !di) di = true;
          else if (p !== "") dispTerms.push(sg + "(" + raw.trim() + ")");
        }
        if ((bx && bp) || (si && di)) err(lineNo, "invalid base/index combination");
        const dispExpr = dispTerms.length ? dispTerms.join("") : null;
        let rm = -1;
        if (bx && si) rm = 0; else if (bx && di) rm = 1;
        else if (bp && si) rm = 2; else if (bp && di) rm = 3;
        else if (si) rm = 4; else if (di) rm = 5;
        else if (bp) rm = 6; else if (bx) rm = 7;
        return { kind: "mem", rm, dispExpr, seg: segOv, size: sizeHint, direct: rm === -1 };
      }
      return { kind: "imm", expr: t, size: sizeHint, seg: segOv };
    }

    function emitSegPrefix(op) {
      if (op && op.kind === "mem" && op.seg !== null && op.seg !== undefined)
        emitB(0x26 | (op.seg << 3));
    }

    // Emit modrm byte + displacement for a mem/reg operand with the given reg field.
    function emitModRM(regField, op, lineNo) {
      if (op.kind === "r8" || op.kind === "r16") { emitB(0xC0 | (regField << 3) | op.reg); return; }
      if (op.direct) {
        emitB(0x00 | (regField << 3) | 6);
        emitVal(op.dispExpr ?? "0", 2, lineNo);
        return;
      }
      const disp = op.dispExpr === null ? 0 : tryEval(op.dispExpr, lineNo);
      if (disp === null) { // forward ref -> pessimistic 16-bit displacement
        emitB(0x80 | (regField << 3) | op.rm);
        emitVal(op.dispExpr, 2, lineNo);
      } else if (disp === 0 && op.rm !== 6) {
        emitB(0x00 | (regField << 3) | op.rm);
      } else if (disp >= -128 && disp <= 127) {
        emitB(0x40 | (regField << 3) | op.rm);
        emitB(disp);
      } else {
        emitB(0x80 | (regField << 3) | op.rm);
        emitW(disp);
      }
    }

    function opWidth(a, b, lineNo) {
      // Determine byte(1)/word(2) width from operands.
      for (const o of [a, b]) {
        if (!o) continue;
        if (o.kind === "r8") return 1;
        if (o.kind === "r16" || o.kind === "sreg") return 2;
      }
      for (const o of [a, b]) if (o && o.size) return o.size;
      err(lineNo, "operand size ambiguous — use byte/word ptr");
      return 2;
    }

    // ---- per-line assembly ----
    const lines = src.split(/\r?\n/);
    lines.forEach((rawLine, idx) => {
      const lineNo = idx + 1;
      const startPos = pos;
      let line = rawLine;
      // strip comments, but a ';' inside a string/char literal is data
      let quote = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) { if (ch === quote) quote = null; }
        else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ";") { line = line.slice(0, i); break; }
      }
      line = line.trim();
      if (!line) return;

      // label(s)
      let m;
      while ((m = /^([A-Za-z_.@?][A-Za-z0-9_.@?]*)\s*:/.exec(line))) {
        const name = m[1].toLowerCase();
        if (name in symbols) err(lineNo, "duplicate label " + m[1]);
        ensureOrg();
        symbols[name] = here();
        line = line.slice(m[0].length).trim();
      }
      if (!line) { listing.push({ line: lineNo, addr: startPos, len: 0 }); return; }

      const sp = line.search(/[\s]/);
      let mnem = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
      let rest = sp < 0 ? "" : line.slice(sp).trim();

      // EQU: "name equ expr"
      if (rest.toLowerCase().startsWith("equ ") || rest.toLowerCase() === "equ") {
        const v = tryEval(rest.slice(3).trim(), lineNo);
        if (v === null) err(lineNo, "EQU needs a resolvable value");
        else symbols[mnem] = v;
        return;
      }

      const args = [];
      {
        let depth = 0, cur = "", q = null;
        for (const ch of rest) {
          if (q) { cur += ch; if (ch === q) q = null; continue; }
          if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
          if (ch === "[" || ch === "(") depth++;
          if (ch === "]" || ch === ")") depth--;
          if (ch === "," && depth === 0) { args.push(cur.trim()); cur = ""; }
          else cur += ch;
        }
        if (cur.trim()) args.push(cur.trim());
      }

      try {
        assembleInsn(mnem, args, rest, lineNo);
      } catch (e) {
        err(lineNo, String(e && e.message || e));
      }
      listing.push({ line: lineNo, addr: startPos, len: pos - startPos });
    });

    function needArgs(args, n, lineNo) {
      if (args.length !== n) throw new Error("expected " + n + " operand(s)");
    }

    function assembleInsn(mnem, args, rest, lineNo) {
      // directives
      if (mnem === "org") {
        const v = tryEval(rest, lineNo);
        if (v === null) throw new Error("ORG needs a known value");
        if (baseOrg === null) { baseOrg = v; pos = v; }
        else if (v < pos) throw new Error("ORG going backwards");
        else { while (pos < v) emitB(0xFF); } // erased-EPROM fill
        return;
      }
      if (mnem === "db") {
        for (const a of args) {
          const t = a.trim();
          if (t.startsWith('"') || t.startsWith("'")) {
            const q = t[0];
            if (!t.endsWith(q) || t.length < 2) throw new Error("bad string");
            for (let i2 = 1; i2 < t.length - 1; i2++) emitB(t.charCodeAt(i2));
          } else emitVal(t, 1, lineNo);
        }
        return;
      }
      if (mnem === "dw") { for (const a of args) emitVal(a, 2, lineNo); return; }
      if (mnem === "times") {
        const mm = /^(\S+)\s+db\s+(.+)$/i.exec(rest);
        if (!mm) throw new Error("only 'times N db X' supported");
        const n = tryEval(mm[1], lineNo), v = tryEval(mm[2], lineNo);
        if (n === null || v === null) throw new Error("times needs known values");
        for (let i2 = 0; i2 < n; i2++) emitB(v);
        return;
      }
      if (mnem === "end" || mnem === "cpu" || mnem === "bits") return;

      // prefix followed by another mnemonic on the same line (rep movsb, lock xchg ...)
      if (mnem in PREFIX && rest) {
        emitB(PREFIX[mnem]);
        const sp2 = rest.search(/\s/);
        const mn2 = (sp2 < 0 ? rest : rest.slice(0, sp2)).toLowerCase();
        const rest2 = sp2 < 0 ? "" : rest.slice(sp2).trim();
        const args2 = rest2 ? rest2.split(",").map(s => s.trim()) : [];
        assembleInsn(mn2, args2, rest2, lineNo);
        return;
      }

      if (mnem in SIMPLE && args.length === 0) { for (const b of SIMPLE[mnem]) emitB(b); return; }
      if (mnem === "ret" && args.length === 1) { emitB(0xC2); emitVal(args[0], 2, lineNo); return; }
      if (mnem === "retf" && args.length === 1) { emitB(0xCA); emitVal(args[0], 2, lineNo); return; }
      if (mnem === "int") { needArgs(args, 1, lineNo); emitB(0xCD); emitVal(args[0], 1, lineNo); return; }
      if (mnem === "aam") { emitB(0xD4); emitVal(args[0] ?? "10", 1, lineNo); return; }
      if (mnem === "aad") { emitB(0xD5); emitVal(args[0] ?? "10", 1, lineNo); return; }

      if (mnem in JCC) {
        needArgs(args, 1, lineNo);
        emitB(JCC[mnem]);
        emitVal(args[0], 1, lineNo, true, here() + 1);
        return;
      }
      if (mnem === "loop" || mnem === "loope" || mnem === "loopz" || mnem === "loopne" || mnem === "loopnz" || mnem === "jcxz") {
        needArgs(args, 1, lineNo);
        emitB({ loop: 0xE2, loope: 0xE1, loopz: 0xE1, loopne: 0xE0, loopnz: 0xE0, jcxz: 0xE3 }[mnem]);
        emitVal(args[0], 1, lineNo, true, here() + 1);
        return;
      }

      if (mnem === "jmp" || mnem === "call") {
        needArgs(args, 1, lineNo);
        let t = args[0];
        // far form seg:off ?
        const far = /^(\S+)\s*:\s*(\S+)$/.exec(t);
        if (far && !/^\[/.test(t) && !(far[1].toLowerCase() in SREG)) {
          emitB(mnem === "jmp" ? 0xEA : 0x9A);
          emitVal(far[2], 2, lineNo);
          emitVal(far[1], 2, lineNo);
          return;
        }
        let short = false;
        const sm = /^short\s+/i.exec(t);
        if (sm) { short = true; t = t.slice(sm[0].length); }
        const op = parseOperand(t, lineNo);
        if (op.kind === "r16" || op.kind === "mem") {
          emitSegPrefix(op);
          emitB(0xFF);
          emitModRM(mnem === "jmp" ? 4 : 2, op, lineNo);
          return;
        }
        if (mnem === "jmp" && short) { emitB(0xEB); emitVal(t, 1, lineNo, true, here() + 1); return; }
        emitB(mnem === "jmp" ? 0xE9 : 0xE8);
        emitVal(t, 2, lineNo, true, here() + 2);
        return;
      }

      if (mnem === "push" || mnem === "pop") {
        needArgs(args, 1, lineNo);
        const op = parseOperand(args[0], lineNo);
        if (op.kind === "r16") { emitB((mnem === "push" ? 0x50 : 0x58) | op.reg); return; }
        if (op.kind === "sreg") { emitB((mnem === "push" ? 0x06 : 0x07) | (op.reg << 3)); return; }
        if (op.kind === "mem") {
          emitSegPrefix(op);
          if (mnem === "push") { emitB(0xFF); emitModRM(6, op, lineNo); }
          else { emitB(0x8F); emitModRM(0, op, lineNo); }
          return;
        }
        throw new Error("bad operand for " + mnem);
      }

      if (mnem === "inc" || mnem === "dec") {
        needArgs(args, 1, lineNo);
        const op = parseOperand(args[0], lineNo);
        const isInc = mnem === "inc";
        if (op.kind === "r16") { emitB((isInc ? 0x40 : 0x48) | op.reg); return; }
        const w = op.kind === "r8" ? 1 : (op.size ?? (() => { throw new Error("size needed: byte/word ptr"); })());
        emitSegPrefix(op);
        emitB(w === 1 ? 0xFE : 0xFF);
        emitModRM(isInc ? 0 : 1, op, lineNo);
        return;
      }

      if (mnem === "not" || mnem === "neg" || mnem === "mul" || mnem === "imul" || mnem === "div" || mnem === "idiv") {
        needArgs(args, 1, lineNo);
        const fam = { not: 2, neg: 3, mul: 4, imul: 5, div: 6, idiv: 7 }[mnem];
        const op = parseOperand(args[0], lineNo);
        const w = op.kind === "r8" ? 1 : op.kind === "r16" ? 2 : (op.size ?? (() => { throw new Error("size needed"); })());
        emitSegPrefix(op);
        emitB(w === 1 ? 0xF6 : 0xF7);
        emitModRM(fam, op, lineNo);
        return;
      }

      if (mnem in SHIFT) {
        needArgs(args, 2, lineNo);
        const op = parseOperand(args[0], lineNo);
        const cnt = args[1].trim().toLowerCase();
        const w = op.kind === "r8" ? 1 : op.kind === "r16" ? 2 : (op.size ?? (() => { throw new Error("size needed"); })());
        emitSegPrefix(op);
        if (cnt === "cl") { emitB(w === 1 ? 0xD2 : 0xD3); emitModRM(SHIFT[mnem], op, lineNo); return; }
        const n = tryEval(cnt, lineNo);
        if (n === 1) { emitB(w === 1 ? 0xD0 : 0xD1); emitModRM(SHIFT[mnem], op, lineNo); return; }
        throw new Error("8086 shift count must be 1 or CL");
      }

      if (mnem === "in" || mnem === "out") {
        needArgs(args, 2, lineNo);
        const a = parseOperand(args[0], lineNo), b = parseOperand(args[1], lineNo);
        if (mnem === "in") {
          const w = a.kind === "r16" ? 1 : 0;
          if (!((a.kind === "r8" && a.reg === 0) || (a.kind === "r16" && a.reg === 0))) throw new Error("IN needs AL/AX");
          if (b.kind === "r16" && b.reg === 2) { emitB(0xEC | w); return; }
          emitB(0xE4 | w);
          emitVal(b.expr, 1, lineNo);
        } else {
          const w = b.kind === "r16" ? 1 : 0;
          if (!((b.kind === "r8" && b.reg === 0) || (b.kind === "r16" && b.reg === 0))) throw new Error("OUT needs AL/AX");
          if (a.kind === "r16" && a.reg === 2) { emitB(0xEE | w); return; }
          emitB(0xE6 | w);
          emitVal(a.expr, 1, lineNo);
        }
        return;
      }

      if (mnem === "lea" || mnem === "lds" || mnem === "les") {
        needArgs(args, 2, lineNo);
        const r = parseOperand(args[0], lineNo), m2 = parseOperand(args[1], lineNo);
        if (r.kind !== "r16" || m2.kind !== "mem") throw new Error(mnem + " needs r16, mem");
        emitSegPrefix(m2);
        emitB({ lea: 0x8D, lds: 0xC5, les: 0xC4 }[mnem]);
        emitModRM(r.reg, m2, lineNo);
        return;
      }

      if (mnem === "xchg") {
        needArgs(args, 2, lineNo);
        let a = parseOperand(args[0], lineNo), b = parseOperand(args[1], lineNo);
        if (a.kind === "r16" && a.reg === 0 && b.kind === "r16") { emitB(0x90 | b.reg); return; }
        if (b.kind === "r16" && b.reg === 0 && a.kind === "r16") { emitB(0x90 | a.reg); return; }
        if (a.kind === "mem") [a, b] = [b, a];
        if (a.kind !== "r8" && a.kind !== "r16") throw new Error("xchg needs a register");
        const w = a.kind === "r16" ? 1 : 0;
        emitSegPrefix(b);
        emitB(0x86 | w);
        emitModRM(a.reg, b, lineNo);
        return;
      }

      if (mnem === "test") {
        needArgs(args, 2, lineNo);
        let a = parseOperand(args[0], lineNo), b = parseOperand(args[1], lineNo);
        if (b.kind === "imm") {
          const w = a.kind === "r8" ? 1 : a.kind === "r16" ? 2 : (a.size ?? 2);
          if (a.kind === "r8" && a.reg === 0) { emitB(0xA8); emitVal(b.expr, 1, lineNo); return; }
          if (a.kind === "r16" && a.reg === 0) { emitB(0xA9); emitVal(b.expr, 2, lineNo); return; }
          emitSegPrefix(a);
          emitB(w === 1 ? 0xF6 : 0xF7);
          emitModRM(0, a, lineNo);
          emitVal(b.expr, w, lineNo);
          return;
        }
        if (a.kind === "mem") [a, b] = [b, a];
        const w = a.kind === "r16" ? 1 : 0;
        emitSegPrefix(b);
        emitB(0x84 | w);
        emitModRM(a.reg, b, lineNo);
        return;
      }

      if (mnem === "mov") {
        needArgs(args, 2, lineNo);
        const a = parseOperand(args[0], lineNo), b = parseOperand(args[1], lineNo);
        // sreg moves
        if (a.kind === "sreg") {
          if (b.kind !== "r16" && b.kind !== "mem") throw new Error("mov sreg needs r/m16");
          emitSegPrefix(b);
          emitB(0x8E);
          emitModRM(a.reg, b, lineNo);
          return;
        }
        if (b.kind === "sreg") {
          emitSegPrefix(a);
          emitB(0x8C);
          emitModRM(b.reg, a, lineNo);
          return;
        }
        // accumulator <-> direct memory short forms
        if (a.kind === "r8" && a.reg === 0 && b.kind === "mem" && b.direct) { emitSegPrefix(b); emitB(0xA0); emitVal(b.dispExpr ?? "0", 2, lineNo); return; }
        if (a.kind === "r16" && a.reg === 0 && b.kind === "mem" && b.direct) { emitSegPrefix(b); emitB(0xA1); emitVal(b.dispExpr ?? "0", 2, lineNo); return; }
        if (b.kind === "r8" && b.reg === 0 && a.kind === "mem" && a.direct) { emitSegPrefix(a); emitB(0xA2); emitVal(a.dispExpr ?? "0", 2, lineNo); return; }
        if (b.kind === "r16" && b.reg === 0 && a.kind === "mem" && a.direct) { emitSegPrefix(a); emitB(0xA3); emitVal(a.dispExpr ?? "0", 2, lineNo); return; }
        if (b.kind === "imm") {
          if (a.kind === "r8") { emitB(0xB0 | a.reg); emitVal(b.expr, 1, lineNo); return; }
          if (a.kind === "r16") { emitB(0xB8 | a.reg); emitVal(b.expr, 2, lineNo); return; }
          const w = a.size ?? (() => { throw new Error("size needed: byte/word ptr"); })();
          emitSegPrefix(a);
          emitB(w === 1 ? 0xC6 : 0xC7);
          emitModRM(0, a, lineNo);
          emitVal(b.expr, w, lineNo);
          return;
        }
        if (a.kind === "mem" && (b.kind === "r8" || b.kind === "r16")) {
          emitSegPrefix(a);
          emitB(b.kind === "r16" ? 0x89 : 0x88);
          emitModRM(b.reg, a, lineNo);
          return;
        }
        if ((a.kind === "r8" || a.kind === "r16") && (b.kind === "mem" || b.kind === a.kind)) {
          emitSegPrefix(b);
          emitB(a.kind === "r16" ? 0x8B : 0x8A);
          emitModRM(a.reg, b, lineNo);
          return;
        }
        throw new Error("bad mov operands");
      }

      if (mnem in ALU) {
        needArgs(args, 2, lineNo);
        const fam = ALU[mnem];
        const a = parseOperand(args[0], lineNo), b = parseOperand(args[1], lineNo);
        if (b.kind === "imm") {
          const w = a.kind === "r8" ? 1 : a.kind === "r16" ? 2 : (a.size ?? (() => { throw new Error("size needed: byte/word ptr"); })());
          if (a.kind === "r8" && a.reg === 0) { emitB((fam << 3) | 4); emitVal(b.expr, 1, lineNo); return; }
          if (a.kind === "r16" && a.reg === 0) { emitB((fam << 3) | 5); emitVal(b.expr, 2, lineNo); return; }
          emitSegPrefix(a);
          const v = tryEval(b.expr, lineNo);
          if (w === 2 && v !== null && v >= -128 && v <= 127) {
            emitB(0x83);
            emitModRM(fam, a, lineNo);
            emitB(v);
          } else {
            emitB(w === 1 ? 0x80 : 0x81);
            emitModRM(fam, a, lineNo);
            emitVal(b.expr, w, lineNo);
          }
          return;
        }
        if (a.kind === "mem") {
          const w = b.kind === "r16" ? 1 : 0;
          emitSegPrefix(a);
          emitB((fam << 3) | w);
          emitModRM(b.reg, a, lineNo);
          return;
        }
        const w = a.kind === "r16" ? 1 : 0;
        emitSegPrefix(b);
        emitB((fam << 3) | 2 | w);
        emitModRM(a.reg, b, lineNo);
        return;
      }

      throw new Error("unknown instruction '" + mnem + "'");
    }

    // ---- resolve fixups ----
    for (const f of fixups) {
      let v;
      try { v = evalExpr(f.expr, f.line, false); }
      catch (e) { err(f.line, String(e)); continue; }
      let x = f.rel ? v - f.base : v;
      if (f.rel && f.size === 1 && (x < -128 || x > 127)) { err(f.line, "jump target out of range"); continue; }
      out[f.at] = x & 0xFF;
      if (f.size === 2) out[f.at + 1] = (x >> 8) & 0xFF;
    }

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out[i] ?? 0xFF;
    return { bytes, org: baseOrg ?? 0, errors, listing, symbols };
  };
})(globalThis.K8086 ??= {});
