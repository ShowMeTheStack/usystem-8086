"use strict";
(function (K) {
  const { SIG } = K;

  // 8284A clock generator/driver. v0.1 approximations, noted for the phase-2 pass:
  // CLK duty is 50% here (real part is 33%), OSC mirrors CLK instead of the raw
  // crystal, and READY is the OR of both gated RDY inputs sampled on CLK falling edge.
  // A power-on reset holds RESET high for the first 16 CLK cycles; after that the
  // ~RES input (button / RC net) controls it, synchronized on falling CLK.
  K.defineChip({
    type: "8284A", name: "8284A clock generator", category: "System", wide: true,
    dip: ["i:CSYNC", "o:PCLK", "i:~AEN1", "i:RDY1", "o:READY", "i:RDY2", "i:~AEN2",
          "o:CLK", "g:GND", "o:RESET", "i:~RES", "o:OSC", "i:F/~C", "i:EFI",
          "i:~ASYNC", "x:X2", "x:X1", "p:VCC"],
    needsCrystal: ["X1", "X2"],
    noFloatWarn: true,
    props: { mhz: 14.31818 },              // synced from the attached crystal by the UI
    tickHz: (comp) => 2 * (comp.props.mhz * 1e6 / 3),
    init(state) {
      state.clk = 0;
      state.pclkDiv = 0;
      state.ready = 1;
      state.reset = 1;
      state.por = 32;                       // power-on reset, in half-cycles
    },
    tick(io, state) {
      state.clk ^= 1;
      if (!state.clk) {                     // falling edge: sample RES and RDY
        state.pclkDiv = (state.pclkDiv + 1) & 3;
        const resIn = io.in("~RES") === SIG.H; // high = not reset
        if (state.por > 0) { state.por--; state.reset = 1; }
        else state.reset = resIn ? 0 : 1;
      }
      this.evaluate(io, state);
    },
    evaluate(io, state) {
      // READY is combinational on the RDY/~AEN inputs (the real part's
      // synchronizer is sub-CLK): a bus-grant change must reach the CPU
      // before its next T3 falling-edge READY sample, or it completes a
      // cycle that never touched the bus. A channel takes part only if its
      // RDY pin is actually wired; with neither wired, default ready so
      // minimal kits run without wait-state logic.
      const r1 = io.in("RDY1") === SIG.H && io.in("~AEN1") !== SIG.H;
      const r2 = io.in("RDY2") === SIG.H && io.in("~AEN2") !== SIG.H;
      const inUse = io.raw("RDY1") !== SIG.Z || io.raw("RDY2") !== SIG.Z;
      state.ready = inUse ? (r1 || r2 ? 1 : 0) : 1;
      io.out("CLK", state.clk);
      io.out("OSC", state.clk);
      io.out("PCLK", state.pclkDiv & 1); // CLK/2
      io.out("READY", state.ready);
      io.out("RESET", state.reset);
    },
  });
})(globalThis.K8086 ??= {});
