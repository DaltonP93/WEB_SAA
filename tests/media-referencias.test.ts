import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import sharp from "sharp";
import { contarEnJson } from "../api/src/media-referencias.js";
import {
  DB_TESTS_ENABLED,
  TEST_ADMIN_PASSWORD,
  applyDbEnv,
  closeAppDb,
  closeServer,
  createTestDatabase,
  dropTestDatabase,
  jsonColumn,
  migrateLatest,
  runSeeds,
} from "./helpers/db";

/**
 * Borrar un archivo que algo está usando rompe contenido en silencio.
 *
 * No falla en el momento: la fila desaparece de la biblioteca, el archivo
 * desaparece del disco, y el bloque de la página sigue apuntando a una URL que
 * ahora da 404. Se nota recién cuando alguien visita la página y ve un hueco,
 * y para entonces nadie relaciona las dos cosas.
 *
 * Las ubicaciones que se comprueban son las del **esquema efectivo**:
 * `blocks.props` (los bloques viven en su propia tabla, no en una columna de
 * `pages`), `settings["brand"].logoUrl`, `settings["seo"].ogImage` y
 * `doctors.photo_url`.
 *
 *   TEST_DATABASE=1 pnpm test tests/media-referencias.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_refs`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const RAIZ = mkdtempSync(path.join(os.tmpdir(), "media-refs-"));
const UPLOAD_DIR = path.join(RAIZ, "uploads");
const STAGING_DIR = path.join(RAIZ, "staging");

const solido = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } })
    .png()
    .toBuffer();

/** MariaDB quiere string en una columna JSON; MySQL 8 acepta las dos. */
const textoJson = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

describe("contarEnJson", () => {
  it("cuenta sólo coincidencias exactas de valores string", () => {
    const url = "/uploads/a.png";
    expect(contarEnJson({ imageUrl: url }, url)).toBe(1);
    expect(contarEnJson({ logos: [{ imageUrl: url }, { imageUrl: url }] }, url)).toBe(2);
    expect(contarEnJson([{ a: { b: [url] } }], url)).toBe(1);
  });

  it("no cuenta un prefijo ni una URL parecida", () => {
    // Buscar en el JSON serializado contaría `/uploads/a.pn` como coincidencia
    // de `/uploads/a.png`, y borraría un archivo que nadie usa… o al revés.
    expect(contarEnJson({ imageUrl: "/uploads/a.png" }, "/uploads/a.pn")).toBe(0);
    expect(contarEnJson({ imageUrl: "/uploads/a.png.bak" }, "/uploads/a.png")).toBe(0);
  });

  it("no cuenta una URL que aparece como clave", () => {
    expect(contarEnJson({ "/uploads/a.png": "algo" }, "/uploads/a.png")).toBe(0);
  });

  it("tolera null, números y estructuras raras", () => {
    expect(contarEnJson(null, "/x")).toBe(0);
    expect(contarEnJson(42, "/x")).toBe(0);
    expect(contarEnJson(undefined, "/x")).toBe(0);
  });
});

