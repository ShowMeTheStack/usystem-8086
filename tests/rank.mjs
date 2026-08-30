// Connection-target ranking: the tabular wiring UI's "clever dropdown order".
import { loadK } from "./load.mjs";
const K = loadK();

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok ", name); pass++; }
  catch (e) { console.log("FAIL ", name, "—", e.message); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };

const { doc, names } = K.presetById("min-8088").build();
const pinOf = (comp, n) => K.chips[comp.type].pins[K.chips[comp.type].pinIndex[n]];
const rank = (comp, n) => K.rankConnTargets(doc, comp, pinOf(comp, n));

test("AD3: sibling wiring dominates — memories and the latch, pin D3 preselected", () => {
  const r = rank(names.cpu, "AD3");
  const top3 = r.slice(0, 3).map(x => x.comp.type);
  assert(top3.includes("EPROM2764") && top3.includes("SRAM6264"), "top3: " + top3.join(","));
  assert(r[0].bestPin === "D3", "bestPin " + r[0].bestPin);
});

test("CLK: the clock generator wins with its CLK pin", () => {
  const r = rank(names.cpu, "CLK");
  assert(r[0].comp.type === "8284A" && r[0].bestPin === "CLK", `${r[0].comp.type}.${r[0].bestPin}`);
});

test("NMI: strap knowledge puts GND first", () => {
  const r = rank(names.cpu, "NMI");
  assert(r[0].comp.type === "GND", "top: " + r[0].comp.type);
});

test("RAM ~CS1: the decode gate ranks first and suggests a free Y output", () => {
  const r = rank(names.ram, "~CS1");
  assert(r[0].comp.type === "74LS00", "top: " + r[0].comp.type);
  assert(/Y$/.test(r[0].bestPin), "bestPin " + r[0].bestPin);
});

test("RAM ~WE: pairs with the CPU's ~WR", () => {
  const r = rank(names.ram, "~WE");
  assert(r[0].comp.type === "8088" && r[0].bestPin === "~WR", `${r[0].comp.type}.${r[0].bestPin}`);
});

test("ALE: transparent latches with their LE pin lead the list", () => {
  const r = rank(names.cpu, "ALE");
  assert(r[0].comp.type === "74LS373" && r[0].bestPin === "LE", `${r[0].comp.type}.${r[0].bestPin}`);
});

test("every component appears exactly once, scores descend", () => {
  const r = rank(names.cpu, "AD0");
  assert(r.length === doc.components.length, "length");
  assert(new Set(r.map(x => x.comp.id)).size === r.length, "dupes");
  for (let i = 1; i < r.length; i++) assert(r[i - 1].score >= r[i].score, "order");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
