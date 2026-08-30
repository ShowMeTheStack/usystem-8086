"use strict";
(function (K) {
  K.hex = (v, w = 4) => v.toString(16).toUpperCase().padStart(w, "0");
  K.assert = (cond, msg) => { if (!cond) throw new Error("assert: " + (msg || "failed")); };
  K.clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  let idCounter = 1;
  K.uid = (prefix) => (prefix || "id") + (idCounter++);
  K.resetUid = (n) => { idCounter = n || 1; };
  // Decode an embedded build asset (assets/<name>.b64) into a fresh Uint8Array.
  K.assetBytes = function (name) {
    const b64 = K.assets && K.assets[name];
    if (!b64) return null;
    if (typeof atob === "function") {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xFF;
      return out;
    }
    return new Uint8Array(Buffer.from(b64, "base64"));
  };

  // Deep clone for serializable state (plain objects, arrays, typed arrays).
  K.clone = function clone(v) {
    if (v === null || typeof v !== "object") return v;
    if (ArrayBuffer.isView(v)) return v.slice();
    if (Array.isArray(v)) return v.map(clone);
    const o = {};
    for (const k in v) o[k] = clone(v[k]);
    return o;
  };
})(globalThis.K8086 ??= {});
