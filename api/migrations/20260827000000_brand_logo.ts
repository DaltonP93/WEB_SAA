import type { Knex } from "knex";

/**
 * Setea el logo institucional por defecto (asset estático servido en
 * /logo-sanatorio.png, ver apps/web/public/) cuando settings.brand.logoUrl
 * todavía está vacío. No pisa un logo que el sanatorio ya haya cargado a mano.
 *
 * ## Por qué esta migración lleva snapshot (excepción autorizada)
 *
 * La primera versión creaba la fila `settings.brand` en `up()` pero su `down()`
 * sólo la vaciaba; nunca la borraba, dejando un residuo sobre una base migrada
 * sin sembrar. Una corrección por heurística de contenido se descartó (una
 * coincidencia con los valores por defecto no prueba procedencia). La corrección
 * real registra **procedencia** con un snapshot interno: antes de tocar la base,
 * `up()` guarda el estado previo exacto y si realmente aplicó un cambio; `down()`
 * restaura a partir de ese snapshot y sólo lo que ella misma escribió. Editar
 * estas dos migraciones ya fusionadas se hizo bajo autorización explícita y
 * acotada del propietario.
 *
 * ## Contrato del snapshot (formato 1, estructura cerrada)
 *
 * Clave interna `snapshot_brand_logo_20260827000000` (prefijo `snapshot_`,
 * `varchar(64)`, fuera de `PUBLIC_SETTING_KEYS`/`ADMIN_SETTING_KEYS`: no se
 * publica ni se edita desde el CMS). El snapshot es un objeto con **exactamente**
 * estos campos (ni más ni menos): `formato`, `migracion`, `propiedad`,
 * `filaExistia`, `formaInesperada`, `propiedadExistia`, `valorAnterior`,
 * `aplicoCambio`, `valorAplicado`. Se valida **estrictamente** —tipos exactos,
 * pertenencia a esta migración/propiedad y coherencia interna— antes de confiar
 * en él; nunca se hace un cast al tipo completo tras validar sólo algunos campos.
 * Se guarda aunque no haga falta cambiar nada, no se sobrescribe si ya existe, y
 * se elimina recién tras un rollback exitoso. Si no puede guardarse, `up()` no
 * modifica `settings.brand`.
 *
 * ## Fail-closed en instalaciones migradas antes de esta corrección
 *
 * Si esta migración figura aplicada pero su snapshot está ausente, es inválido o
 * de una versión desconocida, `down()` **aborta antes de tocar datos** (no vacía
 * el logo, no borra la fila) y remite a restaurar un backup **anterior a estas
 * migraciones** o a un procedimiento manual autorizado. No hay fallback
 * heurístico. El preflight `scripts/deploy/brand-snapshot-preflight.mjs` adelanta
 * ese bloqueo a antes del primer `migrate:down` de un rollback múltiple.
 */

const BRAND_KEY = "brand";
const PROP = "logoUrl";
const DEFAULT_VALUE = "/logo-sanatorio.png";
const SNAPSHOT_KEY = "snapshot_brand_logo_20260827000000";
const MIGRACION = "20260827000000_brand_logo.ts";
const FORMATO = 1;

/** Los únicos campos que un snapshot de formato 1 puede tener. */
const CAMPOS = [
  "formato",
  "migracion",
  "propiedad",
  "filaExistia",
  "formaInesperada",
  "propiedadExistia",
  "valorAnterior",
  "aplicoCambio",
  "valorAplicado",
] as const;

type BrandObject = Record<string, unknown>;

