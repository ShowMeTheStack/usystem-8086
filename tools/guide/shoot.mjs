// Guide screenshot harness: drives the built single-file app in headless
// Chromium and captures every documented feature — full views plus zoomed
// crops at the exact points of interest — writing shots/ + manifest.json
// for tools/guide/build.mjs to turn into the static guide site.
//
//   node tools/guide/shoot.mjs [--only=chapter,chapter] [--fast]
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync, readdirSync } from "node:fs";
import { BOARDS } from "./boards.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const OUT = root + "guide/shots";
const require = createRequire(import.meta.url);
let chromium;
for (const p of ["playwright-core", process.env.PW_PATH,
  "/private/tmp/claude-501/-Users-jmishra-8086/b919e010-240b-4ec6-839c-b73a3af63c00/scratchpad/node_modules/playwright-core"].filter(Boolean)) {
  try { chromium = require(p).chromium; break; } catch { /* next */ }
}
if (!chromium) { console.error("playwright-core not found"); process.exit(1); }
const exe = process.env.BROWSER_EXE ||
  process.env.HOME + "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const FAST = args.includes("--fast");

// Only a FULL run may wipe the corpus. A partial run (--only=chips) must not
// delete the 1200 committed screenshots it is not going to regenerate.
if (!only.length && existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const manifest = [];
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.dismiss().catch(() => {}));
await page.goto("file://" + root + "index.html");
await page.waitForTimeout(600);

// ---------------------------------------------------------------- helpers ---
const ev = (fn, arg) => page.evaluate(fn, arg);
let n = 0;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);

const usedNames = new Set();
async function capture(meta, target) {
  // Filenames are derived from the shot's stable id, NOT a running counter:
  // inserting a shot must not rename every file after it, or a versioned
  // repo would churn the whole tree on every regeneration.
  let base = slug(meta.id || meta.title);
  if (usedNames.has(base)) { let k = 2; while (usedNames.has(base + "-" + k)) k++; base = base + "-" + k; }
  usedNames.add(base);
  n++;
  const file = `${base}.jpg`;
  const opts = { path: `${OUT}/${file}`, type: "jpeg", quality: meta.q || 76 };
  try {
    if (target && target.clip) await page.screenshot({ ...opts, clip: target.clip });
    else if (target && target.sel) await page.locator(target.sel).screenshot(opts);
    else await page.screenshot(opts);
  } catch (e) {
    console.log("  ! shot failed:", meta.title, e.message.split("\n")[0]);
    return null;
  }
  manifest.push({ file, ...meta });
  return file;
}
const shotPage = (meta) => capture(meta, null);
const shotEl = (meta, sel) => capture(meta, { sel });
const shotCanvas = (meta) => capture(meta, { sel: "#schematic" });

// element bounding box -> padded clip for a "zoomed at the point of interest" crop
async function shotAround(meta, sel, pad = 14) {
  const box = await page.locator(sel).boundingBox().catch(() => null);
  if (!box) return null;
  const clip = {
    x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
    width: Math.min(1600 - Math.max(0, box.x - pad), box.width + pad * 2),
    height: Math.min(1000 - Math.max(0, box.y - pad), box.height + pad * 2),
  };
  return capture(meta, { clip });
}

const reset = async (preset = "min-8088") => {
  await ev((p) => {
    const app = K8086.App;
    if (app.sim) app.stop();
    K8086.closeModal();
    app.hideWires = false;
    document.getElementById("btnWires").classList.add("active");
    app.loadPreset(p);
    app.schematic.view = { x: -2, y: -2, zoom: 1.4 };
    app.schematic.render();
  }, preset);
  await page.waitForTimeout(FAST ? 40 : 90);
};

// center the schematic view on a component and render
const zoomComp = (compId, zoom = 3.4) => ev(([id, z]) => {
  const app = K8086.App;
  const c = K8086.docComp(app.doc, id);
  if (!c) return null;
  const g = K8086.chips[c.type].grid;
  const cv = document.getElementById("schematic");
  const U = 12, gw = cv.clientWidth / (z * U), gh = cv.clientHeight / (z * U);
  app.schematic.view = { x: c.x + g.w / 2 - gw / 2, y: c.y + (g.h + 1) / 2 - gh / 2, zoom: z };
  app.schematic.render();
  return true;
}, [compId, zoom]);

const fitBoard = (zoom) => ev((z) => {
  const app = K8086.App;
  const cv = document.getElementById("schematic");
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const c of app.doc.components) {
    const g = K8086.chips[c.type].grid;
    x0 = Math.min(x0, c.x - 2); y0 = Math.min(y0, c.y - 2);
    x1 = Math.max(x1, c.x + g.w + 2); y1 = Math.max(y1, c.y + g.h + 3);
  }
  if (x0 > x1) { app.schematic.view = { x: -2, y: -2, zoom: 1.4 }; app.schematic.render(); return; }
  const U = 12;
  const zoomFit = z || Math.min(cv.clientWidth / ((x1 - x0) * U), cv.clientHeight / ((y1 - y0) * U));
  const gw = cv.clientWidth / (zoomFit * U), gh = cv.clientHeight / (zoomFit * U);
  app.schematic.view = { x: (x0 + x1) / 2 - gw / 2, y: (y0 + y1) / 2 - gh / 2, zoom: zoomFit };
  app.schematic.render();
});

// hover a pin (real mouse move) so the probe tooltip and net glow render
async function hoverPin(compId, pinName) {
  const pt = await ev(([id, pn]) => {
    const app = K8086.App;
    const c = K8086.docComp(app.doc, id);
    if (!c) return null;
    const pin = K8086.chips[c.type].pins.find(p => p.name === pn);
    if (!pin) return null;
    const [sx, sy] = app.schematic.toScreen(...app.schematic.pinPos(c, pin));
    const r = document.getElementById("schematic").getBoundingClientRect();
    return { x: r.left + sx, y: r.top + sy };
  }, [compId, pinName]);
  if (!pt) return false;
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(FAST ? 30 : 70);
  return true;
}
const unhover = async () => { await page.mouse.move(5, 990); await page.waitForTimeout(20); };

// Advance the machine by an EXACT number of half-steps. The app's own
// requestAnimationFrame loop would otherwise keep stepping in wall-clock
// time and no two capture runs would produce the same pixels — which would
// make every regeneration a full 34MB of new blobs in a versioned repo.
const run = async (halfSteps) => ev((h) => {
  const app = K8086.App;
  if (!app.sim) app.start();
  app.paused = true;
  const b = document.getElementById("btnPause");
  if (b) b.textContent = "▶ Resume";
  for (let i = 0; i < h && !app.sim.halted && !app.sim.dbgStop; i++) app.sim.stepHalf();
  app.updateStatus();
  app.schematic.render();
  app.waveform.render();
}, halfSteps);

const chapters = {};
const chapter = (name, fn) => { chapters[name] = fn; };
const sec = (section, sub) => ({ section, sub });

// =============================================================== chapters ===
// centre crop of the schematic canvas — tighter framing, smaller files
async function shotCanvasCenter(meta, w = 860, h = 620) {
  const box = await page.locator("#schematic").boundingBox().catch(() => null);
  if (!box) return null;
  const cw = Math.min(w, box.width), ch = Math.min(h, box.height);
  return capture(meta, { clip: {
    x: box.x + (box.width - cw) / 2, y: box.y + (box.height - ch) / 2, width: cw, height: ch } });
}

