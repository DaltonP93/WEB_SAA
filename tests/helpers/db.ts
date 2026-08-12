import { randomUUID } from "node:crypto";
import knexFactory, { type Knex } from "knex";

/**
 * Utilidades de base para las pruebas.
 *
 * Cada archivo de prueba usa **su propia base** para que no se pisen entre sí
 * (varios crean y borran el esquema). Las migraciones se cargan con un
 * `migrationSource` propio: el migrador de knex hace `import()` en runtime y
 * eso depende de que Node sepa leer TypeScript; Vite sí lo transpila.
 */

export const DB_TESTS_ENABLED = process.env.TEST_DATABASE === "1";

/**
 * Contraseña del admin sembrado en las pruebas.
 *
 * Se genera al vuelo a propósito: una constante literal con pinta de
 * contraseña queda indexada por los escáneres de secretos (y los hace ruido
 * inútil), además de invitar a copiarla a un entorno real.
 */
export const TEST_ADMIN_PASSWORD = `prueba-${randomUUID()}`;

/**
 * Lee una columna JSON sin depender del motor.
 *
 * MySQL 8 —lo que corre en producción y en CI— devuelve las columnas JSON ya
 * parseadas; MariaDB, que es lo que suele haber en local, las devuelve como
 * string. `JSON.parse` directo funciona en una y falla en la otra con
 * `"[object Object]" is not valid JSON`.
 */
export function jsonColumn<T = any>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export const baseConnection = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASS ?? "root",
  charset: "utf8mb4",
};

const migrationModules = import.meta.glob("../../api/migrations/*.ts");

export const migrationSource = {
  getMigrations: async () =>
    Object.keys(migrationModules)
      .map((p) => p.split("/").pop() as string)
      .sort(),
  getMigrationName: (name: string) => name,
  getMigration: async (name: string) => {
    const key = Object.keys(migrationModules).find((p) => p.endsWith(`/${name}`));
    if (!key) throw new Error(`migración no encontrada: ${name}`);
    return (await migrationModules[key]()) as {
      up: (k: Knex) => Promise<void>;
      down: (k: Knex) => Promise<void>;
    };
  },
};

const seedModules = import.meta.glob("../../api/seeds/*.ts");

/** Mismo truco que `migrationSource`, para los seeds. */
export const seedSource = {
  getSeeds: async () =>
    Object.keys(seedModules)
      .map((p) => p.split("/").pop() as string)
      .sort(),
  getSeed: async (name: string) => {
    const key = Object.keys(seedModules).find((p) => p.endsWith(`/${name}`));
    if (!key) throw new Error(`seed no encontrado: ${name}`);
    return (await seedModules[key]()) as { seed: (k: Knex) => Promise<void> };
  },
};

export async function runSeeds(db: Knex) {
  await db.seed.run({ seedSource } as never);
}

/** Crea (o recrea) una base vacía y devuelve la conexión. */
export async function createTestDatabase(name: string): Promise<Knex> {
  const admin = knexFactory({ client: "mysql2", connection: baseConnection });
  await admin.raw(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin.raw(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.destroy();
  return knexFactory({ client: "mysql2", connection: { ...baseConnection, database: name } });
}

export async function migrateLatest(db: Knex) {
  await db.migrate.latest({ migrationSource });
}

/** Revierte UNA migración (rollback() volvería todo el batch de una vez). */
export async function migrateDown(db: Knex) {
  await db.migrate.down({ migrationSource });
}

/** Aplica UNA migración: sirve para dejar la base en un punto intermedio. */
export async function migrateUpOne(db: Knex) {
  await db.migrate.up({ migrationSource });
}

/** Nombres de las migraciones que todavía no se aplicaron, en orden. */
export async function pendingMigrations(db: Knex): Promise<string[]> {
  const [, pending] = await db.migrate.list({ migrationSource });
  return (pending as { file?: string }[] | string[]).map((m) =>
    typeof m === "string" ? m : (m.file ?? String(m)),
  );
}

/**
 * Exporta al entorno la conexión que usará la app bajo prueba.
 *
 * `api/src/db.ts` lee las variables al importarse y su `dotenv` no encuentra
 * `api/.env` cuando el proceso corre desde la raíz del repo, así que se las
 * pasamos explícitamente antes del import dinámico.
 */
export function applyDbEnv(name: string) {
  process.env.DB_HOST = baseConnection.host;
  process.env.DB_PORT = String(baseConnection.port);
  process.env.DB_USER = baseConnection.user;
  process.env.DB_PASS = baseConnection.password;
  process.env.DB_NAME = name;
}

export async function dropTestDatabase(name: string) {
  const admin = knexFactory({ client: "mysql2", connection: baseConnection });
  await admin.raw(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin.destroy();
}
