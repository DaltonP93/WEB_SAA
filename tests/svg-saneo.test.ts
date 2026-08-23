import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import { sanearSvg } from "../api/src/svg.js";
import {
  DB_TESTS_ENABLED,
  TEST_ADMIN_PASSWORD,
  applyDbEnv,
  closeAppDb,
  closeServer,
  createTestDatabase,
  dropTestDatabase,
  migrateLatest,
  runSeeds,
} from "./helpers/db";

/**
 * El SVG deja de estar rechazado porque ahora hay saneo. Esto lo comprueba.
 *
 * Hasta la ronda anterior la postura era "SVG rechazado mientras no exista
 * saneo específico", y era la correcta: un SVG no es una imagen, es un
 * documento XML que el navegador ejecuta. Aceptarlo sin saneo es dejar que
 * cualquiera con acceso al panel publique código en el sitio.
 *
 * Ahora se acepta, así que la pregunta que estas pruebas tienen que contestar
 * cambia: ya no es "¿se rechaza?", es **"¿qué queda del archivo después de
 * sanearlo?"**. Y eso no se puede comprobar mirando la extensión ni la fila de
 * base: hay que mirar los bytes que quedaron en el disco.
 *
 * Cada caso de ataque afirma dos cosas separadas:
 *
 * 1. que el vector no está en la salida (no hay `<script>`, no hay `onload`);
 * 2. que **la carga útil tampoco está** — la cadena concreta que ejecutaría.
 *
 * La segunda es la que importa. Un saneador que borrara la etiqueta `<script>`
 * pero dejara su contenido como texto suelto pasaría la primera y publicaría
 * el código igual.
 *
 * La mitad de integración necesita base:
 *
 *   TEST_DATABASE=1 pnpm test tests/svg-saneo.test.ts
 */

/** Una carga útil única por caso: si aparece en la salida, no hay dudas de dónde salió. */
const PAYLOAD = "alert('SAA-PAYLOAD-9931')";