const PRESET_NOTE = {
  "blank": "An empty bench: place parts, let the planner do the standard hookups, or wire pin by pin.",
  "logic-counter": "No CPU at all — a clock module, half a '393 and four LEDs. The gentlest possible introduction.",
  "min-8088": "The classic single-board computer, wired the way the cheap kits did it: partial address decoding and one latched output port.",
  "irq-lab": "8259A and 8253 wired PC-style at ports 20h and 40h. The CPU sleeps in HLT and wakes on real interrupts.",
  "max-8088": "MN/~MX strapped low: an 8288 decodes the CPU's status lines into separate memory and IO command strobes.",
  "word-8086": "A true 16-bit bus: two banks, even bytes on the low lane, odd on the high, ~BHE and A0 gating the writes.",
  "hgc-8088": "An 8088 writing straight into video memory at B000:0000, with the picture live on the board.",
  "kbd-8088": "Scancodes travel a serial line into a shift register, raise IRQ1, and land in video RAM as characters.",
  "uart-lab": "Polled serial IO the way BIOSes did it: LSR bit 5 gates transmit, bit 0 signals receive.",
  "pc-xt": "A full XT-class machine wired chip by chip. GLaBIOS POSTs, reads the boot sector over DMA, and FreeDOS comes up.",
  "dual-8088": "Two processors, one memory, zero coherence — an 8289 arbiter hands the bus back and forth.",
  "traffic-8255": "An 8255 drives a traffic light from port A. The whole board was wired by autoconnect.",
  "dip-echo": "The simplest input port there is: a '244 gates the switches onto the bus for any IO read.",
  "seg7-count": "A '373 drives a seven-segment digit; the program walks a segment table, exactly like the kit manuals taught.",
  "wait-state": "Three flip-flops make the classic wait-state shift register: READY comes up one clock too late, every cycle.",
  "mixed-cpu": "An 8086 and an 8088 sharing one word-wide bus — watch the 8088 pay two cycles for the same work.",
  "pc-speaker": "The 8253 in mode 3 is a square-wave synthesiser: change the divisor, change the note.",
  "lpt-printer": "Centronics done honestly: poll BUSY, latch a byte, pulse STROBE, and the printer answers.",
  "pic-cascade": "Master and slave interrupt controllers exactly like the PC/AT — fifteen usable request lines.",
  "pit-modes": "Channel 0 free-runs a square wave; channel 1 is a hardware one-shot you trigger with a button.",
  "fixit-lab": "A board wired in a hurry. The program is fine; the board is not. Read the checks and repair it.",
};

chapter("overview", async () => {
  await reset("min-8088");
  await shotPage({ ...sec("overview", "The workspace"), id: "workspace-full",
    title: "The complete workspace", q: 84,
    caption: "Everything lives in one HTML file: the parts library on the left, the schematic canvas in the middle, the panel stack on the right, the waveform analyzer along the bottom, and the toolbar across the top. No install, no server, no accounts." });
  // every toolbar control, cropped
  const controls = [
    ["#presetSel", "Preset picker", "Twenty-one boards ship with the tool, from a ripple counter to a PC/XT that boots FreeDOS. Loading one replaces the board, the program and the waveform selection."],
    ["#btnStart", "Start / Stop", "Start runs the design checks, programs the ROMs, proves the memory map by probing your netlist, and builds the simulation."],
    ["#btnPause", "Pause / Resume", "Freezes simulated time. Pausing also leaves turbo, because stepping and probing want full fidelity."],
    ["#btnStepC", "Step one cycle", "One clock half-step. This is how you watch a bus cycle assemble itself: address out with ALE, strobe low, data sampled, strobe high."],
    ["#btnStepI", "Step one instruction", "Runs exactly one instruction, however many bus cycles that takes."],
    ["#speed", "Speed", "Ten stops from two steps per second up to max: 2, 10, 60, 300, 1500, 8000, 40k, 200k, 1M, then uncapped."],
    ["#btnTurbo", "Turbo", "Compiles the board's clock tree and batches CPU execution to reach real 8088 speed. Waveform capture pauses while it is engaged."],
    ["#rewind", "Rewind", "Scrubs backwards through recorded history — the whole machine returns to how it was, not a replay."],
    ["#btnUndo", "Undo / redo", "Every board edit is one step. An accepted autowiring plan — however many wires and created chips it involved — is also one step."],
    ["#btnLab", "Guided lab", "Appears for the nine boards that ship an exercise: numbered steps you tick off as you work."],
    ["#btnWires", "No-wire mode", "Hides every wire while leaving the netlist intact. Click a chip and only its connections are drawn."],
    ["#btnSweep", "Complete the board", "Scans the whole board, offers every hookup that is possible right now, and repairs connections that have gone missing."],
    ["#themeSel", "Themes", "Twenty colour schemes, ten dark and ten light."],
    ["#status", "Status", "Simulated time, cycles, instructions retired, and the measured clock rate."],
  ];
  for (const [sel, title, caption] of controls)
    await shotAround({ ...sec("overview", "The toolbar"), id: "tb-" + slug(title), title, caption }, sel, 8);
  await shotAround({ ...sec("overview", "The workspace"), id: "library-pane", title: "The parts library",
    caption: "Every modelled chip and device, grouped by category. Click a part, then click the canvas to place it. The library locks while the simulation runs." }, "#library", 2);
  await shotAround({ ...sec("overview", "The workspace"), id: "tabs", title: "The panel tabs",
    caption: "Code, Debug, CPU, Chip and Checks — the five views of what your board is doing." }, "#rightTabs", 6);
  await shotAround({ ...sec("overview", "The workspace"), id: "hint-bar", title: "The hint bar",
    caption: "Context-sensitive guidance: what you can do next, what the planner noticed, why the simulation stopped." }, "#hint", 8);
  for (const [which, title] of [["left", "library"], ["right", "panels"], ["waveC", "waveforms"]]) {
    await ev((w) => K8086.App.togglePane(w), which);
    await page.waitForTimeout(90);
    await shotPage({ ...sec("overview", "Panes"), id: "pane-" + which, title: `The ${title} pane collapsed`,
      caption: `Every divider drags to resize and double-clicks to collapse. With all three collapsed the schematic takes the whole window.`, q: 70 });
  }
  await ev(() => { for (const w of ["left", "right", "waveC"]) K8086.App.togglePane(w); });
  await page.waitForTimeout(120);
  await run(4000);
  await shotPage({ ...sec("overview", "First run"), id: "running-board", title: "A board mid-simulation", q: 84,
    caption: "Wires carry live logic levels, the LEDs light, the analyzer fills, and the CPU panel shows registers changing." });
  await ev(() => K8086.App.showTab("cpu"));
  await page.waitForTimeout(80);
  await shotAround({ ...sec("overview", "First run"), id: "cpu-first", title: "The CPU, live",
    caption: "Registers, flags, the prefetch queue and the current bus cycle — all updating as the machine runs." }, "#rightBody", 6);
  await reset();
});

