// Builds the static guide site from tools/guide/content.mjs + the screenshot
// manifest written by tools/guide/shoot.mjs. Output: guide/*.html.
//   node tools/guide/build.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SITE, PAGES, REFERENCE } from "./content.mjs";
import { BOARDS } from "./boards.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const OUT = root + "guide/";
if (!existsSync(OUT + "manifest.json")) {
  console.error("no manifest — run tools/guide/shoot.mjs first");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(OUT + "manifest.json", "utf8"));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// section -> sub -> [shots]
const bySection = new Map();
for (const shot of manifest) {
  if (!bySection.has(shot.section)) bySection.set(shot.section, new Map());
  const subs = bySection.get(shot.section);
  if (!subs.has(shot.sub)) subs.set(shot.sub, []);
  subs.get(shot.sub).push(shot);
}

const order = ["overview", "canvas", "boards", "chips", "autowiring", "running",
  "debugging", "waveforms", "memory", "disks", "devices", "themes"];
const pageList = order.filter(id => PAGES[id]);

const navFor = (current) => `
<nav class="topnav">
  <a class="brand" href="index.html"><b>µSystem 8086</b><span>guide</span></a>
  <div class="navlinks">
    ${pageList.map(id => `<a href="${id}.html"${id === current ? ' class="here"' : ""}>${esc(PAGES[id].nav)}</a>`).join("")}
    <a href="reference.html"${current === "reference" ? ' class="here"' : ""}>Reference</a>
  </div>
  <a class="launch" href="../index.html" title="open the simulator">Open the tool ↗</a>
</nav>`;

const shell = (title, current, body, opts = {}) => `<!doctype html>
<html lang="en" data-page="${current}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(SITE.name)}</title>
<meta name="description" content="${esc(opts.desc || SITE.blurb)}">
<link rel="stylesheet" href="guide.css">
</head>
<body>
${navFor(current)}
${body}
<footer>
  <p><b>${esc(SITE.name)}</b> — a cycle-accurate 8086/8088 trainer in a single HTML file.
  Every screenshot in this guide was captured automatically from the running tool.</p>
  <p class="small">${manifest.length} screenshots · ${pageList.length + 1} sections ·
  <a href="../index.html">open the simulator</a></p>
</footer>
<div id="lightbox" hidden>
  <button id="lbClose" aria-label="close">✕</button>
  <button id="lbPrev" aria-label="previous">‹</button>
  <img id="lbImg" alt="">
  <button id="lbNext" aria-label="next">›</button>
  <div id="lbCap"></div>
</div>
<script src="guide.js"></script>
</body>
</html>`;

const figure = (shot, i) => `
<figure class="shot" data-i="${i}">
  <img loading="lazy" src="shots/${shot.file}" alt="${esc(shot.title)}">
  <figcaption><b>${esc(shot.title)}</b>${shot.caption ? " — " + esc(shot.caption) : ""}</figcaption>
</figure>`;

let figIndex = 0;
const lbData = [];
const renderShots = (shots, cls = "grid") => {
  const html = shots.map((s) => {
    lbData.push({ file: s.file, title: s.title, caption: s.caption || "" });
    return figure(s, figIndex++);
  }).join("");
  return `<div class="${cls}">${html}</div>`;
};

