/**
 * Saneamiento de destinos de navegación.
 *
 * Los href de menús, tarjetas y CTA los carga el panel. React Router 6.30
 * arrastra avisos de open-redirect con rutas que empiezan con `//` o `\`
 * (se interpretan como host externo). Normalizamos antes de navegar para que
 * un valor mal cargado no se convierta en una redirección afuera del sitio.
 */

/** Rutas internas seguras: empiezan con una sola barra. */
export function isInternalHref(href: string | undefined | null): boolean {
  if (!href) return false;
  const value = href.trim();
  if (!value.startsWith("/")) return false;
  // "//host" y "/\host" salen del sitio.
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  // Un esquema ofuscado nunca es una ruta interna válida.
  if (DANGEROUS_SCHEME.test(normalize(value))) return false;
  return true;
}

/** Esquemas externos que sí queremos permitir en un <a>. */
const SAFE_EXTERNAL = /^(https?:|mailto:|tel:)/i;

const DANGEROUS_SCHEME = /^(javascript|data|vbscript|file|blob|about|jar):/i;

/**
 * Normaliza igual que el servidor (`api/src/html.ts`) para detectar esquemas
 * ofuscados con entidades, tabs o espacios. Defensa en profundidad: la API ya
 * descarta estos valores, pero el front no confía en eso.
 */
function normalize(href: string): string {
  return href
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&colon;/gi, ":")
    .replace(/[\u0000-\u0020\u00a0\u2000-\u200f\u2028\u2029\ufeff]/g, "")
    .trim()
    .toLowerCase();
}

export function isSafeExternalHref(href: string | undefined | null): boolean {
  if (!href) return false;
  const normalized = normalize(href);
  if (DANGEROUS_SCHEME.test(normalized)) return false;
  return SAFE_EXTERNAL.test(normalized);
}

/**
 * Devuelve un destino interno seguro, o `fallback` si el valor no lo es.
 * Colapsa barras iniciales repetidas en vez de descartar el enlace.
 */
export function safeInternalHref(href: string | undefined | null, fallback = "/"): string {
  if (!href) return fallback;
  const value = href.trim().replace(/\\/g, "/");
  if (!value.startsWith("/")) return fallback;
  const normalized = value.replace(/^\/{2,}/, "/");
  return normalized || fallback;
}

/** Hosts de Google Maps aceptados para el iframe del mapa. */
const MAP_HOSTS = new Set([
  "www.google.com",
  "google.com",
  "maps.google.com",
  "www.google.com.py",
  "google.com.py",
]);

/**
 * ¿Es una URL de mapa embebible de Google?
 *
 * La API ya valida esto antes de publicarla; acá se repite porque el `src` de
 * un iframe es una superficie demasiado sensible para confiar en una sola capa.
 */
export function isMapEmbedUrl(value: string | undefined | null): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (!MAP_HOSTS.has(url.hostname.toLowerCase())) return false;
  if (!/^\/maps(\/embed)?\/?$/.test(url.pathname)) return false;
  return url.pathname.startsWith("/maps/embed") || url.searchParams.get("output") === "embed";
}
