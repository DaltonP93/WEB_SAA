#!/usr/bin/env node
/**
 * Preflight de procedencia de marca para un rollback múltiple.
 *
 * El fail-closed que vive dentro del `down()` de cada migración de marca llega
 * **demasiado tarde** en una reversión de varias migraciones: las más nuevas
 * pueden haberse revertido antes de que el batch alcance
 * `20260828000000_brand_favicon.ts` / `20260827000000_brand_logo.ts`, y recién
 * ahí se descubriría que su snapshot no existe. Para entonces la base ya cambió.
 *
 * Este preflight se ejecuta **después** de calcular la lista completa de
 * migraciones a revertir (`PENDIENTES`) y **antes** del primer `migrate:down`.
 * Sólo actúa si el rollback realmente cruza alguna migración de marca; para cada
 * una incluida en la lista valida por adelantado que su snapshot exista y sea
 * válido. Si falta uno o es inválido, aborta sin revertir ninguna migración. Un
 * rollback que no cruza esas migraciones no queda bloqueado.
 *
 * No se salta con `ROLLBACK_ALLOW_AFTER_SEED`: esa variable existe para descartar
 * contenido tras un reseed, no para saltear una protección de procedencia que
 * evita corromper la marca. (Este script no la consulta.)
 *
 * Uso (lo invoca `rollback-db.sh`): recibe la lista `PENDIENTES` por stdin, un
 * nombre de migración por línea.
 *   printf '%s\n' "$PENDIENTES" | node scripts/deploy/brand-snapshot-preflight.mjs
 * Sale 0 si el rollback puede seguir; 1 si hay que abortarlo. Variables de
 * conexión: DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME (o api/.env).
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FORMATO = 1;

/** Los únicos campos que un snapshot de formato 1 puede tener. */
const CAMPOS = [
  "formato",
  "migracion",
  "propiedad",
  "filaExistia",
  "formaInesperada",
  "propiedadExistia",
  "valorAnterior",
  "aplicoCambio",
  "valorAplicado",
];

/**
 * Las migraciones de marca y su contrato. El preflight sólo se ocupa de éstas.
 * Debe permanecer en sincronía con la validación estricta de las migraciones
 * `20260827000000_brand_logo.ts` y `20260828000000_brand_favicon.ts`.
 */
export const MIGRACIONES_MARCA = [
  {
    migracion: "20260827000000_brand_logo.ts",
    propiedad: "logoUrl",
    valorPorDefecto: "/logo-sanatorio.png",
    snapshotKey: "snapshot_brand_logo_20260827000000",
  },
  {
    migracion: "20260828000000_brand_favicon.ts",
    propiedad: "faviconUrl",
    valorPorDefecto: "/favicon.png",
    snapshotKey: "snapshot_brand_favicon_20260828000000",
  },
];