chapter("canvas", async () => {
  await reset("min-8088");
  await fitBoard();
  await shotCanvas({ ...sec("canvas", "Reading a schematic"), id: "canvas-fit", title: "The whole board", q: 84,
    caption: "Chips are drawn as real DIP outlines with the notch at pin 1 and pins on the sides the datasheet puts them." });
  const comps = await ev(() => K8086.App.doc.components.map(c => ({ id: c.id, ref: c.props.ref, type: c.type })));
  const cpu = comps.find(c => c.type === "8088");
  // zoom ladder
  for (const z of [1.0, 1.8, 2.8, 4.2, 6.0]) {
    await zoomComp(cpu.id, z);
    await shotCanvasCenter({ ...sec("canvas", "Zooming"), id: `zoom-${String(z).replace(".", "-")}`,
      title: `Zoom ${z}×`, q: 74,
      caption: z < 2 ? "Zoomed out, the board reads as a floorplan." : z < 4 ? "Pin names appear as you zoom in." : "At high zoom, pin numbers appear alongside the names and active-low pins carry overbars." });
  }
  // hover tour: probe many pins
  await ev(() => K8086.App.start());
  await run(1200);
  await fitBoard(2.6);
  const tour = [[cpu.id, "ALE"], [cpu.id, "~RD"], [cpu.id, "AD0"], [cpu.id, "A19"], [cpu.id, "CLK"],
    [cpu.id, "READY"], [cpu.id, "MN/~MX"], [cpu.id, "IO/~M"]];
  for (const [id, pin] of tour) {
    if (!await hoverPin(id, pin)) continue;
    await shotPage({ ...sec("canvas", "Hovering"), id: `hover-${slug(pin)}`, title: `Probing ${pin}`, q: 78,
      caption: `Hovering ${pin} names the pin, gives its number and kind, identifies its net, shows the live logic level, and lists every other pin on that net — while the whole net glows on the canvas.` });
  }
  await shotAround({ ...sec("canvas", "Hovering"), id: "hover-tip-detail", title: "The probe tooltip",
    caption: "Net name, live value, and the full membership of the net — the fastest way to answer \"what is this actually connected to?\"" }, "#tooltip", 10);
  await unhover();
  await ev(() => K8086.App.stop());
  await reset("min-8088");
  // bus anatomy
  await fitBoard(2.2);
  await shotCanvas({ ...sec("canvas", "Bus anatomy"), id: "bus-anatomy", title: "Buses drawn like a schematic",
    caption: "Pins fan out on curved leads, gather at a tap, run as one straight trunk with mitred corners, then fan back out at the far end." });
  for (const [type, cap] of [["74LS373", "Eight leads curve out of the trunk into the latch's D inputs — you can follow any single bit by eye."],
    ["EPROM2764", "The same bundle arrives at the ROM and disperses into its address pins."]]) {
    await ev((t) => {
      const app = K8086.App;
      const c = app.doc.components.find(x => x.type === t);
      if (!c) return;
      const g = K8086.chips[c.type].grid, cv = document.getElementById("schematic");
      const z = 5.0, U = 12;
      app.schematic.view = { x: c.x - 10, y: c.y + g.h / 2 - cv.clientHeight / (2 * z * U), zoom: z };
      app.schematic.render();
    }, type);
    await shotCanvasCenter({ ...sec("canvas", "Bus anatomy"), id: "bus-fan-" + slug(type),
      title: `Fan-out at the ${type}`, caption: cap });
  }
  await ev(() => K8086.App.start());
  await run(600);
  await fitBoard(2.4);
  await shotCanvas({ ...sec("canvas", "Bus anatomy"), id: "bus-slash-live", title: "Slash labels carry live values",
    caption: "Each trunk is tagged with its width, its name and its current hex value: 8 · AD[7:0] = 5A." });
  await ev(() => K8086.App.stop());
  await reset("min-8088");
  // selection
  await fitBoard(2.4);
  for (const [kind, type, title, cap] of [
    ["comp", "74LS138", "Selected component", "Click a chip to select it. Delete removes it and every wire attached to it; right-clicking it twice does the same."],
    ["comp", "EPROM2764", "Selecting a memory", "Selection also drives the Chip panel, which shows internal state and live pin values."]]) {
    await ev((t) => {
      const app = K8086.App;
      const c = app.doc.components.find(x => x.type === t);
      app.selection = { kind: "comp", comp: c };
      app.schematic.render();
    }, type);
    await shotCanvas({ ...sec("canvas", "Selecting and editing"), id: "select-" + slug(type), title, caption: cap });
  }
  await ev(() => {
    const app = K8086.App;
    const w = app.doc.wires.find(x => x.bundle);
    app.selection = { kind: "bundle", key: w.bundle, wires: app.doc.wires.filter(y => y.bundle === w.bundle) };
    app.schematic.render();
  });
  await shotCanvas({ ...sec("canvas", "Selecting and editing"), id: "select-bundle", title: "Selected bus",
    caption: "Selecting one lead of a bus selects the whole bundle, so an eight-bit bus is deleted or moved as a unit." });
  // no-wire mode
  await ev(() => { K8086.App.selection = null; K8086.App.toggleWires(); K8086.App.schematic.render(); });
  await shotCanvas({ ...sec("canvas", "No-wire mode"), id: "nowire-all", title: "Wires hidden, netlist intact",
    caption: "〰 wires hides every wire. Nothing about the design changes — this is a reading mode for dense boards." });
  await shotAround({ ...sec("canvas", "No-wire mode"), id: "nowire-hint", title: "What the hint bar says",
    caption: "In no-wire mode the hint bar reminds you that hovering a pin still lights its whole net." }, "#hint", 8);
  for (const type of ["8088", "EPROM2764", "74LS373"]) {
    await ev((t) => {
      const app = K8086.App;
      app.selection = { kind: "comp", comp: app.doc.components.find(x => x.type === t) };
      app.schematic.render();
    }, type);
    await shotCanvas({ ...sec("canvas", "No-wire mode"), id: "nowire-" + slug(type),
      title: `Only the ${type}'s wires`,
      caption: `Click any chip while wires are hidden and only that chip's connections are drawn — the cleanest way to trace one device at a time.` });
  }
  await ev(() => { K8086.App.toggleWires(); K8086.App.selection = null; K8086.App.schematic.render(); });
  await ev(() => { K8086.App.placing = "8255"; K8086.App.setHint("placing 8255 — click the canvas to drop, Esc to cancel"); });
  await shotAround({ ...sec("canvas", "Placing parts"), id: "placing-hint", title: "Placing a part",
    caption: "Pick a part in the library and the hint bar tells you what happens next; click the canvas to drop it on the grid." }, "#hint", 8);
  await ev(() => { K8086.App.placing = null; });
  await reset();
});

chapter("boards", async () => {
  const presets = await ev(() => K8086.presets.map(p => ({ id: p.id, name: p.name, blurb: p.blurb, lab: !!p.lab })));
  const unresolved = [];
  for (const p of presets) {
    const info = BOARDS[p.id] || { chips: [] };
    await reset(p.id);
    await fitBoard();
    await shotCanvas({ ...sec("boards", p.name), id: `board-${p.id}`, title: p.name, q: 86,
      caption: info.one || p.blurb, board: p.id, kind: "board" });
    // photograph ONLY the parts the prose talks about, captioned with their role
    for (const [key, role] of info.chips) {
      const found = await ev((k) => {
        const app = K8086.App;
        const byName = app.presetNames && app.presetNames[k];
        const c = byName
          || app.doc.components.find(x => x.type === k)
          || app.doc.components.find(x => x.type.toLowerCase() === String(k).toLowerCase());
        return c ? { id: c.id, ref: c.props.ref, type: c.type } : null;
      }, key);
      if (!found) { unresolved.push(p.id + ":" + key); continue; }
      await zoomComp(found.id, 3.2);
      await shotCanvasCenter({ ...sec("boards", p.name), id: `board-${p.id}-${slug(key)}`,
        title: `${found.ref} — ${found.type}`, board: p.id, kind: "detail", q: 78,
        caption: role }, 840, 610);
    }
    if (p.lab && !FAST) {
      await ev(() => K8086.App.openLab());
      await page.waitForTimeout(70);
      await shotAround({ ...sec("boards", p.name), id: `lab-${p.id}`, title: `${p.name} — the guided lab`,
        board: p.id, kind: "lab", q: 82,
        caption: "This board ships a numbered exercise; the ticks persist as you work through it." }, "#modalBox", 10);
      await ev(() => K8086.closeModal());
    }
    if (!FAST && p.id !== "blank") {
      const ok = await ev(() => { try { K8086.App.start(); return !!K8086.App.sim; } catch { return false; } });
      if (ok) {
        await run(p.id === "pc-xt" ? 240000 : 8000);
        await fitBoard();
        await shotCanvas({ ...sec("boards", p.name), id: `board-${p.id}-running`, title: `${p.name} — running`,
          board: p.id, kind: "running", q: 84,
          caption: "The same board with live logic levels on every wire, LEDs lit and displays scanning." });
        await ev(() => { const w = K8086.App.waveform; w.span = 200; w.follow = true; w.render(); });
        await page.waitForTimeout(50);
        await shotEl({ ...sec("boards", p.name), id: `wave-${p.id}`, title: `${p.name} — on the analyzer`,
          board: p.id, kind: "wave", q: 80,
          caption: "The signals this board pre-selects for you, captured while it runs." }, "#wavePanel");
        await ev(() => K8086.App.stop());
      }
    }
  }
  if (unresolved.length) console.log("\n  ! unresolved chip keys:", unresolved.join(", "));
  await reset();
});

