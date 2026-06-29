import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

function hex(c: string): string {
  const m = c.replace("#", "").match(/.{1,2}/g);
  if (!m || m.length < 3) return "0 0 0";
  return m.slice(0, 3).map((h) => parseInt(h, 16)).join(" ");
}

function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace("#", "").match(/.{1,2}/g);
  if (!m || m.length < 3) return [0, 0, 0];
  const r = parseInt(m[0], 16) / 255;
  const g = parseInt(m[1], 16) / 255;
  const b = parseInt(m[2], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function mixTone(hex: string, delta: number): string {
  const [h, s, l] = hexToHsl(hex);
  const nl = Math.max(0, Math.min(1, l + delta));
  const [r, g, b] = hslToRgb(h, s, nl);
  return `${r} ${g} ${b}`;
}

const TONE_STEPS: { step: number; delta: number }[] = [
  { step: 50, delta: -0.45 },
  { step: 100, delta: -0.30 },
  { step: 200, delta: -0.15 },
  { step: 300, delta: -0.08 },
  { step: 400, delta: 0 },
  { step: 500, delta: 0.08 },
  { step: 600, delta: 0.15 },
  { step: 700, delta: 0.30 },
  { step: 800, delta: 0.45 },
  { step: 900, delta: 0.55 },
];

function applyScale(r: CSSStyleDeclaration, prefix: string, base: string | undefined, fallbackHex: string) {
  const source = base ?? fallbackHex;
  for (const { step, delta } of TONE_STEPS) {
    r.setProperty(`${prefix}-${step}`, mixTone(source, delta));
  }
}

export function applyTheme(theme: any) {
  if (!theme) return;
  const r = document.documentElement.style;
  if (theme.primary) {
    r.setProperty("--c-primary", hex(theme.primary));
    applyScale(r, "--c-primary", theme.primary, "#005587");
  }
  if (theme.secondary) {
    r.setProperty("--c-secondary", hex(theme.secondary));
    applyScale(r, "--c-secondary", theme.secondary, "#00b5da");
  }
  if (theme.accent) {
    r.setProperty("--c-accent", hex(theme.accent));
    applyScale(r, "--c-accent", theme.accent, "#f5543f");
  }
  if (theme.bg) r.setProperty("--c-bg", hex(theme.bg));
  if (theme.text) r.setProperty("--c-text", hex(theme.text));
  if (theme.fontHeading) r.setProperty("--f-heading", `"${theme.fontHeading}"`);
  if (theme.fontBody) r.setProperty("--f-body", `"${theme.fontBody}"`);
  if (theme.radius) r.setProperty("--radius", theme.radius);

  const fonts = Array.from(new Set([theme.fontHeading, theme.fontBody].filter(Boolean)));
  if (fonts.length) {
    const id = "gf-link";
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = `https://fonts.googleapis.com/css2?${fonts.map((font: string) => `family=${font.replace(/ /g, "+")}:wght@400;600;700`).join("&")}&display=swap`;
  }
}
