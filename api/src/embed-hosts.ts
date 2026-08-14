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
 * La lista es la misma que aceptan los dos validadores del mapa
 * (`api/src/html.ts` y `apps/web/src/lib/url.ts`), incluidos el dominio sin
 * `www` y los `.com.py`: si uno acepta un host que la CSP no permite, el mapa
 * queda en blanco por la misma razón que el video.
 */
export const MAP_EMBED_ORIGINS = [
  "https://www.google.com",
  "https://google.com",
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
 * Rutas que cada proveedor sirve dentro de un iframe.
 *
 * El host no alcanza: `youtube.com/shorts/…`, `/live/…` y `/playlist?…` se
 * sirven con `X-Frame-Options: SAMEORIGIN`, así que pasaban la validación y el
 * navegador los rechazaba igual — el mismo rectángulo negro sin explicación
 * que esta lista existe para evitar.
 */
const EMBED_PATHS: Record<string, RegExp> = {
  "www.youtube.com": /^\/embed\/[\w-]+\/?$/,
  "www.youtube-nocookie.com": /^\/embed\/[\w-]+\/?$/,
  "player.vimeo.com": /^\/video\/\d+\/?$/,
};

/**
 * ¿Esta URL se puede poner en el `src` de un iframe de video?
 *
 * Exige https, un host de la lista y una ruta que ese proveedor sirva
 * embebida. Lo que no cumple las tres cosas no se dibuja: mejor no mostrar
 * nada que mostrar un hueco que el navegador va a bloquear.
 */
export function isAllowedVideoEmbed(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "https:") return false;
    const path = EMBED_PATHS[url.hostname.toLowerCase()];
    return Boolean(path) && path.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Normaliza lo que se pega en el panel a una URL embebible.
 *
 * Es la misma función que usa el bloque para armar el `src`, así que lo que la
 * API acepta guardar y lo que el sitio dibuja no pueden divergir. Devuelve ""
 * si no hay forma de convertirlo en un embed de un proveedor permitido.
 */
export function toVideoEmbedUrl(value: string | undefined | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  // `youtube-nocookie` se respeta: es una decisión de privacidad de quien carga
  // el video, no un detalle de formato.
  const nocookie = raw.match(/youtube-nocookie\.com\/embed\/([\w-]+)/);
  if (nocookie) return `https://www.youtube-nocookie.com/embed/${nocookie[1]}`;
  const yt = raw.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = raw.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;

  return isAllowedVideoEmbed(raw) ? raw : "";
}

/** ¿El valor que se quiere guardar da un embed válido? */
export function isAllowedVideoUrl(value: string | undefined | null): boolean {
  return toVideoEmbedUrl(value) !== "";
}

export const VIDEO_URL_MESSAGE =
  "el video tiene que ser de YouTube (o YouTube sin cookies) o de Vimeo: son los únicos proveedores que la política de seguridad del sitio permite embeber";
