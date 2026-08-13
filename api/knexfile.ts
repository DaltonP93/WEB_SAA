import "dotenv/config";
import type { Knex } from "knex";

const base: Knex.Config = {
  client: "mysql2",
  connection: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASS ?? "",
    database: process.env.DB_NAME ?? "sanatorio",
    charset: "utf8mb4",
  },
  pool: { min: 0, max: 10 },
  // Sin esto, si MySQL no responde las consultas quedan colgadas hasta el
  // timeout del socket y las requests nunca terminan.
  acquireConnectionTimeout: Number(process.env.DB_ACQUIRE_TIMEOUT_MS ?? 10_000),
  migrations: {
    directory: "./migrations",
    tableName: "knex_migrations",
    extension: "ts",
  },
  seeds: {
    directory: "./seeds",
    extension: "ts",
  },
};

/**
 * La CLI de knex elige la entrada por `NODE_ENV` y falla con un
 * "Required configuration option 'client' is missing" si el nombre no está
 * listado. La conexión sale toda de variables de entorno, así que cualquier
 * entorno usa la misma configuración: se enumeran los nombres habituales para
 * que `pnpm db:migrate` no dependa de cómo quedó NODE_ENV en el servidor.
 */
const config: Record<string, Knex.Config> = {
  development: base,
  test: base,
  staging: base,
  production: base,
};

export default config;
