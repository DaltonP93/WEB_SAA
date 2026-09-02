import type { Knex } from "knex";

/**
 * Setea el favicon institucional por defecto (asset estático servido en
 * /favicon.png, ver apps/web/public/) cuando settings.brand.faviconUrl todavía
 * está vacío. Reemplaza el ícono genérico de la pestaña por el isotipo real del
 * sanatorio. No pisa un favicon que el sanatorio ya haya cargado a mano.
 *
 * ## Por qué esta migración lleva snapshot (excepción autorizada)
 *
 * Igual que `20260827000000_brand_logo`, la primera versión de esta migración
 * **creaba** la fila `settings.brand` si no existía pero su `down()` sólo la
 * **vaciaba** (`faviconUrl → ""`), dejando un residuo `{ ..., faviconUrl: "" }`
 * que en el estado anterior no estaba. La corrección por heurística de contenido
 * se descartó (una coincidencia con los valores por defecto no prueba
 * procedencia). La corrección real registra **procedencia** con un snapshot
 * interno: `up()` guarda el estado previo exacto antes de tocar la base y `down()`
 * restaura sólo lo que esta migración escribió. Editar estas dos migraciones ya
 * fusionadas se hizo bajo autorización explícita y acotada del propietario.
 *
 * ## Contrato del snapshot
 *
 * Clave interna `snapshot_brand_favicon_20260828000000` (prefijo `snapshot_`:
 * fuera de `PUBLIC_SETTING_KEYS`/`ADMIN_SETTING_KEYS`, no publicada ni editable
 * desde el CMS). Registra formato, migración, propiedad, si la fila existía, si
 * tenía forma inesperada, si la propiedad existía, su valor anterior exacto
 * (ausente / null / "" / default / personalizado), si aplicó cambio y qué valor
 * aplicó. Se guarda aunque no haga falta cambiar nada, no se sobrescribe si ya
 * existe, y se elimina recién tras un rollback exitoso. Si no puede guardarse, no
 * se modifica `settings.brand`.
 *
 * A diferencia del logo, el `down()` del favicon **nunca borra la fila**
 * `settings.brand`: sólo restaura o elimina su propia propiedad. Quitar la fila
 * cuando ya no queda nada es responsabilidad exclusiva del `down()` del logo, que
 * corre después (LIFO) y es dueño de la creación original de la fila.
 *
 * ## Instalaciones migradas antes de esta corrección (fail-closed)
 *
 * Si esta migración figura aplicada pero su snapshot no existe (base migrada con
 * el código viejo), `down()` **aborta antes de tocar datos**: no vacía el favicon
 * ni la fila, y remite a restaurar un backup verificado o a un procedimiento
 * manual autorizado. No hay fallback heurístico.
 */

const BRAND_KEY = "brand";
const PROP = "faviconUrl";
const DEFAULT_VALUE = "/favicon.png";
const SNAPSHOT_KEY = "snapshot_brand_favicon_20260828000000";
const MIGRACION = "20260828000000_brand_favicon.ts";
const FORMATO = 1;

type BrandObject = Record<string, unknown>;

interface BrandSnapshot {
  formato: number;
  migracion: string;
  propiedad: string;
  /** ¿Existía la fila `settings.brand` antes del `up()` de esta migración? */
  filaExistia: boolean;
  /** La fila existía pero su valor no era un objeto JSON (no se toca). */
  formaInesperada: boolean;
  /** ¿Existía la clave de la propiedad dentro del objeto brand? */
  propiedadExistia: boolean;
  /** Valor exacto anterior de la propiedad (null si no existía o forma inesperada). */
  valorAnterior: unknown;
  /** ¿El `up()` realmente escribió el default? */
  aplicoCambio: boolean;
  /** Valor que el `up()` aplicó, o null si no aplicó ninguno. */
  valorAplicado: string | null;
}

/** MySQL 8 devuelve las columnas JSON ya parseadas; otros motores, string. */
function leerValor(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined; // no es JSON válido
  }
}

