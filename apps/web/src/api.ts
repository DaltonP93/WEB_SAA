import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

function hex(c: string): string {
  const m = c.replace("#", "").match(/.{1,2}/g);
  if (!m || m.length < 3) return "0 0 0";
  return m.slice(0, 3).map((h) => parseInt(h, 16)).join(" ");
}

export function applyTheme(theme: any) {
  if (!theme) return;
  const r = document.documentElement.style;
  if (theme.primary) r.setProperty("--c-primary", hex(theme.primary));
  if (theme.secondary) r.setProperty("--c-secondary", hex(theme.secondary));
  if (theme.accent) r.setProperty("--c-accent", hex(theme.accent));
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
