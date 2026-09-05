import { afterAll, describe, expect, it } from "vitest";
import { sanitizarMeta } from "../api/src/audit.js";
import { db } from "../api/src/db.js";

/**
 * `sanitizarMeta` (bitácora) como unidad pura: no consulta la base, pero importa
 * `audit.js` → `db.js`, que arma el pool de knex (sin conectar). Se destruye en
 * `afterAll` para no dejar el handle abierto.
 *
 *   pnpm test tests/sanitizar-meta.test.ts
 */

afterAll(async () => {
  await db.destroy();
});

describe("sanitizarMeta redacta claves sensibles", () => {
  it("descarta password/token/authorization/api_key/*_hash aunque sean escalares", () => {
    const out = sanitizarMeta({
      role: "editor",
      password: "x",
      newPassword: "y",
      contrasena: "z",
      token: "t",
      authorization: "Bearer abc",
      api_key: "k",
      password_hash: "$2b$...",
      count: 3,
    });
    expect(out).toEqual({ role: "editor", count: 3 });
    for (const prohibida of ["password", "newPassword", "contrasena", "token", "authorization", "api_key", "password_hash"]) {
      expect(out, `no debía registrar ${prohibida}`).not.toHaveProperty(prohibida);
    }
  });

  it("conserva los metadatos de operación normales", () => {
    expect(sanitizarMeta({ from: "editor", to: "admin", revId: 12 })).toEqual({ from: "editor", to: "admin", revId: 12 });
  });

  it("descarta objetos/arrays y acota strings largas", () => {
    const out = sanitizarMeta({ obj: { a: 1 }, arr: [1, 2], larga: "x".repeat(500) });
    expect(out).not.toHaveProperty("obj");
    expect(out).not.toHaveProperty("arr");
    expect((out.larga as string).length).toBe(200);
  });
});
