// Full headless-browser QA pass over the built single-file app.
// Requires: npm i playwright-core (anywhere importable) + a Chromium build.
//   BROWSER_EXE=/path/to/chromium node tests/browser.mjs
// Covers: presets, run/pause/step/rewind, register+flag editing, chip programmer's
// views, chip-local + unified hex editors, waveforms, and console-error cleanliness.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url));
let chromium;
for (const p of ["playwright-core", process.env.PW_PATH,
  "/private/tmp/claude-501/-Users-jmishra-8086/b919e010-240b-4ec6-839c-b73a3af63c00/scratchpad/node_modules/playwright-core"].filter(Boolean)) {
  try { chromium = createRequire(import.meta.url)(p).chromium; break; } catch { /* next */ }
}
if (!chromium) { console.log("SKIP: playwright-core not available"); process.exit(0); }
const exe = process.env.BROWSER_EXE ||
  process.env.HOME + "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
if (!existsSync(exe)) { console.log("SKIP: no Chromium at " + exe); process.exit(0); }

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + (e.stack || e.message).split("\n")[0]); }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1560, height: 980 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("file://" + root + "index.html");
await page.waitForTimeout(500);

await test("guide button points at the illustrated guide", async () => {
  const g = await page.evaluate(() => {
    const b = document.getElementById("btnGuide");
    return b ? { text: b.textContent, title: b.title } : null;
  });
  if (!g) throw new Error("no guide button in the toolbar");
  if (!/guide/i.test(g.text)) throw new Error("label: " + g.text);
  if (!/illustrated guide/i.test(g.title)) throw new Error("tooltip: " + g.title);
});

await test("app loads with presets and library", async () => {
  const s = await page.evaluate(() => ({
    presets: K8086.presets.length,
    comps: K8086.App.doc.components.length,
    chips: Object.keys(K8086.chips).length,
  }));
  if (s.presets < 3 || s.comps < 10 || s.chips < 25) throw new Error(JSON.stringify(s));
});

await test("autoconnect planner: SRAM placement offers described plan cards, wiring lands", async () => {
  const before = await page.evaluate(() => K8086.App.doc.wires.length);
  await page.evaluate(() => { K8086.App.placing = "SRAM6264"; K8086.App.placeAt(96, 52); });
  const modal = await page.evaluate(() => ({
    open: document.getElementById("modal").classList.contains("open"),
    title: document.querySelector("#modalBox h3")?.textContent,
    cards: [...document.querySelectorAll(".acPlan")].map(b => b.textContent),
    descs: [...document.querySelectorAll(".acDesc")].map(d => d.textContent),
  }));
  eq(modal.open, true, "modal not open");
  eq(modal.title, "Autoconnect", "wrong modal");
  if (modal.cards.length < 2) throw new Error("cards: " + modal.cards.join("|"));
  if (!modal.descs.some(d => /[0-9A-F]{5}h/.test(d))) throw new Error("no range in descs: " + modal.descs.join("|"));
  await page.click(".acPlan.primary");
  const after = await page.evaluate(() => ({
    wires: K8086.App.doc.wires.length,
    hint: document.getElementById("hint").textContent,
  }));
  if (after.wires <= before + 10) throw new Error("too few wires added: " + (after.wires - before));
  if (!/autoconnect:/.test(after.hint)) throw new Error("hint: " + after.hint);
  await page.evaluate(() => K8086.App.loadPreset("min-8088"));  // pristine board for the boot test
});

await test("the reported bug, end to end: CPU first, clock later — checklist, wiring, coarse undo", async () => {
  const s1 = await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("blank");
    app.placing = "VCC"; app.placeAt(2, 2);
    app.placing = "GND"; app.placeAt(2, 8);
    app.placing = "8086"; app.placeAt(16, 2);
    return {
      modalOpen: document.getElementById("modal").classList.contains("open"),
      hint: document.getElementById("hint").textContent,
    };
  });
  eq(s1.modalOpen, false, "NO dead-end popup for the unclockable CPU");
  if (!/8284A/.test(s1.hint)) throw new Error("whisper missing: " + s1.hint);
  const s2 = await page.evaluate(() => {
    const app = K8086.App;
    app.placing = "8284A"; app.placeAt(2, 14);
    const open = document.getElementById("modal").classList.contains("open");
    const title = document.querySelector("#modalBox h3")?.textContent || "";
    const rows = document.querySelectorAll(".acRow").length;
    const modeOpts = [...document.querySelectorAll(".acRow select option")].map(o => o.textContent);
    return { open, title, rows, modeOpts };
  });
  eq(s2.open, true, "checklist appears when the clock arrives");
  if (!/Clock CPUs/.test(s2.title)) throw new Error("title: " + s2.title);
  eq(s2.rows, 1, "one unclocked CPU row");
  if (!s2.modeOpts.some(o => /maximum/.test(o))) throw new Error("no max option: " + s2.modeOpts.join("|"));
  // pick maximum mode and wire
  await page.evaluate(() => { document.querySelector(".acRow select").value = "max"; });
  await page.click("#modalBtns button.primary");
  const s3 = await page.evaluate(() => {
    const app = K8086.App;
    const cpu = app.doc.components.find(c => c.type === "8086");
    const nets = K8086.extractNets(app.doc).byPin;
    const wired = (p) => { const n = nets.get(K8086.pinKey(cpu, p)); return !!n && n.pins.length > 1; };
    const wires = app.doc.wires.length;
    app.undo();                                          // ONE undo: whole plan gone
    return {
      clk: wired("CLK"), has8288: app.doc.components.some(x => x.type === "8288") ||
        true /* captured before undo below */,
      wiresBefore: wires,
      wiresAfterUndo: app.doc.wires.length,
      xtalAfterUndo: K8086.App.doc.components.some(c => c.type === "XTAL"),
      ctlAfterUndo: K8086.App.doc.components.some(c => c.type === "8288"),
    };
  });
  eq(s3.clk, true, "CLK wired by the plan");
  if (s3.wiresAfterUndo !== 0) throw new Error("coarse undo left wires: " + s3.wiresAfterUndo);
  eq(s3.xtalAfterUndo, false, "created crystal removed by the same undo");
  eq(s3.ctlAfterUndo, false, "created 8288 removed by the same undo");
  await page.evaluate(() => K8086.App.loadPreset("min-8088"));
});

await test("free creation: placing a monitor grows the Hercules card onto the bus", async () => {
  const s1 = await page.evaluate(() => {
    const app = K8086.App;
    app.placing = "CRT"; app.placeAt(120, 40);
    return {
      open: document.getElementById("modal").classList.contains("open"),
      cards: [...document.querySelectorAll(".acPlan")].map(b => b.textContent),
    };
  });
  eq(s1.open, true, "creation card offered");
  if (!s1.cards.some(t => /Add a Hercules/.test(t))) throw new Error("cards: " + s1.cards.join("|"));
  await page.click(".acPlan.primary");
  const s2 = await page.evaluate(() => {
    const app = K8086.App;
    const hgc = app.doc.components.find(c => c.type === "HGC");
    const crt = app.doc.components.find(c => c.type === "CRT");
    const nets = K8086.extractNets(app.doc).byPin;
    const wired = (c, p) => { const n = nets.get(K8086.pinKey(c, p)); return !!n && n.pins.length > 1; };
    const out = {
      hgc: !!hgc,
      video: hgc && crt && wired(crt, "VIDEO"),
      busD0: hgc && wired(hgc, "D0"),
      memw: hgc && wired(hgc, "~MEMW"),
      hint: document.getElementById("hint").textContent,
    };
    app.undo();                                       // one step: the whole plan
    out.hgcGoneAfterUndo = !app.doc.components.some(c => c.type === "HGC");
    out.crtStays = app.doc.components.some(c => c.type === "CRT");   // its placement was the previous step
    app.loadPreset("min-8088");
    return out;
  });
  eq(s2.hgc, true, "HGC created");
  eq(s2.video, true, "monitor cabled");
  eq(s2.busD0 && s2.memw, true, "card on the bus with strobes");
  if (!/B0000h/.test(s2.hint)) throw new Error("outcome hint: " + s2.hint);
  eq(s2.hgcGoneAfterUndo, true, "one undo removes the whole plan");
  eq(s2.crtStays, true, "but not the separately placed monitor");
});