// ----------------------------------------------------------- boards page ----
// The boards section is not a gallery: each board is an article — what it is,
// the chips, the map, the program, and things to actually try — with its
// screenshots placed where they explain something.
function renderBoardsPage() {
  const page = PAGES.boards;
  const subs = bySection.get("boards") || new Map();
  const shots = [...subs.values()].flat();
  const byBoard = new Map();
  for (const s of shots) {
    if (!byBoard.has(s.board)) byBoard.set(s.board, []);
    byBoard.get(s.board).push(s);
  }
  const order = [...byBoard.keys()];
  const nameOf = (id) => (shots.find(s => s.board === id && s.kind === "board") || {}).title || id;
  const pick = (list, kind) => list.filter(s => s.kind === kind);
  const one = (list, kind) => pick(list, kind)[0];

  let body = `<main class="page">
  <div class="pagehead"><h1>${esc(page.title)}</h1><p class="lede">${esc(page.blurb)}</p></div>
  <div class="layout">
    <aside class="toc">
      <div class="toctitle">The boards</div>
      ${order.map(id => `<a href="#${slug(id)}">${esc(nameOf(id))}</a>`).join("")}
      <div class="tocmeta">${shots.length} screenshots</div>
    </aside>
    <div class="content">
      <div class="intro">${page.intro || ""}</div>`;

  for (const id of order) {
    const list = byBoard.get(id);
    const info = BOARDS[id] || {};
    const hero = one(list, "board");
    const details = pick(list, "detail");
    const labelFor = (key) => {
      const s = details.find(d => d.id === `board-${id}-${slug(key)}`);
      return s ? s.title : key;
    };
    body += `<section id="${slug(id)}" class="board" data-name="${esc(nameOf(id).toLowerCase())}">
      <h2>${esc(nameOf(id))}</h2>
      ${info.one ? `<p class="one">${esc(info.one)}</p>` : ""}
      ${hero ? renderShots([hero], "grid hero1") : ""}
      <div class="story">${info.story || ""}</div>`;
    if (info.chips && info.chips.length) {
      body += `<h3>The chips</h3>
        <table><thead><tr><th>Part</th><th>What it does here</th></tr></thead><tbody>
        ${info.chips.map(([k, role]) => `<tr><td>${esc(labelFor(k))}</td><td>${esc(role)}</td></tr>`).join("")}
        </tbody></table>`;
      if (details.length) body += renderShots(details, "grid gal");
    }
    if (info.map && info.map.length) {
      body += `<h3>The map</h3>
        <table><thead><tr><th>Address / signal</th><th>What answers</th></tr></thead><tbody>
        ${info.map.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("")}
        </tbody></table>`;
    }
    if (info.program) {
      body += `<h3>The program</h3>${info.program}`;
      if (info.code) body += `<pre class="code"><code>${esc(info.code)}</code></pre>`;
    }
    const live = [one(list, "running"), one(list, "wave")].filter(Boolean);
    if (live.length) body += renderShots(live, "grid");
    if (info.tries && info.tries.length) {
      body += `<h3>Try this</h3><ol class="tries">
        ${info.tries.map(t => `<li><b>${esc(t.t)}</b>${t.s}</li>`).join("")}
      </ol>`;
    }
    const lab = one(list, "lab");
    if (lab) body += renderShots([lab], "grid hero1");
    body += `</section>`;
  }
  body += `</div></div></main>`;
  writeFileSync(OUT + "boards.html", shell(page.title, "boards", body, { desc: page.blurb }));
}

// ---------------------------------------------------------------- pages ----
for (const id of pageList) {
  if (id === "boards") { renderBoardsPage(); continue; }
  const page = PAGES[id];
  const subs = bySection.get(id) || new Map();
  const subNames = [...subs.keys()];
  let body = `<main class="page">
  <div class="pagehead">
    <h1>${esc(page.title)}</h1>
    <p class="lede">${esc(page.blurb)}</p>
  </div>
  <div class="layout">
    <aside class="toc">
      <div class="toctitle">On this page</div>
      ${subNames.map(s => `<a href="#${slug(s)}">${esc(s)}</a>`).join("")}
      <div class="tocmeta">${subs.size ? [...subs.values()].reduce((n, a) => n + a.length, 0) : 0} screenshots</div>
    </aside>
    <div class="content">
      <div class="intro">${page.intro || ""}</div>`;
  if (page.gallery) body += `<div class="filterbar"><input id="filter" placeholder="filter — type a board, chip or theme name" autocomplete="off"><span id="filterCount"></span></div>`;
  for (const [sub, shots] of subs) {
    body += `<section id="${slug(sub)}" class="sub" data-name="${esc(sub.toLowerCase())}">
      <h2>${esc(sub)}</h2>
      ${(page.subs && page.subs[sub]) || ""}
      ${renderShots(shots, page.gallery ? "grid gal" : "grid")}
    </section>`;
  }
  body += `</div></div></main>`;
  writeFileSync(OUT + id + ".html", shell(page.title, id, body, { desc: page.blurb }));
}

