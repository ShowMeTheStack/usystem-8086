"use strict";
(function (K) {
  if (typeof document === "undefined") return;
  const { SIG } = K;
  const BASE_LANE = 26;
  const COLORS = new Proxy({}, { get: (_, k) => {
    const cv = K.theme.cv;
    return { hi: cv.sigH, lo: cv.sigL, z: cv.sigZ, x: cv.sigX, bus: cv.labelVal }[k];
  } });

  // Signals are stored as pin references so they survive sim rebuilds.
  // {label, pins: [pinKey]} — one pin = digital lane, several = bus lane.
  K.Waveform = class Waveform {
    constructor(canvas, namesEl, app) {
      this.cv = canvas;
      this.namesEl = namesEl;
      this.app = app;
      this.signals = [];
      this.follow = true;
      this.span = 256;       // half-steps visible
      this.vScale = 1;       // lane height multiplier (V-zoom slider)
      this.tEnd = 0;
      this.cursorT = null;
      this.bind();
    }

    get laneH() { return Math.round(BASE_LANE * this.vScale); }

    add(label, pins) {
      if (this.signals.some(s => s.label === label)) return;
      this.signals.push({ label, pins });
      this.renderNames();
    }
    remove(sig) {
      this.signals = this.signals.filter(s => s !== sig);
      this.renderNames();
    }
    clear() { this.signals = []; this.renderNames(); }

    autoPopulate() {
      const app = this.app;
      this.clear();
      const cpu = app.doc.components.find(c => K.chips[c.type].isCpu);
      if (cpu) {
        const ref = cpu.props.ref || cpu.id;
        for (const p of ["CLK", "ALE", "~RD", "~WR", K.chips[cpu.type].is8086 ? "M/~IO" : "IO/~M"])
          this.add(`${ref}.${p}`, [K.pinKey(cpu, p)]);
        const adPins = K.chips[cpu.type].pins.filter(p => /^AD\d+$/.test(p.name))
          .sort((a, b) => +a.name.slice(2) - +b.name.slice(2));
        this.add(`${ref}.AD[bus]`, adPins.map(p => K.pinKey(cpu, p.name)));
        // boards with an interrupt controller get the IRQ handshake by default
        if (app.doc.components.some(c => c.type === "8259A")) {
          this.add(`${ref}.INTR`, [K.pinKey(cpu, "INTR")]);
          this.add(`${ref}.~INTA`, [K.pinKey(cpu, "~INTA")]);
        }
      } else {
        const osc = app.doc.components.find(c => c.type === "OSC");
        if (osc) this.add((osc.props.ref || "OSC") + ".OUT", [K.pinKey(osc, "OUT")]);
      }
      this.renderNames();
    }

    valueAt(sim, sig, t) {
      const nets = sig.pins.map(pk => sim.byPin.get(pk));
      if (sig.pins.length === 1) {
        const n = nets[0];
        return n ? sim.traceAt(n.id, t) : SIG.Z;
      }
      let v = 0, anyX = false, anyZ = false;
      nets.forEach((n, i) => {
        const s = n ? sim.traceAt(n.id, t) : SIG.Z;
        if (s === SIG.H) v |= 1 << i;
        else if (s === SIG.X) anyX = true;
        else if (s === SIG.Z) anyZ = true;
      });
      return anyX ? { x: true } : anyZ && v === 0 ? { z: true } : { v };
    }

    fmtBusVal(bv, bits) {
      if (bv.x) return "X";
      if (bv.z) return "Z";
      return bv.v.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), "0");
    }

    renderNames() {
      const sim = this.app.sim;
      this.namesEl.innerHTML = "";
      for (const sig of this.signals) {
        let valTxt = "";
        if (sim) {
          const t = this.cursorT ?? sim.t;
          const v = this.valueAt(sim, sig, t);
          valTxt = sig.pins.length === 1 ? K.SIG_NAME[v] : this.fmtBusVal(v, sig.pins.length);
        }
        this.namesEl.append(K.h("div", { class: "sig", style: `height:${this.laneH}px` },
          K.h("span", { title: sig.label }, sig.label),
          K.h("b", {}, valTxt),
          K.h("button", { onclick: () => this.remove(sig), title: "remove" }, "✕")));
      }
    }

    // ---- view controls ------------------------------------------------------
    spanBounds() {
      const sim = this.app.sim;
      return [16, sim ? sim.ringSize : 1 << 18];
    }
    attachControls(els) {
      this.ctl = els;                              // {h, v, scroll}
      els.h.addEventListener("input", () => {
        const [a, b] = this.spanBounds();
        this.span = Math.round(a * Math.pow(b / a, +els.h.value / 1000));
      });
      els.v.addEventListener("input", () => {
        this.vScale = +els.v.value / 100;
        this.renderNames();
      });
      els.scroll.addEventListener("input", () => {
        const sim = this.app.sim;
        if (!sim) return;
        const f = +els.scroll.value / 1000;
        const lo = Math.min(sim.t, sim.traceStart + this.span);
        this.tEnd = Math.round(lo + f * (sim.t - lo));
        this.follow = f >= 0.999;                  // right edge = re-engage follow
        this.updateFollowBtn();
      });
      this.syncControls();
    }
    syncControls() {
      if (!this.ctl) return;
      const [a, b] = this.spanBounds();
      this.ctl.h.value = String(Math.round(1000 * Math.log(this.span / a) / Math.log(b / a)));
      this.ctl.v.value = String(Math.round(this.vScale * 100));
      const sim = this.app.sim;
      if (sim) {
        const lo = Math.min(sim.t, sim.traceStart + this.span);
        const range = sim.t - lo;
        this.ctl.scroll.value = String(this.follow || range <= 0 ? 1000
          : Math.round(1000 * K.clamp((this.tEnd - lo) / range, 0, 1)));
        this.ctl.scroll.disabled = range <= 0;
      } else this.ctl.scroll.disabled = true;
    }
    updateFollowBtn() {
      document.getElementById("btnFollow")?.classList.toggle("active", this.follow);
    }
    clampView(sim) {
      const [a, b] = this.spanBounds();
      this.span = K.clamp(this.span, a, b);
      this.tEnd = K.clamp(this.tEnd, Math.min(sim.t, sim.traceStart + this.span), sim.t);
    }

    render() {
      const sim = this.app.sim;
      const cv = this.cv, ctx = cv.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = K.theme.cv.waveBg;
      ctx.fillRect(0, 0, w, h);
      if (!sim) {
        ctx.fillStyle = K.theme.cv.waveText;
        ctx.font = "12px monospace";
        ctx.textAlign = "center";
        ctx.fillText("start the simulation to capture waveforms", w / 2, h / 2);
        return;
      }
      if (!sim.captureEnabled) {
        ctx.fillStyle = K.theme.cv.waveCursor;
        ctx.font = "12px monospace";
        ctx.textAlign = "center";
        ctx.fillText("⚡ turbo — waveform capture paused (leave turbo or pause to resume)", w / 2, h / 2);
        return;
      }
      if (this.follow) this.tEnd = sim.t;
      this.clampView(sim);
      const t1 = this.tEnd, t0 = Math.max(sim.traceStart, t1 - this.span);
      const tToX = (t) => ((t - t0) / this.span) * w;
      const laneH = this.laneH;

      // time grid every 2 half-steps (one CLK) when zoomed in, else adaptive
      const stepT = this.span <= 64 ? 2 : this.span <= 512 ? 16 : Math.pow(2, Math.ceil(Math.log2(this.span / 32)));
      ctx.strokeStyle = K.theme.cv.waveGrid;
      ctx.lineWidth = 1;
      for (let t = Math.ceil(t0 / stepT) * stepT; t <= t1; t += stepT) {
        const x = tToX(t);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }

      // hoisted trace access: v = tr[(t % ring) * NN + netId]
      const tr = sim.trace, ring = sim.ringSize, NN = sim.nets.length;

      this.signals.forEach((sig, i) => {
        const yTop = i * laneH + 5, yBot = (i + 1) * laneH - 7, yMid = (yTop + yBot) / 2;
        ctx.strokeStyle = K.theme.cv.waveGrid;
        ctx.beginPath(); ctx.moveTo(0, (i + 1) * laneH - 0.5); ctx.lineTo(w, (i + 1) * laneH - 0.5); ctx.stroke();

        if (sig.pins.length === 1) {
          const net = sim.byPin.get(sig.pins[0]);
          if (!net) return;
          const id = net.id;
          const yOf = (v) => v === SIG.H ? yTop : v === SIG.L ? yBot : yMid;
          ctx.lineWidth = 1.5;
          if (this.span <= w * 1.5) {
            // transition-accurate square wave: each level runs as a solid
            // horizontal all the way TO its edge, then a vertical edge
            const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
            let prevV = -1, lastX = 0;
            for (let t = t0; t <= t1; t++) {
              const v = tr[(t % ring) * NN + id];
              if (prevV < 0) { prevV = v; lastX = tToX(t); continue; }
              if (v !== prevV) {
                const x = tToX(t), py = yOf(prevV);
                paths[prevV].moveTo(lastX, py);
                paths[prevV].lineTo(x, py);
                paths[v].moveTo(x, py);
                paths[v].lineTo(x, yOf(v));
                prevV = v; lastX = x;
              }
            }
            if (prevV >= 0) {
              const py = yOf(prevV);
              paths[prevV].moveTo(lastX, py);
              paths[prevV].lineTo(tToX(t1), py);
            }
            for (const v of [SIG.Z, SIG.X, SIG.L, SIG.H]) {
              ctx.strokeStyle = laneColor(v);
              ctx.stroke(paths[v]);
            }
          } else {
            // zoomed out: per-pixel-column aggregation — a column holding both
            // H and L renders as a solid band, the honest scope picture of a
            // signal faster than the zoom (no aliasing artifacts)
            const pHi = new Path2D(), pLo = new Path2D(), pMid = new Path2D(),
              pX = new Path2D(), pBand = new Path2D();
            const colStride = Math.max(1, Math.floor(this.span / (w * 24)));
            for (let px = 0; px < w; px++) {
              const ta = Math.max(t0, Math.round(t0 + px * this.span / w));
              const tb = Math.min(t1, Math.round(t0 + (px + 1) * this.span / w));
              if (tb < ta) continue;
              let sawH = false, sawL = false, sawM = false, sawX = false;
              for (let t = ta; t <= tb; t += colStride) {
                const v = tr[(t % ring) * NN + id];
                if (v === SIG.H) sawH = true;
                else if (v === SIG.L) sawL = true;
                else { sawM = true; if (v === SIG.X) sawX = true; }
              }
              const many = (sawH ? 1 : 0) + (sawL ? 1 : 0) + (sawM ? 1 : 0) > 1;
              if (many) {
                pBand.moveTo(px + 0.5, sawH ? yTop : yMid);
                pBand.lineTo(px + 0.5, sawL ? yBot : yMid);
              } else if (sawH) { pHi.moveTo(px, yTop); pHi.lineTo(px + 1, yTop); }
              else if (sawL) { pLo.moveTo(px, yBot); pLo.lineTo(px + 1, yBot); }
              else if (sawX) { pX.moveTo(px, yMid); pX.lineTo(px + 1, yMid); }
              else if (sawM) { pMid.moveTo(px, yMid); pMid.lineTo(px + 1, yMid); }
            }
            for (const [p, c] of [[pMid, COLORS.z], [pX, COLORS.x], [pLo, COLORS.lo],
              [pHi, COLORS.hi], [pBand, COLORS.hi]]) {
              ctx.strokeStyle = c;
              ctx.stroke(p);
            }
          }
        } else {
          // bus lane: bands with hex labels
          const step = Math.max(1, Math.floor(this.span / w));
          let segStart = t0;
          let segVal = JSON.stringify(this.valueAt(sim, sig, t0));
          const flush = (tEndSeg) => {
            const x0 = tToX(segStart), x1 = tToX(tEndSeg);
            const bv = JSON.parse(segVal);
            ctx.strokeStyle = bv.x ? COLORS.x : COLORS.bus;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(x0 + 2, yTop); ctx.lineTo(x1 - 2, yTop);
            ctx.moveTo(x0 + 2, yBot); ctx.lineTo(x1 - 2, yBot);
            ctx.moveTo(x0 + 2, yTop); ctx.lineTo(x0, yMid); ctx.lineTo(x0 + 2, yBot);
            ctx.moveTo(x1 - 2, yTop); ctx.lineTo(x1, yMid); ctx.lineTo(x1 - 2, yBot);
            ctx.stroke();
            if (x1 - x0 > 26) {
              ctx.fillStyle = bv.x ? COLORS.x : K.theme.text;
              ctx.font = "10px monospace";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(this.fmtBusVal(bv, sig.pins.length), (x0 + x1) / 2, yMid);
            }
          };
          for (let t = t0 + step; t <= t1; t += step) {
            const v = JSON.stringify(this.valueAt(sim, sig, t));
            if (v !== segVal) { flush(t); segStart = t; segVal = v; }
          }
          flush(t1);
        }
      });

      // cursor
      if (this.cursorT !== null && this.cursorT >= t0 && this.cursorT <= t1) {
        const x = tToX(this.cursorT);
        ctx.strokeStyle = K.theme.cv.waveCursor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = K.theme.cv.waveCursor;
        ctx.font = "10px monospace";
        ctx.textAlign = "left";
        ctx.fillText("t=" + this.cursorT + " (cyc " + Math.floor(this.cursorT / 2) + ")", Math.min(x + 4, w - 90), 10);
      }
      this.renderNames();
      this.syncControls();
    }

    bind() {
      this.cv.addEventListener("wheel", (e) => {
        const sim = this.app.sim;
        if (e.ctrlKey) {
          // trackpad pinch arrives as ctrl+wheel: horizontal zoom at the pointer
          e.preventDefault();
          const frac = e.offsetX / this.cv.clientWidth;
          const tAt = this.tEnd - this.span + frac * this.span;
          const [a, b] = this.spanBounds();
          this.span = Math.round(K.clamp(this.span * Math.exp(e.deltaY * 0.01), a, b));
          if (!this.follow) this.tEnd = Math.round(tAt + (1 - frac) * this.span);
          if (sim) this.clampView(sim);
          this.syncControls();
        } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          // two-finger horizontal scroll pans through the recording
          e.preventDefault();
          this.follow = false;
          this.updateFollowBtn();
          this.tEnd += Math.round(e.deltaX * this.span / this.cv.clientWidth);
          if (sim) this.clampView(sim);
          this.syncControls();
        }                                          // vertical scroll: not ours
      }, { passive: false });
      this.cv.addEventListener("mousedown", (e) => {
        this.dragX = e.offsetX;
        this.dragT = this.tEnd;
        this.moved = false;
      });
      this.cv.addEventListener("mousemove", (e) => {
        if (this.dragX === undefined) return;
        const dt = Math.round((this.dragX - e.offsetX) * this.span / this.cv.clientWidth);
        if (Math.abs(e.offsetX - this.dragX) > 3) this.moved = true;
        if (this.moved) {
          this.follow = false;
          this.updateFollowBtn();
          this.tEnd = this.dragT + dt;
          if (this.app.sim) this.clampView(this.app.sim);
          this.syncControls();
        }
      });
      window.addEventListener("mouseup", (e) => {
        if (this.dragX !== undefined && !this.moved && e.target === this.cv) {
          const frac = (e.offsetX ?? 0) / this.cv.clientWidth;
          const t0 = this.tEnd - this.span;
          this.cursorT = Math.round(t0 + frac * this.span);
        }
        this.dragX = undefined;
      });
    }

    // "add signal" dialog: chips -> pins and bus groups
    addDialog() {
      const app = this.app;
      const body = K.h("div", {});
      for (const comp of app.doc.components) {
        const def = K.chips[comp.type];
        if (["VCC", "GND", "NETLABEL", "PULLUP"].includes(comp.type)) continue;
        const ref = comp.props.ref || comp.id;
        const det = K.h("details", {}, K.h("summary", {}, `${ref} — ${def.type}`));
        // bus groups: same alpha prefix + >=4 numbered pins
        const groups = new Map();
        for (const p of def.pins) {
          const m = /^([A-Za-z~/]+)(\d+)$/.exec(p.name);
          if (m) {
            if (!groups.has(m[1])) groups.set(m[1], []);
            groups.get(m[1]).push(p);
          }
        }
        for (const [prefix, pins] of groups) {
          if (pins.length < 4) continue;
          pins.sort((a, b) => +a.name.slice(prefix.length) - +b.name.slice(prefix.length));
          det.append(K.h("div", {
            class: "pick",
            onclick: () => { this.add(`${ref}.${prefix}[${pins.length}]`, pins.map(p => K.pinKey(comp, p.name))); },
          }, `⛁ ${prefix}0..${prefix}${pins.length - 1}  (bus)`));
        }
        for (const p of def.pins) {
          if (p.kind === "pwr" || p.kind === "gnd" || p.kind === "nc") continue;
          det.append(K.h("div", {
            class: "pick",
            onclick: () => { this.add(`${ref}.${p.name}`, [K.pinKey(comp, p.name)]); },
          }, `— ${p.name}`));
        }
        body.append(det);
      }
      K.openModal("Add signal to waveform", body, [["Done", null, "primary"]]);
    }
  };

  function laneColor(v) {
    return v === SIG.H ? COLORS.hi : v === SIG.L ? COLORS.lo : v === SIG.X ? COLORS.x : COLORS.z;
  }
})(globalThis.K8086 ??= {});
