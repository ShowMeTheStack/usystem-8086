"use strict";
(function (K) {
  // 20 color schemes — 10 dark, 10 light. A theme restyles the IDE (panels,
  // canvas, wires, waveforms), never the physics: LEDs stay red, the CRT
  // stays phosphor, 7-segments stay LED-colored.

  const hx = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const hex = (r, g, b) => "#" + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => {
    const A = hx(a), B = hx(b);
    return hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  };
  const rgba = (c, al) => {
    const [r, g, b] = hx(c);
    return `rgba(${r},${g},${b},${al})`;
  };

  // t: { name, mode, bg, bg2, edge, text, dim, accent, accent2, hot, wire, bus, canvas?, chip?, chipEdge? }
  const mk = (t) => {
    const dark = t.mode === "dark";
    const cvBg = t.canvas || (dark ? mix(t.bg, "#000000", 0.25) : mix(t.bg, "#ffffff", 0.35));
    const cv = {
      bg: cvBg,
      grid: mix(cvBg, t.text, dark ? 0.08 : 0.10),
      chip: t.chip || mix(cvBg, t.text, dark ? 0.10 : 0.06),
      chipEdge: t.chipEdge || mix(t.edge, t.text, dark ? 0.15 : 0.35),
      chipEdgeSel: t.accent,
      chipText: t.dim,
      pinText: mix(t.dim, t.text, 0.3),
      wire: t.wire,
      wireHi: dark ? mix(t.wire, "#ffffff", 0.45) : mix(t.wire, "#000000", 0.35),
      sel: t.text,
      lead: mix(t.wire, cvBg, 0.25),
      selLead: mix(t.text, t.wire, 0.2),
      bus: t.bus,
      busHi: dark ? mix(t.bus, "#ffffff", 0.4) : mix(t.bus, "#000000", 0.3),
      label: t.dim,
      labelVal: t.accent2,
      labelBg: rgba(cvBg, 0.85),
      glow: t.accent2,
      sigZ: t.dim,
      sigL: t.wire,
      sigH: t.accent,
      sigX: t.hot,
      railV: t.accent2,
      railG: t.dim,
      clockText: t.accent,
      hint: mix(t.dim, cvBg, 0.3),
      waveBg: dark ? mix(cvBg, "#000000", 0.2) : mix(cvBg, "#ffffff", 0.3),
      waveGrid: mix(cvBg, t.text, dark ? 0.10 : 0.13),
      waveLine: t.accent,
      waveBus: t.wire,
      waveText: t.dim,
      waveCursor: t.accent2,
    };
    return { ...t, cv };
  };

  K.THEMES = [
    // ---------------- dark ----------------
    mk({ name: "Midnight", mode: "dark", bg: "#0d1117", bg2: "#161c26", edge: "#2e3a4a", text: "#c8d4e0", dim: "#7d8a99", accent: "#4ec9b0", accent2: "#e5c07b", hot: "#ff6b6b", wire: "#6a9fd8", bus: "#5f8fc4", canvas: "#0d1117", chip: "#1b2330", chipEdge: "#45566c" }),
    mk({ name: "Dracula", mode: "dark", bg: "#282a36", bg2: "#21222c", edge: "#44475a", text: "#f8f8f2", dim: "#6272a4", accent: "#50fa7b", accent2: "#f1fa8c", hot: "#ff5555", wire: "#8be9fd", bus: "#bd93f9" }),
    mk({ name: "Solarized Dark", mode: "dark", bg: "#002b36", bg2: "#073642", edge: "#586e75", text: "#93a1a1", dim: "#657b83", accent: "#2aa198", accent2: "#b58900", hot: "#dc322f", wire: "#268bd2", bus: "#6c71c4" }),
    mk({ name: "Nord", mode: "dark", bg: "#2e3440", bg2: "#3b4252", edge: "#4c566a", text: "#d8dee9", dim: "#8792a8", accent: "#88c0d0", accent2: "#ebcb8b", hot: "#bf616a", wire: "#81a1c1", bus: "#b48ead" }),
    mk({ name: "Gruvbox Dark", mode: "dark", bg: "#282828", bg2: "#32302f", edge: "#504945", text: "#ebdbb2", dim: "#928374", accent: "#8ec07c", accent2: "#fabd2f", hot: "#fb4934", wire: "#83a598", bus: "#d3869b" }),
    mk({ name: "Monokai", mode: "dark", bg: "#272822", bg2: "#2d2e27", edge: "#49483e", text: "#f8f8f2", dim: "#8f8a72", accent: "#a6e22e", accent2: "#e6db74", hot: "#f92672", wire: "#66d9ef", bus: "#ae81ff" }),
    mk({ name: "One Dark", mode: "dark", bg: "#282c34", bg2: "#21252b", edge: "#3e4451", text: "#abb2bf", dim: "#5c6370", accent: "#98c379", accent2: "#e5c07b", hot: "#e06c75", wire: "#61afef", bus: "#c678dd" }),
    mk({ name: "Tokyo Night", mode: "dark", bg: "#1a1b26", bg2: "#16161e", edge: "#3b4261", text: "#c0caf5", dim: "#565f89", accent: "#9ece6a", accent2: "#e0af68", hot: "#f7768e", wire: "#7aa2f7", bus: "#bb9af7" }),
    mk({ name: "Green Phosphor", mode: "dark", bg: "#041004", bg2: "#061806", edge: "#0f3f0f", text: "#33ff66", dim: "#1d8f3d", accent: "#66ff99", accent2: "#a8ff60", hot: "#ff6b6b", wire: "#2fdd66", bus: "#7dffa8", canvas: "#020a02" }),
    mk({ name: "Amber Terminal", mode: "dark", bg: "#100a02", bg2: "#1a1206", edge: "#4a3410", text: "#ffb000", dim: "#9a6a10", accent: "#ffcf60", accent2: "#ffe0a0", hot: "#ff5f5f", wire: "#e09a20", bus: "#ffd070", canvas: "#0a0601" }),
    // ---------------- light ----------------
    mk({ name: "Daylight", mode: "light", bg: "#ffffff", bg2: "#f6f8fa", edge: "#d0d7de", text: "#1f2328", dim: "#656d76", accent: "#1a7f64", accent2: "#9a6700", hot: "#cf222e", wire: "#0969da", bus: "#8250df", canvas: "#fbfdff", chip: "#eef1f5", chipEdge: "#8c959f" }),
    mk({ name: "Solarized Light", mode: "light", bg: "#fdf6e3", bg2: "#eee8d5", edge: "#c0b790", text: "#586e75", dim: "#839496", accent: "#2aa198", accent2: "#b58900", hot: "#dc322f", wire: "#268bd2", bus: "#6c71c4" }),
    mk({ name: "Gruvbox Light", mode: "light", bg: "#fbf1c7", bg2: "#f2e5bc", edge: "#bdae93", text: "#3c3836", dim: "#7c6f64", accent: "#689d6a", accent2: "#b57614", hot: "#cc241d", wire: "#458588", bus: "#b16286" }),
    mk({ name: "Nord Light", mode: "light", bg: "#eceff4", bg2: "#e5e9f0", edge: "#c2cbd8", text: "#2e3440", dim: "#4c566a", accent: "#5e81ac", accent2: "#c47b3f", hot: "#bf616a", wire: "#5e81ac", bus: "#b48ead" }),
    mk({ name: "Paper", mode: "light", bg: "#fafafa", bg2: "#f0f0f0", edge: "#dcdcdc", text: "#222222", dim: "#777777", accent: "#00796b", accent2: "#8a6d00", hot: "#c62828", wire: "#37474f", bus: "#6a1b9a" }),
    mk({ name: "Sepia", mode: "light", bg: "#f4ecd8", bg2: "#eadfc8", edge: "#cbb994", text: "#4b3b2a", dim: "#8a785e", accent: "#486b3c", accent2: "#9c6b1e", hot: "#b3402a", wire: "#6b4f2a", bus: "#7d5ba6" }),
    mk({ name: "Quiet", mode: "light", bg: "#f5f5f0", bg2: "#ecece5", edge: "#d5d5cc", text: "#33332e", dim: "#8b8b80", accent: "#5c8a49", accent2: "#a07d00", hot: "#c0504d", wire: "#5f7d95", bus: "#937bb0" }),
    mk({ name: "Ivory", mode: "light", bg: "#fffff4", bg2: "#f7f4e6", edge: "#e0dcc4", text: "#3a3a30", dim: "#94907c", accent: "#2f7d6d", accent2: "#a58a00", hot: "#c04a3a", wire: "#4a6fa0", bus: "#8a5faa" }),
    mk({ name: "Blueprint", mode: "light", bg: "#17427b", bg2: "#123566", edge: "#3f6ba6", text: "#eaf2ff", dim: "#9db8dc", accent: "#9fd0ff", accent2: "#ffe082", hot: "#ff8a80", wire: "#dfeeff", bus: "#ffffff", canvas: "#1b4a8a", chip: "#1d4f93", chipEdge: "#cfe3ff" }),
    mk({ name: "High Contrast", mode: "light", bg: "#ffffff", bg2: "#ffffff", edge: "#000000", text: "#000000", dim: "#444444", accent: "#006400", accent2: "#7a5c00", hot: "#b00020", wire: "#000000", bus: "#0000cc", chip: "#f2f2f2", chipEdge: "#000000" }),
  ];

  K.theme = K.THEMES[0];                     // canvas code reads K.theme.cv

  K.applyTheme = function (name) {
    const t = K.THEMES.find(x => x.name === name) || K.THEMES[0];
    K.theme = t;
    if (typeof document !== "undefined") {
      const r = document.documentElement.style;
      r.setProperty("--bg", t.bg);
      r.setProperty("--bg2", t.bg2);
      r.setProperty("--bg3", mix(t.bg2, t.text, 0.06));
      r.setProperty("--edge", t.edge);
      r.setProperty("--text", t.text);
      r.setProperty("--dim", t.dim);
      r.setProperty("--accent", t.accent);
      r.setProperty("--accent2", t.accent2);
      r.setProperty("--hot", t.hot);
      r.setProperty("--warn", t.accent2);
      r.setProperty("--wire", t.wire);
      r.setProperty("--wire-hi", t.cv.wireHi);
      r.setProperty("--chip", t.cv.chip);
      r.setProperty("--chip-edge", t.cv.chipEdge);
      try { localStorage.setItem("u8086.theme", t.name); } catch { /* fine */ }
    }
    return t;
  };
})(globalThis.K8086 ??= {});
