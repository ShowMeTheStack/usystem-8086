"use strict";
(function (K) {
  if (typeof document === "undefined") return;

  // XT scancode set 1 — browser KeyboardEvent.code -> make code.
  const SC = {
    Escape: 0x01, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06,
    Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0A, Digit0: 0x0B, Minus: 0x0C,
    Equal: 0x0D, Backspace: 0x0E, Tab: 0x0F,
    KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16,
    KeyI: 0x17, KeyO: 0x18, KeyP: 0x19, BracketLeft: 0x1A, BracketRight: 0x1B, Enter: 0x1C,
    ControlLeft: 0x1D, KeyA: 0x1E, KeyS: 0x1F, KeyD: 0x20, KeyF: 0x21, KeyG: 0x22,
    KeyH: 0x23, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26, Semicolon: 0x27, Quote: 0x28,
    Backquote: 0x29, ShiftLeft: 0x2A, Backslash: 0x2B, KeyZ: 0x2C, KeyX: 0x2D, KeyC: 0x2E,
    KeyV: 0x2F, KeyB: 0x30, KeyN: 0x31, KeyM: 0x32, Comma: 0x33, Period: 0x34,
    Slash: 0x35, ShiftRight: 0x36, AltLeft: 0x38, Space: 0x39, CapsLock: 0x3A,
  };

  // Drawn keyboard layout: rows of [label, scancode, widthUnits].
  K.KBD_LAYOUT = [
    [["ESC", 0x01, 1], ["1", 0x02, 1], ["2", 0x03, 1], ["3", 0x04, 1], ["4", 0x05, 1], ["5", 0x06, 1], ["6", 0x07, 1], ["7", 0x08, 1], ["8", 0x09, 1], ["9", 0x0A, 1], ["0", 0x0B, 1], ["-", 0x0C, 1], ["=", 0x0D, 1], ["◄─", 0x0E, 1.6]],
    [["⇥", 0x0F, 1.4], ["Q", 0x10, 1], ["W", 0x11, 1], ["E", 0x12, 1], ["R", 0x13, 1], ["T", 0x14, 1], ["Y", 0x15, 1], ["U", 0x16, 1], ["I", 0x17, 1], ["O", 0x18, 1], ["P", 0x19, 1], ["[", 0x1A, 1], ["]", 0x1B, 1], ["↵", 0x1C, 1.2]],
    [["CTL", 0x1D, 1.7], ["A", 0x1E, 1], ["S", 0x1F, 1], ["D", 0x20, 1], ["F", 0x21, 1], ["G", 0x22, 1], ["H", 0x23, 1], ["J", 0x24, 1], ["K", 0x25, 1], ["L", 0x26, 1], [";", 0x27, 1], ["'", 0x28, 1], ["`", 0x29, 1], ["\\", 0x2B, 0.9]],
    [["⇧", 0x2A, 2.2], ["Z", 0x2C, 1], ["X", 0x2D, 1], ["C", 0x2E, 1], ["V", 0x2F, 1], ["B", 0x30, 1], ["N", 0x31, 1], ["M", 0x32, 1], [",", 0x33, 1], [".", 0x34, 1], ["/", 0x35, 1], ["⇧", 0x36, 2.4]],
    [["ALT", 0x38, 2], ["SPACE", 0x39, 9.6], ["CAPS", 0x3A, 2]],
  ];

  K.KbdCapture = {
    pressed: new Set(),          // scancodes currently down (for rendering)
    attach(app) {
      const activeKbd = () => {
        if (!app.sim || app.paused) return null;
        // the CRT+keyboard view deliberately keeps typing live inside its modal
        if (!this.modalOverride && document.getElementById("modal").classList.contains("open")) return null;
        const ae = document.activeElement;
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT")) return null;
        return app.doc.components.find(c => c.type === "XTKBD") || null;
      };
      window.addEventListener("keydown", (e) => {
        const kbd = activeKbd();
        const sc = SC[e.code];
        if (!kbd || sc === undefined || e.metaKey) return;
        e.preventDefault();
        if (!e.repeat) {
          app.sim.applyInput(kbd.id, { scan: sc });
          this.pressed.add(sc);
        }
      });
      window.addEventListener("keyup", (e) => {
        const sc = SC[e.code];
        if (sc === undefined) return;
        this.pressed.delete(sc);
        const kbd = activeKbd();
        if (kbd) app.sim.applyInput(kbd.id, { scan: sc | 0x80 });
      });
      window.addEventListener("blur", () => this.pressed.clear());
    },
  };
})(globalThis.K8086 ??= {});