chapter("chips", async () => {
  const types = await ev(() => Object.keys(K8086.chips).map(t => ({
    type: t, name: K8086.chips[t].name, category: K8086.chips[t].category,
    pins: K8086.chips[t].pins.length, inspect: !!K8086.chips[t].inspect, probe: !!K8086.chips[t].probe,
  })));
  for (const t of types) {
    for (const [z, tag, cap] of [[0, "pinout", "the whole part"], [1, "detail", "pin names and numbers"]]) {
      await ev(([ty, tight]) => {
        const app = K8086.App;
        if (app.sim) app.stop();
        app.loadPreset("blank");
        const c = K8086.docAddComponent(app.doc, ty, 4, 4);
        app.ensureRefs();
        app.docChanged();
        K8086.closeModal();
        const g = K8086.chips[ty].grid;
        const cv = document.getElementById("schematic");
        const base = Math.min(7, Math.max(2.6, 26 / Math.max(g.w, g.h)));
        const z2 = tight ? Math.min(12, base * 2.1) : base;
        const U = 12;
        app.schematic.view = { x: c.x + g.w / 2 - cv.clientWidth / (2 * z2 * U),
          y: c.y + (g.h + 1) / 2 - cv.clientHeight / (2 * z2 * U), zoom: z2 };
        app.schematic.render();
      }, [t.type, z]);
      await page.waitForTimeout(FAST ? 20 : 40);
      const meta = { ...sec("chips", t.category), id: `chip-${slug(t.type)}-${tag}`,
        title: t.type + (z ? " — pin detail" : " — " + t.name), chip: t.type, kind: z ? "detail" : "pinout", q: 78,
        caption: z ? `${t.name}: pin names as drawn, with overbars on active-low signals.`
          : `${t.name} — ${t.pins} pins, category ${t.category}.${t.probe ? " Has a memory image the analyzer can probe." : ""}${t.inspect ? " Double-click it while running for its programmer's view." : ""}` };
      if (z) await shotCanvasCenter(meta, 800, 640); else await shotCanvas(meta);
    }
    // the Chip panel for this part: properties + the full connection table
    await ev(() => {
      const app = K8086.App;
      app.selection = { kind: "comp", comp: app.doc.components[0] };
      app.showTab("chip");
      K8086.renderChipPanel(document.getElementById("chipPane"), app);
    });
    await page.waitForTimeout(FAST ? 15 : 35);
    await shotAround({ ...sec("chips", "Pin tables"), id: `chippanel-${slug(t.type)}`,
      title: `${t.type} — pin table`, chip: t.type, kind: "table", q: 76,
      caption: `Every pin of the ${t.name} with its kind, what it is connected to, and a ranked dropdown of what it could connect to.` }, "#rightBody", 6);
  }
  // programmer's views
  const pv = [
    ["pc-xt", "8259A", "Interrupt controller", "IMR, IRR and ISR as bit grids with an INT lamp: watch a request arrive, get masked, or go into service."],
    ["pc-xt", "8253", "Programmable interval timer", "All three counters with mode, reload and live count — plus OUT and GATE lamps."],
    ["pc-xt", "8255", "Parallel peripheral interface", "The control word decoded into port directions, and all three port latches."],
    ["pc-xt", "8237A", "DMA controller", "Channel addresses and counts, the mask register, and port 80h — where POST codes appear."],
    ["pc-xt", "UPD765", "Floppy disk controller", "Motor and IRQ lamps, the diskette in the bay, and a running count of sectors read and written."],
    ["pc-xt", "HGC", "Hercules video card", "Mode and configuration registers, the CRTC index, the current scanline and the frame counter."],
    ["pc-xt", "XTIDE", "XT-IDE fixed disk", "Drive status, geometry, and the C/H/S registers as the BIOS sets them."],
    ["pc-xt", "COM8250", "Serial UART", "Baud divisor, IER, LCR and the receive queue — with a button that opens a live terminal."],
    ["pc-xt", "74LS373", "Octal latch", "Even the glue has a view: the latched byte, plus LE and ~OE lamps."],
    ["pc-xt", "SPKR", "Speaker", "The measured frequency of whatever is driving the cone, a log of recent tones, and a button to actually listen."],
    ["pc-xt", "XTKBD", "XT keyboard", "The scancode queue, the bit being shifted out, and a running total of codes sent."],
    ["pc-xt", "8288", "Bus controller", "The bus phase and the decoded command — INTA, IOR, IOW, HALT, CODE, MEMR, MEMW or passive."],
    ["pc-speaker", "SPKR", "Speaker (music board)", "On the music board the frequency readout follows the notes the program plays."],
    ["lpt-printer", "PRINTER", "Dot-matrix printer", "The paper: everything the program has printed, with a tear-off button."],
    ["dip-echo", "SW8", "DIP switches", "The one view that stays editable while running — flip a switch and the program sees it immediately."],
    ["dual-8088", "8289", "Bus arbiter", "Whether this processor holds the bus, and how many grants it has won."],
  ];
  for (const [board, type, label, cap] of pv) {
    const ok = await ev(([b, ty]) => {
      const app = K8086.App;
      if (app.sim) app.stop();
      app.loadPreset(b);
      try { app.start(); } catch { return false; }
      if (!app.sim) return false;
      for (let i = 0; i < 90000 && !app.sim.halted; i++) app.sim.stepHalf();
      app.pauseResume();
      const c = app.doc.components.find(x => x.type === ty);
      if (!c) return false;
      K8086.progView(app, c);
      return true;
    }, [board, type]);
    if (!ok) { await ev(() => { K8086.closeModal(); if (K8086.App.sim) K8086.App.stop(); }); continue; }
    await page.waitForTimeout(120);
    await shotAround({ ...sec("chips", "Programmer's views"), id: `progview-${slug(board)}-${slug(type)}`,
      title: `${label} — ${type}`, chip: type, kind: "progview", q: 82, caption: cap }, "#modalBox", 10);
    await ev(() => { K8086.closeModal(); if (K8086.App.sim) K8086.App.stop(); });
  }
  // per-chip dialogs
  await reset("min-8088");
  for (const [type, title, cap] of [
    ["8088", "Chip properties", "Double-click a chip while editing to reach its configuration and its tabular wiring."],
    ["XTAL", "Crystal frequency", "Properties are per-part: a crystal carries its frequency, a DIP switch its bit pattern, an LED its colour."]]) {
    await ev((t) => {
      const app = K8086.App;
      const c = app.doc.components.find(x => x.type === t);
      if (c) K8086.propsDialog(app, c);
    }, type);
    await page.waitForTimeout(80);
    await shotAround({ ...sec("chips", "Per-chip dialogs"), id: "props-" + slug(type), title, caption: cap }, "#modalBox", 10);
    await ev(() => K8086.closeModal());
  }
  await ev(() => {
    const app = K8086.App;
    K8086.propsDialog(app, app.doc.components.find(c => K8086.chips[c.type].isCpu));
  });
  await page.waitForTimeout(80);
  await ev(() => { document.querySelectorAll(".ctTab")[1].click(); });
  await page.waitForTimeout(120);
  await shotAround({ ...sec("chips", "Per-chip dialogs"), id: "props-conn", title: "Tabular wiring",
    caption: "Every pin with a dropdown of targets, ranked by how likely each is for that specific pin — sibling evidence, signal families and proximity all count. You can wire a whole chip without touching the canvas." }, "#modalBox", 10);
  await ev(() => K8086.closeModal());
  await ev(() => { K8086.App.showTab("chip"); K8086.App.selection = { kind: "comp", comp: K8086.App.doc.components.find(c => c.type === "SRAM6264") }; K8086.renderChipPanel(document.getElementById("chipPane"), K8086.App); });
  await page.waitForTimeout(90);
  await shotAround({ ...sec("chips", "Per-chip dialogs"), id: "chip-panel-conn", title: "The Chip panel",
    caption: "The same connection table lives in the Chip panel, alongside the part's properties and — while running — its internal state and live pin values." }, "#rightBody", 6);
  await reset();
});