await test("checkpoint sweep: orphans placed first all complete in one big dialog when the CPU comes alive", async () => {
  const s1 = await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("blank");
    let popups = 0;
    for (const [t, x, y] of [["8237A", 2, 2], ["8259A", 26, 2], ["SRAM628512", 50, 2],
      ["EPROM27256", 2, 30], ["HGC", 50, 30]]) {
      app.placing = t; app.placeAt(x, y);
      if (document.getElementById("modal").classList.contains("open")) popups++;
    }
    const hintOrphans = document.getElementById("hint").textContent;
    app.placing = "8086"; app.placeAt(84, 2);
    const cpuModal = document.getElementById("modal").classList.contains("open");
    const hintCpu = document.getElementById("hint").textContent;
    app.placing = "8284A"; app.placeAt(106, 2);
    return { popups, hintOrphans, cpuModal, hintCpu,
      checklist: document.querySelector("#modalBox h3")?.textContent || "" };
  });
  eq(s1.popups, 0, "orphan placements stay quiet");
  if (!/place a CPU/.test(s1.hintOrphans)) throw new Error("orphan whisper: " + s1.hintOrphans);
  eq(s1.cpuModal, false, "CPU placement whispers, no popup");
  if (!/8284A/.test(s1.hintCpu)) throw new Error("CPU whisper: " + s1.hintCpu);
  if (!/Clock CPUs/.test(s1.checklist)) throw new Error("checklist: " + s1.checklist);
  await page.click("#modalBtns button.primary");            // wire the clock (min)
  const s2 = await page.evaluate(() => ({
    title: document.querySelector("#modalBox h3")?.textContent || "",
    rows: document.querySelectorAll(".acRow").length,
    open: document.getElementById("modal").classList.contains("open"),
  }));
  eq(s2.open, true, "sweep dialog chains right after the clock lands");
  if (!/Complete the board/.test(s2.title)) throw new Error("title: " + s2.title);
  eq(s2.rows, 5, "all five orphans listed");
  await page.click("#modalBtns button.primary");            // wire everything
  const s3 = await page.evaluate(() => {
    const app = K8086.App;
    const nets = K8086.extractNets(app.doc).byPin;
    const wired = (c, p) => { const n = nets.get(K8086.pinKey(c, p)); return !!n && n.pins.length > 1; };
    const find = (t) => app.doc.components.find(c => c.type === t);
    const hooked = [["8237A", "~CS"], ["8259A", "~CS"], ["SRAM628512", "D0"],
      ["EPROM27256", "D0"], ["HGC", "~MEMR"]].every(([t, p]) => wired(find(t), p));
    const strict = K8086.runDrc(app.doc).strict.length;
    const hint = document.getElementById("hint").textContent;
    const wiresBefore = app.doc.wires.length;
    app.undo();                                             // ONE step: the whole batch
    const nets2 = K8086.extractNets(app.doc).byPin;
    const unhooked = [["8237A", "~CS"], ["HGC", "~MEMR"]].every(([t, p]) => {
      const n = nets2.get(K8086.pinKey(find(t), p)); return !n || n.pins.length === 1;
    });
    const cpuStillClocked = (() => {
      const n = nets2.get(K8086.pinKey(find("8086"), "CLK")); return !!n && n.pins.length > 1;
    })();
    app.loadPreset("min-8088");
    return { hooked, strict, hint, wiresBefore, unhooked, cpuStillClocked };
  });
  eq(s3.hooked, true, "every orphan wired by the batch");
  eq(s3.strict, 0, "DRC strict clean");
  if (!/autowired/.test(s3.hint)) throw new Error("hint: " + s3.hint);
  eq(s3.unhooked, true, "one undo reverts the whole batch");
  eq(s3.cpuStillClocked, true, "…but not the earlier clock step");
});

await test("sequential placements get unique designators (the everything-is-U1 bug)", async () => {
  const refs = await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("blank");
    for (const [t, x, y] of [["8237A", 4, 4], ["8259A", 30, 4], ["8255", 56, 4], ["8086", 80, 4]]) {
      app.placing = t; app.placeAt(x, y);
      if (document.getElementById("modal").classList.contains("open")) K8086.closeModal();
    }
    return app.doc.components.map(c => c.props.ref);
  });
  if (new Set(refs).size !== refs.length) throw new Error("duplicate refs: " + refs.join(","));
});

await test("a plan that cannot make progress is benched with a reason, not re-offered forever", async () => {
  const s1 = await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("blank");
    const cg = null;
    app.placing = "8086"; app.placeAt(16, 2);
    app.placing = "8284A"; app.placeAt(2, 2);
    // wire the clock through the checklist plumbing directly
    const cgc = app.doc.components.find(c => c.type === "8284A");
    K8086.connPlans(app.doc, cgc).checklist.run(app.doc,
      [{ compId: app.doc.components.find(c => c.type === "8086").id, mode: "min" }]);
    K8086.closeModal();
    // exhaust all eight IO windows with PPIs wired recipe-by-recipe
    const cpu = app.doc.components.find(c => c.type === "8086");
    for (let i = 0; i < 8; i++)
      K8086.autoconnect(app.doc, K8086.docAddComponent(app.doc, "8255", 40 + i * 2, 40), cpu);
    app.ensureRefs(); app.docChanged();
    // now a DMA controller has no window left: its plan can't wire anything
    K8086.docAddComponent(app.doc, "8237A", 100, 2);
    app._sweepSeen = ""; app._sweepStuck?.clear();
    const opened = app.offerBoardSweep(true);
    return { opened, rows: document.querySelectorAll(".acRow").length };
  });
  eq(s1.opened, true, "sweep offers the DMA row");
  eq(s1.rows, 1, "just the stuck-to-be chip");
  await page.click("#modalBtns button.primary");            // try to wire it
  const s2 = await page.evaluate(() => ({
    open: document.getElementById("modal").classList.contains("open"),
    hint: document.getElementById("hint").textContent,
    reopens: K8086.App.offerBoardSweep(false),              // non-forced: must stay benched
  }));
  eq(s2.open, false, "dialog closes instead of looping");
  if (!/couldn't wire/.test(s2.hint)) throw new Error("hint: " + s2.hint);
  eq(s2.reopens, false, "benched chip is not re-offered");
  await page.evaluate(() => { K8086.closeModal(); K8086.App.loadPreset("min-8088"); });
});

await test("repair flow: snip a bus lane → whisper names it → ⚡ complete restores it", async () => {
  const s1 = await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("min-8088");
    const ram = app.doc.components.find(c => c.type === "SRAM6264");
    const key = K8086.pinKey(ram, "D2");
    const wire = app.doc.wires.find(w => w.a === key || w.b === key);
    app.selection = { kind: "wire", wire };
    app.deleteSelection();                                   // the accident
    return { hint: document.getElementById("hint").textContent,
      modal: document.getElementById("modal").classList.contains("open") };
  });
  eq(s1.modal, false, "deletion never pops a dialog");
  if (!/lost .*D2.*complete can restore/.test(s1.hint)) throw new Error("whisper: " + s1.hint);
  const s2 = await page.evaluate(() => {
    K8086.App.offerBoardSweep(true);                         // the ask for help
    return {
      open: document.getElementById("modal").classList.contains("open"),
      sub: document.querySelector(".acSub")?.textContent || "",
      rows: [...document.querySelectorAll(".acRow")].map(r => ({
        label: r.querySelector("label").textContent.trim(),
        checked: r.querySelector("input").checked,
        desc: r.querySelector(".acDesc")?.textContent || "",
      })),
    };
  });
  eq(s2.open, true, "repair dialog opens");
  if (!/Repair/.test(s2.sub)) throw new Error("no repair section: " + s2.sub);
  const row = s2.rows.find(r => /SRAM/.test(r.label));
  if (!row || !/D2/.test(row.desc)) throw new Error("rows: " + JSON.stringify(s2.rows));
  eq(row.checked, true, "accidental damage pre-checked");
  await page.click("#modalBtns button.primary");
  const s3 = await page.evaluate(() => {
    const app = K8086.App;
    const ram = app.doc.components.find(c => c.type === "SRAM6264");
    const n = K8086.extractNets(app.doc).byPin.get(K8086.pinKey(ram, "D2"));
    const restored = !!n && n.pins.length > 1;
    const out = { restored, hint: document.getElementById("hint").textContent };
    app.loadPreset("min-8088");
    return out;
  });
  eq(s3.restored, true, "lane restored by the repair");
  if (!/autowired/.test(s3.hint)) throw new Error("hint: " + s3.hint);
});

