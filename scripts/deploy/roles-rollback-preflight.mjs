#!/usr/bin/env node
/**
 * Preflight de rollback de los roles granulares.
 *
 * `20260904000000_roles_granulares.ts` amplía `users.role` de `superadmin`/`editor`
 * a ocho roles. Su `down()` angosta el enum de vuelta a los dos históricos, pero un
 * rol restringido (`auditor` sólo-lectura, `analista_marketing`, `operador_leads`,
 * etc.) **no tiene destino de menor privilegio** en un dominio de dos roles:
 * degradarlo a `editor` sería una **elevación de privilegio** (editor puede
 * leer/escribir/publicar/borrar contenido, settings y leads).
 *
 * Por eso el rollback se **bloquea** antes de revertir nada si cruza esa migración
 * y existe algún usuario con un rol fuera de `{superadmin, editor}`. Hay que
 * restaurar un backup verificado ANTERIOR a la migración, o aplicar un mapeo manual
 * de roles explícitamente autorizado. Es la misma filosofía fail-closed del
 * preflight de marca, y llega ANTES del primer `migrate:down` para que el batch no
 * revierta migraciones más nuevas y recién ahí descubra el problema.
 *
 * No se salta con `ROLLBACK_ALLOW_AFTER_SEED`: esa variable descarta contenido tras
 * un reseed, no autoriza degradar cuentas. (Este script no la consulta.)
 *
 * Uso (lo invoca `rollback-db.sh`): recibe `PENDIENTES` por stdin, un nombre de
 * migración por línea. Sale 0 si el rollback puede seguir; 1 si hay que abortarlo.
 * Variables de conexión: DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME (o api/.env).
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** La migración que introduce los roles granulares. */
export const ROLES_MIGRACION = "20260904000000_roles_granulares.ts";
/** Los dos roles del enum histórico: los únicos con destino seguro en el rollback. */
export const ROLES_HISTORICOS = ["superadmin", "editor"];

/**
 * Núcleo testeable, sin base. `pendientes` es la lista de nombres a revertir;
 * `contarRestringidos()` devuelve `[{ role, n }]` de usuarios con rol fuera de
 * `ROLES_HISTORICOS`. Bloquea si el rollback cruza la migración de roles **y** hay
 * al menos un usuario restringido. Si `contarRestringidos` lanza, se propaga:
 * `main()` lo trata como fail-closed (no se puede verificar ⇒ bloquear).
 */
export async function evaluarPreflightRoles({ pendientes, contarRestringidos }) {
  const cruza = pendientes.includes(ROLES_MIGRACION);
  if (!cruza) return { bloquear: false, cruza: false, conteos: [] };
  const conteos = await contarRestringidos();
  const total = conteos.reduce((s, c) => s + Number(c.n), 0);
  return { bloquear: total > 0, cruza: true, conteos };
}

/** Mensaje de bloqueo. Sólo conteos por rol: nunca nombres, correos ni PII. */
export function mensajeBloqueoRoles(conteos) {
  const resumen = conteos.length ? conteos.map((c) => `${c.role}=${Number(c.n)}`).join(", ") : "(sin detalle)";
  return [
    "",
    "  ROLLBACK BLOQUEADO — ROLES GRANULARES",
    "",
    "  El rollback cruza la migración de roles granulares y hay usuarios con un",
    "  rol fuera de {superadmin, editor}:",
    `    ${resumen}`,
    "",
    "  Angostar el enum de roles degradaría esas cuentas a 'editor', que es una",
    "  ELEVACIÓN de privilegio para roles de sólo lectura o acotados. Por eso no se",
    "  revierte ninguna migración y la base queda intacta.",
    "",
    "  Para cruzar este punto hace falta un backup verificado ANTERIOR a esta",
    "  migración, o un mapeo manual de roles explícitamente autorizado. No hay",
    "  degradación automática.",
    "",
  ].join("\n");
}

function envFile(key, root) {
  const path = resolve(root, "api/.env");
  if (!existsSync(path)) return undefined;
  const line = readFileSync(path, "utf8").split("\n").find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : undefined;
}

async function main() {
  const entrada = readFileSync(0, "utf8");
  const pendientes = entrada.split("\n").map((l) => l.trim()).filter(Boolean);

  // Si el rollback no cruza la migración de roles, no se toca la base.
  if (!pendientes.includes(ROLES_MIGRACION)) process.exit(0);

  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const requireFromApi = createRequire(resolve(ROOT, "api/package.json"));
  const mysql = requireFromApi("mysql2/promise");

  const cfg = {
    host: process.env.DB_HOST ?? envFile("DB_HOST", ROOT) ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? envFile("DB_PORT", ROOT) ?? 3306),
    user: process.env.DB_USER ?? envFile("DB_USER", ROOT) ?? "root",
    password: process.env.DB_PASS ?? envFile("DB_PASS", ROOT) ?? "",
    database: process.env.DB_NAME ?? envFile("DB_NAME", ROOT) ?? "sanatorio",
  };

  let conn;
  try {
    conn = await mysql.createConnection(cfg);
  } catch (err) {
    // No se puede verificar ⇒ fail-closed: bloquear.
    console.error(mensajeBloqueoRoles([{ role: `no se pudo conectar para verificar (${err.message})`, n: "?" }]));
    process.exit(1);
  }

  try {
    const contarRestringidos = async () => {
      const placeholders = ROLES_HISTORICOS.map(() => "?").join(",");
      const [rows] = await conn.query(
        `SELECT \`role\`, COUNT(*) AS n FROM users WHERE \`role\` NOT IN (${placeholders}) GROUP BY \`role\``,
        ROLES_HISTORICOS,
      );
      return rows.map((r) => ({ role: r.role, n: Number(r.n) }));
    };
    const { bloquear, conteos } = await evaluarPreflightRoles({ pendientes, contarRestringidos });
    if (bloquear) {
      console.error(mensajeBloqueoRoles(conteos));
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    // Cualquier fallo consultando ⇒ fail-closed.
    console.error(mensajeBloqueoRoles([{ role: `error al verificar roles (${err.message})`, n: "?" }]));
    process.exit(1);
  } finally {
    await conn.end();
  }
}

const esMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esMain) {
  main().catch((err) => {
    console.error(`[roles-rollback-preflight] error inesperado: ${err.message}`);
    process.exit(1);
  });
}