// ------------------------------------------------------------- reference ----
{
  const secs = REFERENCE.sections;
  const body = `<main class="page">
  <div class="pagehead"><h1>${esc(REFERENCE.title)}</h1><p class="lede">${esc(REFERENCE.blurb)}</p></div>
  <div class="layout">
    <aside class="toc">
      <div class="toctitle">On this page</div>
      ${secs.map(s => `<a href="#${slug(s.h)}">${esc(s.h)}</a>`).join("")}
    </aside>
    <div class="content">
      ${secs.map(s => `<section id="${slug(s.h)}" class="sub">
        <h2>${esc(s.h)}</h2>
        ${s.note ? `<p>${esc(s.note)}</p>` : ""}
        <table><thead><tr>${s.table[0].map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${s.table.slice(1).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
      </section>`).join("")}
    </div>
  </div></main>`;
  writeFileSync(OUT + "reference.html", shell(REFERENCE.title, "reference", body, { desc: REFERENCE.blurb }));
}

// ----------------------------------------------------------------- index ----
{
  const hero = manifest.find(m => m.id === "workspace-full") || manifest[0];
  const cards = pageList.map(id => {
    const p = PAGES[id];
    const subs = bySection.get(id) || new Map();
    const count = [...subs.values()].reduce((n, a) => n + a.length, 0);
    const thumb = (subs.values().next().value || [])[0];
    return `<a class="card" href="${id}.html">
      ${thumb ? `<img loading="lazy" src="shots/${thumb.file}" alt="">` : ""}
      <div class="cardbody"><b>${esc(p.title)}</b><span>${esc(p.blurb)}</span>
      <em>${count} screenshots</em></div></a>`;
  }).join("");
  const body = `<main class="page home">
  <section class="hero">
    <div class="herotext">
      <h1>${esc(SITE.name)}</h1>
      <p class="lede">${esc(SITE.blurb)}</p>
      <p>Build a computer chip by chip on a schematic canvas, write 8086 assembly, and watch every wire
      carry a real logic level. The CPU is cycle-accurate and passes the complete SingleStepTests/8088 suite —
      3,007,000 of 3,007,000 tests exactly. The address map is not declared anywhere: it is
      <em>measured</em> by driving your own decode gates and recording which chip answers.</p>
      <div class="cta">
        <a class="btn primary" href="../index.html">Open the simulator ↗</a>
        <a class="btn" href="overview.html">Start the guide</a>
      </div>
      <ul class="facts">
        <li><b>21</b> ready-made boards, nine with guided labs</li>
        <li><b>52</b> modelled chips and devices</li>
        <li><b>1</b> HTML file — no install, no server, no accounts</li>
        <li><b>${manifest.length}</b> screenshots in this guide</li>
      </ul>
    </div>
    ${hero ? `<figure class="heroshot shot" data-i="hero"><img src="shots/${hero.file}" alt="The workspace"></figure>` : ""}
  </section>
  <section class="sub">
    <h2>What is in here</h2>
    <div class="cards">${cards}
      <a class="card" href="reference.html"><div class="cardbody"><b>Reference</b>
      <span>Every shortcut, gesture, toolbar control, assembler directive and expression form.</span>
      <em>tables</em></div></a>
    </div>
  </section>
  <section class="sub">
    <h2>Why it exists</h2>
    <p>Hardware trainer kits taught a generation how a computer actually works: you could see the address
    latch, probe the chip select, and watch a bus cycle on a scope. They were also expensive, fragile, and
    fixed — you got the board the manufacturer soldered.</p>
    <p>This is that bench, rebuilt as software, with the parts loose in a drawer. You wire the address latch
    yourself. You choose partial decoding and then discover the mirrors it creates. You strap a CPU into
    maximum mode and watch an 8288 take over the strobes. And when it does not work, the tool does what a
    scope and a logic analyzer would do: it shows you, honestly, what your board is really doing.</p>
  </section>
  </main>`;
  writeFileSync(OUT + "index.html", shell("Guide", "index", body));
}

// ------------------------------------------------------------ assets ----
writeFileSync(OUT + "guide.css", CSS());
writeFileSync(OUT + "guide.js", `window.LB = ${JSON.stringify(lbData)};\n` + JS());
console.log(`guide: ${pageList.length + 2} pages, ${manifest.length} figures -> guide/`);

function CSS() {
  return `
:root {
  --bg:#0d1117; --bg2:#161c26; --bg3:#1b2330; --edge:#2e3a4a; --text:#c8d4e0; --dim:#7d8a99;
  --accent:#4ec9b0; --accent2:#e5c07b; --hot:#ff6b6b; --wire:#6a9fd8;
  --mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
* { box-sizing:border-box; }
html { scroll-behavior:smooth; scroll-padding-top:70px; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.65 var(--sans); -webkit-font-smoothing:antialiased; }
a { color:var(--accent); text-decoration:none; }
a:hover { text-decoration:underline; }
code, kbd { font-family:var(--mono); font-size:.9em; background:var(--bg3); border:1px solid var(--edge);
  border-radius:4px; padding:1px 5px; color:var(--accent2); }
kbd { color:var(--text); }
em { color:var(--accent2); font-style:normal; }

.topnav { position:sticky; top:0; z-index:50; display:flex; align-items:center; gap:18px;
  padding:0 22px; height:56px; background:rgba(13,17,23,.92); backdrop-filter:blur(10px);
  border-bottom:1px solid var(--edge); }
.brand { display:flex; align-items:baseline; gap:7px; font-family:var(--mono); }
.brand b { color:var(--accent); font-size:15px; }
.brand span { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:.14em; }
.navlinks { display:flex; gap:2px; flex:1; overflow-x:auto; scrollbar-width:none; }
.navlinks::-webkit-scrollbar { display:none; }
.navlinks a { padding:6px 10px; border-radius:6px; color:var(--dim); font-size:13.5px; white-space:nowrap; }
.navlinks a:hover { background:var(--bg2); color:var(--text); text-decoration:none; }
.navlinks a.here { background:var(--bg3); color:var(--accent); }
.launch { white-space:nowrap; font-size:13px; padding:6px 12px; border:1px solid var(--accent);
  border-radius:6px; color:var(--accent); }
.launch:hover { background:var(--accent); color:var(--bg); text-decoration:none; }

.page { max-width:1500px; margin:0 auto; padding:36px 28px 80px; }
.pagehead h1 { font-size:38px; margin:0 0 8px; letter-spacing:-.02em; }
.lede { color:var(--dim); font-size:17px; margin:0 0 26px; max-width:70ch; }
.layout { display:grid; grid-template-columns:210px 1fr; gap:36px; align-items:start; }
@media (max-width:980px) { .layout { grid-template-columns:1fr; } .toc { display:none; } }
.toc { position:sticky; top:76px; display:flex; flex-direction:column; gap:2px;
  border-left:1px solid var(--edge); padding-left:14px; max-height:calc(100vh - 110px); overflow:auto; }
.toctitle { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:.12em; margin-bottom:6px; }
.toc a { color:var(--dim); font-size:13px; padding:3px 0; }
.toc a:hover, .toc a.active { color:var(--accent); text-decoration:none; }
.tocmeta { margin-top:12px; color:var(--edge); font-size:11px; font-family:var(--mono); }

.content { min-width:0; }
.intro p { max-width:78ch; }
.intro .tip { border-left:3px solid var(--accent); background:var(--bg2); padding:12px 16px; border-radius:0 8px 8px 0; }
.sub { margin:44px 0 0; scroll-margin-top:70px; }
.sub h2 { font-size:24px; margin:0 0 10px; padding-bottom:8px; border-bottom:1px solid var(--edge); }
.sub p { max-width:78ch; }

.grid { display:grid; gap:20px; margin-top:18px;
  grid-template-columns:repeat(auto-fill,minmax(430px,1fr)); }
.grid.gal { grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); }
@media (max-width:700px) { .grid, .grid.gal { grid-template-columns:1fr; } }
.shot { margin:0; background:var(--bg2); border:1px solid var(--edge); border-radius:10px;
  overflow:hidden; cursor:zoom-in; transition:border-color .12s, transform .12s; }
.shot:hover { border-color:var(--accent); }
.shot img { display:block; width:100%; height:auto; background:#000; }
.shot figcaption { padding:11px 14px; font-size:13px; color:var(--dim); line-height:1.55; }
.shot figcaption b { color:var(--text); }

.filterbar { display:flex; align-items:center; gap:12px; margin:18px 0 0; }
.filterbar input { flex:1; max-width:420px; background:var(--bg2); border:1px solid var(--edge);
  border-radius:8px; padding:9px 13px; color:var(--text); font:14px var(--sans); outline:none; }
.filterbar input:focus { border-color:var(--accent); }
#filterCount { color:var(--dim); font-size:12.5px; font-family:var(--mono); }

table { width:100%; border-collapse:collapse; margin:16px 0; font-size:13.5px; display:block; overflow-x:auto; }
th, td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--edge); vertical-align:top; }
th { color:var(--accent); font-size:11.5px; text-transform:uppercase; letter-spacing:.1em; white-space:nowrap; }
td:first-child { color:var(--accent2); font-family:var(--mono); font-size:12.5px; white-space:nowrap; }

.home .hero { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.25fr); gap:44px; align-items:center;
  padding:20px 0 40px; }
@media (max-width:1080px) { .home .hero { grid-template-columns:1fr; } }
.home h1 { font-size:52px; margin:0 0 10px; letter-spacing:-.03em; }
.cta { display:flex; gap:12px; margin:24px 0 26px; flex-wrap:wrap; }
.btn { padding:11px 20px; border:1px solid var(--edge); border-radius:8px; color:var(--text); font-size:14.5px; }
.btn:hover { border-color:var(--accent); text-decoration:none; }
.btn.primary { background:var(--accent); border-color:var(--accent); color:var(--bg); font-weight:600; }
.btn.primary:hover { filter:brightness(1.1); }
.facts { list-style:none; padding:0; margin:0; display:grid; gap:7px; }
.facts li { color:var(--dim); font-size:14px; }
.facts b { color:var(--accent2); font-family:var(--mono); margin-right:6px; }
.heroshot { border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,.5); }
.cards { display:grid; gap:18px; grid-template-columns:repeat(auto-fill,minmax(290px,1fr)); margin-top:18px; }
.card { display:flex; flex-direction:column; background:var(--bg2); border:1px solid var(--edge);
  border-radius:10px; overflow:hidden; color:var(--text); }
.card:hover { border-color:var(--accent); text-decoration:none; }
.card img { width:100%; height:132px; object-fit:cover; object-position:top left; background:#000; }
.cardbody { padding:13px 15px; display:flex; flex-direction:column; gap:5px; }
.cardbody b { font-size:15px; }
.cardbody span { color:var(--dim); font-size:13px; line-height:1.5; }
.cardbody em { color:var(--edge); font-size:11px; font-family:var(--mono); }

.board { margin:56px 0 0; padding-top:8px; scroll-margin-top:70px; }
.board h2 { font-size:27px; margin:0 0 6px; padding-bottom:8px; border-bottom:1px solid var(--edge); }
.board h3 { font-size:16px; margin:30px 0 8px; color:var(--accent); letter-spacing:.01em; }
.board .one { color:var(--accent2); font-size:16px; margin:0 0 16px; }
.board .story p, .board > p { max-width:78ch; }
.grid.hero1 { grid-template-columns:minmax(0,1fr); max-width:1050px; }
pre.code { background:var(--bg2); border:1px solid var(--edge); border-left:3px solid var(--accent);
  border-radius:0 8px 8px 0; padding:14px 16px; overflow-x:auto; font-family:var(--mono);
  font-size:12.5px; line-height:1.6; color:var(--text); }
pre.code code { background:none; border:none; padding:0; color:inherit; }
ol.tries { counter-reset:t; list-style:none; padding:0; margin:14px 0 0; max-width:82ch; }
ol.tries > li { counter-increment:t; position:relative; padding:14px 0 14px 46px;
  border-top:1px solid var(--edge); }
ol.tries > li::before { content:counter(t); position:absolute; left:0; top:14px; width:28px; height:28px;
  border:1px solid var(--accent); border-radius:50%; color:var(--accent); font-family:var(--mono);
  font-size:13px; display:grid; place-items:center; }
ol.tries > li > b { display:block; color:var(--text); font-size:15px; margin-bottom:4px; }
ol.tries p { margin:6px 0 0; color:var(--dim); }
footer { border-top:1px solid var(--edge); padding:28px; text-align:center; color:var(--dim); font-size:13px; }
footer .small { color:var(--edge); font-size:12px; }

#lightbox { position:fixed; inset:0; z-index:100; background:rgba(5,7,10,.96); display:flex;
  align-items:center; justify-content:center; padding:36px 70px 92px; }
#lightbox[hidden] { display:none; }
#lbImg { max-width:100%; max-height:100%; object-fit:contain; border-radius:6px;
  box-shadow:0 12px 60px rgba(0,0,0,.7); }
#lbCap { position:absolute; left:0; right:0; bottom:0; padding:16px 70px 22px; text-align:center;
  color:var(--dim); font-size:13.5px; line-height:1.6; }
#lbCap b { color:var(--text); }
#lightbox button { position:absolute; background:none; border:none; color:var(--dim); cursor:pointer;
  font-size:34px; padding:14px 18px; line-height:1; }
#lightbox button:hover { color:var(--accent); }
#lbClose { top:8px; right:14px; font-size:26px; }
#lbPrev { left:6px; top:50%; transform:translateY(-50%); }
#lbNext { right:6px; top:50%; transform:translateY(-50%); }
`;
}

function JS() {
  return `
(function () {
  var box = document.getElementById("lightbox"), img = document.getElementById("lbImg"),
      cap = document.getElementById("lbCap"), cur = 0;
  var figs = [].slice.call(document.querySelectorAll(".shot"));
  function show(i) {
    if (!window.LB.length) return;
    cur = (i + window.LB.length) % window.LB.length;
    var d = window.LB[cur];
    img.src = "shots/" + d.file;
    img.alt = d.title;
    cap.innerHTML = "<b>" + d.title + "</b>" + (d.caption ? " — " + d.caption : "");
    box.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function close() { box.hidden = true; document.body.style.overflow = ""; }
  figs.forEach(function (f) {
    f.addEventListener("click", function () {
      var i = f.getAttribute("data-i");
      show(i === "hero" ? 0 : +i);
    });
  });
  document.getElementById("lbClose").addEventListener("click", close);
  document.getElementById("lbPrev").addEventListener("click", function (e) { e.stopPropagation(); show(cur - 1); });
  document.getElementById("lbNext").addEventListener("click", function (e) { e.stopPropagation(); show(cur + 1); });
  box.addEventListener("click", function (e) { if (e.target === box || e.target === img) close(); });
  document.addEventListener("keydown", function (e) {
    if (box.hidden) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") show(cur - 1);
    if (e.key === "ArrowRight") show(cur + 1);
  });

  // gallery filter
  var f = document.getElementById("filter");
  if (f) {
    var count = document.getElementById("filterCount");
    var subs = [].slice.call(document.querySelectorAll(".sub"));
    var total = document.querySelectorAll(".shot").length;
    var upd = function () {
      var q = f.value.trim().toLowerCase(), shown = 0;
      subs.forEach(function (s) {
        var name = (s.getAttribute("data-name") || "") + " " + (s.querySelector("h2") ? s.querySelector("h2").textContent.toLowerCase() : "");
        var figsIn = [].slice.call(s.querySelectorAll(".shot"));
        var anyFig = false;
        figsIn.forEach(function (fig) {
          var t = fig.textContent.toLowerCase();
          var hit = !q || name.indexOf(q) >= 0 || t.indexOf(q) >= 0;
          fig.style.display = hit ? "" : "none";
          if (hit) { anyFig = true; shown++; }
        });
        s.style.display = anyFig ? "" : "none";
      });
      count.textContent = q ? shown + " of " + total + " shown" : total + " screenshots";
    };
    f.addEventListener("input", upd);
    upd();
  }

  // active TOC entry
  var links = [].slice.call(document.querySelectorAll(".toc a"));
  if (links.length && "IntersectionObserver" in window) {
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (l) {
          l.classList.toggle("active", l.getAttribute("href") === "#" + en.target.id);
        });
      });
    }, { rootMargin: "-70px 0px -75% 0px" });
    document.querySelectorAll(".sub[id]").forEach(function (s) { obs.observe(s); });
  }
})();
`;
}
