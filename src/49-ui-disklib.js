"use strict";
(function (K) {
  if (typeof document === "undefined") return;
  const h = (...a) => K.h(...a);

  // Disk image library: fixed built-ins (the FreeDOS install floppy and the
  // on-demand synthesized bootable FreeDOS hard disk) plus user images kept
  // in IndexedDB across sessions. Every image can be inserted/attached,
  // duplicated, exported to the user's machine, or populated from a local
  // folder (files copied INTO the image's FAT filesystem, subfolders kept).

  const DB = "u8086-disks", STORE = "images";
  function idb() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: "name" });
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function idbAll() {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const rq = db.transaction(STORE).objectStore(STORE).getAll();
        rq.onsuccess = () => res(rq.result || []);
        rq.onerror = () => rej(rq.error);
      });
    } catch { return []; }
  }
  async function idbPut(rec) {
    try {
      const db = await idb();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(rec);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      return true;
    } catch { return false; }
  }
  async function idbDelete(name) {
    try {
      const db = await idb();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(name);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } catch { /* ignore */ }
  }

  let fdHddCache = null;
  const BUILTINS = [
    {
      name: "FreeDOS 1.3 install floppy", kind: "floppy", builtin: true,
      make: () => K.assetBytes("freedos144"),
    },
    {
      name: "FreeDOS system HDD (bootable, synthesized)", kind: "hdd", builtin: true,
      make: () => (fdHddCache ??= K.buildFreeDosHdd(K.assetBytes("freedos144"))),
    },
  ];

  const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";
  const bytesOf = (item) => item.builtin ? item.make() : new Uint8Array(item.bytes);

  // copy a local folder's files into an image's filesystem (8.3-mangled)
  function populate(imgBytes, kind, files, report) {
    const fs = kind === "hdd" ? K.hddPartition(imgBytes) : imgBytes;
    if (!fs) { report.push("not a recognizable image"); return; }
    for (const f of files) {
      const path = (f.rel || f.name).split("/").filter(Boolean);
      const base = path.pop();
      let err = K.fatAdd(fs, [...path, base].join("/"), f.bytes);
      if (err === "file already exists") {
        // uniquify: BASE~1.EXT .. BASE~9.EXT
        const dot = base.lastIndexOf(".");
        const stem = (dot > 0 ? base.slice(0, dot) : base).slice(0, 6);
        const ext = dot > 0 ? base.slice(dot) : "";
        for (let n = 1; n <= 9 && err === "file already exists"; n++)
          err = K.fatAdd(fs, [...path, `${stem}~${n}${ext}`].join("/"), f.bytes);
        if (!err) report.push(`renamed: ${f.rel || f.name}`);
      }
      if (err) report.push(`skipped ${f.rel || f.name}: ${err}`);
    }
  }

  K.DiskLib = {
    async open(app, target) {
      const users = await idbAll();
      const items = [...BUILTINS, ...users.map(u => ({ ...u, builtin: false }))];
      const body = h("div", { class: "dlBody" });
      const report = h("div", { class: "dlReport" });
      const rerender = () => { K.closeModal(); this.open(app, target); };

      const fdcComp = app.doc.components.find(c => K.chips[c.type].isFdc);
      const ideComp = app.doc.components.find(c => c.type === "XTIDE");

      const list = h("div", { class: "dlList" });
      for (const item of items) {
        const size = item.builtin ? (item.kind === "hdd" ? K.HDD_BYTES : 1474560) : item.bytes.byteLength;
        const row = h("div", { class: "dlRow" },
          h("span", { class: "dlKind" }, item.kind === "hdd" ? "🖴" : "💾"),
          h("span", { class: "dlName" }, item.name, item.builtin ? h("small", {}, " · built-in") : ""),
          h("span", { class: "dlSize" }, fmtSize(size)),
          h("span", { class: "spacer" }));
        // use it
        if (item.kind === "floppy" && fdcComp && app.sim)
          row.append(h("button", { onclick: () => {
            K.fdcInsert(app.sim, fdcComp.id, bytesOf(item).slice());
            app.setHint(`inserted “${item.name}” into ${fdcComp.props.ref || "the drive"}`);
            K.closeModal();
          } }, "⏏ insert A:"));
        if (item.kind === "hdd" && ideComp && app.sim)
          row.append(h("button", { onclick: () => {
            app.sim.chipFor(ideComp.id).runtime.hdd = bytesOf(item).slice();
            app.setHint(`attached “${item.name}” as drive C:`);
            K.closeModal();
          } }, "🖴 attach C:"));
        // duplicate (built-in -> your writable copy; custom -> copy)
        row.append(h("button", { onclick: async () => {
          const name = prompt("Name for the copy:", item.name.replace(" (bootable, synthesized)", "") + " copy");
          if (!name) return;
          const b = bytesOf(item);
          if (!await idbPut({ name, kind: item.kind, bytes: b.slice().buffer }))
            report.textContent = "browser storage unavailable — use export instead";
          rerender();
        } }, "⧉ duplicate"));
        // export to the user's machine
        row.append(h("button", { onclick: () => {
          const blob = new Blob([bytesOf(item)], { type: "application/octet-stream" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = item.name.replace(/[^\w\- ]+/g, "").trim().replace(/ +/g, "-") + ".img";
          a.click();
        } }, "⇩ export"));
        if (!item.builtin) {
          row.append(h("button", { onclick: async () => {
            const files = await pickFolder();
            if (!files.length) return;
            const bytes = new Uint8Array(item.bytes);
            const rep = [];
            populate(bytes, item.kind, files, rep);
            await idbPut({ name: item.name, kind: item.kind, bytes: bytes.buffer });
            report.textContent = `${files.length - rep.filter(r => r.startsWith("skipped")).length}/${files.length} files copied in` +
              (rep.length ? ` — ${rep.slice(0, 4).join("; ")}${rep.length > 4 ? "…" : ""}` : "");
          } }, "📁 populate"));
          row.append(h("button", { onclick: async () => { await idbDelete(item.name); rerender(); } }, "🗑"));
        }
        list.append(row);
      }
      body.append(list);

      // library-wide actions
      const kindSel = h("select", { class: "ctSel" },
        h("option", { value: "1.44M" }, "1.44M floppy"),
        h("option", { value: "720K" }, "720K floppy"),
        h("option", { value: "360K" }, "360K floppy"),
        h("option", { value: "hdd" }, "10.4 MB hard disk"));
      body.append(h("div", { class: "dlActions" },
        kindSel,
        h("button", { onclick: async () => {
          const name = prompt("Name for the new image:", "my disk");
          if (!name) return;
          const v = kindSel.value;
          const img = v === "hdd" ? K.fatFormatHdd() : K.fatFormat(v);
          if (!await idbPut({ name, kind: v === "hdd" ? "hdd" : "floppy", bytes: img.buffer }))
            report.textContent = "browser storage unavailable";
          rerender();
        } }, "＋ new blank (formatted)"),
        h("button", { onclick: () => {
          const inp = document.createElement("input");
          inp.type = "file"; inp.accept = ".img,.ima,.bin";
          inp.onchange = async () => {
            const f = inp.files[0];
            if (!f) return;
            const b = new Uint8Array(await f.arrayBuffer());
            const kind = b.length > 3000000 ? "hdd" : "floppy";
            await idbPut({ name: f.name.replace(/\.\w+$/, ""), kind, bytes: b.buffer });
            rerender();
          };
          inp.click();
        } }, "⇪ import .img"),
        h("span", { class: "dlHint" }, "images persist in this browser; export for durable copies")));
      body.append(report);
      K.openModal("Disk library", body, [["Close", null, "primary"]]);
      document.getElementById("modalBox").classList.add("wide");
      K._modalOnClose = () => document.getElementById("modalBox").classList.remove("wide");
    },
  };

  function pickFolder() {
    return new Promise((res) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.webkitdirectory = true;
      inp.onchange = async () => {
        const out = [];
        for (const f of inp.files) {
          const rel = (f.webkitRelativePath || f.name).split("/").slice(1).join("/") || f.name;
          out.push({ rel, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
        }
        res(out);
      };
      inp.click();
    });
  }
})(globalThis.K8086 ??= {});
