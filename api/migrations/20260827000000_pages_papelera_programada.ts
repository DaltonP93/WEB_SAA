import type { Knex } from "knex";

/**
 * Papelera y publicacion programada de paginas.
 *
 * Dos columnas anulables sobre `pages`, cada una un estado que hoy no se puede
 * expresar:
 *
 * - `deleted_at`: borrado recuperable. Borrar una pagina hoy es un `DELETE`
 *   fisico que se lleva la fila y sus bloques (cascade) sin vuelta atras. Con
 *   `deleted_at` la pagina pasa a la papelera —deja de listarse y de servirse—
 *   y se puede restaurar; el borrado definitivo sigue existiendo aparte.
 * - `publish_at`: momento a partir del cual una pagina publicada se vuelve
 *   visible. No hace falta un cron: la visibilidad publica se decide al leer
 *   (`status='published' AND deleted_at IS NULL AND (publish_at IS NULL OR
 *   publish_at <= NOW())`). Una pagina con `publish_at` futuro esta agendada;
 *   cuando el reloj pasa esa hora, aparece sola en la proxima lectura.
 *
 * Las dos anulables porque el estado por defecto es "ni borrada ni agendada":
 * `NULL` es exactamente eso. No se toca ninguna fila existente.
 *
 * Reversible: `down()` quita las dos columnas. Al revertir, una pagina que
 * estaba en la papelera vuelve a contar como viva (su `deleted_at` desaparece)
 * y una agendada se publica segun su `status` —el comportamiento previo a esta
 * migracion, sin dato perdido salvo la marca misma—.
 */

export async function up(knex: Knex): Promise<void> {
  const tieneDeleted = await knex.schema.hasColumn("pages", "deleted_at");
  const tienePublish = await knex.schema.hasColumn("pages", "publish_at");
  if (tieneDeleted && tienePublish) return;
  await knex.schema.alterTable("pages", (t) => {
    // `deleted_at` es siempre "ahora": un TIMESTAMP alcanza y sobra.
    if (!tieneDeleted) t.timestamp("deleted_at").nullable();
    // `publish_at` en cambio puede apuntar lejos en el futuro; un TIMESTAMP de
    // MySQL se corta en 2038 (límite de la época Unix) y guardar más allá es un
    // error. DATETIME llega hasta el año 9999, que es lo que corresponde para
    // una fecha de publicación agendada.
    if (!tienePublish) t.datetime("publish_at").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const col of ["deleted_at", "publish_at"]) {
    if (await knex.schema.hasColumn("pages", col)) {
      await knex.schema.alterTable("pages", (t) => t.dropColumn(col));
    }
  }
}