chapter("autowiring", async () => {
  await ev(() => {
    const app = K8086.App;
    if (app.sim) app.stop();
    app.loadPreset("blank");
    K8086.closeModal();
    for (const [t, x, y] of [["8237A", 4, 4], ["8259A", 28, 4], ["SRAM628512", 52, 4], ["EPROM27256", 4, 34], ["HGC", 52, 34]]) {
      app.placing = t; app.placeAt(x, y);
      K8086.closeModal();
    }
    app.schematic.render();
  });
  await page.waitForTimeout(80);
  await shotAround({ ...sec("autowiring", "Whispers"), id: "whisper-hint", title: "A whisper, not a popup",
    caption: "Parts that cannot be wired yet never interrupt you. The hint bar whispers what is missing — here, that a CPU would unlock every one of these chips." }, "#hint", 8);
  await fitBoard();
  await shotCanvas({ ...sec("autowiring", "Whispers"), id: "whisper-board", title: "Five orphaned parts",
    caption: "Nothing is wired and nothing is nagging. The planner is watching the board and waiting for the piece that makes a design possible." });
  await ev(() => { const app = K8086.App; app.placing = "8086"; app.placeAt(86, 4); });
  await page.waitForTimeout(70);
  await shotAround({ ...sec("autowiring", "Whispers"), id: "whisper-cpu", title: "The whisper follows the board",
    caption: "Adding a CPU changes the whisper: now the one missing part is the clock generator." }, "#hint", 8);
  await ev(() => { const app = K8086.App; app.placing = "8284A"; app.placeAt(108, 4); });
  await page.waitForTimeout(110);
  await shotAround({ ...sec("autowiring", "Clocking a CPU"), id: "clock-checklist", title: "Clock CPUs — the checklist",
    caption: "The 8284A arrives and the planner offers every CPU it can clock: a checkbox each, and a per-CPU choice of minimum or maximum mode." }, "#modalBox", 10);
  await shotAround({ ...sec("autowiring", "Clocking a CPU"), id: "clock-mode-select", title: "Minimum or maximum mode",
    caption: "Maximum mode straps MN/~MX low, creates an 8288 bus controller and wires the status lines — the IBM PC arrangement." }, ".acRow", 14);
  await page.click("#modalBtns button.primary");
  await page.waitForTimeout(160);
  await shotAround({ ...sec("autowiring", "Completing the board"), id: "sweep-dialog", title: "Complete the board?",
    caption: "The moment a CPU comes alive, every chip that can now be wired is offered at once — glue chips and counterpart parts created where needed, in dependency order." }, "#modalBox", 10);
  await page.click("#modalBtns button.primary");
  await page.waitForTimeout(220);
  await ev(() => K8086.closeModal());
  await fitBoard();
  await shotCanvas({ ...sec("autowiring", "Completing the board"), id: "sweep-result", title: "One click later", q: 84,
    caption: "Address latches, decoders and qualified strobes synthesized; every device on its own IO window. The whole batch is one undo step." });
  await shotAround({ ...sec("autowiring", "Completing the board"), id: "sweep-hint", title: "What just happened",
    caption: "The hint bar names every chip that was wired and reminds you that a single undo reverts the entire batch." }, "#hint", 8);
  const parts = await ev(() => K8086.App.doc.components.filter(c => ["74LS138", "74LS373", "74LS32", "74LS04"].includes(c.type)).map(c => ({ id: c.id, ref: c.props.ref, type: c.type })));
  for (const c of parts.slice(0, 5)) {
    await zoomComp(c.id, 4.0);
    await shotCanvasCenter({ ...sec("autowiring", "Completing the board"), id: "sweep-glue-" + slug(c.ref),
      title: `${c.ref} — synthesized glue`, q: 74,
      caption: `The planner created this ${c.type} and wired it. Everything it adds is an ordinary component with ordinary wires: inspectable, checkable and editable.` }, 800, 580);
  }
  // repair
  await reset("min-8088");
  await ev(() => {
    const app = K8086.App;
    const ram = app.doc.components.find(c => c.type === "SRAM6264");
    const key = K8086.pinKey(ram, "D2");
    app.selection = { kind: "wire", wire: app.doc.wires.find(w => w.a === key || w.b === key) };
    app.deleteSelection();
  });
  await page.waitForTimeout(80);
  await shotAround({ ...sec("autowiring", "Repair"), id: "repair-whisper", title: "A snipped bus lane is noticed",
    caption: "Delete one lane of a live bus and the hint bar says so immediately — seven eighths of a data bus is nobody's intention." }, "#hint", 8);
  await ev(() => K8086.App.offerBoardSweep(true));
  await page.waitForTimeout(140);
  await shotAround({ ...sec("autowiring", "Repair"), id: "repair-dialog", title: "⚡ complete offers the repair",
    caption: "The board is scanned by cloning it, re-running each chip's own hookup on the clone, and diffing — the wires it would add are exactly the ones missing. Accidental-looking damage arrives pre-ticked." }, "#modalBox", 10);
  await ev(() => K8086.closeModal());
  // range calculator
  await reset("min-8088");
  await ev(() => {
    const app = K8086.App;
    K8086.RangeCalc.open(app, app.doc.components.find(c => c.type === "SRAM6264"));
  });
  await page.waitForTimeout(100);
  await shotAround({ ...sec("autowiring", "Exact addresses"), id: "rangecalc", title: "The range calculator",
    caption: "It first shows where the chip answers right now, mirrors included. Type the base address you want and it synthesizes a decoder to put it exactly there." }, "#modalBox", 10);
  await ev(() => { document.querySelector("#modalBody input").value = "08000"; });
  await page.click("#modalBtns button.primary");
  await page.waitForTimeout(140);
  await shotAround({ ...sec("autowiring", "Exact addresses"), id: "rangecalc-proved", title: "Proved, not promised",
    caption: "The result is verified by re-probing the netlist through the real decode gates: the green line is a measurement, not a calculation." }, "#modalBox", 10);
  await ev(() => K8086.closeModal());
  // DRC
  await ev(() => {
    const app = K8086.App;
    app.loadPreset("min-8088");
    const v = app.doc.components.find(c => c.type === "VCC");
    const g = app.doc.components.find(c => c.type === "GND");
    K8086.docConnect(app.doc, K8086.pinKey(v, "V"), K8086.pinKey(g, "G"));
    app.docChanged();
    app.start();
  });
  await page.waitForTimeout(140);
  await shotAround({ ...sec("autowiring", "Design checks"), id: "drc-modal", title: "The design check stops you",
    caption: "Strict violations — a VCC/GND short, two outputs fighting, a missing required pin — block the simulation and are explained before anything runs." }, "#modalBox", 10);
  await ev(() => K8086.closeModal());
  await shotAround({ ...sec("autowiring", "Design checks"), id: "drc-panel", title: "The Checks panel",
    caption: "Every check, strict and advisory, each expandable into an explanation of what a bench technician would see." }, "#drcPane", 6);
  await reset("fixit-lab");
  await ev(() => { K8086.App.showTab("drc"); K8086.renderDrcPanel(document.getElementById("drcPane"), K8086.runDrc(K8086.App.doc)); });
  await page.waitForTimeout(90);
  await shotAround({ ...sec("autowiring", "Design checks"), id: "drc-fixit", title: "The repair lab",
    caption: "One shipped board is deliberately broken in two ways that a scope would find and a schematic would not. The checks tell you exactly what a technician would notice." }, "#rightBody", 6);
  await reset();
});

chapter("running", async () => {
  await reset("min-8088");
  await ev(() => { K8086.App.start(); });
  await run(2000);
  await ev(() => K8086.App.showTab("cpu"));
  await page.waitForTimeout(80);
  await shotAround({ ...sec("running", "Watching the CPU"), id: "cpu-panel", title: "The CPU panel", q: 84,
    caption: "Registers, segment registers, individual flags, the prefetch queue with a live disassembly of what it holds, and the current bus cycle." }, "#rightBody", 6);
  await page.waitForTimeout(80);
  await shotAround({ ...sec("running", "Watching the CPU"), id: "cpu-edit", title: "Registers are editable",
    caption: "Pause and every field becomes editable — type a new value into any register, or click a flag to toggle it. Writing CS even flushes the prefetch queue, exactly like the real chip." }, "#cpuPane", 6);
  for (let i = 0; i < 4; i++) {
    await ev(() => K8086.App.stepCycle());
    await page.waitForTimeout(40);
    await shotAround({ ...sec("running", "Stepping"), id: `step-cycle-${i}`, title: `Cycle step ${i + 1}`, q: 78,
      caption: "⭢ cycle advances one clock half-step. Watch the bus cycle assemble itself across four clocks: address out with ALE, strobe low, data sampled, strobe high." }, "#status", 10);
  }
  await ev(() => { K8086.App.showTab("chip"); K8086.App.selection = { kind: "comp", comp: K8086.App.doc.components.find(c => c.type === "74LS373") }; K8086.renderChipPanel(document.getElementById("chipPane"), K8086.App); });
  await page.waitForTimeout(90);
  await shotAround({ ...sec("running", "Watching chips"), id: "chip-panel", title: "The Chip panel",
    caption: "Any chip's internal state — editable while paused — plus a live badge for every pin, colour-coded by logic value." }, "#rightBody", 6);
  await ev(() => {
    const app = K8086.App;
    app.paused = false;
    document.getElementById("btnPause").textContent = "⏸ Pause";
    app.toggleTurbo();
  });
  await page.waitForTimeout(500);
  await shotAround({ ...sec("running", "Turbo"), id: "turbo-status", title: "Turbo: real-time speed",
    caption: "⚡ turbo compiles the clock tree and batches the CPU, reaching around 5 MHz of simulated 8088. Memory goes through the proved map, IO still through real pins — the instruction stream is bit-identical." }, "#status", 10);
  await shotEl({ ...sec("running", "Turbo"), id: "turbo-waveform", title: "Capture pauses in turbo",
    caption: "The one cost of turbo is waveform capture, and the analyzer says so plainly. Leave turbo or pause and it resumes." }, "#wavePanel");
  await ev(() => { const app = K8086.App; app.exitTurbo(); app.paused = true;
    document.getElementById("btnPause").textContent = "▶ Resume"; app.updateStatus(); });
  await page.waitForTimeout(100);
  for (const f of [0.15, 0.45, 0.8]) {
    await ev((x) => K8086.App.seekFrac(x), f);
    await page.waitForTimeout(80);
    await shotAround({ ...sec("running", "Rewind"), id: `rewind-${String(f).replace(".", "-")}`,
      title: `Rewound to ${Math.round(f * 100)}%`, q: 78,
      caption: "The rewind slider travels backwards through recorded history. This is not a replay: registers, memory and every chip's internal state return to how they were, and you can run forward again from there." }, "#status", 10);
  }
  await ev(() => K8086.App.stop());
  await reset();
});

