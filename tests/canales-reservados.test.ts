import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
 * Los ocho canales institucionales no se pueden romper desde el panel.
 *
 * No son "datos cargados": son parte del producto. El encabezado busca
 * `emergencias` por su clave, el pie arma la lista excluyendo `emergencias` y
 * `gth` por las suyas, y varios bloques declaran `keys: ["whatsapp-estudios", …]`.
 *
 * Borrar una de esas filas o cambiarle la clave **no deja un hueco visible**:
 * deja el sitio buscando algo que ya no existe y mostrando "A confirmar" para
 * siempre, sin un solo error que lo delate. El `kind` va en el mismo paquete
 * porque decide qué formato se valida y qué enlace se genera: pasar
 * `emergencias` a `email` convierte el botón de urgencias en un `mailto:` roto.
 *
 * Lo demás se edita con normalidad, y los canales que el sanatorio cree después
 * conservan CRUD completo.
 *
 *   TEST_DATABASE=1 pnpm test tests/canales-reservados.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_reservados`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const RESERVADOS: Record<string, string> = {
  emergencias: "phone",
  "whatsapp-turnos": "whatsapp",
  "whatsapp-estudios": "whatsapp",
  "whatsapp-general": "whatsapp",
  "whatsapp-samap": "whatsapp",
  recepcion: "phone",
  "email-general": "email",
  gth: "email",
};

describeDb("canales institucionales protegidos", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";
  const idPorClave = new Map<string, number>();

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  const idDe = (clave: string) => idPorClave.get(clave)!;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-reservados";
    const { createApp } = await import("../api/src/app.js");
    const app = createApp();
    await new Promise<void>((r) => {
      server = app.listen(0, () => r());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@sanatorio.local", password: TEST_ADMIN_PASSWORD }),
    });
    token = (await login.json()).token;

    for (const row of await db("contact_channels").select("id", "key")) {
      idPorClave.set(row.key, row.id);
    }
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("la cadena de migraciones deja las ocho filas", () => {
    for (const clave of Object.keys(RESERVADOS)) {
      expect(idPorClave.has(clave), `falta el canal ${clave}`).toBe(true);
    }
  });

  it("el label efectivo de emergencias es 'Emergencias'", async () => {
    // Se lee de la base después de correr TODA la cadena: una migración
    // posterior renombró la fila que creó `20260813000000`, así que mirar sólo
    // la migración inicial daría un label que ya no existe.
    const row = await db("contact_channels").where({ key: "emergencias" }).first();
    expect(row.label).toBe("Emergencias");
  });

  describe("no se pueden eliminar", () => {
    it.each(Object.keys(RESERVADOS))("DELETE %s → 403", async (clave) => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe(clave)}`, {
        method: "DELETE",
        headers: auth(),
      });

      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/no se puede eliminar/i);
      // Y la fila sigue ahí: el 403 no es cosmético.
      expect(await db("contact_channels").where({ key: clave }).first()).toBeTruthy();
    });
  });

  describe("no se les puede cambiar la clave", () => {
    it.each(Object.keys(RESERVADOS))("PUT %s con otra key → 403", async (clave) => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe(clave)}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ key: `${clave}-renombrado` }),
      });

      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/no se puede cambiar la clave/i);
      expect(await db("contact_channels").where({ key: clave }).first()).toBeTruthy();
    });
  });

  describe("no se les puede cambiar el tipo", () => {
    it.each(Object.entries(RESERVADOS))("PUT %s con otro kind → 403", async (clave, esperado) => {
      const otro = esperado === "email" ? "phone" : "email";
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe(clave)}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ kind: otro }),
      });

      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/tiene que seguir siendo de tipo/i);
      expect((await db("contact_channels").where({ key: clave }).first()).kind).toBe(esperado);
    });
  });

  describe("lo demás sí se edita", () => {
    it("label, note, active y order se guardan", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe("recepcion")}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ label: "Recepción y admisión", note: "Atención administrativa.", active: false, order: 9 }),
      });

      expect(res.status, await res.text()).toBe(200);
      const row = await db("contact_channels").where({ key: "recepcion" }).first();
      expect(row.label).toBe("Recepción y admisión");
      expect(Boolean(row.active)).toBe(false);
      expect(row.order).toBe(9);
    });

    it("mandar la misma key y el mismo kind no se bloquea", async () => {
      // El panel manda el objeto completo al guardar: rechazar por incluir el
      // campo sin cambiarlo haría imposible editar la fila.
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe("gth")}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ key: "gth", kind: "email", label: "Trabajá con nosotros" }),
      });

      expect(res.status, await res.text()).toBe(200);
      expect((await db("contact_channels").where({ key: "gth" }).first()).label).toBe("Trabajá con nosotros");
    });
  });

  describe("los canales propios del sanatorio conservan CRUD completo", () => {
    let idPropio = 0;

    it("se crea", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ key: "consultorio-externo", label: "Consultorio externo", kind: "phone" }),
      });
      const creado = await res.json();
      expect(res.status, JSON.stringify(creado)).toBe(201);
      idPropio = creado.id;
    });

    it("se le puede cambiar la clave y el tipo", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idPropio}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ key: "consultorio-nuevo", kind: "email" }),
      });
      expect(res.status, await res.text()).toBe(200);
      expect((await db("contact_channels").where({ id: idPropio }).first()).key).toBe("consultorio-nuevo");
    });

    it("y se puede eliminar", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idPropio}`, {
        method: "DELETE",
        headers: auth(),
      });
      expect(res.status).toBe(204);
      expect(await db("contact_channels").where({ id: idPropio }).first()).toBeUndefined();
    });
  });

  it("borrar una fila inexistente sigue dando 404, no 403", async () => {
    const res = await fetch(`${baseUrl}/api/admin/contact-channels/999999`, {
      method: "DELETE",
      headers: auth(),
    });
    expect(res.status).toBe(404);
  });
});
