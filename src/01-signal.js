"use strict";
(function (K) {
  // Resolved net values.
  K.SIG = { Z: 0, L: 1, H: 2, X: 3 };
  K.SIG_NAME = ["Z", "0", "1", "X"];
  // Per-pin drive values.
  K.DRV = { NONE: 0, D0: 1, D1: 2, W1: 3, W0: 4 };

  // Resolve a set of pin drives into a net value.
  // Contention = strong 0 and strong 1 together. Weak pulls lose to strong drives.
  K.resolve = function (drives, n) {
    let s0 = false, s1 = false, w0 = false, w1 = false;
    for (let i = 0; i < n; i++) {
      const d = drives[i];
      if (d === K.DRV.D0) s0 = true;
      else if (d === K.DRV.D1) s1 = true;
      else if (d === K.DRV.W1) w1 = true;
      else if (d === K.DRV.W0) w0 = true;
    }
    if (s0 && s1) return K.SIG.X;
    if (s0) return K.SIG.L;
    if (s1) return K.SIG.H;
    if (w0 && w1) return K.SIG.X;
    if (w1) return K.SIG.H;
    if (w0) return K.SIG.L;
    return K.SIG.Z;
  };

  // What a TTL input reads: floating (Z) reads as logic 1, X reads as X.
  K.ttlRead = (v) => v === K.SIG.Z ? K.SIG.H : v;
})(globalThis.K8086 ??= {});
