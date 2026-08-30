"use strict";
(function (K) {
  const { SIG } = K;
  const H = (io, n) => io.in(n) === SIG.H;
  const D = K.pinRange("D", 0, 7);

  // ------------------------------------------------------------- 8237A DMA ----
  // Register-complete model: full IO interface (channels, mode, mask, flip-flop,
  // status/TC) plus the XT page registers behind a second select (~CSP, ports
  // 80h-83h — port 80h doubles as the POST code scratch, so POST codes are
  // visible in this chip's programmer's view). Actual byte movement is provided
  // to peripherals via dmaWrite/dmaRead through the proved memory map — real
  // HOLD/HLDA bus mastering is a later refinement (HRQ/HLDA pins exist).
  K.defineChip({
    type: "8237A", name: "8237A DMA controller", category: "System", wide: true,
    dip: ["i:~CS", "i:~CSP", "i:~IOR", "i:~IOW", "i:RESET", "i:CLK", "i:HLDA", "o:HRQ",
          "o:AEN", "o:ADSTB", "i:A0", "i:A1", "i:A2", "i:A3",
          "io:D0", "io:D1", "io:D2", "io:D3", "g:GND", "io:D4", "io:D5", "io:D6", "io:D7",
          "i:DREQ0", "i:DREQ1", "i:DREQ2", "i:DREQ3",
          "o:~DACK0", "o:~DACK1", "o:~DACK2", "o:~DACK3", "p:VCC"],
    edgePins: ["~IOW", "~IOR", "RESET", "DREQ0"],
    noFloatWarn: true,
    init(state) {
      state.baseAddr = [0, 0, 0, 0];
      state.curAddr = [0, 0, 0, 0];
      state.baseCount = [0, 0, 0, 0];
      state.curCount = [0, 0, 0, 0];
      state.mode = [0, 0, 0, 0];
      state.mask = 0x0F;
      state.status = 0;
      state.command = 0;
      state.flipflop = 0;
      state.page = [0, 0, 0, 0];   // 80h POST scratch, 81h ch2, 82h ch3, 83h ch1
      state.moved = 0;
    },
    inspect(state) {
      const out = [
        { key: "POST code (port 80h)", kind: "num", get: () => state.page[0], set: (v) => { state.page[0] = v & 0xFF; } },
        { key: "mask", kind: "num", get: () => state.mask, set: (v) => { state.mask = v & 0xF; } },
        { key: "status/TC", kind: "num", get: () => state.status, set: (v) => { state.status = v & 0xFF; } },
        { key: "bytes moved", kind: "num", get: () => state.moved & 0xFFFF, set: () => {} },
      ];
      for (let c = 0; c < 4; c++) {
        out.push({ key: `ch${c}.addr`, kind: "num", get: () => state.curAddr[c], set: (v) => { state.curAddr[c] = v & 0xFFFF; } });
        out.push({ key: `ch${c}.count`, kind: "num", get: () => state.curCount[c], set: (v) => { state.curCount[c] = v & 0xFFFF; } });
      }
      return out;
    },
    _pageFor(state, ch) { return state.page[[0, 3, 1, 2][ch]] || 0; }, // ch2 -> 81h etc.
    // one byte of DMA service; dir: peripheral->memory (write) or memory->peripheral
    dmaWrite(chip, sim, ch, byte) { return this._xfer(chip, sim, ch, byte, true); },
    dmaRead(chip, sim, ch) { return this._xfer(chip, sim, ch, 0, false); },
    _xfer(chip, sim, ch, byte, isWrite) {
      const st = chip.state;
      if (st.mask & (1 << ch)) return null;              // channel masked
      const cpuId = sim.memMap && sim.memMap.cpus.length ? sim.memMap.cpus[0].compId : null;
      if (!cpuId) return null;
      const addr = ((this._pageFor(st, ch) << 16) | st.curAddr[ch]) & 0xFFFFF;
      let value = 0;
      if (isWrite) sim.fastWrite(cpuId, addr, byte);
      else value = sim.fastRead(cpuId, addr);
      st.curAddr[ch] = (st.curAddr[ch] + ((st.mode[ch] & 0x20) ? -1 : 1)) & 0xFFFF;
      st.curCount[ch] = (st.curCount[ch] - 1) & 0xFFFF;
      st.moved++;
      let tc = false;
      if (st.curCount[ch] === 0xFFFF) {                  // terminal count
        st.status |= 1 << ch;
        tc = true;
        if (st.mode[ch] & 0x10) {                        // autoinit
          st.curAddr[ch] = st.baseAddr[ch];
          st.curCount[ch] = st.baseCount[ch];
        } else st.mask |= 1 << ch;
      }
      return { tc, value };
    },
    evaluate(io, state) {
      io.out("HRQ", 0); io.out("AEN", 0); io.out("ADSTB", 0);
      for (let c = 0; c < 4; c++) io.out("~DACK" + c, 1);
      const a = (H(io, "A0") ? 1 : 0) | (H(io, "A1") ? 2 : 0) | (H(io, "A2") ? 4 : 0) | (H(io, "A3") ? 8 : 0);
      if (!H(io, "~CS") && !H(io, "~IOR") && H(io, "~IOW")) {
        if (a < 8) {
          const ch = a >> 1;
          const v = (a & 1) ? state.curCount[ch] : state.curAddr[ch];
          io.outBus(D, (state.flipflop ? v >> 8 : v) & 0xFF);
        } else if (a === 8) {
          io.outBus(D, state.status);                    // note: TC bits clear on read (edge below)
        } else io.outBus(D, 0);
        return;
      }
      if (!H(io, "~CSP") && !H(io, "~IOR") && H(io, "~IOW")) {
        io.outBus(D, state.page[a & 3]);
        return;
      }
      io.zBus(D);
    },
    onEdge(pin, rising, io, state) {
      if (pin === "RESET") { if (rising) this.init(state); return; }
      if (pin === "DREQ0") {
        // DRAM refresh: PIT ch1 pulses DREQ0; ch0 performs a dummy cycle
        if (!rising || (state.mask & 1)) return;
        state.curAddr[0] = (state.curAddr[0] + ((state.mode[0] & 0x20) ? -1 : 1)) & 0xFFFF;
        state.curCount[0] = (state.curCount[0] - 1) & 0xFFFF;
        if (state.curCount[0] === 0xFFFF) {
          state.status |= 1;
          if (state.mode[0] & 0x10) { state.curAddr[0] = state.baseAddr[0]; state.curCount[0] = state.baseCount[0]; }
          else state.mask |= 1;
        }
        return;
      }
      if (pin === "~IOR") {
        // completed reads toggle the byte flip-flop; status read clears TC bits
        if (!rising || H(io, "~CS")) return;
        const a = (H(io, "A0") ? 1 : 0) | (H(io, "A1") ? 2 : 0) | (H(io, "A2") ? 4 : 0) | (H(io, "A3") ? 8 : 0);
        if (a < 8) state.flipflop ^= 1;
        else if (a === 8) state.status &= 0xF0;
        return;
      }
      if (pin !== "~IOW" || !rising) return;
      const a = (H(io, "A0") ? 1 : 0) | (H(io, "A1") ? 2 : 0) | (H(io, "A2") ? 4 : 0) | (H(io, "A3") ? 8 : 0);
      const v = io.num(D);
      if (!H(io, "~CSP")) { state.page[a & 3] = v; return; }
      if (H(io, "~CS")) return;
      if (a < 8) {
        const ch = a >> 1;
        const isCount = a & 1;
        const tgtBase = isCount ? state.baseCount : state.baseAddr;
        const tgtCur = isCount ? state.curCount : state.curAddr;
        if (state.flipflop) { tgtBase[ch] = (tgtBase[ch] & 0xFF) | (v << 8); tgtCur[ch] = tgtBase[ch]; }
        else { tgtBase[ch] = (tgtBase[ch] & 0xFF00) | v; tgtCur[ch] = tgtBase[ch]; }
        state.flipflop ^= 1;
        return;
      }
      switch (a) {
        case 8: state.command = v; break;
        case 9: break;                                    // request reg (unused)
        case 0xA: {
          const ch = v & 3;
          if (v & 4) state.mask |= 1 << ch; else state.mask &= ~(1 << ch);
          break;
        }
        case 0xB: state.mode[v & 3] = v; break;
        case 0xC: state.flipflop = 0; break;
        case 0xD: this.init(state); break;                // master clear
        case 0xE: state.mask = 0; break;
        case 0xF: state.mask = v & 0xF; break;
      }
    },
  });

  // ----------------------------------------------------------- µPD765 FDC ----
  // Floppy disk controller card: self-decodes ports 3F0-3F7, executes the
  // command set GLaBIOS/DOS use (specify, recalibrate, seek, sense-int,
  // read/write data, read-id, sense-drive, format stub), transfers sectors
  // through the 8237's channel 2 (found via the DRQ net), raises INT (IRQ6).
  // The disk image lives OUTSIDE the snapshot state (like a real diskette,
  // writes are not undone by rewind).
  const CMD_LEN = { 0x03: 3, 0x04: 2, 0x05: 9, 0x06: 9, 0x07: 2, 0x08: 1, 0x0A: 2, 0x0D: 6, 0x0F: 3 };

  K.defineChip({
    type: "UPD765", name: "µPD765 floppy controller", category: "Storage", isFdc: true,
    pins: [
      ...K.pinRange("A", 0, 9).map((n, i) => ({ name: n, kind: "in", side: "L", slot: i })),
      { name: "~IOR", kind: "in", side: "L", slot: 11 },
      { name: "~IOW", kind: "in", side: "L", slot: 12 },
      { name: "RESET", kind: "in", side: "L", slot: 13 },
      ...D.map((n, i) => ({ name: n, kind: "io", side: "R", slot: i })),
      { name: "INT", kind: "out", side: "R", slot: 9 },
      { name: "DRQ", kind: "out", side: "R", slot: 10 },
    ],
    grid: { w: 12, h: 15 },
    edgePins: ["~IOW", "~IOR", "RESET"],
    noFloatWarn: true,
    init(state, props, chip) {
      state.dor = 0;
      state.msr = 0x80;            // RQM
      state.cmd = [];
      state.result = [];
      state.track = [0, 0, 0, 0];
      state.irq = 0;
      state.senseQueue = [];       // pending sense-interrupt results [st0, pcn]
      state.stats = { reads: 0, writes: 0, seeks: 0 };
      chip.runtime.disk = chip.runtime.disk || null;
    },
    inspect(state) {
      return [
        { key: "DOR", kind: "num", get: () => state.dor, set: (v) => { state.dor = v & 0xFF; } },
        { key: "MSR", kind: "num", get: () => state.msr, set: () => {} },
        { key: "track", kind: "num", get: () => state.track[0], set: (v) => { state.track[0] = v & 0xFF; } },
        { key: "sectors read", kind: "num", get: () => state.stats.reads, set: () => {} },
        { key: "sectors written", kind: "num", get: () => state.stats.writes, set: () => {} },
      ];
    },
    // geometry inferred from image size
    _geo(disk) {
      if (!disk) return null;
      const n = disk.length;
      if (n === 1474560) return { spt: 18, heads: 2, tracks: 80 };
      if (n === 1228800) return { spt: 15, heads: 2, tracks: 80 };
      if (n === 737280) return { spt: 9, heads: 2, tracks: 80 };
      if (n === 368640) return { spt: 9, heads: 2, tracks: 40 };
      if (n === 184320) return { spt: 9, heads: 1, tracks: 40 };
      return { spt: 18, heads: 2, tracks: 80 };
    },
    _dma(io, chip) {
      // find the 8237 through the DRQ net
      const sim = io.sim;
      if (chip.runtime.dmaChip !== undefined) return chip.runtime.dmaChip;
      let found = null;
      const net = sim.byPin.get(K.pinKey(chip.comp, "DRQ"));
      if (net) for (const p of net.pins) if (p.comp.type === "8237A") found = sim.chipFor(p.comp.id);
      chip.runtime.dmaChip = found;
      return found;
    },
    _port(io) { return io.num(K.pinRange("A", 0, 9)); },
    _finishIrq(io, state) {
      state.irq = 1;
      this.evaluate(io, state);
    },
    _exec(io, state, chip) {
      const cmd = state.cmd;
      const op = cmd[0] & 0x1F;
      const sim = io.sim;
      state.cmd = [];
      const disk = chip.runtime.disk;
      const geo = this._geo(disk);
      if (op === 0x03) { state.msr = 0x80; return; }                       // SPECIFY: no result, no irq
      if (op === 0x07) {                                                   // RECALIBRATE
        const drv = cmd[1] & 3;
        state.track[drv] = 0;
        state.stats.seeks++;
        state.senseQueue.push([0x20 | drv, 0]);
        state.msr = 0x80;
        this._finishIrq(io, state);
        return;
      }
      if (op === 0x0F) {                                                   // SEEK
        const drv = cmd[1] & 3;
        state.track[drv] = cmd[2];
        state.stats.seeks++;
        state.senseQueue.push([0x20 | drv, cmd[2]]);
        state.msr = 0x80;
        this._finishIrq(io, state);
        return;
      }
      if (op === 0x08) {                                                   // SENSE INTERRUPT
        const r = state.senseQueue.length ? state.senseQueue.shift() : null;
        state.result = r ? [r[0], r[1]] : [0x80];
        state.msr = 0xD0;          // RQM|DIO|CB
        state.irq = 0;             // reading sense clears the interrupt line
        this.evaluate(io, state);
        return;
      }
      if (op === 0x04) {                                                   // SENSE DRIVE STATUS
        const drv = cmd[1] & 3;
        state.result = [0x28 | (state.track[drv] === 0 ? 0x10 : 0) | drv]; // RDY|TS|T0
        state.msr = 0xD0;
        return;
      }
      if (op === 0x0A) {                                                   // READ ID
        const head = (cmd[1] >> 2) & 1, drv = cmd[1] & 3;
        state.result = [head << 2 | drv, 0, 0, state.track[drv], head, 1, 2];
        state.msr = 0xD0;
        this._finishIrq(io, state);
        return;
      }
      if (op === 0x06 || op === 0x05) {                                    // READ / WRITE DATA
        const isRead = op === 0x06;
        const drv = cmd[1] & 3;
        let c = cmd[2], hh = cmd[3], r = cmd[4];
        const eot = cmd[6];
        const dma = this._dma(io, chip);
        let st0 = (cmd[1] & 7), st1 = 0;
        if (!disk || !geo || !dma) {
          st0 |= 0x40; st1 = disk ? 0x80 : 0x02;                           // abnormal / no data
        } else {
          let done = false;
          let guard = 0;
          while (!done && guard++ < 40) {
            const lba = ((c * geo.heads + hh) * geo.spt) + (r - 1);
            const base = lba * 512;
            if (r < 1 || r > geo.spt || base + 512 > disk.length) { st0 |= 0x40; st1 |= 0x04; break; }
            for (let i = 0; i < 512; i++) {
              const res = isRead
                ? dma.def.dmaWrite(dma, sim, 2, disk[base + i])
                : dma.def.dmaRead(dma, sim, 2);
              if (res === null) { st0 |= 0x40; st1 |= 0x10; done = true; break; } // DMA masked: overrun
              if (!isRead) disk[base + i] = res.value & 0xFF;
              if (res.tc) { done = true; if (i < 511 && isRead) { /* partial: stop */ } }
            }
            if (isRead) state.stats.reads++; else state.stats.writes++;
            if (done) break;
            // advance to next sector (multi-sector until DMA TC)
            r++;
            if (r > eot || r > geo.spt) {
              r = 1;
              if (hh === 0 && geo.heads > 1 && (cmd[0] & 0x80)) hh = 1;    // MT: continue on side 1
              else { c++; hh = 0; done = true; st0 |= 0x40; st1 |= 0x80; } // end of cylinder
            }
          }
        }
        state.result = [st0, st1, 0, c, hh, r, cmd[8] ?? 2];
        state.msr = 0xD0;
        this._finishIrq(io, state);
        return;
      }
      if (op === 0x0D) {                                                   // FORMAT TRACK (accept, no-op on image)
        state.result = [cmd[1] & 7, 0, 0, state.track[cmd[1] & 3], (cmd[1] >> 2) & 1, 1, cmd[2]];
        state.msr = 0xD0;
        this._finishIrq(io, state);
        return;
      }
      // unknown command: invalid
      state.result = [0x80];
      state.msr = 0xD0;
    },
    evaluate(io, state) {
      io.out("INT", state.irq && (state.dor & 0x08) ? 1 : 0);   // gated by DOR bit3
      io.out("DRQ", 0);
      const port = this._port(io);
      if (!H(io, "~IOR") && port >= 0x3F0 && port <= 0x3F7) {
        if (port === 0x3F4) { io.outBus(D, state.msr); return; }
        if (port === 0x3F5) { io.outBus(D, state.result.length ? state.result[0] : 0xFF); return; }
        if (port === 0x3F7) { io.outBus(D, 0x00); return; }     // DSKCHG clear
        io.outBus(D, 0xFF);
        return;
      }
      io.zBus(D);
    },
    onEdge(pin, rising, io, state, props, chip) {
      if (pin === "RESET") { if (rising) this.init(state, props, chip); return; }
      const port = this._port(io);
      if (port < 0x3F0 || port > 0x3F7) return;
      if (pin === "~IOW" && rising) {
        const v = io.num(D);
        if (port === 0x3F2) {                                    // DOR
          const was = state.dor;
          state.dor = v;
          if (!(was & 0x04) && (v & 0x04)) {                     // leaving reset
            state.senseQueue = [[0xC0, 0], [0xC1, 0], [0xC2, 0], [0xC3, 0]];
            state.msr = 0x80;
            state.cmd = [];
            state.result = [];
            this._finishIrq(io, state);
          }
          if (!(v & 0x04)) { state.msr = 0; state.irq = 0; }
          this.evaluate(io, state);
          return;
        }
        if (port === 0x3F5) {
          if (state.result.length) return;                       // busy in result phase
          state.cmd.push(v);
          const need = CMD_LEN[state.cmd[0] & 0x1F] || 1;
          state.msr = 0x90;                                      // RQM|CB while collecting
          if (state.cmd.length >= need) this._exec(io, state, chip);
          else this.evaluate(io, state);
          return;
        }
        return;
      }
      if (pin === "~IOR" && rising && port === 0x3F5) {
        // byte consumed from result phase
        if (state.result.length) {
          state.result.shift();
          if (!state.result.length) { state.msr = 0x80; state.irq = 0; }
          this.evaluate(io, state);
        }
      }
    },
  });

  // Attach a floppy image (Uint8Array) to an FDC component in a running sim.
  K.fdcInsert = function (sim, compId, bytes) {
    const chip = sim.chipFor(compId);
    if (!chip) return false;
    chip.runtime.disk = bytes;
    return true;
  };
  K.fdcEject = function (sim, compId) {
    const chip = sim.chipFor(compId);
    if (chip) chip.runtime.disk = null;
  };
})(globalThis.K8086 ??= {});
