#!/usr/bin/env node
// Bundles src/**/*.js + src/style.css into a single self-contained index.html at the
// repo root — the repo layout IS the published static site.
// and regenerates dev.html (individual <script> tags for debugging).
// No dependencies; script load order is lexicographic by path (NN- prefixes).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".js")) out.push(p);
    }
  })(join(root, "src"));
  return out;
}

function assets() {
  // assets/*.b64 files become entries in K8086.assets (raw base64 strings).
  const dir = join(root, "assets");
  if (!existsSync(dir)) return "";
  const entries = readdirSync(dir).filter(f => f.endsWith(".b64")).map(f => {
    const key = f.replace(/\.b64$/, "");
    return `${JSON.stringify(key)}:${JSON.stringify(readFileSync(join(dir, f), "utf8").trim())}`;
  });
  return entries.length ? `(globalThis.K8086 ??= {}).assets = {${entries.join(",")}};\n` : "";
}

function build() {
  const files = sourceFiles();
  const css = readFileSync(join(root, "src", "style.css"), "utf8");
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const banner = `/* µSystem 8086 v${version} — built ${new Date().toISOString()} — MIT */`;

  const js = banner + "\n" + assets() +
    files.map(f => `\n/* ===== ${relative(root, f)} ===== */\n` + readFileSync(f, "utf8")).join("");

  const shell = (scripts, inlineCss) => `<!DOCTYPE html>
<!--
  µSystem 8086. Copyright (C) 2026 Jyotiprakash Mishra <mail@jyotiprakash.org>

  This program is free software: you can redistribute it and/or modify it under
  the terms of the GNU General Public License as published by the Free Software
  Foundation, either version 3 of the License, or (at your option) any later
  version. It is distributed WITHOUT ANY WARRANTY; see the GNU General Public
  License for details: https://www.gnu.org/licenses/

  Source: https://github.com/ShowMeTheStack/usystem-8086

  This file also embeds third-party works, each under its own license and
  unmodified: GLaBIOS (GPL-3), the FreeDOS 1.3 boot disk (GPL-2+), and
  public-domain VGA fonts. See assets/LICENSES.md in the source repository.
-->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>µSystem 8086 — cycle-accurate 8086/8088 system simulator</title>
${inlineCss ? `<style>\n${css}</style>` : `<link rel="stylesheet" href="src/style.css">`}
</head>
<body>
<div id="app"></div>
${scripts}
</body>
</html>
`;

  writeFileSync(join(root, "index.html"), shell(`<script>\n${js}\n</script>`, true));
  writeFileSync(join(root, "dev.html"), shell(
    `<script>${assets()}</script>\n` +
    files.map(f => `<script src="${relative(root, f)}"></script>`).join("\n"), false));

  console.log(`index.html: ${(statSync(join(root, "index.html")).size / 1024).toFixed(1)} KiB, ${files.length} source files`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) build();
