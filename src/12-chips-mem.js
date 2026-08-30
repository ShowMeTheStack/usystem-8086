"use strict";
(function (K) {
  const { SIG } = K;
  const H = (io, n) => io.in(n) === SIG.H;
  const D = K.pinRange("D", 0, 7);

  // Shared SRAM/EPROM behavior. cfg: { addrPins, selected(io), writable, size, ns }
  function memBehavior(cfg) {
    return {
      accessNs: cfg.ns,
      // metadata for the memory-map analyzer (src/06-memmap.js)
      probe: { size: cfg.size, addrPins: cfg.addrPins, selected: cfg.selected, writable: cfg.writable },
      init(state, props) {
        state.mem = new Uint8Array(cfg.size);
        if (props.image) state.mem.set(props.image.slice(0, cfg.size));
      },
      evaluate(io, state) {
        const sel = cfg.selected(io);
        const reading = sel && !H(io, "~OE") && (!cfg.writable || H(io, "~WE"));
        if (reading) io.outBus(D, state.mem[io.num(cfg.addrPins)]);
        else io.zBus(D);
      },
      // SRAM write is level-sensitive while ~WE and select are both active,
      // but a real part needs its minimum write-pulse width: combinational
      // glitches inside one settle must NOT write. So the commit happens only
      // once the netlist has converged, from the settled pin values.
      postSettle: cfg.writable ? function (io, state) {
        if (cfg.selected(io) && !H(io, "~WE"))
          state.mem[io.num(cfg.addrPins)] = io.num(D);
      } : undefined,
    };
  }

  K.defineChip({
    type: "SRAM6264", name: "6264 SRAM 8Kx8", category: "Memory", wide: true,
    dip: ["n:NC", "i:A12", "i:A7", "i:A6", "i:A5", "i:A4", "i:A3", "i:A2", "i:A1", "i:A0",
          "io:D0", "io:D1", "io:D2", "g:GND", "io:D3", "io:D4", "io:D5", "io:D6", "io:D7",
          "i:~CS1", "i:A10", "i:~OE", "i:A11", "i:CS2", "i:A9", "i:A8", "i:~WE", "p:VCC"],
    ...memBehavior({
      size: 8192, ns: 150, writable: true,
      addrPins: K.pinRange("A", 0, 12),
      selected: (io) => !H(io, "~CS1") && H(io, "CS2"),
    }),
  });

  K.defineChip({
    type: "SRAM62256", name: "62256 SRAM 32Kx8", category: "Memory", wide: true,
    dip: ["i:A14", "i:A12", "i:A7", "i:A6", "i:A5", "i:A4", "i:A3", "i:A2", "i:A1", "i:A0",
          "io:D0", "io:D1", "io:D2", "g:GND", "io:D3", "io:D4", "io:D5", "io:D6", "io:D7",
          "i:~CS", "i:A10", "i:~OE", "i:A11", "i:A9", "i:A8", "i:A13", "i:~WE", "p:VCC"],
    ...memBehavior({
      size: 32768, ns: 120, writable: true,
      addrPins: K.pinRange("A", 0, 14),
      selected: (io) => !H(io, "~CS"),
    }),
  });

  K.defineChip({
    type: "SRAM628512", name: "628512 SRAM 512Kx8", category: "Memory", wide: true,
    dip: ["i:A18", "i:A16", "i:A14", "i:A12", "i:A7", "i:A6", "i:A5", "i:A4",
          "i:A3", "i:A2", "i:A1", "i:A0", "io:D0", "io:D1", "io:D2", "g:GND",
          "io:D3", "io:D4", "io:D5", "io:D6", "io:D7", "i:~CE", "i:A10", "i:~OE",
          "i:A11", "i:A9", "i:A8", "i:A13", "i:~WE", "i:A17", "i:A15", "p:VCC"],
    ...memBehavior({
      size: 524288, ns: 100, writable: true,
      addrPins: K.pinRange("A", 0, 18),
      selected: (io) => !H(io, "~CE"),
    }),
  });

  K.defineChip({
    type: "EPROM2764", name: "2764 EPROM 8Kx8", category: "Memory", wide: true, isRom: true,
    dip: ["p:VPP", "i:A12", "i:A7", "i:A6", "i:A5", "i:A4", "i:A3", "i:A2", "i:A1", "i:A0",
          "t:D0", "t:D1", "t:D2", "g:GND", "t:D3", "t:D4", "t:D5", "t:D6", "t:D7",
          "i:~CE", "i:A10", "i:~OE", "i:A11", "i:A9", "i:A8", "n:NC", "i:~PGM", "p:VCC"],
    ...memBehavior({
      size: 8192, ns: 250, writable: false,
      addrPins: K.pinRange("A", 0, 12),
      selected: (io) => !H(io, "~CE"),
    }),
  });

  K.defineChip({
    type: "EPROM27128", name: "27128 EPROM 16Kx8", category: "Memory", wide: true, isRom: true,
    dip: ["p:VPP", "i:A12", "i:A7", "i:A6", "i:A5", "i:A4", "i:A3", "i:A2", "i:A1", "i:A0",
          "t:D0", "t:D1", "t:D2", "g:GND", "t:D3", "t:D4", "t:D5", "t:D6", "t:D7",
          "i:~CE", "i:A10", "i:~OE", "i:A11", "i:A9", "i:A8", "i:A13", "i:~PGM", "p:VCC"],
    ...memBehavior({
      size: 16384, ns: 250, writable: false,
      addrPins: K.pinRange("A", 0, 13),
      selected: (io) => !H(io, "~CE"),
    }),
  });

  K.defineChip({
    type: "EPROM27256", name: "27256 EPROM 32Kx8", category: "Memory", wide: true, isRom: true,
    dip: ["p:VPP", "i:A12", "i:A7", "i:A6", "i:A5", "i:A4", "i:A3", "i:A2", "i:A1", "i:A0",
          "t:D0", "t:D1", "t:D2", "g:GND", "t:D3", "t:D4", "t:D5", "t:D6", "t:D7",
          "i:~CE", "i:A10", "i:~OE", "i:A11", "i:A9", "i:A8", "i:A13", "i:A14", "p:VCC"],
    ...memBehavior({
      size: 32768, ns: 200, writable: false,
      addrPins: K.pinRange("A", 0, 14),
      selected: (io) => !H(io, "~CE"),
    }),
  });

  // Program an EPROM/SRAM component with assembled bytes (before sim construction).
  K.programMemory = function (doc, compId, bytes) {
    const comp = K.docComp(doc, compId);
    K.assert(comp, "no component " + compId);
    comp.props.image = Array.from(bytes);
  };
})(globalThis.K8086 ??= {});