chapter("debugging", async () => {
  const prog = ["        org 0", "start:  mov sp, 0x1000", "        mov ax, 0", "        call fn",
    "        out 0x00, al", "loopf:  inc bx", "        jmp loopf", "fn:     mov al, 0x42", "        ret"].join("\n");
  await reset("min-8088");
  await ev((p) => {
    const app = K8086.App;
    document.getElementById("codeEditor").value = p;
    app.assemble(true);
    K8086.DebugUI.renderGutter();
    app.showTab("code");
  }, prog);
  await page.waitForTimeout(100);
  await shotAround({ ...sec("debugging", "The editor"), id: "editor", title: "The assembler pane",
    caption: "Labels, EQU constants, expressions, DB/DW/TIMES, segment overrides and the full 8086 instruction set. Errors are reported by line; assembling programs the board's ROM." }, "#codePane", 6);
  await ev(() => K8086.DebugUI.toggleLineBp(4));
  await page.waitForTimeout(80);
  await shotAround({ ...sec("debugging", "Breakpoints"), id: "gutter-bp", title: "Click the gutter",
    caption: "A red dot marks a line breakpoint. It is resolved through the proved memory map to every physical address where that instruction answers — which matters enormously on boards with partial decoding." }, "#editorWrap", 6);
  await ev(() => { K8086.App.dbg.lineBps.set(6, { cond: "BX==3" }); K8086.DebugUI.resyncLineBps(K8086.App); K8086.DebugUI.renderGutter(); });
  await page.waitForTimeout(80);
  await shotAround({ ...sec("debugging", "Breakpoints"), id: "gutter-cond", title: "Conditional breakpoints",
    caption: "Shift-click sets a condition. An amber dot means the line only stops when its expression is true — here, only when BX reaches 3." }, "#asmGutter", 8);
  await ev(() => { K8086.App.start(); });
  await page.waitForTimeout(800);
  await shotAround({ ...sec("debugging", "Breakpoints"), id: "bp-hit-hint", title: "Stopped at a breakpoint",
    caption: "The hint bar names what stopped you and reminds you of the stepping keys." }, "#hint", 8);
  await ev(() => K8086.App.showTab("code"));
  await page.waitForTimeout(80);
  await shotAround({ ...sec("debugging", "Breakpoints"), id: "current-line", title: "The current line",
    caption: "A highlight bar and a ▶ arrow mark the instruction about to execute; the editor scrolls to keep it in view as you step." }, "#editorWrap", 6);
  await ev(() => { const a = K8086.App; a.dbg.watches.push("AX", "AL", "BX", "SP", "w[0x40]", "ZF"); a.showTab("debug"); });
  await page.waitForTimeout(120);
  await shotAround({ ...sec("debugging", "The Debug tab"), id: "debug-panel", title: "The Debug tab", q: 84,
    caption: "Stepping controls, watches, breakpoints, watchpoints, call stack, live disassembly and the instruction trace — one pane for the whole session." }, "#debugPane", 6);
  await shotAround({ ...sec("debugging", "Stepping"), id: "step-buttons", title: "Assembly-flavoured stepping",
    caption: "⤵ trace is DEBUG.COM's Trace — one instruction, into calls. ⤼ over call is Proceed — a whole CALL, INT or REP as one step. ⤴ to ret finishes the subroutine. ▸│ to caret runs to the cursor. ↩ un-step travels backwards in time." }, ".dbgBtns", 8);
  for (let i = 0; i < 5; i++) {
    await ev(() => K8086.DebugUI.stepInto());
    await page.waitForTimeout(90);
    await shotAround({ ...sec("debugging", "Stepping"), id: `stepping-${i}`, title: `After ${i + 1} instruction${i ? "s" : ""}`,
      q: 78, caption: "Each step updates the watches, the call stack, the disassembly and the trace together — and the watch values flash when they change." }, "#debugPane", 6);
  }
  await shotAround({ ...sec("debugging", "Call stack"), id: "callstack", title: "The call stack",
    caption: "CALL/RET and every interrupt — software INT, hardware IRQ, NMI and single-step traps — are tracked as frames, with the vector shown for interrupt frames." }, "#debugPane", 6);
  await shotAround({ ...sec("debugging", "Disassembly"), id: "disasm", title: "Live disassembly",
    caption: "Paused outside your own source — in the BIOS, or a handler you did not write — the debugger disassembles straight out of mapped memory. Click any line to set a breakpoint there." }, ".dbgDisasm", 8);
  await shotAround({ ...sec("debugging", "Trace"), id: "trace", title: "The instruction trace",
    caption: "Every retired instruction with its exact cycle cost, interrupt vectors annotated, and the register that changed. Click a row to jump to its source line; export the whole thing as text." }, ".dbgTrace", 8);
  await ev(() => {
    const a = K8086.App;
    a.dbg.wps.push({ from: 0x40, to: 0x41, mode: "w" });
    a.dbg.ioWps.push({ from: 0x00, to: 0x00, mode: "w" });
    K8086.DebugUI.refresh();
  });
  await page.waitForTimeout(100);
  await shotAround({ ...sec("debugging", "Watchpoints"), id: "watchpoints", title: "Memory and IO watchpoints",
    caption: "Break when an address or range is written or read, or when an IO port is touched. \"Who is corrupting my stack?\" answers itself — and the hook sits inside the CPU's bus generators, so nothing escapes even in turbo." }, "#debugPane", 6);
  await ev(() => { K8086.DebugUI.cont(); });
  await page.waitForTimeout(500);
  await shotAround({ ...sec("debugging", "Watchpoints"), id: "watchpoint-hit", title: "A watchpoint fires",
    caption: "The machine stops on the instruction that touched the address, and reports what was written." }, "#hint", 8);
  await ev(() => { K8086.DebugUI.stepBack(); });
  await page.waitForTimeout(150);
  await shotAround({ ...sec("debugging", "Stepping"), id: "un-step", title: "Un-stepping",
    caption: "↩ un-step un-executes the last instruction by riding the rewind history — the register you just watched change goes back to what it was." }, "#debugPane", 6);
  await ev(() => { K8086.App.stop(); });
  await reset();
});

