/**
 * Marketing: identificadores de medición y atribución de conversiones.
 *
 * Este módulo es el "módulo propio" que prometía el mensaje de la clave
 * retirada `scripts` (ver `routes/admin/settings.ts`): las integraciones de
 * medición no entran como un textarea de JavaScript arbitrario, entran como
 * **identificadores validados** que el front usa para cargar el SDK oficial de
 * cada plataforma. La diferencia es la que hay entre "pegá el código que te dio
 * Google" —que es pegar un `<script>` que hace lo que sea— y "pegá tu ID de
 * medición" —que sólo puede ser un ID—.
 *
 * Por eso acá lo único que se acepta es la **forma** de cada ID. Un valor que
 * no tiene forma de ID no se guarda: si se guardara, el front lo interpolaría
 * en la URL de un script y un valor malicioso se volvería una vía de inyección.
 * Validar la forma es lo que permite que el front confíe en el valor.
 */

/**
 * Los tres identificadores de medición que el panel administra.
 *
 * Vacío = apagado. No hay un cuarto estado: o hay un ID con forma válida, o no
 * hay medición de esa plataforma. `null`/`undefined`/espacios se normalizan a
 * "".
 */
export interface Analitica {
  /** Google Analytics 4: `G-XXXXXXXX`. */
  ga4: string;
  /** Google Tag Manager: `GTM-XXXXXX`. */
  gtm: string;
  /** Meta (Facebook) Pixel: sólo dígitos. */
  metaPixel: string;
}

export const ANALITICA_VACIA: Analitica = { ga4: "", gtm: "", metaPixel: "" };

/**
 * La forma de cada ID.
 *
 * Deliberadamente estrictas y en mayúsculas donde corresponde: Google emite
 * los suyos en mayúsculas, y aceptar minúsculas sólo abriría la puerta a
 * confusiones sin habilitar ningún ID real. El de Meta es numérico.
 */
const FORMATO: Record<keyof Analitica, RegExp> = {
  ga4: /^G-[A-Z0-9]{4,20}$/,
  gtm: /^GTM-[A-Z0-9]{4,12}$/,
  metaPixel: /^[0-9]{8,20}$/,
};

/** Los mensajes de rechazo, sin ejemplos que parezcan IDs reales copiables. */
const EJEMPLO: Record<keyof Analitica, string> = {
  ga4: "empieza con G- seguido de letras y números",
  gtm: "empieza con GTM- seguido de letras y números",
  metaPixel: "es sólo números",
};

/**
 * Valida el valor de la clave `analytics`.
 *
 * Devuelve el valor normalizado (los tres campos, cada uno un ID válido o "")
 * o la lista de errores. No lanza: quien llama decide el código HTTP, porque un
 * ID mal escrito es un 400 del cliente, no un 500 del servidor.
 */
export function validarAnalitica(
  value: unknown,
): { ok: true; value: Analitica } | { ok: false; errores: string[] } {
  if (value === null || value === undefined) return { ok: true, value: { ...ANALITICA_VACIA } };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errores: ["analytics debe ser un objeto"] };
  }

  const entrada = value as Record<string, unknown>;
  const salida: Analitica = { ...ANALITICA_VACIA };
  const errores: string[] = [];

  for (const clave of Object.keys(FORMATO) as (keyof Analitica)[]) {
    const bruto = entrada[clave];
    if (bruto === undefined || bruto === null || bruto === "") continue;
    if (typeof bruto !== "string") {
      errores.push(`analytics.${clave} debe ser texto`);
      continue;
    }
    const limpio = bruto.trim();
    if (limpio === "") continue;
    if (!FORMATO[clave].test(limpio)) {
      // No se repite el valor recibido en el error: iría al panel y podría
      // llevar lo que alguien haya pegado.
      errores.push(`analytics.${clave} no tiene el formato esperado (${EJEMPLO[clave]})`);
      continue;
    }
    salida[clave] = limpio;
  }

  return errores.length > 0 ? { ok: false, errores } : { ok: true, value: salida };
}

// --------------------------------------------------------------- atribución

/**
 * Los parámetros de atribución que se conservan, y nada más.
 *
 * Es una allowlist, no una lista de exclusiones: el front puede mandar
 * cualquier cosa en el cuerpo, y todo lo que no esté acá se descarta. Los cinco
 * `utm_*` son el estándar de facto; `gclid` y `fbclid` son los que agregan
 * Google y Meta al clic de un anuncio; `landing` y `referrer` dan el contexto
 * de la primera visita.
 */
const CLAVES_ATRIBUCION = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "landing",
  "referrer",
] as const;

export type ClaveAtribucion = (typeof CLAVES_ATRIBUCION)[number];
export type Atribucion = Partial<Record<ClaveAtribucion, string>>;

/** Caracteres de control y `<`/`>`: nada que pueda cerrar o abrir una etiqueta. */
const PELIGROSO = new RegExp("[\\u0000-\\u001f\\u007f<>]", "g");
const MAX_VALOR = 200;

/**
 * Sanea la atribución que llega en el cuerpo de una conversión.
 *
 * Devuelve un objeto sólo con las claves permitidas, cada valor recortado y sin
 * caracteres peligrosos, o `null` si no quedó nada. `null` y no `{}` para que la
 * columna refleje "no vino con atribución".
 *
 * No valida el *contenido* —un `utm_source` puede ser cualquier palabra— porque
 * no hay un catálogo cerrado de campañas y no se puede inventar uno. Lo que sí
 * se garantiza es que lo guardado sea texto corto e inofensivo: la defensa no
 * es contra un `utm_source` raro, es contra que este campo se use para colar
 * HTML o un valor kilométrico en la base.
 */
export function sanearAtribucion(value: unknown): Atribucion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const entrada = value as Record<string, unknown>;
  const salida: Atribucion = {};

  for (const clave of CLAVES_ATRIBUCION) {
    const bruto = entrada[clave];
    if (typeof bruto !== "string") continue;
    const limpio = bruto.replace(PELIGROSO, "").trim().slice(0, MAX_VALOR);
    if (limpio) salida[clave] = limpio;
  }

  return Object.keys(salida).length > 0 ? salida : null;
}

/** MariaDB devuelve las columnas JSON como string; MySQL 8 ya parseadas. */
export function leerAtribucion(value: unknown): Atribucion | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return sanearAtribucion(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return sanearAtribucion(value);
}
