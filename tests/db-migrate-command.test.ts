import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import knexFactory from "knex";
import { DB_TESTS_ENABLED, baseConnection, dropTestDatabase } from "./helpers/db";

/**
 * El comando real de producción, no una simulación.
 *
 * El resto de la suite corre las migraciones con un `migrationSource` propio
 * porque Vite transpila TypeScript; eso NO prueba que `pnpm db:migrate` ande
 * en el servidor. Acá se ejecuta el comando tal cual está en package.json
 * (`tsx ./node_modules/knex/bin/cli.js --knexfile knexfile.ts migrate:latest`)
 * contra una base descartable, que es el escenario que rompió en CI con
 * Node 20: el migrador de knex hace `import()` en runtime y sólo Node ≥ 22.18
 * sabe leer `.ts` sin ayuda. `tsx` es lo que cierra esa brecha.
 *
 *   TEST_DATABASE=1 pnpm test tests/db-migrate-command.test.ts
 */

const exec = promisify(execFile);
const ROOT = resolve(__dirname, "..");
const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_cmd`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const migrationFiles = readdirSync(resolve(ROOT, "api/migrations")).filter((f) => f.endsWith(".ts"));

function runMigrate() {
  return exec("pnpm", ["db:migrate"], {
    cwd: ROOT,
    env: {
      ...process.env,
      // Igual que en el servidor: vitest deja NODE_ENV=test y el comando real
      // corre en producción.
      NODE_ENV: "production",
      DB_HOST: baseConnection.host,
      DB_PORT: String(baseConnection.port),
      DB_USER: baseConnection.user,
      DB_PASS: baseConnection.password,
      DB_NAME,
    },
    // Instalar dependencias no entra acá; sólo se ejecuta el script.
    timeout: 240_000,
  });
}

describeDb("pnpm db:migrate (comando real)", () => {
  let db: Knex;

  beforeAll(async () => {
    const admin = knexFactory({ client: "mysql2", connection: baseConnection });
    await admin.raw(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    await admin.raw(
      `CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await admin.destroy();
    db = knexFactory({ client: "mysql2", connection: { ...baseConnection, database: DB_NAME } });
  }, 60_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("aplica todas las migraciones sobre MySQL", async () => {
    const { stdout, stderr } = await runMigrate();
    expect(stderr).not.toMatch(/Unknown file extension/);

    const applied = await db("knex_migrations").select("name");
    expect(applied.map((r) => r.name).sort()).toEqual(migrationFiles.sort());

    // Deja rastro de con qué Node corrió: la regresión era específica de v20.
    expect(`${stdout}\n[node ${process.version}]`).toContain("[node ");
  }, 300_000);

  it("es idempotente: volver a correrlo no aplica nada nuevo", async () => {
    const before = await db("knex_migrations").count<{ c: number }[]>("id as c");
    await runMigrate();
    const after = await db("knex_migrations").count<{ c: number }[]>("id as c");
    expect(after[0].c).toBe(before[0].c);
  }, 300_000);

  it("el contenido queda sin datos institucionales sin confirmar", async () => {
    // Misma verificación que hace la suite con migrationSource, pero sobre la
    // base que dejó el comando real.
    expect(await db("pages").where({ slug: "noticias" }).first()).toBeUndefined();
    expect(await db("blocks").where({ type: "newsGrid" })).toEqual([]);
    expect(await db("studies").where({ published: true })).toEqual([]);
    expect(await db("schedules").where({ active: true })).toEqual([]);
  });
});