await test("waveform: solid square waves, deep history ring, zoom/pan controls all live", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("min-8088");
    app.startStop();                                        // start the sim
    for (let i = 0; i < 4000; i++) app.sim.stepHalf();
    const wf = app.waveform;
    const out = { ring: app.sim.ringSize };
    // --- square-wave rendering: CLK lane must be mostly HORIZONTAL ink ---
    wf.follow = true; wf.span = 64; wf.vScale = 1;
    wf.render();
    const cv = document.getElementById("waveCanvas");
    const ctx = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const img = ctx.getImageData(0, 0, cv.width, Math.round(24 * dpr)).data;  // lane 0 = CLK
    const bg = K8086.theme.cv.waveBg, grid = K8086.theme.cv.waveGrid;
    const hx = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const [bgR] = hx(bg), [gR] = hx(grid);
    const cols = new Set();
    const W = cv.width;
    for (let p = 0; p < img.length; p += 4) {
      const r = img[p];
      if (Math.abs(r - bgR) > 12 && Math.abs(r - gR) > 12) cols.add((p / 4) % W);
    }
    out.inkCols = cols.size / W;                            // fraction of columns with signal ink
    // --- zoomed-out column aggregation renders without error ---
    wf.span = 32768; wf.render();
    out.zoomOutOk = true;
    // --- controls ---
    const hz = document.getElementById("waveHZoom"), vz = document.getElementById("waveVZoom"),
      sc = document.getElementById("waveScroll");
    hz.value = "0"; hz.dispatchEvent(new Event("input"));
    out.spanAtMin = wf.span;
    hz.value = "1000"; hz.dispatchEvent(new Event("input"));
    out.spanAtMax = wf.span;
    // pinch = ctrl+wheel: zooms and moves the slider
    wf.span = 1024; wf.render();
    const beforeSlider = +hz.value;
    cv.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true }));
    out.pinchZoomedIn = wf.span < 1024;
    out.sliderMoved = +hz.value !== beforeSlider;
    // vertical zoom resizes the label lanes
    vz.value = "200"; vz.dispatchEvent(new Event("input"));
    out.laneBig = document.querySelector("#waveNames .sig")?.style.height === "52px";
    // scrollbar browses history and re-engages follow at the right edge
    sc.value = "0"; sc.dispatchEvent(new Event("input"));
    out.browsing = wf.follow === false && wf.tEnd < app.sim.t;
    sc.value = "1000"; sc.dispatchEvent(new Event("input"));
    out.followAgain = wf.follow === true;
    app.startStop();                                        // stop
    app.loadPreset("min-8088");
    return out;
  });
  eq(s.ring, 1 << 18, "small board gets the full 131k-cycle ring");
  if (s.inkCols < 0.8) throw new Error("CLK lane ink covers only " + (s.inkCols * 100).toFixed(0) + "% of columns — levels missing");
  eq(s.zoomOutOk, true, "aggregated zoom-out renders");
  eq(s.spanAtMin, 16, "slider min = 8 cycles");
  eq(s.spanAtMax, 1 << 18, "slider max = full history");
  eq(s.pinchZoomedIn, true, "pinch zooms");
  eq(s.sliderMoved, true, "slider tracks the pinch");
  eq(s.laneBig, true, "V-zoom resizes name lanes");
  eq(s.browsing, true, "scrollbar detaches into history");
  eq(s.followAgain, true, "right edge re-engages follow");
});

const DBG_PROG = [
  "        org 0",
  "start:  mov sp, 0x1000",
  "        mov ax, 0",
  "        call fn",
  "        out 0x10, al",
  "loopf:  inc bx",
  "        jmp loopf",
  "fn:     mov al, 0x42",
  "        ret",
].join("\n");

await test("debugger: gutter breakpoint pauses the sim; step over/into; watches; watchpoint; step back", async () => {
  const s1 = await page.evaluate((prog) => {
    const app = K8086.App;
    app.loadPreset("min-8088");
    document.getElementById("codeEditor").value = prog;
    const callLine = prog.split("\n").findIndex(l => l.includes("call fn")) + 1;
    K8086.DebugUI.toggleLineBp(callLine);
    app.assemble();
    app.start();
    return {
      callLine,
      gutterLines: document.querySelectorAll("#asmGutter .gLine").length,
      dot: document.querySelector(`#asmGutter .gLine[data-line="${callLine}"]`).classList.contains("bp"),
      resolved: app.dbg.bpAddr.size > 0,
    };
  }, DBG_PROG);
  eq(s1.gutterLines, DBG_PROG.split("\n").length, "gutter mirrors the source");
  eq(s1.dot, true, "red dot on click");
  eq(s1.resolved, true, "line resolved to physical mirrors");
  await page.waitForTimeout(500);                            // frames run until the bp
  const s2 = await page.evaluate(() => {
    const app = K8086.App;
    return { paused: app.paused, stop: app.sim.dbgStop, hint: document.getElementById("hint").textContent,
      cur: K8086.DebugUI.currentLine(), tab: app.tab };
  });
  eq(s2.paused && s2.stop, true, "paused at the breakpoint");
  if (!/breakpoint · line/.test(s2.hint)) throw new Error("hint: " + s2.hint);
  const btns = await page.evaluate(() => {
    K8086.App.showTab("debug");
    return [...document.querySelectorAll(".dbgBtns button")].map(b => ({ t: b.textContent, dis: b.disabled }));
  });
  if (btns.some(b => b.dis)) throw new Error("stepping buttons disabled while paused: " + JSON.stringify(btns));
  eq(s2.cur, s1.callLine, "current-line marker on the CALL");
  eq(s2.tab, "debug", "debug tab opened");
  const s3 = await page.evaluate(() => {
    const app = K8086.App;
    app.dbg.watches.push("AL");
    K8086.DebugUI.stepOver();                                // over the CALL
    return { resumed: !app.paused };
  });
  eq(s3.resumed, true, "step-over resumes to a temp breakpoint");
  await page.waitForTimeout(400);
  const s4 = await page.evaluate(() => {
    const app = K8086.App;
    const chip = K8086.DebugUI.focusCpu();
    const al = chip.state.arch.r[0] & 0xFF;
    const stackLen = chip.runtime.dbgStack.length;
    const cur = K8086.DebugUI.currentLine();
    app.showTab("debug");
    const panel = document.getElementById("debugPane").textContent;
    // now an IO watchpoint on the OUT port
    app.dbg.ioWps.push({ from: 0x10, to: 0x10, mode: "w" });
    K8086.DebugUI.cont();
    return { al, stackLen, cur, watchShown: /AL/.test(panel) && /0042h|42h/.test(panel) };
  });
  eq(s4.al, 0x42, "subroutine ran during step-over");
  eq(s4.stackLen, 0, "no leftover frame");
  eq(s4.watchShown, true, "watch row shows the value");
  await page.waitForTimeout(400);
  const s5 = await page.evaluate(() => {
    const app = K8086.App;
    const hit = app.dbg.hit;
    const ipAtOut = K8086.DebugUI.focusCpu().state.arch.ip;
    K8086.DebugUI.stepBack();                                // un-execute the OUT
    return { kind: hit && hit.kind, port: hit && hit.addr, paused: app.paused,
      ipAfterBack: K8086.DebugUI.focusCpu().state.arch.ip, ipAtOut };
  });
  eq(s5.kind, "iowatch", "IO watchpoint tripped");
  eq(s5.port, 0x10, "right port");
  if (s5.ipAfterBack >= s5.ipAtOut) throw new Error("step back did not rewind: " + s5.ipAfterBack.toString(16));
  await page.evaluate(() => { K8086.App.stop(); });
});

await test("debugger: conditional breakpoint, F11 key, trace panel, save/restore, disasm fallback", async () => {
  const prog = ["        org 0", "start:  mov cx, 5", "lp:     dec cx", "        jmp lp"].join("\n");
  const s1 = await page.evaluate((prog) => {
    const app = K8086.App;
    app.loadPreset("min-8088");
    document.getElementById("codeEditor").value = prog;
    const lpLine = 3;
    app.dbg.lineBps.set(lpLine, { cond: "CX==2" });
    app.assemble();
    app.start();
    return { ok: true };
  }, prog);
  await page.waitForTimeout(500);
  const s2 = await page.evaluate(() => {
    const app = K8086.App;
    return { paused: app.paused, cx: K8086.DebugUI.focusCpu().state.arch.r[1] };
  });
  eq(s2.paused, true, "conditional bp hit");
  eq(s2.cx, 2, "stopped exactly when CX==2");
  await page.keyboard.press("F11");                          // step into via the classic key
  const s3 = await page.evaluate(() => {
    const app = K8086.App;
    app.showTab("debug");
    const rows = document.querySelectorAll(".dbgTrace .dbgRow").length;
    const cyc = /\d+c/.test(document.querySelector(".dbgTrace")?.textContent || "");
    return { cx: K8086.DebugUI.focusCpu().state.arch.r[1], rows, cyc };
  });
  eq(s3.cx, 1, "F11 executed the DEC");
  if (s3.rows < 5) throw new Error("trace rows: " + s3.rows);
  eq(s3.cyc, true, "cycle costs shown");
  const s4 = await page.evaluate(() => {
    const app = K8086.App;
    app.stop();
    const saved = JSON.parse(JSON.stringify(app.buildSaveData()));
    app.loadPreset("blank");                                 // wipes debug state
    const wiped = app.dbg.lineBps.size;
    app.applySaveData(saved);
    const bp = app.dbg.lineBps.get(3);
    return { wiped, restoredCond: bp && bp.cond,
      dotBack: document.querySelector('#asmGutter .gLine[data-line="3"]')?.classList.contains("bp") };
  });
  eq(s4.wiped, 0, "preset switch cleared the debugger");
  eq(s4.restoredCond, "CX==2", "condition survived save/restore");
  eq(s4.dotBack, true, "gutter dot restored");
  const s5 = await page.evaluate(() => {
    const app = K8086.App;
    app.start();
    app.pauseResume();                                       // pause somewhere
    app.lastAsm = null;                                      // simulate foreign code (BIOS)
    app.showTab("debug");
    const status = document.querySelector(".dbgStatus").textContent;
    const disasmRows = document.querySelectorAll(".dbgDisasm .dbgRow").length;
    app.stop();
    app.loadPreset("min-8088");
    return { status, disasmRows };
  });
  if (!/no source/.test(s5.status)) throw new Error("fallback status: " + s5.status);
  if (s5.disasmRows < 8) throw new Error("disassembly rows: " + s5.disasmRows);
});

