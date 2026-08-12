import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  applyDbEnv,
  createTestDatabase,
  dropTestDatabase,
  migrateLatest,
  runSeeds,
  TEST_ADMIN_PASSWORD,
} from "./helpers/db";

/**
 * Iconos cargados desde el panel: regla permanente del CMS.
 *
 * Un nombre que no existe en lucide no rompe nada visible —el componente
 * simplemente no dibuja— así que el hueco aparecía recién en el sitio
 * publicado. Y dos filas de la misma grilla con el mismo icono se leen como un
 * error de carga. Las dos cosas se rechazan en la API, que es lo único que el
 * panel no puede saltear.
 *
 *   TEST_DATABASE=1 pnpm test tests/icons-admin.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_icons`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("iconos administrables", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-para-iconos";
    const { createApp } = await import("../api/src/app.js");
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@sanatorio.local", password: TEST_ADMIN_PASSWORD }),
    });
    expect(login.status, await login.clone().text()).toBe(200);
    token = (await login.json()).token;
  }, 180_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  describe("alta desde el panel", () => {
    it("rechaza un icono que no existe en lucide", async () => {
      const res = await fetch(`${baseUrl}/api/admin/services`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          slug: "servicio-icono-falso",
          name: "Servicio con icono inventado",
          icon: "estetoscopio-magico",
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(JSON.stringify(body)).toMatch(/icono inexistente/i);
      expect(await db("services").where({ slug: "servicio-icono-falso" }).first()).toBeUndefined();
    });

    it("rechaza un icono ya usado por otra fila de la misma grilla", async () => {
      const existing = await db("services").whereNotNull("icon").first("slug", "icon");
      expect(existing).toBeTruthy();

      const res = await fetch(`${baseUrl}/api/admin/services`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          slug: "servicio-icono-repetido",
          name: "Servicio con icono repetido",
          icon: existing.icon,
        }),
      });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/ya lo usa/i);
      expect(await db("services").where({ slug: "servicio-icono-repetido" }).first()).toBeUndefined();
    });

    it("acepta un icono válido y libre", async () => {
      const res = await fetch(`${baseUrl}/api/admin/services`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          slug: "servicio-icono-valido",
          name: "Servicio con icono válido",
          icon: "anchor",
        }),
      });
      expect(res.status, await res.clone().text()).toBe(201);
      expect((await res.json()).icon).toBe("anchor");
    });
  });

  describe("edición desde el panel", () => {
    it("rechaza cambiar a un icono inexistente", async () => {
      const row = await db("services").where({ slug: "servicio-icono-valido" }).first("id");
      const res = await fetch(`${baseUrl}/api/admin/services/${row.id}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ icon: "no-existe-este-icono" }),
      });
      expect(res.status).toBe(400);
      const after = await db("services").where({ id: row.id }).first("icon");
      expect(after.icon).toBe("anchor");
    });

    it("rechaza cambiar a un icono que ya usa otra fila", async () => {
      const other = await db("services")
        .whereNotNull("icon")
        .whereNot({ slug: "servicio-icono-valido" })
        .first("icon");
      const row = await db("services").where({ slug: "servicio-icono-valido" }).first("id");
      const res = await fetch(`${baseUrl}/api/admin/services/${row.id}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ icon: other.icon }),
      });
      expect(res.status).toBe(409);
      const after = await db("services").where({ id: row.id }).first("icon");
      expect(after.icon).toBe("anchor");
    });

    it("acepta conservar su propio icono al editar otro campo", async () => {
      const row = await db("services").where({ slug: "servicio-icono-valido" }).first("id");
      const res = await fetch(`${baseUrl}/api/admin/services/${row.id}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ name: "Nombre corregido", icon: "anchor" }),
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await res.json()).name).toBe("Nombre corregido");
    });
  });

  describe("estudios y especialidades siguen la misma regla", () => {
    it.each(["studies", "specialties"])("%s rechaza un icono inexistente", async (table) => {
      const res = await fetch(`${baseUrl}/api/admin/${table}`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ slug: `prueba-${table}`, name: "Prueba", icon: "icono-que-no-existe" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("bloques de página", () => {
    it("rechaza un icono inexistente dentro de una grilla de tarjetas", async () => {
      const page = await db("pages").where({ slug: "home" }).first("id");
      const res = await fetch(`${baseUrl}/api/admin/pages/${page.id}/blocks`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({
          blocks: [
            {
              type: "cards",
              props: { columns: 3, items: [{ title: "Uno", icon: "icono-inventado" }] },
            },
          ],
        }),
      });
      expect(res.status).toBe(400);
    });

    it("rechaza dos tarjetas de la misma grilla con el mismo icono", async () => {
      const page = await db("pages").where({ slug: "home" }).first("id");
      const res = await fetch(`${baseUrl}/api/admin/pages/${page.id}/blocks`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({
          blocks: [
            {
              type: "cards",
              props: {
                columns: 3,
                items: [
                  { title: "Uno", icon: "anchor" },
                  { title: "Dos", icon: "anchor" },
                ],
              },
            },
          ],
        }),
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toMatch(/ya se usa en esta grilla/i);
    });

    it("acepta iconos válidos y distintos", async () => {
      const page = await db("pages").where({ slug: "home" }).first("id");
      const res = await fetch(`${baseUrl}/api/admin/pages/${page.id}/blocks`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({
          blocks: [
            {
              type: "cards",
              props: {
                columns: 3,
                items: [
                  { title: "Uno", icon: "anchor" },
                  { title: "Dos", icon: "stethoscope" },
                ],
              },
            },
          ],
        }),
      });
      expect(res.status, await res.clone().text()).toBe(200);
    });
  });
});
