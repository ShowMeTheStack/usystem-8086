"use strict";
(function (K) {
  const { SIG } = K;
  const H = (io, n) => io.in(n) === SIG.H;
  const D = K.pinRange("D", 0, 7);

  // XT-IDE rev.1 interface card + fixed disk, as one module. 8-bit ISA port
  // window at 300h-30Fh: +0 data (low byte, high byte latched at +8), +1..+7
  // the IDE task file, +0Eh device control. Drives the XTIDE Universal BIOS
  // (option ROM) which hooks INT 13h and gives DOS a hard disk.
  // Geometry: 306 cylinders x 4 heads x 17 spt = 10.4 MB (ST-412 class).
  const GEO = { cyl: 306, heads: 4, spt: 17 };
  const CAP = GEO.cyl * GEO.heads * GEO.spt * 512;

  const ST_ERR = 0x01, ST_DRQ = 0x08, ST_DSC = 0x10, ST_DRDY = 0x40;

  function identify() {
    const w = new Uint16Array(256);
    w[0] = 0x0040;                        // fixed drive
    w[1] = GEO.cyl;
    w[3] = GEO.heads;
    w[6] = GEO.spt;
    const put = (start, len, s) => {
      s = s.padEnd(len * 2, " ");
      for (let i = 0; i < len; i++) w[start + i] = (s.charCodeAt(i * 2) << 8) | s.charCodeAt(i * 2 + 1);
    };
    put(10, 10, "USYS0001");              // serial
    put(23, 4, "1.0");                    // firmware
    put(27, 20, "uSYSTEM VIRTUAL ST-412");
    w[47] = 0;                            // no multiple
    w[49] = 0;                            // CHS only
    w[57] = (GEO.cyl * GEO.heads * GEO.spt) & 0xFFFF;
    w[58] = (GEO.cyl * GEO.heads * GEO.spt) >> 16;
    const out = new Uint8Array(512);
    for (let i = 0; i < 256; i++) { out[i * 2] = w[i] & 0xFF; out[i * 2 + 1] = w[i] >> 8; }
    return out;
  }

  K.defineChip({
    type: "XTIDE", name: "XT-IDE card + fixed disk", category: "Storage", isHdd: true,
    pins: [
      ...K.pinRange("A", 0, 9).map((n, i) => ({ name: n, kind: "in", side: "L", slot: i })),
      { name: "~IOR", kind: "in", side: "L", slot: 11 },
      { name: "~IOW", kind: "in", side: "L", slot: 12 },
      { name: "RESET", kind: "in", side: "L", slot: 13 },
      ...D.map((n, i) => ({ name: n, kind: "io", side: "R", slot: i })),
    ],
    grid: { w: 12, h: 15 },
    edgePins: ["~IOR", "~IOW", "RESET"],
    noFloatWarn: true,
    props: { autoBlank: true },
    init(state, props, chip) {
      state.feat = 0; state.sc = 1; state.sn = 1; state.cl = 0; state.ch = 0; state.dh = 0;
      state.status = ST_DRDY | ST_DSC;
      state.err = 0;
      state.hiLatch = 0;
      state.eightBit = false;
      state.bufPos = 0; state.bufLen = 0; state.bufDir = 0;   // 0 none, 1 host-read, 2 host-write
      state.pendWrite = null;
      state.stats = { reads: 0, writes: 0 };
      if (!chip.runtime.hdd && props.autoBlank) chip.runtime.hdd = new Uint8Array(CAP);
      chip.runtime.buf = chip.runtime.buf || new Uint8Array(0);
    },
    inspect(state) {
      return [
        { key: "status", kind: "num", get: () => state.status, set: () => {} },
        { key: "sectors read", kind: "num", get: () => state.stats.reads, set: () => {} },
        { key: "sectors written", kind: "num", get: () => state.stats.writes, set: () => {} },
        { key: "C/H/S regs", kind: "num", get: () => ((state.ch << 8 | state.cl) << 8) | state.sn, set: () => {} },
      ];
    },
    _port(io) { return io.num(K.pinRange("A", 0, 9)); },
    _lba(state) {
      const cyl = (state.ch << 8) | state.cl;
      const head = state.dh & 0x0F;
      return (cyl * GEO.heads + head) * GEO.spt + (state.sn - 1);
    },
    _exec(state, chip, cmd) {
      const slave = (state.dh & 0x10) !== 0;
      state.err = 0;
      state.status = ST_DRDY | ST_DSC;
      if (slave) { state.status = 0; return; }            // no slave device
      const disk = chip.runtime.hdd;
      const abort = () => { state.err = 0x04; state.status = ST_DRDY | ST_DSC | ST_ERR; };
      if (cmd === 0xEC) {                                  // IDENTIFY
        chip.runtime.buf = identify();
        state.bufPos = 0; state.bufLen = 512; state.bufDir = 1;
        state.status |= ST_DRQ;
        return;
      }
      if (cmd === 0xEF) {                                // SET FEATURES
        if (state.feat === 0x01) state.eightBit = true;   // enable 8-bit PIO
        else if (state.feat === 0x81) state.eightBit = false;
        return;
      }
      if ((cmd & 0xF0) === 0x10 || cmd === 0x91) return;  // recal / init params: ok
      if (cmd === 0x20 || cmd === 0x21) {                  // READ SECTORS
        if (!disk) return abort();
        const n = state.sc || 256;
        const lba = this._lba(state);
        if (lba < 0 || (lba + n) * 512 > disk.length) return abort();
        chip.runtime.buf = disk.slice(lba * 512, (lba + n) * 512);
        state.bufPos = 0; state.bufLen = n * 512; state.bufDir = 1;
        state.stats.reads += n;
        state.status |= ST_DRQ;
        return;
      }
      if (cmd === 0x30 || cmd === 0x31) {                  // WRITE SECTORS
        if (!disk) return abort();
        const n = state.sc || 256;
        const lba = this._lba(state);
        if (lba < 0 || (lba + n) * 512 > disk.length) return abort();
        chip.runtime.buf = new Uint8Array(n * 512);
        state.bufPos = 0; state.bufLen = n * 512; state.bufDir = 2;
        state.pendWrite = { lba, n };
        state.status |= ST_DRQ;
        return;
      }
      return abort();                                      // unsupported (SET MULTIPLE etc.)
    },
    // ide_xt.bin expects the A0<->A3 swapped ("rev 2"/chuck-mod) layout:
    //   even offsets 0,2,4,6,8,A,C,E = IDE regs 0-7 (data..status/command)
    //   offset 1 = data high-byte latch, offset 7 = device control/alt status
    _reg(r) { return (r & 1) ? (r === 1 ? "hi" : r === 7 ? "ctl" : "nc") : (r >> 1); },
    evaluate(io, state, props, chip) {
      const port = this._port(io);
      if ((port & 0x3F0) !== 0x300) { io.zBus(D); return; }
      if (!H(io, "~IOR")) {
        const m = this._reg(port & 0x0F);
        const slave = (state.dh & 0x10) !== 0;
        let v = 0xFF;
        if (m === 0) {
          if (state.bufDir === 1 && state.bufPos < state.bufLen) {
            v = chip.runtime.buf[state.bufPos];
            if (!state.eightBit) state.hiRead = chip.runtime.buf[state.bufPos + 1];
          } else v = 0;
        } else if (m === "hi") v = state.hiRead ?? 0;
        else if (m === 1) v = state.err;
        else if (m === 2) v = state.sc;
        else if (m === 3) v = state.sn;
        else if (m === 4) v = state.cl;
        else if (m === 5) v = state.ch;
        else if (m === 6) v = state.dh;
        else if (m === 7 || m === "ctl") v = slave ? 0 : state.status;
        io.outBus(D, v & 0xFF);
        return;
      }
      io.zBus(D);
    },
    onEdge(pin, rising, io, state, props, chip) {
      if (pin === "RESET") { if (rising) this.init(state, props, chip); return; }
      if (!rising) return;
      const port = this._port(io);
      if ((port & 0x3F0) !== 0x300) return;
      const m = this._reg(port & 0x0F);
      if (pin === "~IOR") {
        if (m === 0 && state.bufDir === 1 && state.bufPos < state.bufLen) {
          state.bufPos += state.eightBit ? 1 : 2;
          if (state.bufPos >= state.bufLen) { state.bufDir = 0; state.status &= ~ST_DRQ; }
        }
        return;
      }
      // ~IOW
      const v = io.num(D);
      if (m === "hi") { state.hiLatch = v; return; }
      if (m === 0) {
        if (state.bufDir === 2 && state.bufPos < state.bufLen) {
          if (state.eightBit) {
            chip.runtime.buf[state.bufPos] = v;
            state.bufPos += 1;
          } else {
            chip.runtime.buf[state.bufPos] = v;
            chip.runtime.buf[state.bufPos + 1] = state.hiLatch;
            state.bufPos += 2;
          }
          if (state.bufPos >= state.bufLen) {
            state.bufDir = 0;
            state.status &= ~ST_DRQ;
            const pw = state.pendWrite;
            if (pw && chip.runtime.hdd) {
              chip.runtime.hdd.set(chip.runtime.buf, pw.lba * 512);
              state.stats.writes += pw.n;
            }
            state.pendWrite = null;
          }
        }
        return;
      }
      if (m === 1) state.feat = v;
      else if (m === 2) state.sc = v;
      else if (m === 3) state.sn = v;
      else if (m === 4) state.cl = v;
      else if (m === 5) state.ch = v;
      else if (m === 6) state.dh = v;
      else if (m === 7) this._exec(state, chip, v);
      else if (m === "ctl") {
        if (v & 0x04) {                                    // soft reset: signature
          state.sc = 1; state.sn = 1; state.cl = 0; state.ch = 0;
          state.status = ST_DRDY | ST_DSC;
          state.err = 1;
          state.bufDir = 0;
        }
      }
    },
  });

  K.XTIDE_GEO = GEO;
  K.XTIDE_CAP = CAP;
})(globalThis.K8086 ??= {});
