"use strict";
(function (K) {
  const { CF, PF, AF, ZF, SF, TF, IF, DF, OF } = K.FLAG;
  const AX = 0, CX = 1, DX = 2, BX = 3, SP = 4, BP = 5, SI = 6, DI = 7;
  const ES = 0, CS = 1, SS = 2, DS = 3;
  const P = K.Cpu86.prototype;
  const ops = new Array(256).fill(null);

  P.aluOp = function (f, w, a, b) {
    switch (f) {
      case 0: return this.aluAdd(w, a, b, 0);
      case 1: return this.aluLogic(w, a | b);
      case 2: return this.aluAdd(w, a, b, this.fl & CF ? 1 : 0);
      case 3: return this.aluSub(w, a, b, this.fl & CF ? 1 : 0);
      case 4: return this.aluLogic(w, a & b);
      case 5: return this.aluSub(w, a, b, 0);
      case 6: return this.aluLogic(w, a ^ b);
      case 7: return this.aluSub(w, a, b, 0); // CMP (no writeback)
    }
  };

  P.cond = function (c) {
    const f = this.fl;
    const O = !!(f & OF), C = !!(f & CF), Z = !!(f & ZF), S = !!(f & SF), Pa = !!(f & PF);
    let r;
    switch (c >> 1) {
      case 0: r = O; break;
      case 1: r = C; break;
      case 2: r = Z; break;
      case 3: r = C || Z; break;
      case 4: r = S; break;
      case 5: r = Pa; break;
      case 6: r = S !== O; break;
      case 7: r = (S !== O) || Z; break;
    }
    return (c & 1) ? !r : r;
  };

  // ---- 0x00..0x3F: ALU families + segment push/pop + BCD adjust ----
  function* aluRM(op) {
    const fam = (op >> 3) & 7, w = op & 1, toReg = (op >> 1) & 1;
    yield* this.modrm();
    const rmv = yield* this.readRM(w);
    const rv = this.gRM(w, this.regF);
    if (toReg) {
      const res = this.aluOp(fam, w, rv, rmv);
      if (fam !== 7) this.sRM(w, this.regF, res);
      yield* this.take(this.mod === 3 ? 4 : 5);
    } else {
      const res = this.aluOp(fam, w, rmv, rv);
      // real order: the ALU cycles run BEFORE the write hits the bus — the
      // total is unchanged but the MEMW lands where the SST stream has it
      yield* this.take(this.mod === 3 ? 4 : (fam === 7 ? 6 : 7));
      if (fam !== 7) yield* this.writeRM(w, res);
    }
  }
  function* aluAccImm(op) {
    const fam = (op >> 3) & 7, w = op & 1;
    const imm = w ? yield* this.fetchW() : yield* this.fetchB();
    const res = this.aluOp(fam, w, this.gRM(w, AX), imm);
    if (fam !== 7) this.sRM(w, AX, res);
    yield* this.take(w ? 6 : 5);
  }
  for (let fam = 0; fam < 8; fam++) {
    const base = fam << 3;
    ops[base] = aluRM; ops[base + 1] = aluRM; ops[base + 2] = aluRM; ops[base + 3] = aluRM;
    ops[base + 4] = aluAccImm; ops[base + 5] = aluAccImm;
  }
  ops[0x06] = function* () { yield* this.take(7); yield* this.push(this.s[ES]); };
  ops[0x0E] = function* () { yield* this.take(7); yield* this.push(this.s[CS]); };
  ops[0x16] = function* () { yield* this.take(7); yield* this.push(this.s[SS]); };
  ops[0x1E] = function* () { yield* this.take(7); yield* this.push(this.s[DS]); };
  ops[0x07] = function* () { this.s[ES] = yield* this.pop(); yield* this.take(4); };
  ops[0x0F] = function* () { this.s[CS] = yield* this.pop(); this.flushQueue(this.ip); yield* this.take(4); }; // POP CS (8086 quirk)
  ops[0x17] = function* () { this.s[SS] = yield* this.pop(); this.intInhibit = true; yield* this.take(4); };
  ops[0x1F] = function* () { this.s[DS] = yield* this.pop(); yield* this.take(4); };

  // Hardware quirk (SingleStepTests-verified): with incoming AF=1, AL in
  // 9Ah..9Fh does NOT take the 0x60 high adjustment on a real 8086/8088.
  ops[0x27] = function* () { // DAA
    const oldAL = this.g8(0), oldCF = !!(this.fl & CF);
    const afIn = (this.fl & AF) !== 0;
    let al = oldAL, cf;
    if ((al & 0xF) > 9 || afIn) { al += 6; this.setF(AF, true); } else this.setF(AF, false);
    const high = oldCF || (afIn && oldAL >= 0x9A && oldAL <= 0x9F ? false : oldAL > 0x99);
    if (high) { al += 0x60; cf = true; } else cf = false;
    this.s8(0, al); this.setF(CF, cf); this.szp(false, al & 0xFF);
    yield* this.take(4);
  };
  ops[0x2F] = function* () { // DAS
    const oldAL = this.g8(0), oldCF = !!(this.fl & CF);
    const afIn = (this.fl & AF) !== 0;
    let al = oldAL, cf;
    if ((al & 0xF) > 9 || afIn) { al -= 6; this.setF(AF, true); } else this.setF(AF, false);
    const high = oldCF || (afIn && oldAL >= 0x9A && oldAL <= 0x9F ? false : oldAL > 0x99);
    if (high) { al -= 0x60; cf = true; } else cf = false;
    this.s8(0, al); this.setF(CF, cf); this.szp(false, al & 0xFF);
    yield* this.take(4);
  };
  ops[0x37] = function* () { // AAA
    if ((this.g8(0) & 0xF) > 9 || (this.fl & AF)) {
      this.s8(0, this.g8(0) + 6); this.s8(4, this.g8(4) + 1);
      this.setF(AF, true); this.setF(CF, true);
    } else { this.setF(AF, false); this.setF(CF, false); }
    this.s8(0, this.g8(0) & 0xF);
    yield* this.take(8);
  };
  ops[0x3F] = function* () { // AAS
    if ((this.g8(0) & 0xF) > 9 || (this.fl & AF)) {
      this.s8(0, this.g8(0) - 6); this.s8(4, this.g8(4) - 1);
      this.setF(AF, true); this.setF(CF, true);
    } else { this.setF(AF, false); this.setF(CF, false); }
    this.s8(0, this.g8(0) & 0xF);
    yield* this.take(8);
  };

  // ---- 0x40..0x5F: INC/DEC/PUSH/POP r16 ----
  function* incR(op) {
    const i = op & 7, cf = this.fl & CF;
    this.r[i] = this.aluAdd(true, this.r[i], 1, 0);
    this.fl = (this.fl & ~CF) | cf;
    yield* this.take(2);
  }
  function* decR(op) {
    const i = op & 7, cf = this.fl & CF;
    this.r[i] = this.aluSub(true, this.r[i], 1, 0);
    this.fl = (this.fl & ~CF) | cf;
    yield* this.take(2);
  }
  function* pushR(op) {
    const i = op & 7;
    const v = i === SP ? (this.r[SP] - 2) & 0xFFFF : this.r[i]; // PUSH SP pushes the new SP
    yield* this.take(7);
    yield* this.push(v);
  }
  function* popR(op) { this.r[op & 7] = yield* this.pop(); yield* this.take(4); }
  for (let i = 0; i < 8; i++) {
    ops[0x40 + i] = incR; ops[0x48 + i] = decR; ops[0x50 + i] = pushR; ops[0x58 + i] = popR;
  }

  // ---- 0x70..0x7F: Jcc rel8 (0x60..0x6F alias on 8086) ----
  function* jcc(op) {
    const d = yield* this.fetchDisp8();
    if (this.cond(op & 0xF)) { yield* this.take(13); yield* this.jump(this.ip + d); }
    else yield* this.take(4);
  }
  for (let i = 0; i < 16; i++) { ops[0x70 + i] = jcc; ops[0x60 + i] = jcc; }

  // ---- 0x80..0x83: ALU group imm ----
  function* aluGrpImm(op) {
    const w = op & 1;
    yield* this.modrm();
    const fam = this.regF;
    const rmv = yield* this.readRM(w);
    let imm;
    if (op === 0x83) { imm = (yield* this.fetchDisp8()) & 0xFFFF; }
    else imm = w ? yield* this.fetchW() : yield* this.fetchB();
    const res = this.aluOp(fam, w, rmv, imm);
    if (fam !== 7) yield* this.writeRM(w, res);
    if (this.mod === 3) yield* this.take(op === 0x81 ? 7 : 6);
    else yield* this.take(fam === 7 ? 5 : 8);
  }
  ops[0x80] = aluGrpImm; ops[0x81] = aluGrpImm; ops[0x82] = aluGrpImm; ops[0x83] = aluGrpImm;

  // ---- TEST / XCHG / MOV / LEA / POP r/m ----
  function* testRM(op) {
    const w = op & 1;
    yield* this.modrm();
    const rmv = yield* this.readRM(w);
    this.aluOp(4, w, rmv, this.gRM(w, this.regF)); // AND for flags only
    yield* this.take(3);
  }
  ops[0x84] = testRM; ops[0x85] = testRM;
  function* xchgRM(op) {
    const w = op & 1;
    yield* this.modrm();
    if (this.mod !== 3) this.lock = true;  // XCHG mem asserts ~LOCK implicitly
    const rmv = yield* this.readRM(w);
    const rv = this.gRM(w, this.regF);
    this.sRM(w, this.regF, rmv);
    yield* this.writeRM(w, rv);
    yield* this.take(this.mod === 3 ? 5 : (w ? 7 : 9));
  }
  ops[0x86] = xchgRM; ops[0x87] = xchgRM;
  function* movRM(op) {
    const w = op & 1, toReg = (op >> 1) & 1;
    yield* this.modrm();
    if (toReg) { this.sRM(w, this.regF, yield* this.readRM(w)); yield* this.take(this.mod === 3 ? 2 : (w ? 4 : 2)); }
    else { yield* this.writeRM(w, this.gRM(w, this.regF)); yield* this.take(this.mod === 3 ? 3 : (w ? 3 : 4)); }
  }
  ops[0x88] = movRM; ops[0x89] = movRM; ops[0x8A] = movRM; ops[0x8B] = movRM;
  ops[0x8C] = function* () { // MOV r/m16, sreg
    yield* this.modrm();
    yield* this.writeRM(true, this.s[this.regF & 3]);
    yield* this.take(this.mod === 3 ? 2 : 3);
  };
  ops[0x8E] = function* () { // MOV sreg, r/m16
    yield* this.modrm();
    const v = yield* this.readRM(true);
    const sr = this.regF & 3;
    this.s[sr] = v;
    if (sr === CS) this.flushQueue(this.ip);
    if (sr === SS) this.intInhibit = true;
    yield* this.take(this.mod === 3 ? 3 : 4);
  };
  ops[0x8D] = function* () { // LEA
    yield* this.modrm();
    if (this.mod !== 3) this.r[this.regF] = this.eaOfs;
    yield* this.take(2);
  };
  ops[0x8F] = function* () { // POP r/m16
    yield* this.modrm();
    const v = yield* this.pop();
    yield* this.writeRM(true, v);
    yield* this.take(8);
  };

  // ---- 0x90..0x9F ----
  for (let i = 0; i < 8; i++)
    ops[0x90 + i] = function* (op) {
      const i2 = op & 7;
      const t = this.r[AX]; this.r[AX] = this.r[i2]; this.r[i2] = t;
      yield* this.take(3);
    };
  ops[0x98] = function* () { this.r[AX] = ((this.r[AX] & 0xFF) ^ 0x80) - 0x80 & 0xFFFF; yield* this.take(2); };
  ops[0x99] = function* () { this.r[DX] = (this.r[AX] & 0x8000) ? 0xFFFF : 0; yield* this.take(6); };
  ops[0x9A] = function* () { // CALL far
    const nip = yield* this.fetchW();
    const ncs = yield* this.fetchW();
    yield* this.take(19);
    yield* this.push(this.s[CS]);
    yield* this.push(this.ip);
    yield* this.jumpFar(ncs, nip);
  };
  ops[0x9B] = function* () { yield* this.take(3); }; // WAIT (TEST pin assumed inactive)
  ops[0x9C] = function* () { yield* this.take(7); yield* this.push(this.fl | 0xF002); };
  ops[0x9D] = function* () { this.fl = ((yield* this.pop()) & 0x0FD5) | 0xF002; yield* this.take(4); };
  ops[0x9E] = function* () { this.fl = (this.fl & ~0xD5) | (this.g8(4) & 0xD5) | 0x2; yield* this.take(5); }; // SAHF
  ops[0x9F] = function* () { this.s8(4, (this.fl & 0xD5) | 0x02); yield* this.take(2); };

  // ---- 0xA0..0xAF: MOV moffs + string ops ----
  ops[0xA0] = function* () { const o = yield* this.fetchW(); this.s8(0, yield* this.readMem(this.segOv ?? DS, o, false)); yield* this.take(6); };
  ops[0xA1] = function* () { const o = yield* this.fetchW(); this.r[AX] = yield* this.readMem(this.segOv ?? DS, o, true); yield* this.take(6); };
  ops[0xA2] = function* () { const o = yield* this.fetchW(); yield* this.writeMem(this.segOv ?? DS, o, false, this.g8(0)); yield* this.take(5); };
  ops[0xA3] = function* () { const o = yield* this.fetchW(); yield* this.writeMem(this.segOv ?? DS, o, true, this.r[AX]); yield* this.take(5); };

  function* stringUnit(kind, w) {
    const sz = w ? 2 : 1, delta = (this.fl & DF) ? -sz : sz;
    const sseg = this.segOv ?? DS;
    switch (kind) {
      case "movs": {
        const v = yield* this.readMem(sseg, this.r[SI], w);
        yield* this.writeMem(ES, this.r[DI], w, v);
        this.r[SI] = (this.r[SI] + delta) & 0xFFFF;
        this.r[DI] = (this.r[DI] + delta) & 0xFFFF;
        break;
      }
      case "cmps": {
        const a = yield* this.readMem(sseg, this.r[SI], w);
        const b = yield* this.readMem(ES, this.r[DI], w);
        this.aluSub(w, a, b, 0);
        this.r[SI] = (this.r[SI] + delta) & 0xFFFF;
        this.r[DI] = (this.r[DI] + delta) & 0xFFFF;
        break;
      }
      case "stos":
        yield* this.writeMem(ES, this.r[DI], w, this.gRM(w, AX));
        this.r[DI] = (this.r[DI] + delta) & 0xFFFF;
        break;
      case "lods":
        this.sRM(w, AX, yield* this.readMem(sseg, this.r[SI], w));
        this.r[SI] = (this.r[SI] + delta) & 0xFFFF;
        break;
      case "scas": {
        const b = yield* this.readMem(ES, this.r[DI], w);
        this.aluSub(w, this.gRM(w, AX), b, 0);
        this.r[DI] = (this.r[DI] + delta) & 0xFFFF;
        break;
      }
    }
  }
  const STR_CYC = { movs: 9, cmps: 14, stos: 6, lods: 9, scas: 11 };
  function makeString(kind) {
    return function* (op) {
      const w = op & 1;
      if (!this.rep) { yield* stringUnit.call(this, kind, w); yield* this.take(STR_CYC[kind] + 2); return; }
      yield* this.take(5);
      while (this.r[CX] !== 0) {
        // Interruptible: back up to the instruction start (prefixes included) and let
        // the main loop service the interrupt, then re-enter with the remaining CX.
        if (this.nmiLatch || (this.intrLine && (this.fl & IF))) { this.flushQueue(this.insnIP); return; }
        yield* stringUnit.call(this, kind, w);
        this.r[CX] = (this.r[CX] - 1) & 0xFFFF;
        yield* this.take(STR_CYC[kind]);
        if (kind === "cmps" || kind === "scas") {
          if (this.rep === "e" && !(this.fl & ZF)) break;
          if (this.rep === "ne" && (this.fl & ZF)) break;
        }
      }
    };
  }
  ops[0xA4] = makeString("movs"); ops[0xA5] = makeString("movs");
  ops[0xA6] = makeString("cmps"); ops[0xA7] = makeString("cmps");
  ops[0xAA] = makeString("stos"); ops[0xAB] = makeString("stos");
  ops[0xAC] = makeString("lods"); ops[0xAD] = makeString("lods");
  ops[0xAE] = makeString("scas"); ops[0xAF] = makeString("scas");
  function* testAccImm(op) {
    const w = op & 1;
    const imm = w ? yield* this.fetchW() : yield* this.fetchB();
    this.aluOp(4, w, this.gRM(w, AX), imm);
    yield* this.take(w ? 6 : 4);
  }
  ops[0xA8] = testAccImm; ops[0xA9] = testAccImm;

  // ---- 0xB0..0xBF: MOV reg, imm ----
  for (let i = 0; i < 8; i++) {
    ops[0xB0 + i] = function* (op) { this.s8(op & 7, yield* this.fetchB()); yield* this.take(4); };
    ops[0xB8 + i] = function* (op) { this.r[op & 7] = yield* this.fetchW(); yield* this.take(4); };
  }

  // ---- 0xC0..0xCF ----
  function* retNear(op) {
    const imm = (op & 1) === 0 ? yield* this.fetchW() : 0; // C2 imm / C3
    yield* this.take((op & 1) === 0 ? 17 : 12);
    const nip = yield* this.pop();
    if (imm) this.r[SP] = (this.r[SP] + imm) & 0xFFFF;
    this.flushQueue(nip);
  }
  ops[0xC2] = retNear; ops[0xC3] = retNear; ops[0xC0] = retNear; ops[0xC1] = retNear;
  function* retFar(op) {
    const imm = (op & 1) === 0 ? yield* this.fetchW() : 0; // CA imm / CB
    yield* this.take((op & 1) === 0 ? 21 : 18);
    const nip = yield* this.pop();
    this.s[CS] = yield* this.pop();
    if (imm) this.r[SP] = (this.r[SP] + imm) & 0xFFFF;
    this.flushQueue(nip);
  }
  ops[0xCA] = retFar; ops[0xCB] = retFar; ops[0xC8] = retFar; ops[0xC9] = retFar;
  ops[0xC4] = function* () { // LES
    yield* this.modrm();
    this.r[this.regF] = yield* this.readMem(this.eaSeg, this.eaOfs, true);
    this.s[ES] = yield* this.readMem(this.eaSeg, this.eaOfs + 2, true);
    yield* this.take(8);
  };
  ops[0xC5] = function* () { // LDS
    yield* this.modrm();
    this.r[this.regF] = yield* this.readMem(this.eaSeg, this.eaOfs, true);
    this.s[DS] = yield* this.readMem(this.eaSeg, this.eaOfs + 2, true);
    yield* this.take(8);
  };
  function* movRMImm(op) {
    const w = op & 1;
    yield* this.modrm();
    const imm = w ? yield* this.fetchW() : yield* this.fetchB();
    yield* this.writeRM(w, imm);
    yield* this.take(4);
  }
  ops[0xC6] = movRMImm; ops[0xC7] = movRMImm;
  ops[0xCC] = function* () { yield* this.take(1); yield* this.interrupt(3); };
  ops[0xCD] = function* () { const v = yield* this.fetchB(); yield* this.take(1); yield* this.interrupt(v); };
  ops[0xCE] = function* () { if (this.fl & OF) { yield* this.take(1); yield* this.interrupt(4); } else yield* this.take(4); };
  ops[0xCF] = function* () { // IRET
    yield* this.take(20);
    const nip = yield* this.pop();
    this.s[CS] = yield* this.pop();
    this.fl = ((yield* this.pop()) & 0x0FD5) | 0xF002;
    this.flushQueue(nip);
  };

  // ---- 0xD0..0xD3: shift/rotate group ----
  // The 8086 iterates CL times (count not masked) and updates OF every iteration,
  // so multi-bit shifts leave OF from the LAST iteration - SingleStepTests confirms.
  P.shiftOp = function (fam, w, v, n) {
    const mask = w ? 0xFFFF : 0xFF, sign = w ? 0x8000 : 0x80;
    let cf = (this.fl & CF) ? 1 : 0;
    let of = (this.fl & OF) ? 1 : 0;
    v &= mask;
    if (fam === 6) {
      // Undocumented SETMO/SETMOC: not a SHL alias — sets the operand to all
      // ones (the microcode's "PASS ones" path). No-op when the CL count is 0.
      if (n > 0) {
        v = mask;
        this.setF(CF, false); this.setF(OF, false); this.setF(AF, false);
        this.szp(w, v);
      }
      return v;
    }
    for (let i = 0; i < n; i++) {
      const before = v;
      switch (fam) {
        case 0: cf = (v & sign) ? 1 : 0; v = ((v << 1) | cf) & mask; break;           // ROL
        case 1: cf = v & 1; v = (v >> 1) | (cf ? sign : 0); break;                     // ROR
        case 2: { const nc = (v & sign) ? 1 : 0; v = ((v << 1) | cf) & mask; cf = nc; break; } // RCL
        case 3: { const nc = v & 1; v = (v >> 1) | (cf ? sign : 0); cf = nc; break; }  // RCR
        case 4: case 6: cf = (v & sign) ? 1 : 0; v = (v << 1) & mask; break;           // SHL
        case 5: cf = v & 1; v = v >> 1; break;                                         // SHR
        case 7: cf = v & 1; v = (v >> 1) | (v & sign); break;                          // SAR
      }
      const msb = (v & sign) ? 1 : 0, msb2 = (v & (sign >> 1)) ? 1 : 0;
      if (fam === 0 || fam === 2 || fam === 4 || fam === 6) of = msb ^ cf;             // ROL/RCL/SHL
      else if (fam === 1 || fam === 3) of = msb ^ msb2;                                // ROR/RCR
      else if (fam === 5) of = (before & sign) ? 1 : 0;                                // SHR
      else of = 0;                                                                     // SAR
    }
    if (n > 0) {
      this.setF(CF, cf === 1);
      this.setF(OF, of === 1);
      if (fam >= 4) this.szp(w, v);                    // shifts set SZP; rotates don't
    }
    return v;
  };
  function* shiftRM(op) {
    const w = op & 1, useCL = (op & 2) !== 0;
    yield* this.modrm();
    const n = useCL ? this.g8(1) : 1; // CL count is NOT masked on 8086
    const v = yield* this.readRM(w);
    const res = this.shiftOp(this.regF, w, v, n);
    yield* this.writeRM(w, res);
    yield* this.take((useCL ? 8 + 4 * n : 2) + (this.mod === 3 ? 0 : useCL ? 3 : 4));
  }
  ops[0xD0] = shiftRM; ops[0xD1] = shiftRM; ops[0xD2] = shiftRM; ops[0xD3] = shiftRM;

  ops[0xD4] = function* () { // AAM imm — runs CORD like a division
    const div = yield* this.fetchB();
    const m = this.mcAam(div);
    yield* this.take(m.cycles);
    if (!m.ok) { yield* this.interrupt(0); return; }
  };
  ops[0xD5] = function* () { // AAD imm
    const mul = yield* this.fetchB();
    const v = (this.g8(4) * mul + this.g8(0)) & 0xFF;
    this.s8(0, v); this.s8(4, 0);
    this.szp(false, v);
    yield* this.take(63);
  };
  ops[0xD6] = function* () { this.s8(0, (this.fl & CF) ? 0xFF : 0x00); yield* this.take(4); }; // SALC (undocumented)
  ops[0xD7] = function* () { // XLAT
    this.s8(0, yield* this.readMem(this.segOv ?? DS, (this.r[BX] + this.g8(0)) & 0xFFFF, false));
    yield* this.take(6);
  };
  for (let i = 0; i < 8; i++)
    ops[0xD8 + i] = function* () { // ESC — fetch modrm, touch memory operand, do nothing
      yield* this.modrm();
      if (this.mod !== 3) yield* this.readRM(true);
      yield* this.take(2);
    };

  // ---- 0xE0..0xEF: loops, IN/OUT, jumps/calls ----
  ops[0xE0] = function* () { // LOOPNE
    const d = yield* this.fetchDisp8();
    this.r[CX] = (this.r[CX] - 1) & 0xFFFF;
    if (this.r[CX] !== 0 && !(this.fl & ZF)) { yield* this.take(15); yield* this.jump(this.ip + d); }
    else yield* this.take(7);
  };
  ops[0xE1] = function* () { // LOOPE
    const d = yield* this.fetchDisp8();
    this.r[CX] = (this.r[CX] - 1) & 0xFFFF;
    if (this.r[CX] !== 0 && (this.fl & ZF)) { yield* this.take(17); yield* this.jump(this.ip + d); }
    else yield* this.take(7);
  };
  ops[0xE2] = function* () { // LOOP
    const d = yield* this.fetchDisp8();
    this.r[CX] = (this.r[CX] - 1) & 0xFFFF;
    if (this.r[CX] !== 0) { yield* this.take(14); yield* this.jump(this.ip + d); }
    else yield* this.take(7);
  };
  ops[0xE3] = function* () { // JCXZ
    const d = yield* this.fetchDisp8();
    if (this.r[CX] === 0) { yield* this.take(15); yield* this.jump(this.ip + d); }
    else yield* this.take(7);
  };
  ops[0xE4] = function* () { const p = yield* this.fetchB(); this.s8(0, yield* this.busRead("i", 0, p, false)); yield* this.take(6); };
  ops[0xE5] = function* () { const p = yield* this.fetchB(); this.r[AX] = yield* this.busRead("i", 0, p, true); yield* this.take(6); };
  ops[0xE6] = function* () { const p = yield* this.fetchB(); yield* this.busWrite("i", 0, p, false, this.g8(0)); yield* this.take(7); };
  ops[0xE7] = function* () { const p = yield* this.fetchB(); yield* this.busWrite("i", 0, p, true, this.r[AX]); yield* this.take(7); };
  ops[0xEC] = function* () { this.s8(0, yield* this.busRead("i", 0, this.r[DX], false)); yield* this.take(4); };
  ops[0xED] = function* () { this.r[AX] = yield* this.busRead("i", 0, this.r[DX], true); yield* this.take(4); };
  ops[0xEE] = function* () { yield* this.busWrite("i", 0, this.r[DX], false, this.g8(0)); yield* this.take(5); };
  ops[0xEF] = function* () { yield* this.busWrite("i", 0, this.r[DX], true, this.r[AX]); yield* this.take(5); };
  ops[0xE8] = function* () { // CALL rel16
    const d = yield* this.fetchW();
    yield* this.take(10);
    yield* this.push(this.ip);
    yield* this.jump(this.ip + ((d ^ 0x8000) - 0x8000));
  };
  ops[0xE9] = function* () { const d = yield* this.fetchW(); yield* this.take(13); yield* this.jump(this.ip + ((d ^ 0x8000) - 0x8000)); };
  ops[0xEA] = function* () { const nip = yield* this.fetchW(); const ncs = yield* this.fetchW(); yield* this.take(15); yield* this.jumpFar(ncs, nip); };
  ops[0xEB] = function* () { const d = yield* this.fetchDisp8(); yield* this.take(13); yield* this.jump(this.ip + d); };

  // ---- 0xF4..0xFF ----
  ops[0xF4] = function* () { yield { op: "halt" }; yield* this.take(2); };
  ops[0xF5] = function* () { this.setF(CF, !(this.fl & CF)); yield* this.take(2); };
  function* grpF6(op) {
    const w = op & 1;
    yield* this.modrm();
    const fam = this.regF;
    if (fam === 0 || fam === 1) { // TEST r/m, imm
      const v = yield* this.readRM(w);
      const imm = w ? yield* this.fetchW() : yield* this.fetchB();
      this.aluOp(4, w, v, imm);
      yield* this.take(this.mod === 3 ? (w ? 6 : 5) : 8);
      return;
    }
    if (fam === 2) { const v = yield* this.readRM(w); yield* this.writeRM(w, ~v); yield* this.take(this.mod === 3 ? 3 : 6); return; } // NOT
    if (fam === 3) { // NEG
      const v = yield* this.readRM(w);
      const res = this.aluSub(w, 0, v, 0);
      yield* this.writeRM(w, res);
      yield* this.take(this.mod === 3 ? 3 : 7);
      return;
    }
    const v = yield* this.readRM(w);
    const negate = this.rep != null; // REP prefix sets internal F1: negates mul/div results
    if (fam === 4 || fam === 5) { // MUL/IMUL — microcode CORX
      if (!w) {
        const m = this.mcMul(8, this.g8(0), v, fam === 5, negate);
        this.r[AX] = ((m.hi << 8) | m.lo) & 0xFFFF;
        yield* this.takeExact(m.cycles + 3);
      } else {
        const m = this.mcMul(16, this.r[AX], v, fam === 5, negate);
        this.r[AX] = m.lo; this.r[DX] = m.hi;
        yield* this.takeExact(m.cycles + 3);
      }
    } else { // DIV/IDIV — microcode CORD (traps leave regs untouched, flags as microcode left them)
      const d = !w
        ? this.mcDiv(8, this.g8(4), this.g8(0), v, fam === 7, negate)
        : this.mcDiv(16, this.r[DX], this.r[AX], v, fam === 7, negate);
      yield* this.takeExact(Math.max(0, d.cycles - (fam === 7 ? 3 : 0)));
      if (!d.ok) { yield* this.interrupt(0); return; }
      if (!w) { this.s8(0, d.q); this.s8(4, d.r); }
      else { this.r[AX] = d.q; this.r[DX] = d.r; }
    }
  }
  ops[0xF6] = grpF6; ops[0xF7] = grpF6;
  ops[0xF8] = function* () { this.setF(CF, false); yield* this.take(2); };
  ops[0xF9] = function* () { this.setF(CF, true); yield* this.take(2); };
  ops[0xFA] = function* () { this.setF(IF, false); yield* this.take(2); };
  ops[0xFB] = function* () { this.setF(IF, true); this.intInhibit = true; yield* this.take(2); }; // STI takes effect after next insn
  ops[0xFC] = function* () { this.setF(DF, false); yield* this.take(2); };
  ops[0xFD] = function* () { this.setF(DF, true); yield* this.take(2); };
  ops[0xFE] = function* () { // INC/DEC r/m8
    yield* this.modrm();
    const v = yield* this.readRM(false);
    const cf = this.fl & CF;
    const res = this.regF === 0 ? this.aluAdd(false, v, 1, 0) : this.aluSub(false, v, 1, 0);
    this.fl = (this.fl & ~CF) | cf;
    yield* this.writeRM(false, res);
    yield* this.take(this.mod === 3 ? 4 : 7);
  };
  ops[0xFF] = function* () { // group: INC DEC CALL CALLF JMP JMPF PUSH
    yield* this.modrm();
    switch (this.regF) {
      case 0: case 1: {
        const v = yield* this.readRM(true);
        const cf = this.fl & CF;
        const res = this.regF === 0 ? this.aluAdd(true, v, 1, 0) : this.aluSub(true, v, 1, 0);
        this.fl = (this.fl & ~CF) | cf;
        yield* this.writeRM(true, res);
        yield* this.take(this.mod === 3 ? 4 : 7);
        break;
      }
      case 2: { // CALL near indirect
        const t = yield* this.readRM(true);
        yield* this.take(this.mod === 3 ? 15 : 13);
        yield* this.push(this.ip);
        this.flushQueue(t);
        break;
      }
      case 3: { // CALL far indirect
        const nip = yield* this.readMem(this.eaSeg, this.eaOfs, true);
        const ncs = yield* this.readMem(this.eaSeg, this.eaOfs + 2, true);
        yield* this.take(16);
        yield* this.push(this.s[CS]);
        yield* this.push(this.ip);
        yield* this.jumpFar(ncs, nip);
        break;
      }
      case 4: { const t = yield* this.readRM(true); yield* this.take(this.mod === 3 ? 13 : 12); this.flushQueue(t); break; }
      case 5: {
        const nip = yield* this.readMem(this.eaSeg, this.eaOfs, true);
        const ncs = yield* this.readMem(this.eaSeg, this.eaOfs + 2, true);
        yield* this.take(9);
        yield* this.jumpFar(ncs, nip);
        break;
      }
      case 6: case 7: {
        let v = yield* this.readRM(true);
        if (this.mod === 3 && this.rm === SP) v = (v - 2) & 0xFFFF; // PUSH SP quirk
        yield* this.take(this.mod === 3 ? 6 : 8);
        yield* this.push(v);
        break;
      }
    }
  };

  P.ops = ops;
})(globalThis.K8086 ??= {});
