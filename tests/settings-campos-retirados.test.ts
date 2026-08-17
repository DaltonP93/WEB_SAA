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
  jsonColumn,
  migrateLatest,
  runSeeds,
} from "./helpers/db";

/**
 * Los campos retirados de `contact` se rechazan, no se descartan.
 *
 * `sanitizeSettingValue()` los borraba del objeto y la API respondía
 * `200 {ok:true}`. Quien mandaba `contact.emergencyPhone` desde un panel viejo,
 * un script o una integración recibía "guardado" y el dato no quedaba en
 * ningún lado — ni en `settings`, ni en `contact_channels`, ni en un error.
 *
 * Es exactamente el fallo que la ronda 6 corrigió un nivel más arriba, para las
 * claves de settings enteras: el panel decía "Guardado" sobre claves que la API
 * nunca guardó. Estos seis campos eran la misma trampa un nivel más abajo.
 *
 *   TEST_DATABASE=1 pnpm test tests/settings-campos-retirados.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_retirados`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

/** Los seis campos que dejaron de vivir en `settings.contact`. */
const RETIRADOS = ["phones", "email", "whatsapp", "hours", "emergencyPhone", "gthEmail"];

describeDb("campos retirados de contact: 410, no 200", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  const contactoGuardado = async () => {
    const row = await db("settings").where({ key: "contact" }).first();
    return row ? (jsonColumn(row.value) as Record<string, unknown>) : {};
  };

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-retirados";
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
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  describe("PUT /admin/settings/contact", () => {
    it.each(RETIRADOS)("rechaza contact.%s con 410", async (campo) => {
      const res = await fetch(`${baseUrl}/api/admin/settings/contact`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ address: "Sede central", [campo]: "lo-que-sea" }),
      });

      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toMatch(/ya no se administra/i);
      expect(body.error).toMatch(/Canales de contacto/i);
      expect(body.rejected).toContain(`contact.${campo}`);
    });

    it("y no guarda el resto del objeto: el rechazo es del PUT entero", async () => {
      const antes = await contactoGuardado();

      const res = await fetch(`${baseUrl}/api/admin/settings/contact`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ address: "Dirección que no se debe guardar", gthEmail: "x@y.test" }),
      });

      expect(res.status).toBe(410);
      expect(await contactoGuardado()).toEqual(antes);
    });

    it("un contact sin campos retirados sí se guarda", async () => {
      // El rechazo no puede volverse un freno para el camino normal.
      const res = await fetch(`${baseUrl}/api/admin/settings/contact`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ address: "Avenida de prueba 123" }),
      });

      expect(res.status, await res.text()).toBe(200);
      expect((await contactoGuardado()).address).toBe("Avenida de prueba 123");
    });
  });

  describe("PUT masivo /admin/settings", () => {
    it.each(RETIRADOS)("rechaza contact.%s con 410", async (campo) => {
      const res = await fetch(`${baseUrl}/api/admin/settings`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ contact: { address: "Sede", [campo]: "lo-que-sea" } }),
      });

      expect(res.status).toBe(410);
      expect((await res.json()).rejected).toContain(`contact.${campo}`);
    });

    it("es atómico: un payload mixto no guarda ninguna otra clave", async () => {
      const seoAntes = await db("settings").where({ key: "seo" }).first();
      const brandAntes = await db("settings").where({ key: "brand" }).first();

      const res = await fetch(`${baseUrl}/api/admin/settings`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({
          seo: { title: "Título que no se debe guardar" },
          brand: { name: "Marca que no se debe guardar" },
          contact: { emergencyPhone: "no-va" },
        }),
      });

      expect(res.status).toBe(410);
      // Ninguna de las dos claves válidas se escribió.
      expect(await db("settings").where({ key: "seo" }).first()).toEqual(seoAntes);
      expect(await db("settings").where({ key: "brand" }).first()).toEqual(brandAntes);
    });

    it("mezcla de campo retirado y clave retirada: gana el 410 y no se guarda nada", async () => {
      const seoAntes = await db("settings").where({ key: "seo" }).first();

      const res = await fetch(`${baseUrl}/api/admin/settings`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({
          seo: { title: "Tampoco" },
          scripts: "<script>alert(1)</script>",
          contact: { whatsapp: "no-va" },
        }),
      });

      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.rejected).toContain("scripts");
      expect(body.rejected).toContain("contact.whatsapp");
      expect(await db("settings").where({ key: "seo" }).first()).toEqual(seoAntes);
    });

    it("un payload limpio sigue guardando todo junto", async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ seo: { title: "Sanatorio" }, contact: { address: "Otra dirección" } }),
      });

      expect(res.status, await res.text()).toBe(200);
      expect((await contactoGuardado()).address).toBe("Otra dirección");
    });
  });

  describe("las claves retiradas enteras siguen dando 410", () => {
    it.each(["social", "scripts"])("%s", async (clave) => {
      const res = await fetch(`${baseUrl}/api/admin/settings/${clave}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ cualquier: "cosa" }),
      });
      expect(res.status).toBe(410);
    });
  });

  describe("el GET no ofrece lo que el PUT rechaza", () => {
    it("una fila vieja con campos retirados no los devuelve", async () => {
      // Sin esto el panel entraba en un callejón: recibía el campo, lo mandaba
      // de vuelta al guardar y cobraba un 410 imposible de evitar desde la UI.
      await db("settings")
        .where({ key: "contact" })
        .update({ value: JSON.stringify({ address: "Sede", emergencyPhone: "legacy", gthEmail: "legacy" }) });

      const settings = await (await fetch(`${baseUrl}/api/admin/settings`, { headers: auth() })).json();

      expect(settings.contact).toBeTruthy();
      for (const campo of RETIRADOS) expect(settings.contact).not.toHaveProperty(campo);
      expect(settings.contact.address).toBe("Sede");

      // Y devolver ese objeto tal cual funciona: es el round-trip del panel.
      const res = await fetch(`${baseUrl}/api/admin/settings/contact`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify(settings.contact),
      });
      expect(res.status, await res.text()).toBe(200);
    });
  });
});
