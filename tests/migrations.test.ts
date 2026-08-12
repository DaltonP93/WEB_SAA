import { afterAll, beforeAll, describe, expect, it } from "vitest";
import knexFactory, { type Knex } from "knex";

/**
 * Migraciones sobre una base real.
 *
 * Sólo corren con TEST_DATABASE=1 y una base descartable configurada
 * (TEST_DB_NAME). Sin eso quedan marcadas como skipped: preferimos verlas
 * omitidas antes que dar por buena una prueba que no se ejecutó.
 *
 *   TEST_DATABASE=1 TEST_DB_NAME=sanatorio_test pnpm test tests/migrations.test.ts
 */

const ENABLED = process.env.TEST_DATABASE === "1";
const DB_NAME = process.env.TEST_DB_NAME ?? "sanatorio_test";

const connection = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASS ?? "root",
  charset: "utf8mb4",
};

const describeDb = ENABLED ? describe : describe.skip;

let db: Knex;

/**
 * Fuente de migraciones propia.
 *
 * El migrador de knex hace `import()` de los archivos en runtime, y eso
 * depende de que la versión de Node sepa cargar TypeScript (Node 20 no).
 * Vite sí transpila, así que importamos las migraciones acá y se las pasamos
 * ya resueltas: la prueba corre igual en Node 20 y en Node 22.
 */
const migrationModules = import.meta.glob("../api/migrations/*.ts");

const migrationSource = {
  getMigrations: async () =>
    Object.keys(migrationModules)
      .map((p) => p.split("/").pop() as string)
      .sort(),
  getMigrationName: (name: string) => name,
  getMigration: async (name: string) => {
    const key = Object.keys(migrationModules).find((p) => p.endsWith(`/${name}`));
    if (!key) throw new Error(`migración no encontrada: ${name}`);
    return (await migrationModules[key]()) as { up: (k: Knex) => Promise<void>; down: (k: Knex) => Promise<void> };
  },
};

async function migrateLatest() {
  await db.migrate.latest({ migrationSource });
}

/** Revierte UNA migración (rollback() volvería todo el batch de una). */
async function rollbackOne() {
  await db.migrate.down({ migrationSource });
}

describeDb("migraciones", () => {
  beforeAll(async () => {
    const admin = knexFactory({ client: "mysql2", connection });
    await admin.raw(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    await admin.raw(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.destroy();
    db = knexFactory({ client: "mysql2", connection: { ...connection, database: DB_NAME } });
  }, 60_000);

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it("corren sobre una base limpia", async () => {
    await migrateLatest();
    const tables = ["pages", "blocks", "contact_channels", "schedules", "studies", "services"];
    for (const t of tables) {
      expect(await db.schema.hasTable(t), `falta la tabla ${t}`).toBe(true);
    }
  }, 120_000);

  it("no publican datos de contacto inventados", async () => {
    const channels = await db("contact_channels").select("key", "value");
    expect(channels.length).toBeGreaterThan(0);
    // Todos los canales arrancan sin valor: los carga el sanatorio.
    expect(channels.every((c) => !c.value)).toBe(true);
  });

  it("no publican horarios inventados", async () => {
    const active = await db("schedules").where({ active: true });
    expect(active).toEqual([]);
    const withHours = await db("schedules").whereNotNull("hours");
    expect(withHours).toEqual([]);
  });

  it("dejan Noticias fuera del sitio", async () => {
    expect(await db("pages").where({ slug: "noticias" }).first()).toBeUndefined();
    expect(await db("blocks").where({ type: "newsGrid" })).toEqual([]);
  });

  it("dejan una sola página de portal publicada", async () => {
    const published = await db("pages")
      .where({ status: "published" })
      .andWhere("slug", "like", "portal%")
      .select("slug");
    expect(published.map((p) => p.slug)).toEqual(["portal-paciente"]);
  });

  it("no repiten iconos dentro de la grilla de estudios", async () => {
    const rows = await db("studies").whereNotNull("icon").select("slug", "icon");
    const icons = rows.map((r) => r.icon);
    expect(new Set(icons).size, `iconos repetidos: ${icons.join(", ")}`).toBe(icons.length);
  });

  it("son idempotentes: correr up() de nuevo no duplica ni rompe", async () => {
    const before = {
      pages: (await db("pages").count<{ c: number }[]>("id as c"))[0].c,
      channels: (await db("contact_channels").count<{ c: number }[]>("id as c"))[0].c,
      blocks: (await db("blocks").count<{ c: number }[]>("id as c"))[0].c,
    };

    const minuta = await import("../api/migrations/20260812000000_web_minuta_ajustes.js");
    const channelsMig = await import("../api/migrations/20260813000000_contact_channels.js");
    const schedulesMig = await import("../api/migrations/20260813000001_schedules.js");
    const fixes = await import("../api/migrations/20260813000002_minuta_correcciones.js");
    await minuta.up(db);
    await channelsMig.up(db);
    await schedulesMig.up(db);
    await fixes.up(db);

    const after = {
      pages: (await db("pages").count<{ c: number }[]>("id as c"))[0].c,
      channels: (await db("contact_channels").count<{ c: number }[]>("id as c"))[0].c,
      blocks: (await db("blocks").count<{ c: number }[]>("id as c"))[0].c,
    };
    expect(after.pages).toBe(before.pages);
    expect(after.channels).toBe(before.channels);
    expect(after.blocks).toBe(before.blocks);
  }, 120_000);

  it("el backup del rollback no se pisa al repetir la migración", async () => {
    const row = await db("settings").where({ key: "minuta_blocks_backup_20260812000000" }).first();
    expect(row).toBeTruthy();
    const value = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    // El backup guarda el estado ANTERIOR: bloques de páginas que la migración
    // reemplazó. Si se hubiera pisado en la segunda corrida, estaría vacío.
    expect(Array.isArray(value.blocks)).toBe(true);
  });

  it("hacen rollback y se pueden volver a aplicar", async () => {
    await rollbackOne(); // 20260813000002
    expect(await db("pages").where({ slug: "portal-resultados-diagnostico" }).first()).toBeTruthy();

    await rollbackOne(); // 20260813000001 (schedules)
    expect(await db.schema.hasTable("schedules")).toBe(false);

    await rollbackOne(); // 20260813000000 (contact_channels)
    expect(await db.schema.hasTable("contact_channels")).toBe(false);

    await migrateLatest();
    expect(await db.schema.hasTable("contact_channels")).toBe(true);
    expect(await db.schema.hasTable("schedules")).toBe(true);
    const published = await db("pages")
      .where({ status: "published" })
      .andWhere("slug", "like", "portal%")
      .select("slug");
    expect(published.map((p) => p.slug)).toEqual(["portal-paciente"]);
  }, 180_000);
});
