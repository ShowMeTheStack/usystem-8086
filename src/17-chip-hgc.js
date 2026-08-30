"use strict";
(function (K) {
  const { SIG } = K;
  const H = (io, n) => io.in(n) === SIG.H;
  const D = K.pinRange("D", 0, 7);
  const A15 = K.pinRange("A", 0, 14);

  // Hercules-compatible monochrome video card, presented as one plug-in module:
  // 32K VRAM at B0000-B7FFF (page 0), 6845 CRTC at 3B4/3B5, mode 3B8, status 3BA,
  // config 3BF. Text 80x25 (9x14 cells) and 720x348 1bpp graphics. Sync counters
  // run at line rate (per-dot video is rendered by the monitor from VRAM, the way
  // a real monitor "renders" what the card scans out — the HSYNC/VSYNC pins are
  // real signals you can probe).
  const memSel = (io) =>
    H(io, "A19") && !H(io, "A18") && H(io, "A17") && H(io, "A16") && !H(io, "A15");
  const ioPort = (io) => io.num(K.pinRange("A", 0, 9));

  K.defineChip({
    type: "HGC", name: "Hercules video card", category: "Video", isVideo: true,
    pins: [
      ...K.pinRange("A", 0, 19).map((n, i) => ({ name: n, kind: "in", side: "L", slot: i })),
      ...D.map((n, i) => ({ name: n, kind: "io", side: "R", slot: i })),
      { name: "~MEMR", kind: "in", side: "R", slot: 9 },
      { name: "~MEMW", kind: "in", side: "R", slot: 10 },
      { name: "~IOR", kind: "in", side: "R", slot: 11 },
      { name: "~IOW", kind: "in", side: "R", slot: 12 },
      { name: "HSYNC", kind: "out", side: "R", slot: 14 },
      { name: "VSYNC", kind: "out", side: "R", slot: 15 },
      { name: "VIDEO", kind: "out", side: "R", slot: 16 },
    ],
    grid: { w: 13, h: 21 },
    edgePins: ["~MEMW", "~IOW"],
    noFloatWarn: true,
    probe: { size: 32768, addrPins: A15, selected: memSel, readPin: "~MEMR", writable: true },
    init(state) {
      state.mem = new Uint8Array(32768);
      state.crtc = new Uint8Array(18);
      // 6845 defaults for 80x25 MDA-style text so the demo works pre-BIOS
      state.crtc.set([97, 80, 82, 15, 25, 6, 25, 25, 2, 13, 11, 12, 0, 0, 0, 0]);
      state.crtcIdx = 0;
      state.mode = 0x08;       // video enabled, text
      state.config = 0x00;     // graphics locked out until 3BF allows
      state.scanline = 0;
      state.hsync = 0;
      state.frames = 0;
    },
    inspect(state) {
      return [
        { key: "mode (3B8)", kind: "num", get: () => state.mode, set: (v) => { state.mode = v & 0xFF; } },
        { key: "config (3BF)", kind: "num", get: () => state.config, set: (v) => { state.config = v & 0xFF; } },
        { key: "crtcIdx", kind: "num", get: () => state.crtcIdx, set: (v) => { state.crtcIdx = v & 31; } },
        { key: "scanline", kind: "num", get: () => state.scanline, set: (v) => { state.scanline = v % 370; } },
        { key: "frames", kind: "num", get: () => state.frames, set: () => {} },
      ];
    },
    tickHz: () => 2 * 18432,   // horizontal line rate, both phases
    tick(io, state) {
      state.hsync ^= 1;
      if (!state.hsync) {
        state.scanline++;
        if (state.scanline >= 370) { state.scanline = 0; state.frames++; }
      }
      this.evaluate(io, state);
    },
    evaluate(io, state) {
      io.out("HSYNC", state.hsync);
      const vsync = state.scanline >= 352 && state.scanline < 368 ? 1 : 0;
      io.out("VSYNC", vsync);
      io.out("VIDEO", 0);
      const memRead = memSel(io) && !H(io, "~MEMR");
      if (memRead) {
        io.outBus(D, state.mem[io.num(A15)]);
        return;
      }
      if (!H(io, "~IOR")) {
        const port = ioPort(io);
        if (port === 0x3BA) {                          // status: hsync b0, vsync b7
          io.outBus(D, (state.hsync ? 1 : 0) | 0x70 | (vsync ? 0x80 : 0));
          return;
        }
        if (port === 0x3B5) { io.outBus(D, state.crtc[state.crtcIdx & 31] ?? 0); return; }
      }
      io.zBus(D);
    },
    onEdge(pin, rising, io, state) {
      if (!rising) return;                             // commit on strobe rising edge
      if (pin === "~MEMW") {
        if (memSel(io)) state.mem[io.num(A15)] = io.num(D);
        return;
      }
      // ~IOW
      const port = ioPort(io);
      const v = io.num(D);
      if (port === 0x3B4) state.crtcIdx = v & 31;
      else if (port === 0x3B5) { if (state.crtcIdx < 18) state.crtc[state.crtcIdx] = v; }
      else if (port === 0x3B8) state.mode = v;
      else if (port === 0x3BF) state.config = v;
    },
  });

  // Monochrome CRT monitor: shows a live miniature of the connected card's screen
  // right on the board; double-click for the full phosphor display.
  K.defineChip({
    type: "CRT", name: "Monochrome CRT monitor", category: "Video",
    pins: [
      { name: "HSYNC", kind: "in", side: "L", slot: 5 },
      { name: "VSYNC", kind: "in", side: "L", slot: 6 },
      { name: "VIDEO", kind: "in", side: "L", slot: 7 },
    ],
    grid: { w: 16, h: 11 }, symbol: "crt",
    noFloatWarn: true,
  });

  // Find the video card a monitor is wired to (via any of its sync/video nets).
  K.findCardForMonitor = function (doc, monitor, byPin) {
    for (const pinName of ["VIDEO", "HSYNC", "VSYNC"]) {
      const net = byPin.get(K.pinKey(monitor, pinName));
      if (!net) continue;
      for (const p of net.pins)
        if (K.chips[p.comp.type].isVideo) return p.comp;
    }
    return null;
  };

  // Render a card's current screen into an ImageData (720x350), phosphor white.
  // Used by both the mini on-board screen and the big CRT view.
  K.renderHgcScreen = function (state, img) {
    const W = 720, Hh = 350;
    const data = img.data;
    data.fill(0);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const videoOn = (state.mode & 0x08) !== 0;
    if (!videoOn) return { mode: "blank" };
    const put = (x, y, lum) => {
      const o = (y * W + x) * 4;
      data[o] = lum * 0.86; data[o + 1] = lum; data[o + 2] = lum * 0.92;
    };
    if ((state.mode & 0x02) && (state.config & 0x01)) {
      // 720x348 graphics, 4 interleaved banks of 0x2000
      for (let y = 0; y < 348; y++) {
        const base = (y & 3) * 0x2000 + (y >> 2) * 90;
        for (let xb = 0; xb < 90; xb++) {
          const b = state.mem[base + xb];
          if (!b) continue;
          for (let bit = 0; bit < 8; bit++)
            if (b & (0x80 >> bit)) put(xb * 8 + bit, y + 1, 235);
        }
      }
      return { mode: "graphics" };
    }
    // 80x25 text, 9x14 cells (column 9 duplicates column 8 for line-draw range)
    const font = K.font8x14();
    const blinkOn = (state.frames >> 4) & 1;
    for (let row = 0; row < 25; row++) {
      for (let col = 0; col < 80; col++) {
        const cell = (row * 80 + col) * 2;
        const ch = state.mem[cell];
        const attr = state.mem[cell + 1];
        if (attr === 0) continue;
        const reverse = (attr & 0x77) === 0x70;
        const bright = (attr & 0x08) !== 0;
        const underline = (attr & 0x07) === 0x01;
        const blink = (state.mode & 0x20) && (attr & 0x80) && !blinkOn;
        const lumOn = bright ? 255 : 210;
        const gx = col * 9, gy = row * 14;
        for (let fy = 0; fy < 14; fy++) {
          let bits = font[(ch & 0x7F) * 14 + fy];
          if (underline && fy === 12) bits = 0xFF;
          if (blink) bits = 0;
          for (let fx = 0; fx < 9; fx++) {
            const on = fx < 8 ? (bits & (0x80 >> fx)) !== 0 : (ch >= 0xC0 && ch <= 0xDF) && (bits & 1) !== 0;
            const lit = reverse ? !on : on;
            if (lit) put(gx + fx, gy + fy, lumOn);
          }
        }
      }
    }
    return { mode: "text" };
  };
})(globalThis.K8086 ??= {});
