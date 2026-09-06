import type { Server } from "node:http";
import { createHash } from "node:crypto";
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

/**
 * Bitácora de acciones administrativas (`admin_audit_log`).
 *
 * Comprueba que cada acción de escritura deja una fila con actor, que
 * `GET /api/admin/audit` es solo-superadmin y paginado, y que la bitácora nunca
 * guarda contraseñas ni tokens.
 *
 *   TEST_DATABASE=1 pnpm test tests/admin-audit-log.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_audit`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("bitácora de acciones administrativas", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let tokenSuperadmin = "";
  let tokenEditor = "";
  let superadminId = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const json = (token: string) => ({ ...auth(token), "Content-Type": "application/json" });

  const login = async (email: string, password: string) => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return res;
  };

  /** GET /admin/audit con querystring, devuelve el body. */
  const listar = async (qs = "", token = tokenSuperadmin) => {
    const res = await fetch(`${baseUrl}/api/admin/audit${qs ? `?${qs}` : ""}`, { headers: auth(token) });
    return { status: res.status, body: res.status === 200 ? await res.json() : null };
  };

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-audit";
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    tokenSuperadmin = (await (await login("admin@sanatorio.local", TEST_ADMIN_PASSWORD)).json()).token;
    expect(tokenSuperadmin).toBeTruthy();
    superadminId = Number((await db("users").where({ email: "admin@sanatorio.local" }).first("id"))!.id);

    const creado = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: json(tokenSuperadmin),
      body: JSON.stringify({
        email: "editor.audit@sanatorio.local",
        name: "Editor de prueba",
        password: `${TEST_ADMIN_PASSWORD}-ed`,
        role: "editor",
      }),
    });
    expect(creado.status, await creado.clone().text()).toBe(201);
    tokenEditor = (await (await login("editor.audit@sanatorio.local", `${TEST_ADMIN_PASSWORD}-ed`)).json()).token;
    expect(tokenEditor).toBeTruthy();
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  describe("autorización del endpoint de lectura", () => {
    it("sin sesión responde 401", async () => {
      const res = await fetch(`${baseUrl}/api/admin/audit`);
      expect(res.status).toBe(401);
    });
    it("un editor no puede leer la bitácora (403)", async () => {
      const { status } = await listar("", tokenEditor);
      expect(status).toBe(403);
    });
    it("un superadmin sí, y viene paginado", async () => {
      const { status, body } = await listar("limit=5");
      expect(status).toBe(200);
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.total).toBe("number");
      expect(body.limit).toBe(5);
      expect(body.items.length).toBeLessThanOrEqual(5);
    });
    it("el export CSV también es solo superadmin", async () => {
      const editor = await fetch(`${baseUrl}/api/admin/audit/export`, { headers: auth(tokenEditor) });
      expect(editor.status).toBe(403);
      const supi = await fetch(`${baseUrl}/api/admin/audit/export`, { headers: auth(tokenSuperadmin) });
      expect(supi.status).toBe(200);
      expect(supi.headers.get("cache-control")).toContain("no-store");
      expect(supi.headers.get("content-type")).toContain("text/csv");
    });
  });

  describe("registro de acciones de acceso", () => {
    it("los logins de la preparación quedaron como login_ok", async () => {
      const { body } = await listar("action=login_ok&limit=100");
      expect(body.total).toBeGreaterThanOrEqual(2); // superadmin + editor
      for (const r of body.items) expect(r.action).toBe("login_ok");
    });

    it("un login fallido queda como login_fail con el correo SEUDONIMIZADO, sin correo en claro ni contraseña", async () => {
      const res = await login("admin@sanatorio.local", "contraseña-incorrecta");
      expect(res.status).toBe(401);
      const { body } = await listar("action=login_fail&limit=50");
      expect(body.total).toBeGreaterThanOrEqual(1);
      const fila = body.items[0];
      expect(fila.action).toBe("login_fail");
      expect(fila.actor_id).toBeNull(); // no se sabe quién
      // Seudónimo estable (hash), correlacionable pero sin PII: SHA-256 truncado.
      const esperado = createHash("sha256").update("admin@sanatorio.local").digest("hex").slice(0, 16);
      expect(fila.meta?.emailHash).toBe(esperado);
      // El correo en claro NO se guarda; tampoco la contraseña intentada.
      expect(JSON.stringify(fila)).not.toContain("admin@sanatorio.local");
      expect(JSON.stringify(fila)).not.toContain("contraseña-incorrecta");
    });

    it("la IP de la bitácora no se puede falsificar con X-Real-IP", async () => {
      // `ipDe` ahora usa `req.ip`, que respeta `trust proxy` de Express. Ese
      // mecanismo gobierna sólo `X-Forwarded-For` y **nunca** consulta
      // `X-Real-IP` (es una convención de Nginx, no de Express). Antes `ipDe`
      // leía `X-Real-IP` de la cabecera a ciegas, así que cualquiera podía
      // dictar la IP del registro. Se manda sólo `X-Real-IP` para probar que ya
      // no llega a la bitácora por ninguna vía.
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Real-IP": "203.0.113.7" },
        body: JSON.stringify({ email: "spoof@sanatorio.local", password: "x" }),
      });
      expect(res.status).toBe(401);
      const { body } = await listar("action=login_fail&limit=100");
      const forjada = body.items.some((r: any) => r.ip === "203.0.113.7");
      expect(forjada, "la IP falsificada por X-Real-IP llegó a la bitácora").toBe(false);
    });
  });

  describe("CRUD genérico deja rastro con actor y sin payload", () => {
    let especialidadId = 0;

    it("crear una especialidad registra create con actor y sin datos del payload", async () => {
      const res = await fetch(`${baseUrl}/api/admin/specialties`, {
        method: "POST",
        headers: json(tokenSuperadmin),
        body: JSON.stringify({ slug: "auditoria-demo", name: "Demo auditoría", description: "texto de prueba" }),
      });
      expect(res.status, await res.clone().text()).toBe(201);
      especialidadId = (await res.json()).id;

      const { body } = await listar(`action=create&resource_type=specialties&limit=50`);
      const fila = body.items.find((r: any) => String(r.resource_id) === String(especialidadId));
      expect(fila, "no se registró la creación").toBeTruthy();
      expect(fila.actor_id).toBe(superadminId);
      expect(fila.actor_role).toBe("superadmin");
      expect(fila.actor_name).toBeTruthy();
      // El CRUD no vuelca el payload en meta: nada de "texto de prueba".
      expect(JSON.stringify(fila)).not.toContain("texto de prueba");
    });

    it("actualizar y borrar registran update y delete", async () => {
      const put = await fetch(`${baseUrl}/api/admin/specialties/${especialidadId}`, {
        method: "PUT",
        headers: json(tokenSuperadmin),
        body: JSON.stringify({ name: "Demo auditoría (editada)" }),
      });
      expect(put.status, await put.clone().text()).toBe(200);
      const del = await fetch(`${baseUrl}/api/admin/specialties/${especialidadId}`, {
        method: "DELETE",
        headers: auth(tokenSuperadmin),
      });
      expect(del.status).toBe(204);

      const upd = (await listar(`action=update&resource_type=specialties&limit=50`)).body;
      expect(upd.items.some((r: any) => String(r.resource_id) === String(especialidadId))).toBe(true);
      const rem = (await listar(`action=delete&resource_type=specialties&limit=50`)).body;
      expect(rem.items.some((r: any) => String(r.resource_id) === String(especialidadId))).toBe(true);
    });
  });

  describe("ciclo de vida de una página", () => {
    let pageId = 0;

    it("crear, publicar, despublicar, programar, papelera, restaurar y purgar dejan cada acción", async () => {
      const crear = await fetch(`${baseUrl}/api/admin/pages`, {
        method: "POST",
        headers: json(tokenSuperadmin),
        body: JSON.stringify({ slug: "pagina-auditoria", title: "Página de auditoría" }),
      });
      expect(crear.status, await crear.clone().text()).toBe(201);
      pageId = (await crear.json()).id;

      const trans = (nombre: string) =>
        fetch(`${baseUrl}/api/admin/pages/${pageId}/${nombre}`, { method: "POST", headers: auth(tokenSuperadmin) });
      // Publicar por el flujo (deja publish), despublicar (unpublish).
      expect((await trans("submit")).status).toBe(200);
      expect((await trans("approve")).status).toBe(200);
      expect((await trans("publish")).status).toBe(200);
      expect((await trans("unpublish")).status).toBe(200);
      // Reencaminar y programar (deja schedule).
      expect((await trans("submit")).status).toBe(200);
      expect((await trans("approve")).status).toBe(200);
      expect(
        (await fetch(`${baseUrl}/api/admin/pages/${pageId}/schedule`, {
          method: "POST",
          headers: json(tokenSuperadmin),
          body: JSON.stringify({ publish_at: "2035-01-01T10:00" }),
        })).status,
      ).toBe(200);
      expect((await fetch(`${baseUrl}/api/admin/pages/${pageId}`, { method: "DELETE", headers: auth(tokenSuperadmin) })).status).toBe(204);
      expect((await fetch(`${baseUrl}/api/admin/pages/${pageId}/restore`, { method: "POST", headers: auth(tokenSuperadmin) })).status).toBe(200);
      // Volver a papelera y purgar.
      expect((await fetch(`${baseUrl}/api/admin/pages/${pageId}`, { method: "DELETE", headers: auth(tokenSuperadmin) })).status).toBe(204);
      expect((await fetch(`${baseUrl}/api/admin/pages/${pageId}/definitivo`, { method: "DELETE", headers: auth(tokenSuperadmin) })).status).toBe(204);

      const acciones = new Set<string>();
      for (let offset = 0; ; offset += 100) {
        const { body } = await listar(`resource_type=pages&limit=100&offset=${offset}`);
        for (const r of body.items) if (String(r.resource_id) === String(pageId)) acciones.add(r.action);
        if (offset + 100 >= body.total) break;
      }
      for (const a of ["create", "publish", "unpublish", "schedule", "trash", "restore", "purge"]) {
        expect(acciones.has(a), `falta la acción ${a}`).toBe(true);
      }
    });

    /**
     * Bloqueante D: el Page Builder guarda por `PUT /:id/content`, que **nunca**
     * cambia la publicación (eso es de las transiciones). Guardar deja `update`;
     * mandar `status` por esa vía se rechaza con 400 y no deja `publish`/`unpublish`.
     */
    it("guardar por /content deja 'update' y nunca publica ni despublica", async () => {
      const crear = await fetch(`${baseUrl}/api/admin/pages`, {
        method: "POST",
        headers: json(tokenSuperadmin),
        body: JSON.stringify({ slug: "pagina-content-audit", title: "Página /content" }),
      });
      expect(crear.status, await crear.clone().text()).toBe(201);
      const pid = (await crear.json()).id;

      const content = (body: unknown) =>
        fetch(`${baseUrl}/api/admin/pages/${pid}/content`, {
          method: "PUT",
          headers: json(tokenSuperadmin),
          body: JSON.stringify(body),
        });
      // Intentar publicar por /content se rechaza (no cambia el estado por esa vía).
      expect((await content({ status: "published", blocks: [] })).status).toBe(400);
      // Guardar contenido normal deja 'update'.
      expect((await content({ title: "X", blocks: [] })).status).toBe(200);
      expect((await content({ blocks: [] })).status).toBe(200);

      const acciones: string[] = [];
      for (let offset = 0; ; offset += 100) {
        const { body } = await listar(`resource_type=pages&limit=100&offset=${offset}`);
        for (const r of body.items) if (String(r.resource_id) === String(pid)) acciones.push(r.action);
        if (offset + 100 >= body.total) break;
      }
      expect(acciones.includes("update"), "guardar contenido no dejó 'update'").toBe(true);
      expect(acciones.includes("publish"), "/content no debe publicar").toBe(false);
      expect(acciones.includes("unpublish"), "/content no debe despublicar").toBe(false);
    });
  });

  describe("gestión de usuarios", () => {
    it("crear, cambiar rol y borrar un usuario dejan create, role_change y delete", async () => {
      const crear = await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        headers: json(tokenSuperadmin),
        body: JSON.stringify({ email: "temp.audit@sanatorio.local", name: "Temporal", password: `${TEST_ADMIN_PASSWORD}-t`, role: "editor" }),
      });
      expect(crear.status, await crear.clone().text()).toBe(201);
      const uid = (await crear.json()).id;

      const rol = await fetch(`${baseUrl}/api/admin/users/${uid}`, {
        method: "PUT",
        headers: json(tokenSuperadmin),
        body: JSON.stringify({ role: "superadmin" }),
      });
      expect(rol.status, await rol.clone().text()).toBe(200);
      expect((await fetch(`${baseUrl}/api/admin/users/${uid}`, { method: "DELETE", headers: auth(tokenSuperadmin) })).status).toBe(204);

      const { body } = await listar(`resource_type=users&limit=200`);
      const filas = body.items.filter((r: any) => String(r.resource_id) === String(uid));
      const rc = filas.find((r: any) => r.action === "role_change");
      expect(rc, "no se registró el cambio de rol").toBeTruthy();
      expect(rc.meta).toEqual({ from: "editor", to: "superadmin" });
      expect(filas.some((r: any) => r.action === "create")).toBe(true);
      expect(filas.some((r: any) => r.action === "delete")).toBe(true);
    });
  });

  describe("routers bespoke dejan rastro (auditoría centralizada)", () => {
    /**
     * La auditoría de los routers bespoke se registra tras el `finish` del
     * response (fire-and-forget), así que la fila puede aparecer un instante
     * después de la respuesta. Se reintenta el listado hasta verla.
     */
    const esperarFila = async (qs: string, pred: (r: any) => boolean, intentos = 30): Promise<any> => {
      for (let i = 0; i < intentos; i++) {
        const { body } = await listar(qs);
        const f = (body?.items ?? []).find(pred);
        if (f) return f;
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    };

    it("crear un redirect (router bespoke) registra create con actor", async () => {
      const res = await fetch(`${baseUrl}/api/admin/redirects`, {
        method: "POST",
        headers: json(tokenSuperadmin),
        body: JSON.stringify({ from: "/vieja-audit", to: "/nueva-audit" }),
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const rid = (await res.json()).id;

      const fila = await esperarFila(
        "action=create&resource_type=redirects&limit=100",
        (r: any) => String(r.resource_id) === String(rid) && r.action === "create",
      );
      expect(fila, "no se auditó la creación del redirect").toBeTruthy();
      expect(fila.actor_id).toBe(superadminId);
      expect(fila.actor_role).toBe("superadmin");
    });
  });

  describe("filtros, paginación y la bitácora sin secretos", () => {
    it("un filtro de orden inválido responde 400", async () => {
      const { status } = await listar("sort=; DROP TABLE");
      expect(status).toBe(400);
    });

    it("filtra por actor y por acción", async () => {
      const porActor = (await listar(`actor_id=${superadminId}&limit=200`)).body;
      for (const r of porActor.items) expect(r.actor_id).toBe(superadminId);
      const porAccion = (await listar("action=create&limit=200")).body;
      for (const r of porAccion.items) expect(r.action).toBe("create");
    });

    it("ninguna fila contiene contraseñas ni tokens", async () => {
      let offset = 0;
      let total = Infinity;
      const sospechosos = [TEST_ADMIN_PASSWORD, "Bearer ", "password_hash", "eyJ"]; // eyJ = inicio de un JWT
      while (offset < total) {
        const { body } = await listar(`limit=200&offset=${offset}`);
        total = body.total;
        for (const r of body.items) {
          const s = JSON.stringify(r);
          for (const mala of sospechosos) expect(s.includes(mala), `fila con "${mala}"`).toBe(false);
        }
        offset += 200;
        if (body.items.length === 0) break;
      }
    });
  });
});
