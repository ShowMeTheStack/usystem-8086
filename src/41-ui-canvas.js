"use strict";
(function (K) {
  if (typeof document === "undefined") return;
  const { SIG } = K;
  const U = 12; // px per grid unit at zoom 1

  // signal colors come from the active theme (physics colors stay fixed)
  const SIGCOLOR = new Proxy({}, { get: (_, k) => {
    const cv = K.theme.cv;
    return { [SIG.Z]: cv.sigZ, [SIG.L]: cv.sigL, [SIG.H]: cv.sigH, [SIG.X]: cv.sigX }[k];
  } });

  K.Schematic = class Schematic {
    constructor(canvas, app) {
      this.cv = canvas;
      this.app = app;
      this.view = { x: -2, y: -2, zoom: 1.4 };
      this.hover = null;
      this.drag = null;
      this.bind();
    }

    // ---- geometry ----
    toScreen(gx, gy) {
      const z = this.view.zoom * U;
      return [(gx - this.view.x) * z, (gy - this.view.y) * z];
    }
    toGrid(sx, sy) {
      const z = this.view.zoom * U;
      return [sx / z + this.view.x, sy / z + this.view.y];
    }
    bodyRect(comp) {
      const g = K.chips[comp.type].grid;
      return { x: comp.x, y: comp.y, w: g.w, h: g.h + 1 };
    }
    pinPos(comp, pin) {
      const r = this.bodyRect(comp);
      const s = pin.slot + 1;
      if (pin.side === "L") return [r.x - 0.8, r.y + s];
      if (pin.side === "R") return [r.x + r.w + 0.8, r.y + s];
      if (pin.side === "T") return [r.x + s, r.y - 0.8];
      return [r.x + s, r.y + r.h + 0.8]; // B
    }
    pinStub(comp, pin) {
      const r = this.bodyRect(comp);
      const s = pin.slot + 1;
      if (pin.side === "L") return [[r.x - 0.8, r.y + s], [r.x, r.y + s]];
      if (pin.side === "R") return [[r.x + r.w + 0.8, r.y + s], [r.x + r.w, r.y + s]];
      if (pin.side === "T") return [[r.x + s, r.y - 0.8], [r.x + s, r.y]];
      return [[r.x + s, r.y + r.h + 0.8], [r.x + s, r.y + r.h]];
    }
    outDir(pin) { return pin.side === "L" ? [-1, 0] : pin.side === "R" ? [1, 0] : pin.side === "T" ? [0, -1] : [0, 1]; }

    wirePath(wire) {
      const app = this.app;
      const ca = app.compOf(wire.a), cb = app.compOf(wire.b);
      if (!ca || !cb) return null;
      const pa = app.pinOf(wire.a), pb = app.pinOf(wire.b);
      const A = this.pinPos(ca, pa), B = this.pinPos(cb, pb);
      const da = this.outDir(pa), db = this.outDir(pb);
      const A2 = [A[0] + da[0] * 0.8, A[1] + da[1] * 0.8];
      const B2 = [B[0] + db[0] * 0.8, B[1] + db[1] * 0.8];
      const midX = (A2[0] + B2[0]) / 2;
      return [A, A2, [midX, A2[1]], [midX, B2[1]], B2, B];
    }

    // ---- rendering ----
    render() {
      const cv = this.cv, ctx = cv.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = K.theme.cv.bg;
      ctx.fillRect(0, 0, w, h);
      const z = this.view.zoom * U;

      // grid dots
      if (z > 5) {
        ctx.fillStyle = K.theme.cv.grid;
        const step = 4;
        const gx0 = Math.floor(this.view.x / step) * step;
        const gy0 = Math.floor(this.view.y / step) * step;
        for (let gx = gx0; (gx - this.view.x) * z < w; gx += step)
          for (let gy = gy0; (gy - this.view.y) * z < h; gy += step) {
            const [sx, sy] = this.toScreen(gx, gy);
            ctx.fillRect(sx - 1, sy - 1, 2, 2);
          }
      }

      // pin-hover net glow (the whole net lights up — vital in no-wire mode)
      this._glowNet = null;
      if (this.hover && this.hover.kind === "pin") {
        const net = this.app.netsNow().get(K.pinKey(this.hover.comp, this.hover.pin.name));
        if (net && net.pins.length > 1) this._glowNet = net;
      }
      this.renderWires(ctx);
      for (const comp of this.app.doc.components) this.renderComp(ctx, comp);
      if (this._glowNet) {
        const zz = this.view.zoom * U;
        for (const p of this._glowNet.pins) {
          const [sx, sy] = this.toScreen(...this.pinPos(p.comp, p.pin));
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(4, zz * 0.4), 0, Math.PI * 2);
          ctx.strokeStyle = K.theme.cv.glow;
          ctx.lineWidth = 2;
          ctx.shadowColor = K.theme.cv.glow; ctx.shadowBlur = 8;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // wiring rubber band
      if (this.app.wireFrom && this.mousePos) {
        const { comp, pin } = this.app.wireFrom;
        const [ax, ay] = this.toScreen(...this.pinPos(comp, pin));
        ctx.strokeStyle = K.theme.cv.wireHi;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(this.mousePos[0], this.mousePos[1]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // placement ghost
      if (this.app.placing && this.mousePos) {
        const [gx, gy] = this.toGrid(...this.mousePos).map(Math.round);
        ctx.globalAlpha = 0.5;
        this.renderComp(ctx, { id: "?", type: this.app.placing, x: gx, y: gy, props: { ...K.chips[this.app.placing].props } });
        ctx.globalAlpha = 1;
      }
    }

    // ---- bus bundles: fan-in curves, straight trunk, fan-out curves --------
    // Wires that share a bundle id (or an auto-detected numbered pin family)
    // render as: curved leads from every pin converging on a per-component
    // "tap", one thick Manhattan trunk between taps (sharp corners), and a
    // slash label with the width, name and live hex value.
    _wireGroups() {
      const app = this.app;
      const groups = new Map();
      const famKey = (w) => {
        // heuristic bundling for hand-wired buses: same two component sides,
        // both pin names ending in digits with a shared alpha prefix
        const ca = app.compOf(w.a), cb = app.compOf(w.b);
        const pa = app.pinOf(w.a), pb = app.pinOf(w.b);
        if (!ca || !cb || !pa || !pb) return null;
        const ma = /^(.*?)(\d+)$/.exec(pa.name), mb = /^(.*?)(\d+)$/.exec(pb.name);
        if (!ma || !mb) return null;
        return `~fam:${ca.id}.${pa.side}.${ma[1]}~${cb.id}.${pb.side}.${mb[1]}`;
      };
      for (const wire of app.doc.wires) {
        const key = wire.bundle || famKey(wire) || wire.id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(wire);
      }
      // auto-detected families only count as buses with >= 3 members
      for (const [key, wires] of groups) {
        if (key.startsWith("~fam:") && wires.length < 3) {
          groups.delete(key);
          for (const w of wires) groups.set(w.id, [w]);
        }
      }
      // merge bundles that share >= 2 endpoint pins: they are one electrical
      // bus wired to several chips (ad + d1 + d2 + d3 = THE data bus), and
      // deserve one multi-drop trunk instead of parallel copies
      const entries = [...groups.entries()].filter(([, w]) => w.length > 1);
      const parent = new Map(entries.map(([k]) => [k, k]));
      const find = (k) => { while (parent.get(k) !== k) k = parent.get(k); return k; };
      const endpointsOf = new Map(entries.map(([k, ws]) => [k, new Set(ws.flatMap(w => [w.a, w.b]))]));
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = endpointsOf.get(entries[i][0]), b = endpointsOf.get(entries[j][0]);
          let shared = 0;
          for (const e of a) if (b.has(e) && ++shared >= 2) break;
          if (shared >= 2) {
            const ra = find(entries[i][0]), rb = find(entries[j][0]);
            if (ra !== rb) parent.set(rb, ra);
          }
        }
      }
      const merged = new Map();
      for (const [k, ws] of groups) {
        const root = parent.has(k) ? find(k) : k;
        if (!merged.has(root)) merged.set(root, []);
        merged.get(root).push(...ws);
      }
      return merged;
    }

    // a lone wire gets the same body-avoiding, lane-separated channel routing
    _singleRoute(wire) {
      const app = this.app;
      const ca = app.compOf(wire.a), cb = app.compOf(wire.b);
      if (!ca || !cb) return null;
      const pa = app.pinOf(wire.a), pb = app.pinOf(wire.b);
      const A = this.pinPos(ca, pa), B = this.pinPos(cb, pb);
      const da = this.outDir(pa), db = this.outDir(pb);
      const tapA = { pos: [A[0] + da[0] * 0.7, A[1] + da[1] * 0.7], dir: da };
      const tapB = { pos: [B[0] + db[0] * 0.7, B[1] + db[1] * 0.7], dir: db };
      const mid = this._trunkRoute(tapA, tapB, this._bodies || [], this._usedChannels || { v: [], h: [] });
      return [A, ...mid, B];
    }

    _bitOf(wire) {
      const pa = this.app.pinOf(wire.a), pb = this.app.pinOf(wire.b);
      const m = (pa && /(\d+)$/.exec(pa.name)) || (pb && /(\d+)$/.exec(pb.name));
      return m ? +m[1] : 0;
    }

    _busName(wires) {
      // most frequent alpha prefix over every endpoint pin name
      const freq = new Map();
      for (const w of wires) for (const k of [w.a, w.b]) {
        const p = this.app.pinOf(k);
        const m = p && /^(.*?)(\d+)$/.exec(p.name);
        if (m && m[1]) freq.set(m[1], (freq.get(m[1]) || 0) + 1);
      }
      let bestP = null, bestN = 0;
      for (const [p, n] of [...freq].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)))
        if (n > bestN) { bestN = n; bestP = p; }
      if (!bestP) return null;
      const bits = wires.map(w => this._bitOf(w));
      return `${bestP}[${Math.max(...bits)}:${Math.min(...bits)}]`;
    }

    // taps: one gather point per (component, side) touched by the bundle
    _bundleLayout(wires) {
      const app = this.app;
      const tapGroups = new Map();
      const addEnd = (wire, key) => {
        const comp = app.compOf(key), pin = app.pinOf(key);
        if (!comp || !pin) return;
        const gk = comp.id + "|" + pin.side;
        if (!tapGroups.has(gk)) tapGroups.set(gk, { comp, side: pin.side, ends: [] });
        tapGroups.get(gk).ends.push({ wire, comp, pin });
      };
      for (const w of wires) { addEnd(w, w.a); addEnd(w, w.b); }
      if (tapGroups.size < 2) return null;

      const TAP = 2.6;                      // gather distance off the chip edge
      const taps = [];
      for (const g of tapGroups.values()) {
        const dir = this.outDir(g.ends[0].pin);
        let sx = 0, sy = 0;
        for (const e of g.ends) { const [x, y] = this.pinPos(e.comp, e.pin); sx += x; sy += y; }
        const cx = sx / g.ends.length, cy = sy / g.ends.length;
        const r = this.bodyRect(g.comp);
        // anchor the tap at the perpendicular distance TAP from the body edge
        const pos = dir[0] !== 0
          ? [(dir[0] < 0 ? r.x : r.x + r.w) + dir[0] * TAP, cy]
          : [cx, (dir[1] < 0 ? r.y : r.y + r.h) + dir[1] * TAP];
        taps.push({ pos, dir, ends: g.ends });
      }
      // spine: chain taps along the axis they spread over most
      const xs = taps.map(t => t.pos[0]), ys = taps.map(t => t.pos[1]);
      const horiz = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
      taps.sort((a, b) => horiz ? a.pos[0] - b.pos[0] : a.pos[1] - b.pos[1]);
      const spine = [];
      for (let i = 0; i < taps.length - 1; i++)
        spine.push(this._trunkRoute(taps[i], taps[i + 1], this._bodies, this._usedChannels));
      // leads: cubic bezier pin -> tap, leaving and arriving perpendicular
      const leads = [];
      for (const t of taps) {
        for (const e of t.ends) {
          const P0 = this.pinPos(e.comp, e.pin);
          const d = this.outDir(e.pin);
          const P3 = t.pos;
          const dist = Math.hypot(P3[0] - P0[0], P3[1] - P0[1]);
          const k = Math.min(1.6, dist * 0.5);
          leads.push({
            wire: e.wire,
            pts: [P0, [P0[0] + d[0] * k, P0[1] + d[1] * k],
                  [P3[0] - d[0] * k * 0.9, P3[1] - d[1] * k * 0.9], P3],
          });
        }
      }
      return { taps, spine, leads };
    }

    // Manhattan trunk between two taps: straight runs, sharp corners.
    // Candidate channels are scored on chip-body crossings, crowding against
    // channels other buses already took (lane separation), and length.
    _segCrossings(p, q, rects) {
      let n = 0;
      const x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]);
      const y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]);
      for (const r of rects)
        if (x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h) n++;
      return n;
    }
    _routeScore(path, rects, used) {
      let cross = 0, len = 0, crowd = 0;
      for (let i = 0; i < path.length - 1; i++) {
        cross += this._segCrossings(path[i], path[i + 1], rects);
        len += Math.abs(path[i + 1][0] - path[i][0]) + Math.abs(path[i + 1][1] - path[i][1]);
        // crowding: long runs sharing a lane with an existing trunk
        const vert = Math.abs(path[i + 1][0] - path[i][0]) < 0.05;
        const runLen = vert ? Math.abs(path[i + 1][1] - path[i][1]) : Math.abs(path[i + 1][0] - path[i][0]);
        if (runLen > 3) {
          const lane = vert ? path[i][0] : path[i][1];
          for (const u of (vert ? used.v : used.h))
            if (Math.abs(u - lane) < 0.65) crowd++;
        }
      }
      return cross * 30 + crowd * 6 + len;
    }
    _recordLanes(path, used) {
      for (let i = 0; i < path.length - 1; i++) {
        const vert = Math.abs(path[i + 1][0] - path[i][0]) < 0.05;
        const runLen = vert ? Math.abs(path[i + 1][1] - path[i][1]) : Math.abs(path[i + 1][0] - path[i][0]);
        if (runLen > 3) (vert ? used.v : used.h).push(vert ? path[i][0] : path[i][1]);
      }
    }
    _trunkRoute(a, b, rects, used) {
      rects = rects || []; used = used || { v: [], h: [] };
      const A = a.pos, B = b.pos;
      let best = null, bestScore = Infinity;
      const consider = (path) => {
        const sc = this._routeScore(path, rects, used);
        if (sc < bestScore) { bestScore = sc; best = path; }
      };
      if (Math.abs(A[0] - B[0]) < 0.05 || Math.abs(A[1] - B[1]) < 0.05) {
        consider([A, B]);
      } else {
        // vertical-channel dog-legs at several candidate x positions
        const xc = new Set([(A[0] + B[0]) / 2, A[0], B[0]]);
        for (const d of [-2.4, -1.6, -0.8, 0.8, 1.6, 2.4]) xc.add((A[0] + B[0]) / 2 + d);
        for (const x of xc) consider([A, [x, A[1]], [x, B[1]], B]);
        // horizontal-channel dog-legs
        const yc = new Set([(A[1] + B[1]) / 2, A[1], B[1]]);
        for (const d of [-2.4, -1.6, -0.8, 0.8, 1.6, 2.4]) yc.add((A[1] + B[1]) / 2 + d);
        for (const y of yc) consider([A, [A[0], y], [B[0], y], B]);
        // plain L corners
        consider([A, [B[0], A[1]], B]);
        consider([A, [A[0], B[1]], B]);
      }
      this._recordLanes(best, used);
      // drop zero-length segments
      return best.filter((p, i) => i === 0 || Math.abs(p[0] - best[i - 1][0]) > 0.02 || Math.abs(p[1] - best[i - 1][1]) > 0.02);
    }

    _busValue(wires) {
      const sim = this.app.sim;
      if (!sim) return null;
      let v = 0, any = false;
      for (const w of wires) {
        const net = sim.byPin.get(w.a);
        if (!net) continue;
        any = true;
        if (sim.netVal[net.id] === SIG.H) v |= 1 << this._bitOf(w);
      }
      if (!any) return null;
      const width = Math.max(...wires.map(w => this._bitOf(w))) + 1;
      return v.toString(16).toUpperCase().padStart(Math.ceil(width / 4), "0");
    }

    renderWires(ctx) {
      const app = this.app;
      const z = this.view.zoom * U;
      // no-wire mode: a clean canvas — EXCEPT the selected chip, whose
      // wiring renders in full styling (deterministic per frame: the lane
      // registry resets below, so nothing flickers)
      let groups = this._wireGroups();
      if (app.hideWires) {
        const selId = app.selection && app.selection.kind === "comp" ? app.selection.comp.id : null;
        if (!selId) { this._bundles = []; this._singlePaths = new Map(); return; }
        const touches = (w) => w.a.startsWith(selId + ".") || w.b.startsWith(selId + ".");
        const kept = new Map();
        for (const [key, wires] of groups) {
          const sub = wires.filter(touches);
          if (sub.length) kept.set(key, sub);
        }
        groups = kept;
      }
      this._bundles = [];                    // cached for hitTest
      // chip bodies (slightly padded) for trunk avoidance, shared lane registry
      this._bodies = app.doc.components
        .filter(c => K.chips[c.type].grid.w * K.chips[c.type].grid.h > 12)
        .map(c => { const r = this.bodyRect(c); return { x: r.x - 0.4, y: r.y - 0.4, w: r.w + 0.8, h: r.h + 0.8 }; });
      this._usedChannels = { v: [], h: [] };
      this._labelBoxes = [];
      this._singlePaths = new Map();
      const S = (p) => this.toScreen(p[0], p[1]);

      for (const [key, wires] of groups) {
        if (wires.length === 1) {            // plain wire: routed like a thin trunk
          const wire = wires[0];
          const path = this._singleRoute(wire);
          if (!path) continue;
          this._singlePaths.set(wire.id, path);
          const sel = app.selection && app.selection.kind === "wire" && app.selection.wire === wire;
          const hov = this.hover && this.hover.kind === "wire" && this.hover.wire === wire;
          let color = K.theme.cv.wire;
          if (app.sim) {
            const net = app.sim.byPin.get(wire.a);
            if (net) color = SIGCOLOR[app.sim.netVal[net.id]];
          }
          if (sel) color = K.theme.cv.sel; else if (hov) color = K.theme.cv.wireHi;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.4;
          ctx.lineJoin = "round";
          ctx.beginPath();
          path.forEach((p, i) => { const [sx, sy] = S(p); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
          ctx.stroke();
          continue;
        }

        const layout = this._bundleLayout(wires);
        if (!layout) continue;
        this._bundles.push({ key, wires, layout });
        const sel = app.selection && app.selection.kind === "bundle" && app.selection.key === key;
        const selWire = app.selection && app.selection.kind === "wire" ? app.selection.wire : null;
        const hovB = this.hover && this.hover.kind === "bundle" && this.hover.key === key;
        const base = sel ? K.theme.cv.sel : hovB ? K.theme.cv.busHi : K.theme.cv.bus;

        // leads: per-bit curves, live signal colors while running
        for (const lead of layout.leads) {
          let c = K.theme.cv.lead;
          if (app.sim) {
            const net = app.sim.byPin.get(lead.wire.a);
            if (net) c = SIGCOLOR[app.sim.netVal[net.id]];
          }
          if (lead.wire === selWire) c = K.theme.cv.sel;
          else if (this.hover && this.hover.kind === "wire" && this.hover.wire === lead.wire) c = K.theme.cv.wireHi;
          else if (sel) c = K.theme.cv.selLead;
          ctx.strokeStyle = c;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          const [x0, y0] = S(lead.pts[0]);
          const [x1, y1] = S(lead.pts[1]);
          const [x2, y2] = S(lead.pts[2]);
          const [x3, y3] = S(lead.pts[3]);
          ctx.moveTo(x0, y0);
          ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
          ctx.stroke();
        }

        // trunk: thick, straight, mitered corners
        ctx.strokeStyle = base;
        ctx.lineWidth = Math.max(3, z * 0.28);
        ctx.lineJoin = "miter";
        ctx.lineCap = "round";
        for (const seg of layout.spine) {
          ctx.beginPath();
          seg.forEach((p, i) => { const [sx, sy] = S(p); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
          ctx.stroke();
        }
        // tap nubs
        ctx.fillStyle = base;
        for (const t of layout.taps) {
          const [sx, sy] = S(t.pos);
          ctx.beginPath(); ctx.arc(sx, sy, Math.max(2, z * 0.16), 0, Math.PI * 2); ctx.fill();
        }

        // slash + width + name + live hex on the longest spine segment
        if (z > 7 && layout.spine.length) {
          let best = null, bestLen = 0;
          for (const seg of layout.spine) for (let i = 0; i < seg.length - 1; i++) {
            const L = Math.hypot(seg[i + 1][0] - seg[i][0], seg[i + 1][1] - seg[i][1]);
            if (L > bestLen) { bestLen = L; best = [seg[i], seg[i + 1]]; }
          }
          if (best && bestLen > 3.5) {
            const mx = (best[0][0] + best[1][0]) / 2, my = (best[0][1] + best[1][1]) / 2;
            const horiz = Math.abs(best[1][0] - best[0][0]) > Math.abs(best[1][1] - best[0][1]);
            const [sx, sy] = S([mx, my]);
            // the classic slash tick
            ctx.strokeStyle = base;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            if (horiz) { ctx.moveTo(sx - z * 0.22, sy + z * 0.3); ctx.lineTo(sx + z * 0.22, sy - z * 0.3); }
            else { ctx.moveTo(sx - z * 0.3, sy + z * 0.22); ctx.lineTo(sx + z * 0.3, sy - z * 0.22); }
            ctx.stroke();
            const bits = new Set(wires.map(w => this._bitOf(w))).size;   // distinct bits, not wire count
            // one distinct bit = a net fanned out to several pins, not a bus:
            // keep the gather visuals but don't invent a bus name or value
            const name = bits > 1 ? this._busName(wires) : null;
            const val = bits > 1 ? this._busValue(wires) : null;
            const label = (bits > 1 ? `${bits}` : `${wires.length}×`) + (name ? ` · ${name}` : "") + (val !== null ? ` = ${val}` : "");
            ctx.font = `${Math.max(8, Math.min(11, z * 0.62))}px monospace`;
            ctx.textAlign = horiz ? "center" : "left";
            ctx.textBaseline = "middle";
            const tx = horiz ? sx + z * 0.55 : sx + z * 0.45;
            const ty = horiz ? sy - z * 0.55 : sy - z * 0.0;
            const w = ctx.measureText(label).width;
            const bx = (horiz ? tx - w / 2 : tx) - 3, by = ty - 7, bw = w + 6, bh = 14;
            const clash = this._labelBoxes.some(b2 => bx < b2.x + b2.w && bx + bw > b2.x && by < b2.y + b2.h && by + bh > b2.y);
            if (!clash) {
              this._labelBoxes.push({ x: bx, y: by, w: bw, h: bh });
              ctx.fillStyle = K.theme.cv.labelBg;
              ctx.fillRect(bx, by, bw, bh);
              ctx.fillStyle = val !== null ? K.theme.cv.labelVal : K.theme.cv.label;
              ctx.fillText(label, tx, ty + 0.5);
            }
          }
        }
      }
    }

    renderComp(ctx, comp) {
      const def = K.chips[comp.type];
      const z = this.view.zoom * U;
      const r = this.bodyRect(comp);
      const [x, y] = this.toScreen(r.x, r.y);
      const w = r.w * z, h = r.h * z;
      const sel = this.app.selection && this.app.selection.kind === "comp" && this.app.selection.comp === comp;

      if (def.symbol) { this.renderSymbol(ctx, comp, def, x, y, w, h, z, sel); }
      else {
        // DIP body
        ctx.fillStyle = K.theme.cv.chip;
        ctx.strokeStyle = sel ? K.theme.cv.chipEdgeSel : K.theme.cv.chipEdge;
        ctx.lineWidth = sel ? 2 : 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 3);
        ctx.fill();
        ctx.stroke();
        // notch
        ctx.beginPath();
        ctx.arc(x + w / 2, y, z * 0.35, 0, Math.PI);
        ctx.strokeStyle = K.theme.cv.chipEdge;
        ctx.lineWidth = 1;
        ctx.stroke();
        // labels
        ctx.fillStyle = K.theme.cv.pinText;
        ctx.textAlign = "center";
        if (z > 6) {
          ctx.font = `${Math.min(11, z * 0.9)}px monospace`;
          ctx.textBaseline = "top";
          ctx.fillText(comp.props.ref || "", x + w / 2, y + z * 0.45);
          ctx.fillStyle = K.theme.cv.chipText;
          ctx.font = `${Math.min(10, z * 0.75)}px monospace`;
          ctx.save();
          ctx.translate(x + w / 2, y + h / 2);
          if (h > w * 1.4) ctx.rotate(-Math.PI / 2);
          ctx.textBaseline = "middle";
          ctx.fillText(def.type, 0, 0);
          ctx.restore();
        }
      }
      // pins
      for (const pin of def.pins) {
        const [[px, py], [bx, by]] = this.pinStub(comp, pin);
        const [sx, sy] = this.toScreen(px, py);
        const [ex, ey] = this.toScreen(bx, by);
        const isHover = this.hover && this.hover.kind === "pin" && this.hover.comp === comp && this.hover.pin === pin;
        let pc = K.theme.cv.chipText;
        if (this.app.sim) {
          const net = this.app.sim.byPin.get(K.pinKey(comp, pin.name));
          if (net && net.pins.length > 1) pc = SIGCOLOR[this.app.sim.netVal[net.id]];
        }
        ctx.strokeStyle = isHover ? K.theme.cv.sel : pc;
        ctx.lineWidth = isHover ? 2.5 : 1.4;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        // pin name inside body (max-mode CPUs relabel their dual-role pins)
        if (z > 8 && !def.symbol) {
          const aliased = def.maxAlias && this.app.isMaxStrapped(comp) && def.maxAlias[pin.name];
          ctx.fillStyle = isHover ? K.theme.cv.chipEdgeSel : aliased ? K.theme.cv.labelVal : K.theme.cv.pinText;
          ctx.font = `${Math.min(9, z * 0.62)}px monospace`;
          ctx.textBaseline = "middle";
          const shown = aliased || pin.name;
          const inv = shown.startsWith("~");
          const nm = inv ? shown.slice(1) : shown;
          let tx;
          if (pin.side === "L") { ctx.textAlign = "left"; tx = ex + 3; }
          else if (pin.side === "R") { ctx.textAlign = "right"; tx = ex - 3; }
          else { ctx.textAlign = "center"; tx = ex; }
          ctx.fillText(nm, tx, ey + (pin.side === "T" ? 8 : pin.side === "B" ? -8 : 0));
          if (inv) {
            const tw = ctx.measureText(nm).width;
            const lx = ctx.textAlign === "right" ? tx - tw : ctx.textAlign === "center" ? tx - tw / 2 : tx;
            const ly = ey + (pin.side === "T" ? 8 : pin.side === "B" ? -8 : 0) - Math.min(9, z * 0.62) / 2 - 1;
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            ctx.lineTo(lx + tw, ly);
            ctx.lineWidth = 0.8;
            ctx.strokeStyle = ctx.fillStyle;
            ctx.stroke();
          }
        }
        if (z > 16 && !def.symbol) {
          ctx.fillStyle = K.theme.cv.chipText;
          ctx.font = `${z * 0.4}px monospace`;
          ctx.textAlign = "center";
          ctx.fillText(String(pin.num), (sx + ex) / 2, (sy + ey) / 2 - 4);
        }
      }
    }

    renderSymbol(ctx, comp, def, x, y, w, h, z, sel) {
      const app = this.app;
      const netV = (pinName) => {
        if (!app.sim) return SIG.Z;
        const net = app.sim.byPin.get(K.pinKey(comp, pinName));
        return net ? app.sim.netVal[net.id] : SIG.Z;
      };
      ctx.strokeStyle = sel ? K.theme.cv.chipEdgeSel : K.theme.cv.chipEdge;
      ctx.fillStyle = K.theme.cv.chip;
      ctx.lineWidth = sel ? 2 : 1;
      const label = (txt, cx, cy, color) => {
        ctx.fillStyle = color || K.theme.cv.pinText;
        ctx.font = `${Math.min(10, z * 0.7)}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(txt, cx, cy);
      };
      switch (def.symbol) {
        case "vcc": {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          label("VCC", x + w / 2, y + h / 2, K.theme.cv.railV);
          break;
        }
        case "gnd": {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          label("GND", x + w / 2, y + h / 2, K.theme.cv.railG);
          break;
        }
        case "pullup": {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          label("4.7k", x + w / 2, y + h / 2, K.theme.cv.railV);
          break;
        }
        case "xtal": {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          label(comp.props.mhz + "M", x + w / 2, y + h / 2, K.theme.cv.clockText);
          break;
        }
        case "osc": {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          label("⎍ " + comp.props.hz + "Hz", x + w / 2, y + h / 2, K.theme.cv.clockText);
          break;
        }
        case "label": {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          label(comp.props.name, x + w / 2, y + h / 2, K.theme.cv.labelVal);
          break;
        }
        case "led": case "led8": {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          const n = def.symbol === "led" ? 1 : 8;
          const kLow = netV("K") !== SIG.H;
          for (let i = 0; i < n; i++) {
            const pin = def.symbol === "led" ? "A" : "A" + i;
            const lit = netV(pin) === SIG.H && kLow;
            const cy = y + (i + 1) * z;
            ctx.beginPath();
            ctx.arc(x + w / 2, def.symbol === "led" ? y + h / 2 : cy, z * 0.32, 0, Math.PI * 2);
            ctx.fillStyle = lit ? "#ff5252" : "#3a2020";
            ctx.fill();
            if (lit) {
              ctx.shadowColor = "#ff5252"; ctx.shadowBlur = 8;
              ctx.fill();
              ctx.shadowBlur = 0;
            }
            ctx.strokeStyle = K.theme.cv.chipEdge; ctx.lineWidth = 1; ctx.stroke();
          }
          break;
        }
        case "seg7": {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          const on = (p) => netV(p) === SIG.H && netV("CC") !== SIG.H;
          const sx = x + w * 0.25, sw = w * 0.5, sy = y + h * 0.15, sh = h * 0.7;
          const segs = {
            a: [sx, sy, sw, 3], g: [sx, sy + sh / 2, sw, 3], d: [sx, sy + sh, sw, 3],
            f: [sx, sy, 3, sh / 2], b: [sx + sw, sy, 3, sh / 2],
            e: [sx, sy + sh / 2, 3, sh / 2], c: [sx + sw, sy + sh / 2, 3, sh / 2],
          };
          for (const [sname, [rx, ry, rw, rh]] of Object.entries(segs)) {
            ctx.fillStyle = on(sname) ? "#ff5252" : "#2a1c1c";
            ctx.fillRect(rx - 1, ry - 1, rw, rh);
          }
          ctx.fillStyle = on("dp") ? "#ff5252" : "#2a1c1c";
          ctx.fillRect(x + w * 0.85, sy + sh, 4, 4);
          break;
        }
        case "spkr": {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          const chip = this.app.sim && this.app.sim.chipFor(comp.id);
          const f = chip ? chip.state.freq : 0;
          const active = chip && f > 0 && this.app.sim.t - chip.state.lastT < this.app.sim.hz / 50;
          const cx2 = x + w * 0.42, cy2 = y + h / 2;
          ctx.fillStyle = "#3b4757";
          ctx.fillRect(cx2 - z * 0.7, cy2 - z * 0.5, z * 0.7, z);
          ctx.beginPath();
          ctx.moveTo(cx2, cy2 - z * 0.5); ctx.lineTo(cx2 + z * 0.8, cy2 - z * 1.1);
          ctx.lineTo(cx2 + z * 0.8, cy2 + z * 1.1); ctx.lineTo(cx2, cy2 + z * 0.5);
          ctx.closePath();
          ctx.fillStyle = active ? "#e5c07b" : "#556274";
          ctx.fill();
          if (active) {
            ctx.strokeStyle = "#e5c07b"; ctx.lineWidth = 1.2;
            for (const r of [1.3, 1.9]) {
              ctx.beginPath();
              ctx.arc(cx2 + z * 0.8, cy2, z * r, -0.7, 0.7);
              ctx.stroke();
            }
            label(f >= 1000 ? (f / 1000).toFixed(1) + "k" : f + "Hz", x + w / 2, y + h - z * 0.6, K.theme.cv.glow);
          }
          break;
        }
        case "printer": {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          const chip = this.app.sim && this.app.sim.chipFor(comp.id);
          ctx.fillStyle = "#3b4757";
          ctx.beginPath(); ctx.roundRect(x + w * 0.15, y + h * 0.35, w * 0.7, h * 0.4, 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#e8e6df";
          ctx.fillRect(x + w * 0.3, y + h * 0.12, w * 0.4, h * 0.3);
          if (chip && chip.state.busyT > 0) {
            ctx.fillStyle = "#e5c07b";
            ctx.beginPath(); ctx.arc(x + w * 0.78, y + h * 0.45, z * 0.2, 0, Math.PI * 2); ctx.fill();
          }
          label(chip ? chip.state.chars + " ch" : "LPT", x + w / 2, y + h * 0.88, "#9aa7b8");
          break;
        }
        case "sw8": {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          for (let i = 0; i < 8; i++) {
            const onBit = (comp.props.bits >> i) & 1;
            const cy = y + (i + 1) * z;
            ctx.fillStyle = "#2a3446";
            ctx.fillRect(x + z * 0.5, cy - z * 0.32, z * 1.6, z * 0.64);
            ctx.fillStyle = onBit ? "#4ec9b0" : "#5f7186";
            ctx.fillRect(x + z * 0.5 + (onBit ? z * 0.85 : 0), cy - z * 0.3, z * 0.72, z * 0.6);
          }
          break;
        }
        case "btn": {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          ctx.beginPath();
          ctx.arc(x + w / 2, y + h / 2, z * 0.55, 0, Math.PI * 2);
          ctx.fillStyle = comp.props.pressed ? "#14432f" : "#3a4556";
          ctx.fill();
          ctx.strokeStyle = comp.props.pressed ? "#4ec9b0" : "#45566c";
          ctx.stroke();
          break;
        }
        case "keyboard": {
          // period mechanical keyboard; keys depress as the user types
          ctx.fillStyle = "#2b3240";
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke();
          const pad = z * 0.5;
          const rows = K.KBD_LAYOUT;
          const rowH = (h - pad * 2 - z * 0.9) / rows.length;
          const totalU = 15.6;
          const unit = (w - pad * 2) / totalU;
          const pressed = K.KbdCapture ? K.KbdCapture.pressed : new Set();
          let ky = y + pad;
          for (const row of rows) {
            let kx = x + pad;
            for (const [lab, sc, wu] of row) {
              const kw = unit * wu - 1.5;
              const isDown = pressed.has(sc);
              ctx.fillStyle = isDown ? "#14432f" : "#3a4556";
              ctx.beginPath(); ctx.roundRect(kx, ky + (isDown ? 1.5 : 0), kw, rowH - 2.5, 2.5); ctx.fill();
              if (!isDown) {
                ctx.fillStyle = "rgba(255,255,255,0.07)";
                ctx.beginPath(); ctx.roundRect(kx, ky, kw, (rowH - 2.5) * 0.45, 2.5); ctx.fill();
              }
              if (z > 7) {
                ctx.fillStyle = isDown ? "#4ec9b0" : "#9aa8b8";
                ctx.font = `${Math.min(8, z * 0.5)}px monospace`;
                ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.fillText(lab, kx + kw / 2, ky + rowH / 2 + (isDown ? 1 : 0));
              }
              kx += unit * wu;
            }
            ky += rowH;
          }
          if (z > 7) label("µSYSTEM XT-84 · type on YOUR keyboard while running", x + w / 2, y + h - z * 0.5, "#5f7186");
          break;
        }
        case "crt": {
          // monitor shell
          ctx.fillStyle = "#242b35";
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
          const ix = x + z * 0.7, iy = y + z * 0.6, iw = w - z * 1.4, ih = h - z * 2.0;
          ctx.fillStyle = "#04100a";
          ctx.beginPath(); ctx.roundRect(ix, iy, iw, ih, 6); ctx.fill();
          const mini = K.renderCrtMini && K.renderCrtMini(app, comp);
          if (mini) ctx.drawImage(mini, ix + 2, iy + 2, iw - 4, ih - 4);
          else if (z > 6) label("· no signal ·", x + w / 2, iy + ih / 2, "#2f4a3d");
          ctx.strokeStyle = K.theme.cv.chipEdge;
          ctx.beginPath(); ctx.roundRect(ix, iy, iw, ih, 6); ctx.stroke();
          if (z > 7) label("MONO-12", x + w / 2, y + h - z * 0.7, "#5f7186");
          break;
        }
        default: {
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke();
          label(def.type, x + w / 2, y + h / 2);
        }
      }
    }

    // ---- hit testing ----
    hitTest(sx, sy) {
      const [gx, gy] = this.toGrid(sx, sy);
      for (const comp of this.app.doc.components) {
        const def = K.chips[comp.type];
        for (const pin of def.pins) {
          const [px, py] = this.pinPos(comp, pin);
          if (Math.hypot(gx - px, gy - py) < 0.55) return { kind: "pin", comp, pin };
        }
      }
      for (const comp of [...this.app.doc.components].reverse()) {
        const r = this.bodyRect(comp);
        if (gx >= r.x && gx <= r.x + r.w && gy >= r.y && gy <= r.y + r.h) return { kind: "comp", comp };
      }
      let best = null, bestD = 0.35;
      const bundledIds = new Set();
      if (this._bundles) {
        for (const b of this._bundles) {
          for (const lead of b.layout.leads) {
            bundledIds.add(lead.wire.id);
            // sample the bezier into a short polyline for distance testing
            const P = lead.pts;
            let prev = P[0];
            for (let t = 1; t <= 8; t++) {
              const u = t / 8, v = 1 - u;
              const pt = [
                v * v * v * P[0][0] + 3 * v * v * u * P[1][0] + 3 * v * u * u * P[2][0] + u * u * u * P[3][0],
                v * v * v * P[0][1] + 3 * v * v * u * P[1][1] + 3 * v * u * u * P[2][1] + u * u * u * P[3][1],
              ];
              const d = distToSeg(gx, gy, prev, pt);
              if (d < bestD) { bestD = d; best = { kind: "wire", wire: lead.wire }; }
              prev = pt;
            }
          }
          for (const seg of b.layout.spine) {
            for (let i = 0; i < seg.length - 1; i++) {
              const d = distToSeg(gx, gy, seg[i], seg[i + 1]);
              // the trunk is fat, but individual leads win close calls
              if (d < 0.45 && d - 0.12 < bestD) { bestD = Math.max(0, d - 0.12); best = { kind: "bundle", key: b.key, wires: b.wires }; }
            }
          }
        }
      }
      for (const wire of this.app.doc.wires) {
        if (bundledIds.has(wire.id)) continue;
        // in no-wire mode only the rendered subset is clickable
        const path = this._singlePaths && this._singlePaths.get(wire.id)
          ? this._singlePaths.get(wire.id)
          : (this.app.hideWires ? null : this.wirePath(wire));
        if (!path) continue;
        for (let i = 0; i < path.length - 1; i++) {
          const d = distToSeg(gx, gy, path[i], path[i + 1]);
          if (d < bestD) { bestD = d; best = { kind: "wire", wire }; }
        }
      }
      return best;
    }

    // ---- events ----
    bind() {
      const cv = this.cv, app = this.app;
      cv.addEventListener("wheel", (e) => {
        e.preventDefault();
        const [gx, gy] = this.toGrid(e.offsetX, e.offsetY);
        const f = Math.exp(-e.deltaY * 0.0015);
        this.view.zoom = K.clamp(this.view.zoom * f, 0.25, 6);
        const [gx2, gy2] = this.toGrid(e.offsetX, e.offsetY);
        this.view.x += gx - gx2;
        this.view.y += gy - gy2;
      }, { passive: false });

      cv.addEventListener("contextmenu", (e) => e.preventDefault());
      cv.addEventListener("mousedown", (e) => {
        if (e.button === 2) {
          // right-click: deletes the CURRENT selection when clicked again,
          // otherwise selects (so the next right-click deletes)
          if (app.mode !== "edit") return;
          const hit = this.hitTest(e.offsetX, e.offsetY);
          if (!hit) return;
          const sel = app.selection;
          const same = sel && (
            (hit.kind === "comp" && sel.kind === "comp" && sel.comp === hit.comp) ||
            (hit.kind === "wire" && sel.kind === "wire" && sel.wire === hit.wire) ||
            (hit.kind === "bundle" && sel.kind === "bundle" && sel.key === hit.key));
          if (same) {
            app.deleteSelection();
            app.setHint("deleted — Ctrl+Z undoes");
          } else if (hit.kind === "comp") app.select({ kind: "comp", comp: hit.comp });
          else if (hit.kind === "wire") app.select({ kind: "wire", wire: hit.wire });
          else if (hit.kind === "bundle") app.select({ kind: "bundle", key: hit.key, wires: hit.wires });
          return;
        }
        const hit = this.hitTest(e.offsetX, e.offsetY);
        if (app.placing && e.button === 0) {
          const [gx, gy] = this.toGrid(e.offsetX, e.offsetY).map(Math.round);
          app.placeAt(gx, gy);
          return;
        }
        if (e.button === 1 || (e.button === 0 && (!hit || e.altKey))) {
          this.drag = { kind: "pan", sx: e.offsetX, sy: e.offsetY, vx: this.view.x, vy: this.view.y };
          if (!hit) app.select(null);
          return;
        }
        if (e.button !== 0) return;
        if (hit.kind === "pin") {
          if (app.mode === "edit") app.pinClicked(hit, e.shiftKey);
          return;
        }
        if (hit.kind === "comp") {
          if (app.mode === "edit") {
            app.select({ kind: "comp", comp: hit.comp });
            const [gx, gy] = this.toGrid(e.offsetX, e.offsetY);
            this.drag = { kind: "move", comp: hit.comp, dx: gx - hit.comp.x, dy: gy - hit.comp.y };
          } else {
            app.select({ kind: "comp", comp: hit.comp });
            const [, gy] = this.toGrid(e.offsetX, e.offsetY);
            app.runModeClick(hit.comp, gy - hit.comp.y);
          }
          return;
        }
        if (hit.kind === "wire") app.select({ kind: "wire", wire: hit.wire });
        if (hit.kind === "bundle") app.select({ kind: "bundle", key: hit.key, wires: hit.wires });
      });

      cv.addEventListener("mousemove", (e) => {
        this.mousePos = [e.offsetX, e.offsetY];
        if (this.drag) {
          if (this.drag.kind === "pan") {
            const z = this.view.zoom * U;
            this.view.x = this.drag.vx - (e.offsetX - this.drag.sx) / z;
            this.view.y = this.drag.vy - (e.offsetY - this.drag.sy) / z;
          } else if (this.drag.kind === "move") {
            const [gx, gy] = this.toGrid(e.offsetX, e.offsetY);
            this.drag.comp.x = Math.round(gx - this.drag.dx);
            this.drag.comp.y = Math.round(gy - this.drag.dy);
          }
          return;
        }
        this.hover = this.hitTest(e.offsetX, e.offsetY);
        app.updateTooltip(this.hover, e.clientX, e.clientY);
      });

      cv.addEventListener("mouseup", () => {
        if (this.drag && this.drag.kind === "move") this.app.docChanged();
        this.drag = null;
        this.app.runModeRelease();
      });
      cv.addEventListener("mouseleave", () => { this.hover = null; app.updateTooltip(null); });
    }
  };

  function distToSeg(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / len2 : 0;
    t = K.clamp(t, 0, 1);
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }
})(globalThis.K8086 ??= {});