await test("range calculator: move the kit RAM to 08000h, verified in-modal", async () => {
  await page.evaluate(() => {
    const app = K8086.App;
    const ram = app.doc.components.find(c => c.type === "SRAM6264");
    K8086.RangeCalc.open(app, ram);
  });
  await page.evaluate(() => { document.querySelector("#modalBody input").value = "08000"; });
  await page.click("#modalBtns button.primary");
  const s = await page.evaluate(() => ({
    ok: !!document.querySelector(".rcResult .rcOk"),
    text: document.querySelector(".rcResult")?.textContent || "",
    now: document.querySelector(".rcCurrent")?.textContent || "",
  }));
  if (!s.ok) throw new Error("not verified: " + s.text);
  if (!/08000h-09FFFh/.test(s.text)) throw new Error("range text: " + s.text);
  if (!/08000h-09FFFh/.test(s.now)) throw new Error("current mapping: " + s.now);
  await page.evaluate(() => { K8086.closeModal(); K8086.App.loadPreset("min-8088"); });
});

await test("guided lab: button appears, modal lists steps, checkmarks stick", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    const visible = document.getElementById("btnLab").style.display !== "none";
    app.openLab();
    const steps = document.querySelectorAll(".labSteps li").length;
    document.querySelector(".labSteps li .labCheck").click();
    const checked = document.querySelectorAll(".labSteps li.done").length;
    K8086.closeModal();
    app.openLab();
    const still = document.querySelectorAll(".labSteps li.done").length;
    K8086.closeModal();
    return { visible, steps, checked, still, presets: K8086.presets.length };
  });
  eq(s.presets, 21, "preset count");
  eq(s.visible, true, "lab button hidden on min-8088");
  if (s.steps < 4) throw new Error("too few steps: " + s.steps);
  eq(s.checked, 1, "checkmark");
  eq(s.still, 1, "checkmark persisted across reopen");
});

await test("no-wire mode: toggle hides wires, pin hover glows the whole net", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    document.getElementById("btnWires").click();
    const hidden = app.hideWires === true;
    app.schematic.render();
    const noBundles = app.schematic._bundles.length === 0;
    // hover the CPU's CLK pin: its net (8284 CLK + CPU CLK) must glow
    const cpu = app.doc.components.find(c => K8086.chips[c.type].isCpu);
    const pin = K8086.chips[cpu.type].pins[K8086.chips[cpu.type].pinIndex.CLK];
    app.schematic.hover = { kind: "pin", comp: cpu, pin };
    app.schematic.render();
    const glow = app.schematic._glowNet ? app.schematic._glowNet.pins.length : 0;
    const noHits = app.schematic.hitTest(300, 300) === null ||
      app.schematic.hitTest(300, 300).kind !== "wire";
    document.getElementById("btnWires").click();     // back on
    return { hidden, noBundles, glow, noHits, restored: !app.hideWires };
  });
  eq(s.hidden, true, "toggle");
  eq(s.noBundles, true, "wires still cached");
  if (s.glow < 2) throw new Error("net glow pins: " + s.glow);
  eq(s.restored, true, "restore");
});

await test("connection table: ranked dropdowns wire and unwire without the canvas", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    const cpu = app.doc.components.find(c => K8086.chips[c.type].isCpu);
    app.select({ kind: "comp", comp: cpu });
    app.showTab("chip");
    const pane = document.getElementById("chipPane");
    const rows = pane.querySelectorAll(".ctTable tr").length;
    // find the ~SS0 row (free pin on min-8088) and wire it to GND via the table
    const row = [...pane.querySelectorAll(".ctTable tr")]
      .find(r => r.querySelector(".ctPin") && r.querySelector(".ctPin").textContent.startsWith("~SS0"));
    const [chipSel, pinSel] = row.querySelectorAll("select");
    chipSel.dispatchEvent(new Event("focus"));       // builds the ranked list
    const firstOption = chipSel.options[1] ? chipSel.options[1].textContent : "";
    const gndOpt = [...chipSel.options].find(o => o.textContent.includes("GND"));
    chipSel.value = gndOpt.value;
    chipSel.dispatchEvent(new Event("change"));
    const suggestedPin = pinSel.value;
    const before = app.doc.wires.length;
    row.querySelector(".ctBtn").click();
    const after = app.doc.wires.length;
    // now remove it via the chip's ⊗
    const row2 = [...document.querySelectorAll("#chipPane .ctTable tr")]
      .find(r => r.querySelector(".ctPin") && r.querySelector(".ctPin").textContent.startsWith("~SS0"));
    row2.querySelector(".ctX").click();
    const final = app.doc.wires.length;
    return { rows, firstOption, suggestedPin, added: after - before, removed: after - final };
  });
  if (s.rows < 20) throw new Error("table rows: " + s.rows);
  eq(s.added, 1, "wire added via table");
  eq(s.removed, 1, "wire removed via table");
  eq(s.suggestedPin, "G", "GND pin preselected");
});

await test("connection table: bus accelerator wires a whole family with an offset", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("min-8088");
    // fresh receiver: a '244 with nothing on it
    app.placing = "74LS244";
    app.placeAt(96, 52);
    K8086.closeModal();                              // skip the autoconnect offer
    const buf = app.doc.components[app.doc.components.length - 1];
    const cpu = app.doc.components.find(c => K8086.chips[c.type].isCpu);
    app.select({ kind: "comp", comp: cpu });
    app.showTab("chip");
    const row = [...document.querySelectorAll("#chipPane .ctTable tr")]
      .find(r => r.querySelector(".ctPin") && r.querySelector(".ctPin").textContent.startsWith("AD0"));
    const [chipSel, pinSel] = row.querySelectorAll("select");
    chipSel.dispatchEvent(new Event("focus"));
    chipSel.value = buf.id;
    chipSel.dispatchEvent(new Event("change"));
    pinSel.value = "A0";
    pinSel.dispatchEvent(new Event("change"));
    const busBtn = row.querySelector(".ctBus");
    const visible = busBtn && busBtn.style.display !== "none";
    const before = app.doc.wires.length;
    busBtn.click();
    const added = app.doc.wires.length - before;
    const bundled = app.doc.wires.slice(-added).every(w => w.bundle);
    app.loadPreset("min-8088");                      // pristine board for later tests
    return { visible, added, bundled, label: visible ? busBtn.textContent : "" };
  });
  eq(s.visible, true, "bus button shown");
  eq(s.added, 8, "eight wires in one click");
  eq(s.bundled, true, "tagged as a bundle");
});

await test("properties popup has the Connections tab", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    const ram = app.doc.components.find(c => c.type === "SRAM6264");
    K8086.propsDialog(app, ram);
    const tabs = [...document.querySelectorAll("#modalBox .ctTab")].map(b => b.textContent);
    const connTab = [...document.querySelectorAll("#modalBox .ctTab")].find(b => b.textContent === "Connections");
    connTab.click();
    const rows = document.querySelectorAll("#modalBox .ctTable tr").length;
    K8086.closeModal();
    return { tabs, rows };
  });
  if (!s.tabs.includes("Config") || !s.tabs.includes("Connections")) throw new Error("tabs: " + s.tabs.join(","));
  if (s.rows < 20) throw new Error("conn rows in popup: " + s.rows);
});

