"use strict";
(function (K) {
  if (typeof document === "undefined") return;
  const h = (...a) => K.h(...a);

  K.buildLibrary = function (el, app) {
    el.innerHTML = "";
    for (const cat of K.chipCategories) {
      el.append(h("h4", {}, cat));
      for (const def of Object.values(K.chips)) {
        if (def.category !== cat) continue;
        el.append(h("div", {
          class: "item",
          title: def.name,
          onclick: () => { app.placing = def.type; app.wireFrom = null; app.setHint(`placing ${def.type} — click the canvas to drop, Esc to cancel`); },
        }, def.type + "  ", h("small", { style: "color:var(--dim)" }, def.name)));
      }
    }
  };

  // ---------------------------------------------------------------- CPU ----
  const hexIn = (val, width, onCommit, enabled) => {
    if (!enabled) return h("span", { class: "r" }, K.hex(val, width));
    const inp = h("input", { class: "regEdit", value: K.hex(val, width), maxlength: String(width) });
    const commit = () => {
      const v = parseInt(inp.value, 16);
      if (Number.isFinite(v)) onCommit(v & (width === 2 ? 0xFF : 0xFFFF));
      else inp.value = K.hex(val, width);
    };
    inp.addEventListener("change", commit);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { commit(); inp.blur(); } });
    return inp;
  };

  K.renderCpuPanel = function (el, app) {
    el.innerHTML = "";
    const cpus = app.sim ? app.sim.chips.filter(c => c.def.isCpu) : [];
    if (!cpus.length) {
      el.append(h("div", { class: "cpuState" }, app.sim ? "no CPU on this board" : "start the simulation to inspect CPU state"));
      return;
    }
    const editable = app.sim && app.paused;
    for (const chip of cpus) {
      const core = chip.runtime.core;
      const box = h("div", { class: "cpuState" });
      box.append(h("div", { class: "sect" }, `${chip.comp.props.ref || chip.comp.id} — ${chip.def.type}`,
        editable ? h("small", { style: "color:var(--accent);margin-left:8px" }, "editable") : ""));

      // Next instruction, decoded from the prefetch queue at the boundary.
      const arch = core.boundary || core.saveArch();
      if (arch.queue.length) {
        const d = K.disasm(arch.queue, 0, arch.ip);
        box.append(h("div", { class: "nextInsn" }, "▶ " + d.text,
          h("small", { style: "color:var(--dim);margin-left:8px" },
            arch.queue.slice(0, Math.max(d.len, 1)).map(x => K.hex(x, 2)).join(" "))));
      } else {
        box.append(h("div", { class: "nextInsn", style: "color:var(--dim)" },
          "▶ (prefetch queue empty — a jump flushed it, exactly like the real chip; step to refetch)"));
      }

      const R = ["AX", "CX", "DX", "BX", "SP", "BP", "SI", "DI"];
      const S = ["ES", "CS", "SS", "DS"];
      const edit = (patch) => app.editCpuArch(chip, patch);
      const tbl = h("table", {});
      for (let row = 0; row < 4; row++) {
        tbl.append(h("tr", {},
          h("td", {}, R[row]), h("td", {}, hexIn(core.r[row], 4, (v) => edit(a => a.r[row] = v), editable)),
          h("td", {}, R[row + 4]), h("td", {}, hexIn(core.r[row + 4], 4, (v) => edit(a => a.r[row + 4] = v), editable)),
          h("td", {}, S[row]), h("td", {}, hexIn(core.s[row], 4, (v) => edit(a => { a.s[row] = v; if (row === 1) { a.queue = []; a.fetchIP = a.ip; } }), editable))));
      }
      tbl.append(h("tr", {},
        h("td", {}, "IP"), h("td", {}, hexIn(core.ip, 4, (v) => edit(a => { a.ip = v; a.queue = []; a.fetchIP = v; }), editable)),
        h("td", {}, "FL"), h("td", {}, hexIn(core.fl, 4, (v) => edit(a => a.fl = (v & 0x0FD5) | 0xF002), editable)),
        h("td", { colspan: 2 })));
      box.append(tbl);

      const F = [["O", 0x800], ["D", 0x400], ["I", 0x200], ["T", 0x100], ["S", 0x80], ["Z", 0x40], ["A", 0x10], ["P", 0x04], ["C", 0x01]];
      box.append(h("div", { style: "margin:6px 0" },
        F.map(([n, m]) => h("span", {
          class: (core.fl & m ? "flagOn" : "flagOff") + (editable ? " flagBtn" : ""),
          title: editable ? "click to toggle" : "",
          onclick: editable ? () => edit(a => a.fl ^= m) : null,
        }, n))));

      box.append(h("div", { class: "sect" }, "prefetch queue"));
      box.append(h("div", { class: "r" }, core.queue.length ? core.queue.map(b => K.hex(b, 2)).join(" ") : "(empty)"));
      box.append(h("div", { class: "sect" }, "bus"));
      const b = core.bus;
      box.append(h("div", {},
        b ? `${b.kind} @ ${K.hex(b.addr, 5)} T${b.t}${b.waits ? "+" + b.waits + "w" : ""}${b.kind === "w" ? " ← " + K.hex(b.dataOut, b.word ? 4 : 2) : ""}`
          : core.halted ? "HALT (waiting for interrupt)" : "idle"));
      box.append(h("div", { class: "sect" }, "counters"));
      box.append(h("div", {}, `${core.insnCount} instructions · ${core.cycleCount} clocks`));
      if (core.error) box.append(h("div", { style: "color:var(--hot)" }, "error: " + core.error));
      el.append(box);
    }
    if (app.sim && !app.paused) el.append(h("div", { class: "cpuState", style: "color:var(--dim)" }, "pause to edit registers and flags"));
  };

  // --------------------------------------------------------- chip inspector ----
  function inspectFields(chip) {
    if (chip.def.inspect) return chip.def.inspect(chip.state, chip.comp.props, chip);
    const out = [];
    for (const [k, v] of Object.entries(chip.state)) {
      if (k === "arch" || k === "mem") continue;
      if (typeof v === "number")
        out.push({ key: k, kind: "num", get: () => chip.state[k], set: (x) => { chip.state[k] = x; } });
      else if (typeof v === "boolean")
        out.push({ key: k, kind: "bool", get: () => chip.state[k], set: (x) => { chip.state[k] = !!x; } });
    }
    return out;
  }

  K.renderChipPanel = function (el, app) {
    el.innerHTML = "";
    const box = h("div", { class: "cpuState" });
    el.append(box);
    const sel = app.selection;
    if (!sel || sel.kind !== "comp") {
      box.append(h("div", { style: "color:var(--dim)" }, "click a chip on the board to inspect it (works while running, too)"));
      return;
    }
    const comp = sel.comp;
    const def = K.chips[comp.type];
    box.append(h("div", { class: "sect" }, `${comp.props.ref || comp.id} — ${def.type}`));
    box.append(h("div", { style: "color:var(--dim);margin-bottom:6px" }, def.name));

    // properties
    const propRows = Object.entries(comp.props).filter(([k]) => k !== "image" && k !== "ref");
    if (propRows.length) {
      box.append(h("div", { class: "sect" }, "properties"));
      for (const [k, v] of propRows)
        box.append(h("div", {}, `${k} = `, h("span", { class: "r" }, String(v))));
    }

    // connections table — the tabular wiring view, always available
    box.append(h("div", { class: "sect" }, "connections"));
    const connBox = h("div", { class: "ctWrap" });
    K.ConnTable.render(app, comp, connBox);
    box.append(connBox);

    // memory chips: hex editor entry, in or out of simulation
    const isMem = def.category === "Memory";
    if (isMem) {
      box.append(h("div", { style: "margin:8px 0" },
        h("button", { class: "primary", onclick: () => K.HexEditor.open(app, comp) }, "open hex editor"),
        app.sim ? "" : h("button", { style: "margin-left:6px", onclick: () => K.RangeCalc.open(app, comp) }, "memory range…")));
    }

    const chip = app.sim && app.sim.chipFor(comp.id);
    if (!chip) {
      if (!isMem) box.append(h("div", { style: "color:var(--dim);margin-top:8px" }, "start the simulation to see internal state"));
      return;
    }
    if (def.isCpu) {
      box.append(h("div", { style: "color:var(--dim);margin-top:8px" }, "registers live in the CPU tab"));
      return;
    }

    const editable = app.paused;
    const fields = inspectFields(chip);
    if (fields.length) {
      box.append(h("div", { class: "sect" }, "internal state" + (editable ? " (editable)" : " — pause to edit")));
      const tbl = h("table", {});
      for (const f of fields) {
        const v = f.get();
        let cell;
        if (f.kind === "bool") {
          cell = editable
            ? h("button", { onclick: () => { f.set(!f.get()); app.chipStateEdited(chip); } }, v ? "true" : "false")
            : h("span", { class: "r" }, String(v));
        } else {
          cell = hexIn(v & 0xFFFF, 4, (x) => { f.set(x); app.chipStateEdited(chip); }, editable);
        }
        tbl.append(h("tr", {}, h("td", {}, f.key), h("td", {}, cell)));
      }
      box.append(tbl);
    }
    // live pin readout
    box.append(h("div", { class: "sect" }, "pins"));
    const pinsBox = h("div", { class: "pinGrid" });
    for (const pin of def.pins) {
      if (pin.kind === "nc" || pin.kind === "pwr" || pin.kind === "gnd") continue;
      const net = app.sim.byPin.get(K.pinKey(comp, pin.name));
      const v = net ? app.sim.netVal[net.id] : K.SIG.Z;
      pinsBox.append(h("span", { class: "pinChip " + K.sigClass(v), title: `pin ${pin.num} (${pin.kind})` },
        pin.name + "=" + K.fmtSig(v)));
    }
    box.append(pinsBox);
  };

  K.renderDrcPanel = function (el, drc) {
    el.innerHTML = "";
    const box = h("div", { class: "drcList" });
    if (!drc) {
      box.append(h("div", {}, "design checks run when you press Start (or here, live, while editing)"));
      el.append(box);
      return;
    }
    if (!drc.strict.length && !drc.weak.length) box.append(h("div", { class: "none" }, "✓ no violations — clean design"));
    for (const [list, cls, tag] of [[drc.strict, "strict", "STRICT"], [drc.weak, "weak", "weak"]]) {
      for (const f of list) {
        box.append(h("details", {},
          h("summary", { class: cls }, `[${tag}] ${f.msg}`),
          h("p", {}, K.explains[f.explain] || "")));
      }
    }
    el.append(box);
  };

  // ------------------------------------------------------------ hex editor ----
  // Adapter-based: one engine renders chip-local views, programmed images, and the
  // unified CPU-space view derived from the memory-map analyzer.
  //   adapter = { title, subtitle, length, addrBase, addrWidth, get(i), set(i,v)|null }
  const ROWH = 18, COLS = 16;

  function chipAdapter(app, comp) {
    const def = K.chips[comp.type];
    const chip = app.sim && app.sim.chipFor(comp.id);
    let buf = null, live = false;
    if (chip && chip.state.mem) { buf = chip.state.mem; live = true; }
    else if (comp.props.image) buf = Uint8Array.from(comp.props.image);
    else if (def.probe) buf = new Uint8Array(def.probe.size).fill(def.isRom ? 0xFF : 0x00);
    if (!buf) return null;
    return {
      title: `${comp.props.ref || comp.id} — ${def.type}`,
      subtitle: `chip-local addressing 0000–${K.hex(buf.length - 1, 4)} · ${buf.length} bytes · ${live ? "live simulation contents" : "programmed image"}`,
      length: buf.length, addrBase: 0, addrWidth: 4,
      get: (i) => buf[i],
      set: (i, v) => {
        buf[i] = v & 0xFF;
        if (!live) {
          comp.props.image = Array.from(buf);
          if (def.isRom) comp.props.userImage = true;   // Start keeps these bytes
          app.imageEdited();
        } else if (chip) app.chipStateEdited(chip);
      },
      liveRefresh: live,
    };
  }

  // edit-mode byte access to a chip's stored image (created on first write);
  // this is what makes the unified editor work on the bench, without a sim
  function imageRW(app, compId) {
    const comp = K.docComp(app.doc, compId);
    if (!comp) return null;
    const def = K.chips[comp.type];
    if (!def.probe) return null;
    const ensure = () => {
      if (!comp.props.image) comp.props.image = new Array(def.probe.size).fill(def.isRom ? 0xFF : 0x00);
      return comp.props.image;
    };
    return {
      get: (local) => comp.props.image ? comp.props.image[local] ?? 0xFF : (def.isRom ? 0xFF : 0x00),
      set: (local, v) => {
        ensure()[local] = v & 0xFF;
        if (def.isRom) comp.props.userImage = true;
        app.imageEdited();
      },
    };
  }

  function segmentAdapter(app, cpuMap, seg) {
    const imgCache = new Map();
    const img = (compId) => {
      if (!imgCache.has(compId)) imgCache.set(compId, imageRW(app, compId));
      return imgCache.get(compId);
    };
    const live = () => !!app.sim;
    return {
      title: `${cpuMap.ref} address space`,
      subtitle: `${K.hex(seg.start, 5)}–${K.hex(seg.end, 5)}` +
        (seg.alias ? " · alias window (partial decode)" : " · primary") +
        (seg.resetVector ? " · contains reset vector" : "") +
        (live() ? "" : " · editing stored images (applied at Start)"),
      length: seg.end - seg.start + 1, addrBase: seg.start, addrWidth: 5,
      get: (i) => {
        const r = K.memMapResolve(cpuMap, seg.start + i);
        if (!r) return 0xFF;
        if (live()) {
          const chip = app.sim.chipFor(r.compId);
          return chip && chip.state.mem ? chip.state.mem[r.local] : 0xFF;
        }
        const rw = img(r.compId);
        return rw ? rw.get(r.local) : 0xFF;
      },
      set: (i, v) => {
        const r = K.memMapResolve(cpuMap, seg.start + i);
        if (!r) return;
        if (live()) {
          const chip = app.sim.chipFor(r.compId);
          if (chip && chip.state.mem) { chip.state.mem[r.local] = v & 0xFF; app.chipStateEdited(chip); }
          return;
        }
        const rw = img(r.compId);
        if (rw) rw.set(r.local, v);
      },
      liveRefresh: true,
    };
  }

  function segLabel(app, cpuMap, seg) {
    const chips = [...new Set(seg.parts.map(p => {
      const c = K.docComp(app.doc, p.compId);
      return c ? `${c.props.ref || c.id} ${c.type.replace(/^(SRAM|EPROM)/, "")}` : p.compId;
    }))];
    return `${cpuMap.ref} · ${K.hex(seg.start, 5)}–${K.hex(seg.end, 5)} · ${chips.join(" + ")}` +
      (seg.alias ? " (alias)" : "") + (seg.resetVector ? " ⚑reset" : "");
  }

  K.HexEditor = {
    open(app, comp) {
      const a = chipAdapter(app, comp);
      if (!a) { K.openModal("Hex editor", h("div", {}, "no contents available for this chip"), [["OK", null, "primary"]]); return; }
      this._show(app, a, null);
    },

    openUnified(app) {
      if (!app.memMap || !app.memMap.cpus.length) {
        K.openModal("Unified memory view", h("div", {},
          h("p", {}, "No validated memory ranges. The analyzer probes the wired decode when the simulation starts — the board needs a CPU plus SRAM/EPROM reachable through its address decoding."),
        ), [["OK", null, "primary"]]);
        return;
      }
      const options = [];
      for (const cpuMap of app.memMap.cpus)
        for (const seg of cpuMap.segments)
          options.push({ cpuMap, seg });
      // primaries first, then reset-window aliases, then other aliases
      options.sort((x, y) => (x.seg.alias - y.seg.alias) || (y.seg.resetVector - x.seg.resetVector) || (x.seg.start - y.seg.start));
      this._show(app, segmentAdapter(app, options[0].cpuMap, options[0].seg), options);
    },

    _show(app, adapter, rangeOptions) {
      const canEdit = () => (!app.sim || app.paused) && adapter.set;
      const rows = Math.ceil(adapter.length / COLS);
      const viewport = h("div", { class: "hexView" });
      const spacer = h("div", { style: `height:${rows * ROWH}px;position:relative` });
      const window_ = h("div", { style: "position:absolute;left:0;right:0;top:0" });
      spacer.append(window_);
      viewport.append(spacer);

      const renderWindow = () => {
        const first = Math.max(0, Math.floor(viewport.scrollTop / ROWH) - 2);
        const count = Math.ceil(viewport.clientHeight / ROWH) + 4;
        window_.style.top = first * ROWH + "px";
        window_.innerHTML = "";
        for (let r = first; r < Math.min(rows, first + count); r++) {
          const base = r * COLS;
          const row = h("div", { class: "hexRow" });
          row.append(h("span", { class: "hexAddr" }, K.hex(adapter.addrBase + base, adapter.addrWidth)));
          const hexCells = h("span", { class: "hexBytes" });
          let ascii = "";
          for (let c = 0; c < COLS && base + c < adapter.length; c++) {
            const i = base + c;
            const v = adapter.get(i);
            const cell = h("span", {
              class: "hexCell" + (c === 8 ? " gap" : ""),
              onclick: () => { if (canEdit()) startEdit(i, cell); },
            }, K.hex(v, 2));
            hexCells.append(cell);
            ascii += v >= 0x20 && v < 0x7F ? String.fromCharCode(v) : "·";
          }
          row.append(hexCells, h("span", { class: "hexAscii" }, ascii));
          window_.append(row);
        }
      };

      const startEdit = (i, cell) => {
        const inp = h("input", { class: "hexEdit", value: K.hex(adapter.get(i), 2), maxlength: "2" });
        cell.innerHTML = "";
        cell.append(inp);
        inp.focus();
        inp.select();
        const commit = (advance) => {
          const v = parseInt(inp.value, 16);
          if (Number.isFinite(v)) adapter.set(i, v);
          renderWindow();
          if (advance && i + 1 < adapter.length) {
            const want = K.hex(adapter.addrBase + Math.floor((i + 1) / COLS) * COLS, adapter.addrWidth);
            for (const rowEl of window_.querySelectorAll(".hexRow")) {
              if (rowEl.querySelector(".hexAddr").textContent === want) {
                const cellEl = rowEl.querySelectorAll(".hexCell")[(i + 1) % COLS];
                if (cellEl) startEdit(i + 1, cellEl);
                return;
              }
            }
          }
        };
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit(true);
          else if (e.key === "Escape") renderWindow();
          e.stopPropagation();
        });
        inp.addEventListener("input", () => { if (inp.value.length === 2) commit(true); });
        inp.addEventListener("blur", () => { if (window_.contains(inp)) commit(false); });
      };

      viewport.addEventListener("scroll", renderWindow);

      const sub = h("div", { class: "hexSub" }, adapter.subtitle);
      const gotoInp = h("input", { class: "regEdit", placeholder: "goto hex", style: "width:80px" });
      gotoInp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const v = parseInt(gotoInp.value, 16);
          if (Number.isFinite(v)) {
            const i = K.clamp(v - adapter.addrBase, 0, adapter.length - 1);
            viewport.scrollTop = Math.floor(i / COLS) * ROWH;
          }
        }
        e.stopPropagation();
      });
      const toolbar = h("div", { class: "hexToolbar" });
      if (rangeOptions) {
        const sel = h("select", {
          onchange: () => {
            const opt = rangeOptions[+sel.value];
            adapter = segmentAdapter(app, opt.cpuMap, opt.seg);
            const rows2 = Math.ceil(adapter.length / COLS);
            spacer.style.height = rows2 * ROWH + "px";
            sub.textContent = adapter.subtitle;
            viewport.scrollTop = 0;
            renderWindow();
          },
        }, rangeOptions.map((o, i) => h("option", { value: String(i) }, segLabel(app, o.cpuMap, o.seg))));
        toolbar.append(sel);
      } else {
        toolbar.append(h("span", { style: "color:var(--accent)" }, adapter.title));
      }
      toolbar.append(gotoInp,
        h("button", {
          onclick: () => {
            const buf = new Uint8Array(adapter.length);
            for (let i = 0; i < adapter.length; i++) buf[i] = adapter.get(i);
            const blob = new Blob([buf], { type: "application/octet-stream" });
            const a2 = document.createElement("a");
            a2.href = URL.createObjectURL(blob);
            a2.download = (adapter.title || "memory").replace(/[^\w.-]+/g, "_") + ".bin";
            a2.click();
          },
        }, "⬇ .bin"),
        h("span", { class: "spacer" }),
        h("span", { class: "hexHint" }, ""));
      const hint = toolbar.lastChild;
      const updateHint = () => { hint.textContent = canEdit() ? "click a byte to edit" : app.sim && !app.paused ? "live view — pause to edit" : "read-only"; };
      updateHint();

      K.openModal(rangeOptions ? "Unified memory — validated by netlist probe" : "Hex editor", h("div", {}, toolbar, sub, viewport), [["Close", null, "primary"]]);
      document.getElementById("modalBox").classList.add("wide");
      const refresh = setInterval(() => {
        updateHint();
        if (app.sim && !app.paused && adapter.liveRefresh && !document.querySelector(".hexEdit")) renderWindow();
      }, 300);
      K._modalOnClose = () => {
        document.getElementById("modalBox").classList.remove("wide");
        clearInterval(refresh);
      };
      requestAnimationFrame(renderWindow);
    },
  };

  // dbl-click component properties
  K.propsDialog = function (app, comp) {
    const def = K.chips[comp.type];
    const editable = Object.entries(comp.props).filter(([k]) => ["hz", "mhz", "name", "bits", "color"].includes(k));
    const body = h("div", { class: "propsBody" });
    body.append(h("div", { style: "color:var(--dim);margin-bottom:8px" }, `${comp.props.ref || comp.id} — ${def.name}`));
    // tabs: chip config | tabular wiring
    const cfgPane = h("div", {});
    const connPane = h("div", { style: "display:none" });
    const tabCfg = h("button", { class: "ctTab active" }, "Config");
    const tabConn = h("button", { class: "ctTab" }, "Connections");
    const showTab = (which) => {
      tabCfg.classList.toggle("active", which === "cfg");
      tabConn.classList.toggle("active", which === "conn");
      cfgPane.style.display = which === "cfg" ? "" : "none";
      connPane.style.display = which === "conn" ? "" : "none";
      if (which === "conn" && !connPane.dataset.built) {
        connPane.dataset.built = "1";
        K.ConnTable.render(app, comp, connPane);
      }
    };
    tabCfg.onclick = () => showTab("cfg");
    tabConn.onclick = () => showTab("conn");
    body.append(h("div", { class: "ctTabs" }, tabCfg, tabConn), cfgPane, connPane);
    const inputs = {};
    for (const [k, v] of editable) {
      const inp = h("input", { value: String(v), style: "background:var(--bg);color:var(--text);border:1px solid var(--edge);padding:3px 6px;font-family:var(--mono);width:120px" });
      inputs[k] = inp;
      cfgPane.append(h("div", { style: "margin:4px 0" }, h("label", { style: "display:inline-block;width:70px" }, k), inp));
    }
    if (!editable.length) cfgPane.append(h("div", {}, "no editable properties"));
    K.openModal("Properties", body, [
      ["Cancel", null],
      ["Apply", () => {
        for (const [k, inp] of Object.entries(inputs)) {
          const old = comp.props[k];
          comp.props[k] = typeof old === "number" ? parseFloat(inp.value) || 0 : inp.value;
        }
        app.docChanged();
      }, "primary"],
    ]);
  };

  K.HexEditor._segmentAdapter = segmentAdapter;   // exposed for the browser tests

  // ---- RAM range calculator -------------------------------------------------
  // Pick a base address for a memory chip; an exact decoder is synthesized
  // from real '138s/gates and proved against the netlist on the spot.
  const hex5 = (v) => v.toString(16).toUpperCase().padStart(5, "0");
  K.RangeCalc = {
    open(app, comp) {
      const def = K.chips[comp.type];
      const size = def.probe.size;
      const cpus = app.doc.components.filter(c => K.chips[c.type].isCpu);
      if (!cpus.length) { K.openModal("Memory range", h("div", {}, "place a CPU first"), [["OK", null, "primary"]]); return; }

      const currentFor = () => {
        const map = K.analyzeMemoryMap(app.doc);
        const rows = [];
        for (const cpu of map.cpus) {
          const segs = cpu.segments.filter(s => s.parts.some(p => p.compId === comp.id));
          const real = segs.filter(s => !s.alias), mirrors = segs.length - real.length;
          rows.push(`${cpu.ref}: ` + (real.length
            ? real.map(s => `${hex5(s.start)}h-${hex5(s.end)}h`).join(", ") + (mirrors ? ` + ${mirrors} mirror${mirrors > 1 ? "s" : ""}` : "")
            : "not reachable"));
        }
        return rows;
      };

      const cpuSel = h("select", {}, ...cpus.map(c => h("option", { value: c.id }, `${c.props.ref} (${c.type})`)));
      const baseIn = h("input", { type: "text", value: "08000", spellcheck: "false", style: "width:90px;font-family:var(--mono)" });
      const result = h("div", { class: "rcResult" });
      const current = h("div", { class: "rcCurrent" }, ...currentFor().map(r => h("div", {}, r)));
      const body = h("div", { class: "acBody" },
        h("div", {}, `${comp.props.ref} — ${def.name} (${size >= 1024 ? size / 1024 + "K" : size} bytes)`),
        h("div", { class: "sect", style: "margin-top:8px" }, "proved mapping now"),
        current,
        h("div", { class: "sect", style: "margin-top:8px" }, "move it"),
        h("div", { style: "display:flex;gap:6px;align-items:center;margin:4px 0" },
          "base ", baseIn, h("span", { class: "rcH" }, "h"),
          cpus.length > 1 ? cpuSel : ""),
        h("div", { class: "acHint" },
          "An exact decoder ('138s + gates as needed) replaces the chip's select wiring, then the netlist is re-probed to certify the range — no mirrors, no overlaps."),
        result);

      K.openModal("Memory range calculator", body, [
        ["Synthesize + verify", () => {
          const base = parseInt(baseIn.value, 16);
          if (Number.isNaN(base) || base < 0) { result.textContent = "base must be a hex address"; return false; }
          const cpu = cpus.length > 1 ? app.doc.components.find(c => c.id === cpuSel.value) : cpus[0];
          const r = K.synthRange(app.doc, comp, cpu, base);
          app.ensureRefs();
          app.docChanged();
          result.innerHTML = "";
          result.append(h("div", { class: r.ok ? "rcOk" : "rcBad" }, r.ok ? "✓ verified" : "✗ not applied cleanly"));
          for (const n of r.notes) result.append(h("div", {}, n));
          current.innerHTML = "";
          for (const row of currentFor()) current.append(h("div", {}, row));
          return false;                          // stay open to read the report
        }, "primary"],
        ["Close", null, ""],
      ]);
    },
  };
})(globalThis.K8086 ??= {});
