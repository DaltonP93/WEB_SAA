/**
 * Validación de los valores de `contact_channels` según su tipo.
 *
 * Un canal `kind: "url"` termina en `<a href>` sin más filtro que el que haya
 * en la API, así que `href` no puede ser "cualquier string": un
 * `javascript:alert(1)` guardado desde el panel se convierte en un enlace
 * ejecutable para cualquier visitante. Lo mismo, en menor grado, con teléfonos
 * y correos: un valor mal formado genera un `tel:`/`mailto:` roto.
 *
 * La regla se aplica en tres capas —API administrativa, salida pública y
 * frontend— porque cada una puede recibir datos que la anterior no vio: filas
 * viejas, escrituras directas a la base o respuestas manipuladas.
 *
 * Este archivo existe dos veces, byte a byte igual, en
 * `shared/types/contact-values.ts` y en `api/src/contact-values.ts`, porque la
 * API no puede importar valores de `shared/` (`rootDir`).
 * `tests/contact-values.test.ts` compara ambas copias y falla si divergen.
 */

export type ContactChannelKind = "whatsapp" | "phone" | "email" | "url";

const DANGEROUS_SCHEME = /^(javascript|data|vbscript|file|blob|about|jar):/i;

/**
 * Normaliza como el resto del proyecto: decodifica entidades y saca espacios
 * y caracteres de control, para que `java&#115;cript:` o `java\tscript:` no
 * pasen por no parecerse al literal.
 */
function normalize(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&colon;/gi, ":")
    .replace(/[\u0000-\u0020\u00a0\u2000-\u200f\u2028\u2029\ufeff]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * URL de un canal `kind: "url"`.
 *
 * Sólo HTTPS. HTTP queda fuera a propósito: estos enlaces son perfiles
 * institucionales y portales del sanatorio, y no hay ninguno que justifique
 * mandar a un visitante por texto plano. Si algún día aparece uno, la
 * excepción tiene que ser explícita y documentada, no un agujero por defecto.
 */
export function isValidChannelUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const raw = String(value).trim();
  const normalized = normalize(raw);
  if (DANGEROUS_SCHEME.test(normalized)) return false;
  // "//host" y "/\host" salen del sitio sin declarar esquema; una ruta
  // relativa no es un destino válido para un canal de contacto.
  if (raw.startsWith("//") || raw.startsWith("/") || raw.startsWith("\\")) return false;
  if (raw.includes("\\")) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // Un host sin punto no es un dominio público (localhost, intranet, etc.).
  if (!url.hostname.includes(".")) return false;
  return true;
}

/** Correo con forma razonable; no se verifica que exista. */
export function isValidChannelEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  const raw = String(value).trim();
  if (/\s/.test(raw)) return false;
  if (DANGEROUS_SCHEME.test(normalize(raw))) return false;
  return /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(raw);
}

/**
 * Teléfono: dígitos, con o sin `+`, y separadores de lectura. Entre 6 y 15
 * dígitos, que es el rango de la E.164 más los internos cortos.
 */
export function isValidChannelPhone(value: string | null | undefined): boolean {
  if (!value) return false;
  const raw = String(value).trim();
  if (!/^\+?[0-9()\-.\s]+$/.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15;
}

/**
 * WhatsApp: número internacional. `wa.me` necesita el número completo con
 * código de país, así que se exige más largo que un teléfono cualquiera.
 */
export function isValidChannelWhatsapp(value: string | null | undefined): boolean {
  if (!value) return false;
  const raw = String(value).trim();
  if (!/^\+?[0-9()\-.\s]+$/.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

/** ¿El valor sirve para el tipo de canal declarado? */
export function isValidChannelValue(kind: ContactChannelKind, value: string | null | undefined): boolean {
  switch (kind) {
    case "url":
      return isValidChannelUrl(value);
    case "email":
      return isValidChannelEmail(value);
    case "phone":
      return isValidChannelPhone(value);
    case "whatsapp":
      return isValidChannelWhatsapp(value);
    default:
      return false;
  }
}

/** Mensaje de error por tipo, para el panel. */
export const CHANNEL_VALUE_MESSAGE: Record<ContactChannelKind, string> = {
  url: "tiene que ser una URL https:// completa (por ejemplo https://facebook.com/…)",
  email: "tiene que ser una dirección de correo válida",
  phone: "tiene que ser un teléfono válido (dígitos, con o sin +, entre 6 y 15)",
  whatsapp: "tiene que ser un número internacional válido (entre 8 y 15 dígitos)",
};

/**
 * Deja el canal listo para publicar: descarta lo que no valide en vez de
 * dejarlo pasar. Lo usa la salida pública, así que una fila vieja o escrita
 * directo en la base tampoco llega al navegador.
 */
export function publicChannelValues<T extends { kind: string; value?: string | null; href?: string | null }>(
  channel: T,
): T {
  const kind = channel.kind as ContactChannelKind;
  const value = channel.value?.trim() ? channel.value.trim() : null;
  const href = channel.href?.trim() ? channel.href.trim() : null;
  return {
    ...channel,
    // En `url` el destino vive en `href`, pero `value` guarda la misma URL y
    // también se publica: se valida igual.
    value: value && isValidChannelValue(kind, value) ? value : null,
    href: href && isValidChannelUrl(href) ? href : null,
  };
}