const svg = (interior: string, atributos = 'width="400" height="80" viewBox="0 0 400 80"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${atributos}>${interior}</svg>`;

/** El texto saneado, o el error. Falla la prueba si esperaba lo contrario. */
function limpio(entrada: string): string {
  const r = sanearSvg(entrada);
  if (!r.ok) throw new Error(`se esperaba que saneara, y rechazó: ${r.error}`);
  return r.svg;
}

describe("saneo de SVG", () => {
  describe("lo que ejecuta no sobrevive", () => {
    /**
     * Cada entrada trae el vector y **la cadena que no puede quedar**. Se
     * comprueban las dos: sin la segunda, un saneador que dejara el cuerpo del
     * script como texto pasaría igual.
     */
    const ataques: [string, string, string[]][] = [
      [
        "<script> directo",
        svg(`<script>${PAYLOAD}</script><rect width="10" height="10"/>`),
        ["script", PAYLOAD],
      ],
      [
        "onload en la raíz",
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80" onload="${PAYLOAD}"><rect width="10" height="10"/></svg>`,
        ["onload", PAYLOAD],
      ],
      [
        "onclick en un hijo",
        svg(`<rect width="10" height="10" onclick="${PAYLOAD}"/>`),
        ["onclick", PAYLOAD],
      ],
      [
        "<foreignObject> con HTML adentro",
        svg(`<foreignObject width="10" height="10"><img src="x" onerror="${PAYLOAD}"/></foreignObject>`),
        ["foreignObject", "onerror", PAYLOAD],
      ],
      [
        "<style> con @import a otro servidor",
        svg(`<style>@import url("https://cdn.ajeno.test/x.css");</style><rect width="10" height="10"/>`),
        ["@import", "cdn.ajeno.test", "<style"],
      ],
      [
        "<image> con destino externo",
        svg(`<image href="https://rastreador.ajeno.test/pixel.png" width="10" height="10"/>`),
        ["rastreador.ajeno.test", "<image"],
      ],
      [
        "<use> con destino externo",
        svg(`<use href="https://ajeno.test/otro.svg#simbolo"/>`),
        ["ajeno.test", "<use"],
      ],
      [
        "animación que reescribe un href a javascript:",
        svg(`<a href="#x"><set attributeName="href" to="javascript:${PAYLOAD}"/><rect width="10" height="10"/></a>`),
        ["javascript:", "attributeName", "<set", PAYLOAD],
      ],
      [
        "fill con url() a otro servidor",
        svg(`<rect width="10" height="10" fill="url(https://ajeno.test/x#g)"/>`),
        ["ajeno.test"],
      ],
      [
        "atributo style con url()",
        svg(`<rect width="10" height="10" style="background:url(https://ajeno.test/x)"/>`),
        ["ajeno.test", "style="],
      ],
      [
        "<iframe> adentro del SVG",
        svg(`<iframe src="https://ajeno.test/"></iframe><rect width="10" height="10"/>`),
        ["iframe", "ajeno.test"],
      ],
      [
        "enlace anónimo a otro sitio",
        svg(`<a href="https://ajeno.test/"><rect width="10" height="10"/></a>`),
        ["ajeno.test", "<a "],
      ],
    ];

    it.each(ataques)("%s: no queda nada de eso", (_q, entrada, prohibidas) => {
      const salida = limpio(entrada);
      for (const cadena of prohibidas) {
        expect(salida, `sobrevivió al saneo: ${cadena}`).not.toContain(cadena);
      }
      // Y sigue siendo un SVG utilizable, no un archivo vacío.
      expect(salida).toMatch(/<svg[\s>]/);
    });

    /**
     * En SVG los nombres de elemento distinguen mayúsculas, así que `<SCRIPT>`
     * no es el `script` de SVG ni ningún otro elemento válido: ninguna
     * herramienta de diseño lo emite.
     *
     * Importa por un motivo medido: con `lowerCaseTags: false` —obligatorio
     * para no romper `linearGradient` y `clipPath`—, `sanitize-html` compara
     * los nombres tal cual vienen, así que `<SCRIPT>` no entraba en
     * `nonTextTags`, se descartaba sólo la etiqueta y **el cuerpo del script
     * quedaba como texto suelto dentro del SVG publicado**.
     */
    const evasivas = [
      ["<SCRIPT> en mayúsculas", `<SCRIPT>${PAYLOAD}</SCRIPT><rect width="10" height="10"/>`],
      ["<ScRiPt> alternado", `<ScRiPt>${PAYLOAD}</ScRiPt><rect width="10" height="10"/>`],
      ["<FOREIGNOBJECT> en mayúsculas", `<FOREIGNOBJECT><b>x</b></FOREIGNOBJECT>`],
      ["<STYLE> en mayúsculas", `<STYLE>@import url("https://ajeno.test/x.css");</STYLE>`],
      ["<Use> capitalizado", `<Use href="https://ajeno.test/o.svg#s"/>`],
    ] as const;

    it.each(evasivas)("%s se rechaza entero, no se sanea a medias", (_q, interior) => {
      const r = sanearSvg(svg(interior));
      expect(r.ok, "se saneó a medias una etiqueta escrita para evadir el saneo").toBe(false);
      if (r.ok) return;
      // El motivo no puede repetir el archivo.
      expect(r.error).not.toContain(PAYLOAD);
      expect(r.error).not.toContain("ajeno.test");
    });

    /**
     * De un elemento que se descarta se descarta **también su contenido**.
     *
     * `sanitize-html` trae su propia lista de elementos "sin texto"
     * —`script`, `style`, `textarea`, `option`— y para todo lo demás conserva
     * el texto de adentro aunque tire la etiqueta. Medido: sin la lista propia
     * del proyecto, `<foreignObject><div>…</div></foreignObject>`,
     * `<a>…</a>` y `<use>…</use>` dejan su texto suelto dentro del `<svg>`.
     *
     * No es ejecución de código, y por eso se dice lo que es: contenido ajeno
     * que entra en un archivo institucional por la puerta de un elemento que
     * el saneador ya había decidido quitar. Un logo que trae texto que nadie
     * puso en el diseño —y que se ve apenas alguien incrusta el SVG en una
     * página— es un archivo distinto del que se creyó aprobar.
     */
    const conTexto = [
      ["foreignObject", `<foreignObject width="10" height="10"><div>TEXTO-AJENO-9931</div></foreignObject>`],
      ["a", `<a href="https://ajeno.test/">TEXTO-AJENO-9931</a>`],
      ["use", `<use href="#s">TEXTO-AJENO-9931</use>`],
    ] as const;

    it.each(conTexto)("<%s> se va con su contenido, no sólo con su etiqueta", (_q, interior) => {
      const salida = limpio(svg(`${interior}<rect width="10" height="10"/>`));

      expect(salida, "quedó el texto de un elemento descartado").not.toContain("TEXTO-AJENO-9931");
      expect(salida, "se llevó puesto el resto del logo").toContain("<rect");
    });

    it("la grafía canónica sí se sanea en vez de rechazarse", () => {
      // El rechazo es para la evasión, no para el elemento: un `<script>` bien
      // escrito se descarta y el resto del logo se publica igual. Si no fuera
      // así, cualquier SVG exportado con un script quedaría inutilizable.
      const salida = limpio(svg(`<script>${PAYLOAD}</script><rect width="10" height="10"/>`));
      expect(salida).not.toContain(PAYLOAD);
      expect(salida).toContain("<rect");
    });

    it("`on` en cualquier variante de mayúsculas se descarta", () => {
      for (const nombre of ["onload", "onLoad", "ONLOAD", "OnMouseOver"]) {
        const salida = limpio(svg(`<rect width="10" height="10" ${nombre}="${PAYLOAD}"/>`));
        expect(salida.toLowerCase(), `pasó ${nombre}`).not.toContain("on");
        expect(salida).not.toContain(PAYLOAD);
      }
    });
  });

  describe("lo que no debería ni llegar al parser se rechaza entero", () => {
    const rechazos: [string, string][] = [
      [
        "una entidad externa (XXE) que lee un archivo del servidor",
        `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>&xxe;</text></svg>`,
      ],
      [
        "un DOCTYPE cualquiera",
        `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`,
      ],
      [
        "una hoja de estilo externa por instrucción de proceso",
        `<?xml-stylesheet type="text/css" href="https://ajeno.test/x.css"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`,
      ],
      ["un archivo que no es un SVG", `<html><body>hola</body></html>`],
      ["texto suelto", `esto no es nada`],
      ["vacío", ``],
    ];

    it.each(rechazos)("%s se rechaza y no se sanea a medias", (_q, entrada) => {
      const r = sanearSvg(entrada);
      expect(r.ok, "entró un archivo que no debía sanearse").toBe(false);
    });

    it("el motivo del rechazo no repite el contenido del archivo", () => {
      const r = sanearSvg(
        `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///home/sanatorio/api/.env">]><svg xmlns="http://www.w3.org/2000/svg"/>`,
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      // El error va al operador y al log: no puede llevar la ruta que el
      // atacante quiso leer ni el resto del archivo.
      expect(r.error).not.toContain("file:///");
      expect(r.error).not.toContain("api/.env");
      expect(r.error).not.toContain("ENTITY");
    });
  });

  describe("un logo de verdad sobrevive entero", () => {
    const logo = `<?xml version="1.0" encoding="UTF-8"?>
<!-- exportado por una herramienta de diseño -->
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80" viewBox="0 0 400 80" role="img" aria-label="Sanatorio">
  <title>Sanatorio Adventista</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0b5" stop-opacity="1"/>
      <stop offset="1" stop-color="#083"/>
    </linearGradient>
    <clipPath id="recorte"><rect x="0" y="0" width="400" height="80"/></clipPath>
  </defs>
  <g clip-path="url(#recorte)" transform="translate(4,4)">
    <path d="M0 0 L40 0 L40 40 Z" fill="url(#g)" stroke="#083" stroke-width="2"/>
    <circle cx="60" cy="20" r="12" fill="#0b5" fill-opacity="0.8"/>
    <text x="90" y="26" font-family="Georgia, serif" font-size="20" fill="currentColor">Sanatorio</text>
  </g>
</svg>`;

    it("conserva viewBox, gradiente, referencia interna, geometría y texto", () => {
      const salida = limpio(logo);

      // `viewBox` distingue mayúsculas: con `lowerCaseAttributeNames` puesto,
      // sale como `viewbox` y el logo deja de escalar.
      expect(salida, "se perdió el viewBox: el logo deja de escalar").toContain("viewBox=");
      expect(salida).toContain("linearGradient");
      expect(salida, "se perdió la referencia interna al gradiente").toContain("url(#g)");
      expect(salida, "se perdió la referencia interna al recorte").toContain("url(#recorte)");
      expect(salida).toContain("<path");
      expect(salida).toContain("stop-color");
      expect(salida).toContain("transform=");
      expect(salida).toContain("<text");
      expect(salida, "se perdió el texto del logo").toContain("Sanatorio");
      expect(salida, "se perdió el título accesible").toContain("<title>");
      expect(salida).toContain('aria-label="Sanatorio"');
    });

    it("las dimensiones salen del propio archivo, sin rasterizar", () => {
      const r = sanearSvg(logo);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect([r.width, r.height], "un logo de 400×80 tiene que reportarse como tal").toEqual([400, 80]);
    });

    it("sin width/height explícitos, el tamaño sale del viewBox", () => {
      const r = sanearSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="10" height="10"/></svg>`);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect([r.width, r.height]).toEqual([120, 60]);
    });

    it("un tamaño en porcentaje no se inventa como píxeles", () => {
      const r = sanearSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><rect width="10" height="10"/></svg>`);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // `100%` no dice cuánto mide. Decir 100×100 sería inventar un dato.
      expect([r.width, r.height]).toEqual([null, null]);
    });
  });
});

// ---------------------------------------------------------------- integración

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_svg`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const RAIZ = mkdtempSync(path.join(os.tmpdir(), "svg-saneo-"));
const UPLOAD_DIR = path.join(RAIZ, "uploads");
const STAGING_DIR = path.join(RAIZ, "staging");

describeDb("lo que queda publicado en /uploads es el SVG saneado", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  beforeAll(async () => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.mkdirSync(STAGING_DIR, { recursive: true });
    process.env.UPLOAD_DIR = UPLOAD_DIR;
    process.env.UPLOAD_STAGING_DIR = STAGING_DIR;

    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-svg";
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@sanatorio.local", password: TEST_ADMIN_PASSWORD }),
    });
    token = (await login.json()).token;
    expect(token).toBeTruthy();
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
    rmSync(RAIZ, { recursive: true, force: true });
  });

  afterEach(async () => {
    await db("media").del();
    for (const n of fs.readdirSync(UPLOAD_DIR)) fs.rmSync(path.join(UPLOAD_DIR, n), { force: true });
  });

  async function subir(texto: string, nombre = "logo.svg", tipo = "image/svg+xml") {
    const form = new FormData();
    form.append("file", new Blob([texto], { type: tipo }), nombre);
    return fetch(`${baseUrl}/api/admin/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  }

  it("un SVG con script se acepta y el archivo del disco no lo tiene", async () => {
    const res = await subir(
      svg(`<script>${PAYLOAD}</script><rect width="400" height="80" fill="#0b5"/>`),
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const fila = await res.json();

    expect(fila.mime).toBe("image/svg+xml");
    expect(fila.url.endsWith(".svg")).toBe(true);

    // Lo único que prueba algo: los bytes que quedaron publicados.
    const guardado = fs.readFileSync(path.join(UPLOAD_DIR, path.basename(fila.url)), "utf8");
    expect(guardado, "se guardó el original en vez de la versión saneada").not.toContain(PAYLOAD);
    expect(guardado).not.toContain("<script");
    expect(guardado, "el archivo quedó vacío o dejó de ser un SVG").toContain("<svg");
    expect(guardado).toContain("<rect");
  });

  it("se guarda la versión saneada, no el original con otro nombre", async () => {
    const original = svg(`<rect width="400" height="80" onclick="${PAYLOAD}" fill="#0b5"/>`);
    const fila = await (await subir(original)).json();
    const guardado = fs.readFileSync(path.join(UPLOAD_DIR, path.basename(fila.url)), "utf8");

    expect(guardado, "el original quedó en el disco tal cual llegó").not.toBe(original);
    expect(guardado.length, "el archivo no puede quedar vacío").toBeGreaterThan(20);
    expect(fila.size, "el tamaño de la fila no es el del archivo guardado").toBe(
      Buffer.byteLength(guardado, "utf8"),
    );
  });

  it("las dimensiones del SVG llegan a la fila", async () => {
    const fila = await (await subir(svg(`<rect width="400" height="80"/>`))).json();
    expect([fila.width, fila.height]).toEqual([400, 80]);
    // No es una animación, y no es un PDF: un cuadro.
    expect(fila.frames).toBe(1);
  });

  it("un SVG con DOCTYPE se rechaza y no queda nada publicado", async () => {
    const res = await subir(
      `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`,
    );

    expect(res.status).toBe(400);
    expect(fs.readdirSync(UPLOAD_DIR), "quedó publicado").toHaveLength(0);
    expect(fs.readdirSync(STAGING_DIR), "quedó en el área temporal").toHaveLength(0);
    expect(await db("media").count({ n: "id" }).then((r) => Number(r[0].n))).toBe(0);
  });

  it("un archivo que sólo menciona <svg no entra por la puerta del SVG", async () => {
    const res = await subir(`# notas\nacá se explica cómo hacer un <svg> a mano\n`, "notas.svg");

    expect(res.status, "un texto cualquiera se aceptó como SVG").toBe(400);
    expect(fs.readdirSync(UPLOAD_DIR)).toHaveLength(0);
  });

  it("el error de un SVG rechazado no devuelve el contenido ni las rutas internas", async () => {
    const res = await subir(
      `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>SANATORIO-DATO-INTERNO-77</text></svg>`,
    );
    const texto = await res.text();

    expect(texto).not.toContain("SANATORIO-DATO-INTERNO");
    expect(texto).not.toContain("file:///");
    expect(texto).not.toContain(UPLOAD_DIR);
    expect(texto).not.toContain(STAGING_DIR);
  });
});
