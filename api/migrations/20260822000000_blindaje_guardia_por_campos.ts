import type { Knex } from "knex";

/**
 * El blindaje del rollback de la guardia deja de depender de las marcas de
 * tiempo y pasa a comparar los campos de la fila.
 *
 * ## Qué estaba mal
 *
 * `20260821000000` reconoce la intervención del sanatorio por dos caminos: un
 * predicado absoluto sobre el estado publicable (`note`, `days`, `hours` y
 * `active`) y, para lo que ese predicado no ve —renombrar el área, borrar y
 * recrear—, una comparación de `created_at`/`updated_at` contra la fecha del
 * snapshot anterior.
 *
 * El segundo camino no funciona contra una edición real. El CRUD del panel
 * (`crudRouter`) escribía sólo las columnas del payload, así que un
 * `PUT /api/admin/schedules/:id` que cambia `area` dejaba `updated_at` como
 * estaba. La fila seguía "limpia" para el predicado absoluto y sus marcas de
 * tiempo seguían siendo las de la migración: **cero evidencia**, y el rollback
 * republicaba la nota sobre una fila que el sanatorio ya había editado.
 *
 * La prueba que cubría ese caso forzaba `updated_at` a una fecha futura desde
 * SQL. Eso demostraba que el mecanismo reacciona a una marca de tiempo movida,
 * no que la marca se mueva cuando alguien edita de verdad.
 *
 * ## Qué hace esta migración
 *
 * Registra una **huella de todos los campos mutables** de la fila —`id`,
 * `area`, `service_slug`, `days`, `hours`, `note`, `active`, `order`— y compara
 * contra ella al revertir. Cualquier diferencia es evidencia de intervención, y
 * con evidencia la nota legacy no vuelve.
 *
 * Las marcas de tiempo siguen en la huella, pero como señal **adicional** y por
 * igualdad exacta, no por orden: sirven para delatar un borrado y recreado que
 * hubiera reproducido los mismos valores. Si alguna vez dejan de actualizarse,
 * la comparación de campos sigue siendo suficiente por sí sola.
 *
 * ## Las dos ventanas de edición
 *
 * Una huella tomada al instalar sólo ve lo que pase **después**. La edición
 * anterior —entre `20260820000000` y este blindaje— ya está incorporada a la
 * huella y comparar contra ella daría "sin cambios" justamente en el caso
 * peligroso.
 *
 * Por eso el `up()` además compara la fila contra el **estado de fábrica**: lo
 * que `20260813000001_schedules.ts` creó para `emergencias`, con la nota ya
 * retirada por `20260820000000`. Si no coincide, alguien la editó antes de que
 * este blindaje existiera y queda marcado en el propio snapshot.
 *
 * Las dos ventanas juntas cubren toda la vida de la fila, y ninguna de las dos
 * mira el reloj.
 *
 * ## Por qué una migración nueva
 *
 * `20260820000000` y `20260821000000` están fusionadas y pueden estar aplicadas
 * en producción: editarlas cambiaría un archivo que la base ya registró. Ésta
 * es posterior, así que su `down()` corre **antes** que los dos, y desarma el
 * snapshot que gobierna la restauración automática dejándolo en
 * `motivo: "editada"`. Cuando los `down()` viejos corran, no van a tener nada
 * que restaurar.
 *
 * No se toca ni un dato del sanatorio: sólo el registro interno.
 */

const SNAPSHOT_KEY = "snapshot_blindaje_campos_guardia_20260822000000";
/** El snapshot que gobierna la restauración automática de la nota. */
const SNAPSHOT_ORIGINAL = "snapshot_nota_emergencias_20260820000000";
const CLAVE = "emergencias";

/**
 * Campos mutables de la fila que hacen evidencia de intervención.
 *
 * `key` no está porque es el criterio de búsqueda: cambiarla hace que la fila
 * no aparezca, y eso ya se trata como fila ausente.
 */
const CAMPOS = ["area", "service_slug", "days", "hours", "note", "active", "order"] as const;

/**
 * Estado de fábrica de `emergencias` una vez retirada la nota.
 *
 * Son los valores que deja `20260813000001_schedules.ts` (área, orden y el
 * resto en vacío) con `note` ya limpiado por `20260820000000`. Se escriben acá
 * como constante y no se leen de aquella migración: una migración es un archivo
 * histórico, no una fuente de la que otros importen.
 */
