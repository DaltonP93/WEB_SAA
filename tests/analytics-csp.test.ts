import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La CSP tiene que dejar cargar la analítica que el panel permite configurar.
 *
 * El sitio corre con `default-src 'self'`: bloquea a propósito los scripts de
 * otros dominios. Si la medición (GA4, GTM, Meta Pixel) se configura pero la CSP
 * no lista sus hosts, el navegador la bloquea y no mide — un feature que dice
 * estar y no está. Estas pruebas son el candado: los hosts tienen que estar en
 * `script-src` **y** `connect-src`, en las dos CSP (Nginx y el `<meta>`), y las
 * dos tienen que coincidir.
 *
 * No requiere base:  pnpm test tests/analytics-csp.test.ts
 */

const ROOT = resolve(__dirname, "..");

/**
 * La cadena de la CSP, aislada del resto del archivo.
 *
 * Se corta desde `default-src 'self'` hasta la comilla de cierre. Hace falta
 * porque los dos archivos tienen **comentarios** que mencionan `script-src` y
 * `connect-src` en prosa: buscar la directiva en el archivo entero matchearía el
 * comentario, no el header. La política no lleva comillas adentro, así que
 * `[^"]+` la captura entera y se detiene en el cierre.
 */
function politica(archivo: string): string {
  const texto = readFileSync(resolve(ROOT, archivo), "utf8");
  const m = /default-src 'self'[^"]+/.exec(texto);
  expect(m, `no se encontró la CSP en ${archivo}`).toBeTruthy();
  return m![0];
}

const nginx = politica("scripts/deploy/setup-vps.sh");
const meta = politica("apps/web/index.html");

/** Los tokens de una directiva dentro de una cadena de CSP ya aislada. */
function directiva(csp: string, nombre: string): string[] {
  const m = new RegExp(`(?:^|; )${nombre} ([^;]+)`).exec(csp);
  expect(m, `la CSP no declara ${nombre}`).toBeTruthy();
  return m![1].trim().split(/\s+/);
}

/** Los hosts que cada plataforma necesita, por directiva. */
const REQUERIDOS = {
  "script-src": ["https://www.googletagmanager.com", "https://connect.facebook.net"],
  "connect-src": [
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://connect.facebook.net",
    "https://www.facebook.com",
  ],
};

const fuentes: [string, string][] = [
  ["Nginx (setup-vps.sh)", nginx],
  ["<meta> (index.html)", meta],
];

describe("la CSP permite la analítica opt-in", () => {
  it.each(fuentes)("%s tiene los hosts de medición en script-src y connect-src", (_n, csp) => {
    for (const [dir, hosts] of Object.entries(REQUERIDOS)) {
      const presentes = directiva(csp, dir);
      for (const host of hosts) {
        expect(presentes, `falta ${host} en ${dir}`).toContain(host);
      }
    }
  });

  it("las dos CSP declaran el mismo script-src y el mismo connect-src", () => {
    // Si se abre una y se olvida la otra, la medición anda en un entorno y no en
    // el otro — el tipo de discrepancia que no se ve hasta producción.
    expect(directiva(nginx, "script-src").sort()).toEqual(directiva(meta, "script-src").sort());
    expect(directiva(nginx, "connect-src").sort()).toEqual(directiva(meta, "connect-src").sort());
  });

  it("no se agrandó object-src ni default-src: la apertura es sólo para medición", () => {
    // Un descuido común al tocar la CSP es aflojar de más. Estas dos siguen
    // cerradas.
    for (const [, csp] of fuentes) {
      expect(directiva(csp, "default-src")).toEqual(["'self'"]);
      expect(directiva(csp, "object-src")).toEqual(["'none'"]);
    }
  });
});
