/**
 * Verificación anti-spam opcional (Cloudflare Turnstile o reCAPTCHA).
 *
 * Queda desactivada mientras no haya `CAPTCHA_PROVIDER` + `CAPTCHA_SECRET_KEY`
 * en el entorno: no inventamos claves ni bloqueamos los formularios de
 * producción por una integración que todavía no se configuró. Cuando el
 * propietario cargue las claves, la verificación se activa sola.
 */

const VERIFY_URL: Record<string, string> = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  recaptcha: "https://www.google.com/recaptcha/api/siteverify",
};

function provider(): string {
  return (process.env.CAPTCHA_PROVIDER ?? "").trim().toLowerCase();
}

/**
 * La verificación está activa sólo si están las **tres** variables.
 *
 * Antes bastaban proveedor y secreto. Con esa combinación el backend exigía
 * token pero el front recibía `captcha: null` —porque necesita la site key
 * para dibujar el widget—, así que no había forma de obtener un token y
 * **todos los envíos fallaban**. Faltando cualquiera de las tres, la
 * verificación queda desactivada y los formularios siguen funcionando.
 */
export function captchaEnabled(): boolean {
  const siteKey = (process.env.CAPTCHA_SITE_KEY ?? "").trim();
  const secret = (process.env.CAPTCHA_SECRET_KEY ?? "").trim();
  return !!provider() && provider() in VERIFY_URL && !!siteKey && !!secret;
}

/**
 * Lo único que el navegador necesita saber: qué proveedor usar y con qué
 * site key. La clave secreta nunca sale del servidor.
 *
 * Devuelve `null` cuando la verificación no está configurada, y así el front
 * no dibuja ningún widget: los formularios siguen funcionando igual.
 */
export function captchaPublicConfig(): { provider: string; siteKey: string } | null {
  if (!captchaEnabled()) return null;
  return { provider: provider(), siteKey: (process.env.CAPTCHA_SITE_KEY ?? "").trim() };
}

/**
 * Avisa si la configuración quedó a medias. Con site key pero sin secreto el
 * visitante resuelve el desafío y el servidor no verifica nada; con secreto
 * pero sin site key el formulario se vuelve imposible de enviar.
 */
export function warnIfCaptchaMisconfigured(log: Pick<Console, "warn"> = console): void {
  const siteKey = (process.env.CAPTCHA_SITE_KEY ?? "").trim();
  const secret = (process.env.CAPTCHA_SECRET_KEY ?? "").trim();
  const name = provider();
  if (!name && !siteKey && !secret) return; // desactivado a propósito

  if (name && !(name in VERIFY_URL)) {
    log.warn(`[captcha] CAPTCHA_PROVIDER="${name}" no es válido (turnstile|recaptcha): la verificación queda desactivada.`);
    return;
  }
  const missing = [
    !name && "CAPTCHA_PROVIDER",
    !siteKey && "CAPTCHA_SITE_KEY",
    !secret && "CAPTCHA_SECRET_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    log.warn(
      `[captcha] configuración incompleta: falta ${missing.join(", ")}. ` +
        "La verificación queda DESACTIVADA (los formularios siguen funcionando). " +
        "Las tres variables van juntas.",
    );
  }
}

/**
 * Devuelve true si el token es válido o si la verificación está desactivada.
 * Ante un error de red del proveedor devuelve false: preferimos rechazar el
 * envío antes que dejar pasar spam sin verificar.
 */
export async function verifyCaptcha(token: string | undefined, ip?: string): Promise<boolean> {
  if (!captchaEnabled()) return true;
  if (!token) return false;

  const secret = (process.env.CAPTCHA_SECRET_KEY ?? "").trim();
  const url = VERIFY_URL[provider()];

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("[captcha] verificación fallida:", (err as Error).message);
    return false;
  }
}