function esObjeto(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parse(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Validación estricta idéntica a la de las migraciones, parametrizada por el
 * contrato de cada una. Devuelve `{ ok: true }` o `{ ok: false, motivo }`.
 */
export function validarSnapshot(value, cfg) {
  const o = parse(value);
  if (!esObjeto(o)) return { ok: false, motivo: "no es un objeto JSON" };

  const faltan = CAMPOS.filter((k) => !Object.prototype.hasOwnProperty.call(o, k));
  const sobran = Object.keys(o).filter((k) => !CAMPOS.includes(k));
  if (faltan.length > 0 || sobran.length > 0) {
    return { ok: false, motivo: `estructura inesperada (faltan: ${faltan.join(",") || "-"}; sobran: ${sobran.join(",") || "-"})` };
  }
  if (o.formato !== FORMATO) return { ok: false, motivo: `formato desconocido (esperado ${FORMATO})` };
  if (o.migracion !== cfg.migracion) return { ok: false, motivo: "pertenece a otra migración" };
  if (o.propiedad !== cfg.propiedad) return { ok: false, motivo: "pertenece a otra propiedad" };

  const esBool = (v) => typeof v === "boolean";
  if (!esBool(o.filaExistia) || !esBool(o.formaInesperada) || !esBool(o.propiedadExistia) || !esBool(o.aplicoCambio)) {
    return { ok: false, motivo: "banderas con tipo no booleano" };
  }
  const { filaExistia, formaInesperada, propiedadExistia, aplicoCambio, valorAnterior, valorAplicado } = o;

  if (aplicoCambio) {
    if (valorAplicado !== cfg.valorPorDefecto) return { ok: false, motivo: "valorAplicado incoherente con aplicoCambio=true" };
  } else if (valorAplicado !== null) {
    return { ok: false, motivo: "valorAplicado debe ser null con aplicoCambio=false" };
  }

  if (formaInesperada) {
    if (!(filaExistia && !propiedadExistia && valorAnterior === null && !aplicoCambio)) {
      return { ok: false, motivo: "combinación imposible con formaInesperada=true" };
    }
  } else if (!filaExistia) {
    if (!(!propiedadExistia && valorAnterior === null && aplicoCambio)) {
      return { ok: false, motivo: "combinación imposible con filaExistia=false" };
    }
  } else if (!propiedadExistia) {
    if (!(valorAnterior === null && aplicoCambio)) {
      return { ok: false, motivo: "combinación imposible con propiedadExistia=false" };
    }
  } else if (aplicoCambio) {
    if (!(valorAnterior === null || valorAnterior === "")) {
      return { ok: false, motivo: 'valorAnterior debe ser null o "" (propiedad presente, aplicoCambio=true)' };
    }
  } else if (!(typeof valorAnterior === "string" && valorAnterior.length > 0)) {
    return { ok: false, motivo: "valorAnterior debe ser un string no vacío (aplicoCambio=false)" };
  }

  return { ok: true };
}

/**
 * Núcleo testeable, sin base de datos. `pendientes` es la lista de nombres de
 * migración a revertir; `leerSnapshot(key)` devuelve el valor crudo del snapshot
 * (o undefined/null si no existe). Devuelve si hay que bloquear y por qué.
 */
export async function evaluarPreflight({ pendientes, leerSnapshot }) {
  const cruzadas = MIGRACIONES_MARCA.filter((m) => pendientes.includes(m.migracion));
  if (cruzadas.length === 0) return { bloquear: false, cruzadas: [], faltantes: [] };

  const faltantes = [];
  for (const m of cruzadas) {
    let crudo;
    try {
      crudo = await leerSnapshot(m.snapshotKey);
    } catch (err) {
      faltantes.push({ migracion: m.migracion, snapshotKey: m.snapshotKey, motivo: `no se pudo leer el snapshot (${err.message})` });
      continue;
    }
    if (crudo === undefined || crudo === null) {
      faltantes.push({ migracion: m.migracion, snapshotKey: m.snapshotKey, motivo: "snapshot ausente" });
      continue;
    }
    const res = validarSnapshot(crudo, m);
    if (!res.ok) faltantes.push({ migracion: m.migracion, snapshotKey: m.snapshotKey, motivo: res.motivo });
  }

  return { bloquear: faltantes.length > 0, cruzadas: cruzadas.map((m) => m.migracion), faltantes };
}

/** El mensaje que se imprime cuando el rollback queda bloqueado. */
export function mensajeBloqueo(faltantes) {
  return [
    "",
    "  ROLLBACK BLOQUEADO — PROCEDENCIA DE MARCA",
    "",
    "  El rollback cruza migraciones de marca cuyo snapshot de procedencia no",
    "  existe o no es válido:",
    ...faltantes.map((f) => `    · ${f.migracion} (${f.snapshotKey}): ${f.motivo}`),
    "",
    "  Sin ese snapshot no hay forma de restaurar con exactitud el estado previo",
    "  de settings.brand, así que no se revierte ninguna migración (la base queda",
    "  intacta). Es una base migrada antes de la corrección del rollback de marca.",
    "",
    "  Para cruzar este punto hace falta un backup ANTERIOR a estas migraciones",
    "  (o al deploy que las trajo), o un procedimiento manual autorizado. Un backup",
    "  tomado justo antes del rollback sólo recupera el estado ACTUAL, no",
    "  reconstruye el estado anterior a las migraciones.",
    "",
  ].join("\n");
}

async function main() {
  const entrada = readFileSync(0, "utf8");
  const pendientes = entrada
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Si el rollback no cruza ninguna migración de marca, no se toca la base.
  const cruzadas = MIGRACIONES_MARCA.filter((m) => pendientes.includes(m.migracion));
  if (cruzadas.length === 0) process.exit(0);

  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const requireFromApi = createRequire(resolve(ROOT, "api/package.json"));
  const mysql = requireFromApi("mysql2/promise");

  const envFile = (key) => {
    const path = resolve(ROOT, "api/.env");
    if (!existsSync(path)) return undefined;
    const line = readFileSync(path, "utf8").split("\n").find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : undefined;
  };
  const cfg = {
    host: process.env.DB_HOST ?? envFile("DB_HOST") ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? envFile("DB_PORT") ?? 3306),
    user: process.env.DB_USER ?? envFile("DB_USER") ?? "root",
    password: process.env.DB_PASS ?? envFile("DB_PASS") ?? "",
    database: process.env.DB_NAME ?? envFile("DB_NAME") ?? "sanatorio",
  };

  let conn;
  try {
    conn = await mysql.createConnection(cfg);
  } catch (err) {
    // No se puede verificar la procedencia ⇒ fail-closed: bloquear.
    console.error(mensajeBloqueo(cruzadas.map((m) => ({ migracion: m.migracion, snapshotKey: m.snapshotKey, motivo: `no se pudo conectar para verificar (${err.message})` }))));
    process.exit(1);
  }

  try {
    const leerSnapshot = async (key) => {
      const [rows] = await conn.query("SELECT `value` FROM settings WHERE `key` = ?", [key]);
      return rows.length ? rows[0].value : undefined;
    };
    const { bloquear, faltantes } = await evaluarPreflight({ pendientes, leerSnapshot });
    if (bloquear) {
      console.error(mensajeBloqueo(faltantes));
      process.exit(1);
    }
    process.exit(0);
  } finally {
    await conn.end();
  }
}

const esMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esMain) {
  main().catch((err) => {
    console.error(`[brand-snapshot-preflight] error inesperado: ${err.message}`);
    process.exit(1);
  });
}
