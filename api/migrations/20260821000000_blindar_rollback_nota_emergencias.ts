import type { Knex } from "knex";

/**
 * Impide que el rollback de `20260820000000` republique la nota de la guardia.
 *
 * Aquella migración retiró de `schedules.emergencias` la nota
 * "Guardia activa todos los días del año." —una afirmación sobre la cobertura
 * de la guardia que el sanatorio nunca confirmó— y dejó un `down()` capaz de
 * restaurarla. Ese `down()` sólo comprueba **una** cosa antes de escribir: que
 * el campo `note` esté vacío.
 *
 * Eso no alcanza. Entre el `up()` y un eventual rollback, la fila puede haber
 * cambiado de forma que restaurar la nota deje de ser inocuo:
 *
 *   · se cargaron `days` u `hours`;
 *   · se activó la fila;
 *   · se borró y se volvió a crear;
 *   · se editó cualquier otro campo.
 *
 * El caso peligroso es concreto: el sanatorio carga el horario real de la
 * guardia y activa la fila —sin escribir ninguna nota, porque no hace falta—.
 * La fila pasa a ser publicable. Un rollback posterior encuentra `note` vacío,
 * cumple la única condición que el `down()` viejo mira, y **publica la
 * afirmación no confirmada junto al horario real**.
 *
 * ## Cómo se blinda sin editar la migración fusionada
 *
 * `20260820000000` ya está fusionada y puede estar aplicada en producción:
 * editarla cambiaría el archivo bajo una base que ya la registró. En cambio
 * esta migración es **posterior**, así que en un rollback su `down()` corre
 * **antes** que el de aquella. Eso alcanza para desarmarla: el `down()` viejo
 * sólo restaura si su snapshot dice `motivo: "limpiada"` y trae `notaAnterior`.
 * Si acá se detecta evidencia de edición posterior, se reescribe ese snapshot
 * como `"editada"` con `notaAnterior: null`, y cuando el `down()` viejo corra
 * no va a tener nada que restaurar.
 *
 * No se toca ni un dato del sanatorio: sólo el registro interno que gobierna
 * una restauración automática.
 */

const SNAPSHOT_KEY = "snapshot_blindaje_guardia_20260821000000";
/** El snapshot de la migración que se está blindando. */
const SNAPSHOT_ANTERIOR = "snapshot_nota_emergencias_20260820000000";
const CLAVE = "emergencias";

interface Snapshot {
  createdAt: string;
  /** El id de la fila al instalar el blindaje: si cambia, la recrearon. */
  filaId: number | null;
  /** Estado en que se encontró la fila, sólo para auditoría. */
  estabaLimpia: boolean;
}

const vacio = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === "";

/**
 * ¿La fila sigue en el estado que hizo inocuo limpiar la nota?
 *
 * Es un predicado **absoluto**, no un diff contra el momento en que este
 * blindaje se instaló. Esa distinción es la que hace que funcione: entre que la
 * migración vieja limpió la nota y que este blindaje se aplicó pueden haber
 * pasado semanas y varias ediciones del sanatorio. Comparar contra el estado
 * "al instalar" habría dado "sin cambios" justamente en el caso peligroso —el
 * horario ya cargado antes de que el blindaje existiera— y habría dejado pasar
 * la restauración.
 *
 * Las condiciones son las mismas que `20260820000000` exigió para limpiar: si
 * alguna dejó de cumplirse, restaurar ya no es devolver el estado anterior.
 */
function siguePudiendoRestaurarse(fila: Record<string, unknown> | undefined): boolean {
  if (!fila) return false;
  return vacio(fila.note) && vacio(fila.days) && vacio(fila.hours) && !fila.active;
}

/**
 * ¿La fila se tocó después de que la nota se limpió?
 *
 * Cubre las ediciones que no cambian el estado publicable pero sí evidencian
 * intervención: renombrar el área, o borrar la fila y recrearla. En los dos
 * casos la fila queda "limpia" según el predicado de arriba, así que sin mirar
 * las marcas de tiempo pasarían por intactas.
 *
 * El margen absorbe que `created_at`/`updated_at` son TIMESTAMP —precisión de
 * segundo— y que la propia migración vieja escribe `updated_at` al limpiar.
 */
function tocadaDespuesDe(fila: Record<string, unknown> | undefined, isoReferencia: unknown): boolean {
  if (!fila || typeof isoReferencia !== "string") return false;
  const referencia = Date.parse(isoReferencia);
  if (!Number.isFinite(referencia)) return false;
  const margen = 1000;
  for (const campo of ["created_at", "updated_at"] as const) {
    const valor = fila[campo];
    const t = valor ? new Date(valor as string).getTime() : NaN;
    if (Number.isFinite(t) && t > referencia + margen) return true;
  }
  return false;
}

const leerSnapshot = (row: { value: unknown } | undefined): any =>
  !row ? null : typeof row.value === "string" ? JSON.parse(row.value as string) : row.value;

export async function up(knex: Knex): Promise<void> {
  // Idempotente: si ya corrió, la huella registrada es la buena y no se pisa.
  const yaCorrio = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (yaCorrio) return;

  const fila = await knex("schedules").where({ key: CLAVE }).first();
  const snapshot: Snapshot = {
    createdAt: new Date().toISOString(),
    filaId: fila ? Number(fila.id) : null,
    estabaLimpia: siguePudiendoRestaurarse(fila),
  };
  await knex("settings").insert({ key: SNAPSHOT_KEY, value: JSON.stringify(snapshot) });
}

export async function down(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (!row) return;

  const snapshot: Snapshot = leerSnapshot(row);
  const fila = await knex("schedules").where({ key: CLAVE }).first();
  const anterior = await knex("settings").where({ key: SNAPSHOT_ANTERIOR }).first();
  const valor = leerSnapshot(anterior);

  // Cuatro motivos para desarmar, y basta con uno:
  //  · la fila ya no está en el estado que hacía inocua la restauración;
  //  · la borraron y la recrearon después de instalar el blindaje;
  //  · ya no estaba limpia cuando el blindaje se instaló;
  //  · sus marcas de tiempo son posteriores a la limpieza original.
  const hayEvidencia =
    !siguePudiendoRestaurarse(fila) ||
    (snapshot.filaId !== null && fila && Number(fila.id) !== snapshot.filaId) ||
    !snapshot.estabaLimpia ||
    tocadaDespuesDe(fila, valor?.createdAt);

  if (hayEvidencia) {
    // Se desarma la restauración automática de `20260820000000`, que va a
    // correr inmediatamente después de este `down()`.
    if (valor && valor.motivo === "limpiada") {
      await knex("settings")
        .where({ key: SNAPSHOT_ANTERIOR })
        .update({
          value: JSON.stringify({
            ...valor,
            motivo: "editada",
            notaAnterior: null,
            neutralizadoPor: SNAPSHOT_KEY,
            neutralizadoEn: new Date().toISOString(),
          }),
          updated_at: knex.fn.now(),
        });
    }
  }

  await knex("settings").where({ key: SNAPSHOT_KEY }).del();
}
