import sanitizeHtmlLib from "sanitize-html";

/**
 * Saneamiento de HTML con allowlist explícita.
 *
 * Todo lo que se guarda desde el panel termina en `dangerouslySetInnerHTML`
 * en el sitio público, así que el saneo tiene que resistir entidades HTML,
 * protocolos ofuscados, SVG/MathML, `srcdoc` y HTML mal formado. Un filtro
 * por expresiones regulares no da esa garantía: usamos `sanitize-html`, que
 * parsea el documento y descarta todo lo que no esté explícitamente
 * permitido.
 */

/** Protocolos aceptados en href/src. Nada de javascript:, data:, vbscript:. */
const ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"];

/** Etiquetas de contenido editorial. Sin iframe, object, embed, svg ni form. */
const ALLOWED_TAGS = [
  "p", "br", "hr", "span", "div",
  "strong", "b", "em", "i", "u", "s", "small", "mark", "sub", "sup",
  "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "blockquote", "cite", "q",
  "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "code", "pre",
];

const BASE_OPTIONS: sanitizeHtmlLib.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    th: ["colspan", "rowspan", "scope"],
    td: ["colspan", "rowspan"],
    col: ["span"],
    // Sin `class` libre: una clase arbitraria puede pintar cualquier cosa con
    // el CSS del sitio (incluido `text-accent-*`, el rojo de Emergencias) sin
    // pasar por ninguna validación de color. El contenido administrable no
    // necesita elegir clases; el estilo lo pone el bloque.
  },
  allowedSchemes: ALLOWED_SCHEMES,
  allowedSchemesByTag: { img: ["http", "https"] },
  // Sin esto, `href="//host"` sale del sitio sin declarar protocolo.
  allowProtocolRelative: false,
  // Descarta el contenido de las etiquetas peligrosas en vez de dejar el texto.
  nonTextTags: ["style", "script", "textarea", "option", "noscript", "iframe", "object", "embed"],
  disallowedTagsMode: "discard",
  transformTags: {
    // Los enlaces externos no deben poder tocar window.opener.
    a: (tagName, attribs) => {
      const href = attribs.href ?? "";
      const isExternal = /^https?:\/\//i.test(href);
      return {
        tagName,
        attribs: {
          ...attribs,
          ...(isExternal ? { rel: "noopener noreferrer", target: attribs.target ?? "_blank" } : {}),
        },
      };
    },
  },
};

export function sanitizeHtml(input: string | null | undefined): string | null {
  if (input == null) return null;
  return sanitizeHtmlLib(String(input), BASE_OPTIONS);
}

