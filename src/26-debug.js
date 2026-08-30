"use strict";
(function (K) {
  // Source-level debugger engine. UI-free (node-testable): breakpoints by
  // IP (source lines) and by physical address (disassembly view), memory and
  // IO watchpoints, watch-expression evaluator, per-instruction trace ring
  // with cycle costs, and call-stack tracking. The CPU wrapper calls
  // K.Debug.retire() at every instruction boundary in every tier (pin-level,
  // fastmode, turbo bursts), and the core calls the dbgAccess hook on every
  // data bus access — so nothing escapes, at any speed.

  const CS = 1, SPr = 4;
  const FLAG_BITS = { CF: 1, PF: 4, AF: 16, ZF: 64, SF: 128, TF: 256, IF: 512, DF: 1024, OF: 2048 };
  const R16 = { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 };
  const R8 = { AL: [0, 0], CL: [1, 0], DL: [2, 0], BL: [3, 0], AH: [0, 1], CH: [1, 1], DH: [2, 1], BH: [3, 1] };
  const SREG = { ES: 0, CS: 1, SS: 2, DS: 3 };

  const TRACE_FIELDS = 14;                    // r0-7, s0-3, ip, fl

  function mkTrace(cap) {
    return {
      cap, n: 0, head: 0,
      addr: new Uint32Array(cap), t: new Float64Array(cap), cyc: new Uint32Array(cap),
      op: new Uint8Array(cap), vec: new Int16Array(cap), chipIdx: new Uint8Array(cap),
      regs: new Uint16Array(cap * TRACE_FIELDS),
    };
  }

  K.Debug = {
    create(opts = {}) {
      return {
        bpIp: new Map(),                      // ip16 -> {cond, line, hitLimit, hits, enabled, temp}
        bpAddr: new Map(),                    // physical addr -> same
        wps: [],                              // {from, to, mode:"r"/"w"/"rw", enabled}
        ioWps: [],                            // same, port space
        watches: [],                          // expression strings (UI evaluates)
        trace: mkTrace(opts.traceCap || 4096),
        chips: [],                            // comp ids, index = trace chipIdx
        symbols: {},                          // from the assembler, for conditions
        pending: null,                        // watchpoint tripped mid-instruction
        hit: null,                            // why we stopped (for the UI)
        until: null,                          // predicate(sim, chip, arch) -> stop
      };
    },

    attach(sim, dbg) {
      sim.dbg = dbg;
      sim.dbgStop = false;
      for (const c of sim.chips) if (c.def.isCpu) { c.runtime.dbgPrev = null; c.runtime.dbgStack = []; }
    },
    detach(sim) {
      sim.dbg = null;
      sim.dbgStop = false;
      for (const c of sim.chips) if (c.def.isCpu && c.runtime.core) c.runtime.core.dbgAccess = null;
    },

    // the per-core bus-access hook: watchpoints see EVERY data read/write
    mkAccess(sim, chip) {
      return (sp, kind, addr, word, val) => {
        const dbg = sim.dbg;
        if (!dbg || dbg.pending) return;
        const list = sp === "m" ? dbg.wps : dbg.ioWps;
        for (const wp of list) {
          if (wp.enabled === false) continue;
          if (wp.mode !== "rw" && wp.mode !== kind) continue;
          if (addr + (word ? 1 : 0) < wp.from || addr > wp.to) continue;
          dbg.pending = {
            kind: sp === "m" ? "memwatch" : "iowatch",
            mode: kind, addr, val: val === undefined ? null : val, wp,
            chipId: chip.comp.id,
          };
          return;
        }
      };
    },

    // called by the CPU wrapper at every instruction boundary
    retire(sim, chip, core) {
      const dbg = sim.dbg;
      const arch = core.boundary;             // exact state AT the boundary
      const rt = chip.runtime;
      let ci = dbg.chips.indexOf(chip.comp.id);
      if (ci < 0) { ci = dbg.chips.length; dbg.chips.push(chip.comp.id); }

      // ---- interrupt frames (soft INT and hardware INTR/NMI/trap alike) ----
      const stack = rt.dbgStack ??= [];
      let vec = -1;
      if (core.tookInts && core.tookInts.length) {
        for (const v of core.tookInts) {
          vec = v;
          if (stack.length < 256) stack.push({ kind: "int", vec: v, sp: arch.r[SPr] });
        }
        core.tookInts.length = 0;
      }

      // ---- trace: record the just-retired instruction ----
      const prev = rt.dbgPrev;
      if (prev) {
        const tr = dbg.trace;
        const slot = tr.head;
        tr.addr[slot] = prev.addr;
        tr.t[slot] = sim.t;
        tr.cyc[slot] = Math.max(0, arch.cycleCount - prev.cyc);
        tr.op[slot] = core.lastOp | 0;
        tr.vec[slot] = vec;
        tr.chipIdx[slot] = ci;
        const base = slot * TRACE_FIELDS;
        for (let i = 0; i < 8; i++) tr.regs[base + i] = arch.r[i];
        for (let i = 0; i < 4; i++) tr.regs[base + 8 + i] = arch.s[i];
        tr.regs[base + 12] = arch.ip;
        tr.regs[base + 13] = arch.fl;
        tr.head = (slot + 1) % tr.cap;
        if (tr.n < tr.cap) tr.n++;
      }

      // ---- call stack from the retired opcode ----
      if (prev) {
        const op = core.lastOp;
        if (op === 0xE8 || op === 0x9A || (op === 0xFF && (core.regF === 2 || core.regF === 3))) {
          if (stack.length < 256)
            stack.push({ kind: "call", fromAddr: prev.addr, to: { cs: arch.s[CS], ip: arch.ip }, sp: arch.r[SPr] });
        } else if (op === 0xC3 || op === 0xC2 || op === 0xCB || op === 0xCA) {
          for (let i = stack.length - 1; i >= 0; i--)
            if (stack[i].kind === "call") { stack.splice(i); break; }
        } else if (op === 0xCF) {
          for (let i = stack.length - 1; i >= 0; i--)
            if (stack[i].kind === "int") { stack.splice(i); break; }
        }
      }

      const nextAddr = ((arch.s[CS] << 4) + arch.ip) & 0xFFFFF;
      rt.dbgPrev = { addr: nextAddr, cyc: arch.cycleCount };

      // ---- a watchpoint tripped inside this instruction: stop now ----
      if (dbg.pending) {
        dbg.hit = dbg.pending;
        dbg.pending = null;
        sim.dbgStop = true;
        return;
      }

      // ---- breakpoint on the instruction ABOUT to execute ----
      const bp = dbg.bpAddr.get(nextAddr) || dbg.bpIp.get(arch.ip & 0xFFFF);
      if (bp && bp.enabled !== false) {
        let pass = true;
        if (bp.cond) {
          try { pass = !!K.Debug.evalExpr(bp.cond, K.Debug.ctxFor(sim, chip, arch)); }
          catch { pass = true; }              // unevaluable condition: fail open, stop
        }
        if (pass) {
          bp.hits = (bp.hits || 0) + 1;
          if (!bp.hitLimit || bp.hits >= bp.hitLimit) {
            if (bp.temp) { dbg.bpAddr.delete(nextAddr); dbg.bpIp.delete(arch.ip & 0xFFFF); }
            dbg.hit = { kind: "bp", addr: nextAddr, ip: arch.ip & 0xFFFF, line: bp.line, chipId: chip.comp.id, temp: !!bp.temp };
            sim.dbgStop = true;
            return;
          }
        }
      }

      // ---- run-until predicate (step out, run-to-return) ----
      if (dbg.until && dbg.until(sim, chip, arch)) {
        dbg.until = null;
        dbg.hit = { kind: "until", addr: nextAddr, chipId: chip.comp.id };
        sim.dbgStop = true;
      }
    },

    // trace access: i = 0 oldest .. n-1 newest
    traceEntry(dbg, i) {
      const tr = dbg.trace;
      const slot = (tr.head - tr.n + i + 2 * tr.cap) % tr.cap;
      const base = slot * TRACE_FIELDS;
      return {
        addr: tr.addr[slot], t: tr.t[slot], cyc: tr.cyc[slot], op: tr.op[slot],
        vec: tr.vec[slot], chipId: dbg.chips[tr.chipIdx[slot]],
        r: Array.from(tr.regs.subarray(base, base + 8)),
        s: Array.from(tr.regs.subarray(base + 8, base + 12)),
        ip: tr.regs[base + 12], fl: tr.regs[base + 13],
      };
    },

    // rewind support: drop future entries and rebuild call stacks from history
    onSeek(sim) {
      const dbg = sim.dbg;
      if (!dbg) return;
      const tr = dbg.trace;
      while (tr.n > 0) {
        const newestSlot = (tr.head - 1 + tr.cap) % tr.cap;
        if (tr.t[newestSlot] <= sim.t) break;
        tr.head = newestSlot;
        tr.n--;
      }
      dbg.pending = null;
      for (const chip of sim.chips) {
        if (!chip.def.isCpu) continue;
        chip.runtime.dbgPrev = null;          // re-syncs on the next boundary
        const stack = [];
        for (let i = 0; i < tr.n; i++) {      // replay flow ops from the surviving trace
          const e = K.Debug.traceEntry(dbg, i);
          if (e.chipId !== chip.comp.id) continue;
          if (e.vec >= 0 && stack.length < 256) stack.push({ kind: "int", vec: e.vec, sp: e.r[SPr] });
          const op = e.op;
          if (op === 0xE8 || op === 0x9A) { if (stack.length < 256) stack.push({ kind: "call", fromAddr: e.addr, to: { cs: e.s[CS], ip: e.ip }, sp: e.r[SPr] }); }
          else if (op === 0xC3 || op === 0xC2 || op === 0xCB || op === 0xCA) {
            for (let j = stack.length - 1; j >= 0; j--) if (stack[j].kind === "call") { stack.splice(j); break; }
          } else if (op === 0xCF) {
            for (let j = stack.length - 1; j >= 0; j--) if (stack[j].kind === "int") { stack.splice(j); break; }
          }
        }
        chip.runtime.dbgStack = stack;
      }
    },

    // every physical address where a chip-local byte answers (all mirrors) —
    // how a source line's assembled byte becomes exact breakpoint addresses
    physOf(cpuMap, compId, local) {
      const out = [];
      const lanes = cpuMap.lanes || 1;
      cpuMap.chunks.forEach((c, idx) => {
        if (!c) return;
        for (let lane = 0; lane < lanes; lane++) {
          const l = c[lane];
          if (!l || l.comp.id !== compId) continue;
          const size = K.chips[l.comp.type].probe.size;
          const span = cpuMap.chunk / lanes;
          const delta = (local - l.local + size) & (size - 1);
          if (delta < span) out.push(idx * cpuMap.chunk + delta * lanes + lane);
        }
      });
      return out;
    },

    // ---- memory + disassembly helpers ---------------------------------------
    readMem(sim, cpuCompId, addr) {
      try { return sim.fastRead(cpuCompId, addr & 0xFFFFF); } catch { return 0xFF; }
    },
    disasmAt(sim, cpuCompId, addr, count) {
      const out = [];
      let a = addr & 0xFFFFF;
      for (let i = 0; i < count; i++) {
        const bytes = new Uint8Array(8);
        for (let j = 0; j < 8; j++) bytes[j] = K.Debug.readMem(sim, cpuCompId, a + j);
        let d;
        try { d = K.disasm(bytes, 0, a & 0xFFFF); } catch { d = null; }
        if (!d || !d.len) d = { text: "db " + K.hex(bytes[0], 2) + "h", len: 1 };
        out.push({ addr: a, text: d.text, len: d.len, bytes: Array.from(bytes.slice(0, d.len)) });
        a = (a + d.len) & 0xFFFFF;
      }
      return out;
    },

    // ---- watch/condition expression evaluator -------------------------------
    // regs (AX, AL…), sregs, IP, FLAGS, flag bits (ZF…), symbols, numbers
    // (123, 0x1F, 1Fh, 0b101), derefs b[expr] / w[expr] / [expr] (word), with
    // seg:off inside brackets; operators: + - * / % & | ^ << >> comparisons
    // == != < <= > >= and && || ! ~ and parentheses.
    ctxFor(sim, chip, arch) {
      return {
        r: arch.r, s: arch.s, ip: arch.ip, fl: arch.fl,
        symbols: (sim.dbg && sim.dbg.symbols) || {},
        readMem: (addr) => K.Debug.readMem(sim, chip.comp.id, addr),
      };
    },
    evalExpr(str, ctx) {
      let i = 0;
      const s = String(str);
      const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
      const err = (m) => { throw new Error(m + " at " + i); };
      const ident = () => {
        const m = /^[A-Za-z_.$@?][\w.$@?]*/.exec(s.slice(i));
        if (!m) return null;
        i += m[0].length;
        return m[0];
      };
      const deref = (word) => {
        ws();
        if (s[i] !== "[") err("expected [");
        i++;
        let a = expr();
        ws();
        if (s[i] === ":") { i++; const off = expr(); a = ((a << 4) + (off & 0xFFFF)) & 0xFFFFF; ws(); }
        if (s[i] !== "]") err("expected ]");
        i++;
        const lo = ctx.readMem(a) ?? 0xFF;
        return word ? (lo | ((ctx.readMem(a + 1) ?? 0xFF) << 8)) : lo;
      };
      const atom = () => {
        ws();
        if (s[i] === "(") { i++; const v = expr(); ws(); if (s[i] !== ")") err("missing )"); i++; return v; }
        if (s[i] === "[") return deref(true);
        if (s[i] === "-") { i++; return -atom(); }
        if (s[i] === "~") { i++; return ~atom(); }
        if (s[i] === "!") { i++; return atom() ? 0 : 1; }
        const numM = /^(?:0x[0-9A-Fa-f]+|0b[01]+|[0-9][0-9A-Fa-f]*[Hh]|\d+)/.exec(s.slice(i));
        if (numM) {
          const tok = numM[0];
          i += tok.length;
          if (/[Hh]$/.test(tok) && !/^0x/.test(tok)) return parseInt(tok.slice(0, -1), 16);
          if (/^0b/i.test(tok)) return parseInt(tok.slice(2), 2);
          return tok.startsWith("0x") ? parseInt(tok, 16) : parseInt(tok, 10);
        }
        const save = i;
        const id = ident();
        if (!id) err("unexpected '" + s[i] + "'");
        const up = id.toUpperCase();
        if ((up === "B" || up === "W") && s[i] === "[") return deref(up === "W");
        if (up in R16) return ctx.r[R16[up]];
        if (up in R8) { const [ri, hi] = R8[up]; return hi ? (ctx.r[ri] >> 8) & 0xFF : ctx.r[ri] & 0xFF; }
        if (up in SREG) return ctx.s[SREG[up]];
        if (up === "IP") return ctx.ip;
        if (up === "FLAGS" || up === "FL") return ctx.fl;
        if (up in FLAG_BITS) return (ctx.fl & FLAG_BITS[up]) ? 1 : 0;
        if (id in ctx.symbols) return ctx.symbols[id];
        if (up in ctx.symbols) return ctx.symbols[up];
        const lo = Object.keys(ctx.symbols).find(k => k.toLowerCase() === id.toLowerCase());
        if (lo !== undefined) return ctx.symbols[lo];
        i = save;
        err("unknown name '" + id + "'");
      };
      const bin = (next, ops) => () => {
        let v = next();
        for (;;) {
          ws();
          const op = ops.find(o => s.startsWith(o[0], i));
          if (!op) return v;
          i += op[0].length;
          v = op[1](v, next());
        }
      };
      const mul = bin(atom, [["*", (a, b) => a * b], ["/", (a, b) => Math.trunc(a / b)], ["%", (a, b) => a % b]]);
      const add = bin(mul, [["+", (a, b) => a + b], ["-", (a, b) => a - b]]);
      const shf = bin(add, [["<<", (a, b) => a << b], [">>", (a, b) => a >>> b]]);
      const cmp = bin(shf, [["<=", (a, b) => (a <= b ? 1 : 0)], [">=", (a, b) => (a >= b ? 1 : 0)],
        ["<", (a, b) => (a < b ? 1 : 0)], [">", (a, b) => (a > b ? 1 : 0)]]);
      const eqx = bin(cmp, [["==", (a, b) => (a === b ? 1 : 0)], ["!=", (a, b) => (a !== b ? 1 : 0)]]);
      const band = () => { let v = eqx(); for (;;) { ws(); if (s[i] === "&" && s[i + 1] !== "&") { i++; v &= eqx(); } else return v; } };
      const bxor = () => { let v = band(); for (;;) { ws(); if (s[i] === "^") { i++; v ^= band(); } else return v; } };
      const bor = () => { let v = bxor(); for (;;) { ws(); if (s[i] === "|" && s[i + 1] !== "|") { i++; v |= bxor(); } else return v; } };
      const land = () => { let v = bor(); for (;;) { ws(); if (s[i] === "&" && s[i + 1] === "&") { i += 2; const b = bor(); v = v && b ? 1 : 0; } else return v; } };
      const expr = () => { let v = land(); for (;;) { ws(); if (s[i] === "|" && s[i + 1] === "|") { i += 2; const b = land(); v = v || b ? 1 : 0; } else return v; } };
      const v = expr();
      ws();
      if (i < s.length) err("trailing '" + s.slice(i) + "'");
      return v;
    },

    // ---- persistence --------------------------------------------------------
    serialize(dbg) {
      const bp = (m) => [...m.entries()].filter(([, b]) => !b.temp)
        .map(([k, b]) => [k, { cond: b.cond || null, line: b.line ?? null, hitLimit: b.hitLimit || 0, enabled: b.enabled !== false }]);
      return { bpIp: bp(dbg.bpIp), bpAddr: bp(dbg.bpAddr), wps: dbg.wps, ioWps: dbg.ioWps, watches: dbg.watches };
    },
    deserialize(data) {
      const dbg = K.Debug.create();
      if (!data) return dbg;
      for (const [k, b] of data.bpIp || []) dbg.bpIp.set(+k, { ...b, hits: 0 });
      for (const [k, b] of data.bpAddr || []) dbg.bpAddr.set(+k, { ...b, hits: 0 });
      dbg.wps = (data.wps || []).map(w => ({ ...w }));
      dbg.ioWps = (data.ioWps || []).map(w => ({ ...w }));
      dbg.watches = (data.watches || []).slice();
      return dbg;
    },
  };
})(globalThis.K8086 ??= {});
