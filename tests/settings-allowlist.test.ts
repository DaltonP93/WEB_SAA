import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
 * El panel administra ajustes, no la mecánica interna del sistema.
 *
 * `GET /api/admin/settings` devolvía la tabla entera: los `snapshot_*` que
 * dejan las migraciones para poder revertirse, `seed_generation`, los
 * `*_backup_*`. Y `SettingsPage` guardaba esa respuesta en su estado y la
 * reenviaba completa al guardar. Cada "Guardar cambios" era una ida y vuelta
 * de datos que el panel no entiende: alcanzaba con que la serialización
 * cambiara un byte para dejar sin efecto el `down()` de una migración.
 *
 * Ahora hay una allowlist explícita: brand, theme, contact y seo.
 *
 *   TEST_DATABASE=1 pnpm test tests/settings-allowlist.test.ts
 */

const ROOT = resolve(__dirname, "..");
const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_setallow`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const ADMINISTRABLES = ["brand", "theme", "contact", "seo"];

/** Claves operativas que nunca pueden salir ni entrar por la API. */
const INTERNAS = [
  "seed_generation",
  "snapshot_fuente_unica_contacto_20260816000000",
  "snapshot_rojo_y_horarios_20260817000000",
  "minuta_blocks_backup_20260812000000",
];

describeDb("ajustes administrables: sólo la allowlist", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  /** Foto de todas las claves internas, tal como están guardadas. */
  const fotoInterna = async () =>
    Object.fromEntries(
      (await db("settings").whereNotIn("key", ADMINISTRABLES).select("key", "value")).map((r) => [
        r.key,
        String(r.value),
      ]),
    );

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-settings";
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

  it("el GET devuelve exactamente los ajustes administrables", async () => {
    const settings = await (await fetch(`${baseUrl}/api/admin/settings`, { headers: auth() })).json();
    expect(Object.keys(settings).sort()).toEqual([...ADMINISTRABLES].sort());
  });

  it("y las claves internas siguen existiendo en la base", async () => {
    // No se ocultan borrándolas: se ocultan no publicándolas.
    const internas = await db("settings").where("key", "like", "snapshot_%");
    expect(internas.length).toBeGreaterThan(0);
    expect(await db("settings").where({ key: "seed_generation" }).first()).toBeTruthy();
  });

  it("el GET devuelve objetos, no JSON escapado dentro de JSON", async () => {
    // MariaDB devuelve las columnas JSON como string y MySQL ya parseadas.
    // Reenviar el string y volver a serializarlo dejaba la fila con el JSON
    // metido dentro de otro JSON.
    const settings = await (await fetch(`${baseUrl}/api/admin/settings`, { headers: auth() })).json();
    expect(typeof settings.brand).toBe("object");
    expect(typeof settings.seo).toBe("object");
    expect(settings.brand.name).toBeTruthy();
  });

  it("un guardado normal no deja el valor doblemente serializado", async () => {
    const antes = await (await fetch(`${baseUrl}/api/admin/settings`, { headers: auth() })).json();
    const res = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ ...antes, seo: { ...antes.seo, title: "Título nuevo" } }),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const fila = await db("settings").where({ key: "seo" }).first("value");
    const guardado = jsonColumn(fila.value);
    // Si se hubiera serializado dos veces, esto sería un string.
    expect(typeof guardado).toBe("object");
    expect(guardado.title).toBe("Título nuevo");

    // Y el ciclo completo es estable: guardar lo que devuelve el GET no
    // cambia la forma del dato.
    const despues = await (await fetch(`${baseUrl}/api/admin/settings`, { headers: auth() })).json();
    expect(typeof despues.seo).toBe("object");
    expect(despues.brand).toEqual(antes.brand);
  });

  describe("el panel guarda y las claves internas no se mueven", () => {
    it("un ciclo completo GET → editar → PUT las deja idénticas", async () => {
      const antes = await fotoInterna();
      expect(Object.keys(antes).length).toBeGreaterThan(0);

      // Exactamente lo que hace el panel: leer, tocar un campo, guardar.
      const settings = await (await fetch(`${baseUrl}/api/admin/settings`, { headers: auth() })).json();
      settings.brand = { ...settings.brand, tagline: "Otra bajada" };
      const res = await fetch(`${baseUrl}/api/admin/settings`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify(settings),
      });
      expect(res.status, await res.clone().text()).toBe(200);

      const despues = await fotoInterna();
      expect(despues).toEqual(antes);
      // Y el cambio del panel sí se guardó.
      const brand = jsonColumn((await db("settings").where({ key: "brand" }).first("value")).value);
      expect(brand.tagline).toBe("Otra bajada");
    });
  });

  describe("escritura directa de claves internas", () => {
    it.each(INTERNAS)("PUT /admin/settings/%s responde 403", async (key) => {
      const antes = await db("settings").where({ key }).first("value");
      const res = await fetch(`${baseUrl}/api/admin/settings/${key}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ pisado: true }),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/no es un ajuste administrable/i);

      const despues = await db("settings").where({ key }).first("value");
      expect(String(despues?.value)).toBe(String(antes?.value));
    });

    it.each(INTERNAS)("el PUT masivo con %s también se rechaza", async (key) => {
      const antes = await fotoInterna();
      const res = await fetch(`${baseUrl}/api/admin/settings`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ brand: { name: "No se debe guardar" }, [key]: { pisado: true } }),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).rejected).toContain(key);
      expect(await fotoInterna()).toEqual(antes);
    });

    it("con una retirada y una interna juntas manda el 410 explicativo", async () => {
      // Un panel viejo puede mandar las dos. El 410 lleva el mensaje que dice
      // qué pasó con `scripts`; el 403 genérico lo perdería.
      const res = await fetch(`${baseUrl}/api/admin/settings`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ scripts: { head: "" }, seed_generation: { at: "1999-01-01" } }),
      });
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toMatch(/JavaScript arbitrario/i);
      expect(body.rejected.sort()).toEqual(["scripts", "seed_generation"]);
    });

    it("una clave desconocida tampoco entra", async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/inventada`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ x: 1 }),
      });
      expect(res.status).toBe(403);
      expect(await db("settings").where({ key: "inventada" }).first()).toBeUndefined();
    });

    it("las claves retiradas conservan su 410 explicativo", async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/scripts`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ head: "" }),
      });
      expect(res.status).toBe(410);
      expect((await res.json()).error).toMatch(/JavaScript arbitrario/i);
    });

    it("el PUT masivo es todo o nada", async () => {
      // Si una clave se rechaza, tampoco se guardan las buenas del payload.
      const antes = jsonColumn((await db("settings").where({ key: "seo" }).first("value")).value);
      const res = await fetch(`${baseUrl}/api/admin/settings`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({
          seo: { title: "No se debe guardar" },
          seed_generation: { at: "1999-01-01T00:00:00.000Z" },
        }),
      });
      expect(res.status).toBe(403);
      const despues = jsonColumn((await db("settings").where({ key: "seo" }).first("value")).value);
      expect(despues).toEqual(antes);
    });

    it("un PUT masivo con el tema inválido no guarda nada", async () => {
      // Transaccional: `brand` iba antes que `theme` en el payload y se
      // guardaba igual aunque el tema hiciera fallar la request.
      const antes = jsonColumn((await db("settings").where({ key: "brand" }).first("value")).value);
      const res = await fetch(`${baseUrl}/api/admin/settings`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({
          brand: { ...antes, name: "No se debe guardar" },
          theme: { primary: "red" },
        }),
      });
      expect(res.status).toBe(400);
      const despues = jsonColumn((await db("settings").where({ key: "brand" }).first("value")).value);
      expect(despues).toEqual(antes);
    });
  });

  describe("con rol editor tampoco", () => {
    let editorToken = "";

    beforeAll(async () => {
      const bcrypt = (await import("bcryptjs")).default;
      await db("users").insert({
        email: "editor@sanatorio.local",
        password_hash: await bcrypt.hash(TEST_ADMIN_PASSWORD, 10),
        name: "Editor de prueba",
        role: "editor",
      });
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "editor@sanatorio.local", password: TEST_ADMIN_PASSWORD }),
      });
      editorToken = (await login.json()).token;
      expect(editorToken, "el editor tiene que poder loguearse").toBeTruthy();
    }, 60_000);

    it("el editor edita los ajustes normales", async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/seo`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${editorToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Editado por el editor" }),
      });
      expect(res.status, await res.clone().text()).toBe(200);
    });

    it("pero no puede tocar una clave interna", async () => {
      const antes = await fotoInterna();
      const res = await fetch(`${baseUrl}/api/admin/settings/seed_generation`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${editorToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ at: "1999-01-01T00:00:00.000Z" }),
      });
      expect(res.status).toBe(403);
      expect(await fotoInterna()).toEqual(antes);
    });
  });
});

describe("el panel manda sólo la allowlist", () => {
  const page = readFileSync(resolve(ROOT, "apps/admin/src/pages/SettingsPage.tsx"), "utf8");
  const api = readFileSync(resolve(ROOT, "api/src/routes/admin/settings.ts"), "utf8");

  it("las dos listas coinciden", () => {
    const listaDe = (source: string) => {
      const match = /ADMIN_SETTING_KEYS = \[([^\]]+)\]/.exec(source);
      expect(match, "falta ADMIN_SETTING_KEYS").toBeTruthy();
      return match![1]
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean)
        .sort();
    };
    expect(listaDe(page)).toEqual(listaDe(api));
    expect(listaDe(api)).toEqual([...ADMINISTRABLES].sort());
  });

  it("el formulario no reenvía la respuesta entera", () => {
    // Antes: `save.mutate(s)` con `s` = la respuesta completa del GET.
    expect(page).toContain("for (const key of ADMIN_SETTING_KEYS)");
    expect(page).not.toMatch(/mutationFn:.*api\.put\("\/admin\/settings", payload\)/);
  });
});
