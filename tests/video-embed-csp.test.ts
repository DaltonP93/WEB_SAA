import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FRAME_SRC_ORIGINS,
  MAP_EMBED_ORIGINS,
  VIDEO_EMBED_ORIGINS,
  isAllowedVideoEmbed,
  isAllowedVideoUrl,
  toVideoEmbedUrl,
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

  it("rechaza rutas del proveedor que no se pueden embeber", () => {
    // YouTube sirve estas con X-Frame-Options: SAMEORIGIN. El host está
    // permitido, pero el navegador las bloquea igual: mismo rectángulo negro.
    for (const url of [
      "https://www.youtube.com/shorts/abc123",
      "https://www.youtube.com/live/abc123",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/",
      "https://player.vimeo.com/showcase/123",
    ]) {
      expect(isAllowedVideoEmbed(url), url).toBe(false);
    }
  });
});

describe("lo que el panel puede guardar", () => {
  it("normaliza las formas habituales de pegar un video", () => {
    expect(toVideoEmbedUrl("https://www.youtube.com/watch?v=abc123")).toBe(
      "https://www.youtube.com/embed/abc123",
    );
    expect(toVideoEmbedUrl("https://youtu.be/abc123")).toBe("https://www.youtube.com/embed/abc123");
    expect(toVideoEmbedUrl("https://vimeo.com/12345")).toBe("https://player.vimeo.com/video/12345");
  });

  it("no le saca el modo sin cookies a quien lo eligió", () => {
    // Reescribirlo a youtube.com le devolvería las cookies de seguimiento al
    // visitante, en un sitio de salud.
    expect(toVideoEmbedUrl("https://www.youtube-nocookie.com/embed/abc123")).toBe(
      "https://www.youtube-nocookie.com/embed/abc123",
    );
  });

  it("un proveedor no soportado no se puede guardar", () => {
    // Antes la API respondía 200 y el bloque no dibujaba nada: peor que el
    // rectángulo negro, porque no queda ni rastro de que algo falló.
    for (const url of ["https://www.dailymotion.com/video/x1", "https://wistia.com/medias/abc", "texto suelto"]) {
      expect(isAllowedVideoUrl(url), url).toBe(false);
    }
    expect(isAllowedVideoUrl("https://youtu.be/abc123")).toBe(true);
  });
});

describe("copias del módulo de embeds", () => {
  it("shared y api son idénticas byte a byte", () => {
    const shared = readFileSync(resolve(ROOT, "shared/types/embed-hosts.ts"), "utf8");
    const api = readFileSync(resolve(ROOT, "api/src/embed-hosts.ts"), "utf8");
    expect(api).toBe(shared);
  });

  it("el schema de bloques valida el proveedor en las dos copias", () => {
    for (const file of ["shared/types/block-schemas.ts", "api/src/block-validation.ts"]) {
      const source = readFileSync(resolve(ROOT, file), "utf8");
      expect(source, file).toContain("isAllowedVideoUrl");
    }
  });
});
