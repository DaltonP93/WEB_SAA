import type { Knex } from "knex";

/**
 * Suscriptores de novedades (newsletter), captura propia.
 *
 * Sin proveedor externo: los correos que deja la gente en el sitio se guardan
 * acá y se exportan como CSV desde el panel. No es una lista de envio con
 * campanas ni automatizaciones —eso requeriria un servicio de mailing—; es el
 * registro de quien pidio recibir novedades, para llevarselo a donde el
 * sanatorio decida enviarlas.
 *
 * `email` unico: volver a suscribirse con el mismo correo no crea un duplicado
 * (el endpoint publico es idempotente). `source` guarda desde donde se suscribio
 * (que bloque/pagina), y `attribution` reutiliza la atribucion de marketing
 * —de donde venia el visitante— que ya sabemos sanear. Ninguno es dato
 * sensible: es un correo que la persona entrego a proposito.
 *
 * Reversible: `down()` borra la tabla.
 */

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("newsletter_subscribers")) return;
  await knex.schema.createTable("newsletter_subscribers", (t) => {
    t.increments("id").primary();
    t.string("email", 190).notNullable().unique();
    t.string("source", 64).nullable();
    t.json("attribution").nullable();
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("newsletter_subscribers")) {
    await knex.schema.dropTable("newsletter_subscribers");
  }
}
