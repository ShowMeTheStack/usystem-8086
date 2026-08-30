// Loads src/*.js (classic scripts) into globalThis for headless Node testing,
// in the same lexicographic order the build uses.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const { sourceFiles } = await import(join(root, "build.mjs"));

export function loadK({ skipUi = true } = {}) {
  delete globalThis.K8086;
  for (const f of sourceFiles()) {
    if (skipUi && relative(root, f).startsWith("src/4")) continue;
    (0, eval)(readFileSync(f, "utf8"));
  }
  // embedded assets (BIOS ROMs, disk images) for headless tests
  const K = globalThis.K8086;
  K.assets = K.assets || {};
  const adir = join(root, "assets");
  try {
    for (const f of readdirSync(adir))
      if (f.endsWith(".b64")) K.assets[f.replace(/\.b64$/, "")] = readFileSync(join(adir, f), "utf8").trim();
  } catch { /* no assets yet */ }
  return K;
}

// Flat-memory testbench that services the CPU core's bus cycles directly,
// standing in for the pin wrapper. Reads/writes hit a 1MB array; IO is a Map.
export class FlatBench {
  constructor(K, opts) {
    this.cpu = new K.Cpu86(opts);
    this.mem = new Uint8Array(0x100000);
    this.io = new Map();
    this.iolog = [];
  }
  service() {
    const b = this.cpu.bus;
    if (!b || b.serviced || b.t < 3) return;
    b.serviced = true;
    if (b.kind === "w") {
      if (b.sp === "m") {
        this.mem[b.addr] = b.dataOut & 0xFF;
        if (b.word) this.mem[(b.addr + 1) & 0xFFFFF] = (b.dataOut >> 8) & 0xFF;
      } else {
        this.io.set(b.addr, b.dataOut & (b.word ? 0xFFFF : 0xFF));
        this.iolog.push(["w", b.addr, b.dataOut]);
      }
    } else if (b.kind === "inta") {
      b.dataIn = this.intaVector ?? 0xFF;
    } else if (b.sp === "m") {
      b.dataIn = this.mem[b.addr] | (b.word ? this.mem[(b.addr + 1) & 0xFFFFF] << 8 : 0);
    } else {
      b.dataIn = this.io.get(b.addr) ?? 0xFF;
      this.iolog.push(["r", b.addr, b.dataIn]);
    }
  }
  clock() { this.service(); this.cpu.tick(); }
  runInsns(n, maxClocks = 100000) {
    for (let i = 0; i < n; i++) {
      this.cpu.retired = false;
      let guard = 0;
      while (!this.cpu.retired) {
        this.clock();
        if (this.cpu.error) throw new Error("CPU error: " + this.cpu.error);
        if (this.cpu.halted && this.cpu.euBlocked === "halt") return; // HLT
        if (++guard > maxClocks) throw new Error("instruction did not retire");
      }
    }
  }
  load(addr, bytes) { this.mem.set(bytes, addr); }
}

export function eq(actual, expected, msg) {
  if (actual !== expected)
    throw new Error(`${msg}: expected ${expected != null ? expected.toString(16) : expected}, got ${actual != null ? actual.toString(16) : actual}`);
}
