import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
 * El pipeline de Multimedia, comprobado sobre los archivos que deja.
 *
 * Cada caso **abre el archivo resultante con Sharp** y mira su formato real,
 * su alpha, sus cuadros y sus dimensiones. Mirar la extensión o la fila de la
 * base no probaría nada: el defecto que se está corrigiendo era justamente que
 * los tres se contradecían —un `.webp` con `mime: image/webp` en la base y
 * bytes JPEG adentro— y las tres comprobaciones baratas pasaban.
 *
 * Las fixtures se generan acá con Sharp. No se agregan binarios al repositorio:
 * un GIF animado de prueba comprometido es un archivo que nadie vuelve a mirar
 * y que nadie sabe cómo regenerar.
 *
 *   TEST_DATABASE=1 pnpm test tests/media-pipeline.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_media`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

/** Directorios propios: no se toca `./uploads` del repositorio. */
const RAIZ = mkdtempSync(path.join(os.tmpdir(), "media-test-"));
const UPLOAD_DIR = path.join(RAIZ, "uploads");
const STAGING_DIR = path.join(RAIZ, "staging");

const solido = (r: number, g: number, b: number, alpha: number, width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r, g, b, alpha } } }).png().toBuffer();

/**
 * Un animado de verdad.
 *
 * Sharp arma multipágina apilando los cuadros en vertical y declarando
 * `pageHeight` sobre la entrada **raw**. Con un PNG de entrada la opción se
 * ignora y sale un archivo de una sola página, que es precisamente el falso
 * positivo que estas pruebas tienen que evitar.
 */
async function animado(formato: "gif" | "webp", cuadros: number, w = 60, h = 40): Promise<Buffer> {
  const colores = [
    { r: 255, g: 0, b: 0, alpha: 1 },
    { r: 0, g: 255, b: 0, alpha: 0 },
    { r: 0, g: 0, b: 255, alpha: 1 },
    { r: 255, g: 255, b: 0, alpha: 1 },
  ];
  const frames = await Promise.all(
    Array.from({ length: cuadros }, (_, i) => solido(colores[i % 4].r, colores[i % 4].g, colores[i % 4].b, colores[i % 4].alpha, w, h)),
  );
  const tira = await sharp({
    create: { width: w, height: h * cuadros, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(frames.map((input, i) => ({ input, top: i * h, left: 0 })))
    .raw()
    .toBuffer();

  const entrada = sharp(tira, { raw: { width: w, height: h * cuadros, channels: 4, pageHeight: h } as never });
  return formato === "gif" ? entrada.gif({ loop: 0 }).toBuffer() : entrada.webp().toBuffer();
}

/** Metadatos del archivo que quedó en `/uploads`, leídos con Sharp. */
async function delDisco(url: string) {
  const ruta = path.join(UPLOAD_DIR, path.basename(url));
  const bytes = await fs.promises.readFile(ruta);
  const meta = await sharp(bytes, { animated: true }).metadata();
  return { ruta, bytes, meta };
}

/** El valor alpha del primer píxel de una página concreta. */
async function alphaEnPagina(bytes: Buffer, pagina: number, ancho: number, alto: number): Promise<number> {
  const crudo = await sharp(bytes, { animated: true }).ensureAlpha().raw().toBuffer();
  return crudo[pagina * ancho * alto * 4 + 3];
}

/**
 * Un PDF **estructuralmente real**, generado por pdf-lib.
 *
 * El fixture anterior era `"%PDF-1.4\\n1 0 obj..."` escrito a mano: pasaba la
 * validación de entonces —que miraba cinco bytes— y no es un PDF. Una prueba
 * que afirma "un PDF de verdad se acepta" usando un archivo que ningún lector
 * podría abrir no prueba nada; peor, hace creer que sí.
 */
async function pdfReal(paginas = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) doc.addPage([200, 200]).drawText(`Página ${i + 1}`);
  return Buffer.from(await doc.save());
}

const enStaging = () => fs.readdirSync(STAGING_DIR);
const enPublico = () => fs.readdirSync(UPLOAD_DIR);

describeDb("pipeline de multimedia", () => {
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
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-media";
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
    expect(token, "sin token no se puede probar nada de lo que sigue").toBeTruthy();
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
    rmSync(RAIZ, { recursive: true, force: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db("media").del();
    for (const nombre of enPublico()) fs.rmSync(path.join(UPLOAD_DIR, nombre), { force: true });
    for (const nombre of enStaging()) fs.rmSync(path.join(STAGING_DIR, nombre), { force: true, recursive: true });
  });

  /** Sube un archivo por la API administrativa real, con multipart de verdad. */
  async function subir(
    bytes: Buffer,
    nombre: string,
    tipo: string,
    extra: { alt?: string; sinToken?: boolean } = {},
  ) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: tipo }), nombre);
    if (extra.alt !== undefined) form.append("alt", extra.alt);
    return fetch(`${baseUrl}/api/admin/media`, {
      method: "POST",
      headers: extra.sinToken ? {} : { Authorization: `Bearer ${token}` },
      body: form,
    });
  }

  const cuerpo = async (res: Response) => res.json() as Promise<Record<string, any>>;

  describe("autenticación", () => {
    it("sin token responde 401 y no escribe nada", async () => {
      const png = await solido(10, 20, 30, 1, 400, 300);
      const res = await subir(png, "foto.png", "image/png", { sinToken: true });

      expect(res.status).toBe(401);
      expect(enPublico(), "un archivo público sin autenticar").toHaveLength(0);
      expect(await db("media").count({ n: "id" }).then((r) => Number(r[0].n))).toBe(0);
    });
  });

  describe("cada formato sale como sí mismo", () => {
    it("PNG transparente: sigue siendo PNG y el píxel transparente sigue transparente", async () => {
      const png = await solido(0, 255, 0, 0, 400, 300);
      const res = await subir(png, "logo.png", "image/png");
      expect(res.status, await res.clone().text()).toBe(201);
      const fila = await cuerpo(res);

      expect(fila.mime).toBe("image/png");
      expect(fila.url.endsWith(".png")).toBe(true);

      const { meta, bytes } = await delDisco(fila.url);
      expect(meta.format, "los bytes tienen que ser PNG, no sólo el nombre").toBe("png");
      expect(meta.hasAlpha).toBe(true);
      expect(await alphaEnPagina(bytes, 0, 400, 300), "la transparencia se perdió").toBe(0);
      expect([meta.width, meta.height]).toEqual([400, 300]);
      expect([fila.width, fila.height]).toEqual([400, 300]);
    });

    it("WebP transparente: conserva alpha y sigue siendo WebP", async () => {
      const base = await solido(0, 255, 0, 0, 400, 300);
      const webp = await sharp(base).webp().toBuffer();
      const res = await subir(webp, "logo.webp", "image/webp");
      expect(res.status, await res.clone().text()).toBe(201);
      const fila = await cuerpo(res);

      expect(fila.mime, "convertir a JPEG acá era el defecto original").toBe("image/webp");
      expect(fila.url.endsWith(".webp")).toBe(true);

      const { meta, bytes } = await delDisco(fila.url);
      expect(meta.format).toBe("webp");
      expect(meta.hasAlpha).toBe(true);
      expect(await alphaEnPagina(bytes, 0, 400, 300)).toBe(0);
    });

    it("WebP animado: conserva la cantidad de cuadros", async () => {
      const webp = await animado("webp", 3);
      expect((await sharp(webp, { animated: true }).metadata()).pages, "la fixture no es animada").toBe(3);

      const res = await subir(webp, "banner.webp", "image/webp");
      expect(res.status, await res.clone().text()).toBe(201);
      const fila = await cuerpo(res);

      const { meta } = await delDisco(fila.url);
      expect(meta.format).toBe("webp");
      expect(meta.pages, "se guardó un solo cuadro").toBe(3);
      expect(fila.frames).toBe(3);
    });

    it("GIF animado de 3 cuadros: los conserva todos y sigue siendo GIF", async () => {
      const gif = await animado("gif", 3);
      expect((await sharp(gif, { animated: true }).metadata()).pages).toBe(3);

      const res = await subir(gif, "animacion.gif", "image/gif");
      expect(res.status, await res.clone().text()).toBe(201);
      const fila = await cuerpo(res);

      expect(fila.mime).toBe("image/gif");
      expect(fila.url.endsWith(".gif")).toBe(true);

      const { meta, bytes } = await delDisco(fila.url);
      expect(meta.format, "el pipeline viejo dejaba acá un JPEG llamado .gif").toBe("gif");
      expect(meta.pages, "el pipeline viejo dejaba sólo el primer cuadro").toBe(3);
      expect(meta.pageHeight).toBe(40);
      // El segundo cuadro de la fixture es el transparente.
      expect(await alphaEnPagina(bytes, 1, 60, 40), "la transparencia del cuadro 2 se perdió").toBe(0);
      expect(fila.frames).toBe(3);
    });

    it("GIF de dos cuadros: el mínimo que distingue animado de fijo", async () => {
      const gif = await animado("gif", 2);
      const res = await subir(gif, "dos.gif", "image/gif");
      expect(res.status).toBe(201);

      const { meta } = await delDisco((await cuerpo(res)).url);
      expect(meta.pages).toBe(2);
    });

    it("JPEG opaco: sigue siendo JPEG, sin EXIF y dentro del lado máximo", async () => {
      const grande = await sharp({
        create: { width: 2400, height: 1800, channels: 3, background: { r: 120, g: 60, b: 30 } },
      })
        .jpeg()
        .withMetadata({ exif: { IFD0: { Copyright: "Sanatorio", Software: "camara-de-prueba" } } })
        .toBuffer();
      expect((await sharp(grande).metadata()).exif, "la fixture tiene que traer EXIF").toBeTruthy();

      const res = await subir(grande, "banner.jpg", "image/jpeg");
      expect(res.status, await res.clone().text()).toBe(201);
      const fila = await cuerpo(res);

      expect(fila.mime).toBe("image/jpeg");
      const { meta } = await delDisco(fila.url);
      expect(meta.format).toBe("jpeg");
      expect(meta.exif, "el EXIF de la foto llegó al sitio").toBeFalsy();
      expect(Math.max(meta.width!, meta.height!), "no se respetó el lado máximo").toBeLessThanOrEqual(1600);
      expect([fila.width, fila.height]).toEqual([1600, 1200]);
      expect(fila.frames).toBe(1);
    });

    it("una imagen chica no se agranda", async () => {
      const chica = await solido(80, 80, 80, 1, 120, 90);
      const res = await subir(chica, "chica.png", "image/png");
      expect(res.status).toBe(201);

      const { meta } = await delDisco((await cuerpo(res)).url);
      expect([meta.width, meta.height]).toEqual([120, 90]);
    });
  });

  describe("bytes, extensión y MIME no se contradicen nunca", () => {
    const casos: [string, string, string][] = [
      ["extensión mentida", "retrato.gif", "image/gif"],
      ["MIME mentido", "retrato.png", "application/pdf"],
      ["los dos mentidos", "documento.pdf", "application/pdf"],
      ["sin extensión", "retrato", "application/octet-stream"],
    ];

    it.each(casos)("un PNG subido como %s se guarda como PNG", async (_q, nombre, tipo) => {
      const png = await solido(9, 9, 9, 1, 300, 200);
      const res = await subir(png, nombre, tipo);
      expect(res.status, await res.clone().text()).toBe(201);
      const fila = await cuerpo(res);

      expect(fila.mime, "se guardó el MIME que mandó el cliente").toBe("image/png");
      expect(fila.url.endsWith(".png")).toBe(true);
      const { meta } = await delDisco(fila.url);
      expect(meta.format).toBe("png");
    });

    it("una cabecera de PNG con cuerpo de otra cosa se rechaza", async () => {
      const falso = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from("esto no es una imagen", "utf8"),
      ]);
      const res = await subir(falso, "trampa.png", "image/png");

      expect(res.status).toBe(400);
      expect(enPublico()).toHaveLength(0);
    });

    it("el nombre original no aparece en la URL guardada", async () => {
      const png = await solido(1, 2, 3, 1, 300, 200);
      const res = await subir(png, "Radiografía del Dr. Pérez.png", "image/png");
      const fila = await cuerpo(res);

      expect(fila.url).not.toMatch(/radiograf|perez|p%C3%A9rez/i);
      expect(fila.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    });
  });

  describe("límites", () => {
    it("una imagen de 1×1 se rechaza", async () => {
      const punto = await solido(0, 0, 0, 1, 1, 1);
      const res = await subir(punto, "punto.png", "image/png");

      expect(res.status).toBe(400);
      expect((await cuerpo(res)).error).toMatch(/peque/i);
      expect(enPublico()).toHaveLength(0);
    });

    it("un logo horizontal de 400×80 se acepta", async () => {
      const logo = await solido(0, 100, 200, 0, 400, 80);
      const res = await subir(logo, "logo.png", "image/png");

      expect(res.status, "la regla de 200×200 rechazaba este logo").toBe(201);
      const { meta } = await delDisco((await cuerpo(res)).url);
      expect([meta.width, meta.height]).toEqual([400, 80]);
    });

    it("un archivo que no es ninguno de los formatos se rechaza", async () => {
      const res = await subir(Buffer.from("MZ ejecutable", "latin1"), "algo.png", "image/png");

      expect(res.status).toBe(400);
      expect((await cuerpo(res)).error).toMatch(/formato no permitido/i);
      expect(enPublico()).toHaveLength(0);
    });

    it("un PDF falso —extensión y MIME de PDF, contenido cualquiera— se rechaza", async () => {
      const res = await subir(Buffer.from("no soy un pdf", "utf8"), "informe.pdf", "application/pdf");

      expect(res.status).toBe(400);
      expect(enPublico()).toHaveLength(0);
      expect(await db("media").count({ n: "id" }).then((r) => Number(r[0].n))).toBe(0);
    });

    it("un PDF de verdad se guarda sin pasar por Sharp y con dimensiones nulas", async () => {
      const pdf = await pdfReal(2);
      const res = await subir(pdf, "protocolo.pdf", "application/pdf");
      expect(res.status, await res.clone().text()).toBe(201);
      const fila = await cuerpo(res);

      expect(fila.mime).toBe("application/pdf");
      expect(fila.url.endsWith(".pdf")).toBe(true);
      expect(fila.width).toBeNull();
      expect(fila.height).toBeNull();
      expect(fila.frames).toBeNull();

      // El PDF se **sanea**, así que los bytes cambian a propósito: la versión
      // anterior de esta prueba exigía `guardado.equals(pdf)`, y esa igualdad
      // era justamente la que impedía quitarle las acciones al documento. Lo
      // que se conserva no son los bytes, es el documento: sigue abriéndose y
      // sigue teniendo sus dos páginas. Si hubiera pasado por Sharp —el punto
      // original de la prueba— no sería un PDF abrible.
      const guardado = await fs.promises.readFile(path.join(UPLOAD_DIR, path.basename(fila.url)));
      expect((await PDFDocument.load(guardado)).getPageCount(), "el PDF dejó de abrirse").toBe(2);
    });

    it("una imagen que se expande de forma desproporcionada se rechaza", async () => {
      // 9000×3000 = 27 MP de un solo color: comprime a unos pocos KB.
      const bomba = await sharp({
        create: { width: 9000, height: 3000, channels: 3, background: { r: 255, g: 255, b: 255 } },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      expect(bomba.length, "la fixture no comprime lo suficiente para el caso").toBeLessThan(200_000);

      const res = await subir(bomba, "bomba.png", "image/png");
      expect(res.status).toBe(400);
      expect((await cuerpo(res)).error).toMatch(/expande|píxeles/i);
      expect(enPublico()).toHaveLength(0);
    });
  });

  describe("nada queda a medias", () => {
    it("dos subidas simultáneas del mismo nombre original dan URLs distintas", async () => {
      const png = await solido(4, 4, 4, 1, 300, 200);
      const [a, b] = await Promise.all([
        subir(png, "logo.png", "image/png"),
        subir(png, "logo.png", "image/png"),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);

      const [ua, ub] = [(await cuerpo(a)).url, (await cuerpo(b)).url];
      expect(ua, "con nombres basados en Date.now() una pisaba a la otra").not.toBe(ub);
      expect(enPublico()).toHaveLength(2);
    });

    it("un rechazo no deja temporales ni archivos públicos", async () => {
      const res = await subir(Buffer.from("cualquier cosa", "utf8"), "x.png", "image/png");
      expect(res.status).toBe(400);

      expect(enStaging(), "quedó un temporal del archivo rechazado").toHaveLength(0);
      expect(enPublico()).toHaveLength(0);
    });

    it("un fallo de Sharp no deja temporales", async () => {
      const png = await solido(5, 5, 5, 1, 300, 200);
      const imagenes = await import("../api/src/imagenes.js");
      vi.spyOn(imagenes, "procesarSubida").mockRejectedValueOnce(new Error("libvips explotó"));

      const res = await subir(png, "explota.png", "image/png");
      expect(res.status).toBe(500);
      expect(enStaging()).toHaveLength(0);
      expect(enPublico()).toHaveLength(0);
    });

    it("un fallo real del INSERT no deja archivo público ni temporal", async () => {
      const png = await solido(6, 6, 6, 1, 300, 200);
      // Se rompe la tabla de verdad: no se simula el error, se provoca.
      await db.schema.alterTable("media", (t) => t.renameColumn("mime", "mime_roto"));
      let res: Response;
      try {
        res = await subir(png, "sin-tabla.png", "image/png");
      } finally {
        await db.schema.alterTable("media", (t) => t.renameColumn("mime_roto", "mime"));
      }

      expect(res.status).toBe(500);
      expect(enPublico(), "el archivo quedó publicado sin fila que lo registre").toHaveLength(0);
      expect(enStaging()).toHaveLength(0);
      expect(await db("media").count({ n: "id" }).then((r) => Number(r[0].n))).toBe(0);
    });

    it("una subida exitosa deja el staging vacío", async () => {
      const png = await solido(7, 7, 7, 1, 300, 200);
      const res = await subir(png, "ok.png", "image/png");
      expect(res.status).toBe(201);

      expect(enStaging()).toHaveLength(0);
      expect(enPublico()).toHaveLength(1);
    });

    it("el barrido borra los temporales viejos y respeta los recientes", async () => {
      const viejo = path.join(STAGING_DIR, "viejo.part");
      const nuevo = path.join(STAGING_DIR, "nuevo.part");
      fs.writeFileSync(viejo, "x");
      fs.writeFileSync(nuevo, "x");
      const hace2h = Date.now() - 2 * 60 * 60 * 1000;
      fs.utimesSync(viejo, hace2h / 1000, hace2h / 1000);

      const { limpiarStagingViejo } = await import("../api/src/routes/admin/media.js");
      expect(await limpiarStagingViejo()).toBe(1);
      expect(enStaging()).toEqual(["nuevo.part"]);
    });

    it("eliminar borra la fila y el archivo del disco", async () => {
      const png = await solido(8, 8, 8, 1, 300, 200);
      const fila = await cuerpo(await subir(png, "borrable.png", "image/png"));
      expect(enPublico()).toHaveLength(1);

      const res = await fetch(`${baseUrl}/api/admin/media/${fila.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(204);
      expect(enPublico()).toHaveLength(0);
      expect(await db("media").where({ id: fila.id }).first()).toBeUndefined();
    });
  });

  describe("el texto alternativo y el autor", () => {
    it("se guarda el alt y quién subió", async () => {
      const png = await solido(3, 3, 3, 1, 300, 200);
      const res = await subir(png, "con-alt.png", "image/png", { alt: "Fachada del sanatorio" });
      const fila = await cuerpo(res);

      expect(fila.alt).toBe("Fachada del sanatorio");
      expect(fila.uploaded_by).toBeTruthy();
    });

    it("sin alt queda en NULL y no en cadena vacía", async () => {
      const png = await solido(3, 3, 3, 1, 300, 200);
      const fila = await cuerpo(await subir(png, "sin-alt.png", "image/png"));
      expect(fila.alt).toBeNull();
    });

    it("un alt larguísimo se rechaza en vez de recortarse en silencio", async () => {
      const png = await solido(3, 3, 3, 1, 300, 200);
      const res = await subir(png, "alt.png", "image/png", { alt: "a".repeat(300) });

      expect(res.status).toBe(400);
      expect(enPublico()).toHaveLength(0);
    });
  });

  describe("los logs no filtran nada del archivo", () => {
    it("ni el nombre original, ni la ruta del disco, ni el contenido", async () => {
      const escrito: string[] = [];
      for (const nivel of ["log", "warn", "error", "info"] as const) {
        vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
          escrito.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
        });
      }

      const png = await solido(2, 2, 2, 1, 300, 200);
      await subir(png, "Historia clinica de Rosalinda.png", "image/png");
      await subir(Buffer.from("basura", "utf8"), "Historia clinica de Rosalinda.png", "image/png");

      await db.schema.alterTable("media", (t) => t.renameColumn("mime", "mime_roto"));
      try {
        await subir(png, "Historia clinica de Rosalinda.png", "image/png");
      } finally {
        await db.schema.alterTable("media", (t) => t.renameColumn("mime_roto", "mime"));
      }

      const todo = escrito.join("\n");
      for (const dato of ["Rosalinda", "Historia clinica", STAGING_DIR, UPLOAD_DIR, "insert into", "mime_roto"]) {
        expect(todo, `apareció "${dato}" en los logs`).not.toContain(dato);
      }
    });
  });
});

