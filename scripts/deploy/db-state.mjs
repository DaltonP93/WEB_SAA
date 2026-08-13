#!/usr/bin/env node
/**
 * ¿Esta base se puede sembrar?
 *
 * `setup-vps.sh` decidía sembrar mirando un archivo: `${APP_DIR}/.seeded`. Si
 * ese archivo se perdía —un rsync que no lo copió, un `rm -rf` del directorio,
 * una reinstalación del servidor apuntando a la misma base—, la siguiente
 * ejecución volvía a sembrar. Y los seeds empiezan borrando:
 *
 *     await knex("users").del();      await knex("services").del();
 *     await knex("blocks").del();     await knex("pages").del();
 *
 * Es decir: usuarios, ajustes, médicos, especialidades, servicios, estudios,
 * páginas y bloques. Todo lo que el sanatorio hubiera cargado desde el panel.
 * Un archivo ausente no puede ser la única prueba de que no hay nada que
 * perder, así que la decisión pasa a mirar la base.
 *
 * Uso:
 *   node scripts/deploy/db-state.mjs
 *
 * Imprime en stdout una sola palabra:
 *
 *   nueva          la base no existe o no tiene contenido → se puede sembrar
 *   actualizacion  hay contenido y el marker existe       → NO se siembra
 *   conflicto      hay contenido y falta el marker        → se aborta (exit 3)
 *
 * El detalle va a stderr. Variables: DB_HOST, DB_PORT, DB_USER, DB_PASS,
 * DB_NAME y SEED_MARKER (ruta del archivo `.seeded`).
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// mysql2 es dependencia de api/, no de la raíz del workspace.
const requireFromApi = createRequire(resolve(ROOT, "api/package.json"));
const mysql = requireFromApi("mysql2/promise");

/** Lee una clave de api/.env sin depender de dotenv. */
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
};
const DB_NAME = process.env.DB_NAME ?? envFile("DB_NAME") ?? "sanatorio";
const SEED_MARKER = process.env.SEED_MARKER ?? resolve(ROOT, ".seeded");

/**
 * Tablas cuyo contenido carga el sanatorio. `knex_migrations` no cuenta: una
 * base migrada pero vacía sigue siendo una instalación nueva.
 */
const CONTENT_TABLES = [
  "users",
  "pages",
  "blocks",
  "doctors",
  "specialties",
  "services",
  "studies",
  "contact_channels",
  "schedules",
  "settings",
  "menus",
  "appointments",
  "contact_messages",
];

function decide(token, detail, code = 0) {
  console.log(token);
  console.error(detail);
  process.exit(code);
}

async function main() {
  const conn = await mysql.createConnection(cfg);
  try {
    const [dbs] = await conn.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?", [
      DB_NAME,
    ]);
    if (dbs.length === 0) {
      decide("nueva", `La base "${DB_NAME}" no existe todavía: instalación nueva.`);
    }

    const [tables] = await conn.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?",
      [DB_NAME],
    );
    const present = new Set(tables.map((t) => t.name));

    // Sin una sola tabla no hay nada que perder: es una instalación nueva.
    // Cualquier otra cosa hay que demostrarla, y un archivo en disco no lo
    // demuestra.
    if (present.size === 0) {
      decide("nueva", `La base "${DB_NAME}" está vacía: instalación nueva.`);
    }

    const withContent = [];
    for (const table of CONTENT_TABLES) {
      if (!present.has(table)) continue;
      const [count] = await conn.query(`SELECT COUNT(*) AS n FROM \`${DB_NAME}\`.\`${table}\``);
      const n = Number(count[0].n);
      if (n > 0) withContent.push(`${table}=${n}`);
    }
    const detail = withContent.length > 0 ? withContent.join(", ") : `${present.size} tabla(s), sin filas`;

    if (existsSync(SEED_MARKER)) {
      decide("actualizacion", `La base ya está instalada (${detail}). Se migra, no se siembra.`);
    }

    decide(
      "conflicto",
      [
        `La base "${DB_NAME}" YA TIENE CONTENIDO (${detail})`,
        `pero falta el marker ${SEED_MARKER}.`,
        "",
        "Sembrar ahora borraría usuarios, ajustes, médicos, especialidades,",
        "servicios, estudios, páginas y bloques. No se hace por las dudas:",
        "que falte un archivo no prueba que no haya nada que perder.",
        "",
        "Si esta base es la buena y sólo se perdió el marker:",
        `  touch ${SEED_MARKER}`,
        "y volvé a correr el script: va a migrar sin sembrar.",
        "",
        "Si la instalación quedó a medias (migró y no llegó a sembrar), lo mismo:",
        "creá el marker y sembrá a mano con `pnpm db:seed` después de mirar qué hay.",
        "",
        "Si de verdad querés empezar de cero, borrá o renombrá la base a mano",
        "—con un dump antes— y volvé a correr el script.",
      ].join("\n"),
      3,
    );
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.log("error");
  console.error(`No se pudo determinar el estado de la base: ${err.message}`);
  // Ante la duda no se siembra.
  process.exit(4);
});
