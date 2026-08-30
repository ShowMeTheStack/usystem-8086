"use strict";
(function (K) {
  const { SIG } = K;
  const IF = K.FLAG.IF;

  // Pin-level wrappers around the shared Cpu86 core (minimum mode).
  // Bus cycle -> pin mapping per T-state (v0.1, refined against SingleStepTests later):
  //   T1: ALE high (first half), address on AD/A pins, IO/~M and DT/~R valid
  //   T2..T3(+Tw): read -> AD released + ~RD low; write -> data on AD + ~WR low; ~DEN low
  //   falling edges in T3/Tw: READY sampled; read data sampled from AD
  //   T4: strobes deassert, transfer completes inside the core
  function makeCpu(is8086) {
    const AD = is8086 ? K.pinRange("AD", 0, 15) : K.pinRange("AD", 0, 7);
    const AHI = is8086 ? [] : K.pinRange("A", 8, 15);
    const ATOP = ["A16", "A17", "A18", "A19"];
    const ALL_ADDR = [...AD, ...AHI, ...ATOP];

    // Status codes on ~S2..~S0 (max mode): 0 INTA, 1 IOR, 2 IOW, 3 HALT,
    // 4 code fetch, 5 MEMR, 6 MEMW, 7 passive.
    function statusCode(b) {
      if (!b || b.t >= 4) return 7;
      if (b.kind === "inta") return 0;
      if (b.sp === "i") return b.kind === "w" ? 2 : 1;
      if (b.kind === "code") return 4;
      return b.kind === "w" ? 6 : 5;
    }
    // Dual-role pins: in max mode these canonical (min-mode) pin names carry:
    //   ~DEN=~S0  DT/~R=~S1  IO/~M (M/~IO)=~S2  ALE=QS0  ~INTA=QS1  ~WR=~LOCK
    // queue-status encoding on QS1:QS0 — 00 idle, 01 first byte, 11 subsequent, 10 flushed
    const QS = (q) => q === "F" ? 1 : q === "E" ? 2 : q === "S" ? 3 : 0;
    function driveStatus(io, code, lock, qs) {
      io.out("~DEN", code & 1);
      io.out("DT/~R", (code >> 1) & 1);
      io.out(is8086 ? "M/~IO" : "IO/~M", (code >> 2) & 1);
      io.out("ALE", qs & 1);       // QS0
      io.out("~INTA", (qs >> 1) & 1); // QS1
      io.out("~WR", lock ? 0 : 1); // ~LOCK
    }
    function isMax(io) { return io.in("MN/~MX") === SIG.L; }

    function pinNets(chip) {
      let pn = chip.runtime._pn;
      if (!pn) {
        const ix = chip.def.pinIndex;
        pn = chip.runtime._pn = {
          reset: chip.pinNet[ix.RESET], intr: chip.pinNet[ix.INTR], nmi: chip.pinNet[ix.NMI],
        };
      }
      return pn;
    }

    function driveInactive(io, maxMode, lock, qs) {
      if (maxMode) driveStatus(io, 7, lock, qs || 0);
      else {
        io.out("ALE", 0);
        io.out("~RD", 1); io.out("~WR", 1); io.out("~INTA", 1);
        io.out("~DEN", 1); io.out("DT/~R", 0);
        io.out(is8086 ? "M/~IO" : "IO/~M", is8086 ? 1 : 0);
      }
      io.out("~RD", 1);
      io.out("HLDA", 0);
      if (!is8086) io.out("~SS0", 1);
      if (is8086) io.out("~BHE", 1);
      io.zBus(ALL_ADDR);
    }

    function drivePins(io, core, phaseHigh) {
      const b = core.bus;
      const maxMode = isMax(io);
      if (!b) { driveInactive(io, maxMode, core.lock, QS(core.qsPrev)); return; }
      const isIo = b.sp === "i";
      const isWrite = b.kind === "w";
      const isInta = b.kind === "inta";
      if (maxMode) driveStatus(io, statusCode(b), core.lock, QS(core.qsPrev));
      else {
        io.out(is8086 ? "M/~IO" : "IO/~M", is8086 ? (isIo || isInta ? 0 : 1) : (isIo || isInta ? 1 : 0));
        io.out("DT/~R", isWrite ? 1 : 0);
      }
      io.out("HLDA", 0);
      if (!is8086) io.out("~SS0", 1);

      if (b.t === 1) {
        if (!maxMode) io.out("ALE", phaseHigh ? 1 : 0); // ALE spans the first half of T1
        // Address phase: full 20-bit address on the muxed + dedicated pins.
        io.outBus(AD, b.addr & (is8086 ? 0xFFFF : 0xFF));
        if (!is8086) io.outBus(AHI, (b.addr >> 8) & 0xFF);
        io.outBus(ATOP, (b.addr >> 16) & 0xF);
        if (is8086) io.out("~BHE", b.word || (b.addr & 1) ? 0 : 1);
        io.out("~RD", 1);
        if (!maxMode) { io.out("~WR", 1); io.out("~INTA", 1); io.out("~DEN", 1); }
        return;
      }
      // T2..T4: dedicated address lines hold; muxed lines carry data or float.
      if (!is8086) io.outBus(AHI, (b.addr >> 8) & 0xFF);
      io.outBus(ATOP, (b.addr >> 16) & 0xF);
      if (is8086) io.out("~BHE", b.word || (b.addr & 1) ? 0 : 1);
      const strobing = b.t >= 2 && b.t <= 3;
      io.out("~RD", !isWrite && !isInta && strobing ? 0 : 1);
      if (!maxMode) {
        io.out("ALE", 0);
        io.out("~WR", isWrite && strobing ? 0 : 1);
        io.out("~INTA", isInta && strobing ? 0 : 1);
        io.out("~DEN", b.t >= 2 && b.t <= 3 ? 0 : 1);
      }
      if (isWrite && b.t >= 2) {
        if (is8086) {
          if (b.word) io.outBus(AD, b.dataOut & 0xFFFF);
          else if (b.addr & 1) { io.zBus(AD.slice(0, 8)); io.outBus(AD.slice(8), b.dataOut & 0xFF); }
          else { io.outBus(AD.slice(0, 8), b.dataOut & 0xFF); io.zBus(AD.slice(8)); }
        } else io.outBus(AD, b.dataOut & 0xFF);
      } else {
        io.zBus(AD);                            // released for the addressed device
      }
    }

    function sampleData(io, core) {
      const b = core.bus;
      if (!b || b.t !== 3) return;                // sample in T3/Tw only
      b.ready = io.in("READY") !== SIG.L;         // writes honor READY too
      if (!b.ready || b.kind === "w") return;
      if (is8086) {
        if (b.word) b.dataIn = io.num(AD);
        else if (b.addr & 1) b.dataIn = io.num(AD.slice(8));
        else b.dataIn = io.num(AD.slice(0, 8));
      } else {
        b.dataIn = io.num(AD);
      }
    }

    return {
      isCpu: true, is8086,
      category: "CPU", wide: true,
      maxAlias: { "~DEN": "~S0", "DT/~R": "~S1", [is8086 ? "M/~IO" : "IO/~M"]: "~S2",
                  ALE: "QS0", "~INTA": "QS1", "~WR": "~LOCK", HLDA: "~RQ/~GT1", HOLD: "~RQ/~GT0" },
      edgePins: ["CLK"],
      required: ["CLK", "RESET"],
      noFloatWarn: true,
      init(state, props, chip) {
        chip.runtime.core = new K.Cpu86({ is8086 });
        chip.runtime.retired = false;
        state.resetting = true;
        state.arch = chip.runtime.core.saveArch();
      },
      onRestore(io, state, props, chip) {
        chip.runtime.core = new K.Cpu86({ is8086 });
        chip.runtime.core.loadArch(state.arch);
        chip.runtime.retired = false;
        chip.runtime.atBoundary = true;
        driveInactive(io, isMax(io)); // stale mid-cycle pin drives would fight the memories
      },
      evaluate(io, state, props, chip) {
        // Combinational refresh (e.g. right after construction/restore).
        if (state.resetting) driveInactive(io, isMax(io));
      },
      // Tier B+ EU batching: run every CPU tick of a cpu-only schedule
      // segment back-to-back. INTR/NMI/RESET cannot change inside the segment
      // (nothing else executes), so they are sampled once. Returns the number
      // of half-cycles consumed; stops early (after the offending tick) when
      // an IO/INTA cycle needs the real pins.
      fastBurst(io, state, props, chip, seg) {
        if (state.resetting) return 0;
        const core = chip.runtime.core;
        const sim = io.sim;
        core.dbgAccess = sim.dbg ? (core.dbgAccess || K.Debug.mkAccess(sim, chip)) : null;
        const pn = pinNets(chip);
        const nv = sim.netVal;
        if ((pn.reset < 0 ? SIG.H : K.ttlRead(nv[pn.reset])) === SIG.H) return 0;
        core.setINTR((pn.intr < 0 ? SIG.H : K.ttlRead(nv[pn.intr])) === SIG.H);
        core.setNMI((pn.nmi < 0 ? SIG.H : K.ttlRead(nv[pn.nmi])) === SIG.H);
        const ticks = seg.ticks, id = chip.comp.id;
        for (let r = 0; r < ticks.length; r++) {
          if (core.euBlocked === "halt" && ((core.intrLine && (core.fl & IF)) || core.nmiLatch)) core.wake();
          core.retired = false;
          core.tick();
          chip.runtime.atBoundary = core.retired;
          if (core.retired) {
            chip.runtime.retired = true;
            state.arch = core.boundary;
            if (sim.dbg) {
              K.Debug.retire(sim, chip, core);
              if (sim.dbgStop) return ticks[r] + 1;   // breakpoint: end the burst here
            }
          }
          if (core.error) { io.halt("cpu-error", core.error); return ticks[r] + 1; }
          const b = core.bus;
          if (b) {
            if (b.sp === "m") {
              if (!b.serviced && b.t >= 2) {
                b.serviced = true;
                b.ready = true;
                if (b.kind === "w") {
                  sim.fastWrite(id, b.addr, b.dataOut & 0xFF);
                  if (b.word) sim.fastWrite(id, (b.addr + 1) & 0xFFFFF, (b.dataOut >> 8) & 0xFF);
                } else {
                  b.dataIn = sim.fastRead(id, b.addr);
                  if (b.word) b.dataIn |= sim.fastRead(id, (b.addr + 1) & 0xFFFFF) << 8;
                }
              }
            } else {
              // IO/INTA cycle: unpark NOW so its T1 drives the real pins
              chip.runtime.parked = false;
              drivePins(io, core, true);
              return ticks[r] + 1;
            }
          }
        }
        return seg.len;
      },
      onEdge(pin, rising, io, state, props, chip) {
        const core = chip.runtime.core;
        // Tier B: with a proved memory map, memory bus cycles are serviced directly
        // (identical cycle stream, no pin activity); IO/INTA still use real pins.
        const fast = io.sim.fastMode && io.sim.memMap;
        const pn = pinNets(chip);
        const nv = io.sim.netVal;
        if (rising) {
          if ((pn.reset < 0 ? SIG.H : K.ttlRead(nv[pn.reset])) === SIG.H) {
            if (!state.resetting) { core.reset(); state.resetting = true; state.arch = core.saveArch(); }
            driveInactive(io, isMax(io));
            return;
          }
          state.resetting = false;
          core.dbgAccess = io.sim.dbg ? (core.dbgAccess || K.Debug.mkAccess(io.sim, chip)) : null;
          core.setINTR((pn.intr < 0 ? SIG.H : K.ttlRead(nv[pn.intr])) === SIG.H);
          core.setNMI((pn.nmi < 0 ? SIG.H : K.ttlRead(nv[pn.nmi])) === SIG.H);
          if (core.euBlocked === "halt" && ((core.intrLine && (core.fl & IF)) || core.nmiLatch)) core.wake();
          core.retired = false;
          core.tick();
          chip.runtime.atBoundary = core.retired; // snapshots are only taken here
          if (core.retired) {
            chip.runtime.retired = true;
            state.arch = core.boundary;         // exact state at the insn boundary
            if (io.sim.dbg) K.Debug.retire(io.sim, chip, core);
          }
          if (core.error) io.halt("cpu-error", core.error);
          const b = core.bus;
          if (fast && (!b || b.sp === "m")) {
            if (b && !b.serviced && b.t >= 2) {
              b.serviced = true;
              b.ready = true;                   // fast path assumes zero wait states
              if (b.kind === "w") {
                io.sim.fastWrite(chip.comp.id, b.addr, b.dataOut & 0xFF);
                if (b.word) io.sim.fastWrite(chip.comp.id, (b.addr + 1) & 0xFFFFF, (b.dataOut >> 8) & 0xFF);
              } else {
                b.dataIn = io.sim.fastRead(chip.comp.id, b.addr);
                if (b.word) b.dataIn |= io.sim.fastRead(chip.comp.id, (b.addr + 1) & 0xFFFFF) << 8;
              }
            }
            if (!chip.runtime.parked) { driveInactive(io, isMax(io)); chip.runtime.parked = true; }
          } else {
            chip.runtime.parked = false;
            drivePins(io, core, true);
          }
        } else {
          chip.runtime.atBoundary = false;
          if (state.resetting || io.in("RESET") === SIG.H) return;
          if (fast && (!core.bus || core.bus.sp === "m")) {
            // idle or fast-served memory cycle: pins stay parked (driving the
            // inactive pattern every falling edge was the turbo hot spot)
            if (!chip.runtime.parked) { driveInactive(io, isMax(io), core.lock); chip.runtime.parked = true; }
            return;
          }
          sampleData(io, core);
          drivePins(io, core, false);           // ALE drops mid-T1
        }
      },
    };
  }

  K.defineChip({
    type: "8088", name: "8088 CPU (min mode)",
    dip: ["g:GND", "t:A14", "t:A13", "t:A12", "t:A11", "t:A10", "t:A9", "t:A8",
          "io:AD7", "io:AD6", "io:AD5", "io:AD4", "io:AD3", "io:AD2", "io:AD1", "io:AD0",
          "i:NMI", "i:INTR", "i:CLK", "g:GND2",
          "i:RESET", "i:READY", "i:~TEST", "t:~INTA", "t:ALE", "t:~DEN", "t:DT/~R", "t:IO/~M",
          "t:~WR", "t:HLDA", "i:HOLD", "t:~RD", "i:MN/~MX", "t:~SS0",
          "t:A19", "t:A18", "t:A17", "t:A16", "t:A15", "p:VCC"],
    ...makeCpu(false),
  });

  K.defineChip({
    type: "8086", name: "8086 CPU (min mode)",
    dip: ["g:GND", "io:AD14", "io:AD13", "io:AD12", "io:AD11", "io:AD10", "io:AD9", "io:AD8",
          "io:AD7", "io:AD6", "io:AD5", "io:AD4", "io:AD3", "io:AD2", "io:AD1", "io:AD0",
          "i:NMI", "i:INTR", "i:CLK", "g:GND2",
          "i:RESET", "i:READY", "i:~TEST", "t:~INTA", "t:ALE", "t:~DEN", "t:DT/~R", "t:M/~IO",
          "t:~WR", "t:HLDA", "i:HOLD", "t:~RD", "i:MN/~MX", "t:~BHE",
          "t:A19", "t:A18", "t:A17", "t:A16", "io:AD15", "p:VCC"],
    ...makeCpu(true),
  });
})(globalThis.K8086 ??= {});