/**
 * La migración que agrega los metadatos, ida y vuelta.
 *
 * No se edita `20260516000001_init.ts`: ya está aplicada en la base del
 * sanatorio. Las columnas son anulables porque un PDF no tiene dimensiones y
 * porque las filas anteriores se subieron con el pipeline viejo — no se puede
 * afirmar su tamaño sin volver a abrir cada archivo, y esta migración no toca
 * archivos.
 */
describeDb("migración de metadatos de media", () => {
  const DB_MIG = `${DB_NAME}_mig`;
  let mdb: Knex;

  const columnas = async () => {
    const presentes: string[] = [];
    for (const c of ["width", "height", "frames"]) {
      if (await mdb.schema.hasColumn("media", c)) presentes.push(c);
    }
    return presentes;
  };

  beforeAll(async () => {
    mdb = await createTestDatabase(DB_MIG);
    await migrateLatest(mdb);
  }, 240_000);

  afterAll(async () => {
    if (mdb) await mdb.destroy();
    await dropTestDatabase(DB_MIG);
  });

  it("deja las tres columnas anulables", async () => {
    expect(await columnas()).toEqual(["width", "height", "frames"]);

    // Una fila sin metadatos —como las que ya existen— se sigue pudiendo
    // insertar: si las columnas fueran obligatorias, la migración rompería el
    // alta de PDFs.
    const [id] = await mdb("media").insert({ url: "/uploads/viejo.png", mime: "image/png", size: 100 });
    const fila = await mdb("media").where({ id }).first();
    expect([fila.width, fila.height, fila.frames]).toEqual([null, null, null]);
    await mdb("media").where({ id }).del();
  });

  it("el rollback las quita y volver a aplicarla las devuelve", async () => {
    const { down, up } = await import("../api/migrations/20260824000000_media_metadatos.js");

    await down(mdb);
    expect(await columnas(), "el rollback dejó columnas atrás").toEqual([]);
    // La tabla sigue existiendo y usable con el esquema anterior.
    const [id] = await mdb("media").insert({ url: "/uploads/x.png", mime: "image/png", size: 10 });
    expect(await mdb("media").where({ id }).first()).toBeTruthy();

    await up(mdb);
    expect(await columnas()).toEqual(["width", "height", "frames"]);
    // La fila que existía durante el rollback sobrevive, con metadatos en NULL.
    const recuperada = await mdb("media").where({ id }).first();
    expect(recuperada.url).toBe("/uploads/x.png");
    expect(recuperada.width).toBeNull();
    await mdb("media").where({ id }).del();
  });

  it("es idempotente en las dos direcciones", async () => {
    const { down, up } = await import("../api/migrations/20260824000000_media_metadatos.js");

    await up(mdb);
    await up(mdb);
    expect(await columnas()).toEqual(["width", "height", "frames"]);

    await down(mdb);
    await down(mdb);
    expect(await columnas()).toEqual([]);

    await up(mdb);
    expect(await columnas()).toEqual(["width", "height", "frames"]);
  });
});
