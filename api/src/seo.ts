/**
 * SEO: tokens de verificación de propiedad del sitio.
 *
 * Google Search Console (y Bing Webmaster Tools) ofrecen verificar la propiedad
 * de un dominio pegando una etiqueta `<meta>` en el `<head>` del sitio. El token
 * es público por naturaleza —termina en el HTML que ve cualquiera—, así que
 * exponerlo no filtra nada. Lo que importa es que sólo pueda ser un **token**:
 * el front lo interpola en el atributo `content` de un `<meta>`, y un valor con
 * comillas, espacios o `<`/`>` podría romper el atributo o inyectar marcado.
 *
 * Por eso, igual que con los IDs de medición (`marketing.ts`), acá se valida la
 * **forma**: una allowlist de caracteres y una longitud acotada. Vacío = sin
 * verificación de esa plataforma; no hay un tercer estado.
 */

export interface Verificacion {
  /** Google Search Console: contenido del `<meta name="google-site-verification">`. */
  google: string;
  /** Bing Webmaster Tools: contenido del `<meta name="msvalidate.01">`. */
  bing: string;
}

export const VERIFICACION_VACIA: Verificacion = { google: "", bing: "" };

/**
 * La forma de un token de verificación.
 *
 * Google emite tokens de 43 caracteres base64url (`A-Za-z0-9_-`); Bing, cadenas
 * alfanuméricas de unos 32. La allowlist cubre ambas sin fijar un largo exacto
 * por proveedor —lo que dejaría afuera tokens válidos de mañana—; lo que no
 * entra es cualquier cosa que no sea un token: espacios, comillas, `<`, `>`.
 */
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{8,100}$/;

const EJEMPLO: Record<keyof Verificacion, string> = {
  google: "es el valor del atributo content de la etiqueta que da Search Console (sólo letras, números, - y _)",
  bing: "es el valor del atributo content de la etiqueta que da Bing (sólo letras, números, - y _)",
};

/**
 * Valida el sub-objeto `verification` de la clave `seo`.
 *
 * Devuelve el valor normalizado (los dos campos, cada uno un token válido o "")
 * o la lista de errores. No lanza: un token mal pegado es un 400 del cliente.
 */
export function validarVerificacion(
  value: unknown,
): { ok: true; value: Verificacion } | { ok: false; errores: string[] } {
  if (value === null || value === undefined) return { ok: true, value: { ...VERIFICACION_VACIA } };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errores: ["seo.verification debe ser un objeto"] };
  }

  const entrada = value as Record<string, unknown>;
  const salida: Verificacion = { ...VERIFICACION_VACIA };
  const errores: string[] = [];

  for (const clave of Object.keys(VERIFICACION_VACIA) as (keyof Verificacion)[]) {
    const bruto = entrada[clave];
    if (bruto === undefined || bruto === null || bruto === "") continue;
    if (typeof bruto !== "string") {
      errores.push(`seo.verification.${clave} debe ser texto`);
      continue;
    }
    const limpio = bruto.trim();
    if (limpio === "") continue;
    if (!FORMATO_TOKEN.test(limpio)) {
      // No se repite el valor recibido en el error: iría al panel.
      errores.push(`seo.verification.${clave} no tiene el formato esperado (${EJEMPLO[clave]})`);
      continue;
    }
    salida[clave] = limpio;
  }

  return errores.length > 0 ? { ok: false, errores } : { ok: true, value: salida };
}

/**
 * Normaliza el sub-objeto de verificación sin lanzar (camino de lectura).
 *
 * A diferencia de `validarVerificacion` —que rechaza el PUT entero si un token
 * está mal, para poder decir cuál—, acá cada campo se decide por su cuenta: un
 * token válido se conserva y uno inválido se descarta, sin arrastrar al otro.
 * Una fila vieja o editada a mano no puede colar un valor con forma inválida al
 * `content` de un `<meta>`; cualquier clave que no sea `google`/`bing` se ignora.
 */
export function sanearVerificacion(value: unknown): Verificacion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...VERIFICACION_VACIA };
  const entrada = value as Record<string, unknown>;
  const salida: Verificacion = { ...VERIFICACION_VACIA };
  for (const clave of Object.keys(VERIFICACION_VACIA) as (keyof Verificacion)[]) {
    const bruto = entrada[clave];
    if (typeof bruto !== "string") continue;
    const limpio = bruto.trim();
    if (FORMATO_TOKEN.test(limpio)) salida[clave] = limpio;
  }
  return salida;
}

/**
 * Normaliza el valor completo de la clave `seo`, tanto para guardar como para
 * publicar.
 *
 * Conserva los campos libres (`title`, `description`, `ogImage`, …) tal cual —son
 * contenido del administrador que el front escapa al renderizar— y reemplaza
 * `verification` por su forma validada. Si no queda ningún token, se omite la
 * clave para no engordar el JSON ni exponer un objeto vacío.
 *
 * Acepta el valor como objeto o como string JSON (MariaDB devuelve las columnas
 * JSON como string; MySQL 8 ya parseadas).
 */
export function normalizarSeo(value: unknown): Record<string, unknown> {
  const raw =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return {};
          }
        })()
      : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const seo = { ...(raw as Record<string, unknown>) };
  const verificacion = sanearVerificacion(seo.verification);
  if (verificacion.google || verificacion.bing) {
    seo.verification = verificacion;
  } else {
    delete seo.verification;
  }
  return seo;
}
