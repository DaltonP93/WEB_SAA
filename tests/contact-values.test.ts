import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  isValidChannelEmail,
  isValidChannelPhone,
  isValidChannelUrl,
  isValidChannelWhatsapp,
  publicChannelValues,
} from "@sa/shared/contact-values";
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
 * Los valores de `contact_channels` se validan según su tipo.
 *
 * `href` era "cualquier string" y en un canal `kind: "url"` termina directo en
 * un `<a href>` del sitio público: un `javascript:` guardado desde el panel se
 * convertía en un enlace ejecutable para cualquier visitante.
 *
 *   TEST_DATABASE=1 pnpm test tests/contact-values.test.ts
 */

const ROOT = resolve(__dirname, "..");
const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_channels`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

/** Destinos que no pueden guardarse ni publicarse, pase lo que pase. */
const BAD_URLS = [
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "java&#115;cript:alert(1)",
  "java\tscript:alert(1)",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "//evil.test/perfil",
  "\\\\evil.test\\perfil",
  "https://evil.test\\@bueno.test",
  "/interno/relativo",
  "perfil-sin-esquema",
  "http://facebook.com/sanatorio", // sin TLS
  "https://localhost/perfil", // host sin punto
];

describe("validación por tipo de canal", () => {
  it("url: sólo HTTPS con host real", () => {
    expect(isValidChannelUrl("https://facebook.com/sanatorio")).toBe(true);
    expect(isValidChannelUrl("https://www.instagram.com/sanatorio/")).toBe(true);
    for (const bad of BAD_URLS) {
      expect(isValidChannelUrl(bad), bad).toBe(false);
    }
  });

  it("email: dirección con forma válida", () => {
    expect(isValidChannelEmail("gth@sanatorio.test")).toBe(true);
    for (const bad of ["sin-arroba", "a@b", "con espacio@x.test", "javascript:alert(1)@x.test", ""]) {
      expect(isValidChannelEmail(bad), bad).toBe(false);
    }
  });

  it("phone: dígitos con separadores de lectura", () => {
    expect(isValidChannelPhone("+595 21 000 000")).toBe(true);
    expect(isValidChannelPhone("(021) 123-456")).toBe(true);
    for (const bad of ["12345", "no-es-un-telefono", "+595 21 000 000 000 000", "javascript:1"]) {
      expect(isValidChannelPhone(bad), bad).toBe(false);
    }
  });

  it("whatsapp: número internacional", () => {
    expect(isValidChannelWhatsapp("+595981123456")).toBe(true);
    // Demasiado corto para armar un wa.me válido.
    expect(isValidChannelWhatsapp("123456")).toBe(false);
  });

  it("la salida pública descarta lo que no valida", () => {
    expect(
      publicChannelValues({ kind: "url", value: "javascript:alert(1)", href: "javascript:alert(1)" }),
    ).toMatchObject({ value: null, href: null });
    expect(
      publicChannelValues({ kind: "whatsapp", value: "no-es-numero", href: null }),
    ).toMatchObject({ value: null });
    expect(
      publicChannelValues({ kind: "url", value: "https://facebook.com/x", href: "https://facebook.com/x" }),
    ).toMatchObject({ value: "https://facebook.com/x", href: "https://facebook.com/x" });
  });
});

describe("copias del validador", () => {
  it("shared y api son idénticas byte a byte", () => {
    const shared = readFileSync(resolve(ROOT, "shared/types/contact-values.ts"), "utf8");
    const api = readFileSync(resolve(ROOT, "api/src/contact-values.ts"), "utf8");
    expect(api).toBe(shared);
  });

  it("el front valida antes de poner el destino en un <a href>", () => {
    const lib = readFileSync(resolve(ROOT, "apps/web/src/lib/contact-channels.ts"), "utf8");
    expect(lib).toContain("isValidChannelUrl");
    expect(lib).toContain("isValidChannelValue");
  });
});

describeDb("la API rechaza destinos peligrosos", () => {
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
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-canales";
    const { createApp } = await import("../api/src/app.js");
    const app = createApp();
    await new Promise<void>((resolvePromise) => {
      server = app.listen(0, () => resolvePromise());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@sanatorio.local", password: TEST_ADMIN_PASSWORD }),
    });
    token = (await login.json()).token;
  }, 180_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  describe("alta", () => {
    it.each(BAD_URLS)("rechaza crear un canal url con %s", async (href) => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          key: `prueba-${Math.random().toString(36).slice(2, 8)}`,
          label: "Prueba",
          kind: "url",
          href,
        }),
      });
      expect(res.status, href).toBe(400);
    });

    it("acepta una URL https legítima", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          key: "prueba-valida",
          label: "Perfil de prueba",
          kind: "url",
          href: "https://facebook.com/sanatorio-prueba",
        }),
      });
      expect(res.status, await res.clone().text()).toBe(201);
    });

    it("rechaza un teléfono que no es un teléfono", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          key: "prueba-telefono",
          label: "Teléfono",
          kind: "phone",
          value: "llamá al doctor",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("rechaza un correo mal formado", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          key: "prueba-correo",
          label: "Correo",
          kind: "email",
          value: "no-es-un-correo",
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("edición", () => {
    it("rechaza cambiar el href a javascript:", async () => {
      const row = await db("contact_channels").where({ key: "facebook" }).first("id", "href");
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${row.id}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ href: "javascript:alert(1)" }),
      });
      expect(res.status).toBe(400);
      const after = await db("contact_channels").where({ id: row.id }).first("href");
      expect(after.href).toBe(row.href);
    });

    it("valida contra el kind guardado aunque el payload no lo mande", async () => {
      // El PUT es parcial: sin `kind` en el body hay que mirar la fila.
      const row = await db("contact_channels").where({ key: "whatsapp-turnos" }).first("id");
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${row.id}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ value: "no-es-un-numero" }),
      });
      expect(res.status).toBe(400);
    });

    it("acepta un valor válido para su tipo", async () => {
      const row = await db("contact_channels").where({ key: "whatsapp-turnos" }).first("id");
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${row.id}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ value: "+595981123456", active: true }),
      });
      expect(res.status, await res.clone().text()).toBe(200);
    });
  });

  it("un href peligroso escrito con SQL tampoco se publica", async () => {
    // Filas viejas o escritas fuera de la API: la salida pública las filtra.
    await db("contact_channels")
      .where({ key: "facebook" })
      .update({ href: "javascript:alert(1)", value: "javascript:alert(1)", active: true });

    const body = await (await fetch(`${baseUrl}/api/public/contact-channels`)).text();
    expect(body.toLowerCase()).not.toContain("javascript:");
    const channels = JSON.parse(body);
    const facebook = channels.find((c: { key: string }) => c.key === "facebook");
    expect(facebook.href).toBeNull();
    expect(facebook.value).toBeNull();
  });
});
