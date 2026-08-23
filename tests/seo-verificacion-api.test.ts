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
 * Verificación de propiedad, de punta a punta contra la base.
 *
 * Lo que sólo se ve con la API entera corriendo: el token de la clave `seo`
 * se valida al escribir (400 con forma mala), se normaliza al guardar sin pisar
 * los campos libres (título, descripción, OG image) y se expone en
 * `/public/settings` ya saneado.
 *
 *   TEST_DATABASE=1 pnpm test tests/seo-verificacion-api.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_seo`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("seo: verificación de propiedad", () => {
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
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-seo";
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

  it("guarda un token válido, lo normaliza y lo expone en público sin pisar el resto del seo", async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({
        seo: {
          title: "Sanatorio Adventista",
          description: "Atención integral",
          ogImage: "/uploads/og.png",
          verification: { google: "  google_token_ABCDEF123  ", bing: "", basura: "x" },
        },
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    // En la base: token recortado, sin la clave `basura`, campos libres intactos.
    const fila = await db("settings").where({ key: "seo" }).first();
    const guardado = jsonColumn<any>(fila.value);
    expect(guardado.title).toBe("Sanatorio Adventista");
    expect(guardado.description).toBe("Atención integral");
    expect(guardado.ogImage).toBe("/uploads/og.png");
    expect(guardado.verification).toEqual({ google: "google_token_ABCDEF123", bing: "" });
    expect(JSON.stringify(guardado.verification)).not.toContain("basura");

    const pub = await (await fetch(`${baseUrl}/api/public/settings`)).json();
    expect(pub.seo.verification).toEqual({ google: "google_token_ABCDEF123", bing: "" });
    expect(pub.seo.title).toBe("Sanatorio Adventista");
  });

  it("rechaza un token mal formado con 400 y no pisa lo guardado", async () => {
    const antes = await db("settings").where({ key: "seo" }).first();
    const res = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ seo: { verification: { google: 'roto"><script>' } } }),
    });
    expect(res.status).toBe(400);

    const despues = await db("settings").where({ key: "seo" }).first();
    expect(despues?.value, "un token inválido pisó lo guardado").toEqual(antes?.value);
  });

  it("el endpoint por clave también valida el token (400)", async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings/seo`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ verification: { bing: "con espacios" } }),
    });
    expect(res.status).toBe(400);
  });

  it("guardar seo sin verification no rompe ni inventa la clave", async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings/seo`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ title: "Sólo título", description: "d", ogImage: "" }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const fila = await db("settings").where({ key: "seo" }).first();
    const guardado = jsonColumn<any>(fila.value);
    expect("verification" in guardado).toBe(false);
    expect(guardado.title).toBe("Sólo título");
  });

  it("una fila con token inválido escrita a mano se sanea al salir en público", async () => {
    // Simula una fila corrupta que no pasó por el PUT (edición directa en DB).
    await db("settings")
      .insert({ key: "seo", value: JSON.stringify({ title: "T", verification: { google: "roto<>", bing: "bing_token_9876" } }) })
      .onConflict("key")
      .merge({ value: JSON.stringify({ title: "T", verification: { google: "roto<>", bing: "bing_token_9876" } }) });

    const pub = await (await fetch(`${baseUrl}/api/public/settings`)).json();
    // El token roto se descarta; el válido sobrevive.
    expect(pub.seo.verification).toEqual({ google: "", bing: "bing_token_9876" });
    expect(JSON.stringify(pub.seo)).not.toContain("roto<>");
  });
});
