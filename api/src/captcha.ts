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

export function captchaEnabled(): boolean {
  const provider = (process.env.CAPTCHA_PROVIDER ?? "").trim().toLowerCase();
  const secret = (process.env.CAPTCHA_SECRET_KEY ?? "").trim();
  return !!provider && !!secret && provider in VERIFY_URL;
}

/**
 * Devuelve true si el token es válido o si la verificación está desactivada.
 * Ante un error de red del proveedor devuelve false: preferimos rechazar el
 * envío antes que dejar pasar spam sin verificar.
 */
export async function verifyCaptcha(token: string | undefined, ip?: string): Promise<boolean> {
  if (!captchaEnabled()) return true;
  if (!token) return false;

  const provider = (process.env.CAPTCHA_PROVIDER ?? "").trim().toLowerCase();
  const secret = (process.env.CAPTCHA_SECRET_KEY ?? "").trim();
  const url = VERIFY_URL[provider];

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
