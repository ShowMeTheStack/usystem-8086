"use strict";
(function (K) {
  if (typeof document === "undefined") return;
  const h = (...a) => K.h(...a);
  const hx = (v, w) => (v >>> 0).toString(16).toUpperCase().padStart(w || 4, "0");

  // Source-level debugger UI: editor gutter with breakpoints and the current
  // line, and the Debug tab (stepping, watches, breakpoints, watchpoints,
  // call stack, live disassembly, trace). The engine lives in 26-debug.js;
  // everything here resolves SOURCE LINES to exact physical addresses through
  // the proved memory map (all mirrors), so breakpoints are never heuristic.
  const LINEH = 17;

  K.DebugUI = {
    init(app) {
      this.app = app;
      const ta = document.getElementById("codeEditor");
      ta.addEventListener("scroll", () => this.syncScroll());
      ta.addEventListener("input", () => this.gutterSoon());
      ta.addEventListener("keyup", () => this.updateCaretLine());
      ta.addEventListener("click", () => this.updateCaretLine());
      document.getElementById("asmGutter").addEventListener("mousedown", (e) => {
        const line = Math.floor((e.offsetY + e.target.closest("#asmGutter").scrollTop) / LINEH) + 1;
        const row = e.target.closest(".gLine");
        const ln = row ? +row.dataset.line : line;
        if (e.shiftKey) this.editLineBpCond(ln);
        else this.toggleLineBp(ln);
        e.preventDefault();
      });
      this.renderGutter();
    },

    // ---- source <-> address resolution --------------------------------------
    romComp(app) {
      app = app || this.app;
      if (app.preset && app.preset.romComp && app.presetNames[app.preset.romComp])
        return app.presetNames[app.preset.romComp];
      return app.doc.components.find(c => K.chips[c.type].isRom) || null;
    },
    // physical breakpoint addresses (every mirror) for an assembler address
    physForAsmAddr(app, asmAddr) {
      const rom = this.romComp(app);
      if (!rom || !app.memMap || !app.lastAsm) return [];
      const cpu = app.doc.components.find(c => K.chips[c.type].isCpu);
      const cpuMap = cpu && app.memMap.cpus.find(c => c.compId === cpu.id);
      if (!cpuMap) return [];
      const size = K.chips[rom.type].probe.size;
      return K.Debug.physOf(cpuMap, rom.id, asmAddr & (size - 1));
    },
    lineToEntry(app, line) {
      if (!app.lastAsm) return null;
      // the clicked line, or the next one that assembles to bytes
      return app.lastAsm.listing
        .filter(l => l.len > 0 && l.line >= line)
        .sort((a, b) => a.line - b.line)[0] || null;
    },
    addrToLine(app, phys) {
      const rom = this.romComp(app);
      if (!rom || !app.memMap || !app.lastAsm) return null;
      const cpu = app.doc.components.find(c => K.chips[c.type].isCpu);
      const cpuMap = cpu && app.memMap.cpus.find(c => c.compId === cpu.id);
      if (!cpuMap) return null;
      const r = K.memMapResolve(cpuMap, phys);
      if (!r || r.compId !== rom.id) return null;
      const size = K.chips[rom.type].probe.size;
      const asmAddr = r.local | (app.lastAsm.org & ~(size - 1));
      const e = app.lastAsm.listing.find(l => l.len > 0 && l.addr === asmAddr);
      return e ? e.line : null;
    },

    // ---- line breakpoints ---------------------------------------------------
    toggleLineBp(line) {
      const app = this.app;
      const dbg = app.dbg;
      if (dbg.lineBps.has(line)) dbg.lineBps.delete(line);
      else dbg.lineBps.set(line, {});
      this.resyncLineBps(app);
      this.renderGutter();
      this.refresh();
      app.scheduleAutosave();
    },
    editLineBpCond(line) {
      const app = this.app;
      const bp = app.dbg.lineBps.get(line) || {};
      const cond = prompt("Break on line " + line + " only when (e.g. AX==5, CX>2 && ZF):", bp.cond || "");
      if (cond === null) return;
      bp.cond = cond.trim() || undefined;
      app.dbg.lineBps.set(line, bp);
      this.resyncLineBps(app);
      this.renderGutter();
      this.refresh();
      app.scheduleAutosave();
    },
    // rebuild the engine's physical breakpoints from the line set (after any
    // assemble, board start, or breakpoint edit)
    resyncLineBps(app) {
      const dbg = app.dbg;
      for (const [a, bp] of [...dbg.bpAddr]) if (bp.fromLine !== undefined) dbg.bpAddr.delete(a);
      if (!app.lastAsm) return;
      for (const [line, bp] of dbg.lineBps) {
        const entry = this.lineToEntry(app, line);
        if (!entry) continue;
        // ONE shared object across all mirrors: hit counts and limits stay whole
        const shared = { cond: bp.cond, hitLimit: bp.hitLimit, enabled: bp.enabled,
          hits: 0, line, fromLine: line };
        for (const phys of this.physForAsmAddr(app, entry.addr))
          dbg.bpAddr.set(phys, shared);
      }
    },

    // ---- gutter -------------------------------------------------------------
    gutterSoon() {
      clearTimeout(this._gt);
      this._gt = setTimeout(() => this.renderGutter(), 150);
    },
    renderGutter() {
      const app = this.app;
      const g = document.getElementById("asmGutter");
      if (!g) return;
      const lines = document.getElementById("codeEditor").value.split("\n").length;
      const cur = this.currentLine();
      let html = "";
      for (let i = 1; i <= lines; i++) {
        const bp = app.dbg && app.dbg.lineBps.get(i);
        html += `<div class="gLine${bp ? " bp" : ""}${bp && bp.cond ? " cond" : ""}${i === cur ? " cur" : ""}" data-line="${i}">` +
          `<span class="gDot"></span>${i === cur ? "▶" : i}</div>`;
      }
      g.innerHTML = html;
      this.syncScroll();
      this.positionHighlight(cur);
    },
    currentLine() {
      const app = this.app;
      if (!app.sim || !app.paused) return null;
      const chip = this.focusCpu();
      if (!chip) return null;
      const a = chip.state.arch;
      return this.addrToLine(app, ((a.s[1] << 4) + a.ip) & 0xFFFFF);
    },
    positionHighlight(cur) {
      const hl = document.getElementById("srcHighlight");
      const ta = document.getElementById("codeEditor");
      if (!hl) return;
      if (cur == null) { hl.style.display = "none"; return; }
      const top = (cur - 1) * LINEH + 4 - ta.scrollTop;   // 4 = textarea padding
      if (top < -LINEH || top > ta.clientHeight) { hl.style.display = "none"; return; }
      hl.style.display = "block";
      hl.style.top = top + "px";
    },
    syncScroll() {
      const ta = document.getElementById("codeEditor");
      const g = document.getElementById("asmGutter");
      if (g) g.scrollTop = ta.scrollTop;
      this.positionHighlight(this.currentLine());
    },
    updateCaretLine() {
      const ta = document.getElementById("codeEditor");
      this.caretLine = ta.value.slice(0, ta.selectionStart).split("\n").length;
    },
    scrollToLine(line) {
      const ta = document.getElementById("codeEditor");
      const want = (line - 1) * LINEH;
      if (want < ta.scrollTop + LINEH || want > ta.scrollTop + ta.clientHeight - 2 * LINEH)
        ta.scrollTop = Math.max(0, want - ta.clientHeight / 2);
      this.syncScroll();
    },

    // ---- stepping -----------------------------------------------------------
    focusCpu() {
      const app = this.app;
      if (!app.sim) return null;
      const cpus = app.sim.chips.filter(c => c.def.isCpu);
      return cpus.find(c => c.comp.id === app.dbgFocusId) || cpus[0] || null;
    },
    clearStop() {
      const app = this.app;
      if (!app.sim) return;
      app.sim.dbgStop = false;
      if (app.sim.dbg) app.sim.dbg.hit = null;
    },
    cont() {
      const app = this.app;
      if (!app.sim) return;
      this.clearStop();
      app.paused = false;
      document.getElementById("btnPause").textContent = "⏸ Pause";
      app.setHint("running — F5 pauses at the next breakpoint");
    },
    stepInto() {
      const app = this.app;
      if (!app.sim || !app.paused) return;
      this.clearStop();
      app.stepInsn();
      this.afterStep();
    },
    curInsn() {
      const app = this.app;
      const chip = this.focusCpu();
      if (!chip) return null;
      const a = chip.state.arch;
      const phys = ((a.s[1] << 4) + a.ip) & 0xFFFFF;
      const row = K.Debug.disasmAt(app.sim, chip.comp.id, phys, 1)[0];
      return { chip, phys, ip: a.ip, row };
    },
    stepOver() {
      const app = this.app;
      if (!app.sim || !app.paused) return;
      const cur = this.curInsn();
      if (!cur) return;
      const t = cur.row.text;
      if (/^(call|int\b|into)/i.test(t) || /^rep/i.test(t)) {
        this.clearStop();
        app.dbg.bpAddr.set((cur.phys + cur.row.len) & 0xFFFFF, { temp: true });
        this.cont();
      } else this.stepInto();
    },
    stepOut() {
      const app = this.app;
      if (!app.sim || !app.paused) return;
      const chip = this.focusCpu();
      const depth0 = (chip.runtime.dbgStack || []).length;
      if (!depth0) { app.setHint("already at the outermost frame"); return; }
      this.clearStop();
      app.dbg.until = (sim, c) => c === chip && c.runtime.dbgStack.length < depth0;
      this.cont();
    },
    runToCursor() {
      const app = this.app;
      if (!app.sim || !app.paused) return;
      const entry = this.lineToEntry(app, this.caretLine || 1);
      if (!entry) { app.setHint("no code at or after the caret line"); return; }
      const phys = this.physForAsmAddr(app, entry.addr);
      if (!phys.length) { app.setHint("line is not in mapped ROM"); return; }
      this.clearStop();
      for (const p of phys) if (!app.dbg.bpAddr.has(p)) app.dbg.bpAddr.set(p, { temp: true });
      this.cont();
    },
    stepBack() {
      const app = this.app;
      if (!app.sim || !app.paused) return;
      const dbg = app.dbg;
      const n = dbg.trace.n;
      if (n < 1) { app.setHint("no history to step back into"); return; }
      const target = n >= 2 ? K.Debug.traceEntry(dbg, n - 2).t : app.snaps[0].t;
      app.seekToT(target);
      this.afterStep();
    },
    afterStep() {
      const app = this.app;
      this.renderGutter();
      const line = this.currentLine();
      if (line) this.scrollToLine(line);
      this.refresh();
      if (app.tab === "cpu") K.renderCpuPanel(document.getElementById("cpuPane"), app);
    },

    // ---- the Debug tab ------------------------------------------------------
    refresh() {
      if (this.app.tab === "debug") this.renderPanel(document.getElementById("debugPane"));
    },
    renderPanel(pane) {
      const app = this.app;
      const dbg = app.dbg;
      pane.innerHTML = "";
      const paused = app.sim && app.paused;

      // stepping controls
      pane.append(h("div", { class: "dbgBtns" },
        h("button", { disabled: !app.sim, title: "continue (F5)", onclick: () => paused ? this.cont() : app.pauseResume() },
          paused || !app.sim ? "▶ continue" : "⏸ pause"),
        h("button", { disabled: !paused, title: "one instruction, descending into CALL/INT (F11) — DEBUG.COM's Trace", onclick: () => this.stepInto() }, "⤵ trace"),
        h("button", { disabled: !paused, title: "execute a whole CALL / INT / REP as one step (F10) — DEBUG.COM's Proceed", onclick: () => this.stepOver() }, "⤼ over call"),
        h("button", { disabled: !paused, title: "run until the current subroutine RETs (Shift+F11)", onclick: () => this.stepOut() }, "⤴ to ret"),
        h("button", { disabled: !paused, title: "run to the caret line (Ctrl+F10)", onclick: () => this.runToCursor() }, "▸│ to caret"),
        h("button", { disabled: !paused, title: "UN-execute one instruction (time travel via the rewind history)", onclick: () => this.stepBack() }, "↩ un-step")));

      // status
      const chip = this.focusCpu();
      let status = "start the simulation to debug (breakpoints survive)";
      if (app.sim && chip) {
        const a = chip.state.arch;
        const phys = ((a.s[1] << 4) + a.ip) & 0xFFFFF;
        const line = this.addrToLine(app, phys);
        status = (paused ? "paused at " : "running · ") + hx(a.s[1]) + ":" + hx(a.ip) +
          (line ? " — line " + line : " — no source (disassembly below)");
        if (dbg.hit) {
          const hits = { bp: "breakpoint", memwatch: "memory watchpoint", iowatch: "IO watchpoint", until: "step" };
          status = (hits[dbg.hit.kind] || dbg.hit.kind) +
            (dbg.hit.addr !== undefined && dbg.hit.kind !== "bp" ? " @ " + hx(dbg.hit.addr, 5) : "") +
            (dbg.hit.val != null ? " (wrote " + hx(dbg.hit.val) + ")" : "") + " · " + status;
        }
      }
      pane.append(h("div", { class: "dbgStatus" }, status));
      const cpus = app.sim ? app.sim.chips.filter(c => c.def.isCpu) : [];
      if (cpus.length > 1) {
        const sel = h("select", { class: "ctSel", onchange: (e) => { app.dbgFocusId = e.target.value; this.afterStep(); } },
          ...cpus.map(c => h("option", { value: c.comp.id, selected: chip === c ? "" : undefined },
            (c.comp.props.ref || c.comp.id) + " (" + c.comp.type + ")")));
        pane.append(h("div", { class: "dbgRow" }, "debug CPU: ", sel));
      }

      // ---- watches ----
      pane.append(h("div", { class: "dbgHead" }, "Watches"));
      const wbox = h("div", {});
      const ctx = app.sim && chip ? K.Debug.ctxFor(app.sim, chip, chip.state.arch) : null;
      this._watchPrev ??= new Map();
      for (const expr of dbg.watches) {
        let txt = "—", flash = false;
        if (ctx) {
          try {
            const v = K.Debug.evalExpr(expr, ctx) | 0;
            const ch = v >= 32 && v < 127 ? " '" + String.fromCharCode(v & 0xFF) + "'" : "";
            txt = hx(v & 0xFFFF) + "h · " + v + ch;
            flash = this._watchPrev.has(expr) && this._watchPrev.get(expr) !== v;
            this._watchPrev.set(expr, v);
          } catch (e) { txt = "? " + e.message; }
        }
        wbox.append(h("div", { class: "dbgRow" + (flash ? " flash" : "") },
          h("span", { class: "dbgExpr" }, expr),
          h("b", {}, txt),
          h("button", { class: "dbgX", onclick: () => { dbg.watches = dbg.watches.filter(w => w !== expr); this._watchPrev.delete(expr); this.refresh(); app.scheduleAutosave(); } }, "✕")));
      }
      const winp = h("input", { placeholder: "AX · w[counter] · b[ES:DI] · CX>2 && ZF", spellcheck: "false",
        onkeydown: (e) => { if (e.key === "Enter" && winp.value.trim()) { dbg.watches.push(winp.value.trim()); winp.value = ""; this.refresh(); app.scheduleAutosave(); } } });
      wbox.append(h("div", { class: "dbgRow" }, winp));
      pane.append(wbox);

      // ---- breakpoints ----
      pane.append(h("div", { class: "dbgHead" }, "Breakpoints"));
      const bbox = h("div", {});
      for (const [line, bp] of [...dbg.lineBps].sort((a, b) => a[0] - b[0]))
        bbox.append(this.bpRow(app, "line " + line, bp,
          () => { dbg.lineBps.delete(line); this.resyncLineBps(app); this.renderGutter(); },
          () => this.editLineBpCond(line)));
      const seenBp = new Set();                              // mirrors share one object
      for (const [addr, bp] of [...dbg.bpAddr].sort((a, b) => a[0] - b[0])) {
        if (bp.fromLine !== undefined || bp.temp || seenBp.has(bp)) continue;
        seenBp.add(bp);
        bbox.append(this.bpRow(app, (bp.note || hx(addr, 5) + "h"), bp,
          () => { for (const [a, b] of [...dbg.bpAddr]) if (b === bp) dbg.bpAddr.delete(a); },
          () => { const c = prompt("Condition:", bp.cond || ""); if (c !== null) { bp.cond = c.trim() || undefined; this.refresh(); } }));
      }
      const binp = h("input", { placeholder: "address or symbol, e.g. FE010h or sub1", spellcheck: "false", style: "width:150px",
        onkeydown: (e) => {
          if (e.key !== "Enter" || !binp.value.trim()) return;
          try {
            const v = K.Debug.evalExpr(binp.value.trim(), { r: [], s: [], ip: 0, fl: 0, symbols: (app.lastAsm && app.lastAsm.symbols) || {}, readMem: () => 0 });
            const phys = this.physForAsmAddr(app, v);
            const shared = { hits: 0, note: binp.value.trim() };
            if (phys.length) for (const p of phys) dbg.bpAddr.set(p, shared);
            else dbg.bpAddr.set(v & 0xFFFFF, shared);
            binp.value = "";
            this.refresh();
            app.scheduleAutosave();
          } catch (err) { app.setHint("breakpoint: " + err.message); }
        } });
      bbox.append(h("div", { class: "dbgRow" }, binp));
      pane.append(bbox);

      // ---- watchpoints ----
      pane.append(h("div", { class: "dbgHead" }, "Watchpoints",
        h("small", {}, " — break when an address is touched")));
      const wpbox = h("div", {});
      const wpRow = (list, wp, label) => h("div", { class: "dbgRow" },
        h("input", { type: "checkbox", checked: wp.enabled !== false ? "" : undefined,
          onchange: (e) => { wp.enabled = e.target.checked; app.scheduleAutosave(); } }),
        h("span", {}, `${label} ${hx(wp.from, label === "io" ? 2 : 5)}h${wp.to !== wp.from ? "-" + hx(wp.to, label === "io" ? 2 : 5) + "h" : ""} ${wp.mode}`),
        h("button", { class: "dbgX", onclick: () => { const i = list.indexOf(wp); list.splice(i, 1); this.refresh(); app.scheduleAutosave(); } }, "✕"));
      for (const wp of dbg.wps) wpbox.append(wpRow(dbg.wps, wp, "mem"));
      for (const wp of dbg.ioWps) wpbox.append(wpRow(dbg.ioWps, wp, "io"));
      const kindSel = h("select", { class: "ctSel" }, h("option", { value: "mem" }, "mem"), h("option", { value: "io" }, "io"));
      const modeSel = h("select", { class: "ctSel" }, h("option", { value: "w" }, "write"), h("option", { value: "r" }, "read"), h("option", { value: "rw" }, "r/w"));
      const fromI = h("input", { placeholder: "from (40h, counter)", spellcheck: "false", style: "width:105px" });
      const toI = h("input", { placeholder: "to", spellcheck: "false", style: "width:60px" });
      wpbox.append(h("div", { class: "dbgRow" }, kindSel, fromI, toI, modeSel,
        h("button", { onclick: () => {
          try {
            const syms = { r: [], s: [], ip: 0, fl: 0, symbols: (app.lastAsm && app.lastAsm.symbols) || {}, readMem: () => 0 };
            const from = K.Debug.evalExpr(fromI.value.trim(), syms);
            const to = toI.value.trim() ? K.Debug.evalExpr(toI.value.trim(), syms) : from;
            (kindSel.value === "mem" ? dbg.wps : dbg.ioWps).push({ from, to, mode: modeSel.value });
            fromI.value = toI.value = "";
            this.refresh();
            app.scheduleAutosave();
          } catch (err) { app.setHint("watchpoint: " + err.message); }
        } }, "＋ add")));
      pane.append(wpbox);

      // ---- call stack ----
      pane.append(h("div", { class: "dbgHead" }, "Call stack"));
      const stack = (chip && chip.runtime.dbgStack) || [];
      const sbox = h("div", {});
      if (!stack.length) sbox.append(h("div", { class: "dbgDim" }, app.sim ? "top level" : "—"));
      for (let i = stack.length - 1; i >= 0; i--) {
        const f = stack[i];
        sbox.append(h("div", { class: "dbgRow" }, h("span", {},
          f.kind === "int" ? `INT ${hx(f.vec, 2)}h handler` :
            `call → ${hx(f.to.cs)}:${hx(f.to.ip)}` +
            (this.addrToLine(app, ((f.to.cs << 4) + f.to.ip) & 0xFFFFF) ? " (line " + this.addrToLine(app, ((f.to.cs << 4) + f.to.ip) & 0xFFFFF) + ")" : ""))));
      }
      pane.append(sbox);

      // ---- disassembly around the current instruction ----
      if (paused && chip) {
        pane.append(h("div", { class: "dbgHead" }, "Disassembly"));
        const a = chip.state.arch;
        const phys = ((a.s[1] << 4) + a.ip) & 0xFFFFF;
        const dbox = h("div", { class: "dbgDisasm" });
        for (const row of K.Debug.disasmAt(app.sim, chip.comp.id, phys, 12)) {
          const has = dbg.bpAddr.has(row.addr);
          dbox.append(h("div", { class: "dbgRow mono" + (row.addr === phys ? " cur" : ""), title: "click to toggle a breakpoint here",
            onclick: () => { if (has) dbg.bpAddr.delete(row.addr); else dbg.bpAddr.set(row.addr, { hits: 0 }); this.refresh(); app.scheduleAutosave(); } },
            h("span", { class: "gDot" + (has ? " on" : "") }),
            h("span", {}, hx(row.addr, 5) + "  " + row.bytes.map(b => hx(b, 2)).join(" ").padEnd(19) + row.text)));
        }
        pane.append(dbox);
      }

      // ---- trace ----
      const n = dbg.trace.n;
      pane.append(h("div", { class: "dbgHead" }, `Trace (${Math.min(n, 200)} of ${n})`,
        h("span", { class: "spacer" }),
        h("button", { disabled: !n, onclick: () => this.exportTrace() }, "⇩ export")));
      if (paused && n && app.sim && chip) {
        const tbox = h("div", { class: "dbgTrace" });
        let prevRegs = null;
        for (let i = Math.max(0, n - 200); i < n; i++) {
          const e = K.Debug.traceEntry(dbg, i);
          const d = K.Debug.disasmAt(app.sim, e.chipId, e.addr, 1)[0];
          let delta = "";
          if (prevRegs) {
            const names = ["AX", "CX", "DX", "BX", "SP", "BP", "SI", "DI"];
            for (let ri = 0; ri < 8; ri++)
              if (e.r[ri] !== prevRegs[ri]) { delta = names[ri] + "←" + hx(e.r[ri]); break; }
          }
          prevRegs = e.r;
          const line = this.addrToLine(app, e.addr);
          tbox.append(h("div", { class: "dbgRow mono" + (i === n - 1 ? " cur" : ""),
            title: line ? "source line " + line + " — click to show" : "",
            onclick: line ? () => { app.showTab("code"); this.scrollToLine(line); } : undefined },
            h("span", { class: "dbgCyc" }, e.cyc + "c"),
            h("span", {}, hx(e.addr, 5) + "  " + d.text.padEnd(24) +
              (e.vec >= 0 ? " ⚡INT" + hx(e.vec, 2) : "") + (delta ? "  " + delta : ""))));
        }
        pane.append(tbox);
        tbox.scrollTop = tbox.scrollHeight;
      } else pane.append(h("div", { class: "dbgDim" }, app.sim ? (paused ? "no instructions retired yet" : "pause to inspect the trace") : "—"));
    },

    bpRow(app, label, bp, del, editCond) {
      return h("div", { class: "dbgRow" },
        h("input", { type: "checkbox", checked: bp.enabled !== false ? "" : undefined,
          onchange: (e) => { bp.enabled = e.target.checked; this.resyncLineBps(app); this.renderGutter(); app.scheduleAutosave(); } }),
        h("span", {}, label + (bp.cond ? " if " + bp.cond : "") + (bp.hitLimit ? ` (hit ≥${bp.hitLimit})` : "")
          + (bp.hits ? ` · ${bp.hits} hits` : "")),
        h("button", { class: "dbgX", title: "condition…", onclick: editCond }, "if"),
        h("button", { class: "dbgX", title: "hit count…", onclick: () => {
          const v = prompt("Stop only from the Nth hit (0 = every hit):", bp.hitLimit || 0);
          if (v !== null) { bp.hitLimit = +v || 0; this.resyncLineBps(app); this.refresh(); app.scheduleAutosave(); }
        } }, "№"),
        h("button", { class: "dbgX", onclick: () => { del(); this.refresh(); app.scheduleAutosave(); } }, "✕"));
    },

    exportTrace() {
      const app = this.app, dbg = app.dbg;
      const lines = [];
      for (let i = 0; i < dbg.trace.n; i++) {
        const e = K.Debug.traceEntry(dbg, i);
        const d = app.sim ? K.Debug.disasmAt(app.sim, e.chipId, e.addr, 1)[0] : { text: "?" };
        lines.push(`${hx(e.addr, 5)}  ${d.text.padEnd(26)} ${String(e.cyc).padStart(3)}c  AX=${hx(e.r[0])} BX=${hx(e.r[3])} CX=${hx(e.r[1])} DX=${hx(e.r[2])} SP=${hx(e.r[4])} SI=${hx(e.r[6])} DI=${hx(e.r[7])} FL=${hx(e.fl)}${e.vec >= 0 ? "  INT " + hx(e.vec, 2) : ""}`);
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
      a.download = "trace.txt";
      a.click();
    },

    // persistence: line bps live app-side; the engine serializes the rest
    serialize(app) {
      return {
        engine: K.Debug.serialize(app.dbg),
        lineBps: [...app.dbg.lineBps].map(([line, bp]) => [line, { cond: bp.cond || null, hitLimit: bp.hitLimit || 0, enabled: bp.enabled !== false }]),
        focus: app.dbgFocusId || null,
      };
    },
    deserialize(app, data) {
      app.dbg = K.Debug.deserialize(data && data.engine);
      app.dbg.lineBps = new Map((data && data.lineBps || []).map(([l, b]) => [+l, { ...b }]));
      app.dbgFocusId = (data && data.focus) || null;
    },
  };
})(globalThis.K8086 ??= {});