await test("unified editor works on the bench: decode-aware image edits apply at Start", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("min-8088");
    app.ensureMemMap();
    const cpuMap = app.memMap.cpus[0];
    const ramSeg = cpuMap.segments.find(sg => !sg.alias && sg.start === 0);
    const ad = K8086.HexEditor._segmentAdapter(app, cpuMap, ramSeg);
    ad.set(0x40, 0x5A);                                  // CPU-space write, no sim running
    const ram = app.doc.components.find(c => c.type === "SRAM6264");
    const inImage = ram.props.image && ram.props.image[0x40] === 0x5A;
    const readsBack = ad.get(0x40) === 0x5A;
    // ROM edit through the decode: hits the image + flags it as hand-edited
    const romSeg = cpuMap.segments.find(sg => sg.resetVector);
    const adr = K8086.HexEditor._segmentAdapter(app, cpuMap, romSeg);
    adr.set(romSeg.end - romSeg.start - 3, 0x77);
    const rom = app.doc.components.find(c => K8086.chips[c.type].isRom);
    const romFlag = rom.props.userImage === true;
    // Start: the RAM initial image must land in the live chip
    document.getElementById("btnStart").click();
    const chip = app.sim.chipFor(ram.id);
    const applied = chip.state.mem[0x40] === 0x5A;
    document.getElementById("btnStart").click();         // stop
    delete rom.props.userImage;                          // clean up for later tests
    delete rom.props.image;
    delete ram.props.image;
    return { inImage, readsBack, romFlag, applied };
  });
  eq(s.inImage, true, "RAM image via decode");
  eq(s.readsBack, true, "unified read-back");
  eq(s.romFlag, true, "ROM hand-edit flag");
  eq(s.applied, true, "initial image applied at Start");
});

await test("hand-edited ROM survives Start; explicit Assemble reclaims it", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("min-8088");
    const rom = app.doc.components.find(c => K8086.chips[c.type].isRom);
    // hand-edit the reset vector's first byte via the chip-local path
    rom.props.image = new Array(8192).fill(0xFF);
    rom.props.image[0x1FF0] = 0x90;                      // NOP where EA should be
    rom.props.userImage = true;
    document.getElementById("btnStart").click();
    const kept = app.sim.chipFor(rom.id).state.mem[0x1FF0] === 0x90;
    const hint = document.getElementById("hint").textContent;
    document.getElementById("btnStart").click();         // stop
    app.assemble(true);                                  // the button: reclaim
    const flagCleared = !rom.props.userImage;
    document.getElementById("btnStart").click();
    const reprogrammed = app.sim.chipFor(rom.id).state.mem[0x1FF0] === 0xEA;
    document.getElementById("btnStart").click();
    return { kept, hint, flagCleared, reprogrammed };
  });
  eq(s.kept, true, "hand bytes kept at Start");
  if (!/hand-edited/.test(s.hint)) throw new Error("no precedence hint: " + s.hint);
  eq(s.flagCleared, true, "Assemble reclaims");
  eq(s.reprogrammed, true, "source wins after reclaim");
});

await test("save → mutate → restore: board, program, preset lineage all round-trip", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("irq-lab");
    document.getElementById("codeEditor").value += "\n; my tweak";
    const saved = app.buildSaveData();
    const savedWires = saved.doc.wires.length;
    // wreck the board
    app.loadPreset("blank");
    const wrecked = app.doc.components.length === 0;
    // restore
    app.applySaveData(JSON.parse(JSON.stringify(saved)));
    return {
      wrecked,
      wires: app.doc.wires.length === savedWires,
      presetId: app.preset && app.preset.id,
      program: document.getElementById("codeEditor").value.endsWith("; my tweak"),
      romComp: !!(app.presetNames && app.presetNames[app.preset.romComp]),
    };
  });
  eq(s.wrecked, true, "blank board is empty");
  eq(s.wires, true, "wires restored");
  eq(s.presetId, "irq-lab", "preset lineage");
  eq(s.program, true, "program restored");
  eq(s.romComp, true, "ROM recipe re-linked");
});

await test("blank board: from scratch with autoconnect, it runs", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("blank");
    const empty = app.doc.components.length === 0;
    // build a machine from nothing (the same calls the UI makes)
    K8086.docAddComponent(app.doc, "XTAL", 2, 2, { mhz: 14.31818 });
    K8086.docAddComponent(app.doc, "8284A", 2, 6);
    const cpu = K8086.docAddComponent(app.doc, "8088", 16, 2);
    K8086.autoconnect(app.doc, cpu, null);
    const rom = K8086.docAddComponent(app.doc, "EPROM2764", 50, 2);
    K8086.autoconnect(app.doc, rom, cpu);
    app.ensureRefs();
    app.docChanged();
    // program it by hand-editing the image (blank has no preset makeRom)
    const asm = K8086.assemble("        org 0xE000\nstart:  inc ax\n        jmp start");
    rom.props.image = new Array(8192).fill(0xFF);
    asm.bytes.forEach((b, i) => rom.props.image[(0xE000 & 0x1FFF) + i] = b);
    [0xEA, 0x00, 0xE0, 0x00, 0xF0].forEach((b, i) => rom.props.image[0x1FF0 + i] = b);
    rom.props.userImage = true;
    document.getElementById("btnStart").click();
    let insns = 0;
    for (let i = 0; i < 40000; i++) app.sim.stepHalf();
    insns = app.sim.chips.find(c => c.def.isCpu).runtime.core.insnCount;
    document.getElementById("btnStart").click();
    app.loadPreset("min-8088");
    return { empty, insns };
  });
  eq(s.empty, true, "blank starts empty");
  if (s.insns < 100) throw new Error("from-scratch board did not run: " + s.insns);
});

await test("autosave: survives a reload, restore offer works", async () => {
  await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("traffic-8255");
    app._autosaveArmed = true;
    app.autosaveNow();
  });
  await page.reload();
  await page.waitForTimeout(700);
  const offered = await page.evaluate(() => ({
    open: document.getElementById("modal").classList.contains("open"),
    title: document.querySelector("#modalBox h3")?.textContent || "",
  }));
  eq(offered.open, true, "restore offer shown");
  if (!/Restore last session/.test(offered.title)) throw new Error("title: " + offered.title);
  await page.click("#modalBtns button.primary");        // Restore
  const s = await page.evaluate(() => ({
    presetId: K8086.App.preset && K8086.App.preset.id,
    comps: K8086.App.doc.components.length,
  }));
  eq(s.presetId, "traffic-8255", "session restored");
  if (s.comps < 5) throw new Error("components: " + s.comps);
  await page.evaluate(() => { localStorage.removeItem("u8086.autosave"); K8086.App.loadPreset("min-8088"); });
});

await test("disk library: built-ins listed, duplicate + new blank persist, delete works", async () => {
  await page.evaluate(() => { window.prompt = () => "my test disk"; });   // answer name prompts
  await page.evaluate(() => K8086.DiskLib.open(K8086.App));
  await page.waitForTimeout(400);
  let s = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".dlRow .dlName")].map(e => e.textContent),
  }));
  if (!s.rows.some(r => r.includes("FreeDOS 1.3 install floppy"))) throw new Error("floppy built-in missing: " + s.rows.join("|"));
  if (!s.rows.some(r => r.includes("FreeDOS system HDD"))) throw new Error("HDD built-in missing");
  // duplicate the install floppy -> a persisted user copy
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".dlRow")].find(r => r.textContent.includes("install floppy"));
    [...row.querySelectorAll("button")].find(b => b.textContent.includes("duplicate")).click();
  });
  await page.waitForTimeout(600);
  s = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".dlRow .dlName")].map(e => e.textContent),
  }));
  if (!s.rows.some(r => r.includes("my test disk"))) throw new Error("duplicate not persisted: " + s.rows.join("|"));
  // delete it again
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".dlRow")].find(r => r.textContent.includes("my test disk"));
    [...row.querySelectorAll("button")].find(b => b.textContent === "🗑").click();
  });
  await page.waitForTimeout(600);
  s = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".dlRow .dlName")].map(e => e.textContent),
    hddOk: (() => { const x = K8086.buildFreeDosHdd(K8086.assetBytes("freedos144")); return !!x && x.length === K8086.HDD_BYTES; })(),
  }));
  if (s.rows.some(r => r.includes("my test disk"))) throw new Error("delete failed");
  eq(s.hddOk, true, "in-browser HDD synthesis");
  await page.evaluate(() => K8086.closeModal());
});

