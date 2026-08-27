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
 * Captura de newsletter y export de leads, de punta a punta.
 *
 * Contratos: la suscripcion publica sanea y guarda (con atribucion), es
 * idempotente (mismo correo no duplica), rechaza un email invalido y el
 * honeypot; el panel lista, exporta CSV y da de baja.
 *
 *   TEST_DATABASE=1 pnpm test tests/newsletter.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_newsletter`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("newsletter: captura y export", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  const suscribir = (body: any) =>
    fetch(`${baseUrl}/api/public/newsletter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-news";
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

  it("guarda una suscripción con su origen y atribución saneada", async () => {
    const res = await suscribir({
      email: "Lector@Ejemplo.Test",
      source: "footer",
      attribution: { utm_source: "instagram", utm_campaign: "verano", role: "admin", utm_medium: "social<script>" },
    });
    expect(res.status, await res.clone().text()).toBe(201);

    const fila = await db("newsletter_subscribers").where({ email: "Lector@Ejemplo.Test" }).first();
    expect(fila).toBeTruthy();
    expect(fila.source).toBe("footer");
    const attr = jsonColumn<any>(fila.attribution);
    expect(attr).toEqual({ utm_source: "instagram", utm_campaign: "verano", utm_medium: "socialscript" });
    expect(JSON.stringify(attr)).not.toContain("role");
  });

  it("es idempotente: el mismo correo no crea un duplicado", async () => {
    await suscribir({ email: "unico@ejemplo.test" });
    const dup = await suscribir({ email: "unico@ejemplo.test", source: "home" });
    expect(dup.status).toBe(201);
    const n = await db("newsletter_subscribers").where({ email: "unico@ejemplo.test" }).count<{ c: number }[]>({ c: "*" });
    expect(Number(n[0].c)).toBe(1);
  });

  it("rechaza un email inválido con 400", async () => {
    const res = await suscribir({ email: "no-es-un-email" });
    expect(res.status).toBe(400);
  });

  it("el honeypot responde 201 pero no guarda nada", async () => {
    const res = await suscribir({ email: "bot@ejemplo.test", website: "soy-un-bot" });
    expect(res.status).toBe(201);
    expect(await db("newsletter_subscribers").where({ email: "bot@ejemplo.test" }).first()).toBeFalsy();
  });

  it("el panel lista con la atribución parseada", async () => {
    const data = await (await fetch(`${baseUrl}/api/admin/newsletter`, { headers: auth() })).json();
    const item = data.items.find((s: any) => s.email === "Lector@Ejemplo.Test");
    expect(item).toBeTruthy();
    expect(item.attribution.utm_source).toBe("instagram");
    expect(typeof data.total).toBe("number");
  });

  it("exporta un CSV con encabezados, el correo y la campaña", async () => {
    const csv = await (await fetch(`${baseUrl}/api/admin/newsletter/export`, { headers: auth() })).text();
    expect(csv).toContain("Email");
    expect(csv).toContain("Campaña");
    expect(csv).toContain("Lector@Ejemplo.Test");
    expect(csv).toContain("verano");
  });

  it("da de baja un suscriptor (204) y 404 si no existe", async () => {
    const fila = await db("newsletter_subscribers").where({ email: "unico@ejemplo.test" }).first();
    const del = await fetch(`${baseUrl}/api/admin/newsletter/${fila.id}`, { method: "DELETE", headers: auth() });
    expect(del.status).toBe(204);
    expect(await db("newsletter_subscribers").where({ id: fila.id }).first()).toBeFalsy();

    const noExiste = await fetch(`${baseUrl}/api/admin/newsletter/999999`, { method: "DELETE", headers: auth() });
    expect(noExiste.status).toBe(404);
  });
});
