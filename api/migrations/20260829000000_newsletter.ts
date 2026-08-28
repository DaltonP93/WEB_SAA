import type { Knex } from "knex";

/**
 * Suscriptores de novedades (newsletter), captura propia con consentimiento.
 *
 * Sin proveedor externo: los correos que deja la gente en el sitio se guardan
 * acá y se exportan como CSV desde el panel. No es una lista de envío con
 * campañas ni automatizaciones —eso requeriría un servicio de mailing—; es el
 * registro de quién pidió recibir novedades, con la evidencia de ese pedido.
 *
 * Columnas:
 * - `email` único: volver a suscribirse con el mismo correo no crea un duplicado
 *   (el endpoint público es idempotente y reactiva).
 * - `source`: desde dónde se suscribió (la ruta de la página). Dimensionada como
 *   una ruta real (512), no un valor arbitrario chico que truncaba la ruta.
 * - `attribution`: de dónde venía el visitante (misma atribución de marketing,
 *   saneada).
 * - `consent_at`: cuándo consintió, **puesto por el servidor** (no viaja del
 *   cliente). `consent_version`: qué versión del texto de finalidad aceptó, para
 *   que un cambio de texto no se confunda con lo aceptado antes.
 * - `active`: si sigue suscripto. La baja no borra la fila: la marca inactiva,
 *   así queda la evidencia de que estuvo y de que pidió salir.
 * - `unsubscribe_token`: token **opaco y no predecible** para la baja pública;
 *   nunca sale en el CSV ni en logs.
 *
 * Reversible: `down()` borra la tabla.
 */

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("newsletter_subscribers")) return;
  await knex.schema.createTable("newsletter_subscribers", (t) => {
    t.increments("id").primary();
    t.string("email", 190).notNullable().unique();
    t.string("source", 512).nullable();
    t.json("attribution").nullable();
    t.timestamp("consent_at").nullable();
    t.string("consent_version", 32).nullable();
    t.boolean("active").notNullable().defaultTo(true);
    t.string("unsubscribe_token", 64).notNullable().unique();
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("newsletter_subscribers")) {
    await knex.schema.dropTable("newsletter_subscribers");
  }
}
