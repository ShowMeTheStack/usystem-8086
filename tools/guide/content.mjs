// Prose and reference tables for the guide. tools/guide/build.mjs merges this
// with the screenshot manifest produced by tools/guide/shoot.mjs.

export const SITE = {
  name: "µSystem 8086",
  tagline: "The complete guide",
  blurb: "A cycle-accurate 8086/8088 computer you build chip by chip, wire by wire — in one HTML file, with no install, no server and no accounts.",
};

// section id -> page metadata. `intro` is HTML shown under the page title;
// `subs` maps a sub-section name to prose shown above that group of figures.
export const PAGES = {
  overview: {
    nav: "Start",
    title: "Getting started",
    blurb: "What the tool is, what the window contains, and how to get a board running in thirty seconds.",
    intro: `
      <p><strong>µSystem 8086 replaces a hardware trainer kit.</strong> Instead of a fixed board with fixed
      chips, you get the parts: a CPU, a clock generator, memories, decoders, latches, gates, peripheral
      controllers, and the devices that make a computer feel real — a monitor, a keyboard, a speaker, a
      printer, disk drives. You place them, wire them pin to pin, write assembly, and press Start. Every wire
      you draw carries a real logic level; every chip is simulated at its pins.</p>
      <p>Two things make it more than a schematic toy. First, the CPU is <strong>cycle-accurate</strong> and
      passes the complete SingleStepTests/8088 suite — 3,007,000 of 3,007,000 tests exactly, flags included.
      Second, nothing about the board is declared: the address map is <em>discovered</em> by driving your real
      decode gates and watching which chip answers. If you wire it wrong, the tool shows you wrong — the same
      way an oscilloscope would.</p>
      <p class="tip"><strong>Thirty-second start:</strong> pick <em>Minimal 8088 kit</em> in the preset
      dropdown, press <strong>▶ Start</strong>, and watch the LEDs blink. Then press <strong>⏸ Pause</strong>
      and <strong>⭢ insn</strong> to walk the program one instruction at a time.</p>`,
    subs: {
      "The workspace": `<p>The window is five regions: the toolbar across the top, the parts library on the
        left, the schematic canvas in the middle, the panel stack on the right (Code, Debug, CPU, Chip,
        Checks), and the waveform analyzer along the bottom. Every divider drags to resize and double-clicks
        to collapse, so any region can take the whole screen when you need it.</p>`,
      "First run": `<p>Pressing Start runs the design checks, programs the ROMs from the Code tab, proves the
        memory map by probing the netlist, and builds the simulation. From that moment the board is frozen —
        you cannot move a chip while it runs — but switches, buttons, the keyboard and the rewind slider all
        stay live.</p>`,
    },
  },

  canvas: {
    nav: "Canvas",
    title: "The canvas",
    blurb: "Reading a schematic, hovering to probe, bus anatomy, selection, and the no-wire viewing mode.",
    intro: `
      <p>The canvas is a real schematic, not a block diagram. Chips are drawn as DIP outlines with the notch
      at pin 1, pins on the sides the datasheet puts them, and active-low names carrying overbars. Zoom in far
      enough and pin numbers appear; zoom in further and every label is legible.</p>
      <p>Wheel to zoom (about the pointer), drag empty space to pan, and hold <kbd>Alt</kbd> to pan even over
      a chip. Click a pin, then another pin, to wire them. Hold <kbd>Shift</kbd> while clicking a pin and the
      entire numbered family goes across as one bus.</p>`,
    subs: {
      "Reading a schematic": `<p>Everything on screen is drawn from the netlist you built — there is no
        picture file anywhere. Chip bodies scale with their pin count, and a max-mode CPU even relabels its
        dual-function pins (<code>~DEN</code> becomes <code>~S0</code>) the moment you strap
        <code>MN/~MX</code> low.</p>`,
      "Bus anatomy": `<p>Buses are drawn the way a draughtsman draws them. Individual pins leave on curved
        leads, gather at a tap a short distance off the chip body, run as a single straight trunk with sharp
        mitred corners, and fan back out at the far end. The router scores candidate paths against chip bodies
        it would cross and lanes other buses already took, so trunks separate instead of overlapping.</p>
        <p>When a trunk is long enough and you are zoomed in, it carries a classic slash label:
        <code>16 · AD[15:0] = 3F2A</code> — the width, the bus name, and the live value at that instant.</p>`,
      "Hovering": `<p>Hovering is the primary way to answer "what is this connected to?". Hover any pin and
        you get its number and kind, the name of its net, the live logic value, and the full membership of the
        net. At the same time every pin on that net glows, so the signal's reach is visible at a glance.</p>`,
      "Selecting and editing": `<p>Click selects; <kbd>Delete</kbd> removes. Right-click is a two-stage
        delete — the first right-click selects, the second on the same target deletes — so nothing disappears
        by accident. Selecting one lead of a bus selects the whole bundle.</p>`,
      "No-wire mode": `<p><strong>〰 wires</strong> hides every wire while leaving the netlist untouched. On a
        dense board this is the difference between a readable schematic and spaghetti. Click any chip while
        wires are hidden and only that chip's connections are drawn.</p>`,
      "Placing parts": `<p>Click a part in the library, then click the canvas. The moment it lands, the
        autowiring planner looks at the whole board and decides whether it can offer you something — see
        <a href="autowiring.html">Autowiring</a>.</p>`,
    },
  },

  boards: {
    nav: "Boards",
    title: "The 21 boards",
    blurb: "Every shipped design explained in full — the chips, the wiring, the memory map, the program, and the experiments worth running on it.",
    intro: `
      <p>Twenty-one boards ship with the tool. They are not fixtures or screenshots: each one is built
      by code that places real components and wires real pins, so you can open any of them, take it
      apart, rewire it, and save your version. Nine carry a <strong>guided lab</strong> — a numbered
      exercise with steps you tick off as you work.</p>
      <p>Each board below gets the full treatment: what it is and why it is built that way, what every
      significant chip does <em>on this particular board</em>, the address and IO map, what the default
      program actually does, and a set of things worth trying — including several that involve
      deliberately breaking something to watch how it fails.</p>
      <p class="tip"><strong>The experiments are the point.</strong> Reading that a floating TTL input
      reads as logic 1 is one thing; deleting a wire, watching a board go dark, and finding the
      explanation in the Checks tab is another. Most of the “try this” items take under a minute.</p>`,
  },

  chips: {
    nav: "Chips",
    title: "The chip library",
    blurb: "Every modelled part: pinouts, what each one simulates, and the programmer's views that open when you double-click a running chip.",
    gallery: true,
    intro: `
      <p>Parts fall into nine categories — Power, Clock, I/O, Logic, Memory, System, Video, Storage and CPU.
      Each is a real behavioural model evaluated at its pins, not a black box: the '138 decodes, the '373
      latches on the level, the 8259A arbitrates priority and delivers a vector through a real INTA sequence.</p>
      <p>Double-click a chip <em>while the simulation runs</em> and you get its <strong>programmer's
      view</strong>: the register model as bit grids and lamps, live while running and editable while paused.
      That is where you watch an interrupt mask block a request, or a timer's count race downward.</p>`,
    subs: {
      "Programmer's views": `<p>These dialogs are the chip's software interface made visible. Every field is
        the real state the simulation is using — set a bit here while paused and the machine behaves
        differently when you resume.</p>`,
      "Per-chip dialogs": `<p>Double-click a chip while <em>editing</em> instead and you get its properties,
        including the tabular wiring view: every pin with a dropdown of plausible targets, ranked by how
        likely each is for that specific pin. You can wire an entire chip without touching the canvas.</p>`,
    },
  },

  autowiring: {
    nav: "Autowiring",
    title: "Autowiring",
    blurb: "The planner that watches the whole board, offers only designs that are actually completable, and repairs damage you did not mean to do.",
    intro: `
      <p>Wiring an 8088 to a memory chip is twenty-odd wires of pure ceremony: latch the multiplexed address,
      decode a chip select, qualify the strobes. The planner does that ceremony for you — but it is careful
      about <em>when</em> it speaks.</p>
      <p>The rule is simple: <strong>it only ever offers designs that can be completed right now.</strong>
      After every placement it re-examines the entire board and enumerates what has become possible, with the
      new part as the subject or as the missing piece something else was waiting for. If nothing is possible,
      it says nothing — it whispers in the hint bar instead of interrupting you with a dialog that leads
      nowhere.</p>`,
    subs: {
      "Whispers": `<p>A whisper is the hint bar telling you what part would unlock the board. It never
        interrupts, never steals focus, and disappears the moment it stops being true.</p>`,
      "Clocking a CPU": `<p>Clocking is the first real decision on any board, so it gets a proper dialog:
        which CPUs to clock, and for each one <strong>minimum mode</strong> (simple direct bus signals, the
        classic kit arrangement) or <strong>maximum mode</strong> (which creates and wires an 8288 bus
        controller and straps <code>MN/~MX</code> low — the IBM PC arrangement).</p>`,
      "Completing the board": `<p>The moment a CPU comes alive, everything that was waiting for a bus becomes
        possible at once. Rather than twenty separate popups, you get one consolidated dialog listing every
        chip that can be wired now, each with a checkbox and — where there is a choice — a dropdown. The batch
        runs in dependency order, so a floppy controller wired after the interrupt controller automatically
        picks up IRQ 6 and DMA channel 2. The whole batch is a single undo step.</p>
        <p>You can summon the same dialog at any time with <strong>⚡ complete</strong>.</p>`,
      "Repair": `<p>Delete one lane of a live bus and the hint bar says so immediately — seven eighths of a
        data bus is nobody's intention. Press <strong>⚡ complete</strong> and the board is scanned for damage
        by cloning it, re-running each chip's own hookup on the clone, and diffing: <em>the wires it would add
        are exactly the ones missing.</em> Damage that looks accidental arrives pre-ticked; whole connections
        you removed on purpose are offered unticked, because you may have meant it.</p>`,
      "Exact addresses": `<p>When "somewhere in this 128K window" is not good enough, the range calculator
        synthesizes an exact decoder for a base address you choose — then <em>proves</em> it by re-probing the
        netlist and reporting where the chip actually answers.</p>`,
      "Design checks": `<p>Strict violations block the simulation before it starts; weak ones are warnings you
        can run with. Every check comes with an explanation of what a bench technician would see.</p>`,
    },
  },

  running: {
    nav: "Running",
    title: "Running a board",
    blurb: "Start, pause, step by cycle or instruction, rewind through history, and run at real 8088 speed.",
    intro: `
      <p>The speed slider spans ten stops from two steps per second — slow enough to watch a bus cycle
      assemble itself — up to <em>max</em>, where the compiled fast path reaches real 8088 speed. Whatever
      speed you pick, the instruction stream is identical; only the wall-clock pacing changes.</p>`,
    subs: {
      "Watching the CPU": `<p>The CPU panel is the machine's architectural state: registers, segment
        registers, individual flags, the prefetch queue with a live disassembly of what it holds, and the
        current bus cycle. Pause and every field becomes editable — including clicking a flag to toggle
        it.</p>`,
      "Stepping": `<p><strong>⭢ cycle</strong> advances one clock half-step; <strong>⭢ insn</strong> runs
        exactly one instruction. Cycle stepping is how you see a bus cycle for what it is: address out with
        ALE, strobe low, data sampled, strobe high.</p>`,
      "Watching chips": `<p>The Chip panel shows any selected chip's internal state — editable while paused —
        plus a live badge for every pin, colour-coded by logic value.</p>`,
      Turbo: `<p><strong>⚡ turbo</strong> compiles the board's clock tree and batches CPU execution, reaching
        around 5 MHz of simulated 8088. Memory goes through the proved map and IO still goes through real
        pins, so behaviour is bit-identical — the one cost is that waveform capture pauses while turbo is
        engaged.</p>`,
      Rewind: `<p>The rewind slider travels backwards through recorded history. This is not a replay: the
        entire machine — registers, memory, every chip's internal state — returns to how it was, and you can
        run forward again from there.</p>`,
    },
  },

  debugging: {
    nav: "Debugging",
    title: "Debugging",
    blurb: "Source-level breakpoints, assembly-flavoured stepping, watches, memory and IO watchpoints, a cycle-costed trace, and stepping backwards in time.",
    intro: `
      <p>The debugger works at two altitudes at once. You set a breakpoint on a line of your assembly, and
      when it hits you are paused in the same timeline the waveform analyzer is recording — so you can read
      your source line, inspect registers, <em>and</em> scrub the waveforms backwards to watch the bus cycles
      that led there. No hardware trainer can do that.</p>
      <p>Breakpoints are exact, not approximate. A source line is resolved through the <em>proved</em> memory
      map to every physical address where that instruction's byte answers — which matters enormously on kit
      boards, where partial address decoding mirrors your ROM across dozens of windows.</p>`,
    subs: {
      "The editor": `<p>Write 8086 assembly with labels, <code>EQU</code> constants, expressions,
        <code>DB</code>/<code>DW</code>/<code>TIMES</code>, and segment overrides. Errors are reported by line
        number. Assembling programs the board's ROM.</p>`,
      Breakpoints: `<p>Click the gutter for a breakpoint, shift-click for a conditional one. Conditions are
        full expressions — <code>AX==5</code>, <code>CX&gt;2 &amp;&amp; ZF</code>, <code>w[counter]!=0</code> —
        and each breakpoint can also carry a hit count, so you can stop on the 500th pass through a loop.</p>`,
      "The Debug tab": `<p>One pane holds the whole session: stepping controls, watches, breakpoints,
        watchpoints, call stack, live disassembly and the instruction trace.</p>`,
      Stepping: `<p>The labels speak assembly, not C. <strong>⤵ trace</strong> is DEBUG.COM's Trace — one
        instruction, descending into calls. <strong>⤼ over call</strong> is Proceed — a whole
        <code>CALL</code>, <code>INT</code> or <code>REP</code> executed as one step. <strong>⤴ to ret</strong>
        finishes the current subroutine. <strong>▸│ to caret</strong> runs to the cursor line.
        <strong>↩ un-step</strong> un-executes the last instruction.</p>`,
      Watches: `<p>Watch registers (<code>AX</code>, <code>AL</code>), flags (<code>ZF</code>), your own
        labels, and memory dereferences with an explicit size — <code>b[ES:DI]</code>, <code>w[counter]</code>.
        Values show in hex, decimal and character, and flash when a step changes them.</p>`,
      Watchpoints: `<p>This is the feature no real 8086 kit could offer: <strong>break when an address is
        touched.</strong> Set a memory watchpoint on a range and the machine stops on the instruction that
        wrote it, reporting the value. "Who is corrupting my stack?" answers itself. IO watchpoints do the
        same for port accesses. The hook sits inside the CPU's bus generators, so nothing escapes at any
        speed — including turbo.</p>`,
      "Call stack": `<p><code>CALL</code>/<code>RET</code> and every interrupt — software <code>INT</code>,
        hardware IRQ, NMI and single-step traps — are tracked as frames, with the vector shown for interrupt
        frames.</p>`,
      Disassembly: `<p>Paused outside your own source — in the BIOS, or an interrupt handler you did not
        write — the debugger disassembles live from mapped memory. Click any line to set a breakpoint at that
        address.</p>`,
      Trace: `<p>Every retired instruction is recorded with its <strong>exact cycle cost</strong>, so you can
        see for yourself that a <code>MUL</code> costs what the datasheet claims. Interrupt vectors are
        annotated, the register that changed is tagged, clicking a row jumps to its source line, and the whole
        trace exports as text.</p>`,
    },
  },

  waveforms: {
    nav: "Waveforms",
    title: "The waveform analyzer",
    blurb: "A built-in logic analyzer: cycle-accurate square waves, bus lanes with hex values, deep history, and trackpad-native zooming.",
    intro: `
      <p>Every net can be recorded. The analyzer keeps up to 131,072 half-steps of history — roughly 131,000
      clock cycles on a kit board — and lets you scrub through all of it while the simulation keeps running.</p>
      <p>Digital lanes render as true square waves when you are zoomed in far enough to see individual
      transitions. Zoom out past one sample per pixel and the renderer switches to column aggregation: a
      column that saw both a high and a low becomes a solid band. That is what a real oscilloscope shows for a
      signal faster than its timebase, and it is honest in a way that skipping samples is not.</p>`,
    subs: {
      "Reading waves": `<p>Pin lanes show 0, 1, Z and X. Bus lanes are drawn as hexagonal bands with the hex
        value inside, exactly like a commercial analyzer. The name column shows each signal's value at the
        cursor, or now.</p>`,
      Zooming: `<p><strong>↔</strong> scales time from eight cycles across the screen out to the entire
        recording; <strong>↕</strong> scales lane height. On a trackpad, a horizontal pinch zooms and moves
        the slider with it; two-finger horizontal scrolling pans. Plain vertical scrolling is deliberately
        left alone so it never fights the page.</p>`,
      "The cursor": `<p>Click anywhere to drop a time cursor. It reports the half-step and cycle number, and
        every lane reports its value at that moment.</p>`,
      History: `<p>The scrollbar under the canvas spans exactly what has been recorded. Drag it to browse;
        drag it to the right edge to re-attach to live time.</p>`,
      "Adding signals": `<p>Any pin on any chip can be added, and numbered pin families are offered as ready
        made bus groups that become a single hex lane.</p>`,
    },
  },

  memory: {
    nav: "Memory",
    title: "Memory and the address map",
    blurb: "Hex editors at two altitudes, and an address map that is measured from your gates rather than declared.",
    intro: `
      <p>Most simulators ask you to declare where memory lives. This one <strong>measures</strong> it: the
      analyzer drives the CPU's address pins through your real decode gates and records which chip answers,
      for every window in the megabyte. What you see is what your wiring actually does — including the mirrors
      that partial decoding creates, which is exactly the lesson cheap kits taught by accident.</p>`,
    subs: {
      "Unified memory": `<p>One hex editor across the whole address space, writing through the proved map.
        The range dropdown lists every window the prober found, marking aliases and the reset vector.</p>`,
      "Per-chip memory": `<p>Double-click a memory chip for its own bytes, always addressed from zero — the
        chip's point of view, with no knowledge of where the board maps it. Edits to a ROM are kept when you
        press Start; pressing Assemble reclaims it for the code pane.</p>`,
    },
  },

  disks: {
    nav: "Disks",
    title: "Disk images",
    blurb: "FreeDOS media that ships in the file, images you build yourself, and a FAT12 toolchain that runs in the browser.",
    intro: `
      <p>The tool carries a complete FreeDOS 1.3 install floppy, and can <em>synthesize</em> a bootable
      FreeDOS hard disk on demand: it formats a 10.4 MB image with a hand-assembled MBR bootstrap,
      transplants FreeDOS's own boot record, installs the kernel and command interpreter, copies a small DOS
      toolkit into <code>C:\\DOS</code>, and writes a <code>CONFIG.SYS</code> and <code>AUTOEXEC.BAT</code>.
      The result boots to a <code>C:\\&gt;</code> prompt with no floppy in the drive.</p>
      <p>Your own images live in the browser between sessions. You can format blank media, import
      <code>.img</code> files, duplicate the built-ins to get an editable copy, export anything to your
      machine, and populate an image from a folder on your computer — files are copied into the image's FAT
      filesystem with 8.3 name mangling and subfolders preserved.</p>`,
  },

  devices: {
    nav: "Devices",
    title: "Devices",
    blurb: "The monitor, the keyboard, the speaker and the printer — the parts that make a board feel like a computer.",
    intro: `
      <p>Devices are simulated at their signal pins like everything else. The Hercules card scans a real frame
      buffer and drives HSYNC, VSYNC and VIDEO into the monitor; the keyboard shifts scancodes down a serial
      line one bit at a time; the speaker's cone follows a timer output through a gate.</p>
      <p>Double-click the monitor and you get a full phosphor CRT with scanlines, glow and glare — and, when a
      keyboard is on the board, an on-screen XT keyboard docked beneath it. Typing on your real keyboard sends
      genuine scancodes down the wire.</p>`,
  },

  themes: {
    nav: "Themes",
    title: "Themes",
    blurb: "Twenty colour schemes — ten dark, ten light — restyling the IDE, canvas and waveforms without ever lying about physics.",
    gallery: true,
    intro: `
      <p>Themes restyle the interface, the schematic, the wires and the waveforms. What they never restyle is
      physics: an LED stays red, phosphor stays phosphor, a seven-segment display keeps its LED colour. If it
      emits light on a real bench, its colour is not a preference.</p>`,
  },
};

