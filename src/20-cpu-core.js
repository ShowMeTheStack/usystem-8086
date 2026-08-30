"use strict";
(function (K) {
  // Cycle-stepped 8086/8088 core, shared by the pin-level chip wrapper (Tier A)
  // and the future fast run mode (Tier B).
  //
  // The Execution Unit is a generator that yields micro-ops:
  //   <number>                          consume n internal EU cycles
  //   {op:'f'}                          next instruction byte from the prefetch queue
  //   {op:'r'|'w', sp:'m'|'i', addr, word, val}   one bus cycle (BIU runs T1..T4[+Tw])
  //   {op:'inta'}                       interrupt-acknowledge bus cycle (returns data)
  // The Bus Interface Unit owns the queue (4 bytes on 8088, 6 on 8086), prefetches
  // when the bus is idle, and arbitrates EU requests ahead of prefetch.
  // Timing note: v0.1 uses approximate per-instruction internal cycle counts; exact
  // per-cycle behavior is ground-truthed against SingleStepTests/8088 in phase 2.

  // FLAGS bits
  const CF = 0x0001, PF = 0x0004, AF = 0x0010, ZF = 0x0040, SF = 0x0080,
        TF = 0x0100, IF = 0x0200, DF = 0x0400, OF = 0x0800;
  K.FLAG = { CF, PF, AF, ZF, SF, TF, IF, DF, OF };

  // Register indices
  const AX = 0, CX = 1, DX = 2, BX = 3, SP = 4, BP = 5, SI = 6, DI = 7;
  const ES = 0, CS = 1, SS = 2, DS = 3;
  K.REG = { AX, CX, DX, BX, SP, BP, SI, DI };
  K.SEGREG = { ES, CS, SS, DS };

  const PARITY = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let p = 1, v = i;
    while (v) { p ^= v & 1; v >>= 1; }
    PARITY[i] = p ? PF : 0;
  }

  K.Cpu86 = class Cpu86 {
    constructor(opts = {}) {
      this.is8086 = !!opts.is8086;          // false => 8088 (8-bit bus, 4-byte queue)
      this.qsize = this.is8086 ? 6 : 4;
      this.r = new Uint16Array(8);
      this.s = new Uint16Array(4);
      this.reset();
    }

    reset() {
      this.r.fill(0);
      this.s.fill(0);
      this.s[CS] = 0xFFFF;
      this.ip = 0;
      this.fl = 0xF002;
      this.queue = [];
      this.qop = 0;
      this.qFirst = true;
      this.fetchRestart = 0;                // BIU restart delay after full-queue read
      this.byteDebt = 0;                    // paced queue reads owed back to take()
      this.fetchIP = 0;                     // BIU's next prefetch offset
      this.bus = null;                      // active bus cycle
      this.euWait = 0;
      this.euResume = undefined;
      this.euBlocked = null;                // 'bus' | 'queue' | 'halt'
      this.lock = false;
      this.euReq = null;
      this.intrLine = false;
      this.nmiLatch = false;
      this.prevNmi = false;
      this.halted = false;
      this.retired = false;
      this.insnCount = 0;
      this.cycleCount = 0;
      this.segOv = null;
      this.rep = null;
      this.error = null;
      this.trapNext = false;
      this.overlapCredit = 0;               // fetch-stall cycles overlap EU microcode
      this.gen = this.run();                // first euTick() resumes from the top
    }

    // ---- pin-side inputs (set by wrapper each clock) ----
    setINTR(v) { this.intrLine = v; }
    setNMI(v) { if (v && !this.prevNmi) this.nmiLatch = true; this.prevNmi = v; }

    // ---- architectural snapshot (serializable; taken at instruction boundaries) ----
    saveArch() {
      return {
        r: Array.from(this.r), s: Array.from(this.s), ip: this.ip, fl: this.fl,
        queue: this.queue.slice(), fetchIP: this.fetchIP, halted: this.halted,
        insnCount: this.insnCount, cycleCount: this.cycleCount,
        intrLine: this.intrLine, nmiLatch: this.nmiLatch,
        trapNext: this.trapNext, intInhibit: !!this.intInhibit,
      };
    }
    loadArch(a) {
      this.reset();
      this.r.set(a.r); this.s.set(a.s); this.ip = a.ip; this.fl = a.fl;
      this.queue = a.queue.slice(); this.fetchIP = a.fetchIP; this.halted = a.halted;
      this.insnCount = a.insnCount; this.cycleCount = a.cycleCount;
      this.intrLine = a.intrLine; this.nmiLatch = a.nmiLatch;
      this.trapNext = !!a.trapNext; this.intInhibit = !!a.intInhibit;
    }

    // ---- one CPU clock (call on CLK rising edge) ----
    tick() {
      this.cycleCount++;
      this.qsPrev = this.qop;               // QS0/QS1 report last cycle's queue op
      this.qop = 0;                         // queue status this cycle: 0/-, 'F','S','E'
      this.biuTick();
      this.euTick();
      this.biuStart();
    }

    biuTick() {
      const b = this.bus;
      if (!b) return;
      if (b.t < 3) { b.t++; return; }
      if (b.t === 3 && !b.ready) { b.waits++; return; }   // Tw — wrapper re-samples READY
      if (b.t === 3) { b.t = 4; return; }
      // T4: complete the transfer
      if (b.kind === "code") {
        if (!b.abandon) {
          if (b.word) { this.queue.push(b.dataIn & 0xFF, (b.dataIn >> 8) & 0xFF); this.fetchIP = (this.fetchIP + 2) & 0xFFFF; }
          else { this.queue.push(b.dataIn & 0xFF); this.fetchIP = (this.fetchIP + 1) & 0xFFFF; }
        }
      } else {
        this.euResume = b.dataIn;
        this.euBlocked = null;
      }
      this.bus = null;
    }

    biuStart() {
      if (this.bus) return;
      if (this.euReq) {
        const q = this.euReq;
        this.euReq = null;
        this.bus = { kind: q.kind, sp: q.sp, addr: q.addr, word: q.word, dataOut: q.val, t: 1, ready: true, waits: 0, dataIn: 0 };
        return;
      }
      if (this.halted) return;
      if (this.fetchRestart > 0) { this.fetchRestart--; return; }  // 2-cycle restart
      const room = this.qsize - this.queue.length;
      if (room >= (this.is8086 ? 2 : 1)) {
        const addr = ((this.s[CS] << 4) + this.fetchIP) & 0xFFFFF;
        const word = this.is8086 && (addr & 1) === 0 && room >= 2;
        this.bus = { kind: "code", sp: "m", addr, word, t: 1, ready: true, waits: 0, dataIn: 0 };
      }
    }

    euTick() {
      if (this.euWait > 0) { this.euWait--; return; }
      if (this.euBlocked === "bus" || this.euBlocked === "halt") return;
      if (this.euBlocked === "queue") {
        if (!this.queue.length) { this.overlapCredit++; return; } // stall overlaps EU work
        this.euBlocked = null;
        if (this.queue.length === this.qsize && !this.bus && !this.euReq) this.fetchRestart = 2;
        this.euResume = this.queue.shift();
        this.ip = (this.ip + 1) & 0xFFFF;
        this.qop = this.qFirst ? "F" : "S";
        this.qFirst = false;
      }
      // Drive the generator until it needs time, bus, or queue bytes.
      for (let guard = 0; guard < 10000; guard++) {
        let y;
        try { y = this.gen.next(this.euResume); } catch (e) { this.error = String(e && e.message || e); this.halted = true; return; }
        this.euResume = undefined;
        if (y.done) { this.error = "EU generator ended"; this.halted = true; return; }
        const v = y.value;
        if (typeof v === "number") { if (v > 0) { this.euWait = v - 1; return; } continue; }
        if (v.op === "f") {
          if (this.queue.length) {
            if (this.queue.length === this.qsize && !this.bus && !this.euReq) this.fetchRestart = 2;
            this.euResume = this.queue.shift();
            this.ip = (this.ip + 1) & 0xFFFF;
            this.qop = this.qFirst ? "F" : "S";
            this.qFirst = false;
            // real Q reads cost one cycle each; the tuned per-op constants
            // already include that time, so each paced read builds a debt
            // that take() discounts — totals unchanged, stream correct
            this.byteDebt++;
            return;
          }
          this.euBlocked = "queue";
          return;
        }
        if (v.op === "r" || v.op === "w") {
          this.euReq = { kind: v.op, sp: v.sp, addr: v.addr, word: v.word, val: v.val };
          this.euBlocked = "bus";
          return;
        }
        if (v.op === "inta") {
          this.euReq = { kind: "inta", sp: "i", addr: 0, word: false };
          this.euBlocked = "bus";
          return;
        }
        if (v.op === "halt") { this.euBlocked = "halt"; this.halted = true; return; }
        this.error = "bad micro-op " + JSON.stringify(v);
        this.halted = true;
        return;
      }
      this.error = "EU runaway (no cycle consumed)";
      this.halted = true;
    }

    // Wake from HLT (wrapper calls when an enabled interrupt arrives).
    wake() { if (this.euBlocked === "halt") { this.euBlocked = null; this.halted = false; } }

    // ---- helpers used by the instruction generators ----
    lin(seg, ofs) { return ((this.s[seg] << 4) + (ofs & 0xFFFF)) & 0xFFFFF; }
    *fetchB() { return yield { op: "f" }; }
    *fetchW() { const l = yield { op: "f" }; const h = yield { op: "f" }; return l | (h << 8); }
    *fetchDisp8() { const b = yield { op: "f" }; return b < 0x80 ? b : b - 0x100; }

    *busRead(sp, seg, ofs, word) {
      const addr = sp === "m" ? this.lin(seg, ofs) : ofs & 0xFFFF;
      if (this.dbgAccess) this.dbgAccess(sp, "r", addr, word);
      if (!word) return yield { op: "r", sp, addr, word: false };
      if (this.is8086 && (addr & 1) === 0) return yield { op: "r", sp, addr, word: true };
      const lo = yield { op: "r", sp, addr, word: false };
      const addr2 = sp === "m" ? this.lin(seg, ofs + 1) : (ofs + 1) & 0xFFFF;
      const hi = yield { op: "r", sp, addr: addr2, word: false };
      return lo | (hi << 8);
    }
    *busWrite(sp, seg, ofs, word, val) {
      const addr = sp === "m" ? this.lin(seg, ofs) : ofs & 0xFFFF;
      if (this.dbgAccess) this.dbgAccess(sp, "w", addr, word, val);
      if (!word) { yield { op: "w", sp, addr, word: false, val: val & 0xFF }; return; }
      if (this.is8086 && (addr & 1) === 0) { yield { op: "w", sp, addr, word: true, val: val & 0xFFFF }; return; }
      yield { op: "w", sp, addr, word: false, val: val & 0xFF };
      const addr2 = sp === "m" ? this.lin(seg, ofs + 1) : (ofs + 1) & 0xFFFF;
      yield { op: "w", sp, addr: addr2, word: false, val: (val >> 8) & 0xFF };
    }
    *readMem(seg, ofs, word) { return yield* this.busRead("m", seg, ofs, word); }
    *writeMem(seg, ofs, word, val) { yield* this.busWrite("m", seg, ofs, word, val); }
    *readLin(addr, word) {
      addr &= 0xFFFFF;
      if (this.dbgAccess) this.dbgAccess("m", "r", addr, word);
      if (!word) return yield { op: "r", sp: "m", addr, word: false };
      if (this.is8086 && (addr & 1) === 0) return yield { op: "r", sp: "m", addr, word: true };
      const lo = yield { op: "r", sp: "m", addr, word: false };
      const hi = yield { op: "r", sp: "m", addr: (addr + 1) & 0xFFFFF, word: false };
      return lo | (hi << 8);
    }

    flushQueue(newIP) {
      this.queue.length = 0;
      this.qop = "E";                       // queue-status lines report the flush
      this.ip = newIP & 0xFFFF;
      this.fetchIP = newIP & 0xFFFF;
      if (this.bus && this.bus.kind === "code") this.bus.abandon = true; // completes, result dropped
    }

    // ---- 8-bit register access (AL CL DL BL AH CH DH BH) ----
    g8(i) { return i < 4 ? this.r[i] & 0xFF : (this.r[i & 3] >> 8) & 0xFF; }
    s8(i, v) {
      v &= 0xFF;
      if (i < 4) this.r[i] = (this.r[i] & 0xFF00) | v;
      else this.r[i & 3] = (this.r[i & 3] & 0x00FF) | (v << 8);
    }
    gRM(w, i) { return w ? this.r[i] : this.g8(i); }
    sRM(w, i, v) { if (w) this.r[i] = v & 0xFFFF; else this.s8(i, v); }

    // ---- flags ----
    setF(mask, on) { if (on) this.fl |= mask; else this.fl &= ~mask; }
    szp(w, res) {
      const mask = w ? 0xFFFF : 0xFF, sign = w ? 0x8000 : 0x80;
      res &= mask;
      this.setF(ZF, res === 0);
      this.setF(SF, (res & sign) !== 0);
      this.fl = (this.fl & ~PF) | PARITY[res & 0xFF];
      return res;
    }
    aluAdd(w, a, b, c) {
      const mask = w ? 0xFFFF : 0xFF, sign = w ? 0x8000 : 0x80;
      const full = (a & mask) + (b & mask) + c;
      const res = full & mask;
      this.setF(CF, full > mask);
      this.setF(AF, ((a ^ b ^ res) & 0x10) !== 0);
      this.setF(OF, ((a ^ res) & (b ^ res) & sign) !== 0);
      return this.szp(w, res);
    }
    aluSub(w, a, b, c) {
      const mask = w ? 0xFFFF : 0xFF, sign = w ? 0x8000 : 0x80;
      const full = (a & mask) - (b & mask) - c;
      const res = full & mask;
      this.setF(CF, full < 0);
      this.setF(AF, ((a ^ b ^ res) & 0x10) !== 0);
      this.setF(OF, ((a ^ b) & (a ^ res) & sign) !== 0);
      return this.szp(w, res);
    }
    aluLogic(w, res) {
      this.setF(CF, false); this.setF(OF, false); this.setF(AF, false);
      return this.szp(w, res);
    }

    // ---- ModRM / effective address ----
    *modrm() {
      const b = yield* this.fetchB();
      this.mod = b >> 6; this.regF = (b >> 3) & 7; this.rm = b & 7;
      if (this.mod === 3) return;
      let ofs = 0, cyc = 0, seg = DS;
      if (this.mod === 0 && this.rm === 6) {
        ofs = yield* this.fetchW(); cyc = 6;
      } else {
        switch (this.rm) {
          case 0: ofs = this.r[BX] + this.r[SI]; cyc = 7; break;
          case 1: ofs = this.r[BX] + this.r[DI]; cyc = 8; break;
          case 2: ofs = this.r[BP] + this.r[SI]; cyc = 8; seg = SS; break;
          case 3: ofs = this.r[BP] + this.r[DI]; cyc = 7; seg = SS; break;
          case 4: ofs = this.r[SI]; cyc = 5; break;
          case 5: ofs = this.r[DI]; cyc = 5; break;
          case 6: ofs = this.r[BP]; cyc = 5; seg = SS; break;
          case 7: ofs = this.r[BX]; cyc = 5; break;
        }
        if (this.mod === 1 || this.mod === 2) {
          // real order: the base+index adds run BEFORE the displacement is
          // read from the queue; only the disp add remains afterwards
          yield* this.take(cyc);
          ofs += this.mod === 1 ? yield* this.fetchDisp8() : yield* this.fetchW();
          cyc = 4;
        }
      }
      if (this.segOv !== null) { seg = this.segOv; cyc += 2; }
      this.eaSeg = seg;
      this.eaOfs = ofs & 0xFFFF;
      yield* this.take(cyc);
    }
    // EU cycle charge. On real silicon the microcode runs WHILE the BIU fetches
    // instruction bytes; cycles this instruction already spent stalled on the
    // queue are credited against its EU time (SST empty-queue cases confirm).
    // for microcode-derived counts (CORX/CORD): authentic cycles, no byte debt
    *takeExact(n) {
      if (this.overlapCredit > 0) {
        const credit = Math.min(n, this.overlapCredit);
        this.overlapCredit -= credit;
        n -= credit;
      }
      if (n > 0) yield n;
    }
    *take(n) {
      if (this.byteDebt > 0) {
        const d = Math.min(n, this.byteDebt);
        this.byteDebt -= d;
        n -= d;
      }
      if (this.overlapCredit > 0) {
        const credit = Math.min(n, this.overlapCredit);
        this.overlapCredit -= credit;
        n -= credit;
      }
      if (n > 0) yield n;
    }
    *readRM(w) {
      if (this.mod === 3) return this.gRM(w, this.rm);
      return yield* this.readMem(this.eaSeg, this.eaOfs, w);
    }
    *writeRM(w, v) {
      if (this.mod === 3) this.sRM(w, this.rm, v);
      else yield* this.writeMem(this.eaSeg, this.eaOfs, w, v);
    }

    // ---- stack ----
    *push(v) {
      this.r[SP] = (this.r[SP] - 2) & 0xFFFF;
      yield* this.writeMem(SS, this.r[SP], true, v);
    }
    *pop() {
      const v = yield* this.readMem(SS, this.r[SP], true);
      this.r[SP] = (this.r[SP] + 2) & 0xFFFF;
      return v;
    }

    // ---- control transfer ----
    *jump(newIP) { this.flushQueue(newIP); yield* this.take(this.is8086 ? 4 : 4); }
    *jumpFar(newCS, newIP) { this.s[CS] = newCS & 0xFFFF; this.flushQueue(newIP); yield* this.take(6); }

    // ---- interrupts ----
    *interrupt(vector) {
      if (this.dbgAccess) (this.tookInts ??= []).push(vector & 0xFF);
      const base = (vector & 0xFF) * 4;
      const newIP = yield* this.readLin(base, true);
      const newCS = yield* this.readLin(base + 2, true);
      yield* this.push(this.fl | 0xF002);
      this.setF(IF, false); this.setF(TF, false);
      yield* this.push(this.s[CS]);
      yield* this.push(this.ip);
      this.s[CS] = newCS;
      this.flushQueue(newIP);
      yield* this.take(30); // INT microcode remainder after its 5 bus transfers (SST-tuned, re-fit under Q pacing)
    }
    *serviceINTR() {
      yield { op: "inta" };
      yield* this.take(2);
      const vector = yield { op: "inta" };
      yield* this.interrupt(vector & 0xFF);
    }

    // ---- main loop ----
    *run() {
      while (true) {
        if (this.intInhibit) {
          this.intInhibit = false;    // STI / MOV SS / POP SS shadow one instruction
        } else {
          if (this.trapNext) { this.trapNext = false; yield* this.interrupt(1); }
          if (this.nmiLatch) { this.nmiLatch = false; yield* this.interrupt(2); }
          else if (this.intrLine && (this.fl & IF)) { yield* this.serviceINTR(); }
        }
        this.trapNext = (this.fl & TF) !== 0;   // TF at insn start => INT 1 after it
        this.segOv = null;
        this.rep = null;
        this.qFirst = true;                     // next queue byte is an instruction's first
        this.lock = false;                      // ~LOCK pin state (F0 prefix / XCHG mem)
        this.overlapCredit = 0;                 // overlap does not span instructions
        this.byteDebt = 0;
        this.insnCS = this.s[CS];
        this.insnIP = this.ip;
        let op = yield* this.fetchB();
        // prefixes
        for (;;) {
          if (op === 0x26) this.segOv = ES;
          else if (op === 0x2E) this.segOv = CS;
          else if (op === 0x36) this.segOv = SS;
          else if (op === 0x3E) this.segOv = DS;
          else if (op === 0xF2) this.rep = "ne";
          else if (op === 0xF3) this.rep = "e";
          else if (op === 0xF0) { this.lock = true; }
          else break;
          yield 1;
          this.qFirst = true;   // a prefix re-runs first-byte decode: QS reports F again
          op = yield* this.fetchB();
        }
        const fn = this.ops[op];
        this.lastOp = op;                       // first post-prefix opcode, for the debugger
        if (fn) yield* fn.call(this, op);
        else yield* this.opUndefined(op);
        this.insnCount++;
        this.retired = true;
        // The EU may keep decoding into the next instruction within this same
        // clock tick; this snapshot is the true state AT the boundary.
        this.boundary = this.saveArch();
      }
    }
    *opUndefined(op) {
      // The 8086 has no #UD; unknown encodings mostly alias or act as NOPs.
      yield* this.take(3);
    }
  };
})(globalThis.K8086 ??= {});
