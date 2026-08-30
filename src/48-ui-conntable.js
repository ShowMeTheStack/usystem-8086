"use strict";
(function (K) {
  if (typeof document === "undefined") return;
  const h = (...a) => K.h(...a);

  // Tabular wiring: one row per pin — existing connections as removable chips,
  // plus ranked chip/pin dropdowns to add a wire without touching the canvas.
  // Rendered in the right-hand Chip pane AND as a tab in the properties popup.
  K.ConnTable = {
    render(app, comp, container) {
      const def = K.chips[comp.type];
      const readOnly = !!app.sim;
      container.innerHTML = "";
      if (readOnly)
        container.append(h("div", { class: "ctNote" }, "board is frozen while running — stop to edit connections"));

      const table = h("table", { class: "ctTable" });
      table.append(h("tr", {},
        h("th", {}, "pin"),
        h("th", {}, "connected to"),
        readOnly ? "" : h("th", {}, "add connection")));

      for (const pin of def.pins) {
        const key = K.pinKey(comp, pin.name);
        const row = h("tr", {});
        row.append(h("td", { class: "ctPin" }, pin.name, h("small", {}, " " + pin.kind)));

        // direct wires from this pin (removable), plus net co-members (info)
        const peers = h("td", { class: "ctPeers" });
        const direct = app.doc.wires.filter(w => w.a === key || w.b === key);
        for (const w of direct) {
          const other = w.a === key ? w.b : w.a;
          const oc = app.compOf(other);
          const label = `${oc ? (oc.props.ref || oc.id) : "?"}.${other.slice(other.indexOf(".") + 1)}`;
          const chipEl = h("span", { class: "ctChip" }, label);
          if (!readOnly) chipEl.append(h("span", {
            class: "ctX", title: "remove this wire",
            onclick: () => { app.doc.wires = app.doc.wires.filter(x => x !== w); app.docChanged(); this.render(app, comp, container); },
          }, "⊗"));
          peers.append(chipEl);
        }
        const net = app.netsNow().get(key);
        if (net && net.pins.length > direct.length + 1) {
          const extra = net.pins.filter(p => {
            const pk2 = K.pinKey(p.comp, p.pin.name);
            return pk2 !== key && !direct.some(w => w.a === pk2 || w.b === pk2);
          }).slice(0, 6);
          if (extra.length)
            peers.append(h("span", { class: "ctVia", title: "on the same net through other wires" },
              "· net: " + extra.map(p => `${p.comp.props.ref || p.comp.id}.${p.pin.name}`).join(", ")));
        }
        if (!direct.length && (!net || net.pins.length <= 1))
          peers.append(h("span", { class: "ctNone" }, "—"));
        row.append(peers);

        if (!readOnly) {
          const cell = h("td", { class: "ctAdd" });
          const chipSel = h("select", { class: "ctSel" }, h("option", { value: "" }, "chip…"));
          const pinSel = h("select", { class: "ctSel", disabled: true }, h("option", { value: "" }, "pin…"));
          const addBtn = h("button", { class: "ctBtn", disabled: true, title: "connect" }, "+");
          const busBtn = h("button", { class: "ctBtn ctBus", style: "display:none", title: "connect the whole pin family as a bus" }, "⇶ bus");
          let ranked = null;
          const ensureRanked = () => {
            if (!ranked) {
              ranked = K.rankConnTargets(app.doc, comp, pin);
              for (const r of ranked)
                chipSel.append(h("option", { value: r.comp.id },
                  `${r.comp.props.ref || r.comp.id} · ${r.comp.type}`));
            }
          };
          chipSel.addEventListener("mousedown", ensureRanked);
          chipSel.addEventListener("focus", ensureRanked);
          chipSel.addEventListener("change", () => {
            pinSel.innerHTML = "";
            pinSel.disabled = !chipSel.value;
            addBtn.disabled = !chipSel.value;
            busBtn.style.display = "none";
            if (!chipSel.value) return;
            const r = ranked.find(x => x.comp.id === chipSel.value);
            for (const pn of r.pinOrder) pinSel.append(h("option", { value: pn }, pn));
            pinSel.value = r.bestPin || r.pinOrder[0];
            pinSel.dispatchEvent(new Event("change"));
          });
          pinSel.addEventListener("change", () => {
            // bus accelerator: both ends are numbered families with siblings
            busBtn.style.display = "none";
            const mf = /^(.*?)(\d+)$/.exec(pin.name);
            const tf = /^(.*?)(\d+)$/.exec(pinSel.value || "");
            if (mf && tf && chipSel.value) {
              const target = K.docComp(app.doc, chipSel.value);
              const tdef = K.chips[target.type];
              const offset = +tf[2] - +mf[2];
              let n = 0;
              for (const p2 of def.pins)
                if (p2.name.startsWith(mf[1]) && /^\d+$/.test(p2.name.slice(mf[1].length)) &&
                    tdef.pinIndex[tf[1] + (+p2.name.slice(mf[1].length) + offset)] !== undefined) n++;
              if (n >= 3) { busBtn.style.display = ""; busBtn.textContent = `⇶ bus ×${n}`; }
            }
          });
          const wireExists = (a, b) => app.doc.wires.some(w =>
            (w.a === a && w.b === b) || (w.a === b && w.b === a));
          addBtn.addEventListener("click", () => {
            if (!chipSel.value || !pinSel.value) return;
            const target = K.docComp(app.doc, chipSel.value);
            const tkey = K.pinKey(target, pinSel.value);
            if (wireExists(key, tkey)) { app.setHint("already connected"); return; }
            K.docConnect(app.doc, key, tkey);
            app.docChanged();
            this.render(app, comp, container);
          });
          busBtn.addEventListener("click", () => {
            const mf = /^(.*?)(\d+)$/.exec(pin.name);
            const tf = /^(.*?)(\d+)$/.exec(pinSel.value);
            const target = K.docComp(app.doc, chipSel.value);
            const tdef = K.chips[target.type];
            const offset = +tf[2] - +mf[2];
            const bundle = K.uid("b");
            let n = 0;
            for (const p2 of def.pins) {
              if (!p2.name.startsWith(mf[1])) continue;
              const tail = p2.name.slice(mf[1].length);
              if (!/^\d+$/.test(tail)) continue;
              const tname = tf[1] + (+tail + offset);
              if (tdef.pinIndex[tname] === undefined) continue;
              const ka = K.pinKey(comp, p2.name), kb = K.pinKey(target, tname);
              if (wireExists(ka, kb)) continue;
              K.docConnect(app.doc, ka, kb, bundle);
              n++;
            }
            app.docChanged();
            app.setHint(`bus connected from the table: ${n} wires`);
            this.render(app, comp, container);
          });
          cell.append(chipSel, pinSel, addBtn, busBtn);
          row.append(cell);
        }
        table.append(row);
      }
      container.append(table);
    },
  };
})(globalThis.K8086 ??= {});
