import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  applyDbEnv,
  createTestDatabase,
  dropTestDatabase,
  migrateLatest,
} from "./helpers/db";

/**
 * Noticias fuera del producto (item 7).
 *
 * No alcanza con sacar la página: verificamos que no haya endpoint público,
 * que la API rechace bloques `newsGrid` y que una página con datos viejos no
 * los devuelva.
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_news`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

let server: Server;
let baseUrl = "";
let db: Knex;

describeDb("Noticias retirada", () => {
  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    applyDbEnv(DB_NAME);
    process.env.NODE_ENV = "test";
    const { createApp } = await import("../api/src/app.js");
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  }, 120_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("/api/public/news responde 404", async () => {
    const res = await fetch(`${baseUrl}/api/public/news`);
    expect(res.status).toBe(404);
  });

  it("/api/public/news/:slug responde 404", async () => {
    const res = await fetch(`${baseUrl}/api/public/news/cualquiera`);
    expect(res.status).toBe(404);
  });

  it("la API rechaza guardar un bloque newsGrid", async () => {
    const { validateBlockProps } = await import("../api/src/block-validation.js");
    const result = validateBlockProps("newsGrid", { limit: 6, columns: 3 });
    expect(result.success).toBe(false);
  });

  it("una página con un newsGrid viejo no lo devuelve", async () => {
    const page = await db("pages").where({ status: "published" }).first("id", "slug");
    expect(page).toBeTruthy();
    // Insertamos a mano una fila legacy, como si viniera de la base vieja.
    const maxOrder = (await db("blocks").where({ page_id: page.id }).max<{ m: number | null }[]>({ m: "order" }))[0]?.m ?? 0;
    const [legacyId] = await db("blocks").insert({
      page_id: page.id,
      type: "newsGrid",
      order: Number(maxOrder) + 1,
      props: JSON.stringify({ limit: 3, columns: 3 }),
    });

    try {
      const res = await fetch(`${baseUrl}/api/public/pages/${page.slug}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const types = (body.blocks ?? []).map((b: { type: string }) => b.type);
      expect(types).not.toContain("newsGrid");
    } finally {
      await db("blocks").where({ id: legacyId }).del();
    }
  });

  it("newsGrid no figura en el registro de bloques del panel", async () => {
    const { BLOCK_REGISTRY } = await import("../shared/types/blocks.js");
    expect(BLOCK_REGISTRY.map((b) => b.type)).not.toContain("newsGrid");
  });
});
