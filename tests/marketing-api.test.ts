import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  TEST_ADMIN_PASSWORD,
  applyDbEnv,
  closeAppDb,
  closeServer,
  createTestDatabase,
  dropTestDatabase,
  jsonColumn,
  migrateLatest,
  runSeeds,
} from "./helpers/db";

/**
 * Marketing de punta a punta, contra la base.
 *
 * Dos contratos que sólo se pueden comprobar con la API entera corriendo:
 *
 * 1. **La clave `analytics`** se valida al escribir (400 con IDs mal formados),
 *    se normaliza al guardar y se expone en `/public/settings`.
 * 2. **La atribución** viaja con una conversión, se sanea, se guarda, la
 *    devuelve el panel y aparece en el CSV — y **nunca** en los logs.
 *
 *   TEST_DATABASE=1 pnpm test tests/marketing-api.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_mkt`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("marketing: analítica y atribución", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-mkt";
    // Sin CAPTCHA configurado, `verifyCaptcha` deja pasar: acá se prueba
    // atribución, no anti-spam.
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@sanatorio.local", password: TEST_ADMIN_PASSWORD }),
    });
    token = (await login.json()).token;
    expect(token).toBeTruthy();
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  describe("la clave analytics", () => {
    it("guarda IDs válidos, los normaliza y los expone en público", async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({
          analytics: { ga4: "  G-ABC12345 ", gtm: "GTM-ABCD12", metaPixel: "1234567890", basura: "x" },
        }),
      });
      expect(res.status, await res.clone().text()).toBe(200);

      // En la base quedó la forma normalizada: sin la clave `basura`, recortado.
      const fila = await db("settings").where({ key: "analytics" }).first();
      const guardado = jsonColumn<any>(fila.value);
      expect(guardado).toEqual({ ga4: "G-ABC12345", gtm: "GTM-ABCD12", metaPixel: "1234567890" });

      const pub = await (await fetch(`${baseUrl}/api/public/settings`)).json();
      expect(pub.analytics).toEqual({ ga4: "G-ABC12345", gtm: "GTM-ABCD12", metaPixel: "1234567890" });
    });

    it("rechaza un ID mal formado con 400 y no guarda nada nuevo", async () => {
      const antes = await db("settings").where({ key: "analytics" }).first();
      const res = await fetch(`${baseUrl}/api/admin/settings`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ analytics: { ga4: "no-es-un-id" } }),
      });
      expect(res.status).toBe(400);

      const despues = await db("settings").where({ key: "analytics" }).first();
      expect(despues?.value, "un payload inválido pisó lo guardado").toEqual(antes?.value);
    });

    it("el endpoint por clave también rechaza un ID inválido con 400", async () => {
      // `PUT /:key` es otra puerta al mismo dato: si sólo validara el PUT
      // masivo, un cliente podría colar basura por acá. Sin la validación, un
      // valor malo se guardaría vacío y respondería 200 —un éxito falso—.
      const res = await fetch(`${baseUrl}/api/admin/settings/analytics`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ ga4: "no-es-id" }),
      });
      expect(res.status).toBe(400);
    });

    it("public/settings devuelve la forma vacía cuando nunca se configuró", async () => {
      await db("settings").where({ key: "analytics" }).del();
      const pub = await (await fetch(`${baseUrl}/api/public/settings`)).json();
      expect(pub.analytics).toEqual({ ga4: "", gtm: "", metaPixel: "" });
    });
  });

  describe("la atribución de una conversión", () => {
    const clave = () => `mkt-${Math.random().toString(36).slice(2, 12)}`;

    it("se guarda saneada en el turno y la devuelve el panel", async () => {
      const res = await fetch(`${baseUrl}/api/public/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Paciente Marketing",
          phone: "0981000111",
          email: "paciente.mkt@ejemplo.test",
          consent: true,
          submissionKey: clave(),
          attribution: {
            utm_source: "instagram",
            utm_campaign: "verano-2026",
            role: "superadmin", // fuera de la allowlist: no debe sobrevivir
            utm_medium: "social<script>",
          },
        }),
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const { id } = await res.json();

      const fila = await db("appointments").where({ id }).first();
      const guardada = jsonColumn<any>(fila.attribution);
      expect(guardada).toEqual({
        utm_source: "instagram",
        utm_campaign: "verano-2026",
        utm_medium: "socialscript",
      });
      expect(JSON.stringify(guardada)).not.toContain("superadmin");

      // El panel la devuelve ya parseada.
      const lista = await (await fetch(`${baseUrl}/api/admin/appointments`, { headers: auth() })).json();
      const enPanel = lista.items.find((t: any) => t.id === id);
      expect(enPanel.attribution.utm_source).toBe("instagram");
    });

    it("un turno sin atribución guarda null y responde 201 igual", async () => {
      const res = await fetch(`${baseUrl}/api/public/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Paciente Directo",
          phone: "0981222333",
          email: "directo@ejemplo.test",
          consent: true,
          submissionKey: clave(),
        }),
      });
      expect(res.status).toBe(201);
      const { id } = await res.json();
      const fila = await db("appointments").where({ id }).first();
      expect(fila.attribution).toBeNull();
    });

    it("aparece en el CSV de exportación", async () => {
      const res = await fetch(`${baseUrl}/api/admin/appointments/export`, { headers: auth() });
      const csv = await res.text();
      expect(csv).toContain("Origen");
      expect(csv).toContain("Campaña");
      expect(csv).toContain("instagram");
      expect(csv).toContain("verano-2026");
    });

    it("un mensaje de contacto también guarda su atribución", async () => {
      const res = await fetch(`${baseUrl}/api/public/contact-messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Consulta Marketing",
          email: "consulta.mkt@ejemplo.test",
          message: "Quisiera más información sobre estudios.",
          attribution: { utm_source: "google", gclid: "abc123" },
        }),
      });
      expect(res.status, await res.clone().text()).toBe(201);

      const lista = await (await fetch(`${baseUrl}/api/admin/contact-messages`, { headers: auth() })).json();
      const msg = lista.find((m: any) => m.email === "consulta.mkt@ejemplo.test");
      expect(msg.attribution).toEqual({ utm_source: "google", gclid: "abc123" });
    });

    it("la atribución NO va a los logs", async () => {
      const chunks: string[] = [];
      const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
        chunks.push(String(c));
        return true;
      });
      const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((c: any) => {
        chunks.push(String(c));
        return true;
      });

      try {
        await fetch(`${baseUrl}/api/public/appointments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Paciente Log",
            phone: "0981444555",
            email: "log@ejemplo.test",
            consent: true,
            submissionKey: clave(),
            attribution: { utm_campaign: "CAMPANA-SECRETA-EN-LOG" },
          }),
        });
        // morgan escribe en el próximo tick.
        await new Promise((r) => setTimeout(r, 40));
      } finally {
        outSpy.mockRestore();
        errSpy.mockRestore();
      }

      const todo = chunks.join("");
      expect(todo, "la campaña apareció en los logs").not.toContain("CAMPANA-SECRETA-EN-LOG");
    });
  });
});
