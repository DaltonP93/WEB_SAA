#!/usr/bin/env node
/**
 * Qué migraciones hay que revertir para volver a una versión anterior.
 *
 * `rollback-vps.sh` lo calculaba contando archivos del repo:
 *
 *     git diff --name-only --diff-filter=A "$ROLLBACK_TO" HEAD -- api/migrations
 *
 * Eso cuenta lo que el código **agregó**, no lo que la base tiene **aplicado**.
 * Son cosas distintas cada vez que un deploy queda a medias: si la versión
 * nueva trae dos migraciones y el proceso murió después de la primera, el
 * conteo por archivos dice "2" y el rollback intenta revertir una migración
 * que nunca corrió — y de paso baja una de más, que sí existe en el SHA
 * destino y no debería tocarse.
 *
 * La fuente de verdad es `knex_migrations`: se revierte la intersección entre
 * lo aplicado y lo que el árbol destino no tiene, de la más nueva a la más
 * vieja.
 *
 * Uso:
 *   DEST_MIGRATIONS="$(git ls-tree --name-only <sha> -- api/migrations/)" \
 *     node scripts/deploy/migrations-to-revert.mjs
 *
 * Imprime un nombre por línea, en el orden en que hay que revertirlas
 * (la más nueva primero). Sin nada que revertir, no imprime nada.
 *
 * Variables: DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME y una de
 * DEST_MIGRATIONS (lista separada por saltos de línea) o DEST_MIGRATIONS_DIR
 * (un directorio con los archivos del árbol destino).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromApi = createRequire(resolve(ROOT, "api/package.json"));
const mysql = requireFromApi("mysql2/promise");

function envFile(key) {
  const path = resolve(ROOT, "api/.env");
  if (!existsSync(path)) return undefined;
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : undefined;
}

const cfg = {
  host: process.env.DB_HOST ?? envFile("DB_HOST") ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? envFile("DB_PORT") ?? 3306),
  user: process.env.DB_USER ?? envFile("DB_USER") ?? "root",
  password: process.env.DB_PASS ?? envFile("DB_PASS") ?? "",
  database: process.env.DB_NAME ?? envFile("DB_NAME") ?? "sanatorio",
};

/** Nombres de migración que tiene el árbol destino. */
function destMigrations() {
  const dir = process.env.DEST_MIGRATIONS_DIR;
  if (dir) return readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
  return (process.env.DEST_MIGRATIONS ?? "")
    .split("\n")
    .map((line) => line.trim().split("/").pop() ?? "")
    .filter((name) => name.endsWith(".ts") || name.endsWith(".js"));
}

async function main() {
  const dest = new Set(destMigrations());
  const conn = await mysql.createConnection(cfg);
  try {
    const [tables] = await conn.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_name = 'knex_migrations'",
      [cfg.database],
    );
    if (tables.length === 0) return; // nunca se migró: no hay nada que revertir

    const [rows] = await conn.query("SELECT name FROM knex_migrations ORDER BY id ASC");
    const applied = rows.map((r) => r.name);

    // Lo aplicado que el árbol destino no tiene. Se revierte al revés: las
    // migraciones dependen de las anteriores.
    const toRevert = applied.filter((name) => !dest.has(name)).reverse();
    for (const name of toRevert) console.log(name);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`[migrations-to-revert] ${err.message}`);
  process.exit(4);
});
