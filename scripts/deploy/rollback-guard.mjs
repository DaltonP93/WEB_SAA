#!/usr/bin/env node
/**
 * Frena el rollback de migraciones cuando ya no puede restaurar nada.
 *
 * Las migraciones correctivas guardan un snapshot para poder revertirse. Dos
 * de ellas (`20260815`, `20260817`) lo guardan **indexado por id de bloque**,
 * porque modifican props de bloques existentes:
 *
 *     snapshot.blocks.push({ id: block.id, props });
 *     ...
 *     await knex("blocks").where({ id: block.id }).update(...)   // en down()
 *
 * Los seeds, en cambio, borran páginas y bloques y los vuelven a insertar: los
 * ids cambian. Si se siembra después de migrar, el `down()` de esas
 * migraciones busca ids que ya no existen, no actualiza ninguna fila y
 * **termina sin error**: knex marca la migración como revertida y el contenido
 * queda como estaba. Un rollback que dice "listo" sin haber restaurado nada es
 * peor que uno que falla.
 *
 * Esas migraciones ya están fusionadas y pueden haberse aplicado en el
 * servidor, así que no se editan. El contrato queda explícito acá:
 *
 *   **Si se sembró después de que corrió una migración, esa migración no se
 *   revierte con `down()`: se restaura el dump previo.**
 *
 * Uso (lo llama `pnpm --filter @sa/api migrate:rollback`):
 *   node scripts/deploy/rollback-guard.mjs
 *
 * Sale 0 si el rollback es seguro y 3 si no lo es. Con
 * `ROLLBACK_ALLOW_AFTER_SEED=1` sigue igual —lo usa `db:reset`, que justamente
 * quiere descartar el contenido—.
 */

import { existsSync, readFileSync } from "node:fs";
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

const parse = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

async function main() {
  if (process.env.ROLLBACK_ALLOW_AFTER_SEED === "1") {
    console.error("[rollback-guard] ROLLBACK_ALLOW_AFTER_SEED=1: se omite la comprobación.");
    return;
  }

  let conn;
  try {
    conn = await mysql.createConnection(cfg);
  } catch (err) {
    // Sin base no hay nada que revertir; que falle el propio knex con su error.
    console.error(`[rollback-guard] no se pudo conectar (${err.message}): se sigue.`);
    return;
  }

  try {
    const [rows] = await conn.query("SELECT `key`, `value` FROM settings WHERE `key` LIKE 'snapshot_%' OR `key` = 'seed_generation'");
    const seedRow = rows.find((r) => r.key === "seed_generation");
    const seededAt = seedRow ? Date.parse(parse(seedRow.value)?.at ?? "") : NaN;
    if (!seedRow || Number.isNaN(seededAt)) return; // nunca se sembró después de migrar

    const stale = [];
    for (const row of rows) {
      if (row.key === "seed_generation") continue;
      const createdAt = Date.parse(parse(row.value)?.createdAt ?? "");
      if (Number.isNaN(createdAt)) continue;
      if (createdAt < seededAt) stale.push(row.key);
    }
    if (stale.length === 0) return;

    console.error(
      [
        "",
        "  ROLLBACK BLOQUEADO",
        "",
        `  La base se sembró (${new Date(seededAt).toISOString()}) después de que`,
        "  corrieran estas migraciones:",
        ...stale.map((k) => `    · ${k}`),
        "",
        "  El seed borra y vuelve a crear páginas y bloques, así que los ids",
        "  cambiaron. El `down()` de esas migraciones restaura por id: no",
        "  encontraría ninguna fila y se marcaría como revertido sin haber",
        "  restaurado nada.",
        "",
        "  Para volver atrás, restaurá el dump previo al deploy:",
        "    gunzip < /var/www/sanatorio/.db-backups/<archivo>.sql.gz \\",
        "      | mysql -u sanatorio -p sanatorio",
        "",
        "  Si estás descartando el contenido a propósito (entorno de",
        "  desarrollo, base de prueba):",
        "    ROLLBACK_ALLOW_AFTER_SEED=1 pnpm --filter @sa/api migrate:rollback",
        "",
      ].join("\n"),
    );
    process.exitCode = 3;
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`[rollback-guard] error inesperado: ${err.message}`);
  process.exitCode = 4;
});
