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

/**
 * Todas las combinaciones posibles de las tres variables.
 *
 * La regla es una sola: o están las tres y son válidas, o la verificación
 * queda desactivada. Nunca un estado intermedio en el que el backend exija un
 * token que el front no puede obtener —ahí el formulario deja de poder
 * enviarse—, ni uno en el que el visitante resuelva un desafío que el servidor
 * no verifica.
 */
describe("matriz de configuración", () => {
  const P = "CAPTCHA_PROVIDER";
  const S = "CAPTCHA_SITE_KEY";
  const K = "CAPTCHA_SECRET_KEY";

  type Case = {
    name: string;
    env: Partial<Record<typeof P | typeof S | typeof K, string>>;
    enabled: boolean;
    /** Fragmentos que el aviso tiene que nombrar; `[]` = no debe avisar. */
    warns: string[];
  };

  const cases: Case[] = [
    { name: "ninguna variable", env: {}, enabled: false, warns: [] },

    { name: "sólo el proveedor", env: { [P]: "turnstile" }, enabled: false, warns: [S, K, "DESACTIVADA"] },
    { name: "sólo la site key", env: { [S]: "site" }, enabled: false, warns: [P, K, "DESACTIVADA"] },
    { name: "sólo el secreto", env: { [K]: "secreto" }, enabled: false, warns: [P, S, "DESACTIVADA"] },

    {
      name: "proveedor + site key (el servidor no verificaría nada)",
      env: { [P]: "turnstile", [S]: "site" },
      enabled: false,
      warns: [K, "DESACTIVADA"],
    },
    {
      name: "proveedor + secreto (nadie podría enviar el formulario)",
      env: { [P]: "turnstile", [K]: "secreto" },
      enabled: false,
      warns: [S, "DESACTIVADA"],
    },
    {
      name: "site key + secreto sin proveedor",
      env: { [S]: "site", [K]: "secreto" },
      enabled: false,
      warns: [P, "DESACTIVADA"],
    },

    {
      name: "proveedor inválido con las dos claves",
      env: { [P]: "inventado", [S]: "site", [K]: "secreto" },
      enabled: false,
      warns: ["no es válido"],
    },
    {
      name: "proveedor inválido y nada más",
      env: { [P]: "inventado" },
      enabled: false,
      warns: ["no es válido"],
    },
    {
      name: "las tres, con proveedor válido",
      env: { [P]: "turnstile", [S]: "site", [K]: "secreto" },
      enabled: true,
      warns: [],
    },
    {
      name: "las tres, con recaptcha",
      env: { [P]: "recaptcha", [S]: "site", [K]: "secreto" },
      enabled: true,
      warns: [],
    },
    {
      name: "las tres pero en blanco",
      env: { [P]: "  ", [S]: " ", [K]: "  " },
      enabled: false,
      warns: [],
    },
  ];

  it.each(cases)("$name", async ({ env, enabled, warns }) => {
    Object.assign(process.env, env);

    expect(captchaEnabled()).toBe(enabled);
    // El front sólo dibuja el widget si la config está completa.
    expect(captchaPublicConfig() !== null).toBe(enabled);

    const warn = vi.fn();
    warnIfCaptchaMisconfigured({ warn });
    if (warns.length === 0) {
      expect(warn).not.toHaveBeenCalled();
    } else {
      for (const fragment of warns) {
        expect(warn, `el aviso no nombra ${fragment}`).toHaveBeenCalledWith(
          expect.stringContaining(fragment),
        );
      }
    }

    // Lo que no puede pasar en ninguna combinación: que el formulario quede
    // imposible de enviar. Sin verificación activa, un envío sin token pasa.
    if (!enabled) {
      expect(await verifyCaptcha(undefined)).toBe(true);
    } else {
      expect(await verifyCaptcha(undefined)).toBe(false);
    }
  });

  it("el secreto nunca aparece en lo que se publica ni en el aviso", () => {
    process.env[P] = "turnstile";
    process.env[S] = "site";
    process.env[K] = "secreto-que-no-debe-salir";
    const warn = vi.fn();
    warnIfCaptchaMisconfigured({ warn });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secreto-que-no-debe-salir");
    expect(JSON.stringify(captchaPublicConfig())).not.toContain("secreto-que-no-debe-salir");
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