function esObjeto(v: unknown): v is BrandObject {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Lee y valida un snapshot; null si falta contenido válido de un snapshot. */
function leerSnapshot(value: unknown): BrandSnapshot | null {
  const parsed = leerValor(value);
  if (!esObjeto(parsed)) return null;
  const s = parsed as Partial<BrandSnapshot>;
  if (
    typeof s.formato !== "number" ||
    typeof s.filaExistia !== "boolean" ||
    typeof s.propiedadExistia !== "boolean" ||
    typeof s.aplicoCambio !== "boolean"
  ) {
    return null;
  }
  return parsed as unknown as BrandSnapshot;
}

export async function up(knex: Knex): Promise<void> {
  // 1. Leer la fila y la propiedad ANTES de cualquier escritura.
  const filaRaw = await knex("settings").where({ key: BRAND_KEY }).first();
  const filaExistia = filaRaw !== undefined;
  const valorFila = filaExistia ? leerValor(filaRaw.value) : undefined;
  const brand = esObjeto(valorFila) ? valorFila : null;
  const formaInesperada = filaExistia && brand === null;
  const propiedadExistia = brand !== null && Object.prototype.hasOwnProperty.call(brand, PROP);
  const valorAnterior = propiedadExistia ? (brand as BrandObject)[PROP] : null;

  const debeAplicar = !formaInesperada && !(brand && (brand as BrandObject)[PROP]);

  const snapshot: BrandSnapshot = {
    formato: FORMATO,
    migracion: MIGRACION,
    propiedad: PROP,
    filaExistia,
    formaInesperada,
    propiedadExistia,
    valorAnterior,
    aplicoCambio: debeAplicar,
    valorAplicado: debeAplicar ? DEFAULT_VALUE : null,
  };

  // 2. Guardar el snapshot ANTES de tocar brand, sin pisarlo si ya existe.
  const snapPrevio = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (!snapPrevio) {
    await knex("settings").insert({ key: SNAPSHOT_KEY, value: JSON.stringify(snapshot) });
  }

  // 3. Aplicar el default sólo si corresponde; preservar cualquier clave ajena.
  if (debeAplicar) {
    const next = { ...(brand ?? {}), [PROP]: DEFAULT_VALUE };
    await knex("settings")
      .insert({ key: BRAND_KEY, value: JSON.stringify(next) })
      .onConflict("key")
      .merge({ value: JSON.stringify(next), updated_at: knex.fn.now() });
  }
}

export async function down(knex: Knex): Promise<void> {
  const snapRow = await knex("settings").where({ key: SNAPSHOT_KEY }).first();

  // Fail-closed: aplicada sin snapshot => base migrada antes de la corrección.
  if (!snapRow) {
    throw new Error(
      `rollback de ${MIGRACION} sin snapshot ("${SNAPSHOT_KEY}"): la migración ` +
        `figura aplicada pero fue corrida antes de la corrección del rollback de ` +
        `marca. No se vacía el favicon ni se borra settings.brand. Para cruzar ` +
        `este punto restaurá un backup verificado o realizá un procedimiento ` +
        `manual autorizado.`,
    );
  }

  const snapshot = leerSnapshot(snapRow.value);
  if (!snapshot || snapshot.formato !== FORMATO) {
    throw new Error(
      `rollback de ${MIGRACION}: el snapshot "${SNAPSHOT_KEY}" es inválido o de una ` +
        `versión desconocida (esperado formato ${FORMATO}). No se modifica la marca; ` +
        `restaurá un backup verificado o procedé manualmente.`,
    );
  }

  if (snapshot.aplicoCambio) {
    const filaRaw = await knex("settings").where({ key: BRAND_KEY }).first();
    const valorFila = filaRaw ? leerValor(filaRaw.value) : undefined;
    const brand = esObjeto(valorFila) ? { ...valorFila } : null;

    // Restaurar sólo si la propiedad conserva EXACTAMENTE lo que esta migración
    // aplicó; si se personalizó después, se preserva. El favicon nunca borra la
    // fila: eso es responsabilidad del down() del logo.
    if (brand && brand[PROP] === snapshot.valorAplicado) {
      if (snapshot.propiedadExistia) {
        brand[PROP] = snapshot.valorAnterior; // restaura null / "" / valor exacto
      } else {
        delete brand[PROP]; // no existía antes: se elimina sólo esa propiedad
      }
      await knex("settings")
        .where({ key: BRAND_KEY })
        .update({ value: JSON.stringify(brand), updated_at: knex.fn.now() });
    }
  }

  // Éxito: eliminar únicamente el snapshot correspondiente.
  await knex("settings").where({ key: SNAPSHOT_KEY }).del();
}
