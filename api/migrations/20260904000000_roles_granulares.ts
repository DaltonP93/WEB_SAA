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
 * `down()` es reversible pero **con pérdida controlada, y hay que leerla como una
 * elevación de privilegio, no sólo como pérdida de granularidad**: antes de
 * angostar el enum a los dos originales, mapea cualquier rol nuevo a `editor` (si
 * no, MySQL rechazaría el `MODIFY` por valores fuera del dominio). El enum viejo
 * sólo tiene `superadmin`/`editor`, así que un rol restringido —`auditor` (sólo
 * lectura), `analista_marketing`, `operador_leads`— **no tiene un destino de menor
 * privilegio**: termina como `editor`, con contenido completo (leer/escribir/
 * publicar/borrar) + settings + leads. No hay forma de conservar "sólo lectura" en
 * un dominio de dos roles. Un `superadmin` se conserva (no hay lockout por esta
 * vía).
 *
 * ⚠️ Operativo: un rollback que cruce esta migración debe ir seguido de una
 * **revisión de los roles de usuarios** (bitácora `admin_audit_log` + panel de
 * Usuarios), porque cuentas que eran de sólo lectura quedaron con permisos de
 * editor. El `down()` no puede evitarlo; la mitigación es este control posterior.
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
  // Ver el ⚠️ de la cabecera: esto ELEVA privilegios a roles de sólo lectura;
  // revisar los roles de usuarios después de un rollback que cruce esta migración.
  await knex("users").whereNotIn("role", ROLES_VIEJOS).update({ role: "editor" });
  await knex.raw(`ALTER TABLE \`users\` MODIFY \`role\` ${ENUM_VIEJO} NOT NULL DEFAULT 'editor'`);
}