interface BrandSnapshot {
  formato: number;
  migracion: string;
  propiedad: string;
  filaExistia: boolean;
  formaInesperada: boolean;
  propiedadExistia: boolean;
  valorAnterior: unknown;
  aplicoCambio: boolean;
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

/**
 * Validación estricta del snapshot. Lanza un error (mensaje seguro, sin PII) ante
 * cualquier desvío: estructura no cerrada, tipo inválido, pertenencia a otra
 * migración/propiedad, o combinación de procedencia imposible. Sólo si TODO pasa
 * construye el objeto tipado a partir de los valores ya validados —nunca un cast
 * del objeto crudo—.
 */
function validarSnapshot(value: unknown): BrandSnapshot {
  const o = leerValor(value);
  if (!esObjeto(o)) {
    throw new Error(`${MIGRACION}: snapshot inválido — "${SNAPSHOT_KEY}" no es un objeto JSON.`);
  }
  const claves = Object.keys(o);
  const faltan = CAMPOS.filter((k) => !Object.prototype.hasOwnProperty.call(o, k));
  const sobran = claves.filter((k) => !(CAMPOS as readonly string[]).includes(k));
  if (faltan.length > 0 || sobran.length > 0) {
    throw new Error(
      `${MIGRACION}: snapshot inválido — estructura inesperada (faltan: ${faltan.join(",") || "-"}; ` +
        `sobran: ${sobran.join(",") || "-"}).`,
    );
  }
  if (o.formato !== FORMATO) {
    throw new Error(`${MIGRACION}: snapshot inválido — formato desconocido (esperado ${FORMATO}).`);
  }
  if (o.migracion !== MIGRACION) {
    throw new Error(`${MIGRACION}: snapshot inválido — pertenece a otra migración.`);
  }
  if (o.propiedad !== PROP) {
    throw new Error(`${MIGRACION}: snapshot inválido — pertenece a otra propiedad.`);
  }
  const esBool = (v: unknown): v is boolean => typeof v === "boolean";
  if (!esBool(o.filaExistia) || !esBool(o.formaInesperada) || !esBool(o.propiedadExistia) || !esBool(o.aplicoCambio)) {
    throw new Error(`${MIGRACION}: snapshot inválido — banderas con tipo no booleano.`);
  }
  const { filaExistia, formaInesperada, propiedadExistia, aplicoCambio, valorAnterior, valorAplicado } = o as {
    filaExistia: boolean;
    formaInesperada: boolean;
    propiedadExistia: boolean;
    aplicoCambio: boolean;
    valorAnterior: unknown;
    valorAplicado: unknown;
  };

  // `valorAplicado` está atado a `aplicoCambio`.
  if (aplicoCambio) {
    if (valorAplicado !== DEFAULT_VALUE) {
      throw new Error(`${MIGRACION}: snapshot inválido — valorAplicado incoherente con aplicoCambio=true.`);
    }
  } else if (valorAplicado !== null) {
    throw new Error(`${MIGRACION}: snapshot inválido — valorAplicado debe ser null con aplicoCambio=false.`);
  }

  // Coherencia de procedencia: reconstruye los estados que `up()` puede producir.
  if (formaInesperada) {
    if (!(filaExistia && !propiedadExistia && valorAnterior === null && !aplicoCambio)) {
      throw new Error(`${MIGRACION}: snapshot inválido — combinación imposible con formaInesperada=true.`);
    }
  } else if (!filaExistia) {
    if (!(!propiedadExistia && valorAnterior === null && aplicoCambio)) {
      throw new Error(`${MIGRACION}: snapshot inválido — combinación imposible con filaExistia=false.`);
    }
  } else if (!propiedadExistia) {
    if (!(valorAnterior === null && aplicoCambio)) {
      throw new Error(`${MIGRACION}: snapshot inválido — combinación imposible con propiedadExistia=false.`);
    }
  } else if (aplicoCambio) {
    // Propiedad presente y se aplicó el default ⇒ el valor previo era falsy.
    if (!(valorAnterior === null || valorAnterior === "")) {
      throw new Error(`${MIGRACION}: snapshot inválido — valorAnterior debe ser null o "" (propiedad presente, aplicoCambio=true).`);
    }
  } else {
    // Propiedad presente y no se aplicó nada ⇒ el valor previo era truthy.
    if (!(typeof valorAnterior === "string" && valorAnterior.length > 0)) {
      throw new Error(`${MIGRACION}: snapshot inválido — valorAnterior debe ser un string no vacío (aplicoCambio=false).`);
    }
  }

  return {
    formato: FORMATO,
    migracion: MIGRACION,
    propiedad: PROP,
    filaExistia,
    formaInesperada,
    propiedadExistia,
    valorAnterior,
    aplicoCambio,
    valorAplicado: (valorAplicado as string | null),
  };
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

  // 2. Si ya hay snapshot, validarlo estrictamente ANTES de tocar brand.
  const snapPrevio = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (snapPrevio) {
    // Inválido/ajeno/contradictorio ⇒ lanza y aborta sin escribir nada.
    validarSnapshot(snapPrevio.value);
    // Snapshot válido preexistente: la migración ya corrió. No se recalcula un
    // contrato distinto ni se pisa nada: no-op idempotente que preserva cualquier
    // personalización posterior del sanatorio.
    return;
  }

  // 3. Sin snapshot: capturarlo y —sólo si el snapshot se guardó— aplicar el
  //    default. Si el insert del snapshot falla, la transacción de la migración
  //    revierte y brand no se modifica.
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
  await knex("settings").insert({ key: SNAPSHOT_KEY, value: JSON.stringify(snapshot) });

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

  // Fail-closed: figura aplicada (por eso corre su down()) pero no hay snapshot.
  if (!snapRow) {
    throw new Error(
      `rollback de ${MIGRACION} sin snapshot ("${SNAPSHOT_KEY}"): la migración figura ` +
        `aplicada pero fue corrida antes de la corrección del rollback de marca. No se ` +
        `vacía el logo ni se borra settings.brand. Para cruzar este punto restaurá un ` +
        `backup anterior a estas migraciones o realizá un procedimiento manual autorizado.`,
    );
  }

  // Validación estricta ANTES de tocar cualquier fila. Si falla, lanza y no se
  // modifica brand ni se elimina el snapshot.
  const snapshot = validarSnapshot(snapRow.value);

  if (snapshot.aplicoCambio) {
    const filaRaw = await knex("settings").where({ key: BRAND_KEY }).first();
    const valorFila = filaRaw ? leerValor(filaRaw.value) : undefined;
    const brand = esObjeto(valorFila) ? { ...valorFila } : null;

    // Restaurar sólo si la propiedad conserva EXACTAMENTE lo que esta migración
    // aplicó. La coincidencia con el valor aplicado no es prueba de procedencia
    // —la procedencia la da el snapshot ya validado—: es una guarda extra para
    // no pisar una personalización posterior.
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
      // propiedad. Nunca se borra una fila preexistente ni claves agregadas después.
      if (!snapshot.filaExistia && Object.keys(brand).length === 0) {
        await knex("settings").where({ key: BRAND_KEY }).del();
      }
    }
  }

  // Éxito: eliminar únicamente el snapshot correspondiente.
  await knex("settings").where({ key: SNAPSHOT_KEY }).del();
}
