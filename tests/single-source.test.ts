import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  applyDbEnv,
  createTestDatabase,
  dropTestDatabase,
  closeAppDb,
  closeServer,
  migrateLatest,
  runSeeds,
  TEST_ADMIN_PASSWORD,
} from "./helpers/db";

/**
 * Fuente única: `contact_channels` y `schedules`.
 *
 * Teléfonos, WhatsApp, correos, Emergencias, GTH y redes salen de
 * `contact_channels`; los horarios, de `schedules`. Antes también vivían en
 * `settings.contact` y `settings.social`, el panel dejaba editar los dos lados
 * y un dato podía quedar distinto según dónde se mirara.
 *
 * Se verifica lo que importa: que cambiar el dato en la tabla lo cambie en
 * todos los consumidores, y que los campos viejos no se puedan volver a crear.
 *
 *   TEST_DATABASE=1 pnpm test tests/single-source.test.ts
 */

const ROOT = resolve(__dirname, "..");
const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_source`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

/** Campos que ya no viven en `settings`. */
const RETIRED_CONTACT_FIELDS = ["phones", "email", "whatsapp", "hours", "emergencyPhone", "gthEmail"];

describe("el front no lee datos de contacto desde settings", () => {
  const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

  it("ningún componente usa los campos retirados de settings.contact", () => {
    const files = import.meta.glob("../apps/web/src/**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(files)) {
      // Los comentarios sí mencionan los campos viejos, para explicar por qué
      // ya no se usan: interesa el código.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      for (const field of RETIRED_CONTACT_FIELDS) {
        if (new RegExp(`contact\\??\\.${field}\\b`).test(code)) offenders.push(`${path}: ${field}`);
      }
      if (/settings\??\.social\b/.test(code)) offenders.push(`${path}: social`);
    }
    expect(offenders).toEqual([]);
  });

  it("el panel ya no ofrece cargar scripts personalizados", () => {
    // El formulario prometía algo que la API nunca guardaba, y lo que prometía
    // era inyectar JavaScript arbitrario en el sitio. Meta Pixel, Google Ads y
    // Analytics van a entrar por módulos propios.
    const page = read("apps/admin/src/pages/SettingsPage.tsx");
    expect(page).not.toMatch(/scripts/i);
    expect(page).not.toMatch(/headScripts|bodyEnd/);

    const files = import.meta.glob("../apps/admin/src/**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const offenders = Object.entries(files)
      .filter(([, source]) => /settings\??\.scripts\b|"scripts"|'scripts'/.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("el pie, el header y el JSON-LD leen de los canales y los horarios", () => {
    const layout = read("apps/web/src/components/Layout.tsx");
    expect(layout).toContain("useContactChannels");
    expect(layout).toContain("useSchedules");
    expect(layout).toContain("socialChannels");

    const app = read("apps/web/src/App.tsx");
    expect(app).toContain("useContactChannels");
    expect(app).toContain("socialChannels");

    const social = read("apps/web/src/blocks/SocialLinks.tsx");
    expect(social).toContain("socialChannels");
  });

  it("el panel ya no ofrece esos campos", () => {
    const settingsPage = read("apps/admin/src/pages/SettingsPage.tsx");
    for (const field of RETIRED_CONTACT_FIELDS) {
      expect(settingsPage, `SettingsPage todavía edita ${field}`).not.toContain(`{ ${field}:`);
    }
    expect(settingsPage).not.toContain('setKey("social"');
  });

  it("el tipo compartido ya no los declara", () => {
    const types = read("shared/types/index.ts");
    const contactBlock = /contact: \{([\s\S]*?)\n  \};/.exec(types);
    expect(contactBlock).toBeTruthy();
    for (const field of RETIRED_CONTACT_FIELDS) {
      expect(contactBlock![1], `el tipo todavía declara ${field}`).not.toContain(`${field}`);
    }
  });
});

describeDb("un cambio en la tabla llega a todos los consumidores", () => {
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
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-fuente-unica";
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

  it("cambiar un canal desde el panel cambia lo que ve el sitio", async () => {
    const row = await db("contact_channels").where({ key: "emergencias" }).first("id");
    const res = await fetch(`${baseUrl}/api/admin/contact-channels/${row.id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ value: "+595 21 999 111", active: true }),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const publicChannels = await (await fetch(`${baseUrl}/api/public/contact-channels`)).json();
    const emergencias = publicChannels.find((c: { key: string }) => c.key === "emergencias");
    expect(emergencias.value).toBe("+595 21 999 111");

    // Y no aparece por ningún otro lado: settings no lo guarda.
    const settings = await (await fetch(`${baseUrl}/api/public/settings`)).json();
    expect(JSON.stringify(settings)).not.toContain("999 111");
  });

  it("cambiar una red desde el panel cambia lo que ve el sitio", async () => {
    const row = await db("contact_channels").where({ key: "facebook" }).first("id");
    expect(row, "las redes tienen que existir como canales").toBeTruthy();
    const res = await fetch(`${baseUrl}/api/admin/contact-channels/${row.id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ href: "https://facebook.com/sanatorio-prueba", active: true }),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const publicChannels = await (await fetch(`${baseUrl}/api/public/contact-channels`)).json();
    const facebook = publicChannels.find((c: { key: string }) => c.key === "facebook");
    expect(facebook.href).toBe("https://facebook.com/sanatorio-prueba");
  });

  it("cambiar un horario desde el panel cambia lo que ve el sitio", async () => {
    const row = await db("schedules").first("id", "key");
    const res = await fetch(`${baseUrl}/api/admin/schedules/${row.id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ hours: "08:00 a 16:00", active: true }),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const schedules = await (await fetch(`${baseUrl}/api/public/schedules`)).json();
    expect(schedules.find((s: { key: string }) => s.key === row.key).hours).toBe("08:00 a 16:00");

    const settings = await (await fetch(`${baseUrl}/api/public/settings`)).json();
    expect(JSON.stringify(settings)).not.toContain("08:00 a 16:00");
  });

  it("los campos legacy no se pueden volver a crear desde la API", async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({
        contact: {
          address: "Dirección de prueba",
          phones: ["+595 21 000 000"],
          email: "reintroducido@ejemplo.test",
          whatsapp: "+595981000000",
          hours: "Lunes a viernes de 7 a 19",
          emergencyPhone: "+595 21 111 111",
          gthEmail: "gth@ejemplo.test",
        },
      }),
    });
    // Antes esto respondía 200 y la API borraba los campos en silencio: quien
    // los mandaba creía haber guardado. Desde PR #12 se rechaza el PUT entero
    // con 410 y ni siquiera la dirección —que sí es administrable— se escribe.
    expect(res.status).toBe(410);
    const body = await res.json();
    for (const field of RETIRED_CONTACT_FIELDS) {
      expect(body.rejected, `no se reportó ${field}`).toContain(`contact.${field}`);
    }

    const stored = await db("settings").where({ key: "contact" }).first("value");
    const contact = typeof stored.value === "string" ? JSON.parse(stored.value) : stored.value;
    expect(contact.address, "el PUT rechazado no puede haber escrito nada").not.toBe("Dirección de prueba");
    for (const field of RETIRED_CONTACT_FIELDS) {
      expect(contact, `se pudo recrear ${field}`).not.toHaveProperty(field);
    }
  });

  it("la clave social ya no se puede escribir", async () => {
    const direct = await fetch(`${baseUrl}/api/admin/settings/social`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ facebook: "https://facebook.com/otro" }),
    });
    expect(direct.status).toBe(410);

    // Tampoco por el PUT masivo, y ya no en silencio: antes respondía
    // `{ok:true}` y el panel decía "Guardado" sobre algo que se descartó.
    const masivo = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ social: { facebook: "https://facebook.com/otro" } }),
    });
    expect(masivo.status).toBe(410);
    expect((await masivo.json()).rejected).toEqual(["social"]);
    expect(await db("settings").where({ key: "social" }).first()).toBeUndefined();
  });

  it("la clave scripts tampoco se puede escribir", async () => {
    // El panel ofrecía "Scripts personalizados" y la API los vaciaba siempre:
    // se guardaba, decía "Guardado" y no quedaba nada. Ahora el campo no está
    // y la clave se rechaza explícitamente.
    const direct = await fetch(`${baseUrl}/api/admin/settings/scripts`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ head: "<script>alert(1)</script>", bodyEnd: "" }),
    });
    expect(direct.status).toBe(410);
    expect((await direct.json()).error).toMatch(/JavaScript arbitrario/i);

    const masivo = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ scripts: { head: "<script>alert(1)</script>" } }),
    });
    expect(masivo.status).toBe(410);
    expect(await db("settings").where({ key: "scripts" }).first()).toBeUndefined();
  });

  it("una clave retirada no arrastra al resto del payload", async () => {
    // El PUT masivo es todo o nada: si se rechaza, no se guarda nada.
    const antes = await db("settings").where({ key: "seo" }).first("value");
    const res = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({
        seo: { title: "Título que no se debe guardar" },
        scripts: { head: "" },
      }),
    });
    expect(res.status).toBe(410);
    const despues = await db("settings").where({ key: "seo" }).first("value");
    expect(despues.value).toEqual(antes.value);
  });

  it("los ajustes administrables no incluyen las claves retiradas", async () => {
    // El panel guarda de vuelta lo que recibe: si se las devolviéramos, cada
    // guardado reenviaría una clave que la API rechaza.
    const settings = await (await fetch(`${baseUrl}/api/admin/settings`, { headers: auth() })).json();
    expect(settings.scripts).toBeUndefined();
    expect(settings.social).toBeUndefined();
    expect(settings.brand).toBeTruthy();
  });

  it("los ajustes públicos no filtran los snapshots de las migraciones", async () => {
    const settings = await (await fetch(`${baseUrl}/api/public/settings`)).json();
    // `captcha` no sale de la base: es la config pública del entorno (null
    // mientras el sanatorio no cargue las claves).
    expect(Object.keys(settings).sort()).toEqual(["brand", "captcha", "contact", "seo", "theme"]);
    expect(settings.captcha).toBeNull();
    // En la tabla sí están: lo que cambió es qué se publica.
    const internos = await db("settings").where("key", "like", "snapshot_%");
    expect(internos.length).toBeGreaterThan(0);
  });
});
