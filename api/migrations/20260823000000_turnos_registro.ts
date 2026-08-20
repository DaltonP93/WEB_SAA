import type { Knex } from "knex";

/**
 * Completa `appointments` para poder registrar la solicitud de turno.
 *
 * La tabla existía desde `20260516000001_init.ts` y el endpoint público que la
 * escribe también, pero el formulario del sitio nunca lo llamaba: abría
 * WhatsApp y listo. Ahora la solicitud se registra **antes** de salir a
 * WhatsApp, y para eso faltaban tres columnas.
 *
 * ## `submission_key` — por qué una clave del cliente
 *
 * El formulario manda a la API y después navega a WhatsApp. Entre esas dos
 * cosas puede pasar de todo: el paciente hace doble clic, la respuesta tarda y
 * el navegador reintenta, o la fila se crea y la respuesta se pierde en el
 * camino. En los tres casos el reintento no puede dejar dos turnos iguales.
 *
 * La clave la genera el cliente **una vez por formulario**, así que identifica
 * al intento y no a la petición. El índice único es lo que hace la garantía
 * real: sin él, dos peticiones simultáneas pasan las dos por el `select` previo
 * y las dos insertan. Con él, la segunda choca y la API devuelve la fila que ya
 * existe.
 *
 * Es `nullable` porque las filas anteriores a esta migración no la tienen —y
 * en MySQL un índice único admite varios `NULL`, que es justo lo que hace
 * falta para no romper una base con datos—.
 *
 * ## `consent_at` — cuándo aceptó, no sólo que aceptó
 *
 * El formulario exige una aceptación explícita del uso de los datos para
 * gestionar la solicitud. Guardar sólo un booleano no dice nada el día que
 * alguien pregunte desde cuándo: se guarda el instante, y `NULL` significa que
 * esa fila es anterior al consentimiento.
 *
 * ## `updated_at`
 *
 * La bandeja del panel cambia el estado de la solicitud. Sin esta columna no
 * hay forma de saber cuándo se atendió, y `created_at` no sirve: es de cuando
 * la cargó el paciente.
 */

const TABLA = "appointments";

export async function up(knex: Knex): Promise<void> {
  const tieneClave = await knex.schema.hasColumn(TABLA, "submission_key");
  const tieneConsentimiento = await knex.schema.hasColumn(TABLA, "consent_at");
  const tieneActualizado = await knex.schema.hasColumn(TABLA, "updated_at");

  if (!tieneClave || !tieneConsentimiento || !tieneActualizado) {
    await knex.schema.alterTable(TABLA, (t) => {
      if (!tieneClave) t.string("submission_key", 64).nullable();
      if (!tieneConsentimiento) t.timestamp("consent_at").nullable();
      // Sin default: una fila que nadie tocó no tiene fecha de modificación.
      if (!tieneActualizado) t.timestamp("updated_at").nullable();
    });
  }

  if (!tieneClave) {
    await knex.schema.alterTable(TABLA, (t) => {
      t.unique(["submission_key"], { indexName: "appointments_submission_key_unique" });
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // El índice se suelta antes que la columna: MySQL no deja borrar una columna
  // que todavía sostiene un índice único.
  if (await knex.schema.hasColumn(TABLA, "submission_key")) {
    await knex.schema.alterTable(TABLA, (t) => {
      t.dropUnique(["submission_key"], "appointments_submission_key_unique");
    });
    await knex.schema.alterTable(TABLA, (t) => t.dropColumn("submission_key"));
  }
  for (const columna of ["consent_at", "updated_at"]) {
    if (await knex.schema.hasColumn(TABLA, columna)) {
      await knex.schema.alterTable(TABLA, (t) => t.dropColumn(columna));
    }
  }
}
