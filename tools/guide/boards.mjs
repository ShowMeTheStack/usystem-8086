// Per-board teaching content for the guide. The shooter reads `chips` to
// decide which parts to photograph (keyed by the preset's own `names` map, so
// the pictures and the prose can never drift apart); the builder renders
// everything else. Every "try this" is something you can actually do.

export const BOARDS = {

// ---------------------------------------------------------------- blank ----
"blank": {
  one: "An empty bench.",
  story: `<p>Nothing is placed and nothing is wired. This is where you find out how much of a
    computer you can build from parts, and how much the tool will build for you.</p>
    <p>The planner is watching from the first component you drop. It never interrupts with an offer
    it cannot fulfil — until a design becomes possible, it only whispers in the hint bar.</p>`,
  chips: [],
  map: [],
  program: `<p>A single <code>hlt</code> at <code>org 0xE000</code> — a placeholder until you write
    something.</p>`,
  tries: [
    { t: "Watch the planner think",
      s: `<p>Place an <b>SRAM6264</b> on the empty canvas. Nothing pops up: memory with no CPU cannot
      be wired to anything. Read the hint bar — <i>“place a CPU and I'll offer to wire the memory”</i>.
      Now place an <b>8086</b>. Still no dialog, but the whisper changes: it now wants an 8284A. Place
      the <b>8284A</b> and you finally get a dialog, because a design has become possible.</p>` },
    { t: "Build a working computer in four clicks",
      s: `<p>From that clock dialog, tick the CPU, choose <b>minimum mode</b>, and press <i>Wire
      selected</i>. The instant the CPU has a clock, a second dialog appears offering to wire the RAM
      too — accept it. The planner synthesizes the address latch, the decoder and the qualified
      strobes. Press <kbd>Ctrl</kbd>+<kbd>Z</kbd> once and the entire batch disappears; press it again
      and the clock goes too.</p>` },
    { t: "Make the planner create parts for you",
      s: `<p>On a board that already has a clocked CPU, place a bare <b>CRT</b> monitor. You will be
      offered <i>“Add a Hercules card and cable this monitor”</i> — the video card does not exist yet,
      so the planner creates it, wires it onto the full bus, and runs the sync and video leads across.
      The same happens for a printer with no adapter, a keyboard with no shift register, and a speaker
      with no timer.</p>` },
  ],
},

// -------------------------------------------------------- logic-counter ----
"logic-counter": {
  one: "A clock module, half a ripple counter, four LEDs — and no processor at all.",
  story: `<p>The gentlest board in the set, and the only one with no CPU. A 2 Hz oscillator clocks
    one half of a 74LS393 four-bit ripple counter, and its outputs drive four LEDs. That is the entire
    design.</p>
    <p>It exists to make one idea concrete before any processor appears: a clock edge changes state,
    and state drives a display. Everything else in this tool is that idea repeated at scale.</p>`,
  chips: [["OSC", "OSC clock module, set to 2 Hz — the only thing on this board that moves on its own"],
          ["74LS393", "74LS393 dual four-bit ripple counter; only the first half is used"],
          ["LED8", "LED bar showing QA…QD as a binary count"]],
  map: [],
  program: `<p>None. There is no CPU to run one — the Code tab is unused on this board.</p>`,
  tries: [
    { t: "Count in binary, slowly",
      s: `<p>Press <b>Start</b>. The LEDs count 0–15 and roll over. Because it is a <i>ripple</i>
      counter, the bits do not change together: QA toggles on every clock, QB on every second, and so
      on down the chain.</p>` },
    { t: "See the ripple in the analyzer",
      s: `<p>Add QA, QB, QC and QD to the waveform analyzer (<b>+ signal</b> → the counter → each
      output). Zoom in on a rollover from 7 to 8 and you can see the propagation: QA falls, which
      clocks QB, which falls and clocks QC. Real ripple counters glitch during that cascade, which is
      exactly why synchronous counters exist.</p>` },
    { t: "Change time itself",
      s: `<p>Stop, double-click the oscillator, and set <code>hz</code> to 100. Restart: the low bit
      is now a blur while QD still blinks visibly. The simulation's whole timebase follows the fastest
      clock chip on the board, so this one change alters what a “half-step” means everywhere.</p>` },
    { t: "Break it on purpose",
      s: `<p>Stop and delete the wire from the counter's <code>1CLR</code> pin to GND. Run again and
      open the <b>Checks</b> tab: a floating TTL input reads as logic 1, and an active-high clear held
      high means the counter is permanently reset. The LEDs stay dark. This is the single most common
      beginner's bug on real hardware, and here it explains itself.</p>` },
  ],
},

// ------------------------------------------------------------- min-8088 ----
"min-8088": {
  one: "The classic single-board computer: 8284A, 8088, EPROM, SRAM, one latched output port.",
  story: `<p>This is the board every 1980s trainer kit was, reduced to its bones. An 8284A turns a
    14.31818 MHz crystal into a 4.77 MHz clock, an 8088 runs from an EPROM, an SRAM holds the stack,
    and a single '373 latch drives eight LEDs. Fifteen parts, and a complete computer.</p>
    <p>The interesting part is the <b>partial address decoding</b>. There is no proper decoder: the ROM
    is selected by <code>NAND(A19, memory-cycle)</code> and the RAM by its inverse. One address line
    decides everything, so the ROM answers at <i>every</i> address with A19 high and the RAM at every
    address with A19 low. That is not a simplification for teaching — it is what cheap kits actually
    did, and the mirrors it creates are visible in the memory map.</p>`,
  chips: [["cpu", "8088 CPU in minimum mode — it drives ALE, ~RD, ~WR and IO/~M itself"],
          ["cg", "8284A clock generator: crystal ÷3 → CLK, plus a synchronized RESET and READY"],
          ["latA", "74LS373 address latch — captures AD0-AD7 on ALE, the demultiplexer every 8088 board needs"],
          ["rom", "2764 EPROM holding the program and, at FFFF0, the far jump that starts the machine"],
          ["ram", "6264 SRAM: the stack and variables"],
          ["nand", "74LS00 — the entire address decoder, one gate per chip select"],
          ["port", "74LS373 output port: latches on any IO write, drives the LEDs"],
          ["led", "Eight LEDs — the machine's only output"]],
  map: [["Memory cycle, A19 = 1", "EPROM 2764 (heavily mirrored: only A0-A12 are wired)"],
        ["Memory cycle, A19 = 0", "SRAM 6264 (also mirrored)"],
        ["Any IO write", "The '373 output port — there is no port address decoding at all"],
        ["Reset vector FFFF0", "Inside the ROM: a far jump to F000:E000"]],
  program: `<p>A blinker. It writes <code>55h</code> to the port, delays with a <code>LOOP</code>,
    writes <code>AAh</code>, delays, and jumps back — so the LEDs alternate in a checkerboard.</p>`,
  code: `start:  mov al, 0x55
        out 0x00, al       ; any OUT hits the port latch
        mov cx, 4
d1:     loop d1            ; short delay
        mov al, 0xAA
        out 0x00, al
        mov cx, 4
d2:     loop d2
        jmp start`,
  tries: [
    { t: "Watch one bus cycle assemble itself",
      s: `<p>Start, pause, then press <b>⭢ cycle</b> repeatedly while watching the analyzer. A memory
      read takes four clocks: in T1 the address goes out on AD0-7 and ALE pulses high to latch it; in
      T2 the CPU releases AD and drops <code>~RD</code>; in T3 the ROM drives data back; in T4 the CPU
      samples it. Hover <code>ALE</code> during T1 and watch the '373 capture the low address byte.</p>` },
    { t: "Find the mirrors",
      s: `<p>Open <b>▦ memory</b> and read the range dropdown. The ROM does not appear once — it
      appears many times, marked as aliases, because A13-A18 are not decoded at all. Your 8 KB EPROM
      occupies half a megabyte of address space. Now you know why every kit manual said “the monitor
      lives at F000 — and also at F800, and E000…”.</p>` },
    { t: "Prove the port has no address",
      s: `<p>Change <code>out 0x00, al</code> to <code>out 0x42, al</code> and re-assemble. The LEDs
      blink exactly as before. The port latch is enabled by <code>IO/~M AND NOT ~WR</code> — every IO
      write in the address space hits it. Add a '138 and gate the latch from one of its outputs if you
      want a port that owns an address.</p>` },
    { t: "Break the demultiplexer",
      s: `<p>Stop and delete the wire from the CPU's <code>ALE</code> to the latch's <code>LE</code>.
      Run: the machine dies immediately. Without ALE the latch never captures the low address byte, so
      A0-A7 into ROM and RAM are frozen at whatever was last there — the CPU fetches the same byte
      forever. Press <kbd>Ctrl</kbd>+<kbd>Z</kbd>, or use <b>⚡ complete</b>, which will notice the
      missing connection and offer to restore it.</p>` },
    { t: "Watch the stack move",
      s: `<p>Double-click the SRAM while the program runs and scroll to the top of the chip. Every
      <code>CALL</code> and interrupt pushes there. Add a <code>call</code> to the program and watch
      the return address appear byte by byte.</p>` },
  ],
},

// -------------------------------------------------------------- irq-lab ----
"irq-lab": {
  one: "8259A and 8253 wired PC-style; the CPU sleeps in HLT and is woken by real interrupts.",
  story: `<p>Interrupts are the first thing that feels like magic, so this board makes them visible.
    A 74LS138 carves the IO space into 32-port windows: the LED port at 00h, the 8259A interrupt
    controller at 20h, and the 8253 timer at 40h — the same addresses the IBM PC used.</p>
    <p>The timer's OUT0 goes to the controller's IR0, a button goes to IR1, and the controller's INT
    goes to the CPU's INTR. The program spends its life in <code>HLT</code>. Everything that happens,
    happens because a wire went high.</p>`,
  chips: [["cpu", "8088 — sits in HLT and wakes only for interrupts"],
          ["pic", "8259A interrupt controller at ports 20h/21h, master (~SP/~EN strapped high)"],
          ["pit", "8253 timer at 40h-43h, channel 0 clocked from the 8284A's PCLK"],
          ["io138", "74LS138 IO decoder on latched A5-A7 — eight 32-port windows"],
          ["btnIr", "A push button on IR1, pulled up and inverted"],
          ["led", "The LED port at 00h, showing the interrupt count"]],
  map: [["Ports 00h-1Fh", "Y0 → LED output latch"],
        ["Ports 20h-3Fh", "Y1 → 8259A (A0 from latched Q0, so 20h and 21h)"],
        ["Ports 40h-5Fh", "Y2 → 8253 (A0/A1 latched, so 40h-43h)"],
        ["IR0", "8253 OUT0 — the timer tick"],
        ["IR1", "The push button, through an inverter"],
        ["INTR / ~INTA", "8259A INT → CPU INTR; CPU ~INTA → 8259A"]],
  program: `<p>It installs handlers for vectors 8 and 9, initializes the 8259A with the PC's own ICW
    sequence (base vector 08h), programs timer channel 0 as a mode-3 square wave with divisor 512,
    unmasks IR0 and IR1, enables interrupts, and then does nothing but <code>hlt</code>. The timer
    handler increments BX and shows the low byte on the LEDs; the button handler flashes all eight.</p>`,
  code: `        mov al, 0x13       ; ICW1: edge, single, ICW4 needed
        out 0x20, al
        mov al, 0x08       ; ICW2: vectors 08-0F
        out 0x21, al
        mov al, 0x01       ; ICW4: 8086 mode
        out 0x21, al
        mov al, 0xFC       ; unmask IR0 and IR1
        out 0x21, al
        sti
idle:   hlt
        jmp idle`,
  tries: [
    { t: "See the two-pulse INTA handshake",
      s: `<p>The analyzer already shows INTR and ~INTA on this board. Run for a moment, pause, and
      zoom in on an interrupt. INTR rises; the CPU finishes its instruction and answers with
      <i>two</i> ~INTA pulses. During the second, the 8259A puts the vector number on AD0-7 — read it
      off the bus lane. That byte times four is the address the CPU jumps through.</p>` },
    { t: "Mask an interrupt while it is running",
      s: `<p>Pause and double-click the 8259A. In the IMR grid, set bit 0. Resume: the LEDs stop
      counting because the timer's request is now blocked — but watch the IRR grid, where bit 0 keeps
      lighting up. The request is arriving; the controller is refusing to forward it. Clear the bit and
      the count resumes mid-stride.</p>` },
    { t: "Prove the CPU is genuinely asleep",
      s: `<p>Open the <b>CPU</b> tab while it runs. IP is parked on the <code>hlt</code> and the bus
      shows <i>HALT (waiting for interrupt)</i>. The 8088 is not spinning in a loop — it has stopped
      fetching entirely, and only an interrupt restarts it. Press the IR1 button and watch IP leap
      into the handler and come back.</p>` },
    { t: "Forget the EOI",
      s: `<p>Delete the two lines that write <code>20h</code> to port 20h at the end of the timer
      handler, and re-assemble. The board runs exactly once and then goes quiet forever: without an
      end-of-interrupt the 8259A believes IR0 is still in service and will not deliver another request
      at that level or below. Double-click it and you can see the ISR bit stuck on.</p>` },
    { t: "Change the tick rate",
      s: `<p>Pause, double-click the 8253, and change counter 0's reload value. Resume: the LED count
      speeds up or slows down immediately. The timer is a divider — <code>1.193 MHz ÷ reload</code> —
      which is exactly how the PC produced its 18.2 Hz tick.</p>` },
  ],
},

// ------------------------------------------------------------- max-8088 ----
"max-8088": {
  one: "MN/~MX strapped low: an 8288 decodes the CPU's status lines into separate command strobes.",
  story: `<p>The same blinker as the minimal kit, with the bus plumbing rebuilt. Strapping
    <code>MN/~MX</code> to ground changes what eight of the CPU's pins mean: instead of driving ALE,
    <code>~RD</code>, <code>~WR</code> and <code>IO/~M</code> itself, the 8088 emits a three-bit status
    code on <code>~S2..~S0</code> and lets an <b>8288 bus controller</b> decode it.</p>
    <p>The payoff is separate memory and IO commands — <code>~MRDC</code>, <code>~MWTC</code>,
    <code>~IORC</code>, <code>~IOWC</code> — so no gate is needed to qualify a read as memory or IO.
    The cost is a chip. Notice that the canvas relabels the CPU's pins the moment the strap is in
    place: the tool draws what the pins actually <i>mean</i>.</p>`,
  chips: [["cpu", "8088 with MN/~MX tied low — its pins now carry status, not commands"],
          ["busctl", "8288 bus controller: decodes ~S2..~S0 into ALE and four command strobes"],
          ["latA", "74LS373 latch — now clocked by the 8288's ALE, not the CPU's"],
          ["rom", "2764 EPROM, selected by A19 alone (no IO/~M gating needed)"],
          ["ram", "6264 SRAM at A19 = 0"],
          ["port", "The output port, latched by ~IOWC through an inverter"]],
  map: [["Memory read", "~MRDC → ROM ~OE and RAM ~OE"],
        ["Memory write", "~MWTC → RAM ~WE"],
        ["IO write", "~IOWC → the output port latch"],
        ["Chip selects", "ROM at A19 = 1, RAM at A19 = 0 — no cycle-type gating, the commands separate them"]],
  program: `<p>Identical to the minimal kit's blinker. That is the point: the same software, entirely
    different bus hardware.</p>`,
  tries: [
    { t: "Read the status code",
      s: `<p>Add <code>~S0</code>, <code>~S1</code> and <code>~S2</code> to the analyzer and step by
      cycle. The three bits together name the cycle: 100 is a code fetch, 101 a memory read, 110 a
      memory write, 010 an IO write, 111 passive. The 8288 is a decoder watching those three wires.</p>` },
    { t: "Compare the two boards side by side",
      s: `<p>Put <code>ALE</code> and <code>~MRDC</code> on screen here, then load <i>Minimal 8088
      kit</i> and put <code>ALE</code> and <code>~RD</code> on screen there. Same program, same
      timing, different origin: on the minimal kit those pulses come out of the CPU, here they come out
      of the controller one gate delay later.</p>` },
    { t: "Pull the strap",
      s: `<p>Stop, delete the wire from <code>MN/~MX</code> to GND, and re-run. The CPU is now in
      minimum mode and drives min-mode signals from those pins, but the board is still listening to the
      8288 — which sees garbage status and issues nothing. The machine is silent. Watch the canvas
      relabel the pins the instant the strap disappears.</p>` },
    { t: "See why max mode exists",
      s: `<p>Open the <b>Dual 8088</b> board. Two processors share one memory, which is only possible
      because max mode also gives you <code>~LOCK</code> and lets an 8289 arbiter gate the commands.
      Max mode is not about convenience — it is what makes a multi-master bus possible.</p>` },
  ],
},

// ------------------------------------------------------------ word-8086 ----
"word-8086": {
  one: "A true 16-bit bus: two byte banks, ~BHE and A0 deciding which one is written.",
  story: `<p>The 8086 moves sixteen bits at once, which forces a question the 8088 never has to
    answer: when the program writes a single byte, which half of memory should be enabled? The answer
    is two banks — even addresses on D0-D7, odd on D8-D15 — with the write to each bank gated
    separately.</p>
    <p>Here <code>~WE</code> on the low bank is <code>~WR OR A0</code>, and on the high bank it is
    <code>~WR OR ~BHE</code>. Address bit 0 never reaches the memories at all: the banks are addressed
    by A1 upward, because each holds every <i>other</i> byte.</p>`,
  chips: [["cpu", "8086 in minimum mode — sixteen multiplexed AD lines and a ~BHE pin"],
          ["lat0", "74LS373 latching AD0-AD7"],
          ["lat1", "74LS373 latching AD8-AD15 — an 8086 needs two"],
          ["ramL", "Low bank: even addresses, wired to D0-D7"],
          ["ramH", "High bank: odd addresses, wired to D8-D15"],
          ["or32", "74LS32 gates producing the per-bank write enables from ~WR, A0 and ~BHE"]],
  map: [["Even byte", "A0 = 0, ~BHE = 1 → low bank only"],
        ["Odd byte", "A0 = 1, ~BHE = 0 → high bank only"],
        ["Aligned word", "A0 = 0, ~BHE = 0 → both banks, one bus cycle"],
        ["Chip addressing", "Chip A0 ← system A1, and so on — the banks never see A0"]],
  program: `<p>It writes an aligned word to <code>[0x100]</code>, then a misaligned word to
    <code>[0x103]</code>, then runs the usual blinker. Those two stores are the whole lesson.</p>`,
  code: `        mov word [0x100], 0x1234   ; aligned: ONE bus cycle
        mov word [0x103], 0x5678   ; odd: TWO byte cycles`,
  tries: [
    { t: "Count the cycles for yourself",
      s: `<p>Put <code>ALE</code> and <code>~WR</code> on the analyzer, then step by instruction over
      those two stores. The aligned word produces one ALE pulse and one write. The misaligned word
      produces <i>two</i> — the 8086 splits it into a byte to the high bank and a byte to the low bank
      of the next word. That is the entire performance argument for alignment, visible on a wire.</p>` },
    { t: "Watch ~BHE do its job",
      s: `<p>Add <code>~BHE</code> and <code>A0</code> (from the latch) to the analyzer. During a byte
      write to an even address, ~BHE stays high and only the low bank's ~WE goes active. Hover the high
      bank's <code>~WE</code> pin during that cycle: it never drops. Without that gating, a byte write
      would corrupt its neighbour.</p>` },
    { t: "Corrupt memory on purpose",
      s: `<p>Stop and delete the wire feeding <code>~BHE</code> into its OR gate. That input now floats
      high, which permanently blocks the high bank's writes — odd bytes vanish. Or wire the gate's
      input to ground instead and both banks write on every cycle: now every byte store also destroys
      the byte beside it. Check the result in the unified memory view.</p>` },
    { t: "See the fetch pattern",
      s: `<p>The 8086 prefetches whole words at even addresses only. Watch the AD bus lane during
      instruction fetches — you will see two-byte reads at even addresses, which is why its queue is
      six bytes deep while the 8088's is four.</p>` },
  ],
},

// ------------------------------------------------------------ hgc-8088 ----
"hgc-8088": {
  one: "An 8088 writing characters straight into video memory, with the picture live on the board.",
  story: `<p>No BIOS, no operating system, no driver. The Hercules card owns 32 KB of memory at
    B0000 and a handful of ports at 3B4-3BF, and the program simply stores bytes there. Character,
    attribute, character, attribute — the card scans that memory and turns it into video.</p>
    <p>This board also shows what an “ISA-style” bus looks like on a kit. The card wants separate
    <code>~MEMR</code>, <code>~MEMW</code>, <code>~IOR</code> and <code>~IOW</code>, so four OR gates
    qualify the CPU's <code>~RD</code> and <code>~WR</code> with <code>IO/~M</code> — the cheapest
    possible way to synthesize a card bus from a minimum-mode CPU.</p>`,
  chips: [["hgc", "Hercules card: 32 KB of video RAM at B0000, a 6845-style CRTC, real HSYNC/VSYNC/VIDEO outputs"],
          ["crt", "The monochrome monitor — double-click it for a full phosphor screen"],
          ["or32", "74LS32: four gates turning ~RD/~WR plus IO/~M into the card's four command strobes"],
          ["dec", "74LS138 on A17-A19 — a proper decoder, because the video window must not collide with ROM"],
          ["cpu", "8088 driving the whole address bus into the card: A0-A7 latched, A8-A19 direct"]],
  map: [["B0000-B7FFF", "Video RAM, self-decoded by the card"],
        ["Ports 3B4/3B5", "CRTC index and data registers"],
        ["Port 3B8", "Mode register — video enable, graphics/text, blink"],
        ["00000-1FFFF (Y0)", "SRAM"],
        ["E0000-FFFFF (Y7)", "EPROM"]],
  program: `<p>It points ES at B000, walks a string with <code>lodsb</code>/<code>stosb</code> writing
    each character followed by attribute 07h, then sits in a loop incrementing one character in place
    with a bright attribute so you can see the machine is still alive.</p>`,
  code: `        mov ax, 0xB000
        mov es, ax
        ...
        lodsb              ; character
        stosb
        mov al, 0x07       ; attribute
        stosb`,
  tries: [
    { t: "Write to the screen by hand",
      s: `<p>Run the board, then open <b>▦ memory</b> and go to <code>B0000</code>. Type a byte — say
      <code>41</code> — into the first cell. The letter A appears on the monitor immediately. The next
      byte is its attribute: try <code>0F</code> for bright, <code>70</code> for reverse video,
      <code>01</code> for underline.</p>` },
    { t: "Turn the video off from the port",
      s: `<p>Pause and double-click the HGC. Clear bit 3 of the mode register (3B8) and resume: the
      screen goes black although the memory still holds the text. Set it again and the picture returns
      untouched. That bit is a blanking control, not a clear.</p>` },
    { t: "Watch the scan",
      s: `<p>Add <code>HSYNC</code> and <code>VSYNC</code> to the analyzer. HSYNC is the line rate;
      VSYNC pulses once per frame, and between them the card is walking the frame buffer. Zoom out and
      the frame structure appears as a clean repeating envelope.</p>` },
    { t: "Cut one strobe",
      s: `<p>Stop and delete the wire into the card's <code>~MEMW</code>. Run again: the program's
      stores go nowhere and the screen never fills, but the CPU runs happily — it has no idea its
      writes are being ignored. This is exactly the failure mode that used to eat afternoons with a
      scope, and it takes about ten seconds to find here by hovering the pin.</p>` },
    { t: "Draw with the attribute byte",
      s: `<p>Change the program's attribute from <code>0x07</code> to <code>0x70</code> and
      re-assemble. The whole message becomes reverse video. Attributes are per character cell — the
      entire text-mode colour model of the PC in one byte.</p>` },
  ],
},

// ------------------------------------------------------------ kbd-8088 ----
"kbd-8088": {
  one: "Scancodes travel a serial line, shift into a register, raise IRQ1, and land on screen.",
  story: `<p>The XT keyboard protocol is beautifully primitive: the keyboard drives a clock and a data
    line, and the machine shifts eight bits in. There is no controller chip in the modern sense — just
    a shift register and an interrupt.</p>
    <p>Here the keyboard's KDATA and KCLK feed a '322-style shift register; when eight bits have
    arrived it asserts FULL, which is wired to IR1 on the 8259A. The handler reads the assembled byte
    from the 8255's port A at 60h, acknowledges by pulsing PB7 to clear the register, translates the
    scancode, and writes a character into video memory.</p>`,
  chips: [["kbd", "The XT keyboard itself — type on your real keyboard and these keys depress"],
          ["kbshift", "Shift register: eight serial bits in, a parallel byte out, FULL when ready"],
          ["ppi", "8255 at 60h — port A reads the scancode, PB7 acknowledges it"],
          ["pic", "8259A: FULL arrives on IR1, the PC's keyboard interrupt"],
          ["hgc", "Hercules card — where the typed characters end up"],
          ["crt", "The monitor; double-click it to get the on-screen keyboard too"]],
  map: [["Ports 20h/21h", "8259A"],
        ["Ports 60h-63h", "8255 — 60h port A (scancode), 61h port B (PB7 = acknowledge), 63h control"],
        ["IR1", "Shift register FULL"],
        ["B0000", "Video RAM"]],
  program: `<p>It initializes the 8259A and the 8255, unmasks only IR1, prints a banner, and halts.
    Everything after that happens in the interrupt handler: read 60h, pulse the acknowledge, ignore
    break codes (bit 7 set), translate through a scancode table, write character plus attribute to
    video memory, advance the cursor, and handle Return by rounding up to the next row.</p>`,
  code: `kb_isr: in  al, 0x60      ; the assembled scancode
        mov al, 0x80
        out 0x61, al      ; pulse PB7 to clear the shift register
        xor al, al
        out 0x61, al`,
  tries: [
    { t: "Watch a keystroke bit by bit",
      s: `<p>Add <code>KCLK</code> and <code>KDATA</code> to the analyzer, run the board, and press one
      key. Zoom in: eight clock pulses, with data valid on each. You are looking at a single scancode
      crossing a wire one bit at a time, at roughly 16 kHz.</p>` },
    { t: "Type on the real thing",
      s: `<p>Double-click the monitor. The CRT window opens with an on-screen XT keyboard docked
      beneath it, and physical typing is captured too. Watch the keys depress on the schematic symbol
      as you type — the drawing is live.</p>` },
    { t: "Forget to acknowledge",
      s: `<p>Delete the two <code>out 0x61</code> instructions from the handler and re-assemble. The
      first keystroke works; the second never arrives. The shift register is still full, so it will not
      accept another byte and FULL never falls, so IR1 never edges again. One missing pulse, one dead
      keyboard.</p>` },
    { t: "Read the scancode table",
      s: `<p>Scancodes are positional, not alphabetical: Q is 10h because of where it sits on the
      keyboard. Find <code>sctab</code> in the program — that is the translation table every PC BIOS
      has carried since 1981.</p>` },
  ],
},

// ------------------------------------------------------------ uart-lab ----
"uart-lab": {
  one: "Polled serial IO exactly as a BIOS did it: check the status bit, then move a byte.",
  story: `<p>An 8250 UART card sits at 3F8h and decodes itself, so the board needs no IO decoder at
    all — only gates to qualify the CPU's read and write strobes as IO cycles. Everything else is
    software.</p>
    <p>The program never uses an interrupt. It polls the Line Status Register: bit 5 says the
    transmitter is empty, bit 0 says a byte has arrived. That is how <code>INT 14h</code> worked, and
    it is the simplest correct way to drive a serial port.</p>`,
  chips: [["com", "8250 UART, self-decoding at 3F8h-3FFh, with a live terminal behind a double-click"],
          ["or32", "74LS32 qualifying ~RD/~WR into ~IOR/~IOW for the card"],
          ["cpu", "8088 — full A0-A9 into the card so it can decode its own address"]],
  map: [["3F8h", "Data register (or divisor low, when DLAB is set)"],
        ["3F9h", "Interrupt enable (or divisor high)"],
        ["3FBh", "Line control — 8N1, and the DLAB bit"],
        ["3FDh", "Line status — bit 5 transmit empty, bit 0 data ready"]],
  program: `<p>It sets DLAB, writes divisor 12 for 9600 baud, clears DLAB with 8N1, prints a banner,
    then echoes forever: poll for a received byte, send it back, and add a line feed after a carriage
    return.</p>`,
  code: `putc:   mov dx, 0x3FD
w1:     in  al, dx
        test al, 0x20      ; transmitter empty?
        jz  w1
        mov dx, 0x3F8
        out dx, al
        ret`,
  tries: [
    { t: "Talk to it",
      s: `<p>Run the board and double-click the COM card. A green phosphor terminal opens with the
      banner already printed. Type: the 8088 is polling, sees your byte, and echoes it. You are the
      other end of a serial cable.</p>` },
    { t: "Change the baud rate mid-flight",
      s: `<p>Pause, double-click the UART, and change the baud divisor. The programmer's view shows the
      resulting rate — <code>1843200 ÷ (16 × divisor)</code>. Divisor 12 gives 9600; try 96 for 1200.
      Nothing else on the board changes.</p>` },
    { t: "Remove the polling",
      s: `<p>Delete the <code>test al, 0x20</code> / <code>jz</code> pair so the program writes without
      waiting. It still appears to work here, because the model's transmitter is always ready — which
      is a good moment to notice that a simulator can be kinder than hardware. On a real 8250 at 1200
      baud, that loop is the only thing preventing dropped characters.</p>` },
    { t: "Watch an IO cycle",
      s: `<p>Add <code>~IOR</code> and <code>~IOW</code> (the gate outputs) to the analyzer. Every
      poll of the status register is a full bus cycle — you can literally count how much of the CPU's
      life is spent asking “are you ready yet?”. That is the argument for interrupts, in picture form.</p>` },
  ],
},

// --------------------------------------------------------------- pc-xt ----
"pc-xt": {
  one: "A complete XT-class machine, wired chip by chip, that POSTs and boots FreeDOS.",
  story: `<p>This is the whole thing: an 8088, DMA controller, interrupt controller, timer, PPI,
    floppy controller, XT-IDE fixed disk, serial port, Hercules video, keyboard and speaker — thirty
    parts on one canvas, wired the way IBM wired them. GLaBIOS runs from the EPROM, POSTs the machine,
    reads the boot sector over DMA channel 2, and FreeDOS 1.3 comes up on the phosphor.</p>
    <p>Nothing here is a shortcut. The floppy controller really moves sectors through the 8237's
    channel 2. The keyboard really shifts bits. The POST beep really comes from timer channel 2 gated
    by a PPI bit through an AND gate into the speaker. If you can find it in a technical reference
    manual, it is on this canvas.</p>`,
  chips: [["cpu", "8088 at 4.77 MHz — the machine's whole reason for existing"],
          ["dma", "8237A DMA controller at 00h; page registers at 80h, where POST codes appear"],
          ["pic", "8259A at 20h — IRQ0 timer, IRQ1 keyboard, IRQ4 serial, IRQ6 floppy"],
          ["pit", "8253 at 40h: channel 0 the system tick, channel 1 DRAM refresh, channel 2 the speaker"],
          ["ppi", "8255 at 60h — keyboard port, speaker gate, and the configuration switches"],
          ["fdc", "µPD765 floppy controller at 3F0h with the FreeDOS diskette in the drive"],
          ["ide", "XT-IDE fixed disk card at 300h"],
          ["hgc", "Hercules video card"],
          ["rom", "GLaBIOS in an EPROM at F000"],
          ["xubrom", "The XT-IDE option ROM in its own 16 KB window at D0000"],
          ["ram", "512 KB of SRAM from 00000"],
          ["spkr", "The speaker: PIT OUT2 ANDed with PPI PB1"]],
  map: [["00000-7FFFF", "512 KB RAM"],
        ["B0000-B7FFF", "Hercules video RAM"],
        ["D0000-D3FFF", "XT-IDE option ROM (a second '138 carves this out of the C0000 window)"],
        ["E0000-FFFFF", "GLaBIOS"],
        ["Ports 00h / 80h", "8237A DMA / page and POST registers"],
        ["Ports 20h, 40h, 60h", "8259A, 8253, 8255"],
        ["Ports 300h, 3F0h, 3F8h", "XT-IDE, floppy, COM1"]],
  program: `<p>None — and that is the point. The Code tab is unused; this machine runs its own BIOS
    out of ROM exactly like the real thing. POST, then <code>INT 19h</code>, then the boot sector at
    0000:7C00, then FreeDOS.</p>`,
  tries: [
    { t: "Boot it",
      s: `<p>Press <b>Start</b>, then <b>⚡ turbo</b>, and wait. GLaBIOS POSTs, counts memory, finds
      the drives, and loads FreeDOS. Then type at it — your keystrokes travel the serial keyboard
      protocol into IRQ1 exactly like every other key on this board.</p>` },
    { t: "Read the POST codes",
      s: `<p>Double-click the 8237A while it boots. The first field is <b>POST code (port 80h)</b> —
      the same port real machines put on a diagnostic card. Watch it step through the BIOS's checkpoints
      as the machine comes up.</p>` },
    { t: "Watch DMA move a sector",
      s: `<p>Double-click the floppy controller while DOS is listing a directory. The sector counters
      climb and the track number moves. Now double-click the 8237A: channel 2's address and count
      registers are being decremented by the transfer. The CPU is not copying those bytes — the DMA
      controller is.</p>` },
    { t: "Hear the beep",
      s: `<p>The POST beep is not a sound file. Timer channel 2 generates a square wave, PPI port B bit
      1 gates it through an AND gate, and the result drives the speaker cone. Double-click the speaker
      to see the measured frequency and to actually listen.</p>` },
    { t: "Change the machine's configuration",
      s: `<p>The DIP switch pack tells the BIOS what hardware is installed. Flip a switch while the
      machine runs, then reset it: the POST reports a different configuration. That is what those
      switches did on a real motherboard.</p>` },
    { t: "Boot something else",
      s: `<p>Open <b>🖴 disks</b>, import your own <code>.img</code>, and insert it. Or attach the
      synthesized FreeDOS hard disk and boot with no floppy at all — the tool builds that image on
      demand, MBR and all.</p>` },
  ],
},

// ----------------------------------------------------------- dual-8088 ----
"dual-8088": {
  one: "Two processors, one memory, and an arbiter deciding who owns the bus.",
  story: `<p>Two complete 8088 clusters — each with its own clock, 8288 controller, 8289 arbiter,
    latch and buffers — share a single ROM and RAM. Only one may drive the shared bus at a time, and
    the 8289s decide between them using an open-collector <code>~BUSY</code> line and a priority chain.</p>
    <p>There is no cache, no coherence protocol, no memory barrier. There is a bus, and a rule about
    who may use it. Both processors boot the same ROM and race for a claim byte with a single
    <code>XCHG</code> — which is atomic only because the CPU asserts <code>~LOCK</code> and the arbiter
    honours it.</p>`,
  chips: [["acpu", "Processor A — top priority in the arbitration chain"],
          ["aarb", "8289 arbiter A: ~BPRN grounded, so it wins ties"],
          ["actl", "8288 A — its commands are gated by the arbiter's ~AEN"],
          ["bcpu", "Processor B — takes the bus only when A releases it"],
          ["barb", "8289 arbiter B, its ~BPRN fed from A's ~BPRO"],
          ["ram", "The shared SRAM both processors write into"],
          ["led", "The output port showing whichever counter was updated last"]],
  map: [["Shared A15 = 0", "ROM"],
        ["Shared A15 = 1", "RAM"],
        ["[0010]", "The claim byte, taken with a locked XCHG"],
        ["[0020] / [0022]", "Processor 1's counter and processor 2's counter"]],
  program: `<p>Both CPUs run the same code. Each does <code>xchg al, [0x10]</code> with AL = 1; the
    processor that reads back a zero is “first” and takes counter [0020], the other takes [0022]. Then
    both increment their own counter forever and write the low byte to the LED port.</p>`,
  code: `        mov al, 1
        xchg al, [0x10]    ; atomic claim — the CPU asserts ~LOCK here
        mov si, 0x22
        or  al, al
        jnz go
        mov si, 0x20
go:     inc word [si]`,
  tries: [
    { t: "Watch the bus change hands",
      s: `<p>Put both arbiters' <code>~AEN</code> lines and the shared <code>~BUSY</code> on the
      analyzer. Exactly one ~AEN is low at any moment, and ~BUSY is low whenever anyone holds the bus.
      Zoom in on a handover: one processor releases, there is a short exchange gap, and the other takes
      over. That gap is deliberate — it is what stops the higher-priority CPU from starving the other.</p>` },
    { t: "Find ~LOCK",
      s: `<p>Add <code>~LOCK</code> to the analyzer and find the <code>XCHG</code> at startup. The line
      drops for the duration of the exchange, which pins the bus across the idle gap in the middle of
      the instruction. Without it, the other processor could slip in between the read and the write and
      both would believe they were first.</p>` },
    { t: "Prove fairness",
      s: `<p>Double-click each 8289 while it runs and compare the grant counts. They stay close, even
      though arbiter A has strict priority. Fairness comes from the exchange cooldown, not from luck.</p>` },
    { t: "See why locks exist",
      s: `<p>Open the unified memory view at <code>00020</code>. Two counters, two processors, one
      memory, incrementing independently. Now imagine both incrementing the <i>same</i> word: read,
      add, write from two masters with no lock loses updates. This board is the smallest complete
      demonstration of why that is a hard problem.</p>` },
  ],
},

// ------------------------------------------------------- traffic-8255 ----
"traffic-8255": {
  one: "An 8255 drives a traffic light — and the whole board was wired by the planner.",
  story: `<p>A deliberately small application board. Its real subject is the 8255 PPI: three ports
    whose direction you choose by writing a control word, which is how almost every 1980s peripheral
    was attached to a bus.</p>
    <p>It is also a demonstration of the autowiring planner. The CPU, ROM, RAM and PPI were all placed
    and wired automatically — the only hand wiring is the three LEDs on port A.</p>`,
  chips: [["ppi", "8255 PPI — port A configured as output, driving the lamps"],
          ["led", "Three of the eight LEDs: red, amber, green"],
          ["cpu", "8088, autoconnected to its clock and ROM"],
          ["rom", "2764 EPROM holding the sequence"]],
  map: [["Ports 60h-63h", "8255 (A0/A1 select the port; 63h is the control register)"],
        ["Control word 80h", "Mode 0, all ports output"],
        ["PA0/PA1/PA2", "Red, amber, green"]],
  program: `<p>Write 80h to the control register, then loop through the light sequence: red, red+amber,
    green, amber — each held for a delay.</p>`,
  code: `        mov al, 0x80
        out 0x63, al       ; mode 0, all ports out
loop:   mov al, 1          ; red
        call show
        mov al, 3          ; red + amber
        call show
        mov al, 4          ; green
        call show`,
  tries: [
    { t: "Watch the control word take effect",
      s: `<p>Pause and double-click the 8255. The control register is decoded for you into port
      directions. Change it to <code>90h</code> (port A becomes an input) and resume: the lamps freeze,
      because an input port does not drive anything. The program is still writing — the chip is simply
      no longer listening.</p>` },
    { t: "Drive the lamps by hand",
      s: `<p>Pause and edit the port A latch directly in the programmer's view. The lights follow
      immediately. You are doing exactly what an <code>OUT</code> instruction does, without a CPU.</p>` },
    { t: "See what the planner built",
      s: `<p>Nothing here was wired by hand except the LEDs. Look at the address latch and the IO
      decoder: press <b>⚡ complete</b> and it reports nothing left to do, because the board is already
      complete. Then delete the decoder and press it again — the planner will rebuild it.</p>` },
  ],
},

// ---------------------------------------------------------- dip-echo ----
"dip-echo": {
  one: "The simplest possible input port: one buffer, no address decoding at all.",
  story: `<p>An input port is a tri-state buffer that drives the data bus when the CPU reads. That is
    the entire idea, and this board is that idea with nothing added: a '244 whose enables are
    <code>~RD OR NOT IO/~M</code>, so it answers <i>every</i> IO read in the address space.</p>
    <p>Output is the mirror image: a '373 latching on every IO write. Two chips, zero decoders, and a
    complete input-and-output machine.</p>`,
  chips: [["sw", "Eight DIP switches — flip them while the simulation runs"],
          ["inbuf", "74LS244 buffer gating the switches onto AD0-AD7 during any IO read"],
          ["port", "74LS373 latching AD0-AD7 on any IO write"],
          ["led", "The LEDs, showing what was latched"]],
  map: [["Any IO read", "The '244 drives the bus — every port address returns the switches"],
        ["Any IO write", "The '373 latches — every port address writes the LEDs"]],
  program: `<p>Three instructions, forever: read a byte, write it back out, jump.</p>`,
  code: `loop:   in  al, 0          ; the '244 answers every IO read
        out 0, al          ; the '373 latches every IO write
        jmp loop`,
  tries: [
    { t: "Close the loop with your hands",
      s: `<p>Run the board and click the switches on the canvas. The LEDs follow instantly, because the
      CPU is reading and writing thousands of times a second. You are inside the loop.</p>` },
    { t: "Prove there is no address",
      s: `<p>Change <code>in al, 0</code> to <code>in al, 0x99</code> and re-assemble. It still works.
      Then add a '138, wire the buffer's enable to one of its outputs, and suddenly the port has an
      address and only one <code>IN</code> reaches it. That difference — a gate versus a decoder — is
      the entire subject of address decoding.</p>` },
    { t: "Watch the bus turn around",
      s: `<p>Add the AD bus lane and <code>~RD</code> to the analyzer. During the read, the CPU stops
      driving AD and the '244 takes over. That handover is what tri-state outputs are for, and hovering
      the bus during a read shows exactly who is driving it.</p>` },
    { t: "Create a contention",
      s: `<p>Wire the '244's enable permanently to ground so it always drives the bus. Now start: the
      simulation stops with a <b>bus contention</b> report, because the buffer and the CPU are both
      driving the same wires. On a real board that is a hot chip and a mystery; here it is a message
      naming the net.</p>` },
  ],
},

// -------------------------------------------------------- seg7-count ----
"seg7-count": {
  one: "A seven-segment digit, decoded entirely in software from a table.",
  story: `<p>A seven-segment display has no intelligence: it is seven LEDs in the shape of a figure
    eight. Turning “3” into the right pattern is the program's job, and the classic answer is a
    lookup table — one byte per digit, one bit per segment.</p>
    <p>This board is that table plus a '373 output port. It is worth doing once, because after this
    every mention of a “decoder driver” chip makes sense: those chips exist to move this table into
    hardware.</p>`,
  chips: [["seg", "Common-cathode seven-segment digit — segments a…g plus the decimal point"],
          ["port", "74LS373 output port latching on any IO write"],
          ["cpu", "8088 walking the segment table"]],
  map: [["Any IO write", "The '373 → the display segments"],
        ["Bit order", "Q0…Q7 → a, b, c, d, e, f, g, dp"]],
  program: `<p>Walk a ten-entry table, writing each pattern to the port with a delay, then start
    again.</p>`,
  code: `table:  db 0x3F, 0x06, 0x5B, 0x4F, 0x66
        db 0x6D, 0x7D, 0x07, 0x7F, 0x6F`,
  tries: [
    { t: "Decode the table by hand",
      s: `<p><code>0x3F</code> is 0011 1111 — segments a through f on, g off. That is a zero.
      <code>0x06</code> is just b and c: a one. Work out two or three of them and the table stops being
      magic numbers.</p>` },
    { t: "Invent a character",
      s: `<p>Add an entry to the table. <code>0x77</code> is an A; <code>0x79</code> is an E;
      <code>0x40</code> is a bare minus sign. Extend the loop's compare and watch your character appear
      in the sequence.</p>` },
    { t: "Light the decimal point",
      s: `<p>OR every table entry with <code>0x80</code>. The decimal point comes on for every digit —
      because it is simply bit 7 of the same byte, wired to one more LED.</p>` },
    { t: "Break the common cathode",
      s: `<p>Delete the wire from the display's <code>CC</code> pin to ground. Every segment goes dark
      at once, no matter what the port drives: with no return path, none of the LEDs can conduct. It is
      the most obvious thing in the world once you have seen it fail.</p>` },
  ],
},

// -------------------------------------------------------- wait-state ----
"wait-state": {
  one: "Three flip-flops that make the CPU wait — the classic wait-state generator.",
  story: `<p>Fast processors and slow memories have always coexisted by making the processor wait.
    The 8088 samples <code>READY</code> during T3; if it is low, it inserts a Tw state and looks
    again. Something has to pull READY low at the right moment and release it a known number of clocks
    later.</p>
    <p>The classic answer is a shift register: ALE clears the chain at the start of every bus cycle,
    and each clock marches a 1 one stage further along. Take READY from the third stage and every
    cycle is one clock longer. This board is exactly that, built from three '74 flip-flops.</p>`,
  chips: [["ws1", "74LS74 — the first two stages of the wait chain"],
          ["ws2", "74LS74 — the third stage; its Q drives the 8284A's RDY1"],
          ["8284A", "8284A: it synchronizes RDY1 into the CPU's READY"],
          ["cpu", "8088 — its ALE clears the chain at the start of every bus cycle"]],
  map: [["ALE (inverted)", "Clears all three flip-flops"],
        ["CLK", "Clocks the chain"],
        ["Stage 3 Q", "→ 8284A RDY1 → CPU READY"],
        ["~AEN1", "Grounded — an unused arbiter enable must be tied low to arm RDY1"]],
  program: `<p>The same blinker as the minimal kit. Identical software, measurably slower machine.</p>`,
  tries: [
    { t: "See the extra T-state",
      s: `<p>Put <code>CLK</code>, <code>ALE</code> and <code>READY</code> on the analyzer and zoom
      into one bus cycle. READY dips low after ALE and comes back one clock later, and the cycle takes
      five clocks instead of four. That extra clock is Tw.</p>` },
    { t: "Measure the cost",
      s: `<p>Count clocks between two ALE pulses here, then load the <b>Minimal 8088 kit</b> and count
      again. Same program, same instructions, roughly 25% more time. That is what a wait state costs,
      and why fast memory was worth paying for.</p>` },
    { t: "Change the number of waits",
      s: `<p>Move the wire feeding RDY1 from the third flip-flop's Q to the second: one fewer wait
      state, and the machine speeds up. Take READY from the first stage and you are back to zero waits.
      This is a hardware setting you can dial with one wire.</p>` },
    { t: "Remove READY entirely",
      s: `<p>Delete the wire into RDY1 and run. The 8284A's READY defaults high when nothing is wired
      to it — deliberately, so minimal boards work with no wait-state logic at all — and the machine
      runs at full speed again. Then ground RDY1 instead: READY never comes up, the CPU waits forever
      in Tw, and the board hangs mid-cycle. Both failure modes, one wire apart.</p>` },
  ],
},

// --------------------------------------------------------- mixed-cpu ----
"mixed-cpu": {
  one: "An 8086 and an 8088 sharing one word-wide bus — and paying different prices for it.",
  story: `<p>The 8086 and 8088 are the same processor with different bus widths. Put them on one
    shared 16-bit memory and the difference stops being trivia: the 8086 moves a word in one cycle,
    while the 8088 must do two byte cycles and route its eight data lines to whichever bank the address
    selects.</p>
    <p>That routing is the '245 transceiver labelled <i>swap</i>: when the 8088 addresses an odd byte,
    its D0-D7 must cross to the odd bank's D8-D15 lane. The 8086 needs no such thing — it drives both
    lanes natively and signals its intent with <code>~BHE</code>, which the 8088 has to synthesize as
    <code>NOT A0</code>.</p>`,
  chips: [["acpu", "The 8086 — priority master, drives both byte lanes"],
          ["bcpu", "The 8088 — one byte lane, and a swap buffer to reach the other"],
          ["bswap", "74LS245 crossing the 8088's data onto the odd bank when A0 = 1"],
          ["bbufB", "74LS244 synthesizing BHEN as NOT A0 for the 8088"],
          ["ramL", "Even bank"], ["ramH", "Odd bank"],
          ["aarb", "8289 arbiter for the 8086"], ["barb", "8289 arbiter for the 8088"]],
  map: [["Shared A15 = 0", "ROM (two banks)"],
        ["Shared A15 = 1", "RAM (two banks)"],
        ["ramL ~WE", "MWTC OR A0 — blocked on odd addresses"],
        ["ramH ~WE", "MWTC OR BHEN — blocked when the high lane is not selected"]],
  program: `<p>The same atomic-claim program as the dual-8088 board: both processors race for a byte
    with a locked <code>XCHG</code>, then each increments its own counter forever.</p>`,
  tries: [
    { t: "Measure the width penalty",
      s: `<p>Put both arbiters' <code>~AEN</code> on the analyzer and watch one increment from each
      processor. The 8088 holds the bus roughly twice as long for identical work, because every word
      touch is two cycles. This is the entire commercial argument the 8086 had over the 8088 — and the
      cost argument the 8088 had over the 8086.</p>` },
    { t: "Follow a byte through the swap",
      s: `<p>Hover both sides of the swap '245 while the 8088 writes an odd address. The same byte
      appears on D0-D7 of the CPU and on D8-D15 of the bus. Then watch an even write: the swap buffer
      is disabled and the direct transceiver carries it instead.</p>` },
    { t: "Watch BHEN get built",
      s: `<p>Add the 8086's <code>~BHE</code> and the 8088's synthesized <code>BHEN</code> to the
      analyzer. One comes from a pin; the other comes from an inverter on A0. They serve the same
      purpose — telling the odd bank whether it is included in this transfer.</p>` },
  ],
},

// -------------------------------------------------------- pc-speaker ----
"pc-speaker": {
  one: "The 8253 as a square-wave synthesizer: change the divisor, change the note.",
  story: `<p>The PC's speaker was a timer channel wired to a cone. In mode 3 a counter divides its
    input clock by the reload value and toggles its output — a square wave whose frequency is
    <code>1.193 MHz ÷ divisor</code>. Music is a sequence of divisors.</p>
    <p>Here channel 0's output goes straight to the speaker, so there is no gating: whatever the timer
    does, you hear.</p>`,
  chips: [["pit", "8253 timer, channel 0 in mode 3, clocked from the 8284A's PCLK"],
          ["spk", "The speaker — its symbol shows the live frequency"],
          ["cpu", "8088 writing a new divisor for each note"]],
  map: [["Ports 40h-5Fh", "8253 (autoconnected)"],
        ["Port 43h", "Control register — 36h selects channel 0, mode 3, both bytes"],
        ["Port 40h", "Divisor, low byte then high"],
        ["Frequency", "2386363 ÷ divisor (this board's CLK0 rate)"]],
  program: `<p>Four notes in a loop. Each writes the control word, then the divisor low and high, then
    delays.</p>`,
  code: `note:   mov al, 0x36
        out 0x43, al       ; ch0, mode 3, square wave
        mov al, bl
        out 0x40, al       ; divisor low
        mov al, bh
        out 0x40, al       ; divisor high`,
  tries: [
    { t: "Listen",
      s: `<p>Run the board and double-click the speaker. Press <b>🔊 listen</b> and the tones play
      through your machine's audio — a real oscillator following the measured frequency of the wire.</p>` },
    { t: "Compose",
      s: `<p>The divisors in the program are A4, E5, A5 and A5 again. Compute your own:
      <code>divisor = 2386363 ÷ frequency</code>. Middle C is 262 Hz, so 9108. Replace a note and
      listen to the difference.</p>` },
    { t: "See the wave",
      s: `<p>Add the timer's <code>OUT0</code> to the analyzer and zoom until individual transitions
      appear. It is a perfect square wave, and its period is exactly the divisor times the input clock.
      Zoom out and the note changes appear as blocks of different density.</p>` },
    { t: "Try the other modes",
      s: `<p>Change the control word from <code>0x36</code> (mode 3) to <code>0x34</code> (mode 2, rate
      generator). Instead of a symmetric square wave you get a narrow pulse once per period — audibly
      thinner, and visibly different on the analyzer. Mode 0 stops it making sound at all.</p>` },
  ],
},

// ------------------------------------------------------- lpt-printer ----
"lpt-printer": {
  one: "Centronics printing done honestly: poll BUSY, latch a byte, pulse STROBE.",
  story: `<p>The parallel port is three registers and a handshake. Data goes into the latch at 378h,
    the printer's status is readable at 379h, and control bits at 37Ah include the STROBE line. To
    print a byte: wait until the printer is not busy, write the data, pulse STROBE low and high.</p>
    <p>The printer answers with BUSY while it works and a short ~ACK pulse when it is done. Both are
    real pins on this board, not a software abstraction.</p>`,
  chips: [["lpt", "LPT378 adapter card, self-decoding at 378h-37Ah"],
          ["prn", "The printer — double-click it to read the paper"],
          ["cpu", "8088 running the handshake in software"]],
  map: [["378h", "Data latch → the printer's eight data pins"],
        ["379h", "Status — bit 7 is inverted BUSY, bit 6 ~ACK, bit 5 paper end, bit 4 select"],
        ["37Ah", "Control — bit 0 STROBE, bit 1 auto-feed, bit 2 ~INIT, bit 3 select-in"]],
  program: `<p>Walk a string; for each character, poll status bit 7 until the printer is free, write
    the byte to 378h, then write 0Dh and 0Ch to 37Ah to pulse STROBE.</p>`,
  code: `wait:   in  al, dx         ; 379h status
        test al, 0x80      ; bit 7 = NOT busy
        jz  wait
        mov al, bl
        out 0x378, al      ; data
        mov al, 0x0D
        out 0x37A, al      ; strobe low
        mov al, 0x0C
        out 0x37A, al      ; strobe high`,
  tries: [
    { t: "Read the paper",
      s: `<p>Run the board and double-click the printer. <code>HELLO 8088!</code> is on the page, with
      a character count and a tear-off button. It arrived one byte at a time through a handshake.</p>` },
    { t: "Watch the handshake",
      s: `<p>Add <code>~STROBE</code>, <code>BUSY</code> and <code>~ACK</code> to the analyzer. The
      pattern per character is exact: STROBE falls, the printer raises BUSY, time passes, BUSY falls
      and ~ACK pulses. Every parallel printer ever made spoke this dialect.</p>` },
    { t: "Skip the polling",
      s: `<p>Delete the <code>test</code>/<code>jz</code> wait loop and re-assemble. Characters are now
      written while the printer is still busy and get dropped — the page comes out short or garbled.
      Restore it and the text is perfect again. That loop is not ceremony; it is flow control.</p>` },
    { t: "Print something of your own",
      s: `<p>The message is a <code>db</code> list of ASCII bytes ending in zero. Replace it — 0x0A is
      a line feed — and re-assemble.</p>` },
  ],
},

// ------------------------------------------------------- pic-cascade ----
"pic-cascade": {
  one: "Master and slave interrupt controllers, exactly as the PC/AT did it — fifteen usable IRQs.",
  story: `<p>One 8259A gives eight interrupt lines. The AT needed more, so it hung a second controller
    off the first: the slave's INT drives the master's IR2, and during the acknowledge the master puts
    the slave's identity on the three CAS lines so the right chip supplies the vector.</p>
    <p>Two chips, one extra bus, fifteen usable lines — and one of the master's eight sacrificed to
    carry the slave. This board makes the whole mechanism visible with two buttons.</p>`,
  chips: [["pic", "Master 8259A at 20h, base vector 08h, ~SP/~EN high"],
          ["slave", "Slave 8259A at 40h, base vector 70h, ~SP/~EN grounded"],
          ["btnM", "A button on the master's IR4 → vector 0Ch"],
          ["btnS", "A button on the slave's IR3 → vector 73h"],
          ["led", "The LED port showing which vector was delivered"]],
  map: [["Master 20h/21h", "ICW3 = 04h — “a slave is on my IR2”"],
        ["Slave 40h/41h", "ICW3 = 02h — “my identity is 2”"],
        ["CAS0-CAS2", "The master broadcasts the slave's ID during the second INTA"],
        ["Slave INT", "→ master IR2"]],
  program: `<p>It installs handlers at vectors 0Ch and 73h, initializes both controllers with the full
    ICW1-ICW4 sequence, unmasks everything, and halts. Each handler sends the right EOI sequence and
    writes its own vector number to the LEDs.</p>`,
  code: `        mov al, 0x04       ; master ICW3: slave on IR2
        out 0x21, al
        ...
        mov al, 0x02       ; slave ICW3: my ID is 2
        out 0x41, al`,
  tries: [
    { t: "Press both buttons",
      s: `<p>The master button shows <code>0C</code> on the LEDs — base 08h plus IR4. The slave button
      shows <code>73</code> — base 70h plus IR3, delivered through the master. Same handshake, two
      chips deep.</p>` },
    { t: "Watch the CAS bus carry an identity",
      s: `<p>Add <code>~INTA</code> and the three CAS lines to the analyzer, then press the slave
      button. During the second INTA pulse the master drives 2 onto CAS — and only the slave whose ID
      is 2 answers with a vector. That is the entire cascade protocol on four wires.</p>` },
    { t: "See the nested in-service state",
      s: `<p>Press the slave button and pause quickly, then double-click both controllers. The
      master's ISR bit 2 is set (it is servicing the cascade) and the slave's ISR bit 3 is set (it is
      servicing the actual request). Two chips, both in service, one interrupt.</p>` },
    { t: "Send the wrong EOI",
      s: `<p>Delete the master EOI from the slave's handler, leaving only the slave's own. Press the
      slave button twice: the second press does nothing. The master still believes IR2 is in service
      and blocks everything at that level or below — the classic cascade bug.</p>` },
    { t: "Move the slave",
      s: `<p>Change the master's ICW3 to <code>0x20</code> and the slave's to <code>0x05</code>, and
      rewire the slave's INT to the master's IR5. The vector still arrives — you have just relocated
      the cascade to a different line, exactly as a board designer would.</p>` },
  ],
},

// --------------------------------------------------------- pit-modes ----
"pit-modes": {
  one: "A free-running square wave and a hardware one-shot you trigger with a button.",
  story: `<p>The 8254 has six counting modes and they are genuinely different machines. This board
    runs two of them side by side: channel 0 in mode 3 free-running as a square wave, and channel 1 in
    mode 1 as a retriggerable one-shot whose gate is a push button.</p>
    <p>The one-shot is the interesting one. Press the button for any length of time and the output
    pulse is always the same width, because the hardware — not your finger — decides the duration.</p>`,
  chips: [["pit", "8254 timer: read-back capable, unlike the 8253"],
          ["btn", "The button on channel 1's GATE — the one-shot trigger"],
          ["led", "LED bit 0 shows OUT0, bit 1 shows OUT1"]],
  map: [["Ports 40h-43h", "8254"],
        ["Control 36h", "Channel 0, mode 3, square wave"],
        ["Control 72h", "Channel 1, mode 1, hardware one-shot"],
        ["Control E2h", "Read-back — latch channel 0's status (8254 only)"]],
  program: `<p>Programs channel 0 as a mode-3 square wave with divisor 40000 (about 60 Hz), channel 1
    as a mode-1 one-shot of 0x6000 counts, then issues a read-back command and stores the returned
    status byte at <code>[0x100]</code> before spinning.</p>`,
  code: `        mov al, 0xE2       ; read-back: latch ch0 status
        out 0x43, al
        in  al, 0x40
        mov [0x100], al`,
  tries: [
    { t: "Trigger the one-shot",
      s: `<p>Run, then press and release the GATE button quickly. LED bit 1 lights for a fixed time and
      goes out. Now hold the button down: the pulse is exactly as long as before. Press again while it
      is still high and it retriggers, restarting the count from the top.</p>` },
    { t: "Measure both with cursors",
      s: `<p>Put <code>OUT0</code> and <code>OUT1</code> on the analyzer. Click to drop a cursor at the
      start of the one-shot pulse and read the time; compare it with the square wave's period. You can
      confirm the pulse is 0x6000 input clocks wide, exactly as programmed.</p>` },
    { t: "Read the read-back byte",
      s: `<p>Open the unified memory view at <code>00100</code>. That byte is channel 0's status:
      bit 7 is the current OUT level, bit 6 the null-count flag, bits 4-5 the read/write mode, bits 1-3
      the counting mode. This command is the 8254's headline feature over the 8253.</p>` },
    { t: "Change the note mid-flight",
      s: `<p>Pause, double-click the timer, and edit channel 0's reload value. Resume: the blink rate
      changes immediately, because the counter reloads from that register every time it hits zero.</p>` },
  ],
},

// --------------------------------------------------------- fixit-lab ----
"fixit-lab": {
  one: "A board wired in a hurry. The program is fine. The board is not. Find the two bugs.",
  story: `<p>Everything about this board looks right. The CPU runs, the ROM is programmed, the
    program is the same blinker that works everywhere else — and the LEDs stay dark. There are no
    strict violations, so the simulation starts happily.</p>
    <p>Two things are wrong, and both are the kind of thing that eats an afternoon on a real bench:
    one is a floating input doing exactly what floating TTL inputs do, and the other is a wire that
    works by luck. The Checks tab knows about both.</p>`,
  chips: [["port", "The output '373 — its ~OE pin is the first bug"],
          ["led", "The LEDs, faithfully showing nothing"],
          ["cpu", "8088, running the program correctly the whole time"],
          ["rom", "2764 EPROM with a perfectly good blinker in it"]],
  map: [["Any IO write", "Latches into the '373 — which then refuses to drive its outputs"],
        ["~RES net", "Has a button but no pull-up: high only because nothing is holding it low"]],
  program: `<p>The standard blinker. It is not the problem, and proving that to yourself is part of
    the exercise.</p>`,
  tries: [
    { t: "Confirm the program is innocent",
      s: `<p>Run the board and open the <b>CPU</b> tab. Registers are changing, IP is moving, the
      program is executing. Pause and double-click the '373: its latched value <i>is</i> alternating
      between 55h and AAh. The data is arriving — it simply is not coming out.</p>` },
    { t: "Read the checks",
      s: `<p>Open the <b>Checks</b> tab. Two weak warnings, each expandable into an explanation. The
      first is the floating <code>~OE</code>: an unconnected TTL input reads as logic 1, and on a '373
      a high output-enable tri-states every output. The latch is working perfectly and showing nothing.</p>` },
    { t: "Fix it with one wire",
      s: `<p>Stop, wire the '373's <code>~OE</code> to GND, and run. The blinker appears. One wire
      between a dead board and a working one — and no amount of staring at the software would ever have
      found it.</p>` },
    { t: "Fix the one that “works”",
      s: `<p>The second warning is the reset button with no pull-up. It appears to work, because a
      floating net reads high and that happens to be the inactive state. It is not a design — it is a
      coincidence. Wire the PULLUP onto the <code>~RES</code> net and re-run the checks: clean.</p>` },
    { t: "Let the tool find it",
      s: `<p>Undo your fixes and press <b>⚡ complete</b> instead. The repair scan clones the board,
      re-runs each chip's standard hookup on the clone, and reports precisely what is missing — then
      restores it if you accept.</p>` },
  ],
},

};
