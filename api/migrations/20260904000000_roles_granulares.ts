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
 * `down()` es reversible pero **fail-closed**: angostar el enum a los dos
 * originales sólo es seguro si no queda ningún usuario con un rol restringido. Un
 * rol como `auditor` (sólo lectura), `analista_marketing` u `operador_leads` **no
 * tiene destino de menor privilegio** en un dominio de dos roles: mapearlo a
 * `editor` (contenido completo + settings + leads) sería una **elevación de
 * privilegio**, no una simple pérdida de granularidad. Por eso `down()` **no
 * degrada automáticamente**: si hay usuarios restringidos, aborta antes de tocar
 * nada y remite a un backup verificado anterior o a un mapeo manual autorizado. Si
 * sólo quedan `superadmin`/`editor`, angosta el enum normalmente.
 *
 * Esta comprobación es **defensa en profundidad**: el preflight global
 * `scripts/deploy/roles-rollback-preflight.mjs` (invocado por `rollback-db.sh`)
 * adelanta el mismo bloqueo a antes del primer `migrate:down` de un batch, para no
 * revertir migraciones más nuevas y descubrir el problema recién acá. El error
 * lista sólo conteos por rol, nunca nombres, correos ni otra PII.
 */

const ENUM_NUEVO =
  "ENUM('superadmin','admin','editor','autor','revisor','analista_marketing','operador_leads','auditor')";
const ENUM_VIEJO = "ENUM('superadmin','editor')";
const ROLES_VIEJOS = ["superadmin", "editor"];
const MIGRACION = "20260904000000_roles_granulares.ts";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE \`users\` MODIFY \`role\` ${ENUM_NUEVO} NOT NULL DEFAULT 'editor'`);
}

export async function down(knex: Knex): Promise<void> {
  // Defensa en profundidad del preflight: si hay usuarios con un rol fuera de
  // {superadmin, editor}, angostar el enum los degradaría a `editor` (elevación de
  // privilegio). Se aborta ANTES de tocar la base. El mensaje lleva sólo conteos
  // por rol, nunca nombres ni correos.
  const restringidos = (await knex("users")
    .whereNotIn("role", ROLES_VIEJOS)
    .select("role")
    .count({ n: "id" })
    .groupBy("role")) as Array<{ role: string; n: number | string }>;
  if (restringidos.length > 0) {
    const resumen = restringidos.map((r) => `${r.role}=${Number(r.n)}`).join(", ");
    throw new Error(
      `rollback de ${MIGRACION} bloqueado: hay usuarios con roles fuera de {superadmin, editor} (${resumen}). ` +
        `Angostar el enum los degradaría a 'editor', una elevación de privilegio para cuentas de sólo lectura o acotadas. ` +
        `No se modificó ninguna fila. Restaurá un backup verificado ANTERIOR a esta migración o aplicá un mapeo manual de roles autorizado.`,
    );
  }
  await knex.raw(`ALTER TABLE \`users\` MODIFY \`role\` ${ENUM_VIEJO} NOT NULL DEFAULT 'editor'`);
}
