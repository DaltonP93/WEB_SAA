import type { Knex } from "knex";

/**
 * Horarios de atención administrables (item 18 de la minuta).
 *
 * La fase anterior publicó una tabla de horarios con valores de ejemplo. Los
 * horarios definitivos todavía no están confirmados por el sanatorio, así que:
 *
 *  - se crea la tabla `schedules` para cargarlos desde el panel (por área,
 *    servicio, días y tipo de atención);
 *  - se crean las filas de las áreas conocidas **sin horario** y desactivadas;
 *  - el bloque público muestra "Horarios en proceso de confirmación" mientras
 *    no haya filas activas.
 *
 * Nada de esto publica una hora que no haya confirmado el cliente.
 */

const AREAS: { key: string; area: string; note: string; order: number }[] = [
  { key: "emergencias", area: "Emergencias", note: "Guardia activa todos los días del año.", order: 0 },
  { key: "consultorios", area: "Consultorios externos", note: "", order: 1 },
  { key: "recepcion", area: "Recepción / admisión", note: "", order: 2 },
  { key: "laboratorio", area: "Laboratorio (extracciones)", note: "", order: 3 },
  { key: "imagenes", area: "Estudios por imágenes", note: "", order: 4 },
  { key: "retiro-estudios", area: "Retiro de resultados", note: "", order: 5 },
  { key: "visitas", area: "Visitas a internados", note: "", order: 6 },
];

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("schedules");
  if (!exists) {
    await knex.schema.createTable("schedules", (t) => {
      t.increments("id").primary();
      t.string("key", 64).notNullable().unique();
      /** Área o tipo de atención: "Consultorios externos", "Laboratorio"… */
      t.string("area", 191).notNullable();
      /** Slug opcional del servicio relacionado, para enlazar desde su página. */
      t.string("service_slug", 191).nullable();
      /** Días: "Lunes a viernes", "Sábados", "Todos los días". */
      t.string("days", 191).nullable();
      /** Horario: "07:00 a 19:00", "24 horas". Vacío = a confirmar. */
      t.string("hours", 191).nullable();
      t.string("note", 255).nullable();
      // Arranca inactivo: sólo se publica lo que el sanatorio confirme.
      t.boolean("active").notNullable().defaultTo(false);
      t.integer("order").notNullable().defaultTo(0);
      t.timestamp("created_at").defaultTo(knex.fn.now());
      t.timestamp("updated_at").defaultTo(knex.fn.now());
    });
  }

  for (const a of AREAS) {
    await knex("schedules")
      .insert({
        key: a.key,
        area: a.area,
        days: null,
        hours: null,
        note: a.note || null,
        active: false,
        order: a.order,
      })
      .onConflict("key")
      .ignore();
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("schedules");
}
