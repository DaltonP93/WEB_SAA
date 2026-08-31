import type { Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  applyDbEnv,
  closeAppDb,
  closeServer,
  createTestDatabase,
  dropTestDatabase,
  migrateDown,
  migrateLatest,
} from "./helpers/db";

/**
 * `/api/health` tiene que ver el esquema, no sólo el socket.
 *
 * `checkDatabase()` hacía un `select 1` y nada más: con la base respondiendo
 * pero atrasada respecto de las migraciones del repo, el health devolvía 200
 * mientras las rutas que usan las columnas nuevas devolvían 500 sueltos. Pasó
 * de verdad: faltaban `pages.deleted_at` y `pages.publish_at`, y
 * `/api/public/pages`, `/api/public/pages/:slug` y `/sitemap.xml` —los tres
 * consumidores de `filtrarPaginaPublica()`— tiraban 500 con el health en verde.
 *
 *   TEST_DATABASE=1 pnpm test tests/health-migraciones.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_health_migraciones`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("health y migraciones pendientes", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";

  const health = async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    return { status: res.status, body: await res.json() };
  };

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);

    applyDbEnv(DB_NAME);
    // El knexfile apunta a `./migrations` (relativo al cwd) y vitest corre desde
    // la raíz del repo, no desde `api/`. Sin esto el conteo no encuentra el
    // directorio y devuelve `undefined` en vez de un número.
    process.env.MIGRATIONS_DIR = resolve(__dirname, "../api/migrations");

    const { createApp } = await import("../api/src/app.js");
    const app = createApp();
    await new Promise<void>((resolvePromise) => {
      server = app.listen(0, () => resolvePromise());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 180_000);

  afterAll(async () => {
    delete process.env.MIGRATIONS_DIR;
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("con el esquema al día responde 200 y cuenta cero pendientes", async () => {
    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.components.database.ok).toBe(true);
    expect(body.components.database.migrationsPending).toBe(0);
  });

  it("con una migración sin aplicar responde 503 y la reporta", async () => {
    // Revertir una sola migración deja la base exactamente en el estado que
    // antes pasaba desapercibido: viva, pero atrás del código.
    await migrateDown(db);

    const { status, body } = await health();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    // La base sigue respondiendo: lo que falla es el esquema, y hay que poder
    // distinguir un caso del otro para saber qué arreglar.
    expect(body.components.database.ok).toBe(true);
    expect(body.components.database.migrationsPending).toBe(1);

    // Sin filtrar nada de la conexión en la respuesta.
    expect(JSON.stringify(body)).not.toMatch(/password|DB_PASS/i);

    await migrateLatest(db);
    expect((await health()).status).toBe(200);
  }, 60_000);
});
