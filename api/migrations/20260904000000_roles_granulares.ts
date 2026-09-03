import type { Knex } from "knex";

/**
 * Amplía `users.role` de dos roles (`superadmin`/`editor`) a los ocho del modelo
 * de permisos por capacidades (ver `api/src/permisos.ts`).
 *
 * Sólo cambia el dominio del enum; no toca ninguna fila (los roles existentes
 * `superadmin`/`editor` siguen siendo válidos). La autorización real la aplican
 * los middlewares `requirePermiso*` en las rutas; esta columna es la fuente de
 * verdad del rol de cada usuario.
 *
 * `down()` es reversible pero **con pérdida controlada**: antes de angostar el
 * enum a los dos originales, mapea cualquier rol nuevo a `editor` (si no, MySQL
 * rechazaría el `MODIFY` por valores fuera del dominio). Es lo correcto para una
 * reversión: se conserva el acceso como editor en vez de dejar filas inválidas.
 */

const ENUM_NUEVO =
  "ENUM('superadmin','admin','editor','autor','revisor','analista_marketing','operador_leads','auditor')";
const ENUM_VIEJO = "ENUM('superadmin','editor')";
const ROLES_VIEJOS = ["superadmin", "editor"];

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE \`users\` MODIFY \`role\` ${ENUM_NUEVO} NOT NULL DEFAULT 'editor'`);
}

export async function down(knex: Knex): Promise<void> {
  // Cualquier rol que no exista en el enum viejo pasa a editor antes de angostar.
  await knex("users").whereNotIn("role", ROLES_VIEJOS).update({ role: "editor" });
  await knex.raw(`ALTER TABLE \`users\` MODIFY \`role\` ${ENUM_VIEJO} NOT NULL DEFAULT 'editor'`);
}
