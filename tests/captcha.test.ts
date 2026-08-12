import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captchaEnabled,
  captchaPublicConfig,
  verifyCaptcha,
  warnIfCaptchaMisconfigured,
} from "../api/src/captcha";

/**
 * Verificación anti-spam.
 *
 * El servidor ya validaba el token, pero el front nunca mostraba un widget ni
 * mandaba nada: la integración estaba a medias y, si el sanatorio cargaba la
 * clave secreta, todos los envíos pasaban a rechazarse.
 *
 * Lo que se prueba acá: que sin configurar no moleste a nadie, que configurada
 * exija el token de verdad, y que una configuración a medias avise.
 */

const ROOT = resolve(__dirname, "..");
const ENV_KEYS = ["CAPTCHA_PROVIDER", "CAPTCHA_SITE_KEY", "CAPTCHA_SECRET_KEY"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  vi.restoreAllMocks();
});

describe("sin configurar (estado actual del proyecto)", () => {
  it("no está habilitada", () => {
    expect(captchaEnabled()).toBe(false);
    expect(captchaPublicConfig()).toBeNull();
  });

  it("los formularios se pueden enviar sin token", async () => {
    expect(await verifyCaptcha(undefined)).toBe(true);
    expect(await verifyCaptcha("")).toBe(true);
  });

  it("no avisa nada: está desactivada a propósito", () => {
    const warn = vi.fn();
    warnIfCaptchaMisconfigured({ warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("configurada", () => {
  beforeEach(() => {
    process.env.CAPTCHA_PROVIDER = "turnstile";
    process.env.CAPTCHA_SITE_KEY = "site-key-de-prueba";
    process.env.CAPTCHA_SECRET_KEY = "secreto-de-prueba";
  });

  it("expone al front el proveedor y la site key, nunca el secreto", () => {
    const config = captchaPublicConfig();
    expect(config).toEqual({ provider: "turnstile", siteKey: "site-key-de-prueba" });
    expect(JSON.stringify(config)).not.toContain("secreto-de-prueba");
  });

  it("rechaza un envío sin token", async () => {
    expect(await verifyCaptcha(undefined)).toBe(false);
  });

  it("acepta un token que el proveedor da por bueno", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyCaptcha("token-valido", "203.0.113.5")).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = String((init as { body: URLSearchParams }).body);
    expect(body).toContain("response=token-valido");
    expect(body).toContain("remoteip=203.0.113.5");
  });

  it("rechaza un token que el proveedor da por malo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }));
    expect(await verifyCaptcha("token-invalido")).toBe(false);
  });

  it("ante un error de red rechaza en vez de dejar pasar", async () => {
    // Preferimos un envío perdido antes que spam sin verificar.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin red")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await verifyCaptcha("token")).toBe(false);
  });
});

describe("configuración a medias", () => {
  it("avisa si hay site key pero no secreto: el servidor no verificaría nada", () => {
    process.env.CAPTCHA_PROVIDER = "turnstile";
    process.env.CAPTCHA_SITE_KEY = "site-key";
    const warn = vi.fn();
    warnIfCaptchaMisconfigured({ warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NO verifica"));
    // Y mientras tanto la verificación queda desactivada, no rota.
    expect(captchaEnabled()).toBe(false);
  });

  it("avisa si hay secreto pero no site key: nadie podría enviar el formulario", () => {
    process.env.CAPTCHA_PROVIDER = "turnstile";
    process.env.CAPTCHA_SECRET_KEY = "secreto";
    const warn = vi.fn();
    warnIfCaptchaMisconfigured({ warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falta CAPTCHA_SITE_KEY"));
    // Con secreto y sin site key el front no puede mostrar el widget.
    expect(captchaPublicConfig()).toBeNull();
  });

  it("avisa si el proveedor no es válido", () => {
    process.env.CAPTCHA_PROVIDER = "inventado";
    process.env.CAPTCHA_SECRET_KEY = "secreto";
    process.env.CAPTCHA_SITE_KEY = "site-key";
    const warn = vi.fn();
    warnIfCaptchaMisconfigured({ warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no es válido"));
    expect(captchaEnabled()).toBe(false);
    // Y sin verificación activa los formularios siguen funcionando.
    expect(captchaPublicConfig()).toBeNull();
  });
});

describe("integración con el front", () => {
  const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

  it("el formulario de contacto manda el token y bloquea el envío mientras falta", () => {
    const form = read("apps/web/src/blocks/ContactForm.tsx");
    expect(form).toContain("useCaptchaConfig");
    expect(form).toContain("captchaToken");
    expect(form).toContain("captchaPending");
  });

  it("el widget sólo se dibuja si el servidor dice que está configurado", () => {
    const captcha = read("apps/web/src/components/Captcha.tsx");
    expect(captcha).toContain("if (!config) return null;");
    // La clave secreta no se nombra en el front.
    expect(captcha).not.toContain("CAPTCHA_SECRET_KEY");
  });

  it("la CSP permite los hosts del desafío", () => {
    const html = read("apps/web/index.html");
    expect(html).toContain("https://challenges.cloudflare.com");
    const nginx = read("scripts/deploy/setup-vps.sh");
    expect(nginx).toContain("https://challenges.cloudflare.com");
  });

  it("las variables están documentadas para el propietario", () => {
    const deploy = read("docs/DEPLOY.md");
    for (const key of ["CAPTCHA_PROVIDER", "CAPTCHA_SITE_KEY", "CAPTCHA_SECRET_KEY"]) {
      expect(deploy, `falta documentar ${key}`).toContain(key);
    }
  });
});
