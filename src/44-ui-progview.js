"use strict";
(function (K) {
  if (typeof document === "undefined") return;
  const h = (...a) => K.h(...a);
  const { SIG } = K;

  // "Programmer's view" — double-click a chip to see and edit everything software
  // could set through IO: the registers behind the ports, not the RTL. Values are
  // live while running; editing needs the simulation paused (except real inputs
  // like switches/buttons, which stay live like on a real bench).

  const hexField = (label, width, get, set, canEdit) => {
    const row = h("div", { class: "pvField" }, h("label", {}, label));
    if (!canEdit || !set) { row.append(h("b", {}, K.hex(get(), width))); return row; }
    const inp = h("input", { class: "regEdit", value: K.hex(get(), width), maxlength: String(width) });
    const commit = () => {
      const v = parseInt(inp.value, 16);
      if (Number.isFinite(v)) set(v);
      else inp.value = K.hex(get(), width);
    };
    inp.addEventListener("change", commit);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { commit(); inp.blur(); } e.stopPropagation(); });
    row.append(inp);
    return row;
  };

  const bitGrid = (label, get, set, canEdit, bitNames) => {
    const row = h("div", { class: "pvField" }, h("label", {}, label));
    const grid = h("span", { class: "bitGrid" });
    const v = get();
    for (let i = 7; i >= 0; i--) {
      const on = (v >> i) & 1;
      grid.append(h("span", {
        class: "bitCell" + (on ? " on" : "") + (canEdit && set ? " editable" : ""),
        title: (bitNames ? bitNames[i] + " — " : "") + "bit " + i,
        onclick: canEdit && set ? () => set(get() ^ (1 << i)) : null,
      }, String(i)));
    }
    row.append(grid, h("b", {}, K.hex(v, 2)));
    return row;
  };

  const lamp = (label, on, color) => h("span", { class: "pvLamp" + (on ? " on" : ""), style: on && color ? `--lampc:${color}` : "" }, label);
  const IRNAMES = ["IR0", "IR1", "IR2", "IR3", "IR4", "IR5", "IR6", "IR7"];

  const VIEWS = {
    "PRINTER": (chip, app, canEdit, body) => {
      const st = chip.state;
      const card = h("div", { class: "pvCard" }, h("h4", {}, "paper"));
      card.append(h("pre", { class: "pvPaper" }, st.paper || "(nothing printed yet)"));
      card.append(h("div", { class: "pvField" },
        h("label", {}, `${st.chars} character${st.chars === 1 ? "" : "s"}`),
        h("span", { class: "spacer" }),
        h("button", { onclick: () => { st.paper = ""; st.chars = 0; } }, "tear off")));
      body.append(card);
    },

    "SPKR": (chip, app, canEdit, body) => {
      const st = chip.state;
      const live = app.sim && st.freq > 0 && app.sim.t - st.lastT < app.sim.hz / 20;
      const card = h("div", { class: "pvCard" }, h("h4", {}, "speaker"));
      card.append(h("div", { class: "pvFreq" + (live ? " live" : "") },
        live ? (st.freq >= 1000 ? (st.freq / 1000).toFixed(2) + " kHz" : st.freq + " Hz") : "silent"));
      if (st.log.length) {
        card.append(h("div", { class: "pvNote" }, "recent tones: " +
          st.log.slice(-8).map(e => e.f + " Hz").join(" · ")));
      }
      const listening = !!K._spkrAudio && K._spkrAudio.compId === chip.comp.id;
      card.append(h("div", { class: "pvField" },
        h("label", {}, listening ? "listening (WebAudio square wave)" : "browser audio"),
        h("span", { class: "spacer" }),
        h("button", { class: listening ? "" : "primary", onclick: () => {
          if (listening) K.spkrStop();
          else K.spkrListen(app, chip);
        } }, listening ? "🔇 mute" : "🔊 listen")));
      body.append(card);
    },

    "8259A": (chip, app, canEdit, body) => {
      const st = chip.state;
      const card = h("div", { class: "pvCard" }, h("h4", {}, "interrupt controller"));
      card.append(hexField("vector base", 2, () => st.base, (v) => { st.base = v & 0xF8; app.chipStateEdited(chip); }, canEdit));
      card.append(h("div", { class: "pvNote" }, `IR0..IR7 → INT ${K.hex(st.base & 0xF8, 2)}..${K.hex((st.base & 0xF8) + 7, 2)}`));
      card.append(bitGrid("IMR (mask)", () => st.imr, (v) => { st.imr = v; app.chipStateEdited(chip); }, canEdit, IRNAMES));
      card.append(bitGrid("IRR (requests)", () => st.irr, (v) => { st.irr = v; app.chipStateEdited(chip); }, canEdit, IRNAMES));
      card.append(bitGrid("ISR (in service)", () => st.isr, (v) => { st.isr = v; app.chipStateEdited(chip); }, canEdit, IRNAMES));
      card.append(h("div", { class: "pvField" }, h("label", {}, "INT line"), lamp("INT", st.intOut === 1)));
      body.append(card);
    },

    "8253": (chip, app, canEdit, body) => {
      const MODES = ["0 int on TC", "1 one-shot", "2 rate gen", "3 square", "4 sw strobe", "5 hw strobe"];
      chip.state.ctr.forEach((c, i) => {
        const io = app.sim.ios[chip.ci];
        const gate = io.in("GATE" + i) !== SIG.L;
        const card = h("div", { class: "pvCard" }, h("h4", {}, `counter ${i}`,
          h("span", { class: "spacer" }), lamp("OUT", c.out === 1), lamp("GATE", gate, "#dcdcaa")));
        const modeRow = h("div", { class: "pvField" }, h("label", {}, "mode"));
        if (canEdit) {
          const sel = h("select", { onchange: () => { c.mode = +sel.value; app.chipStateEdited(chip); } },
            MODES.map((m, mi) => h("option", { value: String(mi), selected: c.mode === mi ? "" : undefined }, m)));
          modeRow.append(sel);
        } else modeRow.append(h("b", {}, MODES[c.mode] || String(c.mode)));
        card.append(modeRow);
        card.append(hexField("reload", 4, () => c.reload, (v) => { c.reload = v; app.chipStateEdited(chip); }, canEdit));
        card.append(hexField("count", 4, () => c.count, (v) => { c.count = v; app.chipStateEdited(chip); }, canEdit));
        card.append(h("div", { class: "pvNote" }, c.armed ? "armed — counting on CLK falling edges while GATE is high" : "not armed (write a count)"));
        body.append(card);
      });
    },

    "8255": (chip, app, canEdit, body) => {
      const st = chip.state;
      const d = chip.def._dirs(st);
      const card = h("div", { class: "pvCard" }, h("h4", {}, "parallel interface"));
      card.append(bitGrid("control", () => st.ctrl, (v) => { st.ctrl = v | 0x80; app.chipStateEdited(chip); }, canEdit,
        ["C-lo dir", "B dir", "B mode", "C-hi dir", "A dir", "A mode0", "A mode1", "mode set"]));
      card.append(h("div", { class: "pvNote" },
        `A: ${d.aIn ? "input" : "output"} · B: ${d.bIn ? "input" : "output"} · C-hi: ${d.chIn ? "input" : "output"} · C-lo: ${d.clIn ? "input" : "output"}`));
      card.append(bitGrid("port A latch", () => st.a, (v) => { st.a = v; app.chipStateEdited(chip); }, canEdit));
      card.append(bitGrid("port B latch", () => st.b, (v) => { st.b = v; app.chipStateEdited(chip); }, canEdit));
      card.append(bitGrid("port C latch", () => st.c, (v) => { st.c = v; app.chipStateEdited(chip); }, canEdit));
      body.append(card);
    },

    "74LS373": (chip, app, canEdit, body) => {
      const card = h("div", { class: "pvCard" }, h("h4", {}, "transparent latch"));
      card.append(bitGrid("Q (latched)", () => chip.state.q, (v) => { chip.state.q = v; app.chipStateEdited(chip); }, canEdit));
      const io = app.sim.ios[chip.ci];
      card.append(h("div", { class: "pvField" }, h("label", {}, "control"),
        lamp("LE", io.in("LE") === SIG.H, "#dcdcaa"), lamp("~OE", io.in("~OE") === SIG.H)));
      card.append(h("div", { class: "pvNote" }, io.in("LE") === SIG.H ? "transparent — Q follows D" : "latched"));
      body.append(card);
    },
    "74LS374": (chip, app, canEdit, body) => VIEWS["74LS373"](chip, app, canEdit, body),
    "8254": (chip, app, canEdit, body) => VIEWS["8253"](chip, app, canEdit, body),

    "74LS74": (chip, app, canEdit, body) => {
      const card = h("div", { class: "pvCard" }, h("h4", {}, "dual D flip-flop"));
      for (const q of ["q1", "q2"])
        card.append(h("div", { class: "pvField" }, h("label", {}, q.toUpperCase()),
          canEdit ? h("button", { onclick: () => { chip.state[q] ^= 1; app.chipStateEdited(chip); } }, String(chip.state[q]))
                  : h("b", {}, String(chip.state[q]))));
      body.append(card);
    },

    "74LS393": (chip, app, canEdit, body) => {
      const card = h("div", { class: "pvCard" }, h("h4", {}, "ripple counter"));
      card.append(hexField("counter 1", 1, () => chip.state.c1, (v) => { chip.state.c1 = v & 15; app.chipStateEdited(chip); }, canEdit));
      card.append(hexField("counter 2", 1, () => chip.state.c2, (v) => { chip.state.c2 = v & 15; app.chipStateEdited(chip); }, canEdit));
      body.append(card);
    },

    "8284A": (chip, app, canEdit, body) => {
      const st = chip.state;
      const card = h("div", { class: "pvCard" }, h("h4", {}, "clock generator"));
      card.append(h("div", { class: "pvField" }, h("label", {}, "status"),
        lamp("CLK", st.clk === 1), lamp("READY", st.ready === 1, "#4ec9b0"), lamp("RESET", st.reset === 1, "#ff6b6b")));
      card.append(h("div", { class: "pvNote" }, st.por > 0 ? `power-on reset: ${st.por} half-cycles remaining` : "power-on reset complete"));
      card.append(h("div", { class: "pvNote" }, `crystal ${chip.comp.props.mhz} MHz ÷ 3 → CLK ${(chip.comp.props.mhz / 3).toFixed(3)} MHz`));
      body.append(card);
    },

    UPD765: (chip, app, canEdit, body) => {
      const st = chip.state;
      const disk = chip.runtime.disk;
      const geo = disk ? chip.def._geo(disk) : null;
      const card = h("div", { class: "pvCard" }, h("h4", {}, "floppy drive A:",
        h("span", { class: "spacer" }), lamp("MOTOR", (st.dor & 0x10) !== 0), lamp("IRQ", st.irq === 1, "#e5c07b")));
      card.append(h("div", { class: "pvField" }, h("label", {}, "diskette"),
        h("b", {}, disk ? `${(disk.length / 1024).toFixed(0)}K (${geo.tracks}×${geo.heads}×${geo.spt})` : "— ejected —")));
      card.append(h("div", { class: "pvField" }, h("label", {}, "activity"),
        h("b", {}, `${st.stats.reads} sectors read · ${st.stats.writes} written · track ${st.track[0]}`)));
      const row = h("div", { class: "pvField" }, h("label", {}, "diskette bay"));
      const insertBytes = (bytes, handle) => {
        chip.runtime.disk = bytes;
        chip.runtime.fileHandle = handle || null;
        chip.runtime.dmaChip = undefined;
        K.progView(app, chip.comp);   // re-render fresh modal
      };
      row.append(h("button", {
        onclick: async () => {
          try {
            if (window.showOpenFilePicker) {
              const [fh] = await window.showOpenFilePicker({
                types: [{ description: "Floppy image", accept: { "application/octet-stream": [".img", ".ima", ".bin"] } }],
              });
              const buf = await (await fh.getFile()).arrayBuffer();
              K.closeModal();
              insertBytes(new Uint8Array(buf), fh);
            } else {
              const inp = document.createElement("input");
              inp.type = "file";
              inp.accept = ".img,.ima,.bin";
              inp.onchange = async () => {
                const buf = await inp.files[0].arrayBuffer();
                K.closeModal();
                insertBytes(new Uint8Array(buf), null);
              };
              inp.click();
            }
          } catch { /* user cancelled */ }
        },
      }, "⏏ insert .img…"));
      if (K.assets && K.assets.freedos144) {
        row.append(h("button", {
          onclick: () => { K.closeModal(); insertBytes(K.assetBytes("freedos144"), null); },
        }, "insert FreeDOS boot disk"));
      }
      if (disk) {
        row.append(h("button", { onclick: () => { K.fdcEject(app.sim, chip.comp.id); K.closeModal(); K.progView(app, chip.comp); } }, "eject"));
        row.append(h("button", { onclick: () => { K.closeModal(); K.DiskTools.open(app, chip.comp); } }, "🛠 disk tools"));
        row.append(h("button", { onclick: () => { K.closeModal(); K.DiskLib.open(app); } }, "🖴 library"));
      } else {
        row.append(h("button", { onclick: () => { K.closeModal(); K.DiskTools.open(app, chip.comp); } }, "🛠 format new…"));
      }
      card.append(row);
      if (disk) {
        const row2 = h("div", { class: "pvField" }, h("label", {}, "persist"));
        if (chip.runtime.fileHandle) {
          row2.append(h("button", {
            class: "primary",
            onclick: async () => {
              try {
                const w = await chip.runtime.fileHandle.createWritable();
                await w.write(disk);
                await w.close();
                row2.append(h("b", {}, " saved ✓"));
              } catch (e) { row2.append(h("b", { style: "color:var(--hot)" }, " " + e.message)); }
            },
          }, "⤓ write back to file"));
        }
        row2.append(h("button", {
          onclick: () => {
            const blob = new Blob([disk], { type: "application/octet-stream" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "floppy.img";
            a.click();
          },
        }, "download .img"));
        card.append(row2);
        card.append(h("div", { class: "pvNote" },
          "the diskette lives outside snapshots — like real media, writes are not undone by rewind"));
      }
      body.append(card);
    },

    XTIDE: (chip, app, canEdit, body) => {
      const st = chip.state;
      const hdd = chip.runtime.hdd;
      const card = h("div", { class: "pvCard" }, h("h4", {}, "fixed disk C:",
        h("span", { class: "spacer" }), lamp("DRDY", (st.status & 0x40) !== 0), lamp("DRQ", (st.status & 0x08) !== 0, "#e5c07b")));
      card.append(h("div", { class: "pvField" }, h("label", {}, "drive"),
        h("b", {}, hdd ? `${(hdd.length / 1048576).toFixed(1)} MB (${K.XTIDE_GEO.cyl}×${K.XTIDE_GEO.heads}×${K.XTIDE_GEO.spt})` : "— not attached —")));
      card.append(h("div", { class: "pvField" }, h("label", {}, "activity"),
        h("b", {}, `${st.stats.reads} sectors read · ${st.stats.writes} written`)));
      const row = h("div", { class: "pvField" }, h("label", {}, "disk"));
      const attach = (bytes, handle) => {
        chip.runtime.hdd = bytes;
        chip.runtime.hddHandle = handle || null;
        K.progView(app, chip.comp);
      };
      row.append(h("button", { onclick: () => { K.closeModal(); attach(new Uint8Array(K.XTIDE_CAP), null); } }, "attach blank 10 MB"));
      row.append(h("button", { onclick: () => { K.closeModal(); K.DiskLib.open(app); } }, "🖴 library"));
      row.append(h("button", {
        onclick: async () => {
          try {
            if (window.showOpenFilePicker) {
              const [fh] = await window.showOpenFilePicker({
                types: [{ description: "Disk image", accept: { "application/octet-stream": [".img", ".hdd", ".bin"] } }],
              });
              const buf = await (await fh.getFile()).arrayBuffer();
              K.closeModal();
              attach(new Uint8Array(buf), fh);
            } else {
              const inp = document.createElement("input");
              inp.type = "file";
              inp.onchange = async () => { const b = await inp.files[0].arrayBuffer(); K.closeModal(); attach(new Uint8Array(b), null); };
              inp.click();
            }
          } catch { /* cancelled */ }
        },
      }, "⏏ load .img…"));
      card.append(row);
      if (hdd) {
        const row2 = h("div", { class: "pvField" }, h("label", {}, "persist"));
        if (chip.runtime.hddHandle) {
          row2.append(h("button", {
            class: "primary",
            onclick: async () => {
              try {
                const w = await chip.runtime.hddHandle.createWritable();
                await w.write(hdd);
                await w.close();
                row2.append(h("b", {}, " saved ✓"));
              } catch (e) { row2.append(h("b", { style: "color:var(--hot)" }, " " + e.message)); }
            },
          }, "⤓ write back to file"));
        }
        row2.append(h("button", {
          onclick: () => {
            const blob = new Blob([hdd], { type: "application/octet-stream" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "harddisk.img";
            a.click();
          },
        }, "download .img"));
        card.append(row2);
        card.append(h("div", { class: "pvNote" },
          "partition and format from DOS (FDISK + FORMAT C:) exactly like 1985 — or use FAT tools on a floppy for quick transfer"));
      }
      body.append(card);
    },

    COM8250: (chip, app, canEdit, body) => {
      const st = chip.state;
      const card = h("div", { class: "pvCard" }, h("h4", {}, "COM1 serial port",
        h("span", { class: "spacer" }), lamp("RX", st.rxQ.length > 0, "#e5c07b"), lamp("IRQ", (st.ier & 1) && st.rxQ.length > 0)));
      const baud = Math.round(1843200 / (16 * Math.max(1, (st.dlm << 8) | st.dll)));
      card.append(h("div", { class: "pvField" }, h("label", {}, "line"),
        h("b", {}, `${baud} baud · ${st.txCount} bytes sent · ${st.rxQ.length} rx queued`)));
      card.append(h("div", { class: "pvField" },
        h("button", { class: "primary", onclick: () => { K.closeModal(); K.TerminalView.open(app, chip.comp); } }, "🖳 open terminal")));
      body.append(card);
    },

    SW8: (chip, app, canEdit, body) => {
      const card = h("div", { class: "pvCard" }, h("h4", {}, "DIP switches — live, like a real bench"));
      card.append(bitGrid("switches", () => chip.comp.props.bits,
        (v) => app.sim.applyInput(chip.comp.id, { bits: v }), true)); // always live
      body.append(card);
    },
    BTN: (chip, app, canEdit, body) => {
      const card = h("div", { class: "pvCard" }, h("h4", {}, "push button"));
      const btn = h("button", { class: chip.comp.props.pressed ? "primary" : "" }, chip.comp.props.pressed ? "pressed" : "press and hold");
      btn.addEventListener("mousedown", () => app.sim.applyInput(chip.comp.id, { pressed: true }));
      btn.addEventListener("mouseup", () => app.sim.applyInput(chip.comp.id, { pressed: false }));
      card.append(btn);
      body.append(card);
    },
  };

  function genericView(chip, app, canEdit, body) {
    const fields = chip.def.inspect
      ? chip.def.inspect(chip.state, chip.comp.props, chip)
      : Object.entries(chip.state)
          .filter(([k, v]) => k !== "arch" && k !== "mem" && (typeof v === "number" || typeof v === "boolean"))
          .map(([k]) => ({
            key: k,
            kind: typeof chip.state[k] === "boolean" ? "bool" : "num",
            get: () => chip.state[k],
            set: (x) => { chip.state[k] = typeof chip.state[k] === "boolean" ? !!x : x; },
          }));
    if (!fields.length) { body.append(h("div", { class: "pvNote" }, "this chip has no software-visible state")); return; }
    const card = h("div", { class: "pvCard" }, h("h4", {}, "internal state"));
    for (const f of fields) {
      if (f.kind === "bool")
        card.append(h("div", { class: "pvField" }, h("label", {}, f.key),
          canEdit ? h("button", { onclick: () => { f.set(!f.get()); app.chipStateEdited(chip); } }, String(f.get()))
                  : h("b", {}, String(f.get()))));
      else
        card.append(hexField(f.key, 4, () => f.get() & 0xFFFF, (v) => { f.set(v); app.chipStateEdited(chip); }, canEdit));
    }
    body.append(card);
  }

  // -------------------------------------------------------- serial terminal ----
  K.TerminalView = {
    open(app, comp) {
      const chip = app.sim && app.sim.chipFor(comp.id);
      if (!chip) { K.propsDialog(app, comp); return; }
      const out = h("pre", { class: "termOut" }, "");
      const inp = h("input", {
        class: "termIn",
        placeholder: "type here — characters go down the serial line (Enter sends CR)",
        spellcheck: "false",
      });
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (!app.sim) return;
        if (e.key === "Enter") { app.sim.applyInput(comp.id, { rx: 0x0D }); e.preventDefault(); }
        else if (e.key === "Backspace") { app.sim.applyInput(comp.id, { rx: 0x08 }); e.preventDefault(); }
        else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          app.sim.applyInput(comp.id, { rx: e.key.charCodeAt(0) & 0x7F });
          e.preventDefault();
        }
      });
      const render = () => {
        const txt = chip.state.tx.replace(/\r/g, "");
        if (out.textContent !== txt) {
          out.textContent = txt;
          out.scrollTop = out.scrollHeight;
        }
      };
      render();
      const wrap = h("div", { class: "termWrap" }, out, inp);
      K.openModal("Serial terminal — COM1 (3F8h)", h("div", {},
        wrap,
        h("div", { class: "pvNote" }, "9600 8N1 · RX bytes travel the input log (rewind replays your typing)")),
        [["Close", null, "primary"]]);
      document.getElementById("modalBox").classList.add("wide");
      inp.focus();
      const iv = setInterval(render, 120);
      K._modalOnClose = () => {
        document.getElementById("modalBox").classList.remove("wide");
        clearInterval(iv);
      };
    },
  };

  // ------------------------------------------------------- disk tools modal ----
  // Browse/format a FAT12 image, pull files in from the host file system,
  // extract or delete files — works on whatever diskette is in the drive.
  K.DiskTools = {
    open(app, comp) {
      const chip = app.sim && app.sim.chipFor(comp.id);
      if (!chip) return;
      let path = [];                       // [{name, cluster}]
      const body = h("div", { class: "pvBody" });
      const render = () => {
        body.innerHTML = "";
        const disk = chip.runtime.disk;
        const head = h("div", { class: "pvHead" },
          h("span", { class: "pvTitle" }, "Disk tools — drive A:"),
          h("span", { class: "pvSub" }, disk ? `${(disk.length / 1024) | 0}K FAT12` : "no diskette"),
          h("span", { class: "spacer" }));
        body.append(head);
        const bar = h("div", { class: "hexToolbar" });
        for (const kind of K.FAT_KINDS) {
          bar.append(h("button", {
            onclick: () => { chip.runtime.disk = K.fatFormat(kind); chip.runtime.fileHandle = null; path = []; render(); },
            title: "format a fresh " + kind + " FAT12 diskette in the drive",
          }, "format " + kind));
        }
        if (disk) {
          bar.append(h("span", { class: "spacer" }));
          bar.append(h("button", {
            onclick: () => {
              const blob = new Blob([disk], { type: "application/octet-stream" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "floppy.img";
              a.click();
            },
          }, "⤓ download .img"));
        }
        body.append(bar);
        if (!disk) { body.append(h("div", { class: "pvNote" }, "format a diskette or insert an image from the drive view")); return; }
        const list = path.length ? K.fatList(disk, path[path.length - 1].cluster) : K.fatList(disk);
        if (!list) { body.append(h("div", { class: "pvNote" }, "not a FAT12 image (raw data disk?) — hex editor still works on it")); return; }
        // breadcrumb
        const crumb = h("div", { class: "pvField" }, h("label", {}, "path"),
          h("b", { style: "cursor:pointer", onclick: () => { path = []; render(); } }, "A:\\"),
          ...path.map((p, i) => h("b", { style: "cursor:pointer", onclick: () => { path = path.slice(0, i + 1); render(); } }, p.name + "\\")));
        body.append(crumb);
        const tbl = h("table", { class: "dirTable" },
          h("tr", {}, h("th", {}, "name"), h("th", {}, "size"), h("th", {}, "")));
        for (const e of list) {
          const actions = h("td", {});
          if (e.dir) {
            actions.append(h("button", { onclick: () => { path.push({ name: e.name, cluster: e.cluster }); render(); } }, "open"));
          } else {
            actions.append(h("button", {
              onclick: () => {
                const bytes = K.fatExtract(disk, e);
                const blob = new Blob([bytes], { type: "application/octet-stream" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = e.name;
                a.click();
              },
            }, "⤓"));
          }
          if (!path.length) actions.append(h("button", { onclick: () => { K.fatDelete(disk, e); render(); } }, "✕"));
          tbl.append(h("tr", {},
            h("td", { style: e.dir ? "color:var(--accent2)" : "" }, (e.dir ? "▸ " : "") + e.name),
            h("td", {}, e.dir ? "<dir>" : String(e.size)),
            actions));
        }
        body.append(tbl);
        const addRow = h("div", { class: "pvField", style: "margin-top:8px" }, h("label", {}, "add file"));
        addRow.append(h("button", {
          class: "primary",
          onclick: () => {
            const inp = document.createElement("input");
            inp.type = "file";
            inp.onchange = async () => {
              for (const f of inp.files) {
                const err = K.fatAdd(disk, f.name, new Uint8Array(await f.arrayBuffer()));
                if (err) { addRow.append(h("b", { style: "color:var(--hot)" }, ` ${f.name}: ${err}`)); return; }
              }
              render();
            };
            inp.multiple = true;
            inp.click();
          },
        }, "⤒ from your computer… (into A:\\ root)"));
        body.append(addRow);
        body.append(h("div", { class: "pvNote" }, "changes are live in the drive — save/write back from the drive view to persist"));
      };
      render();
      K.openModal("Disk tools", body, [["Close", null, "primary"]]);
      document.getElementById("modalBox").classList.add("wide");
      K._modalOnClose = () => document.getElementById("modalBox").classList.remove("wide");
    },
  };

  K.progView = function (app, comp) {
    const chip = app.sim && app.sim.chipFor(comp.id);
    if (!chip) { K.propsDialog(app, comp); return; }
    const def = K.chips[comp.type];
    const container = h("div", { class: "pvBody" });

    const render = () => {
      if (document.activeElement && container.contains(document.activeElement) && document.activeElement.tagName !== "BODY") return;
      container.innerHTML = "";
      const canEdit = app.paused;
      container.append(h("div", { class: "pvHead" },
        h("span", { class: "pvTitle" }, `${comp.props.ref || comp.id} · ${def.type}`),
        h("span", { class: "pvSub" }, def.name),
        h("span", { class: "spacer" }),
        h("span", { class: "pvMode" + (canEdit ? " edit" : "") }, canEdit ? "PAUSED — editable" : "RUNNING — live view")));
      (VIEWS[comp.type] || genericView)(chip, app, canEdit, container);
    };
    render();
    K.openModal("Programmer's view", container, [["Close", null, "primary"]]);
    const refresh = setInterval(render, 300);
    K._modalOnClose = () => clearInterval(refresh);
  };

  // ---- speaker audio (WebAudio square wave that follows the measured tone) --
  K.spkrListen = function (app, chip) {
    if (typeof AudioContext === "undefined") return;
    K.spkrStop();
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    osc.type = "square";
    const gain = ac.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ac.destination);
    osc.start();
    const timer = setInterval(() => {
      const live = app.sim && chip.state.freq > 20 && chip.state.freq < 20000 &&
        app.sim.t - chip.state.lastT < app.sim.hz / 20;
      gain.gain.setTargetAtTime(live ? 0.08 : 0, ac.currentTime, 0.02);
      if (live) osc.frequency.setTargetAtTime(chip.state.freq, ac.currentTime, 0.02);
    }, 50);
    K._spkrAudio = { compId: chip.comp.id, stop: () => { clearInterval(timer); osc.stop(); ac.close(); } };
  };
  K.spkrStop = function () {
    if (K._spkrAudio) { try { K._spkrAudio.stop(); } catch {} K._spkrAudio = null; }
  };
})(globalThis.K8086 ??= {});
