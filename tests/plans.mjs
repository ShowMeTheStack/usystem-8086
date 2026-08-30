// The autoconnect planner matrix: state-driven, order-independent offers.
import { loadK } from "./load.mjs";
const K = loadK();

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok ", name); pass++; }
  catch (e) { console.log("FAIL ", name, "—", e.message); console.log(e.stack.split("\n").slice(1, 3).join("\n")); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const wired = (doc, comp, pin) => {
  const n = K.extractNets(doc).byPin.get(K.pinKey(comp, pin));
  return !!n && n.pins.length > 1;
};

test("CPU placed, no clock on board: zero plans, whisper names the 8284A", () => {
  const doc = K.newDoc();
  K.docAddComponent(doc, "VCC", 2, 2);
  K.docAddComponent(doc, "GND", 2, 6);
  const cpu = K.docAddComponent(doc, "8086", 16, 2);
  const { cards, checklist } = K.connPlans(doc, cpu);
  assert(cards.length === 0 && !checklist, "must be silent: " + cards.length);
  const w = K.connWhispers(doc);
  assert(w.some(x => x.includes("8284A")), "whisper: " + w.join("|"));
});

test("8284A placed after the CPU: checklist appears; min-mode run wires and passes DRC", () => {
  const doc = K.newDoc();
  const cpu = K.docAddComponent(doc, "8086", 16, 2);
  const cg = K.docAddComponent(doc, "8284A", 2, 2);
  const { checklist } = K.connPlans(doc, cg);
  assert(checklist && checklist.rows.length === 1, "one row");
  checklist.run(doc, [{ compId: cpu.id, mode: "min" }]);
  assert(wired(doc, cpu, "CLK") && wired(doc, cpu, "READY"), "clock wired");
  const mn = K.extractNets(doc).byPin.get(K.pinKey(cpu, "MN/~MX"));
  assert(mn.pins.some(p => p.comp.type === "VCC"), "min strap");
  assert(doc.components.some(c => c.type === "XTAL"), "crystal created");
  const drc = K.runDrc(doc);
  assert(drc.strict.length === 0, "strict: " + drc.strict.map(f => f.msg).join(";"));
});

test("maximum mode run creates and wires an 8288", () => {
  const doc = K.newDoc();
  const cpu = K.docAddComponent(doc, "8088", 16, 2);
  const cg = K.docAddComponent(doc, "8284A", 2, 2);
  const { checklist } = K.connPlans(doc, cg);
  checklist.run(doc, [{ compId: cpu.id, mode: "max" }]);
  const ctl = doc.components.find(c => c.type === "8288");
  assert(ctl, "8288 created");
  const byPin = K.extractNets(doc).byPin;
  assert(byPin.get(K.pinKey(cpu, "~DEN")) === byPin.get(K.pinKey(ctl, "~S0")), "status wired");
  const mn = byPin.get(K.pinKey(cpu, "MN/~MX"));
  assert(mn.pins.some(p => p.comp.type === "GND"), "max strap");
});

test("two unclocked CPUs: two checklist rows; one clocked: one row", () => {
  const doc = K.newDoc();
  const a = K.docAddComponent(doc, "8088", 16, 2);
  const b = K.docAddComponent(doc, "8086", 16, 40);
  const cg = K.docAddComponent(doc, "8284A", 2, 2);
  let { checklist } = K.connPlans(doc, cg);
  assert(checklist.rows.length === 2, "two rows");
  checklist.run(doc, [{ compId: a.id, mode: "min" }]);
  ({ checklist } = K.connPlans(doc, K.docAddComponent(doc, "8284A", 2, 40)));
  assert(checklist.rows.length === 1 && checklist.rows[0].compId === b.id, "only the unclocked one");
});

test("CPU placed with clocks present: min+max cards per 8284A, sharing labeled", () => {
  const doc = K.newDoc();
  const a = K.docAddComponent(doc, "8088", 16, 2);
  const cg = K.docAddComponent(doc, "8284A", 2, 2);
  K.connPlans(doc, cg).checklist.run(doc, [{ compId: a.id, mode: "min" }]);
  const b = K.docAddComponent(doc, "8086", 16, 40);
  const { cards } = K.connPlans(doc, b);
  assert(cards.length === 2, "min+max for the one 8284: " + cards.length);
  assert(cards[0].title.includes("shares"), "sharing labeled: " + cards[0].title);
  cards[0].run(doc);
  assert(wired(doc, b, "CLK"), "shared clock wired");
});

test("memory placed: wire-card with a real range description + exact-range card", () => {
  const doc = K.newDoc();
  const cpu = K.docAddComponent(doc, "8088", 16, 2);
  K.autoconnect(doc, cpu, null);
  const ram = K.docAddComponent(doc, "SRAM6264", 50, 2);
  const { cards } = K.connPlans(doc, ram);
  assert(cards.length === 2, "two cards: " + cards.length);
  assert(/[0-9A-F]{5}h/.test(cards[0].desc), "described range: " + cards[0].desc);
  assert(cards[1].action && cards[1].action.rangeCalc, "range-calc card");
  cards[0].run(doc);
  assert(wired(doc, ram, "~CS1"), "wired by card");
});

test("second 8259A offers the cascade-slave plan and it works", () => {
  const doc = K.newDoc();
  const cpu = K.docAddComponent(doc, "8088", 16, 2);
  K.autoconnect(doc, cpu, null);
  doc.wires = doc.wires.filter(w => ![w.a, w.b].includes(K.pinKey(cpu, "INTR")));
  const master = K.docAddComponent(doc, "8259A", 60, 2);
  K.autoconnect(doc, master, cpu);
  const slave = K.docAddComponent(doc, "8259A", 80, 2);
  const { cards } = K.connPlans(doc, slave);
  const cas = cards.find(c => c.title.includes("Cascade"));
  assert(cas, "cascade card offered: " + cards.map(c => c.title).join("|"));
  cas.run(doc);
  const byPin = K.extractNets(doc).byPin;
  const sp = byPin.get(K.pinKey(slave, "~SP/~EN"));
  assert(sp.pins.some(p => p.comp.type === "GND"), "slave strap");
  assert(byPin.get(K.pinKey(slave, "INT")) === byPin.get(K.pinKey(master, "IR2")), "INT to master IR2");
  assert(byPin.get(K.pinKey(slave, "CAS0")) === byPin.get(K.pinKey(master, "CAS0")), "CAS bus");
});

test("reverse cabling: printer→LPT, CRT→HGC, speaker→PIT (both styles)", () => {
  const doc = K.newDoc();
  const cpu = K.docAddComponent(doc, "8088", 16, 2);
  K.autoconnect(doc, cpu, null);
  const lpt = K.docAddComponent(doc, "LPT378", 40, 2);
  K.autoconnect(doc, lpt, cpu);
  const prn = K.docAddComponent(doc, "PRINTER", 60, 2);
  let { cards } = K.connPlans(doc, prn);
  assert(cards.length === 1 && cards[0].title.includes("LPT1"), "printer card");
  cards[0].run(doc);
  assert(wired(doc, prn, "~STROBE"), "handshake cabled");

  K.docAddComponent(doc, "HGC", 40, 30);
  const crt = K.docAddComponent(doc, "CRT", 60, 30);
  ({ cards } = K.connPlans(doc, crt));
  assert(cards.length === 1, "CRT card");
  cards[0].run(doc);
  assert(wired(doc, crt, "VIDEO"), "video cabled");

  const pit = K.docAddComponent(doc, "8253", 40, 50);
  K.autoconnect(doc, pit, cpu);
  const ppi = K.docAddComponent(doc, "8255", 60, 50);
  K.autoconnect(doc, ppi, cpu);
  const spk = K.docAddComponent(doc, "SPKR", 80, 50);
  ({ cards } = K.connPlans(doc, spk));
  assert(cards.length === 2, "OUT0 + XT-style: " + cards.map(c => c.title).join("|"));
  cards[1].run(doc);                       // XT-style: AND gate created
  assert(wired(doc, spk, "IN"), "speaker driven");
  assert(doc.components.some(c => c.type === "74LS08"), "AND created");
});

test("whispers enumerate every near-miss, and clear when satisfied", () => {
  const doc = K.newDoc();
  K.docAddComponent(doc, "PRINTER", 2, 2);
  K.docAddComponent(doc, "CRT", 2, 20);
  K.docAddComponent(doc, "SPKR", 2, 40);
  const w = K.connWhispers(doc);
  assert(w.some(x => x.includes("LPT378")), "printer whisper");
  assert(w.some(x => x.includes("HGC")), "crt whisper");
  assert(w.some(x => x.includes("8253")), "speaker whisper");
  K.docAddComponent(doc, "HGC", 20, 20);
  const w2 = K.connWhispers(doc);
  assert(!w2.some(x => x.includes("HGC")), "crt whisper gone once the card exists");
});

// ---- the expanded planner: every functional chip reacts ---------------------

// a clocked min-mode 8088 board via the CPU recipe (8284A must pre-exist)
function cpuBoard(cpuType = "8088") {
  const doc = K.newDoc();
  K.docAddComponent(doc, "8284A", 2, 2);
  const cpu = K.docAddComponent(doc, cpuType, 16, 2);
  K.autoconnect(doc, cpu, null);
  return { doc, cpu };
}

test("completeness sweep: every functional chip yields a plan; every helper stays silent", () => {
  const base = cpuBoard();
  for (const type of Object.keys(K.chips)) {
    const def = K.chips[type];
    let doc, exp;
    if (K.connIsHelper(type)) {
      doc = structuredClone(base.doc); exp = "silent";
    } else if (def.isCpu || type === "8284A") {
      doc = K.newDoc();                              // partner-free board
      if (def.isCpu) K.docAddComponent(doc, "8284A", 2, 2);
      else K.docAddComponent(doc, "8088", 2, 2);
      exp = "plan";
    } else if (type === "8288" || type === "8289") {
      doc = K.newDoc();                              // max-strapped CPU board
      const cpu = K.docAddComponent(doc, "8086", 16, 2);
      const cg = K.docAddComponent(doc, "8284A", 2, 2);
      K.connPlans(doc, cg).checklist.run(doc, [{ compId: cpu.id, mode: "max" }]);
      if (type === "8288") {                         // remove the auto-created 8288: CPU left max-strapped, unserved
        const ctl = doc.components.find(c => c.type === "8288");
        const keys = new Set(K.chips["8288"].pins.map(p => K.pinKey(ctl, p.name)));
        doc.components = doc.components.filter(c => c !== ctl);
        doc.wires = doc.wires.filter(w => !keys.has(w.a) && !keys.has(w.b));
      }
      exp = "plan";
    } else { doc = structuredClone(base.doc); exp = "plan"; }
    const placed = K.docAddComponent(doc, type, 120, 2);
    const { cards, checklist } = K.connPlans(doc, placed);
    const n = cards.length + (checklist ? 1 : 0);
    if (exp === "silent") assert(n === 0, `${type}: helper must be silent, got ${n} plans`);
    else assert(n >= 1, `${type}: functional chip yielded no plan`);
  }
});

test("HGC placed: bus card wires strobes; '+ add a CRT' variant creates and cables one", () => {
  const { doc } = cpuBoard();
  const hgc = K.docAddComponent(doc, "HGC", 60, 2);
  const { cards } = K.connPlans(doc, hgc);
  const plus = cards.find(c => c.title.includes("add a CRT"));
  assert(plus, "creation variant offered: " + cards.map(c => c.title).join("|"));
  const r = plus.run(doc);
  assert(byTypeCount(doc, "CRT") === 1, "CRT created");
  const crt = doc.components.find(c => c.type === "CRT");
  assert(wired(doc, hgc, "~MEMR") && wired(doc, hgc, "~IOW") && wired(doc, hgc, "A19"), "full bus + strobes");
  assert(wired(doc, crt, "VIDEO") && wired(doc, crt, "HSYNC"), "monitor cabled");
  assert(r.notes.some(n => n.includes("B0000h")), "outcome states the address: " + r.notes.join("|"));
  const drc = K.runDrc(doc);
  assert(drc.strict.length === 0, "strict: " + drc.strict.map(f => f.msg).join(";"));
});

test("CRT placed with a CPU but no HGC: the card is created for it", () => {
  const { doc, cpu } = cpuBoard();
  const crt = K.docAddComponent(doc, "CRT", 60, 2);
  const { cards } = K.connPlans(doc, crt);
  assert(cards.length === 1 && cards[0].title.includes("Add a Hercules"), cards.map(c => c.title).join("|"));
  cards[0].run(doc);
  assert(byTypeCount(doc, "HGC") === 1, "HGC created");
  assert(wired(doc, crt, "VIDEO"), "cabled to this monitor");
  assert(wired(doc, doc.components.find(c => c.type === "HGC"), "D0"), "card on the bus");
});

test("floppy controller: bus card + FreeDOS variant; INT/DRQ picked up when PIC+DMA exist", () => {
  const { doc, cpu } = cpuBoard();
  doc.wires = doc.wires.filter(w => ![w.a, w.b].includes(K.pinKey(cpu, "INTR")));
  const pic = K.docAddComponent(doc, "8259A", 60, 2);
  K.autoconnect(doc, pic, cpu);
  const dma = K.docAddComponent(doc, "8237A", 80, 2);
  K.autoconnect(doc, dma, cpu);
  const fdc = K.docAddComponent(doc, "UPD765", 100, 2);
  const { cards } = K.connPlans(doc, fdc);
  const fd = cards.find(c => c.title.includes("FreeDOS"));
  assert(fd, "FreeDOS variant: " + cards.map(c => c.title).join("|"));
  fd.run(doc);
  assert(fdc.props.imageAsset === "freedos144", "disk inserted");
  const byPin = K.extractNets(doc).byPin;
  assert(byPin.get(K.pinKey(fdc, "INT")) === byPin.get(K.pinKey(pic, "IR6")), "INT on IR6");
  assert(byPin.get(K.pinKey(fdc, "DRQ")) === byPin.get(K.pinKey(dma, "DREQ2")), "DRQ on DMA ch2");
  assert(wired(doc, fdc, "~IOR"), "strobes wired");
});

test("XT keyboard with only a CPU: whole chain created (shift register + 8255)", () => {
  const { doc } = cpuBoard();
  const kbd = K.docAddComponent(doc, "XTKBD", 60, 2);
  const { cards } = K.connPlans(doc, kbd);
  assert(cards.length === 1 && cards[0].title.includes("keyboard chain"), cards.map(c => c.title).join("|"));
  cards[0].run(doc);
  const sh = doc.components.find(c => c.type === "KBDSHIFT");
  const ppi = doc.components.find(c => c.type === "8255");
  assert(sh && ppi, "chain parts created");
  const byPin = K.extractNets(doc).byPin;
  assert(byPin.get(K.pinKey(kbd, "KDATA")) === byPin.get(K.pinKey(sh, "SER")), "serial line");
  assert(byPin.get(K.pinKey(sh, "Q0")) === byPin.get(K.pinKey(ppi, "PA0")), "byte onto port A");
  assert(byPin.get(K.pinKey(ppi, "PB7")) === byPin.get(K.pinKey(sh, "CLR")), "software clear");
  assert(wired(doc, ppi, "~CS"), "PPI got a bus window");
});

test("speaker with only a CPU: a timer is created and drives it", () => {
  const { doc } = cpuBoard();
  const spk = K.docAddComponent(doc, "SPKR", 60, 2);
  const { cards } = K.connPlans(doc, spk);
  assert(cards.length === 1 && cards[0].title.includes("Add an 8253"), cards.map(c => c.title).join("|"));
  cards[0].run(doc);
  const pit = doc.components.find(c => c.type === "8253");
  assert(pit && wired(doc, pit, "~CS"), "timer on the bus");
  const byPin = K.extractNets(doc).byPin;
  assert(byPin.get(K.pinKey(pit, "OUT0")) === byPin.get(K.pinKey(spk, "IN")), "OUT0 into the cone");
  assert(wired(doc, spk, "GND"), "speaker grounded");
});

test("switches with only a CPU: an 8255 is created, read on port B", () => {
  const { doc } = cpuBoard();
  const sw = K.docAddComponent(doc, "SW8", 60, 2);
  const { cards } = K.connPlans(doc, sw);
  assert(cards.length === 1 && cards[0].title.includes("Add an 8255"), cards.map(c => c.title).join("|"));
  cards[0].run(doc);
  const ppi = doc.components.find(c => c.type === "8255");
  const byPin = K.extractNets(doc).byPin;
  assert(byPin.get(K.pinKey(sw, "S3")) === byPin.get(K.pinKey(ppi, "PB3")), "switches on port B");
});

test("two CPUs: the one-per-CPU card replicates the device on both buses", () => {
  const doc = K.newDoc();
  const a = K.docAddComponent(doc, "8088", 16, 2);
  const b = K.docAddComponent(doc, "8088", 16, 60);
  const cg = K.docAddComponent(doc, "8284A", 2, 2);
  K.connPlans(doc, cg).checklist.run(doc, [{ compId: a.id, mode: "min" }, { compId: b.id, mode: "min" }]);
  const pit = K.docAddComponent(doc, "8253", 60, 2);
  const { cards } = K.connPlans(doc, pit);
  assert(cards.some(c => c.title.startsWith("Wire to " + (a.props.ref || a.id))), "pick-one per CPU");
  const each = cards.find(c => c.title.includes("per CPU"));
  assert(each, "one-per-CPU card: " + cards.map(c => c.title).join("|"));
  each.run(doc);
  const pits = doc.components.filter(c => c.type === "8253");
  assert(pits.length === 2, "second timer created: " + pits.length);
  assert(pits.every(p => wired(doc, p, "~CS")), "both on a bus");
});

test("8289 placed by a max-mode CPU: arbitration card wires status and ~AEN gating", () => {
  const doc = K.newDoc();
  const cpu = K.docAddComponent(doc, "8086", 16, 2);
  const cg = K.docAddComponent(doc, "8284A", 2, 2);
  K.connPlans(doc, cg).checklist.run(doc, [{ compId: cpu.id, mode: "max" }]);
  const arb = K.docAddComponent(doc, "8289", 60, 2);
  const { cards } = K.connPlans(doc, arb);
  assert(cards.length === 1 && cards[0].title.includes("Arbitrate"), cards.map(c => c.title).join("|"));
  cards[0].run(doc);
  const ctl = doc.components.find(c => c.type === "8288");
  const byPin = K.extractNets(doc).byPin;
  assert(byPin.get(K.pinKey(arb, "~S0")) === byPin.get(K.pinKey(cpu, "~DEN")), "status into the arbiter");
  assert(byPin.get(K.pinKey(arb, "~AEN")) === byPin.get(K.pinKey(ctl, "~AEN")), "~AEN gates the 8288");
  assert(byPin.get(K.pinKey(arb, "~AEN")) === byPin.get(K.pinKey(cg, "~AEN1")), "~AEN gates the 8284 ready");
  assert(wired(doc, arb, "~BUSY"), "~BUSY pulled up");
});

// ---- the board-wide checkpoint sweep ----------------------------------------

test("sweep: silent while no clocked CPU exists; the user's orphan board completes in one batch", () => {
  const doc = K.newDoc();
  const dma = K.docAddComponent(doc, "8237A", 2, 2);
  const pic = K.docAddComponent(doc, "8259A", 24, 2);
  const ram = K.docAddComponent(doc, "SRAM628512", 46, 2);
  const rom = K.docAddComponent(doc, "EPROM27256", 2, 30);
  const hgc = K.docAddComponent(doc, "HGC", 46, 30);
  assert(K.connSweep(doc, null).length === 0, "no CPU: sweep must stay quiet");
  const cpu = K.docAddComponent(doc, "8088", 80, 2);
  assert(K.connSweep(doc, null).length === 0, "CPU present but unclocked: still quiet");
  const cg = K.docAddComponent(doc, "8284A", 100, 2);
  K.connPlans(doc, cg).checklist.run(doc, [{ compId: cpu.id, mode: "min" }]);
  const rows = K.connSweep(doc, null);
  assert(rows.length === 5, "five orphans offered: " + rows.map(r => r.comp.type).join(","));
  const order = rows.map(r => r.comp.type);
  assert(order.indexOf("8259A") < order.indexOf("SRAM628512"), "system chips before memory: " + order);
  assert(order.indexOf("SRAM628512") < order.indexOf("HGC"), "memory before cards: " + order);
  for (const r of rows) r.plans[0].run(doc);         // dependency order = row order
  for (const [c, p] of [[dma, "~CS"], [pic, "~CS"], [ram, "D0"], [rom, "D0"], [hgc, "~MEMR"]])
    assert(wired(doc, c, p), c.type + " left unwired");
  const drc = K.runDrc(doc);
  assert(drc.strict.length === 0, "strict: " + drc.strict.map(f => f.msg).join(";"));
  assert(K.connSweep(doc, null).length === 0, "everything hooked: sweep empty again");
});

test("sweep: an unclocked second CPU appears as its own row with clock plans", () => {
  const doc = K.newDoc();
  const a = K.docAddComponent(doc, "8088", 16, 2);
  const cg = K.docAddComponent(doc, "8284A", 2, 2);
  K.connPlans(doc, cg).checklist.run(doc, [{ compId: a.id, mode: "min" }]);
  const b = K.docAddComponent(doc, "8086", 16, 40);
  const rows = K.connSweep(doc, b.id);               // exclude the just-placed chip
  assert(rows.length === 0, "exclusion respected");
  const rows2 = K.connSweep(doc, null);
  assert(rows2.length === 1 && rows2[0].comp.id === b.id, "the other CPU is a row");
  assert(rows2[0].plans.some(p => p.title.includes("maximum")), "mode choice preserved");
});

test("sweep: wired chips and range-calc-only options never show up", () => {
  const { doc, cpu } = cpuBoard();
  const ram = K.docAddComponent(doc, "SRAM6264", 60, 2);
  const rows = K.connSweep(doc, null);
  assert(rows.length === 1 && rows[0].comp.id === ram.id, "one orphan");
  assert(rows[0].plans.every(p => !p.action), "batchable plans only");
  K.autoconnect(doc, ram, cpu);
  assert(K.connSweep(doc, null).length === 0, "hooked memory disappears from the sweep");
});

// ---- repairs: dry-run diff finds deleted connections ------------------------

const cutWire = (doc, comp, pin) => {
  const key = K.pinKey(comp, pin);
  const n = doc.wires.length;
  doc.wires = doc.wires.filter(w => w.a !== key && w.b !== key);
  assert(doc.wires.length < n, "nothing to cut at " + key);
};

test("repairs: an intact board reports nothing to fix", () => {
  const { doc, cpu } = cpuBoard();
  const ram = K.docAddComponent(doc, "SRAM6264", 60, 2);
  K.autoconnect(doc, ram, cpu);
  const pic = K.docAddComponent(doc, "8259A", 80, 2);
  K.autoconnect(doc, pic, cpu);
  assert(K.connRepairs(doc).length === 0,
    "clean: " + K.connRepairs(doc).map(r => r.comp.type + ":" + r.pins.join("/")).join(";"));
});

test("repairs: a snipped data lane is found, flagged accidental, and restored", () => {
  const { doc, cpu } = cpuBoard();
  const ram = K.docAddComponent(doc, "SRAM6264", 60, 2);
  K.autoconnect(doc, ram, cpu);
  cutWire(doc, ram, "D3");
  const reps = K.connRepairs(doc);
  assert(reps.length === 1 && reps[0].comp.id === ram.id, "one damaged chip");
  assert(reps[0].pins.includes("D3"), "names the missing lane: " + reps[0].pins.join(","));
  assert(reps[0].accidental === true, "7/8ths of a bus = accident");
  reps[0].run(doc);
  assert(wired(doc, ram, "D3"), "lane restored");
  assert(K.connRepairs(doc).length === 0, "intact again");
});

test("repairs: a deleted strobe is offered but NOT pre-flagged (possibly deliberate)", () => {
  const { doc, cpu } = cpuBoard();
  const pic = K.docAddComponent(doc, "8259A", 80, 2);
  K.autoconnect(doc, pic, cpu);
  cutWire(doc, pic, "~RD");
  const reps = K.connRepairs(doc);
  assert(reps.length === 1 && reps[0].pins.includes("~RD"), "strobe found: " + JSON.stringify(reps.map(r => r.pins)));
  assert(reps[0].accidental === false, "whole connection = maybe deliberate");
  reps[0].run(doc);
  assert(wired(doc, pic, "~RD"), "restored on demand");
});

test("repairs: a cut monitor cable line is found via the surviving lines", () => {
  const { doc, cpu } = cpuBoard();
  const hgc = K.docAddComponent(doc, "HGC", 60, 2);
  const crt = K.docAddComponent(doc, "CRT", 90, 2);
  K.autoconnect(doc, hgc, cpu);                       // cables the CRT too
  cutWire(doc, crt, "HSYNC");
  const reps = K.connRepairs(doc);
  const r = reps.find(x => x.comp.id === crt.id);
  assert(r && r.pins.includes("HSYNC"), "cable damage found: " + JSON.stringify(reps.map(x => [x.comp.type, x.pins])));
  r.run(doc);
  assert(wired(doc, crt, "HSYNC"), "cable restored");
});

test("repairs: deleting the address latch is detected and the glue is rebuilt", () => {
  const { doc, cpu } = cpuBoard();
  const ram = K.docAddComponent(doc, "SRAM6264", 60, 2);
  K.autoconnect(doc, ram, cpu);
  const lat = doc.components.find(c => c.type === "74LS373");
  const keys = new Set(K.chips["74LS373"].pins.map(p => K.pinKey(lat, p.name)));
  doc.components = doc.components.filter(c => c !== lat);
  doc.wires = doc.wires.filter(w => !keys.has(w.a) && !keys.has(w.b));
  const reps = K.connRepairs(doc);
  const r = reps.find(x => x.comp.id === ram.id);
  assert(r, "damaged memory found");
  assert(r.glue > 0, "glue rebuild counted: " + r.glue);
  assert(r.accidental === true, "partial address bus = accident");
  r.run(doc);
  assert(doc.components.some(c => c.type === "74LS373"), "latch recreated");
  assert(wired(doc, ram, "A0"), "low address restored");
  const drc = K.runDrc(doc);
  assert(drc.strict.length === 0, "strict: " + drc.strict.map(f => f.msg).join(";"));
});

function byTypeCount(doc, t) { return doc.components.filter(c => c.type === t).length; }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
