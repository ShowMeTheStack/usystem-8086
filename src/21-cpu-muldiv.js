"use strict";
(function (K) {
  // Microcode-faithful 8086/8088 multiply/divide: CORD (division), CORX
  // (multiplication) and their co-routines PREIDIV/POSTIDIV/NEGATE/IMULCOF.
  // Ported from MartyPC (MIT, Daniel Balsom, github.com/dbalsom/martypc),
  // itself a direct translation of reenigne's 8086 microcode disassembly.
  // This reproduces the exact flag state — including the "undefined" flags and
  // the values pushed by the divide-error interrupt — plus data-dependent cycle
  // counts (each emulated micro-op costs one cycle, like the real ROM).
  const { CF, AF, OF } = K.FLAG;
  const P = K.Cpu86.prototype;

  function mkAlu(bits) {
    const mask = bits === 8 ? 0xFF : 0xFFFF;
    const sign = bits === 8 ? 0x80 : 0x8000;
    return {
      bits, mask, sign,
      rcl(v, c) { v &= mask; const co = (v & sign) ? 1 : 0; return [((v << 1) | c) & mask, co]; },
      rcr(v, c) { v &= mask; const co = v & 1; return [((v >> 1) | (c ? sign : 0)) & mask, co]; },
      sub(a, b) {
        a &= mask; b &= mask;
        const r = (a - b) & mask;
        return [r, a < b ? 1 : 0, ((a ^ b) & (a ^ r) & sign) !== 0 ? 1 : 0, ((a ^ b ^ r) & 0x10) !== 0 ? 1 : 0];
      },
      add(a, b, c = 0) {
        a &= mask; b &= mask;
        const f = a + b + c, r = f & mask;
        return [r, f > mask ? 1 : 0, ((a ^ r) & (b ^ r) & sign) !== 0 ? 1 : 0, ((a ^ b ^ r) & 0x10) !== 0 ? 1 : 0];
      },
    };
  }
  const ALU = { 8: mkAlu(8), 16: mkAlu(16) };
  const neg16 = (v) => { v &= 0xFFFF; return [(0 - v) & 0xFFFF, v !== 0 ? 1 : 0]; };

  // mc: cycle accumulator context {c}
  function setSZPOACF(cpu, alu, sigma, carry, ovf, aux) {
    cpu.setF(AF, aux === 1);
    cpu.setF(OF, ovf === 1);
    cpu.setF(CF, carry === 1);
    cpu.szp(alu.bits === 16, sigma & alu.mask);
  }

  // NEGATE co-routine (1b6..1bf). Returns [tmpa, tmpb, tmpc, carry, negFlag].
  function corNegate(cpu, alu, mc, tmpa, tmpb, tmpc, negFlag, skip) {
    let sigma, carry;
    if (!skip) {
      [sigma, carry] = neg16(tmpc);            // 1b6: NEG tmpc (16-bit ALU)
      tmpc = sigma;
      if (carry) {
        sigma = (~tmpa) & 0xFFFF;              // 1b8,jmp,1ba: COM tmpa
        mc.c += 5;
      } else {
        [sigma] = neg16(tmpa);                 // 1b8,1b9,1ba: NEG tmpa
        mc.c += 5;
      }
      tmpa = sigma;
      negFlag = !negFlag;                      // 1ba: CF1
    }
    carry = (tmpb & alu.sign) !== 0;           // 1bb: LRCY tmpb (msb at width)
    cpu.setF(CF, carry);
    const [negB] = neg16(tmpb);                // 1bc: NEG tmpb
    mc.c += 3;                                 // 1bb,1bc,1bd
    if (!carry) {
      mc.c += 3;                               // jmp,1bf,RTN
    } else {
      tmpb = negB;                             // 1be: SIGMA->tmpb | CF1 RTN
      negFlag = !negFlag;
      mc.c += 2;                               // 1be,RTN
    }
    return [tmpa, tmpb, tmpc, carry ? 1 : 0, negFlag];
  }

  // PREIDIV (1b4..1b5 then NEGATE). Returns [tmpa, tmpb, tmpc, negFlag].
  function preIdiv(cpu, alu, mc, tmpa, tmpb, tmpc, negFlag) {
    const carry = (tmpa & alu.sign) !== 0;     // 1b4: LRCY tmpa (dividend sign)
    mc.c += 6;                                 // 1b4,1b5 + entry overhead (SST-tuned)
    let r;
    if (!carry) {
      mc.c += 1;                               // jump into NEGATE @7
      r = corNegate(cpu, alu, mc, tmpa, tmpb, tmpc, negFlag, true);
    } else {
      r = corNegate(cpu, alu, mc, tmpa, tmpb, tmpc, negFlag, false);
    }
    return [r[0], r[1], r[2], r[4]];
  }

  // POSTIDIV (1c4..1cc). Returns null on divide error, else [tmpa, quotient].
  function postIdiv(cpu, alu, mc, tmpa, tmpbX, tmpc, carry, negFlag) {
    mc.c += 1;                                 // 1c4
    if (!carry) { mc.c += 1; return null; }    // NCY INT0
    const c2 = (tmpbX & alu.sign) !== 0;       // 1c5: LRCY tmpb (dividend sign -> remainder sign)
    const [negA] = neg16(tmpa);                // 1c6: NEG tmpa
    mc.c += 3;                                 // 1c5,1c6,1c7
    if (!c2) mc.c += 1;                        // jump to 5
    else { tmpa = negA; mc.c += 1; }           // 1c8
    let sigma = (tmpc + 1) & 0xFFFF;           // 1c9: INC tmpc
    mc.c += 2;                                 // 1c9,1ca
    if (!negFlag) { sigma = (~tmpc) & 0xFFFF; mc.c += 1; } // 1cb: COM tmpc
    else mc.c += 1;                            // jump
    cpu.setF(CF, false);                       // 1cc: CCOF RTN
    cpu.setF(OF, false);
    mc.c += 2;
    return [tmpa, sigma];
  }

  // CORD division co-routine (188..197). Returns null on overflow (divide error),
  // else [tmpcRaw (complemented quotient), tmpa (remainder), carry].
  function cord(cpu, alu, mc, tmpa, tmpb, tmpc) {
    let [sigma, carry, ovf, aux] = alu.sub(tmpa, tmpb);   // 188: SUBT tmpa
    setSZPOACF(cpu, alu, sigma, carry, ovf, aux);         // 189: F
    let counter = alu.bits;                               // 189: MAXC
    mc.c += 3;                                            // 188,189,18a
    if (!carry) { mc.c += 1; return null; }               // 18a: NCY INT0

    while (counter > 0) {
      [sigma, carry] = alu.rcl(tmpc, carry);              // 18c: RCLY tmpc
      tmpc = sigma;
      [sigma, carry] = alu.rcl(tmpa, carry);              // 18d: RCLY tmpa
      tmpa = sigma;
      mc.c += 4;                                          // 18b,18c,18d,18e
      if (carry) {
        mc.c += 3;                                        // jmp,195,196
        carry = 0;                                        // 195: RCY
        [sigma] = alu.sub(tmpa, tmpb);                    // 196: SIGMA->tmpa
        tmpa = sigma;
        counter--;
        if (counter > 0) { mc.c += 1; continue; }         // NCZ 3
        mc.c += 2;                                        // 197,jmp
      } else {
        let o2, a2;
        [sigma, carry, o2, a2] = alu.sub(tmpa, tmpb);     // 18f: F
        setSZPOACF(cpu, alu, sigma, carry, o2, a2);
        mc.c += 2;                                        // 18f,190
        if (!carry) {
          mc.c += 2;                                      // jmp,196
          [sigma] = alu.sub(tmpa, tmpb);                  // 196: SIGMA->tmpa
          tmpa = sigma;
          counter--;
          if (counter > 0) { mc.c += 1; continue; }
          mc.c += 2;                                      // 197,jmp
        } else {
          mc.c += 1;                                      // 191
          counter--;
          if (counter > 0) { mc.c += 1; continue; }       // NCZ 3
        }
      }
    }
    [sigma, carry] = alu.rcl(tmpc, carry);                // 192
    tmpc = sigma;                                         // 193: SIGMA->tmpc
    [, carry] = alu.rcl(tmpc, carry);                     // 194: RTN
    cpu.setF(CF, carry === 1);
    mc.c += 4;                                            // 192,193,194,RTN
    return [tmpc, tmpa, carry];
  }

  // CORX multiplication co-routine (17f..187). Returns [tmpa (hi), tmpc (lo)].
  function corx(cpu, alu, mc, tmpb, tmpc, carry) {
    let sigma;
    let tmpa = 0;                                         // 17f: ZERO->tmpa
    [sigma, carry] = alu.rcr(tmpc, carry);                // 17f: RRCY tmpc
    tmpc = sigma;                                         // 180: SIGMA->tmpc
    let counter = alu.bits - 1;                           // 180: MAXC
    mc.c += 2;                                            // 17f,180
    for (;;) {
      mc.c += 1;                                          // 181: NCY 8
      if (carry) {
        [sigma, carry] = alu.add(tmpa, tmpb);             // 182: ADD tmpa
        tmpa = sigma;                                     // 183: F
        mc.c += 2;
      } else {
        mc.c += 1;                                        // jump
      }
      [sigma, carry] = alu.rcr(tmpa, carry);              // 184: RRCY tmpa
      tmpa = sigma;
      [sigma, carry] = alu.rcr(tmpc, carry);              // 185: RRCY tmpc
      tmpc = sigma;                                       // 186: NCZ 5
      mc.c += 3;                                          // 184,185,186
      if (counter === 0) break;
      counter--;
      mc.c += 1;                                          // jump back
    }
    mc.c += 2;                                            // 187,RTN
    return [tmpa, tmpc];
  }

  // IMULCOF/MULCOF flag epilogues.
  function imulcof(cpu, alu, mc, tmpa, tmpc) {
    const carry = (tmpc & alu.sign) !== 0;                // 1cd: LRCY tmpc
    const [sigma, , , aux] = alu.add(tmpa, 0, carry ? 1 : 0); // 1ce: ADC at operand width
    cpu.setF(AF, aux === 1);
    cpu.szp(alu.bits === 16, sigma);                      // SZP at operand width (SST-verified)
    mc.c += 3;                                            // 1cd,1ce,1cf
    if (sigma === 0) {
      cpu.setF(CF, false); cpu.setF(OF, false);           // 1cc: CCOF
      mc.c += 4;                                          // 1d0,jmp,1cc,jmp
    } else {
      cpu.setF(CF, true); cpu.setF(OF, true);             // 1d1: SCOF
      mc.c += 3;                                          // 1d0,1d1,jmp
    }
  }
  function mulcof(cpu, mc, tmpa) {
    mc.c += 3;                                            // 1d2,1d3,jmp
    if (tmpa === 0) {
      cpu.setF(CF, false); cpu.setF(OF, false);
      mc.c += 4;
    } else {
      cpu.setF(CF, true); cpu.setF(OF, true);
      mc.c += 3;
    }
  }

  // ---- public entry points -------------------------------------------------
  // Multiply: returns {hi, lo, cycles}. acc = AL (8) or AX (16).
  P.mcMul = function (bits, acc, operand, signed, negate) {
    const alu = ALU[bits], mc = { c: 0 };
    let tmpc = acc & alu.mask;                            // 150/158: A->tmpc
    let carry = (tmpc & alu.sign) !== 0 ? 1 : 0;          // LRCY tmpc
    let tmpb = operand & alu.mask;                        // 151/159: M->tmpb
    let tmpa;
    mc.c += 2;
    if (signed) {                                         // PREIMUL
      const [negC] = neg16(tmpc);                         // 1c0: NEG tmpc
      mc.c += 3;                                          // jmp,1c0,1c1
      if (carry) {
        tmpc = negC & alu.mask;
        negate = !negate;                                 // 1c2: CF1
        mc.c += 3;                                        // 1c2,1c3,jmp
      } else mc.c += 1;
      const r = corNegate(this, alu, mc, 0, tmpb, tmpc, negate, true);
      tmpb = r[1] & alu.mask; tmpc = r[2] & alu.mask; carry = r[3]; negate = r[4];
    }
    mc.c += 2;                                            // 152/15a, jmp
    [tmpa, tmpc] = corx(this, alu, mc, tmpb, tmpc, carry);
    mc.c += 1;                                            // 153/15b: F1 NEGATE
    if (negate) {
      mc.c += 1;
      const r = corNegate(this, alu, mc, tmpa, tmpb, tmpc, negate, false);
      tmpa = r[0] & alu.mask; tmpc = r[2] & alu.mask;
    }
    mc.c += 1;                                            // 154/15c: X0 IMULCOF
    if (signed) {
      mc.c += 1;
      imulcof(this, alu, mc, tmpa, tmpc);
      mc.c += 2;                                          // 155/15d,jmp
    } else {
      mc.c += 3;                                          // 155,156,jmp
      mulcof(this, mc, tmpa);
    }
    return { hi: tmpa & alu.mask, lo: tmpc & alu.mask, cycles: mc.c };
  };

  // Divide: returns {ok, q, r, cycles}. dividend is 16 (byte op) or 32 bits.
  P.mcDiv = function (bits, dividendHi, dividendLo, divisor, signed, negate) {
    const alu = ALU[bits], mc = { c: 0 };
    let tmpa = dividendHi & alu.mask;                     // 160/168
    let tmpc = dividendLo & alu.mask;                     // 161/169
    let tmpb = divisor & alu.mask;                        // 162/16a
    mc.c += 3;
    if (signed) {
      mc.c += 1;
      [tmpa, tmpb, tmpc, negate] = preIdiv(this, alu, mc, tmpa, tmpb, tmpc, negate);
      tmpa &= alu.mask; tmpb &= alu.mask; tmpc &= alu.mask;
    }
    mc.c += 2;                                            // 163/16b, jmp
    const res = cord(this, alu, mc, tmpa, tmpb, tmpc);
    if (!res) return { ok: false, cycles: mc.c };
    let carry;
    [tmpc, tmpa, carry] = res;
    let quotient = (~tmpc) & 0xFFFF;                      // 164/16c: COM1 tmpc
    tmpb = dividendHi & alu.mask;                         // 165/16d: X->tmpb (dividend sign)
    mc.c += 2;
    if (signed) {
      mc.c += 1;
      const p = postIdiv(this, alu, mc, tmpa, tmpb, tmpc, carry === 1, negate);
      if (!p) return { ok: false, cycles: mc.c };
      tmpa = p[0]; quotient = p[1];
    }
    mc.c += 2;                                            // 166/16e + 167/16f writebacks
    return { ok: true, q: quotient & alu.mask, r: tmpa & alu.mask, cycles: mc.c };
  };

  // AAM: CORD with tmpa=0, tmpb=imm, tmpc=AL. AH=quotient, AL=remainder.
  P.mcAam = function (imm) {
    const alu = ALU[8], mc = { c: 6 };
    const res = cord(this, alu, mc, 0, imm & 0xFF, this.g8(0));
    if (!res) return { ok: false, cycles: mc.c };
    const [tmpc, tmpa] = res;
    const q = (~tmpc) & 0xFF, r = tmpa & 0xFF;
    this.s8(4, q);                                        // AH = quotient
    this.s8(0, r);                                        // AL = remainder
    this.szp(false, r);
    return { ok: true, cycles: mc.c };
  };
})(globalThis.K8086 ??= {});