/** Texto plano: quita todo el marcado. */
export function stripHtml(input: string | null | undefined): string {
  if (input == null) return "";
  return sanitizeHtmlLib(String(input), { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------- URLs

/**
 * Normaliza para detectar protocolos ofuscados: entidades HTML, espacios,
 * saltos de línea y caracteres de control dentro del esquema
 * (`java\tscript:`, `java&#115;cript:`, `  javascript:` …).
 */
function normalizeUrl(value: string): string {
  let out = String(value);
  // Entidades numéricas: &#106; y &#x6a;
  out = out.replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  out = out.replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCharCode(Number(dec)));
  // Entidades nombradas que sirven para ofuscar el esquema.
  out = out.replace(/&colon;/gi, ":").replace(/&Tab;|&NewLine;/gi, "");
  // Espacios y caracteres de control dentro del esquema: "java\tscript:".
  out = out.replace(/[\u0000-\u0020\u00a0\u2000-\u200f\u2028\u2029\ufeff]/g, "");
  return out.trim().toLowerCase();
}

const DANGEROUS_SCHEME = /^(javascript|data|vbscript|file|blob|about|jar):/i;

/**
 * ¿Es un destino seguro para un enlace administrable?
 *
 * Acepta rutas internas (`/turnos`, `#ancla`) y URLs http(s)/mailto/tel.
 * Rechaza `javascript:`, `data:`, protocolo relativo (`//host`), backslashes
 * y cualquier ofuscación de las anteriores.
 */
export function isSafeLinkHref(value: string | null | undefined): boolean {
  if (value == null) return false;
  const raw = String(value).trim();
  if (raw === "") return false;

  const normalized = normalizeUrl(raw);
  if (DANGEROUS_SCHEME.test(normalized)) return false;
  // "//host" y "/\host" navegan fuera del sitio sin declarar protocolo.
  if (normalized.startsWith("//") || normalized.startsWith("/\\") || normalized.startsWith("\\")) {
    return false;
  }

  // Ruta interna o ancla.
  if (normalized.startsWith("/") || normalized.startsWith("#") || normalized.startsWith("?")) {
    return true;
  }

  const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/)?.[1];
  if (!scheme) return true; // relativo simple: "contacto"
  return ALLOWED_SCHEMES.includes(scheme);
}

/** Devuelve el href si es seguro; si no, `undefined`. */
export function safeLinkHref(value: string | null | undefined): string | undefined {
  return isSafeLinkHref(value) ? String(value).trim() : undefined;
}

// ------------------------------------------------------- embed de mapa

/** Hosts de Google Maps aceptados en el iframe del bloque de mapa. */
const MAP_HOSTS = new Set([
  "www.google.com",
  "google.com",
  "maps.google.com",
  "www.google.com.py",
  "google.com.py",
]);

/** `srcdoc` o cualquier `onalgo=`: el valor guardado fue manipulado. */
const TAMPERED_EMBED = /\bsrcdoc\s*=|\son[a-z]+\s*=/i;

/**
 * URL de mapa válida, que es lo **único** que viaja al navegador.
 *
 * Acepta las dos formas en que llega el dato: el `<iframe>` que copia y pega
 * quien administra el sitio, o una URL suelta. De cualquiera de las dos se
 * extrae la URL, se valida host y ruta contra Google Maps, y se devuelve sólo
 * eso. El HTML original no sobrevive en ninguna forma.
 *
 * Antes la salida pública era un iframe reconstruido y el front lo insertaba
 * con `dangerouslySetInnerHTML`. El saneo era correcto para lo que se guardaba
 * desde el panel, pero un valor viejo —o escrito directo en la base— llegaba
 * crudo hasta ese `innerHTML`. Con una URL no hay HTML que insertar: el front
 * arma el `<iframe>` con atributos fijos.
 */
export function mapEmbedUrl(value: string | null | undefined): string {
  if (!value) return "";
  const raw = String(value).trim();

  // Un iframe con `srcdoc` o con manejadores de evento no es un pegado de
  // Google Maps: es una fila manipulada. No se le extrae nada, se descarta
  // entero aunque el `src` que traiga parezca legítimo.
  if (TAMPERED_EMBED.test(raw)) return "";

  // `<iframe … src="…">` o la URL sola.
  const srcMatch = raw.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  const candidate = (srcMatch ? srcMatch[1] : raw).replace(/&amp;/g, "&").trim();
  // Un valor que trae HTML sin ser un iframe con src no se intenta interpretar.
  if (!srcMatch && /[<>]/.test(candidate)) return "";

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return "";
  }

  if (url.protocol !== "https:") return "";
  if (!MAP_HOSTS.has(url.hostname.toLowerCase())) return "";
  // /maps/embed?pb=… o /maps?q=…&output=embed
  const isEmbedPath = /^\/maps(\/embed)?\/?$/.test(url.pathname);
  if (!isEmbedPath) return "";
  if (!url.pathname.startsWith("/maps/embed") && url.searchParams.get("output") !== "embed") {
    return "";
  }
  return url.toString();
}

/**
 * Normaliza lo que se guarda desde el panel: si el valor es un mapa válido se
 * conserva la URL, si no queda vacío. Se usa al escribir; la salida pública
 * vuelve a pasar por `mapEmbedUrl()` para cubrir lo que ya estaba en la base.
 */
export function sanitizeMapEmbed(value: string | null | undefined): string {
  return mapEmbedUrl(value);
}
