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
 * La cadena de Turnos, de punta a punta.
 *
 * WhatsApp sigue siendo el canal con el que se coordina el turno. Lo que se
 * agrega es el **registro**: antes el formulario abría WhatsApp y no dejaba
 * rastro, así que una solicitud que no llegaba al chat no existía para nadie.
 *
 * Los casos de acá son los que rompen una implementación razonable:
 *
 * - el doble clic y el reintento crean dos solicitudes iguales;
 * - la fila se escribe pero la respuesta se pierde, y el cliente reintenta;
 * - un `doctorId` real con una especialidad que ese médico no ejerce entra sin
 *   protestar y le llega al operador como un dato plausible y equivocado;
 * - un filtro mal escrito devuelve 500 en vez de 400;
 * - el endpoint público filtra datos personales en la respuesta.
 *
 * Los nombres, teléfonos y correos de este archivo son inventados y viven sólo
 * en la base efímera de la prueba.
 *
 *   TEST_DATABASE=1 pnpm test tests/turnos-api.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_turnos`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const PUBLICA = "/api/public/appointments";
const ADMIN = "/api/admin/appointments";

const PACIENTE = {
  name: "Paciente De Prueba",
  phone: "+595 981 000 222",
  email: "paciente.de.prueba@ejemplo.test",
  message: "Necesito un turno por la mañana.",
};

let contador = 0;
const clave = () => `clave-de-prueba-${Date.now()}-${contador++}`;

describeDb("cadena de Turnos", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";
  let doctorId = 0;
  let especialidadDelDoctor = 0;
  let otraEspecialidad = 0;

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  const json = { "Content-Type": "application/json" };

  const solicitar = (body: Record<string, unknown>) =>
    fetch(`${baseUrl}${PUBLICA}`, { method: "POST", headers: json, body: JSON.stringify(body) });

  /** Una solicitud válida completa; se le pisan los campos que haga falta. */
  const valida = (extra: Record<string, unknown> = {}) => ({
    ...PACIENTE,
    consent: true,
    submissionKey: clave(),
    ...extra,
  });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-turnos";
    // Límites altos: acá se mandan decenas de solicitudes seguidas desde la
    // misma IP y el rate limit real las cortaría por un motivo ajeno a lo que
    // se está probando. Hay una prueba aparte que sí comprueba el límite.
    process.env.PUBLIC_FORMS_RATE_MAX = "500";
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "admin@sanatorio.local", password: TEST_ADMIN_PASSWORD }),
    });
    token = (await login.json()).token;

    const vinculo = await db("doctor_specialty").first();
    doctorId = vinculo.doctor_id;
    especialidadDelDoctor = vinculo.specialty_id;
    const otra = await db("specialties").whereNot({ id: especialidadDelDoctor }).first("id");
    otraEspecialidad = otra.id;
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

  // ------------------------------------------------------------- alta feliz

  describe("registro de la solicitud", () => {
    it("una solicitud válida se guarda y devuelve 201", async () => {
      const res = await solicitar(valida());
      const body = await res.json();

      expect(res.status, JSON.stringify(body)).toBe(201);
      expect(body.id).toBeGreaterThan(0);

      const fila = await db("appointments").first();
      expect(fila.name).toBe(PACIENTE.name);
      expect(fila.status).toBe("pendiente");
    });

    it("guarda el momento del consentimiento, no sólo que lo dio", async () => {
      await solicitar(valida());
      const fila = await db("appointments").first();
      expect(fila.consent_at, "sin consent_at no se sabe desde cuándo").toBeTruthy();
      expect(Math.abs(new Date(fila.consent_at).getTime() - Date.now())).toBeLessThan(120_000);
    });

    it("acepta médico y especialidad coherentes", async () => {
      const res = await solicitar(valida({ doctorId, specialtyId: especialidadDelDoctor }));
      expect(res.status, await res.clone().text()).toBe(201);
      const fila = await db("appointments").first();
      expect(fila.doctor_id).toBe(doctorId);
      expect(fila.specialty_id).toBe(especialidadDelDoctor);
    });

    it("acepta una fecha preferida y la guarda", async () => {
      const res = await solicitar(valida({ preferredAt: "2027-03-15T10:30" }));
      expect(res.status).toBe(201);
      expect((await db("appointments").first()).preferred_at).toBeTruthy();
    });

    it("la respuesta pública no devuelve ningún dato personal", async () => {
      const res = await solicitar(valida());
      const crudo = await res.text();

      expect(JSON.parse(crudo)).toEqual({ id: expect.any(Number) });
      for (const dato of [PACIENTE.name, PACIENTE.phone, PACIENTE.email, PACIENTE.message]) {
        expect(crudo, `se filtró "${dato}"`).not.toContain(dato);
      }
    });
  });

  // ----------------------------------------------------------- idempotencia

  describe("no se registra dos veces", () => {
    it("la misma clave devuelve la solicitud ya creada, sin insertar otra", async () => {
      const key = clave();
      const primera = await solicitar(valida({ submissionKey: key }));
      const segunda = await solicitar(valida({ submissionKey: key }));

      expect(primera.status).toBe(201);
      expect(segunda.status, "el reintento no crea una solicitud nueva").toBe(200);

      const a = await primera.json();
      const b = await segunda.json();
      expect(b.id).toBe(a.id);
      expect(b.duplicate).toBe(true);
      expect(await db("appointments").count({ n: "id" })).toEqual([{ n: 1 }]);
    });

    it("el doble clic simultáneo tampoco duplica", async () => {
      // Las dos peticiones salen juntas: las dos pasan el `select` previo y las
      // dos intentan insertar. Sin el índice único quedarían dos filas.
      const key = clave();
      const [a, b] = await Promise.all([
        solicitar(valida({ submissionKey: key })),
        solicitar(valida({ submissionKey: key })),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 201]);
      const ids = [(await a.json()).id, (await b.json()).id];
      expect(ids[0]).toBe(ids[1]);
      expect(await db("appointments").count({ n: "id" })).toEqual([{ n: 1 }]);
    });

    it("un reintento tras un timeout, con la fila ya creada, no duplica", async () => {
      // Se simula el caso peor: la fila se escribió y la respuesta se perdió.
      // El cliente reintenta con la misma clave porque nunca supo que funcionó.
      const key = clave();
      const primera = await solicitar(valida({ submissionKey: key }));
      const id = (await primera.json()).id;

      const reintento = await solicitar(valida({ submissionKey: key, message: "reintento" }));

      expect(reintento.status).toBe(200);
      expect((await reintento.json()).id).toBe(id);
      expect(await db("appointments").count({ n: "id" })).toEqual([{ n: 1 }]);
      // Y el reintento no pisa lo que ya se había guardado.
      expect((await db("appointments").first()).message).toBe(PACIENTE.message);
    });

    it("dos solicitudes distintas sí crean dos filas", async () => {
      // Control: la idempotencia es por clave, no un bloqueo general.
      await solicitar(valida());
      await solicitar(valida());
      expect(await db("appointments").count({ n: "id" })).toEqual([{ n: 2 }]);
    });
  });

  // -------------------------------------------------------------- validación

  describe("validación del payload", () => {
    const casos: [string, Record<string, unknown>][] = [
      ["sin nombre", { name: "" }],
      ["sin teléfono", { phone: "" }],
      ["con un correo inválido", { email: "no-es-un-correo" }],
      ["sin consentimiento", { consent: undefined }],
      ["con el consentimiento en false", { consent: false }],
      ["sin clave de envío", { submissionKey: undefined }],
      ["con una clave de envío con formato inválido", { submissionKey: "clave con espacios" }],
      ["con una fecha preferida inválida", { preferredAt: "no-es-una-fecha" }],
    ];

    it.each(casos)("%s → 400 y no escribe nada", async (_q, extra) => {
      const body = valida(extra);
      for (const [k, v] of Object.entries(extra)) if (v === undefined) delete (body as any)[k];

      const res = await solicitar(body);

      expect(res.status, await res.clone().text()).toBe(400);
      expect(await db("appointments").count({ n: "id" })).toEqual([{ n: 0 }]);
    });

    it("un payload roto da 400, nunca 500", async () => {
      const res = await fetch(`${baseUrl}${PUBLICA}`, { method: "POST", headers: json, body: "{}" });
      expect(res.status).toBe(400);
    });
  });

  describe("referencias de médico y especialidad", () => {
    it("una especialidad inexistente da 400", async () => {
      const res = await solicitar(valida({ specialtyId: 999_999 }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/especialidad/i);
    });

    it("un médico inexistente da 400", async () => {
      const res = await solicitar(valida({ doctorId: 999_999 }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/médico/i);
    });

    it("un médico real con una especialidad que no atiende da 400", async () => {
      // El caso que no falla solo: los dos ids existen, la FK está contenta, y
      // el operador recibe un dato plausible y equivocado.
      const res = await solicitar(valida({ doctorId, specialtyId: otraEspecialidad }));
      expect(res.status, await res.clone().text()).toBe(400);
      expect((await res.json()).error).toMatch(/no atiende esa especialidad/i);
      expect(await db("appointments").count({ n: "id" })).toEqual([{ n: 0 }]);
    });
  });

  describe("anti-spam", () => {
    it("el honeypot responde 201 y no guarda nada", async () => {
      const res = await solicitar(valida({ website: "soy-un-bot" }));
      expect(res.status, "responder 400 le confirmaría al bot que lo detectamos").toBe(201);
      expect((await res.json()).id).toBeNull();
      expect(await db("appointments").count({ n: "id" })).toEqual([{ n: 0 }]);
    });

    it("sin CAPTCHA configurado la solicitud pasa igual", async () => {
      // Es el estado real del proyecto: sin las tres variables, la
      // verificación está desactivada y el formulario tiene que funcionar.
      const res = await solicitar(valida());
      expect(res.status).toBe(201);
    });

    it("con CAPTCHA configurado, un token rechazado da 400 y no guarda", async () => {
      const previo = {
        p: process.env.CAPTCHA_PROVIDER,
        s: process.env.CAPTCHA_SECRET_KEY,
        k: process.env.CAPTCHA_SITE_KEY,
      };
      process.env.CAPTCHA_PROVIDER = "turnstile";
      process.env.CAPTCHA_SECRET_KEY = "secreto-de-prueba";
      process.env.CAPTCHA_SITE_KEY = "site-de-prueba";
      const fetchOriginal = globalThis.fetch;
      // Sólo se intercepta la verificación del proveedor; el resto sigue real.
      vi.stubGlobal("fetch", async (input: any, init?: any) => {
        if (String(input).includes("challenges.cloudflare.com")) {
          return new Response(JSON.stringify({ success: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return fetchOriginal(input, init);
      });
      try {
        const res = await solicitar(valida({ captchaToken: "token-que-no-vale" }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/anti-spam/i);
        expect(await db("appointments").count({ n: "id" })).toEqual([{ n: 0 }]);
      } finally {
        vi.unstubAllGlobals();
        process.env.CAPTCHA_PROVIDER = previo.p ?? "";
        process.env.CAPTCHA_SECRET_KEY = previo.s ?? "";
        process.env.CAPTCHA_SITE_KEY = previo.k ?? "";
      }
    });
  });

  // ------------------------------------------------------------------ admin

  describe("la bandeja exige autenticación", () => {
    it.each([
      ["GET", ADMIN],
      ["PUT", `${ADMIN}/1`],
      ["DELETE", `${ADMIN}/1`],
    ])("%s %s sin token → 401", async (method, ruta) => {
      const res = await fetch(`${baseUrl}${ruta}`, {
        method,
        headers: json,
        body: method === "PUT" ? JSON.stringify({ status: "confirmado" }) : undefined,
      });
      expect(res.status).toBe(401);
    });
  });

  describe("bandeja administrativa", () => {
    let ids: number[] = [];

    beforeEach(async () => {
      ids = [];
      for (const [i, nombre] of ["Ana Prueba", "Bruno Prueba", "Carla Prueba"].entries()) {
        const res = await solicitar(
          valida({
            name: nombre,
            email: `paciente${i}@ejemplo.test`,
            phone: `+595 981 000 ${100 + i}`,
            ...(i === 0 ? { doctorId, specialtyId: especialidadDelDoctor } : {}),
          }),
        );
        ids.push((await res.json()).id);
      }
      await db("appointments").where({ id: ids[1] }).update({ status: "confirmado" });
      await db("appointments").where({ id: ids[2] }).update({ created_at: new Date("2020-01-15T10:00:00Z") });
    });

    const listar = async (qs = "") => {
      const res = await fetch(`${baseUrl}${ADMIN}${qs}`, { headers: auth() });
      expect(res.status, await res.clone().text()).toBe(200);
      return res.json();
    };

    it("devuelve las solicitudes con el total y el médico resueltos", async () => {
      const body = await listar();
      expect(body.total).toBe(3);
      expect(body.items).toHaveLength(3);
      const conMedico = body.items.find((t: any) => t.id === ids[0]);
      expect(conMedico.doctor_name, "el nombre del médico se resuelve en el servidor").toBeTruthy();
      expect(conMedico.specialty_name).toBeTruthy();
    });

    it("filtra por estado", async () => {
      const body = await listar("?status=confirmado");
      expect(body.total).toBe(1);
      expect(body.items[0].id).toBe(ids[1]);
    });

    it("filtra por rango de fechas, incluyendo el día completo del 'hasta'", async () => {
      const body = await listar("?from=2020-01-01&to=2020-01-15");
      expect(body.total, "el 'hasta' tiene que incluir todo ese día").toBe(1);
      expect(body.items[0].id).toBe(ids[2]);
    });

    it("busca por nombre", async () => {
      const body = await listar("?q=Bruno");
      expect(body.total).toBe(1);
      expect(body.items[0].name).toBe("Bruno Prueba");
    });

    it("busca por especialidad y por médico", async () => {
      const fila = await db("appointments").where({ id: ids[0] }).first();
      const especialidad = await db("specialties").where({ id: fila.specialty_id }).first("name");
      const body = await listar(`?q=${encodeURIComponent(especialidad.name)}`);
      expect(body.items.some((t: any) => t.id === ids[0])).toBe(true);
    });

    it("los comodines de LIKE se buscan como texto", async () => {
      // Sin escapar, `%` devuelve todo y el operador cree que su búsqueda
      // encontró tres coincidencias.
      const body = await listar("?q=%");
      expect(body.total).toBe(0);
    });

    it("un filtro de estado inventado da 400, no 500", async () => {
      const res = await fetch(`${baseUrl}${ADMIN}?status=inventado`, { headers: auth() });
      expect(res.status, "una excepción de Zod se convertía en 500").toBe(400);
    });

    it("una fecha mal formada da 400", async () => {
      const res = await fetch(`${baseUrl}${ADMIN}?from=15-01-2020`, { headers: auth() });
      expect(res.status).toBe(400);
    });

    it("respeta el límite y el desplazamiento", async () => {
      const body = await listar("?limit=2&offset=0");
      expect(body.items).toHaveLength(2);
      expect(body.total, "el total es del filtro, no de la página").toBe(3);
      expect(body.limit).toBe(2);
    });

    it("un límite disparatado se rechaza", async () => {
      const res = await fetch(`${baseUrl}${ADMIN}?limit=100000`, { headers: auth() });
      expect(res.status).toBe(400);
    });

    describe("cambio de estado", () => {
      it("pasa por los tres estados y mueve updated_at", async () => {
        for (const estado of ["confirmado", "cancelado", "pendiente"]) {
          const res = await fetch(`${baseUrl}${ADMIN}/${ids[0]}`, {
            method: "PUT",
            headers: auth(),
            body: JSON.stringify({ status: estado }),
          });
          expect(res.status, await res.clone().text()).toBe(200);
          expect((await res.json()).status).toBe(estado);
        }
        const fila = await db("appointments").where({ id: ids[0] }).first();
        expect(fila.updated_at, "sin updated_at no se sabe cuándo se atendió").toBeTruthy();
      });

      it("un estado inválido da 400", async () => {
        const res = await fetch(`${baseUrl}${ADMIN}/${ids[0]}`, {
          method: "PUT",
          headers: auth(),
          body: JSON.stringify({ status: "en-tramite" }),
        });
        expect(res.status).toBe(400);
      });

      it("una solicitud inexistente da 404", async () => {
        const res = await fetch(`${baseUrl}${ADMIN}/999999`, {
          method: "PUT",
          headers: auth(),
          body: JSON.stringify({ status: "confirmado" }),
        });
        expect(res.status).toBe(404);
      });
    });

    describe("eliminación", () => {
      it("elimina y devuelve 204", async () => {
        const res = await fetch(`${baseUrl}${ADMIN}/${ids[0]}`, { method: "DELETE", headers: auth() });
        expect(res.status).toBe(204);
        expect(await db("appointments").where({ id: ids[0] }).first()).toBeUndefined();
      });

      it("una solicitud inexistente da 404, no 204", async () => {
        // Devolver 204 hacía pasar por éxito el borrado de algo que no existe.
        const res = await fetch(`${baseUrl}${ADMIN}/999999`, { method: "DELETE", headers: auth() });
        expect(res.status).toBe(404);
      });
    });
  });

  // ------------------------------------------------------------------- logs

  describe("los datos del paciente no llegan a los logs", () => {
    afterEach(() => vi.restoreAllMocks());

    it("ni en el alta correcta ni en un fallo de la base", async () => {
      const escrito: string[] = [];
      for (const nivel of ["log", "warn", "error", "info"] as const) {
        vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
          escrito.push(args.map((a) => (a instanceof Error ? `${a.message}` : String(a))).join(" "));
        });
      }

      await solicitar(valida({ captchaToken: "token-de-prueba-que-no-se-loguea" }));

      // Y un fallo real de la base: el error de mysql2 trae el SQL con los
      // valores incrustados, así que es el camino por donde se filtraría. Se
      // vacía la tabla antes de achicar la columna, o el ALTER falla por las
      // filas que ya están y el fallo que se quiere provocar nunca ocurre.
      await db("appointments").del();
      await db.schema.alterTable("appointments", (t) => t.string("name", 5).alter());
      try {
        const res = await solicitar(valida({ name: "Un nombre bastante más largo que cinco" }));
        expect(res.status, "el fallo de base no puede filtrar internals").toBe(500);
        expect((await res.json()).error).not.toMatch(/insert|appointments|varchar/i);
      } finally {
        await db.schema.alterTable("appointments", (t) => t.string("name", 191).alter());
      }

      const todo = escrito.join("\n");
      for (const dato of [PACIENTE.phone, PACIENTE.email, PACIENTE.message, "token-de-prueba-que-no-se-loguea"]) {
        expect(todo, `apareció "${dato}" en los logs`).not.toContain(dato);
      }
    });
  });
});
