import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import { LEGACY_PORTAL_PATHS, PORTAL_CANONICAL } from "../api/src/legacy-redirects";
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
 * Redirects 301 de punta a punta contra la base.
 *
 * Lo que solo se ve con la API entera corriendo: las cuatro legacy sembradas
 * siguen respondiendo 301; un redirect nuevo aplica despues de crearlo (la
 * cache se refresca); un destino externo se rechaza (open redirect); un origen
 * repetido es 409; apagar o borrar deja de redirigir.
 *
 *   TEST_DATABASE=1 pnpm test tests/redirects-api.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_redir`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("redirects 301", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  const hit = (p: string) => fetch(`${baseUrl}${p}`, { redirect: "manual" });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-redir";
    const { createApp } = await import("../api/src/app.js");
    // La cache la carga createApp de forma asincrona; se fuerza una carga
    // sincrona esperada para no depender del timing en las primeras aserciones.
    const { cargarRedirects } = await import("../api/src/redirects.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    await cargarRedirects();
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

  it("las cuatro rutas legacy se sembraron y responden 301", async () => {
    const filas = await db("redirects").select("from_path", "to_path");
    for (const from of LEGACY_PORTAL_PATHS) {
      const fila = filas.find((f) => f.from_path === from);
      expect(fila, `falta la fila sembrada de ${from}`).toBeTruthy();
      expect(fila!.to_path).toBe(PORTAL_CANONICAL);

      const res = await hit(from);
      expect(res.status, from).toBe(301);
      expect(res.headers.get("location"), from).toBe(PORTAL_CANONICAL);
    }
  });

  it("crea un redirect y lo aplica despues de refrescar la cache", async () => {
    const res = await fetch(`${baseUrl}/api/admin/redirects`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ from: "/promo-vieja", to: "/promociones" }),
    });
    expect(res.status, await res.clone().text()).toBe(201);

    const r = await hit("/promo-vieja");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("/promociones");

    // El origen se normaliza: entra con mayusculas/barra y redirige igual.
    const r2 = await hit("/PROMO-VIEJA/");
    expect(r2.status).toBe(301);
    expect(r2.headers.get("location")).toBe("/promociones");
  });

  it("rechaza un destino externo (open redirect) con 400", async () => {
    for (const to of ["//evil.com", "https://evil.com", "/\\evil.com"]) {
      const res = await fetch(`${baseUrl}/api/admin/redirects`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ from: "/trampa", to }),
      });
      expect(res.status, `deberia rechazar to=${to}`).toBe(400);
    }
    // Nada se creo.
    const fila = await db("redirects").where({ from_path: "/trampa" }).first();
    expect(fila).toBeFalsy();
  });

  it("un origen repetido es 409", async () => {
    const res = await fetch(`${baseUrl}/api/admin/redirects`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ from: "/promo-vieja", to: "/otra" }),
    });
    expect(res.status).toBe(409);
  });

  it("apagar un redirect deja de redirigir; reactivarlo vuelve a hacerlo", async () => {
    const fila = await db("redirects").where({ from_path: "/promo-vieja" }).first();
    const off = await fetch(`${baseUrl}/api/admin/redirects/${fila.id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ active: false }),
    });
    expect(off.status).toBe(200);
    const apagado = await hit("/promo-vieja");
    expect(apagado.status).not.toBe(301);

    const on = await fetch(`${baseUrl}/api/admin/redirects/${fila.id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ active: true }),
    });
    expect(on.status).toBe(200);
    const encendido = await hit("/promo-vieja");
    expect(encendido.status).toBe(301);
  });

  it("borrar un redirect deja de redirigir", async () => {
    const fila = await db("redirects").where({ from_path: "/promo-vieja" }).first();
    const del = await fetch(`${baseUrl}/api/admin/redirects/${fila.id}`, {
      method: "DELETE",
      headers: auth(),
    });
    expect(del.status).toBe(204);
    const res = await hit("/promo-vieja");
    expect(res.status).not.toBe(301);
  });

  it("el endpoint publico devuelve los redirects activos (incluidas las legacy)", async () => {
    const lista = (await (await fetch(`${baseUrl}/api/public/redirects`)).json()) as {
      from: string;
      to: string;
    }[];
    for (const from of LEGACY_PORTAL_PATHS) {
      expect(lista.some((r) => r.from === from && r.to === PORTAL_CANONICAL), from).toBe(true);
    }
    // Ninguno apunta afuera del sitio.
    for (const r of lista) expect(r.to.startsWith("/")).toBe(true);
  });

  it("el endpoint por clave tambien rechaza un destino externo (400)", async () => {
    const nuevo = await fetch(`${baseUrl}/api/admin/redirects`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ from: "/editable", to: "/destino-ok" }),
    });
    const { id } = await nuevo.json();
    const res = await fetch(`${baseUrl}/api/admin/redirects/${id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ to: "https://evil.com" }),
    });
    expect(res.status).toBe(400);
  });
});
