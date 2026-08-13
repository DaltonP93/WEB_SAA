/**
 * Qué se puede embeber en un iframe. Una sola lista.
 *
 * El bloque de video aceptaba cualquier URL https y la CSP de producción sólo
 * permitía Google Maps y el desafío anti-spam en `frame-src`: el iframe pasaba
 * la validación del front y después el navegador lo bloqueaba. El video no se
 * veía y no había ningún error visible que lo explicara.
 *
 * Las dos puntas —lo que el front acepta y lo que la CSP permite— salen de
 * acá. `tests/video-embed-csp.test.ts` comprueba que la configuración de Nginx
 * y el `<meta>` del HTML incluyan todos estos orígenes; si se agrega un
 * proveedor y no se toca la CSP, la prueba falla.
 *
 * Agregar un proveedor es agregar un origen a esta lista **y** que la prueba
 * confirme que la CSP lo incluye. Nada de "cualquier host https".
 */

/** Proveedores de video soportados. */
export const VIDEO_EMBED_ORIGINS = [
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
] as const;

/**
 * Hosts de Google Maps que acepta el validador del mapa.
 *
 * Incluye los dominios `.com.py`: `isMapEmbedUrl()` los da por buenos, así que
 * la CSP tiene que permitirlos o el mapa quedaría en blanco por la misma razón
 * que el video.
 */
export const MAP_EMBED_ORIGINS = [
  "https://www.google.com",
  "https://maps.google.com",
  "https://www.google.com.py",
  "https://google.com.py",
] as const;

/** El widget anti-spam se dibuja dentro de un iframe del proveedor. */
export const CAPTCHA_FRAME_ORIGINS = ["https://challenges.cloudflare.com"] as const;

/** Todo lo que `frame-src` tiene que permitir, y nada más. */
export const FRAME_SRC_ORIGINS: readonly string[] = [
  ...VIDEO_EMBED_ORIGINS,
  ...MAP_EMBED_ORIGINS,
  ...CAPTCHA_FRAME_ORIGINS,
];

/** Hostnames de los proveedores de video, sin el esquema. */
export const VIDEO_EMBED_HOSTS: readonly string[] = VIDEO_EMBED_ORIGINS.map(
  (origin) => origin.replace("https://", ""),
);

/**
 * ¿Esta URL se puede poner en el `src` de un iframe de video?
 *
 * Exige https y un host de la lista. Un proveedor que no esté acá no se
 * dibuja: mejor no mostrar nada que mostrar un hueco que la CSP bloquea.
 */
export function isAllowedVideoEmbed(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(String(value).trim());
    return url.protocol === "https:" && VIDEO_EMBED_HOSTS.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
