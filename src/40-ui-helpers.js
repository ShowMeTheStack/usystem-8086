"use strict";
(function (K) {
  if (typeof document === "undefined") return; // headless tests skip UI

  // Tiny DOM builder: h("div", {class:"x", onclick}, child, "text")
  K.h = function (tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
      // boolean attributes disable/check by PRESENCE: false/null must mean "absent"
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      el.append(c.nodeType ? c : document.createTextNode(c));
    }
    return el;
  };

  K.openModal = function (title, bodyEl, buttons) {
    const modal = document.getElementById("modal");
    const box = document.getElementById("modalBox");
    box.innerHTML = "";
    box.append(K.h("h3", {}, title));
    const body = K.h("div", { id: "modalBody" }, bodyEl);
    box.append(body);
    const btns = K.h("div", { id: "modalBtns" });
    for (const [label, fn, cls] of buttons || [["Close", null]]) {
      btns.append(K.h("button", { class: cls || "", onclick: () => { if (!fn || fn() !== false) K.closeModal(); } }, label));
    }
    box.append(btns);
    modal.classList.add("open");
    return body;
  };
  K.closeModal = () => {
    document.getElementById("modal").classList.remove("open");
    if (K._modalOnClose) { const fn = K._modalOnClose; K._modalOnClose = null; fn(); }
  };

  K.downloadCanvasPng = function (canvas, name) {
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
  };

  K.sigClass = (v) => ["vz", "v0", "v1", "vx"][v];
  K.fmtSig = (v) => K.SIG_NAME[v];
})(globalThis.K8086 ??= {});
