"use strict";
(function (K) {
  if (typeof document === "undefined") return;
  const h = (...a) => K.h(...a);

  // Shared offscreen render of a card's screen (720x350).
  const scratch = { canvas: null, img: null };
  function renderCard(chipState) {
    if (!scratch.canvas) {
      scratch.canvas = document.createElement("canvas");
      scratch.canvas.width = 720;
      scratch.canvas.height = 350;
      scratch.img = scratch.canvas.getContext("2d").createImageData(720, 350);
    }
    K.renderHgcScreen(chipState, scratch.img);
    scratch.canvas.getContext("2d").putImageData(scratch.img, 0, 0);
    return scratch.canvas;
  }

  // Mini on-board screen for CRT monitor components (called by the schematic).
  const minis = new Map(); // monitor comp id -> {canvas, at}
  K.renderCrtMini = function (app, monitor) {
    const now = performance.now();
    let m = minis.get(monitor.id);
    if (m && now - m.at < 120) return m.canvas;
    if (!app.sim) return null;
    const card = K.findCardForMonitor(app.doc, monitor, app.sim.byPin);
    if (!card) return null;
    const chip = app.sim.chipFor(card.id);
    if (!chip) return null;
    if (!m) {
      const c = document.createElement("canvas");
      c.width = 360; c.height = 175;
      m = { canvas: c, at: 0 };
      minis.set(monitor.id, m);
    }
    const full = renderCard(chip.state);
    const ctx = m.canvas.getContext("2d");
    ctx.fillStyle = "#050807";
    ctx.fillRect(0, 0, 360, 175);
    ctx.drawImage(full, 0, 0, 360, 175);
    m.at = now;
    return m.canvas;
  };

  // The full phosphor display.
  K.CrtView = {
    open(app, monitor) {
      const card = app.sim && K.findCardForMonitor(app.doc, monitor, app.sim.byPin);
      if (!card || !app.sim) {
        K.openModal("Monochrome CRT", h("div", {}, "wire the monitor to a video card and start the simulation"), [["OK", null, "primary"]]);
        return;
      }
      const chip = app.sim.chipFor(card.id);
      const cv = h("canvas", { class: "crtScreen", width: "760", height: "392" });
      const status = h("div", { class: "crtStatus" }, "");
      const draw = () => {
        const src = renderCard(chip.state);
        const ctx = cv.getContext("2d");
        const w = cv.width, hh = cv.height;
        // tube background
        ctx.fillStyle = "#060a08";
        ctx.fillRect(0, 0, w, hh);
        const sx = 20, sy = 21, sw = w - 40, sh = hh - 42;
        // glow pass then sharp pass
        ctx.save();
        ctx.filter = "blur(4px)";
        ctx.globalAlpha = 0.45;
        ctx.drawImage(src, sx, sy, sw, sh);
        ctx.restore();
        ctx.drawImage(src, sx, sy, sw, sh);
        // scanlines
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        for (let y = sy; y < sy + sh; y += 2) ctx.fillRect(sx, y, sw, 1);
        // vignette + glass glare
        const vg = ctx.createRadialGradient(w / 2, hh / 2, hh * 0.35, w / 2, hh / 2, hh * 0.85);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(0,0,0,0.35)");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, w, hh);
        const gl = ctx.createLinearGradient(0, 0, w * 0.7, hh);
        gl.addColorStop(0, "rgba(255,255,255,0.05)");
        gl.addColorStop(0.25, "rgba(255,255,255,0)");
        ctx.fillStyle = gl;
        ctx.fillRect(0, 0, w, hh);
        const st = chip.state;
        status.textContent =
          `${(st.mode & 2) && (st.config & 1) ? "graphics 720×348" : "text 80×25"} · ` +
          `${st.mode & 8 ? "video on" : "video OFF"} · frame ${st.frames} · scanline ${st.scanline}`;
      };
      const wrap = h("div", { class: "crtBezel" }, cv,
        h("div", { class: "crtBrand" }, "µSYSTEM  MONO-12  ·  P4 PHOSPHOR"));
      // a keyboard on the board? dock it under the tube, live for input
      const kbdComp = app.doc.components.find(c => c.type === "XTKBD");
      let kbdDock = "", kbdDraw = null;
      if (kbdComp) {
        const kcv = h("canvas", { class: "crtKbd", width: "760", height: "170" });
        const units = K.KBD_LAYOUT.map(row => row.reduce((a, k) => a + k[2], 0) + (row.length - 1) * 0.12);
        const maxU = Math.max(...units);
        const cell = (760 - 24) / maxU;
        const keyRects = [];
        kbdDraw = () => {
          const ctx = kcv.getContext("2d");
          ctx.fillStyle = "#242a33";
          ctx.fillRect(0, 0, kcv.width, kcv.height);
          keyRects.length = 0;
          K.KBD_LAYOUT.forEach((row, r) => {
            let x = 12;
            const y = 10 + r * 31;
            for (const [label, sc, wU] of row) {
              const wPx = wU * cell;
              const down = K.KbdCapture.pressed.has(sc);
              keyRects.push({ x, y, w: wPx, h: 26, sc });
              ctx.fillStyle = down ? "#4ec9b0" : "#39414d";
              ctx.beginPath(); ctx.roundRect(x, y + (down ? 2 : 0), wPx - 3, 26, 4); ctx.fill();
              ctx.strokeStyle = "#1a1f26"; ctx.stroke();
              ctx.fillStyle = down ? "#0d1117" : "#c8d4e0";
              ctx.font = "10px monospace";
              ctx.textAlign = "center"; ctx.textBaseline = "middle";
              ctx.fillText(label, x + (wPx - 3) / 2, y + 13 + (down ? 2 : 0));
              x += wPx + 0.12 * cell;
            }
          });
        };
        let mouseSc = null;
        const release = () => {
          if (mouseSc !== null && app.sim && !app.paused)
            app.sim.applyInput(kbdComp.id, { scan: mouseSc | 0x80 });
          if (mouseSc !== null) K.KbdCapture.pressed.delete(mouseSc);
          mouseSc = null;
        };
        kcv.addEventListener("mousedown", (e) => {
          const r = kcv.getBoundingClientRect();
          const mx = (e.clientX - r.left) * (kcv.width / r.width);
          const my = (e.clientY - r.top) * (kcv.height / r.height);
          const hit = keyRects.find(k => mx >= k.x && mx <= k.x + k.w && my >= k.y && my <= k.y + k.h);
          if (!hit || !app.sim || app.paused) return;
          mouseSc = hit.sc;
          app.sim.applyInput(kbdComp.id, { scan: hit.sc });
          K.KbdCapture.pressed.add(hit.sc);
        });
        kcv.addEventListener("mouseup", release);
        kcv.addEventListener("mouseleave", release);
        kbdDock = h("div", { class: "crtKbdWrap" }, kcv,
          h("div", { class: "crtKbdHint" }, "⌨ input live — type on your keyboard or click the keys"));
        K.KbdCapture.modalOverride = true;
      }
      const bar = h("div", { class: "hexToolbar" },
        status,
        h("span", { class: "spacer" }),
        kbdComp ? h("span", { class: "crtLive" }, "⌨ input live") : "",
        h("button", { onclick: () => K.downloadCanvasPng(cv, "screen.png") }, "📷 screen"));
      K.openModal("Monochrome display", h("div", {}, wrap, kbdDock, bar), [["Close", null, "primary"]]);
      document.getElementById("modalBox").classList.add("wide");
      draw();
      if (kbdDraw) kbdDraw();                 // key hit-rects exist immediately
      const iv = setInterval(() => { draw(); if (kbdDraw) kbdDraw(); }, 33);
      K._modalOnClose = () => {
        document.getElementById("modalBox").classList.remove("wide");
        clearInterval(iv);
        K.KbdCapture.modalOverride = false;
      };
    },
  };
})(globalThis.K8086 ??= {});
