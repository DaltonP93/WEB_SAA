import type { Knex } from "knex";

/**
 * Setea el logo institucional por defecto (asset estático servido en
 * /logo-sanatorio.png, ver apps/web/public/) cuando settings.brand.logoUrl
 * todavía está vacío. No pisa un logo que el sanatorio ya haya cargado a mano
 * desde el admin.
 *
 * ## Por qué esta migración lleva snapshot (excepción autorizada)
 *
 * La primera versión de esta migración **creaba** la fila `settings.brand`
 * cuando no existía (`insert ... onConflict.merge`), pero su `down()` sólo la
 * **actualizaba** vaciando el campo (`logoUrl → ""`); nunca la borraba. Sobre
 * una base donde `brand` no existía —una instalación migrada pero sin sembrar,
 * como la de `tests/migrations.test.ts`— revertir la cadena dejaba una fila
 * residual `{ logoUrl: "", faviconUrl: "" }` que en el estado anterior no
 * estaba, y el snapshot de esa prueba lo detectaba: el rollback dejaba de ser
 * exacto.
 *
 * Se probó una corrección por heurística de contenido (una migración posterior
 * que borraba la fila si "parecía" autogenerada por coincidir con los valores
 * por defecto). Se **descartó**: una coincidencia de contenido no prueba
 * procedencia. Una fila legítima, preexistente, con exactamente
 * `{ logoUrl: "/logo-sanatorio.png", faviconUrl: "/favicon.png" }` es
 * indistinguible por contenido de una autogenerada, y la heurística la habría
 * borrado.
 *
 * La corrección real registra **procedencia**, no contenido: antes de tocar la
 * base, `up()` guarda un snapshot interno con el estado previo exacto y si esta
 * migración realmente aplicó un cambio. `down()` restaura a partir de ese
 * snapshot y sólo actúa sobre lo que ella misma escribió. Editar estas dos
 * migraciones ya fusionadas (logo y favicon) se hizo bajo una autorización
 * explícita y acotada del propietario, exclusivamente para esta corrección.
 *
 * ## Contrato del snapshot
 *
 * Clave interna `snapshot_brand_logo_20260827000000` (prefijo `snapshot_`, así
 * queda fuera de `PUBLIC_SETTING_KEYS`/`ADMIN_SETTING_KEYS`: no se publica ni se
 * edita desde el CMS). Registra: versión de formato, nombre de la migración, la
 * propiedad afectada, si la fila existía, si tenía forma inesperada, si la
 * propiedad existía, su valor anterior exacto (distinguiendo ausente / null /
 * "" / default / personalizado), si se aplicó un cambio y qué valor se aplicó.
 * Se guarda **aunque no haga falta cambiar nada**, no se sobrescribe si ya
 * existe, y se elimina recién tras un rollback exitoso. Si el snapshot no puede
 * guardarse, no se modifica `settings.brand` (la transacción de la migración
 * revierte).
 *
 * ## Instalaciones migradas antes de esta corrección (fail-closed)
 *
 * En una base donde esta migración ya figuraba aplicada, Knex no reejecuta el
 * `up()` nuevo, así que el snapshot no existe. En ese caso `down()` **aborta
 * antes de tocar datos**: no vacía el logo, no borra la fila, y explica que para
 * cruzar ese punto hace falta restaurar un backup verificado o un procedimiento
 * manual autorizado. No hay fallback heurístico.
 */

const BRAND_KEY = "brand";
const PROP = "logoUrl";
const DEFAULT_VALUE = "/logo-sanatorio.png";
const SNAPSHOT_KEY = "snapshot_brand_logo_20260827000000";
const MIGRACION = "20260827000000_brand_logo.ts";
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

  // Contrato original: aplicar el default sólo si la propiedad no tiene ya un
  // valor con sentido (truthy). Nunca sobre una forma inesperada.
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

  // 2. Guardar el snapshot ANTES de tocar brand, sin pisarlo si ya existe. Si el
  //    insert falla, la transacción de la migración revierte y brand no cambia.
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

  // Fail-closed: esta migración figura aplicada (por eso corre su down()), pero
  // no hay snapshot. Es una instalación migrada antes de esta corrección: no hay
  // información para un rollback exacto. Abortar SIN tocar datos.
  if (!snapRow) {
    throw new Error(
      `rollback de ${MIGRACION} sin snapshot ("${SNAPSHOT_KEY}"): la migración ` +
        `figura aplicada pero fue corrida antes de la corrección del rollback de ` +
        `marca. No se vacía el logo ni se borra settings.brand. Para cruzar este ` +
        `punto restaurá un backup verificado o realizá un procedimiento manual ` +
        `autorizado.`,
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
    // aplicó. Si se personalizó después (o la fila cambió de forma / se borró),
    // se preserva lo que haya.
    if (brand && brand[PROP] === snapshot.valorAplicado) {
      if (snapshot.propiedadExistia) {
        brand[PROP] = snapshot.valorAnterior; // restaura null / "" / valor exacto
      } else {
        delete brand[PROP]; // no existía antes: se elimina sólo esa propiedad
      }
      await knex("settings")
        .where({ key: BRAND_KEY })
        .update({ value: JSON.stringify(brand), updated_at: knex.fn.now() });

      // Cláusula exclusiva del logo: eliminar la fila `settings.brand` sólo si el
      // snapshot demuestra que NO existía originalmente y ya no queda ninguna
      // propiedad. Nunca se borra una fila preexistente ni una con claves
      // agregadas después.
      if (!snapshot.filaExistia && Object.keys(brand).length === 0) {
        await knex("settings").where({ key: BRAND_KEY }).del();
      }
    }
  }

  // Éxito: eliminar únicamente el snapshot correspondiente.
  await knex("settings").where({ key: SNAPSHOT_KEY }).del();
}