await test("CRT + keyboard: double-click view docks the keys, clicks and typing reach DOS", async () => {
  await page.evaluate(() => { K8086.App.loadPreset("pc-xt"); });
  await page.waitForTimeout(200);
  await page.click("#btnStart");
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => {
    const app = K8086.App;
    const crt = app.doc.components.find(c => c.type === "CRT");
    K8086.CrtView.open(app, crt);
    const dock = !!document.querySelector(".crtKbd");
    const live = !!document.querySelector(".crtLive");
    const override = K8086.KbdCapture.modalOverride === true;
    // click the drawn 'A' key: scancode 0x1E must enter the input log
    const kcv = document.querySelector(".crtKbd");
    const r = kcv.getBoundingClientRect();
    const before = app.sim.inputLog.length;
    kcv.dispatchEvent(new MouseEvent("mousedown", { clientX: r.left + 60, clientY: r.top + 80, bubbles: true }));
    kcv.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    const logged = app.sim.inputLog.slice(before).map(e => e.patch.scan);
    K8086.closeModal();
    const cleared = K8086.KbdCapture.modalOverride === false;
    // cleanup INSIDE the evaluate so a failed assertion can't strand the app
    app.startStop();                                     // stop the XT
    app.loadPreset("min-8088");
    return { dock, live, override, logged, cleared };
  });
  eq(s.dock, true, "keyboard docked");
  eq(s.live, true, "input-live indicator");
  eq(s.override, true, "typing allowed inside the modal");
  if (s.logged.length < 2 || (s.logged[1] & 0x7F) !== s.logged[0]) throw new Error("click scancodes: " + s.logged.join(","));
  eq(s.cleared, true, "override cleared on close");
});

await test("undo/redo: place, wire, image edits all reversible; preset load resets", async () => {
  const s = await page.evaluate(async () => {
    const app = K8086.App;
    app.loadPreset("min-8088");
    const h0 = app.history.length;
    const comps0 = app.doc.components.length, wires0 = app.doc.wires.length;
    // 1. place a chip (skip the autoconnect offer)
    app.placing = "74LS32";
    app.placeAt(100, 60);
    K8086.closeModal();
    await new Promise(r => setTimeout(r, 600));          // outlive coalescing
    // 2. wire something via docConnect path
    const a = app.doc.components[app.doc.components.length - 1];
    const gnd = app.doc.components.find(c => c.type === "GND");
    K8086.docConnect(app.doc, K8086.pinKey(a, "1A"), K8086.pinKey(gnd, "G"));
    app.docChanged();
    await new Promise(r => setTimeout(r, 600));
    // 3. image edit
    const rom = app.doc.components.find(c => K8086.chips[c.type].isRom);
    rom.props.image = new Array(8192).fill(0xFF);
    rom.props.image[7] = 0x42;
    app.imageEdited();
    await new Promise(r => setTimeout(r, 600));
    const afterEdits = { comps: app.doc.components.length, wires: app.doc.wires.length, img: true };
    app.undo();                                          // image edit gone
    const u1 = !app.doc.components.find(c => K8086.chips[c.type].isRom).props.image;
    app.undo();                                          // wire gone
    const u2 = app.doc.wires.length === wires0 + 0 + (afterEdits.wires - wires0 - 1);
    app.undo();                                          // chip gone
    const u3 = app.doc.components.length === comps0;
    app.redo(); app.redo(); app.redo();
    const r1 = app.doc.components.length === afterEdits.comps &&
               app.doc.wires.length === afterEdits.wires &&
               app.doc.components.find(c => K8086.chips[c.type].isRom).props.image[7] === 0x42;
    app.loadPreset("min-8088");
    const cleared = app.history.length === 0 && app.future.length === 0;
    return { h0, u1, u2, u3, r1, cleared };
  });
  eq(s.h0, 0, "fresh history");
  eq(s.u1, true, "undo image edit");
  eq(s.u2, true, "undo wire");
  eq(s.u3, true, "undo place");
  eq(s.r1, true, "redo chain restores all three");
  eq(s.cleared, true, "preset load resets history");
});

await test("right-click: first selects, second deletes — wires and chips", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    app.loadPreset("min-8088");
    const sch = app.schematic;
    sch.render();
    // pick a single (non-bundle) wire from the routed cache
    const [wireId, path] = [...sch._singlePaths.entries()][0];
    const wire = app.doc.wires.find(w => w.id === wireId);
    const mid = path[Math.floor(path.length / 2)];
    const [sx, sy] = sch.toScreen(mid[0], mid[1]);
    const wires0 = app.doc.wires.length;
    const down = (btn) => sch.cv.dispatchEvent(new MouseEvent("mousedown", {
      button: btn, bubbles: true, clientX: sch.cv.getBoundingClientRect().left + sx,
      clientY: sch.cv.getBoundingClientRect().top + sy }));
    // offsetX/offsetY come from client coords on real canvases; emulate via defineProperty
    const fire = (btn, x, y) => {
      const ev = new MouseEvent("mousedown", { button: btn, bubbles: true });
      Object.defineProperty(ev, "offsetX", { value: x });
      Object.defineProperty(ev, "offsetY", { value: y });
      sch.cv.dispatchEvent(ev);
    };
    fire(2, sx, sy);                                    // right-click #1: selects
    const selectedWire = app.selection && app.selection.kind === "wire";
    fire(2, sx, sy);                                    // right-click #2: deletes
    const wireGone = app.doc.wires.length === wires0 - 1;
    // now a chip
    const chip = app.doc.components.find(c => c.type === "74LS04");
    const r = sch.bodyRect(chip);
    const [cx, cy] = sch.toScreen(r.x + r.w / 2, r.y + r.h / 2);
    const comps0 = app.doc.components.length;
    fire(2, cx, cy);
    const selectedComp = app.selection && app.selection.kind === "comp" && app.selection.comp === chip;
    fire(2, cx, cy);
    const compGone = app.doc.components.length === comps0 - 1;
    app.undo(); app.undo();                             // put everything back
    const restored = app.doc.components.length === comps0 && app.doc.wires.length === wires0;
    app.loadPreset("min-8088");
    return { selectedWire, wireGone, selectedComp, compGone, restored };
  });
  eq(s.selectedWire, true, "wire selected on first right-click");
  eq(s.wireGone, true, "wire deleted on second");
  eq(s.selectedComp, true, "chip selected on first right-click");
  eq(s.compGone, true, "chip deleted on second");
  eq(s.restored, true, "undo undoes right-click deletes");
});

await test("no-wire mode: selected chip's wires render fully and are clickable", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    document.getElementById("btnWires").click();        // wires off
    app.select(null);
    app.schematic.render();
    const cleanEmpty = app.schematic._bundles.length === 0 && app.schematic._singlePaths.size === 0;
    const cpu = app.doc.components.find(c => K8086.chips[c.type].isCpu);
    app.select({ kind: "comp", comp: cpu });
    app.schematic.render();
    const shown = app.schematic._bundles.length + app.schematic._singlePaths.size;
    const allTouchCpu = [...app.schematic._singlePaths.keys()].every(id => {
      const w = app.doc.wires.find(x => x.id === id);
      return w.a.startsWith(cpu.id + ".") || w.b.startsWith(cpu.id + ".");
    });
    // stability: two renders produce identical routes (the old flicker bug)
    const snap1 = JSON.stringify([...app.schematic._singlePaths.values()]);
    app.schematic.render();
    const snap2 = JSON.stringify([...app.schematic._singlePaths.values()]);
    document.getElementById("btnWires").click();        // wires back on
    app.select(null);
    return { cleanEmpty, shown, allTouchCpu, stable: snap1 === snap2 };
  });
  eq(s.cleanEmpty, true, "clean with nothing selected");
  if (s.shown < 3) throw new Error("selected chip wires: " + s.shown);
  eq(s.allTouchCpu, true, "only the chip's wires");
  eq(s.stable, true, "no flicker: identical routes frame to frame");
});

await test("themes: all 20 apply cleanly, canvas + CSS follow, choice persists", async () => {
  const s = await page.evaluate(() => {
    const results = [];
    for (const t of K8086.THEMES) {
      K8086.applyTheme(t.name);
      K8086.App.schematic.render();
      K8086.App.waveform.render();
      const bg = document.documentElement.style.getPropertyValue("--bg");
      results.push({ name: t.name, mode: t.mode, ok: bg === t.bg && K8086.theme.name === t.name });
    }
    const dark = results.filter(r => r.mode === "dark").length;
    const light = results.filter(r => r.mode === "light").length;
    K8086.applyTheme("Midnight");
    let persisted = null;
    try { persisted = localStorage.getItem("u8086.theme"); } catch { /* fine */ }
    return { n: results.length, dark, light, bad: results.filter(r => !r.ok).map(r => r.name), persisted };
  });
  eq(s.n, 20, "theme count");
  eq(s.dark, 10, "dark themes");
  eq(s.light, 10, "light themes");
  if (s.bad.length) throw new Error("themes failed: " + s.bad.join(","));
  eq(s.persisted, "Midnight", "persisted");
});

