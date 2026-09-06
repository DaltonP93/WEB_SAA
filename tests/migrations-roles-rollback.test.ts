import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  createTestDatabase,
  dropTestDatabase,
  migrateLatest,
  migrationSource,
} from "./helpers/db";

/**
 * Bloqueante B — el `down()` de la migración de roles granulares es fail-closed.
 *
 * Antes, `down()` mapeaba cualquier rol restringido a `editor` y angostaba el
 * enum: una **elevación de privilegio** silenciosa (un `auditor` de sólo lectura
 * quedaba con contenido completo + settings + leads). Ahora, si hay usuarios con
 * un rol fuera de {superadmin, editor}, aborta ANTES de tocar nada. Estas pruebas
 * fallan contra `ff80b05` (el down() viejo convertía y no lanzaba) y pasan con el
 * fail-closed.
 *
 *   TEST_DATABASE=1 pnpm test tests/migrations-roles-rollback.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_roles_rollback`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;
const ROLES_MIG = "20260904000000_roles_granulares.ts";
const NUEVOS = ["admin", "autor", "revisor", "analista_marketing", "operador_leads", "auditor"];

type Migration = { up: (k: Knex) => Promise<void>; down: (k: Knex) => Promise<void> };

describeDb("rollback de roles granulares (down fail-closed)", () => {
  let db: Knex;
  let roles: Migration;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    roles = (await migrationSource.getMigration(ROLES_MIG)) as Migration;
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  async function crearUsuario(email: string, role: string): Promise<void> {
    await db("users").insert({ email, name: email, password_hash: "x", role, created_at: db.fn.now() });
  }

  /** El COLUMN_TYPE del enum `users.role` (para saber si está ancho o angosto). */
  async function tipoRole(): Promise<string> {
    const r: any = await db.raw(
      "SELECT COLUMN_TYPE ct FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'",
    );
    return String(r[0][0].ct);
  }

  beforeEach(async () => {
    await db("users").del();
    await roles.up(db); // enum ANCHO al empezar cada caso (idempotente)
  });

  it.each(NUEVOS)("down() aborta si existe un usuario con rol %s, sin mutar nada", async (rol) => {
    await crearUsuario("admin@x", "superadmin");
    await crearUsuario(`u-${rol}@x`, rol);

    await expect(roles.down(db)).rejects.toThrow(/fuera de \{superadmin, editor\}/);

    // Cero mutaciones: el usuario conserva su rol y el enum sigue ancho.
    const u = await db("users").where({ email: `u-${rol}@x` }).first("role");
    expect(u.role).toBe(rol);
    expect(await tipoRole()).toContain("auditor");
  });

  it("down() aborta con una mezcla de roles restringidos, sin mutar", async () => {
    await crearUsuario("a@x", "auditor");
    await crearUsuario("b@x", "autor");
    await crearUsuario("c@x", "editor");

    await expect(roles.down(db)).rejects.toThrow();

    const [{ n }] = await db("users").whereNotIn("role", ["superadmin", "editor"]).count({ n: "id" });
    expect(Number(n)).toBe(2); // auditor + autor intactos
    expect(await tipoRole()).toContain("analista_marketing"); // enum sigue ancho
  });

  it("down() procede si sólo quedan roles históricos (angosta el enum)", async () => {
    await crearUsuario("s@x", "superadmin");
    await crearUsuario("e@x", "editor");

    await roles.down(db);

    const tipo = await tipoRole();
    expect(tipo).not.toContain("auditor");
    expect(tipo).toContain("superadmin");
    expect(tipo).toContain("editor");
  });

  it("con cero usuarios, down() procede (angosta el enum)", async () => {
    await roles.down(db);
    expect(await tipoRole()).not.toContain("auditor");
  });
});
