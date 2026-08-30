// FAT12 tooling: format, add, extract, delete — cross-validated against the
// real FreeDOS 1.3 boot image embedded in assets.
import { loadK, eq } from "./load.mjs";

const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const K = loadK();
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + (e.stack || e.message)); }
}

test("parses the real FreeDOS boot image directory", () => {
  const img = K.assetBytes("freedos144");
  const bpb = K.fatInfo(img);
  eq(bpb.bytesPerSect, 512, "sector size");
  eq(bpb.rootEnt, 224, "root entries");
  const list = K.fatList(img);
  const names = list.map(e => e.name);
  if (!names.includes("KERNEL.SYS")) throw new Error("KERNEL.SYS not found in " + names.slice(0, 10).join(","));
  const kernel = list.find(e => e.name === "KERNEL.SYS");
  if (kernel.size < 30000 || kernel.size > 200000) throw new Error("kernel size " + kernel.size);
  // COMMAND.COM lives in the FREEDOS/ subdirectory on the FD13 boot disk
  const sub = list.find(e => e.name === "FREEDOS" && e.dir);
  if (!sub) throw new Error("FREEDOS/ not found");
  const bin = K.fatList(img, sub.cluster).find(e => e.name === "BIN" && e.dir);
  if (!bin) throw new Error("FREEDOS/BIN not found");
  const inner = K.fatList(img, bin.cluster);
  const cmd = inner.find(e => e.name === "COMMAND.COM");
  if (!cmd) throw new Error("COMMAND.COM not in FREEDOS/BIN: " + inner.map(e => e.name).slice(0, 12).join(","));
  const bytes = K.fatExtract(img, cmd);
  if (bytes[0] !== 0x4D && bytes[0] !== 0xE9 && bytes[0] !== 0xEB) throw new Error("COMMAND.COM odd header");
});

test("extracts KERNEL.SYS with a valid header", () => {
  const img = K.assetBytes("freedos144");
  const kernel = K.fatList(img).find(e => e.name === "KERNEL.SYS");
  const bytes = K.fatExtract(img, kernel);
  eq(bytes.length, kernel.size, "extracted size");
  // FreeDOS kernel.sys begins with a jump + "CONFIG" area; check MZ or jump byte
  if (bytes[0] !== 0xEB && bytes[0] !== 0xE9 && bytes[0] !== 0x4D) throw new Error("odd first byte " + bytes[0].toString(16));
});

test("format + add + list + extract round trip (1.44M)", () => {
  const img = K.fatFormat("1.44M");
  eq(img.length, 1474560, "size");
  eq(K.fatList(img).length, 0, "empty after format");
  const payload = new Uint8Array(3000).map((_, i) => (i * 7) & 0xFF);
  const err = K.fatAdd(img, "hello_world.txt", payload);
  eq(err, null, "add ok");
  const list = K.fatList(img);
  eq(list.length, 1, "one file");
  eq(list[0].name, "HELLO_WO.TXT", "8.3 name");
  eq(list[0].size, 3000, "size");
  const back = K.fatExtract(img, list[0]);
  for (let i = 0; i < 3000; i++) if (back[i] !== payload[i]) throw new Error("mismatch at " + i);
});

test("multi-cluster files chain correctly", () => {
  const img = K.fatFormat("360K");
  const payload = new Uint8Array(40000).map((_, i) => (i ^ (i >> 8)) & 0xFF);
  eq(K.fatAdd(img, "BIG.BIN", payload), null, "add");
  const e = K.fatList(img).find(x => x.name === "BIG.BIN");
  const back = K.fatExtract(img, e);
  eq(back.length, 40000, "length");
  for (let i = 0; i < 40000; i += 997) if (back[i] !== payload[i]) throw new Error("mismatch at " + i);
});

test("delete frees space for reuse", () => {
  const img = K.fatFormat("360K");
  const p1 = new Uint8Array(200000);
  eq(K.fatAdd(img, "ONE.DAT", p1), null, "first add");
  const notFit = K.fatAdd(img, "TWO.DAT", p1);
  if (notFit === null) throw new Error("second 200K should not fit on 360K");
  eq(K.fatDelete(img, K.fatList(img)[0]), null, "delete");
  eq(K.fatAdd(img, "TWO.DAT", p1), null, "fits after delete");
  eq(K.fatList(img).filter(e => e.name === "TWO.DAT").length, 1, "listed");
});

test("duplicate names rejected; formatted image mounts as FAT12", () => {
  const img = K.fatFormat("720K");
  eq(K.fatAdd(img, "A.TXT", new Uint8Array(10)), null, "add");
  if (K.fatAdd(img, "A.TXT", new Uint8Array(10)) === null) throw new Error("dup accepted");
  const bpb = K.fatInfo(img);
  eq(bpb.media, 0xF9, "media byte");
  eq(img[510], 0x55, "boot signature");
});


test("HDD: MBR + FAT12 partition, path-aware adds, subdirectories round-trip", () => {
  const img = K.fatFormatHdd();
  assert(img.length === K.HDD_BYTES, "size");
  assert(img[510] === 0x55 && img[511] === 0xAA, "MBR signature");
  assert(img[0x1BE] === 0x80 && img[0x1BE + 4] === 0x01, "active FAT12 partition");
  const part = K.hddPartition(img);
  assert(part && K.fatInfo(part), "partition has a BPB");
  assert(K.fatInfo(part).spc === 8, "4K clusters");
  const data = Uint8Array.from({ length: 5000 }, (_, i) => i & 0xFF);
  assert(K.fatAdd(part, "DOCS/NOTES/HELLO.TXT", data) === null, "path add");
  const root = K.fatList(part);
  const docs = root.find(f => f.name === "DOCS" && f.dir);
  assert(docs, "DOCS created");
  const notes = K.fatList(part, docs.cluster).find(f => f.name === "NOTES" && f.dir);
  assert(notes, "NOTES nested");
  const hello = K.fatList(part, notes.cluster).find(f => f.name === "HELLO.TXT");
  assert(hello && hello.size === 5000, "file entry");
  const back = K.fatExtract(part, hello);
  assert(back.length === 5000 && back.every((b, i) => b === (i & 0xFF)), "content round-trip");
  assert(K.fatAdd(part, "DOCS/NOTES/HELLO.TXT", data) === "file already exists", "dup refused");
});

test("HDD: synthesized FreeDOS system disk has kernel-first layout + toolkit", () => {
  const hdd = K.buildFreeDosHdd(K.assetBytes("freedos144"));
  assert(hdd, "synthesis");
  const part = K.hddPartition(hdd);
  const root = K.fatList(part);
  assert(root[0].name === "KERNEL.SYS" && root[0].cluster === 2, "KERNEL.SYS first + contiguous start");
  for (const need of ["COMMAND.COM", "CONFIG.SYS", "AUTOEXEC.BAT"])
    assert(root.some(f => f.name === need), need);
  const dos = root.find(f => f.name === "DOS" && f.dir);
  const tools = K.fatList(part, dos.cluster).map(f => f.name);
  for (const t2 of ["FDISK.EXE", "FORMAT.EXE", "SYS.COM", "MEM.EXE"])
    assert(tools.includes(t2), t2);
  // boot sector is FreeDOS's code with our BPB
  assert(part[0] === 0xEB, "VBR jump");
  assert(part[13] === 8 && part[21] === 0xF8 && part[36] === 0x80, "BPB patched for HDD");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