chapter("waveforms", async () => {
  await reset("min-8088");
  await ev(() => { K8086.App.start(); });
  await run(8000);
  for (const span of [48, 96, 240, 700, 2500, 12000, 40000]) {
    await ev((s) => { const w = K8086.App.waveform; w.span = s; w.follow = true; w.vScale = 1; w.render(); }, span);
    await page.waitForTimeout(50);
    await shotEl({ ...sec("waveforms", "Zooming"), id: `wave-span-${span}`, title: `${span} half-steps across`, q: 80,
      caption: span <= 240 ? "Zoomed in, every transition is a true square-wave edge and the bus lane shows each hex value."
        : span <= 2500 ? "Further out, the shape of a bus cycle repeating becomes visible."
        : "Past one sample per pixel the renderer aggregates each column: a column that saw both a high and a low becomes a solid band — what a real oscilloscope shows for a signal faster than its timebase." }, "#wavePanel");
  }
  await ev(() => { const w = K8086.App.waveform; w.span = 96; w.render(); });
  await page.waitForTimeout(50);
  await shotAround({ ...sec("waveforms", "Reading waves"), id: "wave-names", title: "Signal list with live values",
    caption: "Each lane names its signal and shows the value at the cursor, or now: 0, 1, Z or X for pins, hex for buses." }, "#waveNames", 6);
  await shotAround({ ...sec("waveforms", "Zooming"), id: "wave-sliders", title: "Zoom controls",
    caption: "↔ scales time from eight cycles across the screen out to the entire recording; ↕ scales lane height. On a trackpad a horizontal pinch zooms and moves the slider with it." }, ".wzoom", 12);
  for (const v of [0.6, 1.6, 2.5]) {
    await ev((x) => { const w = K8086.App.waveform; w.vScale = x; w.span = 200; w.render(); w.renderNames(); }, v);
    await page.waitForTimeout(60);
    await shotEl({ ...sec("waveforms", "Zooming"), id: `wave-v-${String(v).replace(".", "-")}`,
      title: `Lane height ${Math.round(v * 100)}%`, q: 78,
      caption: "Vertical zoom runs from 60% to 250%; the signal names resize in lockstep so labels stay aligned to their lanes." }, "#wavePanel");
  }
  await ev(() => { const w = K8086.App.waveform; w.vScale = 1; w.span = 256; w.follow = false; w.cursorT = K8086.App.sim.t - 140; w.render(); });
  await page.waitForTimeout(60);
  await shotEl({ ...sec("waveforms", "The cursor"), id: "wave-cursor", title: "The time cursor",
    caption: "Click anywhere to drop a cursor: it reports the half-step and the cycle number, and every lane reports its value at that moment." }, "#wavePanel");
  await shotAround({ ...sec("waveforms", "History"), id: "wave-scroll", title: "The history scrollbar",
    caption: "The recording keeps up to 131,072 half-steps. Drag the bar to browse it; drag to the right edge to re-attach to live time." }, "#waveScroll", 10);
  await ev(() => { K8086.App.waveform.addDialog(); });
  await page.waitForTimeout(110);
  await shotAround({ ...sec("waveforms", "Adding signals"), id: "wave-add", title: "Add any signal",
    caption: "Every chip on the board, expandable to its pins, with automatic bus groups (⛁ A0..A19) that become a single hex lane." }, "#modalBox", 10);
  await ev(() => { K8086.closeModal(); K8086.App.stop(); });
  // a second board for variety
  await reset("irq-lab");
  await ev(() => { K8086.App.start(); });
  await run(60000);
  await ev(() => { const w = K8086.App.waveform; w.span = 400; w.follow = true; w.cursorT = null; w.render(); });
  await page.waitForTimeout(60);
  await shotEl({ ...sec("waveforms", "Reading waves"), id: "wave-irq", title: "An interrupt on the wire", q: 82,
    caption: "On the interrupt lab the default signal set includes INTR and ~INTA — watch INTR rise, then two ~INTA pulses, the second carrying the vector on AD0-7." }, "#wavePanel");
  await ev(() => K8086.App.stop());
  await reset();
});

chapter("memory", async () => {
  await reset("min-8088");
  await ev(() => { K8086.App.ensureMemMap(); K8086.HexEditor.openUnified(K8086.App); });
  await page.waitForTimeout(150);
  await shotAround({ ...sec("memory", "Unified memory"), id: "mem-unified", title: "The unified memory view", q: 84,
    caption: "One hex editor across the whole address space, writing through the proved map." }, "#modalBox", 10);
  await shotAround({ ...sec("memory", "Unified memory"), id: "mem-ranges", title: "Where everything answers",
    caption: "The range dropdown lists every window the prober found, marking aliases — the mirrors partial decoding creates — and the reset vector." }, ".hexToolbar", 10);
  await ev(() => K8086.closeModal());
  await ev(() => {
    const app = K8086.App;
    K8086.HexEditor.open(app, app.doc.components.find(c => c.type === "SRAM6264"));
  });
  await page.waitForTimeout(150);
  await shotAround({ ...sec("memory", "Per-chip memory"), id: "mem-chip", title: "Chip-local hex editor",
    caption: "Double-click a memory chip for its own bytes, always addressed from zero — the chip's point of view, with no knowledge of where the board maps it." }, "#modalBox", 10);
  await ev(() => K8086.closeModal());
  await ev(() => {
    const app = K8086.App;
    K8086.HexEditor.open(app, app.doc.components.find(c => c.type === "EPROM2764"));
  });
  await page.waitForTimeout(150);
  await shotAround({ ...sec("memory", "Per-chip memory"), id: "mem-rom", title: "The ROM, byte by byte",
    caption: "The assembled program as it sits in the EPROM — including the far jump at the reset vector that starts the machine. Hand edits here are kept when you press Start; pressing Assemble reclaims the ROM for the code pane." }, "#modalBox", 10);
  await ev(() => K8086.closeModal());
  await ev(() => { K8086.App.start(); });
  await run(4000);
  await ev(() => { K8086.App.ensureMemMap(); K8086.HexEditor.openUnified(K8086.App); });
  await page.waitForTimeout(170);
  await shotAround({ ...sec("memory", "Unified memory"), id: "mem-live", title: "Memory while running",
    caption: "The view is live: watch the stack change as CALLs push, or find the byte your program just wrote." }, "#modalBox", 10);
  await ev(() => { K8086.closeModal(); K8086.App.stop(); });
  await reset("pc-xt");
  await ev(() => { K8086.App.ensureMemMap(); K8086.HexEditor.openUnified(K8086.App); });
  await page.waitForTimeout(200);
  await shotAround({ ...sec("memory", "Unified memory"), id: "mem-xt", title: "A full PC memory map",
    caption: "On the XT board the same prober finds 512K of RAM, the video window, the option ROM and the BIOS — each measured, not declared." }, "#modalBox", 10);
  await ev(() => K8086.closeModal());
  await reset();
});

chapter("disks", async () => {
  await reset("pc-xt");
  await ev(() => K8086.DiskLib.open(K8086.App));
  await page.waitForTimeout(300);
  await shotAround({ ...sec("disks", "The library"), id: "disklib", title: "The disk image library", q: 84,
    caption: "Built-in FreeDOS media plus your own images, kept in the browser between sessions: insert, attach, duplicate, export, import, or populate from a folder on your machine." }, "#modalBox", 10);
  await shotAround({ ...sec("disks", "The library"), id: "disklib-actions", title: "Creating media",
    caption: "Format blank 360K, 720K or 1.44M floppies, or a 10.4 MB hard disk — all FAT12, all written by the tool's own filesystem code." }, ".dlActions", 10);
  await ev(() => K8086.closeModal());
  const ok = await ev(() => {
    const app = K8086.App;
    try { app.start(); } catch { return false; }
    if (!app.sim) return false;
    for (let i = 0; i < 120000 && !app.sim.halted; i++) app.sim.stepHalf();
    app.pauseResume();
    const fdc = app.doc.components.find(c => K8086.chips[c.type].isFdc);
    if (!fdc) return false;
    K8086.progView(app, fdc);
    return true;
  });
  if (ok) {
    await page.waitForTimeout(150);
    await shotAround({ ...sec("disks", "The drive"), id: "fdc-view", title: "The floppy drive",
      caption: "Motor and IRQ lamps, the diskette in the bay with its geometry, a running count of sectors read and written, and buttons to insert, eject, format or write the image back to your machine." }, "#modalBox", 10);
    await ev(() => { K8086.closeModal(); });
    const ok2 = await ev(() => {
      const app = K8086.App;
      const fdc = app.doc.components.find(c => K8086.chips[c.type].isFdc);
      try { K8086.DiskTools.open(app, fdc); return true; } catch { return false; }
    });
    if (ok2) {
      await page.waitForTimeout(200);
      await shotAround({ ...sec("disks", "FAT tools"), id: "disk-tools", title: "Browsing a real FAT12 disk", q: 82,
        caption: "The FreeDOS diskette, read by the tool's own FAT12 implementation: browse directories, download files out, copy files in, or format fresh media." }, "#modalBox", 10);
      await ev(() => K8086.closeModal());
    }
    await ev(() => { if (K8086.App.sim) K8086.App.stop(); });
  }
  await reset();
});

