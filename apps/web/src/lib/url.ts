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
  return true;
}

/** Esquemas externos que sí queremos permitir en un <a>. */
const SAFE_EXTERNAL = /^(https?:|mailto:|tel:)/i;

export function isSafeExternalHref(href: string | undefined | null): boolean {
  return !!href && SAFE_EXTERNAL.test(href.trim());
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
