import type { Server } from "node:http";
import crypto from "node:crypto";
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
 * Revocación de sesiones JWT por **versión de sesión** (`auth_version`) — Bloqueante C.
 *
 * Antes el corte era temporal (`tokens_valid_after` + comparación de `iat`), lo que
 * obligaba a truncar al segundo y a dormir 1.1 s en la prueba para evitar la
 * carrera "cambiar contraseña y volver a entrar en el mismo segundo". Ahora es una
 * versión entera por usuario: `requireAuth` exige igualdad exacta contra la base,
 * así que la revocación es determinística sin relojes ni esperas. Cubre además el
 * fail-closed (token sin `av`, versión distinta) y el pin de HS256.
 *
 *   TEST_DATABASE=1 pnpm test tests/auth-revocacion.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_authrev`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;
const TTL = "3h";

/** Decodifica el payload de un JWT sin verificar la firma. */
function decodeJwtPayload(token: string): { iat: number; exp: number; av?: number } {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describeDb("revocación de sesiones JWT (auth_version)", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let tokenAdmin = "";
  let secretActual = "";

  const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  /** Forja un JWT HS256 con el mismo secreto que usa la app (para casos límite). */
  function firmarHS256(payload: Record<string, unknown>): string {
    const data = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}`;
    const sig = crypto.createHmac("sha256", secretActual).update(data).digest("base64url");
    return `${data}.${sig}`;
  }
  /** Un token `alg:none` (sin firma): debe rechazarse por el pin de algoritmo. */
  function tokenAlgNone(payload: Record<string, unknown>): string {
    return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(payload)}.`;
  }

  const login = (email: string, password: string) =>
    fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  const me = (token: string) => fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const adminJson = () => ({ Authorization: `Bearer ${tokenAdmin}`, "Content-Type": "application/json" });
  const crearUsuario = (over: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: adminJson(),
      body: JSON.stringify({ email: "x@sanatorio.local", name: "X", password: `${TEST_ADMIN_PASSWORD}-x`, role: "editor", ...over }),
    });
  const putUsuario = (id: number, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/admin/users/${id}`, { method: "PUT", headers: adminJson(), body: JSON.stringify(body) });
  const delUsuario = (id: number) =>
    fetch(`${baseUrl}/api/admin/users/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${tokenAdmin}` } });
  const cerrarSesiones = (id: number) =>
    fetch(`${baseUrl}/api/admin/users/${id}/cerrar-sesiones`, { method: "POST", headers: { Authorization: `Bearer ${tokenAdmin}` } });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-authrev";
    secretActual = process.env.JWT_SECRET;
    process.env.JWT_EXPIRES_IN = TTL; // lo lee auth.ts al importarse
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    tokenAdmin = (await (await login("admin@sanatorio.local", TEST_ADMIN_PASSWORD)).json()).token;
    expect(tokenAdmin).toBeTruthy();
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("el token lleva la versión de sesión (av) y respeta el TTL configurable", () => {
    const d = decodeJwtPayload(tokenAdmin);
    expect(d.exp - d.iat, "el token no duró lo configurado").toBe(3 * 60 * 60);
    expect(typeof d.av, "el token no incluyó la versión de sesión").toBe("number");
  });

  it("cambiar el rol rige en la próxima request (el rol sale de la base, no del token)", async () => {
    const creado = await (await crearUsuario({ email: "rol@sanatorio.local", role: "editor" })).json();
    const token = (await (await login("rol@sanatorio.local", `${TEST_ADMIN_PASSWORD}-x`)).json()).token;

    const antes = (await (await me(token)).json()).user.capabilities as string[];
    expect(antes).toContain("content.write");

    expect((await putUsuario(Number(creado.id), { role: "auditor" })).status).toBe(200);

    const res = await me(token);
    expect(res.status).toBe(200);
    const despues = (await res.json()).user.capabilities as string[];
    expect(despues, "el rol seguía saliendo del token viejo").not.toContain("content.write");
  });

  it("borrar al usuario invalida su token en la próxima request", async () => {
    const creado = await (await crearUsuario({ email: "baja@sanatorio.local" })).json();
    const token = (await (await login("baja@sanatorio.local", `${TEST_ADMIN_PASSWORD}-x`)).json()).token;
    expect((await me(token)).status).toBe(200);

    expect((await delUsuario(Number(creado.id))).status).toBe(204);
    expect((await me(token)).status, "un usuario borrado siguió autenticado").toBe(401);
  });

  it("cambiar la contraseña revoca el token viejo de inmediato y el nuevo sirve (sin esperas)", async () => {
    const creado = await (await crearUsuario({ email: "clave@sanatorio.local" })).json();
    const token = (await (await login("clave@sanatorio.local", `${TEST_ADMIN_PASSWORD}-x`)).json()).token;
    expect((await me(token)).status).toBe(200);

    // Sin sleep: la revocación es por versión entera, no por tiempo. Aunque el
    // cambio y el token viejo compartan el mismo milisegundo, el incremento de
    // auth_version deja al token viejo con una versión distinta.
    const nueva = `${TEST_ADMIN_PASSWORD}-nueva`;
    expect((await putUsuario(Number(creado.id), { password: nueva })).status).toBe(200);

    expect((await me(token)).status, "el token viejo siguió sirviendo tras cambiar la contraseña").toBe(401);
    const tokenNuevo = (await (await login("clave@sanatorio.local", nueva)).json()).token;
    expect((await me(tokenNuevo)).status, "no se puede entrar con la contraseña nueva").toBe(200);
    // La versión del token nuevo avanzó respecto del viejo.
    expect(decodeJwtPayload(tokenNuevo).av).toBe((decodeJwtPayload(token).av ?? 0) + 1);
  });

  it("cerrar todas las sesiones revoca el token sin cambiar la contraseña", async () => {
    const creado = await (await crearUsuario({ email: "logout@sanatorio.local" })).json();
    const token = (await (await login("logout@sanatorio.local", `${TEST_ADMIN_PASSWORD}-x`)).json()).token;
    expect((await me(token)).status).toBe(200);

    expect((await cerrarSesiones(Number(creado.id))).status).toBe(200);
    expect((await me(token)).status, "cerrar sesiones no revocó el token").toBe(401);
    // Se puede volver a entrar con la MISMA contraseña (no se cambió).
    const tokenNuevo = (await (await login("logout@sanatorio.local", `${TEST_ADMIN_PASSWORD}-x`)).json()).token;
    expect((await me(tokenNuevo)).status).toBe(200);
  });

  it("un token sin `av` (emitido antes de la migración) se rechaza (fail-closed)", async () => {
    const creado = await (await crearUsuario({ email: "sinav@sanatorio.local" })).json();
    const now = Math.floor(Date.now() / 1000);
    // Firma válida HS256, no expirado, pero SIN el claim `av`.
    const token = firmarHS256({ id: Number(creado.id), email: "sinav@sanatorio.local", role: "editor", name: "X", iat: now, exp: now + 3600 });
    expect((await me(token)).status, "un token sin versión de sesión fue aceptado").toBe(401);
  });

  it("un token con una `av` distinta a la de la base se rechaza", async () => {
    const creado = await (await crearUsuario({ email: "avdist@sanatorio.local" })).json();
    const now = Math.floor(Date.now() / 1000);
    const token = firmarHS256({ id: Number(creado.id), email: "avdist@sanatorio.local", role: "editor", name: "X", av: 999, iat: now, exp: now + 3600 });
    expect((await me(token)).status).toBe(401);
  });

  it("un token `alg:none` se rechaza (pin de HS256)", async () => {
    const creado = await (await crearUsuario({ email: "algnone@sanatorio.local" })).json();
    const now = Math.floor(Date.now() / 1000);
    const token = tokenAlgNone({ id: Number(creado.id), email: "algnone@sanatorio.local", role: "editor", name: "X", av: 0, iat: now, exp: now + 3600 });
    expect((await me(token)).status, "un token alg:none fue aceptado").toBe(401);
  });

  it("un token con firma inválida sigue dando 401 (no llega a la base)", async () => {
    expect((await me("no-es-un-token")).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/auth/me`)).status).toBe(401);
  });
});
