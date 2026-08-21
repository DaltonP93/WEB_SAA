import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  TEST_ADMIN_PASSWORD,
  applyDbEnv,
  closeAppDb,
  closeServer,
  createTestDatabase,
  dropTestDatabase,
  migrateLatest,
  runSeeds,
} from "./helpers/db";

/**
 * La idempotencia se resuelve **antes** que el CAPTCHA, y sin abrir una puerta.
 *
 * El token del CAPTCHA es de un solo uso. Verificarlo antes de mirar la clave
 * de envío rompía justo el caso para el que existe la clave: el paciente manda
 * el formulario, la fila se escribe, la respuesta se pierde, y el reintento
 * llega con un token ya consumido. El servidor contestaba **400 "verificación
 * anti-spam fallida"** sobre una solicitud que ya estaba guardada. La persona
 * veía un error, reintentaba, y seguía viendo el mismo error.
 *
 * Mover la verificación después no relaja nada: una clave que todavía no
 * existe sigue exigiendo CAPTCHA válido, y una que sí existe no crea nada.
 *
 * Lo que sí hay que impedir es lo contrario: que reutilizar una clave con
 * **otros datos** devuelva éxito sobre una solicitud distinta. Eso sería peor
 * que duplicar, porque el cliente recibiría el id de un pedido que no es suyo.
 *
 *   TEST_DATABASE=1 pnpm test tests/turnos-idempotencia.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_idem`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const PACIENTE = {
  name: "Paciente De Prueba",
  phone: "+595 981 000 222",
  email: "paciente.de.prueba@ejemplo.test",
  message: "Necesito un turno por la mañana.",
};

describeDb("idempotencia del registro de turnos", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let contador = 0;

  const json = { "Content-Type": "application/json" };
  const clave = () => `idem-${Date.now()}-${contador++}`;

  const solicitar = (body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/public/appointments`, { method: "POST", headers: json, body: JSON.stringify(body) });

  const valida = (extra: Record<string, unknown> = {}) => ({
    ...PACIENTE,
    consent: true,
    submissionKey: clave(),
    ...extra,
  });

  const cuantas = async () => Number((await db("appointments").count({ n: "id" }))[0].n);

  /**
   * Enciende el CAPTCHA y decide si el proveedor acepta o rechaza el token.
   *
   * Se intercepta sólo la llamada al proveedor: el resto del `fetch` —incluido
   * el de la propia prueba contra la API— sigue siendo el real.
   */
  const conCaptcha = (acepta: boolean) => {
    process.env.CAPTCHA_PROVIDER = "turnstile";
    process.env.CAPTCHA_SECRET_KEY = "secreto-de-prueba";
    process.env.CAPTCHA_SITE_KEY = "site-de-prueba";
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: any, init?: any) => {
      if (String(input).includes("challenges.cloudflare.com")) {
        return new Response(JSON.stringify({ success: acepta }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return original(input, init);
    });
  };

  const sinCaptcha = () => {
    vi.unstubAllGlobals();
    process.env.CAPTCHA_PROVIDER = "";
    process.env.CAPTCHA_SECRET_KEY = "";
    process.env.CAPTCHA_SITE_KEY = "";
  };

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-idem";
    process.env.PUBLIC_FORMS_RATE_MAX = "500";
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  beforeEach(async () => {
    await db("appointments").del();
  });

  afterEach(() => sinCaptcha());

  describe("el reintento tras una respuesta perdida no vuelve a pedir CAPTCHA", () => {
    it("devuelve la solicitud que ya existe aunque el token esté consumido", async () => {
      const key = clave();

      // 1. Primer envío válido, con CAPTCHA aceptado: la fila se crea.
      conCaptcha(true);
      const primero = await solicitar(valida({ submissionKey: key, captchaToken: "token-valido" }));
      expect(primero.status, await primero.clone().text()).toBe(201);
      const id = (await primero.json()).id;

      // 2. La respuesta se pierde en el camino. El cliente no sabe que
      //    funcionó y reintenta con la misma clave. Su token ya se consumió,
      //    así que ahora el proveedor lo rechaza.
      sinCaptcha();
      conCaptcha(false);
      const reintento = await solicitar(valida({ submissionKey: key, captchaToken: "token-ya-consumido" }));

      expect(reintento.status, "el reintento no puede rebotar por un token gastado").toBe(200);
      const cuerpo = await reintento.json();
      expect(cuerpo.id).toBe(id);
      expect(cuerpo.duplicate).toBe(true);
      expect(await cuantas(), "sigue habiendo una sola solicitud").toBe(1);
    });

    it("pero una clave nueva con CAPTCHA inválido sigue dando 400 y no inserta", async () => {
      // El control que impide que esto sea una omisión anti-spam: mover la
      // verificación después de la idempotencia no la desactiva.
      conCaptcha(false);
      const res = await solicitar(valida({ captchaToken: "token-que-no-vale" }));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/anti-spam/i);
      expect(await cuantas()).toBe(0);
    });
  });

  describe("la misma clave con otro contenido es un conflicto, no un éxito", () => {
    const distintos: [string, Record<string, unknown>][] = [
      ["el teléfono", { phone: "+595 981 999 888" }],
      ["el email", { email: "otro.paciente@ejemplo.test" }],
      ["el nombre", { name: "Otro Paciente" }],
      ["el mensaje", { message: "Otro detalle completamente distinto." }],
      ["la fecha preferida", { preferredAt: "2027-05-20T09:00" }],
    ];

    it.each(distintos)("cambió %s → 409 y la fila no se toca", async (_q, cambio) => {
      const key = clave();
      const primero = await solicitar(valida({ submissionKey: key }));
      expect(primero.status).toBe(201);
      const antes = await db("appointments").first();

      const segundo = await solicitar(valida({ submissionKey: key, ...cambio }));

      expect(segundo.status, "devolver 200 daría por registrada una solicitud distinta").toBe(409);
      expect(await cuantas()).toBe(1);
      expect(await db("appointments").first(), "la fila original se modificó").toEqual(antes);
    });

    it("el mensaje del 409 dice qué hacer", async () => {
      const key = clave();
      await solicitar(valida({ submissionKey: key }));
      const res = await solicitar(valida({ submissionKey: key, phone: "+595 981 999 888" }));
      expect((await res.json()).error).toMatch(/recarg[áa] el formulario/i);
    });

    it("un cambio que no altera el contenido guardado sigue siendo el mismo pedido", async () => {
      // El token del CAPTCHA, el honeypot y las marcas de tiempo no entran en
      // la comparación: si entraran, cualquier reintento legítimo daría 409.
      const key = clave();
      const primero = await solicitar(valida({ submissionKey: key, captchaToken: "uno" }));
      expect(primero.status).toBe(201);

      const segundo = await solicitar(valida({ submissionKey: key, captchaToken: "otro-distinto" }));
      expect(segundo.status).toBe(200);
      expect((await segundo.json()).id).toBe((await primero.json()).id);
    });

    it("una fecha preferida ausente y una vacía son el mismo pedido", async () => {
      const key = clave();
      const primero = await solicitar(valida({ submissionKey: key }));
      expect(primero.status).toBe(201);
      const segundo = await solicitar(valida({ submissionKey: key, preferredAt: "" }));
      expect(segundo.status).toBe(200);
    });
  });

  describe("la carrera contra el índice único", () => {
    it("con payload idéntico deja una sola fila", async () => {
      const key = clave();
      const cuerpo = valida({ submissionKey: key });
      const [a, b, c] = await Promise.all([solicitar(cuerpo), solicitar(cuerpo), solicitar(cuerpo)]);

      const estados = [a.status, b.status, c.status].sort();
      expect(estados.filter((s) => s === 201)).toHaveLength(1);
      expect(await cuantas()).toBe(1);

      const ids = await Promise.all([a.json(), b.json(), c.json()]);
      expect(new Set(ids.map((r) => r.id)).size, "todas tienen que apuntar a la misma").toBe(1);
    });

    it("con payloads distintos, la que pierde recibe 409 y no un id ajeno", async () => {
      const key = clave();
      const [a, b] = await Promise.all([
        solicitar(valida({ submissionKey: key })),
        solicitar(valida({ submissionKey: key, phone: "+595 981 777 666" })),
      ]);

      const estados = [a.status, b.status].sort();
      expect(estados).toEqual([201, 409]);
      expect(await cuantas()).toBe(1);
    });
  });

  describe("el orden del handler", () => {
    it("el honeypot corta antes que todo lo demás", async () => {
      conCaptcha(false);
      const res = await solicitar(valida({ website: "soy-un-bot", captchaToken: "cualquiera" }));
      // Ni CAPTCHA ni base: responde 201 para no confirmarle nada al bot.
      expect(res.status).toBe(201);
      expect((await res.json()).id).toBeNull();
      expect(await cuantas()).toBe(0);
    });

    it("la forma del payload se valida antes de tocar la base", async () => {
      conCaptcha(false);
      const res = await solicitar(valida({ email: "no-es-un-correo" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error, "el CAPTCHA no llegó a opinar").toBe("payload invalido");
      expect(await cuantas()).toBe(0);
    });

    it("una fecha inválida se rechaza antes de buscar la clave", async () => {
      const res = await solicitar(valida({ preferredAt: "no-es-una-fecha" }));
      expect(res.status).toBe(400);
      expect(await cuantas()).toBe(0);
    });
  });

  describe("los datos del paciente no llegan a los logs", () => {
    it("ni en el 409, ni en el reintento, ni con el CAPTCHA rechazado", async () => {
      const escrito: string[] = [];
      for (const nivel of ["log", "warn", "error", "info"] as const) {
        vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
          escrito.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
        });
      }
      try {
        const key = clave();
        await solicitar(valida({ submissionKey: key, captchaToken: "token-secreto-de-prueba" }));
        await solicitar(valida({ submissionKey: key, phone: "+595 981 999 888" }));
        conCaptcha(false);
        await solicitar(valida({ captchaToken: "otro-token-secreto" }));

        const todo = escrito.join("\n");
        for (const dato of [
          PACIENTE.name,
          PACIENTE.phone,
          PACIENTE.email,
          PACIENTE.message,
          "token-secreto-de-prueba",
          "otro-token-secreto",
          "insert into",
        ]) {
          expect(todo, `apareció "${dato}" en los logs`).not.toContain(dato);
        }
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
