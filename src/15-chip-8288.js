"use strict";
(function (K) {
  const { SIG } = K;
  const H = (io, n) => io.in(n) === SIG.H;

  // 8288 bus controller: decodes the CPU's max-mode ~S2..~S0 status into ALE and
  // the MULTIBUS-style command strobes. State machine advances on CLK rising edges
  // (the engine settles CPU pin drives before peripherals see the same edge, so
  // status is stable when we sample — mirroring real output-delay ordering).
  // Outputs are derived purely from state, which also lets the memory-map prober
  // pose the controller mid-cycle without clocking it.
  K.defineChip({
    type: "8288", name: "8288 bus controller", category: "System",
    dip: ["i:IOB", "i:CLK", "i:~S1", "o:DT/~R", "o:ALE", "i:~AEN", "t:~MRDC", "t:~AMWC",
          "t:~MWTC", "g:GND", "t:~IOWC", "t:~AIOWC", "t:~IORC", "t:~INTA", "i:CEN",
          "o:DEN", "o:MCE", "i:~S2", "i:~S0", "p:VCC"],
    edgePins: ["CLK"],
    noFloatWarn: true,
    init(state) { state.phase = 0; state.cmd = 7; state.ale = 0; },
    inspect(state) {
      const CMDS = ["INTA", "IOR", "IOW", "HALT", "CODE", "MEMR", "MEMW", "passive"];
      return [
        { key: "phase", kind: "num", get: () => state.phase, set: (v) => { state.phase = v & 3; } },
        { key: "cmd (" + CMDS[state.cmd] + ")", kind: "num", get: () => state.cmd, set: (v) => { state.cmd = v & 7; } },
      ];
    },
    _status(io) {
      return (H(io, "~S0") ? 1 : 0) | (H(io, "~S1") ? 2 : 0) | (H(io, "~S2") ? 4 : 0);
    },
    onEdge(pin, rising, io, state) {
      if (!rising) {
        // ALE falls on the CLK falling edge inside T1, while the CPU still
        // holds the address — that's what gives the '373 its hold time.
        if (state.phase === 1) state.ale = 0;
        return;
      }
      const st = this._status(io);
      if (state.phase === 0) {
        if (st !== 7 && st !== 3) { state.phase = 1; state.cmd = st; state.ale = 1; } // T1 begins
      } else if (state.phase === 1) {
        state.phase = 2;                                              // commands on at T2
      } else if (st === 7) {
        state.phase = 0;                                              // T4: status passive
        state.cmd = 7;
      }
    },
    evaluate(io, state) {
      const c = state.cmd;
      // ~AEN driven high TRISTATES the command outputs (MULTIBUS arbitration:
      // several 8288s share the command lines, only the granted one drives).
      // A floating ~AEN reads TTL-high but means "no arbiter" — stay enabled.
      const masked = io.raw("~AEN") === SIG.H;
      const act = state.phase === 2 && !masked;
      io.out("ALE", state.ale);
      const cmd = (name, on) => { if (masked) io.z(name); else io.out(name, on ? 0 : 1); };
      cmd("~MRDC", act && (c === 4 || c === 5));
      cmd("~MWTC", act && c === 6);
      cmd("~AMWC", act && c === 6);
      cmd("~IORC", act && c === 1);
      cmd("~IOWC", act && c === 2);
      cmd("~AIOWC", act && c === 2);
      cmd("~INTA", act && c === 0);
      io.out("DT/~R", (c === 2 || c === 6) && state.phase > 0 ? 1 : 0);
      io.out("DEN", act ? 1 : 0);
      io.out("MCE", 0);
    },
  });
  // 8289 bus arbiter: watches its CPU's ~S2..~S0, competes for the shared bus
  // on the open-collector ~BUSY line with serial priority (~BPRN in, ~BPRO out),
  // and grants its own 8288/latches/transceivers via ~AEN. Acquisition is
  // two-phase (post request, then take the bus a clock later) so simultaneous
  // requesters resolve strictly by priority. The bus is held while the CPU's
  // status stays active — which makes back-to-back cycles like XCHG atomic,
  // as on real hardware holding the bus between transfers.
  K.defineChip({
    type: "8289", name: "8289 bus arbiter", category: "System",
    pins: [
      { name: "~S0", kind: "in", side: "L", slot: 1 },
      { name: "~S1", kind: "in", side: "L", slot: 2 },
      { name: "~S2", kind: "in", side: "L", slot: 3 },
      { name: "CLK", kind: "in", side: "L", slot: 5 },
      { name: "~BPRN", kind: "in", side: "L", slot: 7 },
      { name: "~LOCK", kind: "in", side: "L", slot: 8 },
      { name: "~BPRO", kind: "out", side: "B", slot: 2 },
      { name: "~BUSY", kind: "oc", side: "B", slot: 4 },
      { name: "~AEN", kind: "out", side: "R", slot: 3 },
    ],
    grid: { w: 8, h: 9 },
    edgePins: ["CLK"],
    noFloatWarn: true,
    init(state) { state.grant = false; state.phase = 0; state.grants = 0; state.cool = 0; },
    inspect(state) {
      return [
        { key: "holding bus", kind: "bool", get: () => state.grant, set: () => {} },
        { key: "bus grants", kind: "num", get: () => state.grants, set: () => {} },
      ];
    },
    _status(io) {
      return (H(io, "~S0") ? 1 : 0) | (H(io, "~S1") ? 2 : 0) | (H(io, "~S2") ? 4 : 0);
    },
    onEdge(pin, rising, io, state) {
      if (rising) return;                                // arbitrate on CLK falling
      const st = this._status(io);
      const want = st !== 7 && st !== 3;
      if (state.grant) {
        // ~LOCK low pins the bus across the idle gap inside a locked
        // instruction (XCHG mem, LOCK prefix) — that's what makes it atomic.
        if (!want && io.raw("~LOCK") !== SIG.L) {
          state.grant = false;
          state.phase = 0;
          state.cool = 2;   // bus-exchange overhead: give a waiting arbiter its window
        }
        return;
      }
      if (state.cool > 0) { state.cool--; return; }      // (CBRQ-style fairness)
      if (!want) { state.phase = 0; return; }
      if (state.phase === 0) { state.phase = 1; return; } // post the request first
      if (io.raw("~BUSY") !== SIG.L && io.in("~BPRN") === SIG.L) {
        state.grant = true;
        state.grants++;
      }
    },
    evaluate(io, state) {
      io.out("~AEN", state.grant ? 0 : 1);
      io.oc("~BUSY", state.grant ? 0 : 1);
      // serial priority chain: pass priority downstream only when idle
      const idle = !state.grant && state.phase === 0;
      io.out("~BPRO", idle && io.in("~BPRN") === SIG.L ? 0 : 1);
    },
  });
})(globalThis.K8086 ??= {});
