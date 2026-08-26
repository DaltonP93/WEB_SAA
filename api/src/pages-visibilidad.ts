import type { Knex } from "knex";

/**
 * El criterio unico de "esta pagina es visible en el sitio publico".
 *
 * Vive en un solo lugar porque lo consultan tres consumidores —la lista publica
 * de paginas, el detalle por slug y el sitemap— y si cada uno arma su propio
 * `where` terminan divergiendo: una pagina agendada saldria en el sitemap pero
 * daria 404 al abrirla, o una borrada se serviria por una punta y no por la otra.
 *
 * Una pagina es publica cuando:
 * - esta `published` (no borrador),
 * - no esta en la papelera (`deleted_at IS NULL`),
 * - y no esta agendada al futuro (`publish_at IS NULL` o ya paso). La comparacion
 *   la hace la base con su propio reloj (`NOW()`), no el proceso: asi no depende
 *   de la hora del contenedor ni de que la app y la base esten sincronizadas.
 */
export function filtrarPaginaPublica<T extends Knex.QueryBuilder>(qb: T, conn: Knex): T {
  return qb
    .where("status", "published")
    .whereNull("deleted_at")
    .where((b) => b.whereNull("publish_at").orWhere("publish_at", "<=", conn.fn.now())) as T;
}
