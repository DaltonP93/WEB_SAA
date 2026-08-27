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
 * Historial de versiones de paginas, de punta a punta.
 *
 * Cada guardado de bloques archiva una version; se puede listar y restaurar una
 * anterior; restaurar tambien queda archivado (es reversible); y el historial
 * no crece sin techo.
 *
 *   TEST_DATABASE=1 pnpm test tests/page-revisions.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_rev`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("paginas: historial de versiones", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  async function crearPagina(slug: string) {
    const res = await fetch(`${baseUrl}/api/admin/pages`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ slug, title: `T ${slug}`, status: "draft" }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()).id as number;
  }
  async function guardarBloques(id: number, blocks: any[]) {
    const res = await fetch(`${baseUrl}/api/admin/pages/${id}/blocks`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ blocks }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
  }
  const listar = async (id: number) =>
    (await (await fetch(`${baseUrl}/api/admin/pages/${id}/revisions`, { headers: auth() })).json()) as any[];

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-rev";
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

  it("cada guardado archiva una versión, con autor y conteo de bloques", async () => {
    const id = await crearPagina("hist-demo");
    await guardarBloques(id, [{ type: "spacer", props: { height: 10 } }]);
    await guardarBloques(id, [
      { type: "spacer", props: { height: 20 } },
      { type: "spacer", props: { height: 30 } },
    ]);

    const revs = await listar(id);
    expect(revs.length).toBe(2);
    // Más nueva primero: la v2 tiene 2 bloques, la v1 tiene 1.
    expect(revs[0].blockCount).toBe(2);
    expect(revs[1].blockCount).toBe(1);
    // El autor es el admin sembrado.
    expect(revs[0].author).toBeTruthy();
  });

  it("restaurar una versión anterior vuelve a esos bloques y queda archivado", async () => {
    const id = await crearPagina("restore-demo");
    await guardarBloques(id, [{ type: "spacer", props: { height: 10 } }]);
    await guardarBloques(id, [
      { type: "spacer", props: { height: 20 } },
      { type: "spacer", props: { height: 30 } },
    ]);

    const revs = await listar(id);
    const vieja = revs.find((r) => r.blockCount === 1); // la primera versión
    expect(vieja).toBeTruthy();

    const res = await fetch(`${baseUrl}/api/admin/pages/${id}/revisions/${vieja.id}/restore`, {
      method: "POST",
      headers: auth(),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    // Los bloques actuales son los de la versión vieja (un solo Hero).
    const bloques = await db("blocks").where({ page_id: id }).orderBy("order");
    expect(bloques.length).toBe(1);
    expect(bloques[0].type).toBe("spacer");

    // Restaurar también dejó una versión nueva: ahora hay 3.
    expect((await listar(id)).length).toBe(3);
  });

  it("restaurar una versión que no existe es 404", async () => {
    const id = await crearPagina("rev404-demo");
    await guardarBloques(id, [{ type: "spacer", props: { height: 10 } }]);
    const res = await fetch(`${baseUrl}/api/admin/pages/${id}/revisions/999999/restore`, {
      method: "POST",
      headers: auth(),
    });
    expect(res.status).toBe(404);
  });

  it("el historial no crece sin techo (se poda al máximo)", async () => {
    const id = await crearPagina("poda-demo");
    // 33 guardados: por encima del tope de 30.
    for (let i = 0; i < 33; i++) {
      await guardarBloques(id, [{ type: "spacer", props: { height: (i % 200) + 1 } }]);
    }
    const total = await db("page_revisions").where({ page_id: id }).count<{ c: number }[]>({ c: "*" });
    expect(Number(total[0].c)).toBe(30);
  });

  it("borrar la página definitivamente se lleva su historial (cascade)", async () => {
    const id = await crearPagina("hist-cascade-demo");
    await guardarBloques(id, [{ type: "spacer", props: { height: 10 } }]);
    expect(await db("page_revisions").where({ page_id: id }).first()).toBeTruthy();

    await fetch(`${baseUrl}/api/admin/pages/${id}`, { method: "DELETE", headers: auth() }); // papelera
    await fetch(`${baseUrl}/api/admin/pages/${id}/definitivo`, { method: "DELETE", headers: auth() });
    expect(await db("page_revisions").where({ page_id: id }).first()).toBeFalsy();
  });
});
