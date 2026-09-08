import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
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
 * Médicos (admin): un dato mal escrito no es una caída del servidor, y una
 * respuesta de éxito no puede mentir sobre lo que pasó en la base.
 *
 * Antes de la ronda 2, el router de médicos hacía `schema.parse()`: un payload
 * inválido lanzaba `ZodError` y el manejador global lo convertía en **500
 * "error interno"**, sin decir qué campo corregir. Y un `PUT`/`DELETE` sobre un
 * id inexistente tocaba cero filas y devolvía éxito, así que el panel no podía
 * distinguir "se guardó" de "no existe". Se prueba contra la base, no contra la
 * forma del `if`.
 *
 *   TEST_DATABASE=1 pnpm test tests/doctors-api.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_doctors`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("API de médicos", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const json = () => ({ ...auth(), "Content-Type": "application/json" });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);
    // El seed 02 siembra médicos de ejemplo; arrancamos con la tabla vacía para
    // que los conteos de "no se creó nada" no dependan de esos datos.
    await db("doctor_specialty").del();
    await db("doctors").del();

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-doctors";
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
  });

  afterEach(async () => {
    await db("doctor_specialty").del();
    await db("doctors").del();
  });

  const crear = (body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/admin/doctors`, { method: "POST", headers: json(), body: JSON.stringify(body) });

  const actualizar = (id: number | string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/admin/doctors/${id}`, { method: "PUT", headers: json(), body: JSON.stringify(body) });

  const borrar = (id: number | string) =>
    fetch(`${baseUrl}/api/admin/doctors/${id}`, { method: "DELETE", headers: auth() });

  describe("los errores de quien escribe no son errores del servidor", () => {
    const invalidos: [string, Record<string, unknown>][] = [
      ["payload vacío", {}],
      ["sin slug", { name: "Dra. Ejemplo" }],
      ["sin name", { slug: "dra-ejemplo" }],
      ["slug con mayúsculas/espacios", { slug: "Dra Ejemplo", name: "Dra. Ejemplo" }],
      ["slug vacío", { slug: "", name: "Dra. Ejemplo" }],
      ["name vacío", { slug: "dra-ejemplo", name: "" }],
      ["tipo equivocado en name", { slug: "dra-ejemplo", name: 42 }],
      ["specialtyIds no numéricos", { slug: "dra-ejemplo", name: "Dra. Ejemplo", specialtyIds: ["x"] }],
    ];

    it.each(invalidos)("crear con %s da 400, no 500", async (_q, body) => {
      const res = await crear(body);
      expect(res.status, "un dato mal escrito salió como error del servidor").toBe(400);
      expect((await res.json()).error).toBeTruthy();
      expect(await db("doctors").count({ n: "id" }), "se creó igual").toEqual([{ n: 0 }]);
    });

    it("actualizar con un slug inválido da 400, no 500", async () => {
      const creado = await (await crear({ slug: "dra-valida", name: "Dra. Válida" })).json();
      const res = await actualizar(Number(creado.id), { slug: "Slug Inválido" });
      expect(res.status).toBe(400);
      expect((await db("doctors").where({ id: creado.id }).first("slug")).slug).toBe("dra-valida");
    });
  });

  describe("la respuesta dice lo que de verdad pasó", () => {
    it("un PUT a un id inexistente da 404, no un éxito vacío", async () => {
      const res = await actualizar(999_999, { name: "Fantasma" });
      // Antes actualizaba cero filas y devolvía `{ ok: true }`.
      expect(res.status).toBe(404);
    });

    it("un DELETE a un id inexistente da 404, no un 204 mentiroso", async () => {
      const res = await borrar(999_999);
      // Antes borraba cero filas y devolvía 204: el panel creía que algo se fue.
      expect(res.status).toBe(404);
    });
  });

  describe("el camino feliz", () => {
    it("crear un médico válido devuelve 201 con su id y queda en la base", async () => {
      const res = await crear({ slug: "dra-lopez", name: "Dra. López", bio: "<p>Cardióloga</p>" });
      expect(res.status, await res.clone().text()).toBe(201);
      const cuerpo = await res.json();
      expect(cuerpo.id).toBeTypeOf("number");

      const fila = await db("doctors").where({ id: cuerpo.id }).first();
      expect(fila.slug).toBe("dra-lopez");
      expect(fila.name).toBe("Dra. López");
    });

    it("actualizar un médico existente devuelve 200 y persiste el cambio", async () => {
      const creado = await (await crear({ slug: "dra-perez", name: "Dra. Pérez" })).json();
      const res = await actualizar(Number(creado.id), { name: "Dra. Pérez Actualizada" });
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await db("doctors").where({ id: creado.id }).first("name")).name).toBe("Dra. Pérez Actualizada");
    });

    it("borrar un médico existente devuelve 204 y lo saca de la base", async () => {
      const creado = await (await crear({ slug: "dra-gomez", name: "Dra. Gómez" })).json();
      const res = await borrar(Number(creado.id));
      expect(res.status).toBe(204);
      expect(await db("doctors").where({ id: creado.id }).first()).toBeUndefined();
    });
  });
});
