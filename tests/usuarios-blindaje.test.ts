import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
 * Usuarios del panel: las dos formas de quedarse afuera para siempre.
 *
 * 1. **Borrar al último superadmin.** El rol `editor` no puede administrar
 *    usuarios: sin ningún superadmin, nadie puede crear uno. La única salida es
 *    entrar a MySQL a mano en el VPS, que es exactamente el tipo de
 *    intervención que este panel existe para no necesitar.
 * 2. **Bajarle el rol al último superadmin.** El mismo agujero por otra puerta.
 *    La versión anterior protegía el borrado y dejaba pasar un `PUT` con
 *    `role: "editor"`, con idéntico resultado.
 *
 * Las dos se prueban acá **contra la base**, no contra el código: cada caso
 * termina comprobando que todavía queda alguien que puede administrar usuarios,
 * porque eso es lo que hay que garantizar y no la forma del `if`.
 *
 * Se prueba además lo que la API respondía mal:
 *
 * - un `parse()` de Zod salía como **500 "error interno"**, así que un email
 *   mal escrito parecía una caída del servidor y quien lo escribió no tenía
 *   forma de saber qué corregir;
 * - un email repetido chocaba contra el índice único y también salía 500;
 * - un `PUT` a un id inexistente actualizaba cero filas y devolvía éxito.
 *
 *   TEST_DATABASE=1 pnpm test tests/usuarios-blindaje.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_usuarios`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("blindaje de Usuarios", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";
  let idAdmin = 0;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const json = () => ({ ...auth(), "Content-Type": "application/json" });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-usuarios";
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

    idAdmin = Number((await db("users").where({ email: "admin@sanatorio.local" }).first("id")).id);
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  afterEach(async () => {
    await db("users").whereNot({ id: idAdmin }).del();
    // El admin sembrado vuelve a superadmin por si un caso le cambió el rol.
    await db("users").where({ id: idAdmin }).update({ role: "superadmin" });
  });

  const crear = (over: Record<string, unknown> = {}) =>
    fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: json(),
      body: JSON.stringify({
        email: "nuevo@sanatorio.local",
        name: "Persona nueva",
        password: `${TEST_ADMIN_PASSWORD}-x`,
        role: "editor",
        ...over,
      }),
    });

  const actualizar = (id: number, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/admin/users/${id}`, { method: "PUT", headers: json(), body: JSON.stringify(body) });

  const borrar = (id: number) =>
    fetch(`${baseUrl}/api/admin/users/${id}`, { method: "DELETE", headers: auth() });

  /** Cuántas personas pueden todavía administrar usuarios. Si llega a 0, el panel se cerró. */
  const superadmins = async () =>
    Number((await db("users").where({ role: "superadmin" }).count({ n: "id" }))[0].n);

  describe("nadie puede dejar el panel sin superadmin", () => {
    it("no se puede borrar al último superadmin", async () => {
      // Otro superadmin distinto del propio: sin esto, el rechazo podría venir
      // de "no podés borrarte a vos mismo" y no de lo que se quiere probar.
      const otro = await (await crear({ email: "otro@sanatorio.local", role: "superadmin" })).json();
      await db("users").where({ id: idAdmin }).update({ role: "editor" });
      expect(await superadmins(), "montaje: tiene que quedar exactamente uno").toBe(1);

      const res = await borrar(Number(otro.id));

      expect(res.status).toBe(409);
      expect(await superadmins(), "el panel quedó sin nadie que pueda administrar usuarios").toBe(1);
      expect(await db("users").where({ id: otro.id }).first(), "se borró igual").toBeTruthy();
    });

    /**
     * El mismo agujero por la otra puerta.
     *
     * La versión anterior protegía el borrado y dejaba pasar el `PUT`. El
     * resultado en la base es idéntico: cero superadmin.
     */
    it("no se puede bajar a editor al último superadmin", async () => {
      const otro = await (await crear({ email: "otro@sanatorio.local", role: "superadmin" })).json();
      await db("users").where({ id: idAdmin }).update({ role: "editor" });
      expect(await superadmins()).toBe(1);

      const res = await actualizar(Number(otro.id), { role: "editor" });

      expect(res.status, "se pudo cerrar el panel bajando un rol").toBe(409);
      expect(await superadmins(), "el panel quedó sin superadmin").toBe(1);
      expect((await db("users").where({ id: otro.id }).first("role")).role).toBe("superadmin");
    });

    /**
     * El mismo agujero, pero con un rol que no existía cuando se escribió el
     * guard. RBAC agregó `admin`, `autor`, `revisor`, etc.: un guard que sólo
     * miraba `role: "editor"` dejaba pasar `role: "admin"` y volvía a cerrar el
     * panel. Se prueba con `admin` porque es el rol nuevo con más poder, y el
     * que más tienta a "promover" al único superadmin sin darse cuenta de que lo
     * está degradando.
     */
    it.each(["admin", "autor", "revisor", "analista_marketing", "operador_leads", "auditor"])(
      "no se puede bajar a %s al último superadmin",
      async (rol) => {
        const otro = await (await crear({ email: "otro@sanatorio.local", role: "superadmin" })).json();
        await db("users").where({ id: idAdmin }).update({ role: "editor" });
        expect(await superadmins()).toBe(1);

        const res = await actualizar(Number(otro.id), { role: rol });

        expect(res.status, `se pudo cerrar el panel pasando el último superadmin a ${rol}`).toBe(409);
        expect(await superadmins(), "el panel quedó sin superadmin").toBe(1);
        expect((await db("users").where({ id: otro.id }).first("role")).role).toBe("superadmin");
      },
    );

    it("sí se puede bajar el rol mientras quede otro superadmin", async () => {
      const otro = await (await crear({ email: "otro@sanatorio.local", role: "superadmin" })).json();
      expect(await superadmins()).toBe(2);

      const res = await actualizar(Number(otro.id), { role: "editor" });

      // La protección es sobre el último, no sobre el rol: si no dejara bajar
      // ninguno, no se podría corregir un rol dado por error.
      expect(res.status, await res.clone().text()).toBe(200);
      expect(await superadmins()).toBe(1);
    });

    it("sí se puede borrar un superadmin mientras quede otro", async () => {
      const otro = await (await crear({ email: "otro@sanatorio.local", role: "superadmin" })).json();
      expect(await borrar(Number(otro.id))).toMatchObject({ status: 204 });
      expect(await superadmins()).toBe(1);
    });

    it("nadie se borra a sí mismo, ni habiendo otros superadmin", async () => {
      await crear({ email: "otro@sanatorio.local", role: "superadmin" });

      const res = await borrar(idAdmin);

      // Borrarse a uno mismo deja la sesión en curso apuntando a un usuario que
      // ya no existe: todo falla después, sin decir por qué.
      expect(res.status).toBe(400);
      expect(await db("users").where({ id: idAdmin }).first()).toBeTruthy();
    });

    it("un editor no puede administrar usuarios en absoluto", async () => {
      await crear({ email: "editor@sanatorio.local", role: "editor" });
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "editor@sanatorio.local", password: `${TEST_ADMIN_PASSWORD}-x` }),
      });
      const tokenEditor = (await login.json()).token;
      const cabecera = { Authorization: `Bearer ${tokenEditor}`, "Content-Type": "application/json" };

      // Es la razón por la que quedarse sin superadmin no tiene vuelta atrás
      // desde el panel: el editor no puede crear el que falta.
      for (const [metodo, ruta] of [
        ["GET", "/api/admin/users"],
        ["POST", "/api/admin/users"],
        ["PUT", `/api/admin/users/${idAdmin}`],
        ["DELETE", `/api/admin/users/${idAdmin}`],
      ] as const) {
        const res = await fetch(`${baseUrl}${ruta}`, {
          method: metodo,
          headers: cabecera,
          body: metodo === "GET" || metodo === "DELETE" ? undefined : JSON.stringify({ name: "x" }),
        });
        expect(res.status, `${metodo} ${ruta} no exigió superadmin`).toBe(403);
      }
    });
  });

  describe("los errores de quien escribe no son errores del servidor", () => {
    const invalidos: [string, Record<string, unknown>][] = [
      ["email sin arroba", { email: "no-es-un-email" }],
      ["email vacío", { email: "" }],
      ["nombre vacío", { name: "" }],
      ["contraseña demasiado corta", { password: "123" }],
      ["rol inventado", { role: "dueño" }],
      ["tipo equivocado", { name: 42 }],
    ];

    it.each(invalidos)("crear con %s da 400, no 500", async (_q, over) => {
      const res = await crear(over);

      // `schema.parse()` lanza `ZodError`, y el manejador global convierte en
      // 500 "error interno" todo lo que no sea `HttpError`: quien escribió el
      // email no tenía forma de saber qué corregir.
      expect(res.status, "un dato mal escrito salió como error del servidor").toBe(400);
      expect(await db("users").whereNot({ id: idAdmin }).first(), "se creó igual").toBeUndefined();
    });

    it.each(invalidos)("actualizar con %s da 400, no 500", async (_q, over) => {
      const creado = await (await crear()).json();
      const res = await actualizar(Number(creado.id), over);
      expect(res.status).toBe(400);
    });

    it("crear sin contraseña se rechaza con un motivo, no con un 500", async () => {
      const res = await crear({ password: undefined });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/contraseña/i);
    });

    it("un email repetido da 409 en vez de chocar contra el índice", async () => {
      expect((await crear()).status).toBe(201);
      const res = await crear();

      expect(res.status, "el choque contra el índice único salía como 500").toBe(409);
      expect((await res.json()).error).toMatch(/ya existe/i);
      expect(await db("users").where({ email: "nuevo@sanatorio.local" }).count({ n: "id" })).toEqual([{ n: 1 }]);
    });

    it("actualizar hacia un email que ya usa otro también da 409", async () => {
      await crear({ email: "uno@sanatorio.local" });
      const dos = await (await crear({ email: "dos@sanatorio.local" })).json();

      const res = await actualizar(Number(dos.id), { email: "uno@sanatorio.local" });

      expect(res.status).toBe(409);
      expect((await db("users").where({ id: dos.id }).first("email")).email).toBe("dos@sanatorio.local");
    });

    it("dejarse el propio email es válido: no es un duplicado de sí mismo", async () => {
      const uno = await (await crear({ email: "uno@sanatorio.local" })).json();
      const res = await actualizar(Number(uno.id), { email: "uno@sanatorio.local", name: "Nombre nuevo" });

      expect(res.status, await res.clone().text()).toBe(200);
      expect((await res.json()).name).toBe("Nombre nuevo");
    });
  });

  describe("la respuesta dice lo que de verdad pasó", () => {
    it("un PUT a un id inexistente da 404, no un éxito vacío", async () => {
      const res = await actualizar(999_999, { name: "Fantasma" });

      // Antes actualizaba cero filas y devolvía `{ ok: true }`: el panel no
      // podía distinguir "se guardó" de "no existe".
      expect(res.status).toBe(404);
    });

    it("un PUT sin ningún cambio devuelve la fila tal como está", async () => {
      const creado = await (await crear()).json();
      const res = await actualizar(Number(creado.id), {});

      // Un `update({})` en knex genera SQL inválido; sin este caso, un guardado
      // sin cambios reventaba con 500.
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await res.json()).email).toBe("nuevo@sanatorio.local");
    });

    it("borrar algo que ya no existe es 204: el resultado deseado se cumple", async () => {
      expect((await borrar(999_999)).status).toBe(204);
    });

    it("un id que no es un número no llega a la base", async () => {
      const res = await fetch(`${baseUrl}/api/admin/users/abc`, { method: "DELETE", headers: auth() });
      expect(res.status).toBe(400);
    });

    it("cambiar la contraseña la guarda hasheada y deja entrar con la nueva", async () => {
      const creado = await (await crear({ email: "clave@sanatorio.local" })).json();
      const nueva = `${TEST_ADMIN_PASSWORD}-nueva`;

      expect((await actualizar(Number(creado.id), { password: nueva })).status).toBe(200);

      const fila = await db("users").where({ id: creado.id }).first("password_hash");
      expect(fila.password_hash, "la contraseña quedó en claro en la base").not.toContain(nueva);
      expect(fila.password_hash.startsWith("$2"), "no parece un hash bcrypt").toBe(true);

      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "clave@sanatorio.local", password: nueva }),
      });
      expect(login.status, "la contraseña nueva no sirve para entrar").toBe(200);
    });
  });

  describe("el hash no sale nunca del servidor", () => {
    it("ni al listar, ni al crear, ni al actualizar", async () => {
      const creado = await crear();
      expect(creado.status).toBe(201);
      const cuerpoCreado = await creado.json();

      const lista = await fetch(`${baseUrl}/api/admin/users`, { headers: auth() });
      const cuerpoLista = await lista.text();

      const actualizado = await actualizar(Number(cuerpoCreado.id), { name: "Otro nombre" });
      const cuerpoActualizado = await actualizado.json();

      // Un hash bcrypt es atacable sin conexión: publicarlo en una respuesta
      // del panel lo copia a la caché del navegador y a cualquier captura.
      for (const cuerpo of [JSON.stringify(cuerpoCreado), cuerpoLista, JSON.stringify(cuerpoActualizado)]) {
        expect(cuerpo, "salió el hash de la contraseña").not.toContain("password_hash");
        expect(cuerpo).not.toContain("$2a$");
        expect(cuerpo).not.toContain("$2b$");
      }

      expect(Object.keys(cuerpoCreado).sort()).toEqual(["created_at", "email", "id", "name", "role"]);
    });
  });
});
