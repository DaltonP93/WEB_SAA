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

const config: Record<string, Knex.Config> = {
  development: base,
  production: base,
};

export default config;
