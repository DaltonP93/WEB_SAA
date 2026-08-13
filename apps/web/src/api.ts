import axios from "axios";
import { isApprovedThemeColor } from "@sa/shared/institutional-red";

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

/**
 * Escala de tonos: `mix` > 0 aclara hacia el blanco y < 0 oscurece hacia el
 * negro, en proporción a la luminosidad del color base (por eso funciona igual
 * con el navy primario que con el coral del accent).
 */
function mixTone(hex: string, mix: number): string {
  const [h, s, l] = hexToHsl(hex);
  const nl = mix >= 0 ? l + (1 - l) * mix : l * (1 + mix);
  const [r, g, b] = hslToRgb(h, s, Math.max(0, Math.min(1, nl)));
  return `${r} ${g} ${b}`;
}

// Mismo sentido que la escala estática de styles.css y que Tailwind:
// 50 es el tono más claro y 900 el más oscuro; 500 es el color de marca.
const TONE_STEPS: { step: number; mix: number }[] = [
  { step: 50, mix: 0.92 },
  { step: 100, mix: 0.84 },
  { step: 200, mix: 0.7 },
  { step: 300, mix: 0.55 },
  { step: 400, mix: 0.35 },
  { step: 500, mix: 0 },
  { step: 600, mix: -0.12 },
  { step: 700, mix: -0.28 },
  { step: 800, mix: -0.45 },
  { step: 900, mix: -0.62 },
];

function applyScale(r: CSSStyleDeclaration, prefix: string, base: string | undefined, fallbackHex: string) {
  const source = base ?? fallbackHex;
  for (const { step, mix } of TONE_STEPS) {
    r.setProperty(`${prefix}-${step}`, mixTone(source, mix));
  }
}

/**
 * Sólo se aplican colores de la paleta institucional.
 *
 * Tercera capa: el panel ofrece nada más los aprobados y la API rechaza el
 * resto, pero una fila vieja —o escrita fuera de la API— podía repintar el
 * sitio entero, incluido el rojo que identifica a Emergencias. Lo que no está
 * en la paleta se ignora y queda el valor de `styles.css`.
 */
function approved(slot: string, value: unknown): string | undefined {
  return isApprovedThemeColor(slot, value) ? (value as string) : undefined;
}

export function applyTheme(theme: any) {
  if (!theme) return;
  const r = document.documentElement.style;
  const primary = approved("primary", theme.primary);
  const secondary = approved("secondary", theme.secondary);
  const accent = approved("accent", theme.accent);
  if (primary) {
    r.setProperty("--c-primary", hex(primary));
    applyScale(r, "--c-primary", primary, "#005587");
  }
  if (secondary) {
    r.setProperty("--c-secondary", hex(secondary));
    applyScale(r, "--c-secondary", secondary, "#00b5da");
  }
  if (accent) {
    r.setProperty("--c-accent", hex(accent));
    applyScale(r, "--c-accent", accent, "#f5543f");
  }
  const bg = approved("bg", theme.bg);
  const text = approved("text", theme.text);
  if (bg) r.setProperty("--c-bg", hex(bg));
  if (text) r.setProperty("--c-text", hex(text));
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
