import type { Knex } from "knex";

/**
 * Bitácora de acciones administrativas (trazabilidad de "quién hizo qué").
 *
 * Hasta ahora el proyecto sólo guardaba actor en tres lugares sueltos
 * (`page_revisions.created_by`, `media.uploaded_by`, la confirmación de
 * Biopsias). Publicar/despublicar/programar, mandar a la papelera, restaurar,
 * borrar definitivamente, y todo el CRUD de médicos/servicios/estudios/menús/
 * settings/usuarios no dejaban rastro de autor. Esta tabla es el registro único
 * de esas acciones.
 *
 * Qué se guarda y qué NO:
 *  - Actor: `actor_id` (FK a `users`, `SET NULL` si la cuenta se borra —el
 *    registro no se pierde—) más una **foto** de `actor_name`/`actor_role` al
 *    momento, para que la bitácora siga siendo legible aunque el usuario cambie
 *    de nombre/rol o se elimine.
 *  - `action`: qué se hizo (create/update/publish/unpublish/schedule/trash/
 *    restore/purge/restore_revision/role_change/login_ok/login_fail).
 *  - `resource_type`/`resource_id`: sobre qué (nombre de tabla + id). `resource_id`
 *    es texto para admitir cualquier id sin acoplarse a su tipo.
 *  - `meta`: JSON con detalle **acotado y no sensible** (p. ej. `{ slug }`,
 *    `{ from, to }` de un cambio de rol). **Nunca** contenido de formularios,
 *    turnos ni mensajes: nada de PII de pacientes. El emisor (`api/src/audit.ts`)
 *    sólo pasa metadatos de operación.
 *  - `ip`: IP del **operador** (personal del panel), útil para forense de
 *    seguridad. Vive en una tabla que sólo lee un superadmin, coherente con la
 *    regla del proyecto de que la información personal aparezca únicamente dentro
 *    del panel autenticado.
 *  - `created_at`: instante del servidor (se muestra en `America/Asuncion`).
 *
 * Es una tabla **append-only** por diseño (no hay endpoint de edición/borrado);
 * sólo se lee, paginada, desde `GET /api/admin/audit` (solo superadmin).
 *
 * Reversible: `down()` borra la tabla.
 */

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("admin_audit_log")) return;
  await knex.schema.createTable("admin_audit_log", (t) => {
    t.bigIncrements("id").primary();
    t.integer("actor_id").unsigned().nullable().references("id").inTable("users").onDelete("SET NULL");
    t.string("actor_name", 191).nullable();
    t.string("actor_role", 32).nullable();
    t.string("action", 40).notNullable();
    t.string("resource_type", 64).nullable();
    t.string("resource_id", 191).nullable();
    t.json("meta").nullable();
    t.string("ip", 45).nullable();
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["resource_type", "resource_id"]);
    t.index(["created_at"]);
    t.index(["actor_id"]);
    t.index(["action"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("admin_audit_log")) {
    await knex.schema.dropTable("admin_audit_log");
  }
}