const DE_FABRICA: Record<string, unknown> = {
  area: "Emergencias",
  service_slug: null,
  days: null,
  hours: null,
  note: null,
  active: false,
  order: 0,
};

interface Huella {
  id: number | null;
  campos: Record<string, unknown>;
  /** Señal adicional: delata un borrado y recreado con los mismos valores. */
  creada: number | null;
  actualizada: number | null;
}

interface Snapshot {
  createdAt: string;
  /** `null` cuando la fila no existía al instalar. */
  huella: Huella | null;
  /** ¿La fila estaba tal como la dejaron las migraciones? */
  deFabricaAlInstalar: boolean;
}

/** `null`, `undefined` y `""` son lo mismo para comparar: campo sin cargar. */
const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const marca = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Normaliza un campo para comparar sin depender del motor (0/1 vs false/true). */
function normalizar(campo: string, valor: unknown): unknown {
  if (campo === "active") return Boolean(valor);
  if (campo === "order") return valor === null || valor === undefined ? null : Number(valor);
  return texto(valor);
}

function huellaDe(fila: Record<string, unknown> | undefined): Huella | null {
  if (!fila) return null;
  const campos: Record<string, unknown> = {};
  for (const campo of CAMPOS) campos[campo] = normalizar(campo, fila[campo]);
  return {
    id: fila.id === null || fila.id === undefined ? null : Number(fila.id),
    campos,
    creada: marca(fila.created_at),
    actualizada: marca(fila.updated_at),
  };
}

/** ¿La fila coincide con el estado que dejaron las migraciones? */
function esDeFabrica(fila: Record<string, unknown> | undefined): boolean {
  if (!fila) return false;
  return CAMPOS.every(
    (campo) => normalizar(campo, fila[campo]) === normalizar(campo, DE_FABRICA[campo]),
  );
}

/** ¿La fila de hoy es la misma, campo por campo, que la registrada al instalar? */
function coincide(actual: Huella | null, registrada: Huella | null | undefined): boolean {
  if (!actual || !registrada) return false;
  if (actual.id !== registrada.id) return false;
  // Una huella vieja sin algún campo no puede dar "igual" por omisión.
  const campos = registrada.campos ?? {};
  for (const campo of CAMPOS) {
    if (!Object.prototype.hasOwnProperty.call(campos, campo)) return false;
    if (actual.campos[campo] !== campos[campo]) return false;
  }
  return actual.creada === registrada.creada && actual.actualizada === registrada.actualizada;
}

const leerSnapshot = (row: { value: unknown } | undefined): any => {
  if (!row) return null;
  if (typeof row.value !== "string") return row.value;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
};

export async function up(knex: Knex): Promise<void> {
  // Idempotente: la huella buena es la primera, no se pisa con una posterior
  // que ya incluiría las ediciones que se quieren detectar.
  const yaCorrio = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (yaCorrio) return;

  const fila = await knex("schedules").where({ key: CLAVE }).first();
  const snapshot: Snapshot = {
    createdAt: new Date().toISOString(),
    huella: huellaDe(fila),
    deFabricaAlInstalar: esDeFabrica(fila),
  };
  await knex("settings").insert({ key: SNAPSHOT_KEY, value: JSON.stringify(snapshot) });
}

export async function down(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (!row) return;

  const snapshot: Snapshot | null = leerSnapshot(row);
  const fila = await knex("schedules").where({ key: CLAVE }).first();

  // Tres motivos para desarmar la restauración, y basta con uno:
  //  · la fila ya no está (borrada, o su `key` cambió);
  //  · algún campo cambió desde que se instaló este blindaje;
  //  · no estaba en el estado de fábrica cuando se instaló, o sea que la
  //    editaron antes, entre la migración correctiva y este blindaje.
  //
  // Sin snapshot legible tampoco se puede afirmar que nadie la tocó: se
  // desarma igual. Fallar cerrado es la única postura defendible cuando lo
  // que está en juego es republicar una afirmación médica no confirmada.
  const hayEvidencia =
    !snapshot ||
    !fila ||
    !snapshot.deFabricaAlInstalar ||
    !coincide(huellaDe(fila), snapshot.huella);

  if (hayEvidencia) {
    const anterior = await knex("settings").where({ key: SNAPSHOT_ORIGINAL }).first();
    const valor = leerSnapshot(anterior);
    if (valor && valor.motivo === "limpiada") {
      await knex("settings")
        .where({ key: SNAPSHOT_ORIGINAL })
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
