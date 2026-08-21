import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
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
 * Las dos mitades del contrato de Multimedia que faltaban comprobar de verdad.
 *
 * **PDF.** Un archivo se aceptaba como PDF sólo porque empezaba con `%PDF-`.
 * Cualquier cosa con esos cinco bytes delante entraba a la biblioteca, se
 * guardaba con `mime: application/pdf` y quedaba publicada en una URL. La
 * prueba que decía cubrirlo usaba un fixture escrito a mano que ningún lector
 * de PDF podría abrir: afirmaba "un PDF de verdad se acepta" sobre algo que no
 * era un PDF.
 *
 * **Animación.** El pipeline comprobaba cuadros y transparencia, pero no
 * cuánto dura cada cuadro ni cuántas veces se repite la animación. Un logo que
 * conserva sus tres cuadros pero los pasa al doble de velocidad, o que da
 * vueltas para siempre cuando estaba pensado para tres pasadas, es un archivo
 * distinto del que subieron — y las comprobaciones anteriores lo daban por
 * bueno.
 *
 *   TEST_DATABASE=1 pnpm test tests/media-contrato.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_contrato`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const RAIZ = mkdtempSync(path.join(os.tmpdir(), "media-contrato-"));
const UPLOAD_DIR = path.join(RAIZ, "uploads");
const STAGING_DIR = path.join(RAIZ, "staging");

/** Un PDF estructuralmente real, con las páginas que se le pidan. */
async function pdfReal(paginas = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) doc.addPage([200, 200]).drawText(`Página ${i + 1}`);
  return Buffer.from(await doc.save());
}

const solido = (r: number, g: number, b: number, alpha: number, w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha } } }).png().toBuffer();

/**
 * Un animado con cuadros de **duraciones distintas** y repeticiones finitas.
 *
 * Que las duraciones sean distintas entre sí es lo que hace útil la prueba: si
 * fueran todas iguales, un codificador que las normalizara a un único valor
 * pasaría igual.
 */
async function animado(
  formato: "gif" | "webp",
  delay: number[],
  loop: number,
  w = 60,
  h = 40,
): Promise<Buffer> {
  const colores = [
    [255, 0, 0, 1],
    [0, 255, 0, 0], // transparente
    [0, 0, 255, 1],
    [255, 255, 0, 1],
  ] as const;
  const frames = await Promise.all(
    delay.map((_, i) => solido(colores[i % 4][0], colores[i % 4][1], colores[i % 4][2], colores[i % 4][3], w, h)),
  );
  const tira = await sharp({
    create: { width: w, height: h * frames.length, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(frames.map((input, i) => ({ input, top: i * h, left: 0 })))
    .raw()
    .toBuffer();

  const entrada = sharp(tira, {
    raw: { width: w, height: h * frames.length, channels: 4, pageHeight: h } as never,
  });
  return formato === "gif"
    ? entrada.gif({ loop, delay }).toBuffer()
    : entrada.webp({ loop, delay }).toBuffer();
}

const enPublico = () => fs.readdirSync(UPLOAD_DIR);

describeDb("contrato de multimedia: PDF real y animación completa", () => {
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
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-contrato";
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
    for (const n of enPublico()) fs.rmSync(path.join(UPLOAD_DIR, n), { force: true });
  });

  async function subir(bytes: Buffer, nombre: string, tipo: string) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: tipo }), nombre);
    return fetch(`${baseUrl}/api/admin/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  }

  const cuerpo = async (res: Response) => res.json() as Promise<Record<string, any>>;

  const delDisco = async (url: string) =>
    fs.promises.readFile(path.join(UPLOAD_DIR, path.basename(url)));

  describe("un PDF se valida estructuralmente, no por sus cinco primeros bytes", () => {
    it("un PDF real generado por una biblioteca se acepta y conserva sus páginas", async () => {
      const pdf = await pdfReal(3);
      // Control: lo que se sube es un PDF que otra biblioteca puede abrir.
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3);

      const res = await subir(pdf, "protocolo.pdf", "application/pdf");
      expect(res.status, await res.clone().text()).toBe(201);
      const fila = await cuerpo(res);

      expect(fila.mime).toBe("application/pdf");
      expect(fila.url.endsWith(".pdf")).toBe(true);
      expect([fila.width, fila.height, fila.frames]).toEqual([null, null, null]);
      // Los bytes cambian a propósito: el PDF se sanea antes de publicarse. Lo
      // que tiene que sobrevivir es el documento —que abra y tenga sus tres
      // páginas—, no la secuencia de bytes.
      expect(
        (await PDFDocument.load(await delDisco(fila.url))).getPageCount(),
        "el saneo rompió el documento o perdió páginas",
      ).toBe(3);
    });

    const invalidos: [string, () => Promise<Buffer> | Buffer][] = [
      [
        "un archivo arbitrario con el prefijo %PDF-",
        () => Buffer.from("%PDF-1.4\nesto es texto suelto, no un documento\n", "latin1"),
      ],
      [
        "el fixture escrito a mano que antes pasaba",
        () => Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1"),
      ],
      ["sólo la firma", () => Buffer.from("%PDF-", "latin1")],
      [
        "bytes de PNG detrás del prefijo",
        () => Buffer.concat([Buffer.from("%PDF-", "latin1"), Buffer.from([0x89, 0x50, 0x4e, 0x47])]),
      ],
      ["un PDF real truncado a la mitad", async () => (await pdfReal(2)).subarray(0, 300)],
    ];

    it.each(invalidos)("%s se rechaza", async (_q, hacer) => {
      const bytes = await hacer();
      const res = await subir(bytes, "informe.pdf", "application/pdf");

      expect(res.status, "entró a la biblioteca algo que no es un PDF").toBe(400);
      expect(enPublico(), "quedó publicado").toHaveLength(0);
      expect(await db("media").count({ n: "id" }).then((r) => Number(r[0].n))).toBe(0);
    });

    it("el error no revela contenido del archivo ni rutas internas", async () => {
      const res = await subir(
        Buffer.from("%PDF-1.4\nSANATORIO-DATO-INTERNO-12345\n", "latin1"),
        "informe.pdf",
        "application/pdf",
      );
      const texto = await res.text();

      expect(texto).not.toContain("SANATORIO-DATO-INTERNO");
      expect(texto).not.toContain(UPLOAD_DIR);
      expect(texto).not.toContain(STAGING_DIR);
      // Tampoco las posiciones que pdf-lib pone en su mensaje de error.
      expect(texto).not.toMatch(/offset|line:\d|col:\d/i);
    });

    it("un PDF no se procesa como imagen: sigue siendo un PDF abrible", async () => {
      const pdf = await pdfReal(1);
      const fila = await cuerpo(await subir(pdf, "x.pdf", "application/pdf"));
      const guardado = await delDisco(fila.url);

      // Si hubiera pasado por Sharp, no seguiría siendo un PDF abrible: Sharp
      // ni siquiera lee PDFs, así que la salida sería otra cosa o no habría
      // salida. Que `PDFDocument.load` lo abra y encuentre la página es lo que
      // distingue "se saneó" de "se convirtió".
      expect((await PDFDocument.load(guardado)).getPageCount()).toBe(1);
      expect(guardado.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });
  });

  describe("una animación conserva cuadros, transparencia, duración y repeticiones", () => {
    const DELAY = [120, 300, 500];
    const LOOP = 3;

    it.each(["gif", "webp"] as const)("%s animado: los cuatro se conservan", async (formato) => {
      const original = await animado(formato, DELAY, LOOP);

      // Control sobre la fixture: si no trae lo que decimos, la prueba de
      // abajo no probaría nada.
      const antes = await sharp(original, { animated: true }).metadata();
      expect(antes.pages, "la fixture no es animada").toBe(3);
      expect(antes.delay, "la fixture no trae duraciones distintas").toEqual(DELAY);
      expect(antes.loop, "la fixture no trae repeticiones finitas").toBe(LOOP);

      const res = await subir(original, `banner.${formato}`, `image/${formato}`);
      expect(res.status, await res.clone().text()).toBe(201);
      const fila = await cuerpo(res);

      const guardado = await delDisco(fila.url);
      const despues = await sharp(guardado, { animated: true }).metadata();

      expect(despues.format).toBe(formato);
      expect(despues.pages, "se perdieron cuadros").toBe(3);
      expect(despues.delay, "cambió la duración de los cuadros").toEqual(DELAY);
      expect(despues.loop, "cambió la cantidad de repeticiones").toBe(LOOP);

      // El segundo cuadro de la fixture es el transparente.
      const crudo = await sharp(guardado, { animated: true }).ensureAlpha().raw().toBuffer();
      expect(crudo[60 * 40 * 4 + 3], "se perdió la transparencia del cuadro 2").toBe(0);

      // Y lo mismo llega a la fila de la base.
      expect(fila.frames).toBe(3);
    });

    it("un bucle infinito se guarda como infinito y no como una pasada", async () => {
      // `loop: 0` es "para siempre" en GIF. Confundirlo con "una vez" haría
      // que un logo animado se congelara después del primer ciclo.
      const original = await animado("gif", [100, 100, 100], 0);
      const fila = await cuerpo(await subir(original, "infinito.gif", "image/gif"));

      const despues = await sharp(await delDisco(fila.url), { animated: true }).metadata();
      expect(despues.loop).toBe(0);
    });

    it("una animación de muchos cuadros no pierde ninguno ni desordena sus tiempos", async () => {
      const delay = [80, 90, 100, 110, 120, 130, 140, 150];
      const original = await animado("gif", delay, 2);
      const fila = await cuerpo(await subir(original, "muchos.gif", "image/gif"));

      const despues = await sharp(await delDisco(fila.url), { animated: true }).metadata();
      expect(despues.pages).toBe(delay.length);
      expect(despues.delay).toEqual(delay);
      expect(despues.loop).toBe(2);
    });

    it("un animado que además se redimensiona conserva tiempos y repeticiones", async () => {
      // El resize es donde más fácil se pierden: reconstruye cada página.
      const original = await animado("gif", DELAY, LOOP, 2000, 1200);
      const fila = await cuerpo(await subir(original, "grande.gif", "image/gif"));

      const despues = await sharp(await delDisco(fila.url), { animated: true }).metadata();
      expect(Math.max(despues.width!, despues.pageHeight!)).toBeLessThanOrEqual(1600);
      expect(despues.pages).toBe(3);
      expect(despues.delay).toEqual(DELAY);
      expect(despues.loop).toBe(LOOP);
    });

    it("una imagen fija no inventa duración ni repeticiones", async () => {
      const png = await solido(1, 2, 3, 1, 300, 200);
      const fila = await cuerpo(await subir(png, "fija.png", "image/png"));

      expect(fila.frames).toBe(1);
      // `delay` y `loop` en la respuesta serían una afirmación falsa sobre una
      // imagen que no se mueve.
      expect(fila.delay ?? null).toBeNull();
      expect(fila.loop ?? null).toBeNull();
    });
  });
});
