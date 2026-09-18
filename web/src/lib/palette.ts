// UI-3 color wheel: the user picks an accent color; its hue/sat derive the
// WHOLE surface palette via HSL, with WCAG AA contrast enforced at generation
// time (text on surfaces >= 4.5:1, fg-on-accent auto black/white).
// Universal semantics (danger/success/warning) keep fixed hues on purpose:
// rotating "danger" with a user hue wheel makes errors unreadable.

import { schedulePrefsPush } from "./prefs";

export type Mode = "dark" | "light" | "black";

const NEAR_BLACK = "#0a0d12";

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// WCAG 2.1 relative luminance + contrast ratio.
function relLum(hex: string): number {
  const m = hex.replace("#", "");
  const ch = (i: number) => {
    const v = parseInt(m.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

export function contrast(a: string, b: string): number {
  const la = relLum(a), lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Walk lightness (2% steps) until fg/bg reach the target ratio.
function ensureContrast(fg: { h: number; s: number; l: number }, bgHex: string, target: number, up: boolean): string {
  for (let i = 0; i < 50; i++) {
    const l = fg.l + (up ? 1 : -1) * i * 0.02;
    if (l < 0 || l > 1) break;
    const c = hslToHex(fg.h, fg.s, l);
    if (contrast(c, bgHex) >= target) return c;
  }
  return hslToHex(fg.h, fg.s, fg.l);
}

export function buildPalette(accentHex: string, mode: Mode): Record<string, string> {
  const { h, s } = hexToHsl(accentHex);
  const sat = Math.min(Math.max(s, 0.15), 0.85);
  const hsl = (sm: number, l: number) => hslToHex(h, Math.min(sat * sm, 1), l);

  let p: Record<string, string>;
  if (mode === "light") {
    const bg = hsl(0.3, 0.97), bg2 = hsl(0.28, 0.94), bg3 = hsl(0.25, 0.9);
    const fg = ensureContrast({ h, s: sat * 0.25, l: 0.15 }, bg, 4.5, false);
    const muted = ensureContrast({ h, s: sat * 0.15, l: 0.38 }, bg2, 4.5, false);
    p = { "--bg": bg, "--bg2": bg2, "--bg3": bg3, "--border": hsl(0.2, 0.84), "--fg": fg, "--muted": muted };
  } else if (mode === "black") {
    const bg = "#000000", bg2 = hsl(0.4, 0.025), bg3 = hsl(0.35, 0.06);
    const fg = ensureContrast({ h, s: sat * 0.15, l: 0.86 }, bg3, 4.5, true);
    const muted = ensureContrast({ h, s: sat * 0.12, l: 0.58 }, bg2, 4.5, true);
    p = { "--bg": bg, "--bg2": bg2, "--bg3": bg3, "--border": hsl(0.3, 0.12), "--fg": fg, "--muted": muted };
  } else {
    const bg = hsl(0.35, 0.06), bg2 = hsl(0.33, 0.085), bg3 = hsl(0.3, 0.12);
    const fg = ensureContrast({ h, s: sat * 0.15, l: 0.86 }, bg3, 4.5, true);
    const muted = ensureContrast({ h, s: sat * 0.12, l: 0.58 }, bg2, 4.5, true);
    p = { "--bg": bg, "--bg2": bg2, "--bg3": bg3, "--border": hsl(0.28, 0.19), "--fg": fg, "--muted": muted };
  }

  // fg-on-accent: auto black/white, and if neither reaches 4.5 on the accent
  // (rare mid-tone), nudge the accent lightness until one does.
  let accent = accentHex;
  let on = contrast(accent, NEAR_BLACK) >= contrast(accent, "#ffffff") ? NEAR_BLACK : "#ffffff";
  for (let i = 0; i < 30 && contrast(accent, on) < 4.5; i++) {
    const { s: as, l } = hexToHsl(accent);
    accent = hslToHex(h, as, l + (on === NEAR_BLACK ? -0.02 : 0.02));
  }
  p["--accent"] = accent;
  p["--fg-on-accent"] = on;
  const { r, g, b } = { r: parseInt(accent.slice(1, 3), 16), g: parseInt(accent.slice(3, 5), 16), b: parseInt(accent.slice(5, 7), 16) };
  p["--accent-glow"] = `rgba(${r}, ${g}, ${b}, .45)`;
  return p;
}

export function applyAccent(accentHex: string | null, mode: Mode): void {
  const root = document.documentElement;
  if (!accentHex) {
    for (const k of ["--bg", "--bg2", "--bg3", "--border", "--fg", "--muted", "--accent", "--fg-on-accent", "--accent-glow"]) {
      root.style.removeProperty(k);
    }
    return;
  }
  const pal = buildPalette(accentHex, mode);
  for (const [k, v] of Object.entries(pal)) root.style.setProperty(k, v);
}

export function currentMode(): Mode {
  return (document.documentElement.dataset.theme as Mode) || "dark";
}

// Shared theme switch (Settings toggle + Ctrl+K palette): persists the pref,
// re-themes <html> and regenerates the derived accent palette for the new mode.
export function applyTheme(t: Mode): void {
  localStorage.setItem("harness_theme", t);
  document.documentElement.dataset.theme = t;
  applyAccent(localStorage.getItem("harness_accent"), t);
  schedulePrefsPush();
}
