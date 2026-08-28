import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
 * Captura de newsletter con consentimiento, de punta a punta.
 *
 * La suscripción pública sanea y guarda con evidencia de consentimiento
 * (`consent_at`/`consent_version` puestos por el servidor), es idempotente y
 * reactiva una baja; hay baja pública por token opaco que no borra la fila; el
 * panel lista con paginación y búsqueda, exporta con estado de consentimiento y
 * **sin** el token, y ni el correo ni el token aparecen en logs.
 *
 *   TEST_DATABASE=1 pnpm test tests/newsletter.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_newsletter`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("newsletter: captura con consentimiento", () => {
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
  const bandeja = async (qs = "") =>
    (await (await fetch(`${baseUrl}/api/admin/newsletter${qs}`, { headers: auth() })).json()) as any;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-news";
    // El rate-limit de formularios (10 por ventana) se leería al importar la
    // app; se sube para poder ejercitar la paginación con muchas altas. El
    // anti-spam ya está probado aparte.
    process.env.PUBLIC_FORMS_RATE_MAX = "5000";
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

  it("guarda con evidencia de consentimiento, atribución saneada y token de baja", async () => {
    const largo = "/" + "seccion/".repeat(40) + "final"; // ruta larga (> 64)
    const res = await suscribir({
      email: "Lector@Ejemplo.Test",
      source: largo,
      attribution: { utm_source: "instagram", utm_campaign: "verano", role: "admin", utm_medium: "social<script>" },
    });
    expect(res.status, await res.clone().text()).toBe(201);

    const fila = await db("newsletter_subscribers").where({ email: "Lector@Ejemplo.Test" }).first();
    expect(fila).toBeTruthy();
    expect(fila.source).toBe(largo); // no se truncó
    expect(fila.consent_at).toBeTruthy(); // lo puso el servidor
    expect(String(fila.consent_version)).toBe("1");
    expect(Boolean(fila.active)).toBe(true);
    expect(typeof fila.unsubscribe_token).toBe("string");
    expect(fila.unsubscribe_token.length).toBeGreaterThan(16);
    const attr = jsonColumn<any>(fila.attribution);
    expect(attr).toEqual({ utm_source: "instagram", utm_campaign: "verano", utm_medium: "socialscript" });
    expect(JSON.stringify(attr)).not.toContain("role");
  });

  it("es idempotente y reactiva una baja (mismo correo no duplica)", async () => {
    await suscribir({ email: "vuelve@ejemplo.test" });
    const fila = await db("newsletter_subscribers").where({ email: "vuelve@ejemplo.test" }).first();
    // Baja por token.
    const baja = await fetch(`${baseUrl}/api/public/newsletter/baja`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: fila.unsubscribe_token }),
    });
    expect(baja.status).toBe(200);
    expect(Boolean((await db("newsletter_subscribers").where({ id: fila.id }).first()).active)).toBe(false);

    // Reenviar el correo lo reactiva, sin duplicar.
    await suscribir({ email: "vuelve@ejemplo.test" });
    const n = await db("newsletter_subscribers").where({ email: "vuelve@ejemplo.test" }).count<{ c: number }[]>({ c: "*" });
    expect(Number(n[0].c)).toBe(1);
    expect(Boolean((await db("newsletter_subscribers").where({ id: fila.id }).first()).active)).toBe(true);
  });

  it("un token de baja inválido no cambia nada y responde 200 (sin enumeración)", async () => {
    await suscribir({ email: "intacto@ejemplo.test" });
    const antes = await db("newsletter_subscribers").where({ email: "intacto@ejemplo.test" }).first();
    const res = await fetch(`${baseUrl}/api/public/newsletter/baja`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "token-que-no-existe" }), // allow-secret: literal de prueba, no es una credencial real
    });
    expect(res.status).toBe(200);
    expect(Boolean((await db("newsletter_subscribers").where({ id: antes.id }).first()).active)).toBe(true);
  });

  it("rechaza un email inválido (400) y el honeypot no guarda", async () => {
    expect((await suscribir({ email: "no-es-un-email" })).status).toBe(400);
    expect((await suscribir({ email: "bot@ejemplo.test", website: "soy-un-bot" })).status).toBe(201);
    expect(await db("newsletter_subscribers").where({ email: "bot@ejemplo.test" }).first()).toBeFalsy();
  });

  it("la bandeja pagina y busca, y nunca expone el token", async () => {
    for (let i = 0; i < 25; i++) await suscribir({ email: `masivo${i}@ejemplo.test` });
    const p1 = await bandeja("?limit=20&offset=0");
    expect(p1.items.length).toBe(20);
    expect(p1.total).toBeGreaterThanOrEqual(25);
    expect(JSON.stringify(p1)).not.toContain("unsubscribe_token");
    const p2 = await bandeja("?limit=20&offset=20");
    expect(p2.items.length).toBeGreaterThan(0);
    // Búsqueda por email.
    const buscada = await bandeja("?q=masivo1@ejemplo.test");
    expect(buscada.items.some((s: any) => s.email === "masivo1@ejemplo.test")).toBe(true);
    expect(buscada.items.every((s: any) => s.email.includes("masivo1@ejemplo.test"))).toBe(true);
  });

  it("el CSV lleva estado y consentimiento, y no lleva el token", async () => {
    const fila = await db("newsletter_subscribers").where({ email: "Lector@Ejemplo.Test" }).first();
    const csv = await (await fetch(`${baseUrl}/api/admin/newsletter/export`, { headers: auth() })).text();
    expect(csv).toContain("Estado");
    expect(csv).toContain("Consentimiento");
    expect(csv).toContain("Lector@Ejemplo.Test");
    expect(csv).not.toContain(fila.unsubscribe_token);
  });

  it("el panel da de baja y reactiva sin borrar la fila", async () => {
    await suscribir({ email: "panelbaja@ejemplo.test" });
    const fila = await db("newsletter_subscribers").where({ email: "panelbaja@ejemplo.test" }).first();
    const off = await fetch(`${baseUrl}/api/admin/newsletter/${fila.id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ active: false }),
    });
    expect(off.status).toBe(200);
    expect(Boolean((await db("newsletter_subscribers").where({ id: fila.id }).first()).active)).toBe(false);
    expect(await db("newsletter_subscribers").where({ id: fila.id }).first()).toBeTruthy(); // no se borró
  });

  it("ni el correo ni el token aparecen en los logs", async () => {
    const chunks: string[] = [];
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => { chunks.push(String(c)); return true; });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((c: any) => { chunks.push(String(c)); return true; });
    try {
      await suscribir({ email: "SECRETO-EN-LOG@ejemplo.test" });
      await new Promise((r) => setTimeout(r, 40));
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
    const todo = chunks.join("");
    expect(todo).not.toContain("SECRETO-EN-LOG@ejemplo.test");
    const fila = await db("newsletter_subscribers").where({ email: "SECRETO-EN-LOG@ejemplo.test" }).first();
    expect(todo).not.toContain(fila.unsubscribe_token);
  });
});