await test("panes: collapse frees space for the canvas, sizes persist", async () => {
  const s = await page.evaluate(() => {
    const app = K8086.App;
    const cw = () => document.getElementById("canvasWrap").getBoundingClientRect().width;
    const w0 = cw();
    app.togglePane("rightC");
    const wRight = cw();
    app.togglePane("libC");
    const wBoth = cw();
    const rightHidden = document.getElementById("right").getBoundingClientRect().width < 8;
    app.togglePane("waveC");
    const waveCollapsed = document.getElementById("wavePanel").classList.contains("collapsed");
    let persisted = {};
    try { persisted = JSON.parse(localStorage.getItem("u8086.layout")); } catch { /* fine */ }
    // restore
    app.togglePane("rightC"); app.togglePane("libC"); app.togglePane("waveC");
    return { w0, wRight, wBoth, rightHidden, waveCollapsed,
      persistedOk: persisted && persisted.rightW > 0 };
  });
  if (s.wRight <= s.w0 + 200) throw new Error(`right collapse gained ${(s.wRight - s.w0).toFixed(0)}px`);
  if (s.wBoth <= s.wRight + 100) throw new Error("library collapse gained nothing");
  eq(s.rightHidden, true, "right pane hidden");
  eq(s.waveCollapsed, true, "waveform collapsed");
  eq(s.persistedOk, true, "layout persisted");
});

await test("min-8088 boots and blinks", async () => {
  await page.click("#btnStart");
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => {
    const app = K8086.App;
    const cpu = app.sim.chips.find(c => c.def.isCpu);
    return { halted: app.sim.halted, insns: cpu.runtime.core.insnCount };
  });
  eq(s.halted, null, "not halted");
  if (s.insns < 100) throw new Error("too few instructions: " + s.insns);
});

await test("memory map proved at start (RAM low, ROM high, reset window)", async () => {
  const s = await page.evaluate(() => {
    const m = K8086.App.memMap.cpus[0];
    return {
      conflicts: m.conflicts.length,
      primaries: m.segments.filter(x => !x.alias).map(x => x.start),
      reset: !!m.segments.find(x => x.resetVector),
    };
  });
  eq(s.conflicts, 0, "conflicts");
  eq(s.reset, true, "reset window found");
  if (!s.primaries.includes(0) || !s.primaries.includes(0x80000)) throw new Error(JSON.stringify(s.primaries));
});

await test("pause, edit registers + flags, resume clean", async () => {
  await page.click("#btnPause");
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    const app = K8086.App;
    const chip = app.sim.chips.find(c => c.def.isCpu);
    app.editCpuArch(chip, a => { a.r[1] = 0x1234; a.fl |= 0x400; }); // CX, DF
    return { cx: chip.runtime.core.r[1], df: chip.runtime.core.fl & 0x400 };
  });
  eq(r.cx, 0x1234, "CX");
  eq(r.df, 0x400, "DF");
  await page.click("#btnPause"); // resume
  await page.waitForTimeout(400);
  const h = await page.evaluate(() => K8086.App.sim.halted);
  eq(h, null, "resume ok");
  await page.click("#btnPause"); // pause again for edits below
});

await test("step-instruction advances the disassembly view", async () => {
  await page.click("#tabCpu");
  await page.click("#btnStepI");
  await page.waitForTimeout(120);
  const txt = await page.evaluate(() => document.querySelector(".nextInsn")?.textContent || "");
  if (!txt.includes("▶")) throw new Error("no next-instruction line: " + txt);
});

await test("chip-local hex editor via double-click semantics (ROM at local 0)", async () => {
  const s = await page.evaluate(() => new Promise(res => {
    const app = K8086.App;
    const rom = app.doc.components.find(c => c.type === "EPROM2764");
    K8086.HexEditor.open(app, rom);
    setTimeout(() => {
      const firstAddr = document.querySelector(".hexAddr")?.textContent;
      const sub = document.querySelector(".hexSub")?.textContent;
      K8086.closeModal();
      res({ firstAddr, sub });
    }, 250);
  }));
  eq(s.firstAddr, "0000", "local addressing starts at 0");
  if (!s.sub.includes("chip-local")) throw new Error(s.sub);
});

await test("unified memory editor: ranges dropdown + write-through mapping", async () => {
  const s = await page.evaluate(() => new Promise(res => {
    const app = K8086.App;
    app.ensureMemMap();
    K8086.HexEditor.openUnified(app);
    setTimeout(() => {
      const opts = [...document.querySelectorAll("#modalBox select option")].map(o => o.textContent);
      // write through the map into low RAM
      const cpuMap = app.memMap.cpus[0];
      const r = K8086.memMapResolve(cpuMap, 0x00123);
      const ram = app.sim.chipFor(r.compId);
      const before = ram.state.mem[r.local];
      ram.state.mem[r.local] = 0x5A;
      const readBack = ram.state.mem[0x123];
      ram.state.mem[r.local] = before;
      K8086.closeModal();
      res({ nOpts: opts.length, first: opts[0], readBack });
    }, 250);
  }));
  if (s.nOpts < 3) throw new Error("too few ranges: " + s.nOpts);
  if (!/00000/.test(s.first)) throw new Error("first range should be low RAM: " + s.first);
  eq(s.readBack, 0x5A, "map write-through");
});

await test("irq-lab: programmer's views for PIC/PIT/PPI-class chips", async () => {
  await page.evaluate(() => K8086.App.loadPreset("irq-lab"));
  await page.waitForTimeout(200);
  await page.click("#btnStart");
  await page.waitForTimeout(2500);
  await page.click("#btnPause");
  await page.waitForTimeout(150);
  const s = await page.evaluate(() => new Promise(res => {
    const app = K8086.App;
    const pic = app.doc.components.find(c => c.type === "8259A");
    K8086.progView(app, pic);
    setTimeout(() => {
      const cards = document.querySelectorAll(".pvCard").length;
      const bits = document.querySelectorAll(".bitCell").length;
      const mode = document.querySelector(".pvMode")?.textContent;
      // toggle an IMR bit through the UI model
      const chip = app.sim.chipFor(pic.id);
      const imrBefore = chip.state.imr;
      chip.state.imr ^= 0x80;
      app.chipStateEdited(chip);
      const imrAfter = chip.state.imr;
      chip.state.imr = imrBefore;
      K8086.closeModal();
      res({ cards, bits, mode, toggled: imrAfter !== imrBefore });
    }, 250);
  }));
  if (s.cards < 1 || s.bits < 24) throw new Error(JSON.stringify(s));
  if (!s.mode.includes("PAUSED")) throw new Error("mode badge: " + s.mode);
  eq(s.toggled, true, "IMR toggle");
});

await test("PIT programmer's view shows three channels", async () => {
  const s = await page.evaluate(() => new Promise(res => {
    const app = K8086.App;
    const pit = app.doc.components.find(c => c.type === "8253");
    K8086.progView(app, pit);
    setTimeout(() => {
      const cards = document.querySelectorAll(".pvCard").length;
      const lamps = document.querySelectorAll(".pvLamp").length;
      K8086.closeModal();
      res({ cards, lamps });
    }, 250);
  }));
  eq(s.cards, 3, "three counter cards");
  if (s.lamps < 6) throw new Error("lamps: " + s.lamps);
});

await test("interrupts still flowing end-to-end", async () => {
  await page.click("#btnPause"); // resume
  await page.waitForTimeout(2000);
  const bx = await page.evaluate(() => K8086.App.sim.chips.find(c => c.def.isCpu).runtime.core.r[3]);
  if (bx < 2) throw new Error("timer ticks: " + bx);
});

await test("rewind then resume", async () => {
  await page.evaluate(() => K8086.App.seekFrac(0.4));
  await page.waitForTimeout(300);
  const s1 = await page.evaluate(() => ({ halted: K8086.App.sim.halted }));
  eq(s1.halted, null, "seek clean");
  await page.click("#btnPause"); // resume
  await page.waitForTimeout(500);
  const s2 = await page.evaluate(() => K8086.App.sim.halted);
  eq(s2, null, "post-seek run clean");
});

await test("waveform has lanes and canvas renders", async () => {
  const s = await page.evaluate(() => ({
    sigs: K8086.App.waveform.signals.length,
    w: document.getElementById("waveCanvas").width,
  }));
  if (s.sigs < 5 || s.w < 100) throw new Error(JSON.stringify(s));
});

