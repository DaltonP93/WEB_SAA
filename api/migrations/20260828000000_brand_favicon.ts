import type { Knex } from "knex";

/**
 * Setea el favicon institucional por defecto (asset estático servido en
 * /favicon.png, ver apps/web/public/) cuando settings.brand.faviconUrl todavía
 * está vacío. No pisa un favicon que el sanatorio ya haya cargado a mano.
 *
 * ## Por qué esta migración lleva snapshot (excepción autorizada)
 *
 * Igual que `20260827000000_brand_logo`, la primera versión vaciaba la propiedad
 * en `down()` dejando un residuo. La corrección por heurística de contenido se
 * descartó (coincidir con los defaults no prueba procedencia). La corrección real
 * registra procedencia con un snapshot interno validado estrictamente. Editar
 * estas dos migraciones ya fusionadas se hizo bajo autorización explícita y
 * acotada del propietario.
 *
 * ## Contrato del snapshot (formato 1, estructura cerrada)
 *
 * Clave interna `snapshot_brand_favicon_20260828000000` (prefijo `snapshot_`,
 * `varchar(64)`, fuera de las allowlists de settings: no publicada ni editable
 * desde el CMS). Objeto con **exactamente** `formato`, `migracion`, `propiedad`,
 * `filaExistia`, `formaInesperada`, `propiedadExistia`, `valorAnterior`,
 * `aplicoCambio`, `valorAplicado`. Se valida estrictamente (tipos exactos,
 * pertenencia a esta migración/propiedad, coherencia interna) antes de confiar en
 * él; nunca un cast al tipo completo tras validar sólo algunos campos. Se guarda
 * aunque no cambie nada, no se sobrescribe, y se elimina tras un rollback exitoso.
 *
 * A diferencia del logo, el `down()` del favicon **nunca borra la fila**
 * `settings.brand`: sólo restaura o elimina su propia propiedad. Quitar la fila
 * cuando ya no queda nada es responsabilidad exclusiva del `down()` del logo, que
 * corre después (LIFO) y es dueño de la creación original de la fila.
 *
 * ## Fail-closed en instalaciones migradas antes de esta corrección
 *
 * Si figura aplicada pero su snapshot está ausente, es inválido o de una versión
 * desconocida, `down()` aborta antes de tocar datos y remite a restaurar un backup
 * anterior a estas migraciones o a un procedimiento manual autorizado. Sin
 * fallback heurístico.
 */

const BRAND_KEY = "brand";
const PROP = "faviconUrl";
const DEFAULT_VALUE = "/favicon.png";
const SNAPSHOT_KEY = "snapshot_brand_favicon_20260828000000";
const MIGRACION = "20260828000000_brand_favicon.ts";
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
 * Validación estricta del snapshot. Lanza ante cualquier desvío (estructura no
 * cerrada, tipo inválido, pertenencia ajena, procedencia imposible). Sólo si TODO
 * pasa construye el objeto tipado a partir de valores validados —nunca un cast—.
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

  if (aplicoCambio) {
    if (valorAplicado !== DEFAULT_VALUE) {
      throw new Error(`${MIGRACION}: snapshot inválido — valorAplicado incoherente con aplicoCambio=true.`);
    }
  } else if (valorAplicado !== null) {
    throw new Error(`${MIGRACION}: snapshot inválido — valorAplicado debe ser null con aplicoCambio=false.`);
  }

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
    if (!(valorAnterior === null || valorAnterior === "")) {
      throw new Error(`${MIGRACION}: snapshot inválido — valorAnterior debe ser null o "" (propiedad presente, aplicoCambio=true).`);
    }
  } else {
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
  const filaRaw = await knex("settings").where({ key: BRAND_KEY }).first();
  const filaExistia = filaRaw !== undefined;
  const valorFila = filaExistia ? leerValor(filaRaw.value) : undefined;
  const brand = esObjeto(valorFila) ? valorFila : null;
  const formaInesperada = filaExistia && brand === null;
  const propiedadExistia = brand !== null && Object.prototype.hasOwnProperty.call(brand, PROP);
  const valorAnterior = propiedadExistia ? (brand as BrandObject)[PROP] : null;
  const debeAplicar = !formaInesperada && !(brand && (brand as BrandObject)[PROP]);

  const snapPrevio = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (snapPrevio) {
    validarSnapshot(snapPrevio.value); // inválido ⇒ lanza y aborta sin escribir
    return; // válido preexistente: no-op idempotente, preserva personalizaciones
  }

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

  if (!snapRow) {
    throw new Error(
      `rollback de ${MIGRACION} sin snapshot ("${SNAPSHOT_KEY}"): la migración figura ` +
        `aplicada pero fue corrida antes de la corrección del rollback de marca. No se ` +
        `vacía el favicon ni se borra settings.brand. Para cruzar este punto restaurá un ` +
        `backup anterior a estas migraciones o realizá un procedimiento manual autorizado.`,
    );
  }

  const snapshot = validarSnapshot(snapRow.value);

  if (snapshot.aplicoCambio) {
    const filaRaw = await knex("settings").where({ key: BRAND_KEY }).first();
    const valorFila = filaRaw ? leerValor(filaRaw.value) : undefined;
    const brand = esObjeto(valorFila) ? { ...valorFila } : null;

    // Restaurar sólo si la propiedad conserva EXACTAMENTE lo que aplicó (guarda
    // extra; la procedencia la da el snapshot validado). El favicon nunca borra
    // la fila: eso es responsabilidad del down() del logo.
    if (brand && brand[PROP] === snapshot.valorAplicado) {
      if (snapshot.propiedadExistia) {
        brand[PROP] = snapshot.valorAnterior;
      } else {
        delete brand[PROP];
      }
      await knex("settings")
        .where({ key: BRAND_KEY })
        .update({ value: JSON.stringify(brand), updated_at: knex.fn.now() });
    }
  }

  await knex("settings").where({ key: SNAPSHOT_KEY }).del();
}
