import type { Knex } from "knex";

/**
 * Historial de versiones de una pagina.
 *
 * Cada vez que se guardan los bloques de una pagina se archiva una **foto** de
 * como quedo: titulo, estado, SEO y los bloques con sus props. Desde esa foto
 * se puede volver a una version anterior sin haber perdido nada en el medio.
 *
 * `snapshot` es JSON: el conjunto de bloques y sus props no tiene forma fija
 * (cada tipo de bloque trae lo suyo), asi que una columna JSON evita una tabla
 * espejo que habria que migrar con cada tipo nuevo. Es dato de lectura y de
 * restauracion, no algo que se consulte con `WHERE`.
 *
 * `page_id` con cascade: si la pagina se borra **definitivamente**, su historial
 * se va con ella (no tiene sentido guardar versiones de algo que ya no existe).
 * La papelera es borrado logico, asi que restaurar una pagina conserva su
 * historial. `created_by` apunta al usuario que guardo, y queda en NULL si esa
 * cuenta se elimina —el historial no se pierde por eso—.
 *
 * Reversible: `down()` borra la tabla.
 */

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("page_revisions")) return;
  await knex.schema.createTable("page_revisions", (t) => {
    t.increments("id").primary();
    t.integer("page_id").unsigned().notNullable().references("id").inTable("pages").onDelete("CASCADE");
    t.json("snapshot").notNullable();
    t.integer("created_by").unsigned().nullable().references("id").inTable("users").onDelete("SET NULL");
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["page_id", "id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("page_revisions")) {
    await knex.schema.dropTable("page_revisions");
  }
}