await test("max-mode and word-machine presets boot in the browser", async () => {
  for (const id of ["max-8088", "word-8086"]) {
    await page.evaluate((pid) => K8086.App.loadPreset(pid), id);
    await page.waitForTimeout(150);
    await page.click("#btnStart");
    await page.waitForTimeout(1200);
    const s = await page.evaluate(() => {
      const app = K8086.App;
      const cpu = app.sim.chips.find(c => c.def.isCpu);
      const port = app.sim.chips.filter(c => c.def.type === "74LS373").at(-1);
      return { halted: app.sim.halted, insns: cpu.runtime.core.insnCount, port: port.state.q };
    });
    eq(s.halted, null, id + " not halted");
    if (s.insns < 50) throw new Error(id + " too few insns: " + s.insns);
    if (s.port !== 0x55 && s.port !== 0xAA) throw new Error(id + " port not blinking: " + s.port.toString(16));
    await page.click("#btnStart"); // stop
    await page.waitForTimeout(100);
  }
  // back to irq-lab running for the turbo test below
  await page.evaluate(() => K8086.App.loadPreset("irq-lab"));
  await page.waitForTimeout(150);
  await page.click("#btnStart");
  await page.waitForTimeout(500);
});

await test("Hercules kit: CRT lights up in the browser", async () => {
  await page.evaluate(() => K8086.App.loadPreset("hgc-8088"));
  await page.waitForTimeout(150);
  await page.click("#btnStart");
  await page.waitForTimeout(2200);
  const s = await page.evaluate(() => new Promise(res => {
    const app = K8086.App;
    const crt = app.doc.components.find(c => c.type === "CRT");
    K8086.CrtView.open(app, crt);
    setTimeout(() => {
      const cv = document.querySelector(".crtScreen");
      const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 100) lit++;
      const halted = app.sim.halted;
      K8086.closeModal();
      res({ lit, halted });
    }, 400);
  }));
  eq(s.halted, null, "clean run");
  if (s.lit < 300) throw new Error("screen too dark: " + s.lit + " lit pixels");
  // back to irq-lab for the turbo scenario
  await page.evaluate(() => K8086.App.loadPreset("irq-lab"));
  await page.waitForTimeout(150);
  await page.click("#btnStart");
  await page.waitForTimeout(400);
});

await test("PC typewriter: real browser keystrokes reach the CRT", async () => {
  await page.evaluate(() => K8086.App.loadPreset("kbd-8088"));
  await page.waitForTimeout(150);
  await page.click("#btnStart");
  await page.waitForTimeout(1200);
  // type on the "physical" keyboard — real DOM key events
  await page.keyboard.press("KeyH");
  await page.waitForTimeout(350);
  await page.keyboard.press("KeyI");
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => {
    const app = K8086.App;
    const hgc = app.sim.chips.find(c => c.def.type === "HGC");
    return {
      halted: app.sim.halted,
      typed: String.fromCharCode(hgc.state.mem[320], hgc.state.mem[322]),
    };
  });
  eq(s.halted, null, "clean");
  eq(s.typed, "hi", "typed chars visible in video RAM");
  // back to irq-lab for the turbo scenario
  await page.evaluate(() => K8086.App.loadPreset("irq-lab"));
  await page.waitForTimeout(150);
  await page.click("#btnStart");
  await page.waitForTimeout(400);
});

await test("turbo mode: big speedup, then clean exit back to capture", async () => {
  // ensure running
  const paused = await page.evaluate(() => K8086.App.paused);
  if (paused) { await page.click("#btnPause"); await page.waitForTimeout(100); }
  const t0 = await page.evaluate(() => K8086.App.sim.t);
  await page.waitForTimeout(800);
  const t1 = await page.evaluate(() => K8086.App.sim.t);
  await page.click("#btnTurbo");
  await page.waitForTimeout(800);
  const s = await page.evaluate(() => ({ t: K8086.App.sim.t, fast: K8086.App.sim.fastMode, cap: K8086.App.sim.captureEnabled, halted: K8086.App.sim.halted }));
  eq(s.fast, true, "turbo on");
  eq(s.cap, false, "capture off in turbo");
  eq(s.halted, null, "clean");
  const normalRate = t1 - t0, turboRate = s.t - t1;
  if (turboRate < normalRate * 3) throw new Error(`speedup ${(turboRate / normalRate).toFixed(1)}x`);
  await page.click("#btnPause"); // pausing exits turbo
  await page.waitForTimeout(150);
  const s2 = await page.evaluate(() => ({ fast: K8086.App.sim.fastMode, cap: K8086.App.sim.captureEnabled }));
  eq(s2.fast, false, "turbo auto-exit on pause");
  eq(s2.cap, true, "capture back on");
  await page.click("#btnPause"); // resume for later tests
});

await test("PC/XT: GLaBIOS POSTs on the CRT in-browser (turbo)", async () => {
  await page.evaluate(() => K8086.App.loadPreset("pc-xt"));
  await page.waitForTimeout(200);
  await page.click("#btnStart");
  await page.waitForTimeout(300);
  await page.click("#btnTurbo");
  let text = "";
  for (let i = 0; i < 24 && !text.includes("GLaBIOS"); i++) {
    await page.waitForTimeout(2500);
    text = await page.evaluate(() => {
      const hgc = K8086.App.sim.chips.find(c => c.def.type === "HGC");
      let s = "";
      for (let i2 = 0; i2 < 4000; i2 += 2) {
        const ch = hgc.state.mem[i2];
        s += ch >= 0x20 && ch < 0x7F ? String.fromCharCode(ch) : " ";
      }
      return s;
    });
  }
  const halted = await page.evaluate(() => K8086.App.sim.halted);
  eq(halted, null, "clean");
  if (!text.includes("GLaBIOS")) throw new Error("no BIOS banner after 60s: " + text.slice(0, 120).trim());
  // (the GLaBIOS POST beep lands minutes later — asserted in tests/boot-dos.mjs;
  //  the pin-level 61h/43h/42h speaker path is proved in tests/sim-board.mjs)
  await page.click("#btnStart"); // stop the heavy board
  await page.waitForTimeout(200);
});

await test("disk tools browse the real FreeDOS diskette", async () => {
  // pc-xt was stopped by the previous test; restart briefly
  await page.evaluate(() => K8086.App.loadPreset("pc-xt"));
  await page.waitForTimeout(200);
  await page.click("#btnStart");
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => new Promise(res => {
    const app = K8086.App;
    const fdc = app.doc.components.find(c => c.type === "UPD765");
    K8086.DiskTools.open(app, fdc);
    setTimeout(() => {
      const rows = [...document.querySelectorAll(".dirTable td:first-child")].map(el => el.textContent);
      K8086.closeModal();
      res({ rows });
    }, 300);
  }));
  if (!s.rows.some(r => r.includes("KERNEL.SYS"))) throw new Error("no KERNEL.SYS: " + s.rows.join(","));
  if (!s.rows.some(r => r.includes("FREEDOS"))) throw new Error("no FREEDOS dir");
  await page.click("#btnStart"); // stop
  await page.waitForTimeout(200);
});

await test("serial terminal: banner renders, typing echoes", async () => {
  await page.evaluate(() => K8086.App.loadPreset("uart-lab"));
  await page.waitForTimeout(150);
  await page.click("#btnStart");
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const app = K8086.App;
    K8086.TerminalView.open(app, app.doc.components.find(c => c.type === "COM8250"));
  });
  await page.waitForTimeout(400);
  const banner = await page.evaluate(() => document.querySelector(".termOut").textContent);
  if (!banner.includes("serial console")) throw new Error("no banner in terminal: " + JSON.stringify(banner.slice(0, 50)));
  await page.click(".termIn");
  await page.keyboard.type("ok");
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => document.querySelector(".termOut").textContent);
  if (!after.includes("ok")) throw new Error("echo not rendered: " + JSON.stringify(after.slice(-40)));
  await page.evaluate(() => K8086.closeModal());
  await page.click("#btnStart"); // stop
  await page.waitForTimeout(150);
});

await test("root index.html is the emulator, and the guide sits beside it", async () => {
  const app = await page.evaluate(() => ({
    booted: typeof K8086 !== "undefined" && !!K8086.App.doc,
    guide: (document.getElementById("btnGuide") || {}).title || "",
  }));
  eq(app.booted, true, "the root page IS the tool, not a redirect");
  if (!/illustrated guide/i.test(app.guide)) throw new Error("no guide button");
  await page.goto("file://" + root + "guide/index.html");
  await page.waitForTimeout(300);
  const g = await page.evaluate(() => ({
    title: document.title,
    back: (document.querySelector(".launch") || {}).getAttribute
      ? document.querySelector(".launch").getAttribute("href") : "",
    figs: document.querySelectorAll(".shot, .card").length,
  }));
  if (!/Guide/.test(g.title)) throw new Error("guide title: " + g.title);
  eq(g.back, "../index.html", "the guide links back to the tool");
  if (g.figs < 5) throw new Error("guide home looks empty");
  await page.goto("file://" + root + "index.html");
  await page.waitForTimeout(500);
});

await test("zero console errors across the whole pass", async () => {
  if (errors.length) throw new Error(errors.slice(0, 3).join(" | "));
});

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
