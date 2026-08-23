import type { Knex } from "knex";

/**
 * De dónde vino cada conversión.
 *
 * Un turno o un mensaje de contacto llegan hoy sin ninguna pista de qué los
 * originó: si la persona venía de una campaña, de una búsqueda, de un enlace
 * en Instagram o escribió la dirección a mano. Sin eso no se puede decir qué
 * esfuerzo de marketing trae pacientes y cuál no, que es la pregunta que este
 * proyecto va a tener que contestar sin depender de la analítica de terceros
 * —que agrega y anonimiza— ni de reglas inventadas.
 *
 * Se agrega **una** columna JSON anulable en las dos tablas que registran
 * conversiones. JSON y no columnas sueltas por tres motivos:
 *
 * - el conjunto de parámetros de campaña no es fijo (hoy los cinco `utm_*` más
 *   `gclid`/`fbclid`; mañana otro identificador de red) y no quiero una
 *   migración por cada uno;
 * - la fila la arma el front y la valida la API contra una allowlist, así que
 *   la forma vive en el código, no en el esquema;
 * - es dato de lectura para el panel y el export, no algo que se consulte con
 *   `WHERE utm_source = …` a escala — y si algún día hace falta, se indexa una
 *   columna generada sobre el JSON sin volver a migrar los datos.
 *
 * Anulable porque la enorme mayoría de las conversiones no traen ningún
 * parámetro —quien entra directo no tiene UTMs— y `NULL` es exactamente eso:
 * "no vino con atribución", que no es lo mismo que `{}`.
 *
 * **No es dato personal.** Un `utm_source=instagram` no identifica a nadie; es
 * de dónde salió el clic, no quién lo hizo. Por eso puede vivir junto a la
 * conversión y mostrarse en el panel. Los datos personales de la fila —nombre,
 * teléfono, email— siguen rigiéndose por lo de siempre: sólo dentro del panel
 * autenticado, nunca en logs.
 *
 * No se edita `20260516000001_init.ts` ni `20260823000000_turnos_registro.ts`:
 * están aplicadas y una migración aplicada no se reescribe.
 */

const TABLAS = ["appointments", "contact_messages"] as const;

export async function up(knex: Knex): Promise<void> {
  for (const tabla of TABLAS) {
    if (await knex.schema.hasColumn(tabla, "attribution")) continue;
    await knex.schema.alterTable(tabla, (t) => {
      // Sin `defaultTo`: el valor por defecto de una columna anulable es NULL,
      // y NULL es "esta conversión no trajo atribución".
      t.json("attribution").nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const tabla of TABLAS) {
    if (!(await knex.schema.hasColumn(tabla, "attribution"))) continue;
    await knex.schema.alterTable(tabla, (t) => {
      t.dropColumn("attribution");
    });
  }
}