chapter("devices", async () => {
  // the XT: POST then FreeDOS
  await reset("pc-xt");
  await ev(() => { K8086.App.start(); });
  await page.waitForTimeout(200);
  await run(FAST ? 20000 : 200000);
  await fitBoard();
  await shotCanvas({ ...sec("devices", "A whole PC"), id: "xt-board", title: "The PC/XT board", q: 84,
    caption: "CPU, DMA, interrupt controller, timer, PPI, floppy controller, XT-IDE, serial port, Hercules card, keyboard and speaker — a complete machine on one canvas." });
  const devs = await ev(() => K8086.App.doc.components.filter(c => ["CRT", "XTKBD", "SPKR", "HGC", "UPD765", "SW8"].includes(c.type)).map(c => ({ id: c.id, ref: c.props.ref, type: c.type })));
  const DEVCAP = {
    CRT: "The monitor renders live from the video card's frame buffer, right on the schematic.",
    XTKBD: "A full XT-84 keyboard drawn key by key — press a key on your own keyboard and you can see it depress here.",
    SPKR: "The speaker shows its cone moving and labels the frequency it is being driven at.",
    HGC: "The Hercules card: 32K of video RAM, a 6845-style CRTC, and real HSYNC/VSYNC/VIDEO outputs.",
    UPD765: "The floppy controller, moving sectors over DMA channel 2.",
    SW8: "The configuration switches — flip them while the machine runs and the BIOS sees a different machine next boot.",
  };
  for (const d of devs) {
    await zoomComp(d.id, 3.4);
    await shotCanvasCenter({ ...sec("devices", "On the board"), id: "dev-" + slug(d.type),
      title: `${d.ref} — ${d.type}`, q: 78, caption: DEVCAP[d.type] || "" }, 820, 600);
  }
  const crt = await ev(() => {
    const app = K8086.App;
    const m = app.doc.components.find(c => c.type === "CRT");
    if (!m) return false;
    K8086.CrtView.open(app, m);
    return true;
  });
  if (crt) {
    await page.waitForTimeout(400);
    await shotAround({ ...sec("devices", "Monitor and keyboard"), id: "crt-window", title: "The CRT window", q: 86,
      caption: "A full phosphor screen rendered from the real Hercules frame buffer — with scanlines, glow and glare — and the on-screen XT keyboard docked beneath it." }, "#modalBox", 10);
    await shotAround({ ...sec("devices", "Monitor and keyboard"), id: "crt-kbd", title: "The keyboard dock",
      caption: "Click the keys, or type on your own keyboard: either way real scancodes travel the serial line into the shift register and raise IRQ1." }, ".crtKbd", 10);
    await ev(() => K8086.closeModal());
  }
  await ev(() => { if (K8086.App.sim) K8086.App.stop(); });
  // other device boards
  for (const [board, type, title, cap] of [
    ["hgc-8088", "CRT", "Video from a bare 8088", "No BIOS, no operating system: an 8088 writing characters straight into video memory at B000:0000."],
    ["seg7-count", "SEG7", "Seven-segment display", "Common cathode, driven from a '373 output port, with the digits decoded in software from a segment table."],
    ["traffic-8255", "LED8", "LEDs on a PPI port", "An 8255 drives a traffic light from port A — the whole board was wired by autoconnect."],
    ["lpt-printer", "PRINTER", "The printer", "A Centronics printer with a real BUSY/ACK handshake — and paper you can read."],
    ["pc-speaker", "SPKR", "The speaker", "The 8253 in mode 3 is a square-wave synthesiser; the symbol shows the live frequency."],
    ["dip-echo", "SW8", "DIP switches", "Eight switches you can flip while the machine runs."]]) {
    await reset(board);
    const ok = await ev(() => { try { K8086.App.start(); return !!K8086.App.sim; } catch { return false; } });
    if (!ok) continue;
    await run(board === "hgc-8088" ? 120000 : 30000);
    const id = await ev((t) => {
      const c = K8086.App.doc.components.find(x => x.type === t);
      return c ? c.id : null;
    }, type);
    if (id) {
      await zoomComp(id, 3.6);
      await shotCanvasCenter({ ...sec("devices", "Devices at work"), id: `dev-${board}-${slug(type)}`,
        title, q: 80, caption: cap }, 840, 620);
    }
    await ev(() => { if (K8086.App.sim) K8086.App.stop(); });
  }
  // serial terminal
  await reset("uart-lab");
  const term = await ev(() => {
    const app = K8086.App;
    try { app.start(); } catch { return false; }
    if (!app.sim) return false;
    for (let i = 0; i < 90000 && !app.sim.halted; i++) app.sim.stepHalf();
    const com = app.doc.components.find(c => c.type === "COM8250");
    if (!com) return false;
    K8086.TerminalView.open(app, com);
    return true;
  });
  if (term) {
    await page.waitForTimeout(250);
    await shotAround({ ...sec("devices", "Serial"), id: "terminal", title: "The serial terminal", q: 82,
      caption: "Green phosphor on the other end of the wire: the 8250's transmit stream, and a box to type back down the line." }, "#modalBox", 10);
    await ev(() => { K8086.closeModal(); if (K8086.App.sim) K8086.App.stop(); });
  }
  await reset();
});

chapter("themes", async () => {
  const themes = await ev(() => K8086.THEMES.map(t => ({ name: t.name, mode: t.mode })));
  await reset("min-8088");
  await ev(() => { K8086.App.start(); });
  await run(5000);
  await ev(() => { const w = K8086.App.waveform; w.span = 200; w.render(); });
  for (const t of themes) {
    await ev((name) => {
      const app = K8086.App;
      K8086.applyTheme(name);
      app.schematic.render();
      app.waveform.render();
      document.getElementById("themeSel").value = name;
    }, t.name);
    await page.waitForTimeout(FAST ? 25 : 60);
    await shotPage({ ...sec("themes", t.mode === "dark" ? "Dark schemes" : "Light schemes"),
      id: `theme-${slug(t.name)}`, title: t.name, kind: "theme", q: 76,
      caption: `${t.name} — a ${t.mode} scheme. Themes restyle the interface, the canvas, the wires and the waveforms; LEDs, phosphor and seven-segment displays keep their physical colours.` });
    await shotCanvas({ ...sec("themes", "On the canvas"), id: `theme-canvas-${slug(t.name)}`,
      title: `${t.name} — the schematic`, kind: "theme", q: 74,
      caption: `How ${t.name} renders chips, wires, buses and live signal levels.` });
    await ev(() => { K8086.App.showTab("debug"); });
    await page.waitForTimeout(FAST ? 15 : 40);
    await shotAround({ ...sec("themes", "On the panels"), id: `theme-panel-${slug(t.name)}`,
      title: `${t.name} — the panels`, kind: "theme", q: 74,
      caption: `Panels, tables and controls all derive their colours from the same twelve base values.` }, "#rightBody", 6);
    await ev(() => { K8086.App.showTab("cpu"); });
    await shotEl({ ...sec("themes", "On the waveforms"), id: `theme-wave-${slug(t.name)}`,
      title: `${t.name} — the analyzer`, kind: "theme", q: 74,
      caption: `The waveform analyzer follows the theme too, deriving its grid, lane and cursor colours from the same palette.` }, "#wavePanel");
  }
  await ev(() => { K8086.applyTheme("Midnight"); if (K8086.App.sim) K8086.App.stop(); });
  await reset();
});

// ================================================================== driver ===
const order = ["overview", "canvas", "boards", "chips", "autowiring", "running",
  "debugging", "waveforms", "memory", "disks", "devices", "themes"];
for (const name of order) {
  if (only.length && !only.includes(name)) continue;
  const t0 = Date.now();
  process.stdout.write(`▶ ${name} … `);
  const before = manifest.length;
  try { await chapters[name](); }
  catch (e) { console.log("CHAPTER FAILED:", (e.stack || e.message).split("\n").slice(0, 2).join(" | ")); }
  console.log(`${manifest.length - before} shots, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// A partial run must MERGE into the existing manifest: it re-captured some
// chapters, but the others' screenshots are still on disk and still wanted.
const MANIFEST = root + "guide/manifest.json";
let out = manifest;
if (only.length && existsSync(MANIFEST)) {
  let prev = [];
  try { prev = JSON.parse(readFileSync(MANIFEST, "utf8")); } catch { prev = []; }
  const fresh = new Map();
  for (const m of manifest) {
    if (!fresh.has(m.section)) fresh.set(m.section, []);
    fresh.get(m.section).push(m);
  }
  const kept = new Map();
  for (const m of prev) {
    if (fresh.has(m.section)) continue;             // this chapter was re-shot
    if (!kept.has(m.section)) kept.set(m.section, []);
    kept.get(m.section).push(m);
  }
  out = [];
  for (const name of order) {
    const rows = fresh.get(name) || kept.get(name);
    if (rows) out.push(...rows);
  }
  // anything from a section no longer in `order` still deserves to survive
  for (const [sec, rows] of kept) if (!order.includes(sec)) out.push(...rows);
}
// prune screenshots nothing references any more
const referenced = new Set(out.map(m => m.file));
let pruned = 0;
for (const f of readdirSync(OUT)) {
  if (f.endsWith(".jpg") && !referenced.has(f)) { unlinkSync(OUT + "/" + f); pruned++; }
}
writeFileSync(MANIFEST, JSON.stringify(out, null, 1));
console.log(`\n${manifest.length} captured, ${out.length} in the manifest` +
  (pruned ? `, ${pruned} orphan file${pruned > 1 ? "s" : ""} pruned` : "") + " -> guide/shots");
if (errors.length) console.log("page errors:", [...new Set(errors)].slice(0, 8));
await browser.close();
