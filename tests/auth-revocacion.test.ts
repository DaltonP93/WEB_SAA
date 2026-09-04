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

/**
 * Revocación de sesiones JWT y TTL configurable (S1).
 *
 * El token seguía siendo válido hasta 7 días aunque al usuario le cambiaran el
 * rol, lo dieran de baja o le cambiaran la contraseña. Ahora `requireAuth`
 * resuelve contra la base en cada request:
 *  - el rol sale de la base (un cambio de rol rige en la próxima request);
 *  - un usuario borrado deja de autenticar;
 *  - cambiar la contraseña marca `tokens_valid_after` y revoca los tokens viejos.
 * Y `JWT_EXPIRES_IN` fija la duración (acá se prueba con "3h").
 *
 *   TEST_DATABASE=1 pnpm test tests/auth-revocacion.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_authrev`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;
const TTL = "3h";

/** Decodifica el payload de un JWT sin verificar la firma (sólo lectura de iat/exp). */
function decodeJwtPayload(token: string): { iat: number; exp: number } {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describeDb("revocación de sesiones JWT", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let tokenAdmin = "";

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

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-authrev";
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

  it("el TTL configurable (JWT_EXPIRES_IN) se respeta al firmar", () => {
    const decoded = decodeJwtPayload(tokenAdmin);
    expect(decoded.exp - decoded.iat, "el token no duró lo configurado").toBe(3 * 60 * 60);
  });

  it("cambiar el rol rige en la próxima request (el rol sale de la base, no del token)", async () => {
    const creado = await (await crearUsuario({ email: "rol@sanatorio.local", role: "editor" })).json();
    const token = (await (await login("rol@sanatorio.local", `${TEST_ADMIN_PASSWORD}-x`)).json()).token;

    const antes = (await (await me(token)).json()).user.capabilities as string[];
    expect(antes, "un editor debería tener content.write").toContain("content.write");

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

  it("cambiar la contraseña revoca las sesiones abiertas", async () => {
    const creado = await (await crearUsuario({ email: "clave@sanatorio.local" })).json();
    const token = (await (await login("clave@sanatorio.local", `${TEST_ADMIN_PASSWORD}-x`)).json()).token;
    expect((await me(token)).status).toBe(200);

    // El corte se guarda con precisión de segundo; se asegura que el token viejo
    // quede estrictamente antes del cambio.
    await new Promise((r) => setTimeout(r, 1100));
    const nueva = `${TEST_ADMIN_PASSWORD}-nueva`;
    expect((await putUsuario(Number(creado.id), { password: nueva })).status).toBe(200);

    expect((await me(token)).status, "el token viejo siguió sirviendo tras cambiar la contraseña").toBe(401);
    const tokenNuevo = (await (await login("clave@sanatorio.local", nueva)).json()).token;
    expect((await me(tokenNuevo)).status, "no se puede entrar con la contraseña nueva").toBe(200);
  });

  it("un token con firma inválida sigue dando 401 (no llega a la base)", async () => {
    expect((await me("no-es-un-token")).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/auth/me`)).status).toBe(401);
  });
});