describeDb("no se borra un archivo que algo está usando", () => {
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
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-refs";
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

  /**
   * Se arma en cada llamada, no una vez.
   *
   * Como constante del `describe` se evaluaba al construir la suite —antes de
   * que `beforeAll` obtuviera el token— y todas las peticiones salían con
   * `Bearer undefined`.
   */
  const auth = () => ({ Authorization: `Bearer ${token}` });

  /** Sube una imagen y devuelve la fila que quedó. */
  async function subirImagen(nombre = "libre.png") {
    const form = new FormData();
    const bytes = await solido(300, 200);
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), nombre);
    const res = await fetch(`${baseUrl}/api/admin/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as { id: number; url: string; alt: string | null };
  }

  const borrar = (id: number) =>
    fetch(`${baseUrl}/api/admin/media/${id}`, { method: "DELETE", headers: auth() });

  const enDisco = (url: string) => fs.existsSync(path.join(UPLOAD_DIR, path.basename(url)));

  afterEach(async () => {
    await db("blocks").del();
    await db("doctors").update({ photo_url: null });
    for (const key of ["brand", "seo"]) {
      const fila = await db("settings").where({ key }).first();
      if (!fila) continue;
      const valor = jsonColumn<Record<string, unknown>>(fila.value);
      delete valor.logoUrl;
      delete valor.ogImage;
      await db("settings").where({ key }).update({ value: textoJson(valor) });
    }
    await db("media").del();
    for (const n of fs.readdirSync(UPLOAD_DIR)) fs.rmSync(path.join(UPLOAD_DIR, n), { force: true });
  });

  it("un archivo que nadie usa se borra", async () => {
    const media = await subirImagen();
    expect(enDisco(media.url)).toBe(true);

    const res = await borrar(media.id);

    expect(res.status).toBe(204);
    expect(enDisco(media.url)).toBe(false);
    expect(await db("media").where({ id: media.id }).first()).toBeUndefined();
  });

  describe("referenciado en un bloque de página", () => {
    it("responde 409 y no borra nada", async () => {
      const media = await subirImagen();
      const pagina = await db("pages").first("id", "title");
      await db("blocks").insert({
        page_id: pagina.id,
        type: "logos",
        props: textoJson({ logos: [{ imageUrl: media.url, alt: "Aliado" }] }),
        order: 0,
      });

      const res = await borrar(media.id);

      expect(res.status).toBe(409);
      expect(enDisco(media.url), "el archivo se borró igual").toBe(true);
      expect(await db("media").where({ id: media.id }).first()).toBeTruthy();
    });

    it("dice dónde está usado y cuántas veces, sin publicar el contenido", async () => {
      const media = await subirImagen();
      const pagina = await db("pages").first("id", "title");
      await db("blocks").insert({
        page_id: pagina.id,
        type: "logos",
        props: textoJson({
          heading: "Trabajamos con estas obras sociales",
          logos: [
            { imageUrl: media.url, alt: "Aliado uno" },
            { imageUrl: media.url, alt: "Aliado dos" },
          ],
        }),
        order: 0,
      });

      const cuerpo = await (await borrar(media.id)).json();
      const refs = cuerpo.details.referencias as { lugar: string; cantidad: number; ruta?: string }[];

      expect(refs).toHaveLength(1);
      expect(refs[0].cantidad, "contó bloques y no apariciones").toBe(2);
      expect(refs[0].lugar).toContain(pagina.title);
      expect(refs[0].ruta, "sin ruta, el panel no puede llevar a corregirlo").toBe("/pages");

      // Ubicación y cantidad, nunca el contenido institucional del bloque.
      const texto = JSON.stringify(cuerpo);
      expect(texto).not.toContain("Trabajamos con estas obras sociales");
      expect(texto).not.toContain("Aliado uno");
    });

    it("un bloque que usa otra imagen no bloquea el borrado", async () => {
      const usada = await subirImagen("usada.png");
      const libre = await subirImagen("libre.png");
      const pagina = await db("pages").first("id");
      await db("blocks").insert({
        page_id: pagina.id,
        type: "logos",
        props: textoJson({ logos: [{ imageUrl: usada.url }] }),
        order: 0,
      });

      expect((await borrar(libre.id)).status).toBe(204);
      expect((await borrar(usada.id)).status).toBe(409);
    });

    it("encuentra la URL en cualquier profundidad del árbol de props", async () => {
      // La URL puede estar en `imageUrl`, en `url`, dentro de slides… Buscar
      // sólo claves conocidas dejaría fuera cualquier bloque futuro.
      const media = await subirImagen();
      const pagina = await db("pages").first("id");
      await db("blocks").insert({
        page_id: pagina.id,
        type: "slider",
        props: textoJson({ slides: [{ title: "x" }, { title: "y", imageUrl: media.url }] }),
        order: 0,
      });

      expect((await borrar(media.id)).status).toBe(409);
    });
  });

  describe("referenciado en un ajuste institucional", () => {
    it.each([
      ["brand", "logoUrl", /logo/i],
      ["seo", "ogImage", /redes|seo/i],
    ])("%s.%s → 409", async (key, campo, etiqueta) => {
      const media = await subirImagen();
      const fila = await db("settings").where({ key }).first();
      const valor = jsonColumn<Record<string, unknown>>(fila.value);
      await db("settings")
        .where({ key })
        .update({ value: textoJson({ ...valor, [campo]: media.url }) });

      const res = await borrar(media.id);
      expect(res.status).toBe(409);
      const refs = (await res.json()).details.referencias as { lugar: string }[];
      expect(refs.some((r) => etiqueta.test(r.lugar))).toBe(true);
      expect(enDisco(media.url)).toBe(true);
    });
  });

  describe("referenciado como foto de un médico", () => {
    it("responde 409 y nombra al médico", async () => {
      const media = await subirImagen();
      const medico = await db("doctors").first("id", "name");
      await db("doctors").where({ id: medico.id }).update({ photo_url: media.url });

      const res = await borrar(media.id);
      expect(res.status).toBe(409);

      const refs = (await res.json()).details.referencias as { lugar: string; ruta?: string }[];
      expect(refs[0].lugar).toContain(medico.name);
      expect(refs[0].ruta).toBe("/doctors");
    });
  });

  it("varias ubicaciones se informan todas juntas", async () => {
    const media = await subirImagen();
    const pagina = await db("pages").first("id");
    await db("blocks").insert({
      page_id: pagina.id,
      type: "logos",
      props: textoJson({ logos: [{ imageUrl: media.url }] }),
      order: 0,
    });
    const medico = await db("doctors").first("id");
    await db("doctors").where({ id: medico.id }).update({ photo_url: media.url });

    const refs = (await (await borrar(media.id)).json()).details.referencias as unknown[];
    // Decir sólo la primera obligaría a repetir el intento de borrado tantas
    // veces como referencias haya, descubriéndolas de a una.
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  it("desvincular libera el archivo", async () => {
    const media = await subirImagen();
    const pagina = await db("pages").first("id");
    const [bloque] = await db("blocks").insert({
      page_id: pagina.id,
      type: "logos",
      props: textoJson({ logos: [{ imageUrl: media.url }] }),
      order: 0,
    });

    expect((await borrar(media.id)).status).toBe(409);
    await db("blocks").where({ id: bloque }).del();
    expect((await borrar(media.id)).status).toBe(204);
  });

  it("borrar un id inexistente sigue siendo 204", async () => {
    expect((await borrar(999999)).status).toBe(204);
  });

  describe("editar el texto alternativo", () => {
    const patch = (id: number | string, body: unknown, conToken = true) =>
      fetch(`${baseUrl}/api/admin/media/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(conToken ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

    async function unaFila(alt: string | null = null) {
      const [id] = await db("media").insert({
        url: "/uploads/x.png",
        mime: "image/png",
        size: 100,
        width: 300,
        height: 200,
        frames: 1,
        alt,
      });
      return id;
    }

    it("sin autenticación responde 401", async () => {
      const id = await unaFila();
      expect((await patch(id, { alt: "algo" }, false)).status).toBe(401);
    });

    it("guarda el texto alternativo", async () => {
      const id = await unaFila();
      const res = await patch(id, { alt: "Fachada del sanatorio" });

      expect(res.status).toBe(200);
      expect((await res.json()).alt).toBe("Fachada del sanatorio");
      expect((await db("media").where({ id }).first()).alt).toBe("Fachada del sanatorio");
    });

    it("vacío deja NULL y no una cadena vacía", async () => {
      const id = await unaFila("tenía algo");
      await patch(id, { alt: "   " });

      // `NULL` es "todavía no tiene", que es lo que la biblioteca señala en
      // ámbar. Una cadena vacía diría que sí lo tiene y está vacío.
      expect((await db("media").where({ id }).first()).alt).toBeNull();
    });

    const invalidos: [string, unknown][] = [
      ["sin el campo", {}],
      ["un número", { alt: 42 }],
      ["null", { alt: null }],
      ["más de 255 caracteres", { alt: "a".repeat(256) }],
    ];

    it.each(invalidos)("payload inválido (%s) responde 400", async (_q, body) => {
      const id = await unaFila("original");
      const res = await patch(id, body);

      expect(res.status).toBe(400);
      expect((await db("media").where({ id }).first()).alt, "cambió igual").toBe("original");
    });

    it("un id inexistente responde 404", async () => {
      expect((await patch(999999, { alt: "algo" })).status).toBe(404);
    });

    it("no cambia nada más que el alt", async () => {
      const id = await unaFila();
      const antes = await db("media").where({ id }).first();
      await patch(id, { alt: "nuevo" });
      const despues = await db("media").where({ id }).first();

      // URL, MIME, tamaño y dimensiones los determinó el pipeline a partir de
      // los bytes: si se pudieran editar, la fila y el archivo volverían a
      // contradecirse.
      expect({ ...despues, alt: null }).toEqual({ ...antes, alt: null });
    });

  });
});
