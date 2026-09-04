import type { Server } from "node:http";
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
  migrateLatest,
  runSeeds,
} from "./helpers/db";
import { ROLES, tieneCapacidad, capacidadesDe, type Capacidad } from "../api/src/permisos.js";

/**
 * Autorización granular por capacidades (RBAC).
 *
 * Comprueba, rol por rol y contra la matriz real de `api/src/permisos.ts`, que
 * cada endpoint responde 403 exactamente cuando el rol NO tiene la capacidad que
 * ese endpoint exige, y algo distinto de 403 cuando sí la tiene. Cubre la
 * denegación por defecto, la separación editar-vs-publicar en páginas, y que el
 * rol `editor` conserva lo que ya podía hacer (sin regresión).
 *
 *   TEST_DATABASE=1 pnpm test tests/permisos-granulares.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_rbac`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

/** Los siete roles no-superadmin; el superadmin es el sembrado. */
const OTROS_ROLES = ROLES.filter((r) => r !== "superadmin");

describeDb("autorización granular por capacidades", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  const tokens: Record<string, string> = {};

  const login = async (email: string, password: string) => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return (await res.json()).token as string;
  };

  const req = (method: string, path: string, token: string, body?: unknown) =>
    fetch(`${baseUrl}/api/admin/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-rbac";
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    tokens.superadmin = await login("admin@sanatorio.local", TEST_ADMIN_PASSWORD);
    expect(tokens.superadmin).toBeTruthy();

    // Un usuario por cada rol restante, creado por el superadmin (que ahora puede
    // asignar los roles nuevos), y su login.
    for (const rol of OTROS_ROLES) {
      const pass = `${TEST_ADMIN_PASSWORD}-${rol}`;
      const email = `${rol}.rbac@sanatorio.local`; // ".rbac" evita chocar con admin@ sembrado
      const creado = await req("POST", "users", tokens.superadmin, {
        email,
        name: `Usuario ${rol}`,
        password: pass,
        role: rol,
      });
      expect(creado.status, `no se creó el usuario ${rol}: ${await creado.clone().text()}`).toBe(201);
      tokens[rol] = await login(email, pass);
      expect(tokens[rol], `no se logueó ${rol}`).toBeTruthy();
    }
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  describe("/auth/me expone las capacidades del rol", () => {
    it.each(ROLES)("%s recibe exactamente las capacidades de su rol", async (rol) => {
      const res = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${tokens[rol]}` } });
      expect(res.status).toBe(200);
      const caps: string[] = (await res.json()).user.capabilities;
      expect([...caps].sort()).toEqual([...capacidadesDe(rol)].sort());
    });
  });

  /**
   * Cada caso declara un endpoint y la capacidad **efectiva** que exige. Un
   * request 403 debe ocurrir exactamente cuando el rol no tiene esa capacidad.
   * Los payloads son inválidos/inexistentes a propósito: así un rol autorizado
   * pasa el middleware y cae en 400/404 (nunca 403 por otra razón), y la única
   * fuente de 403 es la autorización.
   */
  const CASOS: { desc: string; method: string; path: string; body?: unknown; cap: Capacidad }[] = [
    { desc: "leer contenido", method: "GET", path: "specialties", cap: "content.read" },
    { desc: "crear contenido", method: "POST", path: "specialties", body: {}, cap: "content.write" },
    { desc: "editar contenido", method: "PUT", path: "specialties/999999", body: { name: "x" }, cap: "content.write" },
    { desc: "borrar contenido", method: "DELETE", path: "specialties/999999", cap: "content.delete" },
    { desc: "editar página (sin publicar)", method: "PUT", path: "pages/999999", body: { title: "x" }, cap: "content.write" },
    { desc: "publicar página", method: "PUT", path: "pages/999999", body: { status: "published" }, cap: "content.publish" },
    { desc: "programar página", method: "POST", path: "pages/999999/schedule", body: { publish_at: "2035-01-01T10:00" }, cap: "content.publish" },
    { desc: "leer leads", method: "GET", path: "appointments", cap: "leads.read" },
    { desc: "escribir leads", method: "PUT", path: "appointments/999999", body: { status: "confirmado" }, cap: "leads.write" },
    { desc: "leer settings", method: "GET", path: "settings", cap: "settings.read" },
    { desc: "escribir settings", method: "PUT", path: "settings/theme", body: { value: {} }, cap: "settings.write" },
    { desc: "gestionar usuarios", method: "GET", path: "users", cap: "users.manage" },
    { desc: "leer auditoría", method: "GET", path: "audit", cap: "audit.read" },
    { desc: "confirmar datos institucionales", method: "PUT", path: "data-confirmations/biopsias", body: { scope: "x".repeat(40) }, cap: "data.confirm" },
  ];

  for (const caso of CASOS) {
    describe(`${caso.desc} (exige ${caso.cap})`, () => {
      it.each(ROLES)(`%s: 403 sii el rol no tiene ${caso.cap}`, async (rol) => {
        const res = await req(caso.method, caso.path, tokens[rol], caso.body);
        const deberiaSer403 = !tieneCapacidad(rol, caso.cap);
        expect(
          res.status === 403,
          `${rol} → ${caso.method} ${caso.path} dio ${res.status} (esperaba ${deberiaSer403 ? "403" : "≠403"})`,
        ).toBe(deberiaSer403);
      });
    });
  }

  describe("denegación por defecto y sin sesión", () => {
    it("sin token, cualquier ruta admin responde 401", async () => {
      const res = await fetch(`${baseUrl}/api/admin/specialties`);
      expect(res.status).toBe(401);
    });
    it("un rol de sólo lectura (auditor) no puede escribir en ningún recurso probado", async () => {
      for (const c of CASOS.filter((c) => c.method !== "GET")) {
        const res = await req(c.method, c.path, tokens.auditor, c.body);
        expect(res.status, `auditor pudo ${c.method} ${c.path}`).toBe(403);
      }
    });
  });

  describe("separación editar-vs-publicar en páginas", () => {
    let pageId = 0;

    it("un autor crea un borrador pero no puede publicarlo", async () => {
      const crear = await req("POST", "pages", tokens.autor, { slug: "borrador-autor", title: "Borrador del autor" });
      expect(crear.status, await crear.clone().text()).toBe(201);
      pageId = (await crear.json()).id;

      expect((await req("PUT", `pages/${pageId}`, tokens.autor, { status: "published" })).status).toBe(403);
      expect((await req("POST", `pages/${pageId}/schedule`, tokens.autor, { publish_at: "2035-01-01T10:00" })).status).toBe(403);
      // Pero sí puede seguir editando el borrador.
      expect((await req("PUT", `pages/${pageId}`, tokens.autor, { title: "Borrador editado" })).status).toBe(200);
    });

    it("un revisor sí puede publicar ese borrador", async () => {
      expect((await req("PUT", `pages/${pageId}`, tokens.revisor, { status: "published" })).status).toBe(200);
    });

    it("un autor no puede borrar la página (no tiene content.delete)", async () => {
      expect((await req("DELETE", `pages/${pageId}`, tokens.autor)).status).toBe(403);
    });
  });

  /**
   * Restaurar una versión también cambia el estado de publicación, en las dos
   * direcciones. El guard tiene que cubrir la despublicación (restaurar un
   * borrador sobre una página publicada), no sólo el re-publicar: si no, un
   * `autor` sin `content.publish` bajaba una página viva a borrador por esta
   * puerta. Se prueba contra la base que el estado no cambió.
   */
  describe("restaurar una versión respeta editar-vs-publicar", () => {
    /** Crea una página, le archiva una versión en borrador y la deja publicada. */
    const prepararPublicadaConVersionBorrador = async (slug: string): Promise<{ pid: number; revId: number }> => {
      const crear = await req("POST", "pages", tokens.superadmin, { slug, title: `Restore ${slug}` });
      expect(crear.status, await crear.clone().text()).toBe(201);
      const pid = (await crear.json()).id as number;
      // Estando en borrador, /content archiva una foto con status="draft".
      expect((await req("PUT", `pages/${pid}/content`, tokens.superadmin, { blocks: [] })).status).toBe(200);
      // Ahora se publica (el PUT no archiva, así que la única versión es la de borrador).
      expect((await req("PUT", `pages/${pid}`, tokens.superadmin, { status: "published" })).status).toBe(200);
      const revs = await (await req("GET", `pages/${pid}/revisions`, tokens.superadmin)).json();
      expect(revs.length, "debería haber exactamente una versión (la de borrador)").toBe(1);
      return { pid, revId: revs[0].id };
    };

    it("un autor no puede despublicar una página viva restaurando un borrador", async () => {
      const { pid, revId } = await prepararPublicadaConVersionBorrador("h1-autor");
      const res = await req("POST", `pages/${pid}/revisions/${revId}/restore`, tokens.autor);
      expect(res.status, "un autor pudo despublicar vía restore").toBe(403);
      const page = await (await req("GET", `pages/${pid}`, tokens.superadmin)).json();
      expect(page.status, "la página quedó despublicada por un autor").toBe("published");
    });

    it("un revisor sí puede (tiene content.publish): la restauración despublica", async () => {
      const { pid, revId } = await prepararPublicadaConVersionBorrador("h1-revisor");
      const res = await req("POST", `pages/${pid}/revisions/${revId}/restore`, tokens.revisor);
      expect(res.status, await res.clone().text()).toBe(200);
      const page = await (await req("GET", `pages/${pid}`, tokens.superadmin)).json();
      expect(page.status).toBe("draft");
    });

    it("un autor sí puede restaurar sin cambiar el estado (borrador→borrador)", async () => {
      const crear = await req("POST", "pages", tokens.superadmin, { slug: "h1-borrador", title: "H1 borrador" });
      const pid = (await crear.json()).id as number;
      // Dos guardados en borrador → hay una versión en borrador para restaurar.
      expect((await req("PUT", `pages/${pid}/content`, tokens.superadmin, { blocks: [] })).status).toBe(200);
      expect((await req("PUT", `pages/${pid}/content`, tokens.superadmin, { blocks: [] })).status).toBe(200);
      const revs = await (await req("GET", `pages/${pid}/revisions`, tokens.superadmin)).json();
      const res = await req("POST", `pages/${pid}/revisions/${revs[0].id}/restore`, tokens.autor);
      // Editar sin tocar el estado de publicación no exige content.publish.
      expect(res.status, await res.clone().text()).toBe(200);
    });
  });

  describe("el rol editor conserva lo que ya podía (sin regresión)", () => {
    it("crea, edita, publica y borra una especialidad, y escribe un ajuste normal", async () => {
      const crear = await req("POST", "specialties", tokens.editor, { slug: "rbac-editor", name: "Editor RBAC" });
      expect(crear.status, await crear.clone().text()).toBe(201);
      const id = (await crear.json()).id;
      expect((await req("PUT", `specialties/${id}`, tokens.editor, { name: "Editor RBAC 2" })).status).toBe(200);
      expect((await req("DELETE", `specialties/${id}`, tokens.editor)).status).toBe(204);

      const crearPagina = await req("POST", "pages", tokens.editor, { slug: "rbac-editor-pagina", title: "Página editor" });
      expect(crearPagina.status).toBe(201);
      const pid = (await crearPagina.json()).id;
      expect((await req("PUT", `pages/${pid}`, tokens.editor, { status: "published" })).status).toBe(200);

      const ajuste = await req("PUT", "settings/theme", tokens.editor, { value: {} });
      expect(ajuste.status, `el editor ya no puede editar ajustes: ${ajuste.status}`).not.toBe(403);
    });
  });

  describe("gestión de usuarios y asignación de roles", () => {
    it("sólo el superadmin puede crear usuarios", async () => {
      for (const rol of OTROS_ROLES) {
        const res = await req("POST", "users", tokens[rol], {
          email: `intruso-${rol}@x.local`,
          name: "Intruso",
          password: `${TEST_ADMIN_PASSWORD}-i`,
          role: "editor",
        });
        expect(res.status, `${rol} pudo crear usuarios`).toBe(403);
      }
    });
    it("un admin (no superadmin) tampoco gestiona usuarios", async () => {
      expect((await req("GET", "users", tokens.admin)).status).toBe(403);
    });
  });
});
