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
 * Endurecimiento de seguridad menor (backlog de la auditoría), lado API:
 *  - `nosniff` en los tres export CSV con datos (turnos, auditoría, newsletter);
 *  - `searchField` con allowlist (deny-by-default): un campo no declarado da 400;
 *  - login de email inexistente sigue dando 401 (el compare ficticio no rompe el flujo).
 *
 * El saneo de `meta` se prueba aparte en `sanitizar-meta.test.ts` (unidad pura):
 * importar `audit.js` acá, en el tope, inicializaría `db` con la configuración
 * previa a `applyDbEnv` y el login daría 503.
 *
 *   TEST_DATABASE=1 pnpm test tests/security-hardening.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_hardening`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("endurecimiento sobre la API", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-hardening";
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

  describe("los export CSV con datos llevan X-Content-Type-Options: nosniff", () => {
    it.each([
      ["turnos", "/api/admin/appointments/export"],
      ["auditoría", "/api/admin/audit/export"],
      ["newsletter", "/api/admin/newsletter/export"],
    ])("%s", async (_n, ruta) => {
      const res = await fetch(`${baseUrl}${ruta}`, { headers: auth() });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cache-control")).toContain("no-store");
    });
  });

  describe("searchField es una allowlist (deny-by-default)", () => {
    it("un searchField no declarado se rechaza con 400", async () => {
      const res = await fetch(`${baseUrl}/api/admin/services?q=cardio&searchField=name`, { headers: auth() });
      expect(res.status).toBe(400);
    });
    it("otro campo (aunque exista como columna) también se rechaza", async () => {
      const res = await fetch(`${baseUrl}/api/admin/services?q=1&searchField=id`, { headers: auth() });
      expect(res.status).toBe(400);
    });
    it("sin searchField, listar funciona normal", async () => {
      const res = await fetch(`${baseUrl}/api/admin/services`, { headers: auth() });
      expect(res.status).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    });
    it("con searchField pero sin q, no se filtra ni se rechaza", async () => {
      const res = await fetch(`${baseUrl}/api/admin/services?searchField=name`, { headers: auth() });
      expect(res.status).toBe(200);
    });
  });

  describe("login de email inexistente", () => {
    it("sigue dando 401 (el compare ficticio de tiempo no rompe el flujo)", async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "no-existe@sanatorio.local", password: "loquesea" }),
      });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toMatch(/credenciales/i);
    });
  });
});
