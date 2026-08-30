"use strict";
(function (K) {
  if (typeof document === "undefined") return;
  const h = (...a) => K.h(...a);
  const SNAP_EVERY = 4096, MAX_SNAPS = 96;

  K.App = {
    doc: null, sim: null, mode: "edit", paused: false,
    history: [], future: [],
    placing: null, wireFrom: null, selection: null,
    lastAsm: null, snaps: [], speedIdx: 5,
    SPEEDS: [2, 10, 60, 300, 1500, 8000, 40000, 200000, 1000000, Infinity],

    init() {
      let themeName = null;
      try { themeName = localStorage.getItem("u8086.theme"); } catch { /* fine */ }
      K.applyTheme(themeName || "Midnight");
      this.buildDom();
      document.getElementById("themeSel").value = K.theme.name;
      this.initPanes();
      this.schematic = new K.Schematic(document.getElementById("schematic"), this);
      this.waveform = new K.Waveform(document.getElementById("waveCanvas"), document.getElementById("waveNames"), this);
      this.waveform.attachControls({
        h: document.getElementById("waveHZoom"),
        v: document.getElementById("waveVZoom"),
        scroll: document.getElementById("waveScroll"),
      });
      K.buildLibrary(document.getElementById("library"), this);
      K.DebugUI.deserialize(this, null);      // fresh debugger state (autosave may replace it)
      K.DebugUI.init(this);
      this.bindKeys();
      K.KbdCapture.attach(this);
      this.loadPreset("min-8088");
      document.getElementById("codeEditor").addEventListener("input", () => this.scheduleAutosave());
      this.offerAutosaveRestore();
      const loop = () => { this.frame(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    },

    // ---------------------------------------------------------------- DOM ----
    buildDom() {
      const app = this;
      const root = document.getElementById("app");
      root.append(
        h("div", { id: "topbar" },
          h("span", { class: "title" }, "µSystem 8086 ", h("small", {}, "v0.1")),
          h("select", { id: "presetSel", onchange: (e) => { if (e.target.value) app.loadPreset(e.target.value); } },
            K.presets.map(p => h("option", { value: p.id }, p.name))),
          h("button", { id: "btnStart", class: "primary", onclick: () => app.startStop() }, "▶ Start"),
          h("button", { id: "btnPause", onclick: () => app.pauseResume(), disabled: true }, "⏸ Pause"),
          h("button", { id: "btnStepC", onclick: () => app.stepCycle(), disabled: true, title: "one CPU clock cycle" }, "⭢ cycle"),
          h("button", { id: "btnStepI", onclick: () => app.stepInsn(), disabled: true, title: "one instruction" }, "⭢ insn"),
          h("span", { style: "color:var(--dim)" }, "speed"),
          h("input", { id: "speed", type: "range", min: 0, max: this.SPEEDS.length - 1, value: this.speedIdx, style: "width:90px", oninput: (e) => { app.speedIdx = +e.target.value; app.updateStatus(); } }),
          h("button", { id: "btnTurbo", disabled: true, title: "Tier B: memory through the proved map, IO through real pins — waveform capture pauses", onclick: () => app.toggleTurbo() }, "⚡ turbo"),
          h("span", { style: "color:var(--dim)" }, "rewind"),
          h("input", { id: "rewind", type: "range", min: 0, max: 1000, value: 1000, style: "width:120px", oninput: (e) => app.seekFrac(+e.target.value / 1000), disabled: true }),
          h("span", { class: "spacer" }),
          h("button", { id: "btnUndo", disabled: true, onclick: () => app.undo(), title: "undo (Ctrl+Z)" }, "↶"),
          h("button", { id: "btnRedo", disabled: true, onclick: () => app.redo(), title: "redo (Ctrl+Shift+Z / Ctrl+Y)" }, "↷"),
          h("button", { id: "btnLab", style: "display:none", onclick: () => app.openLab(), title: "guided exercise for this board" }, "📖 lab"),
          h("button", { id: "btnWires", class: "active", onclick: () => app.toggleWires(), title: "hide wires — the netlist stays; wire through the per-chip connection tables, hover pins to light up their nets" }, "〰 wires"),
          h("button", { id: "btnSweep", onclick: () => app.offerBoardSweep(true), title: "scan the whole board and offer to autowire every chip that can be completed right now" }, "⚡ complete"),
          h("button", { onclick: () => { app.ensureMemMap(); K.HexEditor.openUnified(app); }, title: "unified memory view across the validated address map" }, "▦ memory"),
          h("button", { onclick: () => K.DiskLib.open(app), title: "disk image library: FreeDOS built-ins, your images, import/export, populate from a folder" }, "🖴 disks"),
          h("button", { onclick: () => K.downloadCanvasPng(document.getElementById("schematic"), "board.png"), title: "screenshot the board" }, "📷 board"),
          h("button", { id: "btnGuide", title: "the illustrated guide: every feature, every board, every chip — opens in a new tab", onclick: () => window.open("guide/index.html", "_blank", "noopener") }, "📘 guide"),
          h("select", { id: "themeSel", title: "color scheme (10 dark, 10 light)", onchange: (e) => { K.applyTheme(e.target.value); } },
            h("optgroup", { label: "dark" }, K.THEMES.filter(t => t.mode === "dark").map(t => h("option", { value: t.name }, t.name))),
            h("optgroup", { label: "light" }, K.THEMES.filter(t => t.mode === "light").map(t => h("option", { value: t.name }, t.name)))),
          h("button", { onclick: () => app.saveDesign() }, "save"),
          h("button", { onclick: () => app.loadDesign() }, "load"),
          h("span", { id: "status" })),
        h("div", { id: "main" },
          h("div", { id: "library" }),
          h("div", { id: "splitL", class: "vsplit", title: "drag to resize · double-click to collapse the library" }),
          h("div", { id: "canvasWrap" },
            h("canvas", { id: "schematic" }),
            h("div", { id: "hint" }, ""),
            h("div", { id: "tooltip" })),
          h("div", { id: "splitR", class: "vsplit", title: "drag to resize · double-click to collapse the panel" }),
          h("div", { id: "right" },
            h("div", { id: "rightTabs" },
              h("button", { id: "tabCode", class: "active", onclick: () => app.showTab("code") }, "Code"),
              h("button", { id: "tabDebug", onclick: () => app.showTab("debug") }, "Debug"),
              h("button", { id: "tabCpu", onclick: () => app.showTab("cpu") }, "CPU"),
              h("button", { id: "tabChip", onclick: () => app.showTab("chip") }, "Chip"),
              h("button", { id: "tabDrc", onclick: () => app.showTab("drc") }, "Checks")),
            h("div", { id: "rightBody" },
              h("div", { id: "codePane" },
                h("div", { id: "editorWrap" },
                  h("div", { id: "asmGutter", title: "click: breakpoint · shift-click: conditional breakpoint" }),
                  h("div", { id: "editorBox" },
                    h("div", { id: "srcHighlight" }),
                    h("textarea", { id: "codeEditor", spellcheck: "false" }))),
                h("div", { id: "codeBtns" },
                  h("button", { onclick: () => app.assemble(true) }, "Assemble"),
                  h("span", { class: "spacer" })),
                h("div", { id: "asmOut" }, "")),
              h("div", { id: "debugPane", style: "display:none" }),
              h("div", { id: "cpuPane", style: "display:none" }),
              h("div", { id: "chipPane", style: "display:none" }),
              h("div", { id: "drcPane", style: "display:none" })))),
        h("div", { id: "splitW", class: "hsplit", title: "drag to resize · double-click to collapse the waveforms" }),
        h("div", { id: "wavePanel" },
          h("div", { id: "waveHeader" },
            h("button", { style: "padding:1px 6px", onclick: () => app.togglePane("waveC") }, "▤"),
            h("span", { class: "wtitle" }, "waveform analyzer"),
            h("button", { onclick: () => app.waveform.addDialog() }, "+ signal"),
            h("button", { id: "btnFollow", class: "active", onclick: () => { app.waveform.follow = !app.waveform.follow; document.getElementById("btnFollow").classList.toggle("active", app.waveform.follow); } }, "follow"),
            h("button", { onclick: () => { app.waveform.cursorT = null; } }, "clear cursor"),
            h("span", { class: "wzoom", title: "horizontal zoom — or pinch on the trackpad" }, "↔",
              h("input", { id: "waveHZoom", type: "range", min: 0, max: 1000, value: 286 })),
            h("span", { class: "wzoom", title: "vertical zoom (lane height)" }, "↕",
              h("input", { id: "waveVZoom", type: "range", min: 60, max: 250, value: 100 })),
            h("span", { class: "spacer" }),
            h("button", { onclick: () => K.downloadCanvasPng(document.getElementById("waveCanvas"), "waveforms.png") }, "📷 waves")),
          h("div", { id: "waveBody" },
            h("div", { id: "waveNames" }),
            h("div", { id: "waveCanvasWrap" },
              h("canvas", { id: "waveCanvas" }),
              h("input", { id: "waveScroll", type: "range", min: 0, max: 1000, value: 1000,
                title: "browse the recording — drag to the right edge to follow live again" })))),
        h("div", { id: "modal", onclick: (e) => { if (e.target.id === "modal") K.closeModal(); } },
          h("div", { id: "modalBox" })));
      // double-click: memory -> hex editor, CPU -> register panel,
      // running peripheral -> programmer's view, edit mode -> properties
      document.getElementById("schematic").addEventListener("dblclick", (e) => {
        const hit = this.schematic.hitTest(e.offsetX, e.offsetY);
        if (!hit || hit.kind !== "comp") return;
        const def = K.chips[hit.comp.type];
        this.select({ kind: "comp", comp: hit.comp });
        if (def.category === "Memory") K.HexEditor.open(this, hit.comp);
        else if (hit.comp.type === "CRT") K.CrtView.open(this, hit.comp);
        else if (def.isCpu) this.showTab("cpu");
        else if (this.sim) K.progView(this, hit.comp);
        else K.propsDialog(this, hit.comp);
      });
    },

    showTab(name) {
      for (const t of ["code", "debug", "cpu", "chip", "drc"]) {
        document.getElementById("tab" + t[0].toUpperCase() + t.slice(1)).classList.toggle("active", t === name);
        document.getElementById(t + "Pane").style.display = t === name ? (t === "code" ? "flex" : "block") : "none";
      }
      this.tab = name;
      if (name === "drc") K.renderDrcPanel(document.getElementById("drcPane"), K.runDrc(this.doc));
      if (name === "cpu") K.renderCpuPanel(document.getElementById("cpuPane"), this);
      if (name === "chip") K.renderChipPanel(document.getElementById("chipPane"), this);
      if (name === "debug") K.DebugUI.renderPanel(document.getElementById("debugPane"));
    },

    bindKeys() {
      window.addEventListener("keydown", (e) => {
        // debugger keys work everywhere, editor included (classic IDE bindings)
        if (e.key === "F5" && this.sim) { e.preventDefault(); this.paused ? K.DebugUI.cont() : this.pauseResume(); return; }
        if (e.key === "F9") { e.preventDefault(); K.DebugUI.updateCaretLine(); K.DebugUI.toggleLineBp(K.DebugUI.caretLine || 1); return; }
        if (e.key === "F10" && this.sim) { e.preventDefault(); e.ctrlKey ? K.DebugUI.runToCursor() : K.DebugUI.stepOver(); return; }
        if (e.key === "F11" && this.sim) { e.preventDefault(); e.shiftKey ? K.DebugUI.stepOut() : K.DebugUI.stepInto(); return; }
        if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
        if (e.key === "Escape") { this.placing = null; this.wireFrom = null; K.closeModal(); this.setHint(""); }
        if ((e.key === "Delete" || e.key === "Backspace") && this.mode === "edit" && this.selection) {
          this.deleteSelection();
          e.preventDefault();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
          e.shiftKey ? this.redo() : this.undo();
          e.preventDefault();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { this.redo(); e.preventDefault(); }
      });
    },

    // ------------------------------------------------------------- editing ----
    // current pin->net map: live sim nets while running, cached edit-time nets otherwise
    netsNow() {
      if (this.sim) return this.sim.byPin;
      if (!this._editNets) this._editNets = K.extractNets(this.doc).byPin;
      return this._editNets;
    },
    compOf(pinKey) { const id = pinKey.slice(0, pinKey.indexOf(".")); return K.docComp(this.doc, id); },
    pinOf(pinKey) {
      const comp = this.compOf(pinKey);
      if (!comp) return null;
      const name = pinKey.slice(pinKey.indexOf(".") + 1);
      return K.chips[comp.type].pins[K.chips[comp.type].pinIndex[name]];
    },

    ensureRefs() {
      // seed the counters from refs already on the board, so chips placed one
      // at a time keep getting UNIQUE designators (U1, U2, …) — an empty
      // counter here once named every single placement "U1"
      const counters = {}, seen = new Set();
      for (const comp of this.doc.components) {
        const m = comp.props.ref && /^([A-Z]+)(\d+)$/.exec(comp.props.ref);
        if (!m) continue;
        if (seen.has(comp.props.ref)) { delete comp.props.ref; continue; }  // heal old collisions
        seen.add(comp.props.ref);
        counters[m[1]] = Math.max(counters[m[1]] || 0, +m[2]);
      }
      for (const comp of this.doc.components) {
        if (comp.props.ref) continue;
        const def = K.chips[comp.type];
        const letter = def.isCpu ? "U" : def.category === "Memory" ? "U" : def.category === "Logic" || def.category === "System" ? "U"
          : comp.type === "XTAL" ? "Y" : def.category === "Clock" ? "Y" : def.category === "Power" ? "P" : "D";
        counters[letter] = (counters[letter] || 0) + 1;
        comp.props.ref = letter + counters[letter];
      }
    },

    loadPreset(id) {
      const preset = K.presetById(id);
      if (!preset) return;
      this.stop();
      const built = preset.build();
      this.doc = built.doc;
      this.preset = preset;
      this.presetNames = built.names || {};
      this.ensureRefs();
      document.getElementById("codeEditor").value = preset.defaultProgram ||
        "; write 8086 assembly here\n        org 0\nstart:  hlt\n";
      document.getElementById("presetSel").value = id;
      this.speedIdx = preset.speedIdx ?? 5;
      document.getElementById("speed").value = String(this.speedIdx);
      this.lastAsm = null;
      this.selection = null;
      this._sweepSeen = ""; this._sweepStuck?.clear();   // a fresh board resets the checkpoint memory
      K.DebugUI.deserialize(this, null);                 // new program: fresh breakpoints/watches
      K.DebugUI.renderGutter();
      this.waveform.autoPopulate();
      this.resetHistory();
      this.docChanged();
      document.getElementById("btnLab").style.display = preset.lab ? "" : "none";
      this.setHint("edit mode — drag chips, click pin→pin to wire (Shift = whole bus), double-click for properties");
    },

    // No-wire mode: canvas hides wires (netlist untouched); the connection
    // tables and pin-hover net glow carry the connectivity story instead.
    toggleWires() {
      this.hideWires = !this.hideWires;
      document.getElementById("btnWires").classList.toggle("active", !this.hideWires);
      this.setHint(this.hideWires
        ? "no-wire mode — hover a pin to light up its whole net; wire chips from their connection tables"
        : "");
    },

    // ---- resizable / collapsible panes; the canvas absorbs all slack -------
    initPanes() {
      let L = {};
      try { L = JSON.parse(localStorage.getItem("u8086.layout")) || {}; } catch { /* fresh */ }
      this._layout = { libW: 172, rightW: 340, waveH: 240, libC: false, rightC: false, waveC: false, ...L };
      const save = () => { try { localStorage.setItem("u8086.layout", JSON.stringify(this._layout)); } catch { /* fine */ } };
      const lib = document.getElementById("library");
      const right = document.getElementById("right");
      const wave = document.getElementById("wavePanel");
      const apply = () => {
        const l = this._layout;
        lib.style.width = l.libC ? "0px" : l.libW + "px";
        lib.style.padding = l.libC ? "0" : "";
        lib.style.overflow = l.libC ? "hidden" : "";
        lib.style.borderRight = l.libC ? "none" : "";
        right.style.width = l.rightC ? "0px" : l.rightW + "px";
        right.style.overflow = l.rightC ? "hidden" : "";
        right.style.borderLeft = l.rightC ? "none" : "";
        wave.classList.toggle("collapsed", l.waveC);
        if (!l.waveC) wave.style.height = l.waveH + "px";
        save();
      };
      this.applyLayout = apply;
      const dragify = (splitId, onDrag, onToggle) => {
        const el = document.getElementById(splitId);
        el.addEventListener("dblclick", () => { onToggle(); apply(); });
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const sx = e.clientX, sy = e.clientY, l0 = { ...this._layout };
          let moved = false;
          const mm = (ev) => {
            if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true;
            if (moved) { onDrag(ev.clientX - sx, ev.clientY - sy, l0); apply(); }
          };
          const mu = () => { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); };
          window.addEventListener("mousemove", mm);
          window.addEventListener("mouseup", mu);
        });
      };
      dragify("splitL",
        (dx, dy, l0) => { this._layout.libW = K.clamp(l0.libW + dx, 90, 400); this._layout.libC = false; },
        () => { this._layout.libC = !this._layout.libC; });
      dragify("splitR",
        (dx, dy, l0) => { this._layout.rightW = K.clamp(l0.rightW - dx, 200, 720); this._layout.rightC = false; },
        () => { this._layout.rightC = !this._layout.rightC; });
      dragify("splitW",
        (dx, dy, l0) => { this._layout.waveH = K.clamp(l0.waveH - dy, 60, 600); this._layout.waveC = false; },
        () => { this._layout.waveC = !this._layout.waveC; });
      apply();
    },
    togglePane(which) {                       // programmatic (and testable)
      this._layout[which] = !this._layout[which];
      this.applyLayout();
    },

    // Guided lab: numbered steps with session-scoped checkmarks per preset.
    openLab() {
      const preset = this.preset;
      if (!preset || !preset.lab) return;
      this._labDone ??= {};
      const done = this._labDone[preset.id] ??= new Set();
      const list = K.h("ol", { class: "labSteps" });
      preset.lab.forEach((step, i) => {
        const li = K.h("li", { class: done.has(i) ? "done" : "" },
          K.h("span", { class: "labCheck", onclick: () => {
            done.has(i) ? done.delete(i) : done.add(i);
            li.classList.toggle("done");
          } }),
          K.h("span", { class: "labText" }, step));
        list.append(li);
      });
      const body = K.h("div", { class: "labBody" },
        K.h("div", { class: "labIntro" }, preset.blurb),
        list);
      K.openModal("Lab — " + preset.name, body, [["Close", null, "primary"]]);
    },

    placeAt(gx, gy) {
      const comp = K.docAddComponent(this.doc, this.placing, gx, gy);
      this.ensureRefs();
      this.placing = null;
      this.select({ kind: "comp", comp });
      this.docChanged();
      this.setHint("");
      this.offerAutoconnect(comp);
    },

    // The autoconnect planner: after any placement, enumerate every design
    // completable RIGHT NOW involving the new chip (as subject or as the
    // missing piece). 0 plans -> whisper only. 1+ -> cards. Clock fan-out ->
    // a checklist. Each accepted plan is ONE undo step.
    offerAutoconnect(comp) {
      const { cards, checklist } = K.connPlans(this.doc, comp);
      const finish = (ctxNotes) => {
        this.ensureRefs();
        this.docChanged();
        if (ctxNotes) this.setHint("autoconnect: " + ctxNotes);
        this.whisper(ctxNotes);
        // checkpoint: what did this just enable? (truthy = a dialog opened)
        return this.offerBoardSweep(false, comp.id);
      };
      if (checklist) {
        const rows = checklist.rows.map(r => {
          const cb = K.h("input", { type: "checkbox", checked: "" });
          const mode = K.h("select", { class: "ctSel" },
            K.h("option", { value: "min" }, "minimum mode"),
            K.h("option", { value: "max" }, "maximum mode (adds 8288)"));
          return { r, cb, mode, el: K.h("div", { class: "acRow" }, K.h("label", {}, cb, " " + r.label), r.modes ? mode : "") };
        });
        const body = K.h("div", { class: "acBody" },
          K.h("div", {}, checklist.intro), ...rows.map(x => x.el));
        K.openModal(checklist.title, body, [
          ["Wire selected", () => {
            const sel = rows.filter(x => x.cb.checked).map(x => ({ compId: x.r.compId, mode: x.mode.value }));
            if (sel.length) {
              checklist.run(this.doc, sel);
              // finish may chain into the board sweep dialog: keep it open
              if (finish(`clocked ${sel.length} CPU${sel.length > 1 ? "s" : ""}`)) return false;
            } else this.whisper();
          }, "primary"],
          ["Skip", () => this.whisper(), ""],
        ]);
        return;
      }
      if (cards.length) {
        const body = K.h("div", { class: "acBody" },
          K.h("div", {}, `${comp.props.ref || comp.id} (${K.chips[comp.type].name}) — choose a hookup:`));
        for (const card of cards) {
          const btn = K.h("button", { class: "acPlan" + (card === cards[0] ? " primary" : ""), onclick: () => {
            K.closeModal();
            if (card.action && card.action.rangeCalc) {
              K.RangeCalc.open(this, comp);
              return;
            }
            const ctx = card.run(this.doc);
            finish(ctx && ctx.notes && ctx.notes.length ? ctx.notes.join(" · ") : card.title);
          } }, card.title);
          body.append(K.h("div", { class: "acPlanWrap" }, btn, K.h("div", { class: "acDesc" }, card.desc)));
        }
        body.append(K.h("div", { class: "acHint" }, "Skip to wire it by hand — every synthesized wire stays editable."));
        K.openModal("Autoconnect", body, [["Skip", () => this.whisper(), ""]]);
        return;
      }
      // nothing completable for the placed chip itself: maybe the board as a
      // whole has openings (this chip may be the piece others waited for)
      if (!this.offerBoardSweep(false, comp.id)) this.whisper();
    },

    // The board-wide checkpoint: one consolidated dialog listing EVERY chip
    // that is completable right now (creating glue/counterparts as needed),
    // and — on an explicit ⚡ complete only — a Repair section restoring
    // deleted connections found by dry-run diff. Repair checkboxes encode
    // the intent guess: partial-bundle damage pre-checked (accident), whole
    // connections unchecked (possibly deliberate). One batch = one undo.
    offerBoardSweep(force, excludeId) {
      this._sweepStuck ??= new Set();
      if (force) this._sweepStuck.clear();      // an explicit ask retries everything
      const rows = K.connSweep(this.doc, excludeId || null)
        .filter(r => !this._sweepStuck.has(r.comp.id));
      const repairs = force ? K.connRepairs(this.doc).filter(r => !this._sweepStuck.has(r.comp.id)) : [];
      const sig = rows.map(r => r.comp.id + ":" + r.plans.length).sort().join(",");
      if (!rows.length && !repairs.length) {
        if (force) this.setHint("nothing left to autowire — every functional chip is hooked up and intact");
        return false;
      }
      if (!force && sig === this._sweepSeen) return false;
      const label = (c) => ` ${c.props.ref || c.id} (${K.chips[c.type].name})`;
      const ui = rows.map(r => {
        const cb = K.h("input", { type: "checkbox", checked: "" });
        const sel = K.h("select", { class: "ctSel" },
          ...r.plans.map((p, i) => K.h("option", { value: String(i), title: p.desc }, p.title)));
        return { cb, comp: r.comp,
          plan: () => r.plans[+(sel.value || 0)] || r.plans[0],
          el: K.h("div", { class: "acRow" }, K.h("label", {}, cb, label(r.comp)),
            r.plans.length > 1 ? sel : K.h("span", { class: "acDesc" }, r.plans[0].title)) };
      });
      const ui2 = repairs.map(r => {
        const cb = K.h("input", { type: "checkbox" });
        if (r.accidental) cb.checked = true;      // partial bus = almost certainly a mistake
        const what = `restore ${r.pins.length ? r.pins.slice(0, 6).join(", ") + (r.pins.length > 6 ? "…" : "") : "connections"}` +
          (r.glue ? ` (+${r.glue} glue wire${r.glue > 1 ? "s" : ""})` : "");
        return { cb, comp: r.comp, plan: () => r,
          el: K.h("div", { class: "acRow" }, K.h("label", {}, cb, label(r.comp)),
            K.h("span", { class: "acDesc" }, what)) };
      });
      const body = K.h("div", { class: "acBody" });
      if (ui.length) body.append(
        K.h("div", {}, "These chips can be autowired now — glue and counterpart parts are created where needed:"),
        ...ui.map(x => x.el));
      if (ui2.length) body.append(
        K.h("div", { class: "acSub" }, "Repair — standard connections that are missing (deleted wires or parts):"),
        ...ui2.map(x => x.el));
      K.openModal("Complete the board?", body, [
        ["Wire selected", () => {
          const picked = [...ui, ...ui2].filter(x => x.cb.checked);
          if (!picked.length) { this._sweepSeen = sig; this.whisper(); return; }
          const done = [], stuck = [];
          for (const x of picked) {                 // rows arrive dependency-ordered
            const before = this.doc.wires.length;
            let res = null;
            try { res = x.plan().run(this.doc); }
            catch (e) { console.error("sweep plan failed", x.comp.type, e); }
            const name = x.comp.props.ref || x.comp.id;
            if (this.doc.wires.length > before) done.push(name);
            else {                                  // no progress: bench it, say why
              this._sweepStuck.add(x.comp.id);
              stuck.push(name + (res && res.notes && res.notes.length ? " — " + res.notes[res.notes.length - 1] : ""));
            }
          }
          this.ensureRefs();
          this.docChanged();                        // ONE step: the whole batch
          const summary = (done.length ? "autowired " + done.join(", ") + " — one undo reverts it all" : "") +
            (stuck.length ? (done.length ? "  ·  " : "") + "couldn't wire " + stuck.join("; ") : "");
          this.setHint(summary);
          this.whisper(summary);                    // keeps the summary if near-miss hints exist too
          // the batch may have enabled more: chain (return false keeps the new dialog)
          if (this.offerBoardSweep(false)) return false;
        }, "primary"],
        ["Skip", () => { this._sweepSeen = sig; this.whisper(); }, ""],
      ]);
      return true;
    },

    // the hint-bar whisper: near-miss possibilities, one part away
    whisper(prefix) {
      const w = K.connWhispers(this.doc);
      if (!w.length) return;
      this.setHint((prefix ? "autoconnect: " + prefix + "  ·  " : "") + "💡 " + w.join("  ·  "));
    },

    pinClicked(hit, shift) {
      if (!this.wireFrom) {
        this.wireFrom = hit;
        this.setHint(`wiring from ${hit.comp.props.ref}.${hit.pin.name} — click a destination pin (Shift = bus), Esc cancels`);
        return;
      }
      const a = this.wireFrom, b = hit;
      this.wireFrom = null;
      this.setHint("");
      if (a.comp === b.comp && a.pin === b.pin) return;
      if (shift) {
        const ra = busRange(a), rb = busRange(b);
        if (ra && rb) {
          const n = Math.min(ra.pins.length - ra.idx, rb.pins.length - rb.idx);
          const bundle = K.uid("b");
          for (let i = 0; i < n; i++)
            K.docConnect(this.doc, K.pinKey(a.comp, ra.pins[ra.idx + i].name), K.pinKey(b.comp, rb.pins[rb.idx + i].name), bundle);
          this.docChanged();
          this.setHint(`bus connected: ${n} wires`);
          return;
        }
      }
      K.docConnect(this.doc, K.pinKey(a.comp, a.pin.name), K.pinKey(b.comp, b.pin.name));
      this.docChanged();
    },

    select(sel) {
      this.selection = sel;
      if (this.tab === "chip") K.renderChipPanel(document.getElementById("chipPane"), this);
    },

    // Edit a CPU's architectural state (paused only): mutate the boundary
    // snapshot, then rebuild the live core from it — exact, no torn state.
    editCpuArch(chip, patch) {
      if (!this.sim || !this.paused) return;
      if (!chip.runtime.atBoundary) this.sim.stepInstruction(40000);
      const arch = chip.runtime.core.boundary || chip.runtime.core.saveArch();
      patch(arch);
      chip.state.arch = arch;
      chip.def.onRestore(this.sim.ios[chip.ci], chip.state, chip.comp.props, chip);
      this.sim.settle();
      this.sim._captureSample();
      this.truncateFuture();
      if (this.tab === "cpu") K.renderCpuPanel(document.getElementById("cpuPane"), this);
    },

    chipStateEdited(chip) {
      if (!this.sim) return;
      this.sim.pendingChips.add(chip.ci);
      this.sim.settle();
      this.sim._captureSample();
      this.truncateFuture();
      if (this.tab === "chip") K.renderChipPanel(document.getElementById("chipPane"), this);
    },
    deleteSelection() {
      const sel = this.selection;
      const before = this.doc.wires;                                   // old array survives the reassign
      if (sel.kind === "comp") {
        this.doc.components = this.doc.components.filter(c => c !== sel.comp);
        this.doc.wires = this.doc.wires.filter(w => this.compOf(w.a) && this.compOf(w.b));
      } else if (sel.kind === "wire") {
        this.doc.wires = this.doc.wires.filter(w => w !== sel.wire);   // one bit
      } else if (sel.kind === "bundle") {
        const ids = new Set(sel.wires.map(w => w.id));                 // whole bus
        this.doc.wires = this.doc.wires.filter(w => !ids.has(w.id));
      }
      this.selection = null;
      this.docChanged();
      this._deletionWhisper(before);
    },

    // Guess the intent behind a deletion: a lane snipped out of a still-
    // partially-wired bundle is almost certainly an accident — say so in the
    // hint bar (never a popup). Whole-connection removals stay silent; the
    // repair waits inside ⚡ complete for whoever wants it back.
    _deletionWhisper(beforeWires) {
      const now = new Set(this.doc.wires);
      const removed = beforeWires.filter(w => !now.has(w));
      if (!removed.length) return;
      const ids = new Set();
      for (const w of removed)
        for (const k of [w.a, w.b]) ids.add(k.slice(0, k.indexOf(".")));
      const hit = K.connRepairs(this.doc, ids).find(r => r.accidental);
      if (hit) this.setHint(`💡 ${hit.comp.props.ref || hit.comp.id} lost ` +
        `${hit.pins.slice(0, 4).join(", ")}${hit.pins.length > 4 ? "…" : ""} — ⚡ complete can restore it`);
    },

    // Is this CPU strapped into maximum mode (MN/~MX wired low)?
    isMaxStrapped(comp) {
      if (!this._maxMemo) this._maxMemo = new Map();
      let v = this._maxMemo.get(comp.id);
      if (v === undefined) {
        const key = K.pinKey(comp, "MN/~MX");
        v = this.doc.wires.some(w => {
          const other = w.a === key ? w.b : w.b === key ? w.a : null;
          if (!other) return false;
          const oc = this.compOf(other);
          return oc && oc.type === "GND";
        });
        this._maxMemo.set(comp.id, v);
      }
      return v;
    },

    // ---- undo/redo: automatic snapshots around every board mutation --------
    // A shadow copy of the doc trails every change; the shadow BEFORE a
    // mutation becomes the undo entry. Bursts within 500ms coalesce into one.
    _checkpoint(coalesce) {
      const now = Date.now();
      if (this._histSkipNext) { this._histSkipNext = false; this._docShadow = structuredClone(this.doc); this._histAt = 0; return; }
      // distinct actions are distinct undo steps; only marked bursts
      // (hex-editor typing) coalesce into one
      if (this._docShadow && !(coalesce && this._histAt && now - this._histAt < 800)) {
        this.history.push(this._docShadow);
        if (this.history.length > 50) this.history.shift();
        this.future.length = 0;
      }
      this._histAt = coalesce ? now : 0;
      this._docShadow = structuredClone(this.doc);
      this.updateUndoButtons();
    },
    resetHistory() {
      this.history = [];
      this.future = [];
      this._histAt = 0;
      this._docShadow = structuredClone(this.doc);
      this._histSkipNext = true;              // the docChanged right after load is not an edit
      this.updateUndoButtons();
    },
    _applyDoc(doc) {
      this.doc = doc;
      // re-link preset component references by id (snapshot objects are new)
      for (const [k, c] of Object.entries(this.presetNames || {})) {
        const nc = c && K.docComp(this.doc, c.id);
        if (nc) this.presetNames[k] = nc; else delete this.presetNames[k];
      }
      this.selection = null;
      this.memMap = null;
      this._maxMemo = null;
      this._editNets = null;
      this._docShadow = structuredClone(this.doc);
      this._histAt = 0;
      if (this.tab === "drc") K.renderDrcPanel(document.getElementById("drcPane"), K.runDrc(this.doc));
      if (this.tab === "chip") K.renderChipPanel(document.getElementById("chipPane"), this);
      this.scheduleAutosave();
      this.updateUndoButtons();
    },
    undo() {
      if (this.sim) { this.setHint("stop the simulation to edit (rewind travels time while running)"); return; }
      if (!this.history.length) return;
      this.future.push(structuredClone(this.doc));
      this._applyDoc(this.history.pop());
      this._sweepSeen = ""; this._sweepStuck?.clear();   // board changed: retry sweeps
      this.setHint(`undo (${this.history.length} left)`);
    },
    redo() {
      if (this.sim || !this.future.length) return;
      this.history.push(structuredClone(this.doc));
      this._applyDoc(this.future.pop());
      this._sweepSeen = ""; this._sweepStuck?.clear();
      this.setHint("redo");
    },
    updateUndoButtons() {
      const u = document.getElementById("btnUndo"), r = document.getElementById("btnRedo");
      if (u) u.disabled = !this.history.length || !!this.sim;
      if (r) r.disabled = !this.future.length || !!this.sim;
    },
    // image edits change the doc without touching wiring: history + autosave,
    // but no memory-map invalidation
    imageEdited() {
      this._checkpoint(true);                 // hex bursts collapse into one step
      this.scheduleAutosave();
    },

    docChanged() {
      this._checkpoint();
      this.memMap = null; // wiring changed -> map must be re-proved
      this._maxMemo = null;
      this._editNets = null;
      this.scheduleAutosave();
      if (this.tab === "drc") K.renderDrcPanel(document.getElementById("drcPane"), K.runDrc(this.doc));
    },

    ensureMemMap() {
      if (!this.memMap) this.memMap = K.analyzeMemoryMap(this.doc);
      return this.memMap;
    },

    // ------------------------------------------------------------ assemble ----
    assemble(explicit) {
      // explicit (the button) reclaims hand-edited ROMs for the code pane
      if (explicit) {
        for (const c of this.doc.components)
          if (c.props.userImage) { delete c.props.userImage; }
      }
      const src = document.getElementById("codeEditor").value;
      const r = K.assemble(src);
      const out = document.getElementById("asmOut");
      out.innerHTML = "";
      if (r.errors.length) {
        for (const e of r.errors) out.append(h("div", { class: "err" }, `line ${e.line}: ${e.msg}`));
        this.lastAsm = null;
      } else {
        out.append(h("div", { class: "ok" }, `✓ ${r.bytes.length} bytes at org ${K.hex(r.org)}`));
        this.lastAsm = r;
        if (this.dbg) {
          this.dbg.symbols = r.symbols;
          K.DebugUI.resyncLineBps(this);      // line breakpoints follow the new addresses
          K.DebugUI.renderGutter();
        }
      }
      return this.lastAsm;
    },

    programRoms() {
      const roms = this.doc.components.filter(c => K.chips[c.type].isRom);
      if (!roms.length) return true;
      // hand-edited ROMs keep the user's bytes: Assemble (the button) reclaims them
      const kept = roms.filter(c => c.props.userImage);
      this._romNote = kept.length
        ? `hand-edited ROM${kept.length > 1 ? "s" : ""} ${kept.map(c => c.props.ref || c.id).join(", ")} kept — Assemble reclaims`
        : null;
      if (kept.length === roms.length) return true;
      const keptIds = new Set(kept.map(c => c.id));
      if (!this.lastAsm && !this.assemble()) { this.showTab("code"); return false; }
      const asm = this.lastAsm;
      if (this.preset && this.preset.programImages) {
        for (const { comp, image } of this.preset.programImages(asm.bytes, asm.org))
          if (this.presetNames[comp] && !keptIds.has(this.presetNames[comp].id))
            K.programMemory(this.doc, this.presetNames[comp].id, image);
        return true;
      }
      if (this.preset && this.preset.makeRom && this.preset.romComp && this.presetNames[this.preset.romComp]
          && !keptIds.has(this.presetNames[this.preset.romComp].id)) {
        K.programMemory(this.doc, this.presetNames[this.preset.romComp].id, this.preset.makeRom(asm.bytes, asm.org));
      } else if (this.preset && this.preset.makeRom) {
        // preset rom is hand-held: nothing to do
      } else {
        // generic: image placed at org modulo chip size, reset vector left to the user
        for (const rom of roms.filter(c => !c.props.userImage).slice(0, 1)) {
          const size = K.chips[rom.type].isRom ? (rom.type.includes("256") ? 32768 : 8192) : 8192;
          const img = new Uint8Array(size).fill(0xFF);
          img.set(asm.bytes.slice(0, size), asm.org & (size - 1));
          rom.props.image = Array.from(img);
        }
      }
      return true;
    },

    // ----------------------------------------------------------------- run ----
    startStop() { this.sim ? this.stop() : this.start(); },

    start() {
      const drc = K.runDrc(this.doc);
      K.renderDrcPanel(document.getElementById("drcPane"), drc);
      if (drc.strict.length) {
        this.showTab("drc");
        K.openModal("Design check failed", h("div", {},
          h("p", { style: "margin-bottom:8px" }, "Strict violations must be fixed before the simulation can start:"),
          drc.strict.map(f => h("div", { style: "color:var(--hot);margin:3px 0" }, "• " + f.msg))), [["OK", null, "primary"]]);
        return;
      }
      if (!this.programRoms()) return;
      this.ensureMemMap();               // prove the memory map through the netlist
      this.sim = new K.Sim(this.doc);
      this.sim.setMemMap(this.memMap);
      // insert embedded/loaded disk images into floppy controllers
      for (const comp of this.doc.components) {
        if (K.chips[comp.type].isFdc && comp.props.imageAsset) {
          const bytes = K.assetBytes(comp.props.imageAsset);
          if (bytes) K.fdcInsert(this.sim, comp.id, bytes);
        }
      }
      // boards with big memories snapshot less often (snapshots deep-copy RAM)
      this._bigMem = this.doc.components.some(c => ((K.chips[c.type].probe || {}).size || 0) >= 131072);
      this.snaps = [{ t: 0, snap: this.sim.serialize() }];
      // debugger: attach persistent state, resolve source-line breakpoints
      // through the freshly proved memory map, reset hit counters
      this.dbg.symbols = (this.lastAsm && this.lastAsm.symbols) || {};
      this.dbg.until = null;
      this.dbg.pending = null;
      this.dbg.hit = null;
      for (const m of [this.dbg.bpIp, this.dbg.bpAddr]) for (const [, bp] of m) bp.hits = 0;
      K.Debug.attach(this.sim, this.dbg);
      K.DebugUI.resyncLineBps(this);
      K.DebugUI.renderGutter();
      this.mode = "run";
      this.paused = false;
      this.placing = null;
      this.wireFrom = null;
      this.selection = null;
      document.getElementById("library").classList.add("locked");
      document.getElementById("btnStart").textContent = "⏹ Stop";
      document.getElementById("btnStart").classList.replace("primary", "danger");
      for (const id of ["btnPause", "btnStepC", "btnStepI", "rewind", "btnTurbo"]) document.getElementById(id).disabled = false;
      this.showTab("cpu");
      this.setHint("running — board is frozen; switches, buttons and rewind stay live" +
        (this._romNote ? " · " + this._romNote : ""));
    },

    stop() {
      this.sim = null;
      this.mode = "edit";
      this.paused = false;
      document.getElementById("library").classList.remove("locked");
      const b = document.getElementById("btnStart");
      b.textContent = "▶ Start";
      b.classList.replace("danger", "primary");
      for (const id of ["btnPause", "btnStepC", "btnStepI", "rewind", "btnTurbo"]) document.getElementById(id).disabled = true;
      document.getElementById("btnTurbo").classList.remove("active");
      document.getElementById("btnPause").textContent = "⏸ Pause";
      this.setHint("edit mode — drag chips, click pin→pin to wire (Shift = whole bus)");
      this.updateStatus();
    },

    pauseResume() {
      if (!this.sim) return;
      this.paused = !this.paused;
      if (this.paused) this.exitTurbo();      // stepping/probing wants full fidelity
      if (!this.paused) {
        this.truncateFuture();
        this.sim.dbgStop = false;             // resuming past a debugger stop
        if (this.sim.dbg) this.sim.dbg.hit = null;
      }
      document.getElementById("btnPause").textContent = this.paused ? "▶ Resume" : "⏸ Pause";
      K.DebugUI.afterStep();
    },

    // a breakpoint/watchpoint/step condition stopped the run loops
    onDbgStop() {
      this.paused = true;
      this.exitTurbo();
      document.getElementById("btnPause").textContent = "▶ Resume";
      const hit = (this.dbg && this.dbg.hit) || {};
      const what = hit.kind === "bp" ? (hit.line ? `breakpoint · line ${hit.line}` : `breakpoint · ${K.hex(hit.addr || 0)}`)
        : hit.kind === "memwatch" ? `memory watchpoint · ${hit.mode === "w" ? "write to" : "read of"} ${K.hex(hit.addr || 0)}` + (hit.val != null ? ` (value ${K.hex(hit.val)})` : "")
        : hit.kind === "iowatch" ? `IO watchpoint · port ${K.hex(hit.addr || 0)}`
        : "debugger";
      this.setHint("⏸ " + what + " — F10 over · F11 into · F5 continue");
      this.maybeSnap();
      if (hit.kind && hit.kind !== "until" && this.tab !== "debug" && this.tab !== "code") this.showTab("debug");
      K.DebugUI.afterStep();
    },

    // seek the timeline to an exact half-step (reverse stepping rides rewind)
    seekToT(target) {
      if (!this.sim || !this.snaps.length) return;
      this.paused = true;
      this.exitTurbo();
      document.getElementById("btnPause").textContent = "▶ Resume";
      this.seekMax = Math.max(this.seekMax || 0, this.sim.t);
      let snap = this.snaps[0];
      for (const s of this.snaps) if (s.t <= target) snap = s;
      if (this.sim.t > target || this.sim.t < snap.t) this.sim.restore(snap.snap);
      this.sim.halted = null;
      this.sim.replayTo(target);
      K.Debug.onSeek(this.sim);
    },

    toggleTurbo() {
      if (!this.sim || this.paused) return;
      if (this.sim.fastMode) this.exitTurbo();
      else {
        this.sim.fastMode = true;
        this.sim.setCapture(false);
        document.getElementById("btnTurbo").classList.add("active");
      }
    },
    exitTurbo() {
      if (!this.sim || !this.sim.fastMode) return;
      this.sim.fastMode = false;
      this.sim.setCapture(true);
      document.getElementById("btnTurbo").classList.remove("active");
    },

    stepCycle() { if (this.sim && !this.sim.halted) { this.paused = true; this.exitTurbo(); this.truncateFuture(); this.sim.stepCycle(); this.maybeSnap(); this._afterStep(); } },
    stepInsn() { if (this.sim && !this.sim.halted) { this.paused = true; this.exitTurbo(); this.truncateFuture(); this.sim.stepInstruction(40000); this.maybeSnap(); this._afterStep(); } },
    _afterStep() {
      document.getElementById("btnPause").textContent = "▶ Resume";
      if (this.tab === "cpu") K.renderCpuPanel(document.getElementById("cpuPane"), this);
      if (this.tab === "chip") K.renderChipPanel(document.getElementById("chipPane"), this);
      K.DebugUI.afterStep();
    },

    maybeSnap() {
      const last = this.snaps[this.snaps.length - 1];
      // CPU state serializes exactly at instruction boundaries only.
      const cpus = this.sim.chips.filter(c => c.def.isCpu);
      if (cpus.length && !cpus.every(c => c.runtime.atBoundary)) return;
      const every = SNAP_EVERY * (this.sim.fastMode ? 16 : 1) * (this._bigMem ? 32 : 1);
      const cap = this._bigMem ? 12 : MAX_SNAPS;
      if (this.sim.t - last.t >= every) {
        this.snaps.push({ t: this.sim.t, snap: this.sim.serialize() });
        if (this.snaps.length > cap) this.snaps.splice(1, 1); // keep t=0
      }
    },

    truncateFuture() {
      // after a rewind, resuming forward discards logged inputs beyond now
      if (this.sim) this.sim.inputLog = this.sim.inputLog.filter(e => e.t <= this.sim.t);
      this.snaps = this.snaps.filter(s => s.t <= this.sim.t);
      if (!this.snaps.length) this.snaps = [{ t: this.sim.t, snap: this.sim.serialize() }];
    },

    seekFrac(frac) {
      if (!this.sim || !this.snaps.length) return;
      this.paused = true;
      this.exitTurbo();
      document.getElementById("btnPause").textContent = "▶ Resume";
      this.seekMax = Math.max(this.seekMax || 0, this.sim.t);
      const t0 = this.snaps[0].t;
      const target = Math.round(t0 + frac * (this.seekMax - t0));
      let snap = this.snaps[0];
      for (const s of this.snaps) if (s.t <= target) snap = s;
      if (this.sim.t > target || this.sim.t < snap.t) this.sim.restore(snap.snap);
      this.sim.halted = null;
      this.sim.replayTo(target);
      K.Debug.onSeek(this.sim);
      K.DebugUI.afterStep();
      this.waveform.follow = true;
    },

    runModeClick(comp, gyRel) {
      if (!this.sim) return;
      if (comp.type === "SW8") {
        const bit = K.clamp(Math.round(gyRel - 1), 0, 7);
        this.sim.applyInput(comp.id, { bits: comp.props.bits ^ (1 << bit) });
      } else if (comp.type === "BTN") {
        this.sim.applyInput(comp.id, { pressed: true });
        this.heldBtn = comp;
      }
    },
    runModeRelease() {
      if (this.sim && this.heldBtn) {
        this.sim.applyInput(this.heldBtn.id, { pressed: false });
        this.heldBtn = null;
      }
    },

    // -------------------------------------------------------------- frame ----
    frame() {
      if (this.sim && !this.paused && !this.sim.halted) {
        const speed = this.SPEEDS[this.speedIdx];
        const budget = (speed === Infinity || this.sim.fastMode) ? 1e9 : Math.max(1, Math.round(speed / 60));
        const deadline = performance.now() + 12;
        if (this.sim.fastMode) {
          // Tier B+: compiled clock-tree batches (capture is off in turbo,
          // so per-half snapshot checks would only slow the fast path down)
          while (performance.now() < deadline && !this.sim.halted) this.sim.run(100000);
          this.maybeSnap();
        } else {
          for (let i = 0; i < budget; i++) {
            this.sim.stepHalf();
            this.maybeSnap();
            if (this.sim.halted || this.sim.dbgStop || performance.now() > deadline) break;
          }
        }
        this.seekMax = this.sim.t;
        document.getElementById("rewind").value = 1000;
        if (this.sim.halted) this.onHalt();
        if (this.sim.dbgStop && !this.paused) this.onDbgStop();
      }
      this.schematic.render();
      this.waveform.render();
      // Live panel refresh — but never yank a field out from under the user's cursor.
      const focusedInPane = document.activeElement && document.getElementById("rightBody").contains(document.activeElement)
        && ["INPUT", "SELECT", "BUTTON"].includes(document.activeElement.tagName);
      this._refresh = (this._refresh || 0) + 1;
      const cadence = this.sim && !this.paused ? 6 : 30;
      if (this.sim && !focusedInPane && this._refresh % cadence === 0) {
        if (this.tab === "cpu") K.renderCpuPanel(document.getElementById("cpuPane"), this);
        if (this.tab === "chip") K.renderChipPanel(document.getElementById("chipPane"), this);
      }
      this.updateStatus();
    },

    onHalt() {
      const hlt = this.sim.halted;
      this.paused = true;
      document.getElementById("btnPause").textContent = "▶ Resume";
      if (hlt.reason === "contention") {
        K.openModal("Bus contention!", h("div", {},
          h("p", {}, `Two outputs fought over net "${hlt.detail}" and the simulation stopped — on real hardware this cooks chips.`),
          h("p", { style: "color:var(--dim);margin-top:6px" }, K.explains["output-contention"])), [["OK", null, "primary"]]);
        this.sim.halted = null;
      } else if (hlt.reason === "oscillation") {
        K.openModal("Combinational oscillation", h("div", {},
          h("p", {}, "The logic never settled — you probably built a loop of gates with no clocked element in it.")), [["OK", null, "primary"]]);
        this.sim.halted = null;
      }
    },

    setHint(txt) { document.getElementById("hint").textContent = txt; },

    updateStatus() {
      this.updateUndoButtons();
      const el = document.getElementById("status");
      const speed = this.SPEEDS[this.speedIdx];
      const spTxt = speed === Infinity ? "max" : speed >= 1000 ? (speed / 1000) + "k" : speed;
      if (!this.sim) { el.innerHTML = `edit · speed ${spTxt}/s`; return; }
      // measured simulation rate (cycles/sec of simulated CPU clock)
      const now = performance.now();
      if (this._rateT === undefined || now - this._rateAt > 500) {
        if (this._rateT !== undefined)
          this._rate = ((this.sim.t - this._rateT) / 2) / ((now - this._rateAt) / 1000);
        this._rateT = this.sim.t;
        this._rateAt = now;
      }
      const rate = this._rate > 0 && !this.paused
        ? (this._rate >= 1e6 ? (this._rate / 1e6).toFixed(2) + "M" : Math.round(this._rate / 1000) + "k") + " cyc/s"
        : spTxt + "/s";
      const cyc = Math.floor(this.sim.t / 2);
      const cpu = this.sim.chips.find(c => c.def.isCpu);
      const insns = cpu ? cpu.runtime.core.insnCount : 0;
      const turbo = this.sim.fastMode ? ' · <span style="color:var(--accent2)">⚡TURBO</span>' : "";
      el.innerHTML = `<span class="${this.sim.halted ? "halted" : "run"}">${this.sim.halted ? "HALTED" : this.paused ? "paused" : "running"}</span> · cyc ${cyc} · insn ${insns} · ${rate}${turbo}`;
    },

    // --------------------------------------------------------- save / load ----
    // Everything a session is: the board (with edited memory images), the
    // program, the preset lineage (so Start keeps building ROMs the same
    // way), and the speed. Plain JSON, fully self-contained.
    buildSaveData() {
      return {
        version: 2,
        doc: this.doc,
        program: document.getElementById("codeEditor").value,
        presetId: this.preset ? this.preset.id : null,
        presetNames: Object.fromEntries(Object.entries(this.presetNames || {}).map(([k, c]) => [k, c.id])),
        speedIdx: this.speedIdx,
        dbg: K.DebugUI.serialize(this),
      };
    },
    applySaveData(data) {
      this.stop();
      this.doc = data.doc;
      this.preset = data.presetId ? K.presetById(data.presetId) || null : null;
      this.presetNames = {};
      for (const [k, id] of Object.entries(data.presetNames || {})) {
        const c = K.docComp(this.doc, id);
        if (c) this.presetNames[k] = c;
      }
      if (data.program != null) document.getElementById("codeEditor").value = data.program;
      if (data.speedIdx != null) {
        this.speedIdx = data.speedIdx;
        document.getElementById("speed").value = String(this.speedIdx);
      }
      if (this.preset) document.getElementById("presetSel").value = this.preset.id;
      document.getElementById("btnLab").style.display = this.preset && this.preset.lab ? "" : "none";
      this.lastAsm = null;
      this.selection = null;
      this._sweepSeen = ""; this._sweepStuck?.clear();
      K.DebugUI.deserialize(this, data.dbg || null);
      K.DebugUI.renderGutter();
      this.ensureRefs();
      this.waveform.autoPopulate();
      this.resetHistory();
      this.docChanged();
    },
    saveDesign() {
      const data = JSON.stringify(this.buildSaveData(), null, 1);
      const blob = new Blob([data], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (this.preset ? this.preset.id : "board") + ".u8086.json";
      a.click();
      this.setHint("saved to your machine — load it back any time (images, program and preset lineage included)");
    },
    loadDesign() {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".json";
      inp.onchange = async () => {
        const file = inp.files[0];
        if (!file) return;
        try {
          this.applySaveData(JSON.parse(await file.text()));
        } catch (e) {
          K.openModal("Load failed", h("div", {}, String(e)), [["OK", null, "primary"]]);
        }
      };
      inp.click();
    },

    // ---- crash guard: debounced autosave to localStorage -------------------
    scheduleAutosave() {
      if (!this._autosaveArmed) return;   // hold fire until the restore offer resolves
      clearTimeout(this._autoT);
      this._autoT = setTimeout(() => this.autosaveNow(), 1500);
    },
    autosaveNow() {
      try {
        const s = JSON.stringify({ ...this.buildSaveData(), at: Date.now() });
        if (s.length < 4 * 1024 * 1024) localStorage.setItem("u8086.autosave", s);
      } catch { /* storage unavailable: fine */ }
    },
    offerAutosaveRestore() {
      let data = null;
      try { data = JSON.parse(localStorage.getItem("u8086.autosave")); } catch { /* ignore */ }
      if (!data || !data.doc || !data.doc.components || !data.doc.components.length) {
        this._autosaveArmed = true;
        return;
      }
      K._modalOnClose = () => { this._autosaveArmed = true; };
      const when = data.at ? new Date(data.at).toLocaleString() : "earlier";
      K.openModal("Restore last session?",
        K.h("div", { class: "acBody" },
          K.h("div", {}, `An autosaved board from ${when} is available (${data.doc.components.length} components${data.presetId ? `, based on “${data.presetId}”` : ""}).`),
          K.h("div", { class: "acHint" }, "Your explicit save files are untouched either way.")),
        [
          ["Restore", () => this.applySaveData(data), "primary"],
          ["Discard", () => { try { localStorage.removeItem("u8086.autosave"); } catch { /* ignore */ } }, ""],
        ]);
    },

    // -------------------------------------------------------------- probe ----
    updateTooltip(hit, cx, cy) {
      const tip = document.getElementById("tooltip");
      if (!hit || (hit.kind === "comp" && !K.chips[hit.comp.type].name)) { tip.style.display = "none"; return; }
      let html = "";
      const netInfo = (pinKey) => {
        const nets = this.sim ? this.sim.byPin : K.extractNets(this.doc).byPin;
        const net = nets.get(pinKey);
        if (!net) return "unconnected";
        let s = `net: ${escapeHtml(net.name)}`;
        if (this.sim) {
          const v = this.sim.netVal[net.id];
          s += `  =  <span class="${K.sigClass(v)}">${K.fmtSig(v)}</span>`;
        }
        if (net.pins.length > 1) {
          const others = net.pins.slice(0, 8).map(p => `${p.comp.props.ref || p.comp.id}.${p.pin.name}`).join(", ");
          s += `\n${net.pins.length} pins: ${escapeHtml(others)}${net.pins.length > 8 ? "…" : ""}`;
        }
        return s;
      };
      if (hit.kind === "pin") {
        html = `<b>${hit.comp.props.ref || hit.comp.id}.${escapeHtml(hit.pin.name)}</b> (pin ${hit.pin.num}, ${hit.pin.kind})\n` + netInfo(K.pinKey(hit.comp, hit.pin.name));
      } else if (hit.kind === "wire") {
        // a single wire — or one curved lead of a bus (then say which bit)
        html = netInfo(hit.wire.a);
        if (hit.wire.bundle) {
          const sch = this.schematic;
          const bus = (sch._bundles || []).find(b => b.wires.includes(hit.wire));
          if (bus) {
            const name = sch._busName(bus.wires);
            html = `<b>bit ${sch._bitOf(hit.wire)}${name ? " of " + escapeHtml(name) : ""}</b>\n` + html;
          }
        }
      } else if (hit.kind === "bundle") {
        const sch = this.schematic;
        const name = sch._busName(hit.wires);
        html = `<b>bus ${name ? escapeHtml(name) + " " : ""}— ${hit.wires.length} wires</b>`;
        const val = sch._busValue(hit.wires);
        if (val !== null) html += `\nvalue: <span class="v1">0x${val}</span>`;
        const comps = [...new Set(hit.wires.flatMap(w => [this.compOf(w.a), this.compOf(w.b)]))]
          .filter(Boolean).map(c => c.props.ref || c.id);
        html += `\nconnects: ${escapeHtml(comps.join(" · "))}`;
        html += `\nclick to select the whole bus (Delete removes all ${hit.wires.length} wires)`;
      } else if (hit.kind === "comp") {
        const def = K.chips[hit.comp.type];
        html = `<b>${hit.comp.props.ref || hit.comp.id}</b> — ${escapeHtml(def.name)}`;
      }
      tip.innerHTML = html;
      tip.style.display = "block";
      const wrap = document.getElementById("canvasWrap").getBoundingClientRect();
      tip.style.left = Math.min(cx - wrap.left + 14, wrap.width - 240) + "px";
      tip.style.top = (cy - wrap.top + 14) + "px";
    },
  };

  function busRange(hit) {
    const m = /^(.*?)(\d+)$/.exec(hit.pin.name);
    if (!m) return null;
    const prefix = m[1], start = +m[2];
    const pins = K.chips[hit.comp.type].pins
      .filter(p => p.name.startsWith(prefix) && /^\d+$/.test(p.name.slice(prefix.length)))
      .sort((a, b) => +a.name.slice(prefix.length) - +b.name.slice(prefix.length));
    const idx = pins.findIndex(p => +p.name.slice(prefix.length) === start);
    return idx < 0 ? null : { pins, idx };
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => K.App.init());
  else K.App.init();
})(globalThis.K8086 ??= {});
