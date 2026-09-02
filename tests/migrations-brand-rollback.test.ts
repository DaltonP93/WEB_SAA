import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  createTestDatabase,
  dropTestDatabase,
  migrateLatest,
  migrationSource,
  jsonColumn,
} from "./helpers/db";

/**
 * Rollback idempotente de `settings.brand` (migración `20260901000000`).
 *
 * Cubre en concreto lo que la prueba integral de `migrations.test.ts` sólo ve
 * de refilón: qué hace el `down()` correctivo ante una fila inexistente,
 * preexistente/sembrada, parcial, personalizada o con una forma inesperada, y
 * que sin el correctivo la cadena deja el residuo `{ logoUrl:"", faviconUrl:"" }`.
 *
 * Se ejercita el `down()` de las tres migraciones de marca **en el orden inverso
 * real** (la correctiva primero, por ser la más nueva; después favicon; después
 * logo), llamando a las funciones directamente para aislar la lógica de marca
 * del resto del batch.
 *
 *   TEST_DATABASE=1 TEST_DB_NAME=sanatorio_test pnpm test tests/migrations-brand-rollback.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_brand_rollback`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const LOGO_URL = "/logo-sanatorio.png";
const FAVICON_URL = "/favicon.png";

const FIX = "20260901000000_brand_rollback_idempotente.ts";
const FAVICON = "20260828000000_brand_favicon.ts";
const LOGO = "20260827000000_brand_logo.ts";

type Migration = { up: (k: Knex) => Promise<void>; down: (k: Knex) => Promise<void> };

describeDb("rollback idempotente de settings.brand", () => {
  let db: Knex;
  let fix: Migration;
  let favicon: Migration;
  let logo: Migration;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    // Sólo se necesita el esquema (tabla `settings`); migrar a latest lo crea.
    await migrateLatest(db);
    fix = (await migrationSource.getMigration(FIX)) as Migration;
    favicon = (await migrationSource.getMigration(FAVICON)) as Migration;
    logo = (await migrationSource.getMigration(LOGO)) as Migration;
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  /** Deja `settings.brand` en un estado conocido antes de cada caso. */
  async function setBrand(value: unknown): Promise<void> {
    await db("settings")
      .insert({ key: "brand", value: JSON.stringify(value) })
      .onConflict("key")
      .merge({ value: JSON.stringify(value) });
  }

  async function rawBrandRow(): Promise<{ value: unknown } | undefined> {
    return db("settings").where({ key: "brand" }).first();
  }

  /** Devuelve `{ exists, value }`; `value` sólo se parsea si la fila existe. */
  async function readBrand(): Promise<{ exists: boolean; value?: any }> {
    const row = await rawBrandRow();
    return row ? { exists: true, value: jsonColumn(row.value) } : { exists: false };
  }

  /** Revierte la cadena de marca en el orden inverso real. */
  async function rollbackBrand({ withFix }: { withFix: boolean }): Promise<void> {
    if (withFix) await fix.down(db);
    await favicon.down(db);
    await logo.down(db);
  }

  beforeEach(async () => {
    await db("settings").where({ key: "brand" }).del();
  });

  it("con el correctivo, la fila auto-generada no deja residuo", async () => {
    await setBrand({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
    await rollbackBrand({ withFix: true });
    expect(await readBrand()).toEqual({ exists: false });
  });

  it("SIN el correctivo la cadena deja el residuo (demuestra el defecto)", async () => {
    await setBrand({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
    await rollbackBrand({ withFix: false });
    // Éste es exactamente el estado que rompe el snapshot de migrations.test.ts.
    expect(await readBrand()).toEqual({ exists: true, value: { logoUrl: "", faviconUrl: "" } });
  });

  it("preserva una fila sembrada con name y tagline", async () => {
    await setBrand({
      name: "Sanatorio Adventista de Asunción",
      tagline: "Cuidamos tu salud con vocación de servicio",
      logoUrl: LOGO_URL,
      faviconUrl: FAVICON_URL,
    });
    await rollbackBrand({ withFix: true });
    const brand = await readBrand();
    expect(brand.exists).toBe(true);
    // name y tagline intactos; logo/favicon los vacía el down() de cada una.
    expect(brand.value.name).toBe("Sanatorio Adventista de Asunción");
    expect(brand.value.tagline).toBe("Cuidamos tu salud con vocación de servicio");
  });

  it("preserva un logo personalizado por el sanatorio", async () => {
    await setBrand({ logoUrl: "/uploads/logo-propio.png", faviconUrl: FAVICON_URL });
    await rollbackBrand({ withFix: true });
    const brand = await readBrand();
    expect(brand.exists).toBe(true);
    expect(brand.value.logoUrl).toBe("/uploads/logo-propio.png");
  });

  it("elimina una fila parcial que sólo trae el logo por defecto", async () => {
    await setBrand({ logoUrl: LOGO_URL });
    await rollbackBrand({ withFix: true });
    expect(await readBrand()).toEqual({ exists: false });
  });

  it("preserva una fila parcial con logo personalizado", async () => {
    await setBrand({ logoUrl: "/uploads/otro.png" });
    await rollbackBrand({ withFix: true });
    const brand = await readBrand();
    expect(brand.exists).toBe(true);
    expect(brand.value.logoUrl).toBe("/uploads/otro.png");
  });

  it("no falla ni crea fila cuando settings.brand no existe", async () => {
    // beforeEach ya la borró; el down() correctivo no debe romper.
    await expect(fix.down(db)).resolves.toBeUndefined();
    expect(await readBrand()).toEqual({ exists: false });
  });

  it("preserva una forma inesperada (arreglo) sin borrarla", async () => {
    await setBrand([]);
    await fix.down(db);
    const row = await rawBrandRow();
    expect(row).toBeTruthy();
  });

  it("es idempotente: aplicar down() dos veces no rompe", async () => {
    await setBrand({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
    await fix.down(db);
    await expect(fix.down(db)).resolves.toBeUndefined();
    expect((await readBrand()).exists).toBe(false);
  });

  it("up() no toca datos", async () => {
    await setBrand({ logoUrl: "/uploads/logo-propio.png", faviconUrl: FAVICON_URL });
    await fix.up(db);
    const brand = await readBrand();
    expect(brand.exists).toBe(true);
    expect(brand.value).toEqual({ logoUrl: "/uploads/logo-propio.png", faviconUrl: FAVICON_URL });
  });
});
