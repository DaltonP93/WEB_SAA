/**
 * De dónde vino el visitante, capturado en el navegador.
 *
 * Cuando alguien llega desde una campaña, la URL trae parámetros —`utm_source`,
 * `utm_medium`, `gclid`, etc.— que dicen qué anuncio o enlace lo trajo. Si no se
 * capturan en la primera vista, se pierden: el primer clic interno los borra de
 * la barra de direcciones. Esto los guarda para poder adjuntarlos a una
 * conversión (un turno, un mensaje) más tarde.
 *
 * ## No requiere consentimiento, y por qué
 *
 * A diferencia de la analítica de terceros, esto **no** es rastreo: es dato de
 * primera parte que no sale del navegador hasta que la persona **decide** enviar
 * un formulario, y entonces viaja sólo a la API del propio sanatorio, junto con
 * la solicitud que esa persona quiso hacer. No hay un tercero, no hay perfil, no
 * hay identificador. Por eso se captura siempre; la analítica, sólo con
 * consentimiento. Son dos cosas distintas y se tratan distinto a propósito.
 *
 * ## First-touch por sesión
 *
 * Se guarda la **primera** visita de la sesión y no se pisa. Si alguien llega
 * por un anuncio, navega, y vuelve a entrar directo, la conversión sigue
 * atribuida al anuncio que la originó, que es lo que interesa. `sessionStorage`
 * y no `localStorage`: la atribución es de esta visita, no permanente.
 */

const CLAVE = "saa_attribution";

/** Exactamente los parámetros que se conservan (espejo de la allowlist de la API). */
const PARAMETROS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
] as const;

export type Atribucion = Partial<Record<(typeof PARAMETROS)[number] | "landing" | "referrer", string>>;

const MAX_VALOR = 200;

/**
 * Quita caracteres de control y `<`/`>` —nada que pueda cerrar o abrir una
 * etiqueta— y recorta. Misma defensa que aplica la API al recibir; acá se hace
 * antes de guardar para no persistir basura, pero la que manda es la del
 * servidor. **No** toca dígitos, guiones ni puntos: `verano-2026` es legítimo.
 */
const PELIGROSO = new RegExp("[\\u0000-\\u001f\\u007f<>]", "g");
const limpiar = (v: string): string => v.replace(PELIGROSO, "").trim().slice(0, MAX_VALOR);

/**
 * Arma la atribución a partir de una query, sin tocar el almacenamiento.
 *
 * Pura para poder probarla: recibe la query y el contexto, devuelve el objeto o
 * `null` si no había ningún parámetro de campaña. `landing` y `referrer` sólo
 * acompañan cuando hay al menos un parámetro — no tiene sentido registrar la
 * página de aterrizaje de una visita que no vino de ninguna campaña.
 */
export function construirAtribucion(search: string, referrer: string, pathname: string): Atribucion | null {
  const params = new URLSearchParams(search);
  const salida: Atribucion = {};

  for (const clave of PARAMETROS) {
    const valor = params.get(clave);
    if (valor) {
      const limpio = limpiar(valor);
      if (limpio) salida[clave] = limpio;
    }
  }

  if (Object.keys(salida).length === 0) return null;

  if (pathname) salida.landing = limpiar(pathname);
  // Sólo el host del referente, no la URL entera: alcanza para saber "vino de
  // instagram.com" sin arrastrar la ruta ni los parámetros de otra página.
  if (referrer) {
    try {
      salida.referrer = limpiar(new URL(referrer).hostname);
    } catch {
      /* referente no parseable: se omite */
    }
  }

  return salida;
}

/**
 * Captura la atribución de la vista actual si es la primera de la sesión.
 *
 * Idempotente: si ya hay una guardada, no la pisa (first-touch). Se llama una
 * vez al arrancar la app.
 */
export function capturarAtribucion(): void {
  try {
    if (sessionStorage.getItem(CLAVE)) return;
    const atribucion = construirAtribucion(window.location.search, document.referrer, window.location.pathname);
    if (atribucion) sessionStorage.setItem(CLAVE, JSON.stringify(atribucion));
  } catch {
    /* sessionStorage bloqueado: sin atribución, que no rompe nada */
  }
}

/** La atribución guardada de esta sesión, para adjuntar a una conversión. */
export function obtenerAtribucion(): Atribucion | undefined {
  try {
    const crudo = sessionStorage.getItem(CLAVE);
    if (!crudo) return undefined;
    const v = JSON.parse(crudo);
    return v && typeof v === "object" ? (v as Atribucion) : undefined;
  } catch {
    return undefined;
  }
}
