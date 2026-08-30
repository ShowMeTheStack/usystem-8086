# µSystem 8086 — Architecture

A fully static, single-file, browser-based 8086/8088 system simulator for students.
The deliverable is **one `index.html`** (built from this source tree) hostable on GitHub Pages
with no server logic. Everything — BIOS, fonts, presets, boot floppy — is embedded.

## Product decisions (settled)

| Decision | Choice |
|---|---|
| Simulation fidelity | **Two-tier engine**: cycle-accurate CPU always; glue logic compiled for run mode, full pin-level netlist evaluation in step/scope mode. Waveforms are identical in both tiers because they share one bus schedule. |
| Video | **Hercules HGC** (MDA-compatible text + 720×348 mono graphics) on an emulated B&W phosphor CRT. |
| Shipped software | **GLaBIOS** (GPL-3) + minimal **FreeDOS** boot floppy, base64-embedded with licenses. |
| Repo shape | Source tree + `build.mjs` → single self-contained `index.html`. CPU validated in CI against **SingleStepTests/8088** (Daniel Balsom's per-cycle JSON suite). |

## Layered design

```
┌────────────────────────────────────────────────────────────┐
│ UI: canvas editor · code editor · waveform analyzer · CRT  │
├────────────────────────────────────────────────────────────┤
│ Document model: components + connections → netlist + DRC   │
├──────────────────────────┬─────────────────────────────────┤
│ Tier A (accurate)        │ Tier B (fast run mode)          │
│ pin-level netlist eval   │ compiled decode maps,           │
│ every clock edge         │ behavioral peripherals          │
├──────────────────────────┴─────────────────────────────────┤
│ Shared cycle-stepped 8086/8088 core (BIU+EU, prefetch      │
│ queue, T1–T4 bus cycles, wait states) — generator-based    │
├────────────────────────────────────────────────────────────┤
│ Determinism layer: input event log + keyframe snapshots    │
│ → rewind slider, waveform capture of ANY historical window │
└────────────────────────────────────────────────────────────┘
```

## Signal model (Tier A)

- Pin drive values: `NONE` (input / high-Z), `D0`, `D1` (totem-pole), `W1` (weak pull-up),
  open-collector outputs drive `D0` or `NONE`.
- Net resolution: `D0`+`D1` on one net ⇒ **contention** (`X`, runtime strict violation);
  else strong value; else weak pull-up ⇒ `1`; else `Z` (TTL inputs read `Z` as `1`, with a weak warning).
- Engine step = one half-period of the master oscillator (8284A crystal ÷ 3 gives CPU CLK).
- Each step: toggle clock nets → combinational settle loop (chips re-evaluate until stable;
  non-convergence = oscillation ⇒ runtime strict violation) → edge-sensitive chips fire
  (`onEdge`) → settle again.
- Every net's value is sampled into a ring buffer each half-cycle → waveform analyzer,
  hover-a-wire inspection.

## Chip model

Each chip is a `ChipDef`: name, package/pin table (physical pin numbers + names, sides),
`init(state)`, `evaluate(io, state)` for combinational behavior, `onEdge(pin, rising, io, state)`
for clocked behavior, optional `oscillator` (crystal sources), plus metadata
(access time for memories, datasheet blurb for the UI). State must be serializable
(plain objects / typed arrays) to support snapshots and rewind.

## CPU core

One core serves both tiers. The Execution Unit is a JS generator that yields micro-ops:

- `{cycles:n}` — internal EU cycles (EA calc, ALU time)
- `{read/write, space:mem|io, seg, ofs, size}` — BIU schedules a real T1–T4 bus cycle
- queue fetches — EU consumes instruction bytes from the prefetch queue (4 bytes on 8088,
  6 on 8086; 8088 BIU does byte bus cycles, 8086 does word with BHE/A0 steering)

The BIU arbitrates: EU requests preempt prefetch after the current bus cycle; idle `Ti`
states appear when the queue is full. READY inserts `Tw` wait states. In Tier A the pin
wrapper (`chip-8088`) turns the schedule into actual pin drives (ALE, AD mux, RD/WR, IO/M,
DT/R, DEN, INTA); in Tier B the same schedule hits compiled decode maps directly.

Cycle-count ground truth: SingleStepTests/8088 (`tests/singlestep.mjs` downloads and runs it;
not shipped in the HTML). v0.x aims at functional + close timing; the suite drives refinement
to exact per-cycle bus activity.

## Netlist compiler (Tier B)

Static analysis of the combinational glue (74-series decode trees, latches, transceivers)
between each CPU's bus and each memory/IO chip produces: address→chip-select maps per
(space, byte-lane), wait-state profiles, and port maps. Anything it cannot prove
combinational falls back to Tier A evaluation for that subgraph (with a weak warning that
run-mode speed is reduced).

## DRC

**Strict (simulation will not start / halts):** VCC–GND short; two totem-pole outputs on one
net (statically provable) or runtime contention; unpowered chip; CPU CLK/RESET floating;
overlapping decode driving the same data lines; combinational oscillation.

**Weak (warnings, run anyway):** floating TTL inputs (read as 1); OC net without pull-up;
partial address decode (aliasing); memory slower than zero-wait design; READY unconnected;
8088 wired into a 16-bit memory arrangement. Each warning links to a short "why this matters"
explainer.

## Determinism, rewind, waveforms at any cycle

Machine state = f(initial state, input log). Inputs (keystrokes, switch flips, disk swaps)
are logged with cycle timestamps. Keyframe snapshots (full serialized sim) every N cycles.
The timeline slider replays from the nearest keyframe; the waveform analyzer can be pointed
at any historical cycle window — the engine replays that window in Tier A and renders exact
traces. Once running, the canvas is frozen: no edits, connections final; only floppy
eject/swap, HDD attach, and input devices remain live.

## Storage

File System Access API (Chrome/Edge): open a real floppy/HDD image file, read/write in
place. Fallback (Firefox/Safari): file picker in, download out. In-browser FAT12/FAT16
formatter + file transfer into images. No server ever.

## Peripherals (target catalog)

8284A, 8288, 8289, 8282/8283, 8286/8287, 8259A (cascade), 8253/8254, 8255, 8237A,
8250/8251, µPD765 FDC, 6845 CRTC (HGC), XT keyboard, parallel port; SRAM 2114/6116/6264/62256,
EPROM 2716–27256; 74LS 00/02/04/08/32/86/74/138/139/153/157/161/163/244/245/373/374/393;
LEDs, 7-segment (direct + multiplexed), DIP switches, buttons, speaker, crystals.
Multi-CPU: 8086+8088 mixed boards; shared RAM via 8289 arbitration (no coherence, by design).

## Source layout

```
build.mjs          # bundles src/** into index.html at the repo root
dev.html           # loads src files as separate <script> tags for development
src/NN-*.js        # classic scripts attaching to globalThis.K8086, loaded in NN order
tests/load.mjs     # evals src in order under Node for headless tests
tests/*.mjs        # smoke tests, assembler tests, SingleStepTests harness
assets/            # BIOS/font/floppy blobs (base64-embedded at build time)
```
