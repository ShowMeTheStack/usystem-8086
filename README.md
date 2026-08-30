# µSystem 8086

**It boots FreeDOS.** The PC/XT preset — an 8088, 74LS glue, 8237A DMA, µPD765
floppy, 8259A/8253/8255, Hercules video and an XT keyboard, wired pin by pin on
the canvas — runs GLaBIOS from its EPROM, POSTs, loads the boot sector over DMA
channel 2, and brings FreeDOS 1.3 up on the phosphor CRT.

**CPU core: 100.00% exact on the full SingleStepTests/8088 suite — 3,007,000 test cases,
every documented and undocumented instruction, every trap path, every "undefined" flag
bit matching real silicon** (including microcode-faithful CORD/CORX division and
multiplication, DAA/DAS quirks, SETMO, and the REP-negates-MUL quirk).

A fully static, single-file, cycle-accurate 8086/8088 system simulator for students —
build a computer from period-correct chips on a canvas, assemble real 8086 code, step it
cycle by cycle, probe any wire, and read the waveforms. No server, no install: one
`index.html` on GitHub Pages.

- **Design** — place 8086/8088 CPUs, 8284A clock gens, SRAM/EPROM, 74LS glue, ports,
  LEDs, 7-segment displays; wire pins or whole buses; the DRC flags strict violations
  (VCC–GND shorts, bus contention) and weak ones (floating inputs, partial decode).
- **Run** — assemble your program into an EPROM, press play. Once running, the board is
  frozen; you can only touch what a real operator could: keys, switches, floppies.
- **Probe** — hover any wire for its live value; add any signal or bus to the waveform
  analyzer; step by cycle or by instruction; rewind; export PNGs for your teacher.
- **Boot** (roadmap) — HGC video on a phosphor CRT, XT keyboard, floppy + DMA,
  GLaBIOS → FreeDOS `A:\>`.

## Develop

No dependencies. `node build.mjs` produces `index.html` and refreshes `dev.html`
(which loads `src/` files individually for debugging). Open either in a browser.

```
node build.mjs            # build single-file index.html
node tests/cpu-basic.mjs  # CPU core sanity
node tests/asm-basic.mjs  # assembler round-trips
node tests/sim-board.mjs  # pin-level board integration (boot, blink, IRQ lab)
node tests/memmap.mjs     # netlist memory-map analyzer
node tests/browser.mjs    # full UI pass in headless Chromium (needs playwright-core)
node tests/singlestep.mjs --download   # fetch & run SingleStepTests/8088 (CPU validation)
```

See `ARCHITECTURE.md` for the design, and `guide/` for the illustrated guide.

## License

µSystem 8086 is free software under the **GNU GPL, version 3 or later**. See
`LICENSE` for the full text and `COPYRIGHT` for the notice.

The built `index.html` additionally embeds GLaBIOS (GPL-3), the FreeDOS 1.3 boot
disk (GPL-2+) and public-domain VGA fonts, each verbatim and under its own
license. See `assets/LICENSES.md`.
