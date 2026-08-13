import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FRAME_SRC_ORIGINS,
  MAP_EMBED_ORIGINS,
  VIDEO_EMBED_ORIGINS,
  isAllowedVideoEmbed,
} from "@sa/shared/embed-hosts";

/**
 * Lo que el front acepta embeber y lo que la CSP permite tienen que ser lo
 * mismo.
 *
 * `VideoEmbed` aceptaba cualquier URL https, y `frame-src` sólo listaba Google
 * Maps y el desafío anti-spam: el iframe pasaba la validación y el navegador
 * lo bloqueaba. Un video que no se ve, sin ningún error visible que lo
 * explique.
 *
 * Estas pruebas son el candado: si se agrega un proveedor a la lista
 * compartida y no se toca la CSP —o al revés—, fallan.
 */

const ROOT = resolve(__dirname, "..");

/** Extrae la directiva `frame-src` de una CSP. */
function frameSrc(csp: string): string[] {
  const match = /frame-src ([^;"]+)/.exec(csp);
  expect(match, "la CSP tiene que declarar frame-src").toBeTruthy();
  return match![1].trim().split(/\s+/);
}

const nginxCsp = readFileSync(resolve(ROOT, "scripts/deploy/setup-vps.sh"), "utf8");
const metaCsp = readFileSync(resolve(ROOT, "apps/web/index.html"), "utf8");

describe("frame-src y los proveedores soportados", () => {
  const fuentes: [string, string[]][] = [
    ["Nginx", frameSrc(nginxCsp)],
    ["<meta> del HTML", frameSrc(metaCsp)],
  ];

  it.each(fuentes)("%s permite todos los proveedores de video", (_nombre, hosts) => {
    for (const origin of VIDEO_EMBED_ORIGINS) {
      expect(hosts, `falta ${origin} en frame-src`).toContain(origin);
    }
  });

  it.each(fuentes)("%s permite los hosts del mapa que el validador acepta", (_nombre, hosts) => {
    // Mismo problema que el video: `isMapEmbedUrl()` acepta los `.com.py`.
    for (const origin of MAP_EMBED_ORIGINS) {
      expect(hosts, `falta ${origin} en frame-src`).toContain(origin);
    }
  });

  it.each(fuentes)("%s no permite hosts de más", (_nombre, hosts) => {
    // Lo que no está en la lista compartida no tiene por qué estar en la CSP.
    expect(hosts.filter((h) => h !== "'self'").sort()).toEqual([...FRAME_SRC_ORIGINS].sort());
  });

  it("las dos CSP declaran lo mismo", () => {
    expect(frameSrc(nginxCsp).sort()).toEqual(frameSrc(metaCsp).sort());
  });
});

describe("isAllowedVideoEmbed", () => {
  it("acepta los proveedores soportados", () => {
    expect(isAllowedVideoEmbed("https://www.youtube.com/embed/abc123")).toBe(true);
    expect(isAllowedVideoEmbed("https://www.youtube-nocookie.com/embed/abc123")).toBe(true);
    expect(isAllowedVideoEmbed("https://player.vimeo.com/video/12345")).toBe(true);
  });

  it("rechaza cualquier otro host, aunque sea https", () => {
    for (const url of [
      "https://player.otro.test/video/1",
      "https://vimeo.com/12345", // la página, no el player
      "https://youtube.com/embed/abc", // sin el www que declara la CSP
      "https://evil.test/embed",
      "http://www.youtube.com/embed/abc", // sin TLS
      "javascript:alert(1)",
      "",
      null,
    ]) {
      expect(isAllowedVideoEmbed(url), String(url)).toBe(false);
    }
  });
});
