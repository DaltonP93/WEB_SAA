import type { Knex } from "knex";

/**
 * Retira la nota no confirmada de la fila `schedules.emergencias`.
 *
 * La fila quedó desde `20260813000001_schedules.ts` con la nota
 * "Guardia activa todos los días del año." y sin días ni horario. Es una
 * afirmación institucional sobre la cobertura de la guardia que el sanatorio
 * nunca confirmó, y afirmar que hay guardia 24/7 cuando no está verificado es
 * exactamente el tipo de dato que este proyecto viene sacando del sitio.
 *
 * Hoy no llega al público —el endpoint filtra por `active` y por `hours`
 * cargado—, pero está a un clic de publicarse: alcanza con que alguien marque
 * la fila como activa y cargue un horario para que la nota salga con él.
 *
 * ## Por qué no borra siempre
 *
 * Sólo limpia el caso que se puede identificar como "nadie tocó esto": la nota
 * exacta que dejó la migración, la fila inactiva y los campos de días y horario
 * vacíos. Cualquier otra combinación significa que alguien la editó, y una
 * migración correctiva que pisa contenido del cliente es peor que la nota que
 * viene a corregir. Esos casos se registran en el snapshot con
 * `motivo: "editada"` para que se revisen a mano.
 *
 * ## Reversibilidad
 *
 * El `down()` restaura la nota **sólo si el campo sigue vacío**. Si el
 * sanatorio escribió su propia nota después de que esta migración corriera,
 * revertir no puede pisarla: la reversión devuelve el estado anterior, no lo
 * sobrescribe.
 */

const SNAPSHOT_KEY = "snapshot_nota_emergencias_20260820000000";
const CLAVE = "emergencias";

/** La nota exacta que dejó `20260813000001_schedules.ts`. */
const NOTA_LEGACY = "Guardia activa todos los días del año.";

interface Snapshot {
  createdAt: string;
  /** Qué se hizo con la fila y por qué. */
  motivo: "limpiada" | "editada" | "ausente";
  /** El valor anterior, para poder restaurarlo. `null` si no se tocó nada. */
  notaAnterior: string | null;
}

const vacio = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === "";

export async function up(knex: Knex): Promise<void> {
  // Idempotente: si ya corrió, no vuelve a mirar nada.
  const yaCorrio = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (yaCorrio) return;

  const fila = await knex("schedules").where({ key: CLAVE }).first();

  let snapshot: Snapshot;

  if (!fila) {
    snapshot = { createdAt: new Date().toISOString(), motivo: "ausente", notaAnterior: null };
  } else if (
    String(fila.note ?? "").trim() === NOTA_LEGACY &&
    !fila.active &&
    vacio(fila.days) &&
    vacio(fila.hours)
  ) {
    // El caso limpio: nadie tocó la fila desde que la migración la creó.
    snapshot = { createdAt: new Date().toISOString(), motivo: "limpiada", notaAnterior: String(fila.note) };
    await knex("schedules").where({ key: CLAVE }).update({ note: null, updated_at: knex.fn.now() });
  } else {
    // Hay evidencia de carga posterior: no se toca. Queda identificable.
    snapshot = {
      createdAt: new Date().toISOString(),
      motivo: "editada",
      notaAnterior: fila.note === null || fila.note === undefined ? null : String(fila.note),
    };
  }

  await knex("settings").insert({ key: SNAPSHOT_KEY, value: JSON.stringify(snapshot) });
}

export async function down(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (!row) return;

  const snapshot: Snapshot = typeof row.value === "string" ? JSON.parse(row.value) : row.value;

  if (snapshot.motivo === "limpiada" && snapshot.notaAnterior !== null) {
    const fila = await knex("schedules").where({ key: CLAVE }).first();
    // Restaurar sólo sobre el vacío que dejó el `up()`. Si el sanatorio cargó
    // su propia nota mientras tanto, revertir esta migración no puede borrarla.
    if (fila && vacio(fila.note)) {
      await knex("schedules").where({ key: CLAVE }).update({ note: snapshot.notaAnterior, updated_at: knex.fn.now() });
    }
  }

  await knex("settings").where({ key: SNAPSHOT_KEY }).del();
}