// ------------------------------------------------------------------ reference
export const REFERENCE = {
  title: "Reference",
  blurb: "Every keyboard shortcut, mouse gesture, chip, board, check and grammar in one place.",
  sections: [
    {
      h: "Keyboard shortcuts",
      note: "Debugger keys work everywhere, including while the cursor is in the code editor.",
      table: [["Key", "Action"],
        ["F5", "Continue (or pause, if running)"],
        ["F9", "Toggle a breakpoint on the caret's line"],
        ["F10", "Step over a CALL / INT / REP"],
        ["Ctrl+F10", "Run to the caret line"],
        ["F11", "Step into (one instruction)"],
        ["Shift+F11", "Step out — run until the current subroutine returns"],
        ["Ctrl/Cmd+Z", "Undo"],
        ["Ctrl/Cmd+Shift+Z, Ctrl+Y", "Redo"],
        ["Delete / Backspace", "Delete the selection (edit mode)"],
        ["Escape", "Cancel placement or wiring, close a dialog"],
        ["Any key, while running", "Sent to the board's XT keyboard as a real scancode"]],
    },
    {
      h: "Mouse and trackpad",
      table: [["Where", "Gesture", "Result"],
        ["Canvas", "Wheel", "Zoom about the pointer (0.25×–6×)"],
        ["Canvas", "Drag empty space / middle-drag / Alt+drag", "Pan"],
        ["Canvas", "Click pin, click pin", "Wire two pins"],
        ["Canvas", "Shift+click pin", "Wire the whole numbered family as a bus"],
        ["Canvas", "Drag a chip", "Move it (snaps to the grid)"],
        ["Canvas", "Click a wire / bus trunk", "Select that wire / the whole bundle"],
        ["Canvas", "Right-click, right-click again", "Two-stage delete"],
        ["Canvas", "Double-click a memory chip", "Chip-local hex editor"],
        ["Canvas", "Double-click a running peripheral", "Programmer's view"],
        ["Canvas", "Double-click the monitor", "The CRT window"],
        ["Canvas", "Double-click a chip while editing", "Properties + tabular wiring"],
        ["Canvas", "Hover a pin", "Probe tooltip + net glow"],
        ["Canvas", "Click a switch or button while running", "Actually operate it"],
        ["Waveform", "Pinch / Ctrl+wheel", "Horizontal zoom at the pointer"],
        ["Waveform", "Two-finger horizontal scroll", "Pan through history"],
        ["Waveform", "Drag", "Pan; click without dragging drops the time cursor"],
        ["Gutter", "Click / Shift+click", "Breakpoint / conditional breakpoint"],
        ["Splitters", "Drag / double-click", "Resize / collapse a pane"]],
    },
    {
      h: "Toolbar",
      table: [["Control", "What it does"],
        ["▶ Start / ⏹ Stop", "Run design checks, program ROMs, prove the memory map, build and run the simulation"],
        ["⏸ Pause / ▶ Resume", "Freeze time; pausing also leaves turbo"],
        ["⭢ cycle", "Advance one clock half-step"],
        ["⭢ insn", "Run exactly one instruction"],
        ["speed", "Ten stops: 2, 10, 60, 300, 1500, 8000, 40k, 200k, 1M steps/second, then max"],
        ["⚡ turbo", "Compiled clock tree + batched CPU — real 8088 speed; waveform capture pauses"],
        ["rewind", "Scrub backwards through recorded history"],
        ["↶ ↷", "Undo / redo board edits"],
        ["📖 lab", "The guided exercise for boards that ship one"],
        ["〰 wires", "No-wire viewing mode"],
        ["⚡ complete", "Scan the whole board: offer every possible hookup, and repair missing connections"],
        ["▦ memory", "Unified hex editor across the proved address map"],
        ["🖴 disks", "The disk image library"],
        ["📷 board", "Save the schematic as a PNG"],
        ["theme", "Twenty colour schemes"],
        ["save / load", "Write or restore a complete session as JSON"]],
    },
    {
      h: "Assembler",
      note: "A single-pass 8086 assembler with forward references resolved by fixups.",
      table: [["Feature", "Detail"],
        ["Directives", "ORG, DB (with strings), DW, TIMES n db x, name EQU expr, END/CPU/BITS (ignored)"],
        ["Labels", "name: — letters, digits, _ . @ ? — case-insensitive"],
        ["Numbers", "0x1F, 1Fh, 0b1010, 1010b, decimal, 'c' and \"cc\" character literals, $ for here"],
        ["Operators", "+ - * / ~ and parentheses"],
        ["Size hints", "byte ptr / word ptr; segment overrides es: cs: ss: ds:"],
        ["Addressing", "[bx+si+disp], [bp+di], [si], [di], [bp], [bx], [addr] — all 8086 modes"],
        ["Instructions", "The full 8086 set: ALU groups, shifts/rotates, string ops with REP prefixes, MUL/DIV/IMUL/IDIV, INC/DEC, PUSH/POP, MOV in every form, TEST, XCHG, LEA/LDS/LES, IN/OUT, JMP/CALL near, far and indirect, all sixteen Jcc, LOOP family, INT/IRET/INTO, flag ops, HLT, AAM/AAD/AAA/AAS/DAA/DAS, XLAT, LOCK"],
        ["Output", "Bytes (unwritten holes filled 0xFF), a line→address listing, and a symbol table — both consumed by the debugger"]],
    },
    {
      h: "Watch and condition expressions",
      note: "Used for watches, breakpoint conditions, and watchpoint addresses.",
      table: [["Form", "Example"],
        ["16-bit registers", "AX CX DX BX SP BP SI DI"],
        ["8-bit halves", "AL AH CL CH DL DH BL BH"],
        ["Segment registers, IP, FLAGS", "CS DS ES SS IP FLAGS"],
        ["Flag bits", "CF PF AF ZF SF TF IF DF OF"],
        ["Your labels", "counter, sub1 — from the assembled symbol table"],
        ["Byte / word dereference", "b[0x40], w[counter], [SI] (bare brackets mean a word)"],
        ["Segmented dereference", "w[ES:DI], b[0:0x417]"],
        ["Numbers", "0x1F, 1Fh, 0b1010, 31"],
        ["Arithmetic", "+ - * / % << >>"],
        ["Comparison and logic", "== != < <= > >= && || ! & | ^ ~"]],
    },
    {
      h: "Design checks",
      table: [["Kind", "Meaning"],
        ["Strict", "Blocks Start — a VCC/GND short, two outputs driving one net, a missing required pin"],
        ["Weak", "A warning you can run with — a floating input that reads as 1, a missing pull-up, an unwired output-enable"],
        ["Runtime", "Bus contention and combinational oscillation stop the simulation and explain themselves"]],
    },
    {
      h: "Where things are stored",
      table: [["What", "Where"],
        ["Autosaved session", "localStorage — offered back when you return"],
        ["Theme and pane layout", "localStorage"],
        ["Disk images you create", "IndexedDB, kept between sessions"],
        ["Explicit saves", "A JSON file on your machine: board, program, breakpoints, watches, ROM images"]],
    },
  ],
};
