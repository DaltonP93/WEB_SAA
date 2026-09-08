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
 * Rollback por snapshot de `settings.brand`
 * (`20260827000000_brand_logo` y `20260828000000_brand_favicon`).
 *
 * Estas dos migraciones registran, antes de tocar la base, un snapshot interno
 * con el estado previo exacto y si realmente aplicaron un cambio. Su `down()`
 * restaura a partir de ese snapshot —no de una heurística de contenido— así que
 * distingue una fila que ellas crearon de una fila legítima preexistente aunque
 * su contenido sea idéntico a los valores por defecto.
 *
 * Se ejercita el ciclo real: `up()` en orden de aplicación (logo, favicon) y
 * `down()` en orden inverso LIFO (favicon, logo), llamando a las funciones
 * directamente para aislar la lógica de marca del resto del batch.
 *
 *   TEST_DATABASE=1 TEST_DB_NAME=sanatorio_test pnpm test tests/migrations-brand-rollback.test.ts
 *
 * Fixtures 100% sintéticos: no se usan textos institucionales del sanatorio.
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_brand_rollback`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const LOGO_URL = "/logo-sanatorio.png";
const FAVICON_URL = "/favicon.png";

const FAVICON_MIG = "20260828000000_brand_favicon.ts";
const LOGO_MIG = "20260827000000_brand_logo.ts";

const SNAP_LOGO = "snapshot_brand_logo_20260827000000";
const SNAP_FAVICON = "snapshot_brand_favicon_20260828000000";

type Migration = { up: (k: Knex) => Promise<void>; down: (k: Knex) => Promise<void> };
type Brand = Record<string, unknown>;

describeDb("rollback por snapshot de settings.brand", () => {
  let db: Knex;
  let favicon: Migration;
  let logo: Migration;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    // Sólo se necesita el esquema (tabla `settings`); migrar a latest lo crea.
    await migrateLatest(db);
    favicon = (await migrationSource.getMigration(FAVICON_MIG)) as Migration;
    logo = (await migrationSource.getMigration(LOGO_MIG)) as Migration;
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  /** Deja `settings.brand` en un estado conocido. */
  async function setBrand(value: unknown): Promise<void> {
    await db("settings")
      .insert({ key: "brand", value: JSON.stringify(value) })
      .onConflict("key")
      .merge({ value: JSON.stringify(value) });
  }

  async function delBrand(): Promise<void> {
    await db("settings").where({ key: "brand" }).del();
  }

  async function rawRow(key: string): Promise<{ value: unknown } | undefined> {
    return db("settings").where({ key }).first();
  }

  /** `{ exists, value }`; `value` sólo se parsea si la fila existe. */
  async function readBrand(): Promise<{ exists: boolean; value?: Brand }> {
    const row = await rawRow("brand");
    return row ? { exists: true, value: jsonColumn<Brand>(row.value) } : { exists: false };
  }

  /** Aplica la cadena de marca en orden real: logo, después favicon. */
  async function aplicar(): Promise<void> {
    await logo.up(db);
    await favicon.up(db);
  }

  /** Revierte la cadena en orden LIFO real: favicon, después logo. */
  async function revertir(): Promise<void> {
    await favicon.down(db);
    await logo.down(db);
  }

  // Estado limpio antes de cada caso: sin fila brand y sin snapshots.
  beforeEach(async () => {
    await delBrand();
    await db("settings").whereIn("key", [SNAP_LOGO, SNAP_FAVICON]).del();
  });

  // --- Regresión principal: el defecto que la heurística de contenido no podía
  //     evitar. Una fila preexistente EXACTAMENTE igual a los valores por
  //     defecto no debe borrarse en el rollback. Con la heurística de `672ae96`
  //     este caso fallaba (la borraba); con snapshots pasa. ------------------
  it("regresión: preexistente exactamente igual a los defaults NO se borra", async () => {
    await setBrand({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
    await aplicar(); // no aplica nada: ambas propiedades ya tienen valor
    await revertir();
    const brand = await readBrand();
    expect(brand.exists).toBe(true);
    expect(brand.value).toEqual({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
  });

  // --- 1. Fila inexistente originalmente: el ciclo no deja residuo. ---------
  it("fila inexistente: tras aplicar y revertir no queda fila", async () => {
    // beforeEach ya la borró.
    await aplicar();
    // Tras aplicar, la fila existe con ambos defaults.
    expect(await readBrand()).toEqual({ exists: true, value: { logoUrl: LOGO_URL, faviconUrl: FAVICON_URL } });
    await revertir();
    expect(await readBrand()).toEqual({ exists: false });
  });

  // --- 2. Fila preexistente `{}`: se preserva vacía, no se borra. -----------
  it("fila preexistente vacía se preserva (no se borra la fila)", async () => {
    await setBrand({});
    await aplicar();
    await revertir();
    expect(await readBrand()).toEqual({ exists: true, value: {} });
  });

  // --- 4. Valores null: se restauran exactamente como null. -----------------
  it("valores null se restauran como null (no como ausentes)", async () => {
    await setBrand({ logoUrl: null, faviconUrl: null });
    await aplicar(); // null es falsy: aplica los defaults
    expect((await readBrand()).value).toEqual({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
    await revertir();
    const brand = await readBrand();
    expect(brand.exists).toBe(true);
    expect(brand.value).toEqual({ logoUrl: null, faviconUrl: null });
  });

  // --- 5. Valores vacíos: se restauran exactamente como "". -----------------
  it('valores "" se restauran exactamente como ""', async () => {
    await setBrand({ logoUrl: "", faviconUrl: "" });
    await aplicar(); // "" es falsy: aplica los defaults
    await revertir();
    expect((await readBrand()).value).toEqual({ logoUrl: "", faviconUrl: "" });
  });

  // --- 7/8/9. Personalizaciones del cliente: se preservan. ------------------
  it("logo personalizado se preserva", async () => {
    await setBrand({ logoUrl: "/uploads/logo-propio.png", faviconUrl: null });
    await aplicar(); // sólo aplica el favicon
    await revertir();
    const brand = await readBrand();
    expect(brand.value).toEqual({ logoUrl: "/uploads/logo-propio.png", faviconUrl: null });
  });

  it("favicon personalizado se preserva", async () => {
    await setBrand({ logoUrl: null, faviconUrl: "/uploads/fav-propio.png" });
    await aplicar(); // sólo aplica el logo
    await revertir();
    const brand = await readBrand();
    expect(brand.value).toEqual({ logoUrl: null, faviconUrl: "/uploads/fav-propio.png" });
  });

  it("ambos personalizados se preservan y no se aplica ningún default", async () => {
    await setBrand({ logoUrl: "/uploads/l.png", faviconUrl: "/uploads/f.png" });
    await aplicar();
    // Ninguna migración cambió nada.
    expect(await rawRow(SNAP_LOGO)).toBeTruthy();
    expect(await rawRow(SNAP_FAVICON)).toBeTruthy();
    await revertir();
    expect((await readBrand()).value).toEqual({ logoUrl: "/uploads/l.png", faviconUrl: "/uploads/f.png" });
  });

  // --- 10. Propiedades adicionales (marca sintética): se preservan. ---------
  it("preserva claves ajenas (name/tagline/colores) y no borra la fila", async () => {
    await setBrand({
      name: "Marca de prueba",
      tagline: "Lema sintético de prueba",
      colorPrimario: "#005587",
    });
    await aplicar(); // agrega logo y favicon por defecto
    await revertir();
    const brand = await readBrand();
    expect(brand.exists).toBe(true);
    expect(brand.value).toEqual({
      name: "Marca de prueba",
      tagline: "Lema sintético de prueba",
      colorPrimario: "#005587",
    });
  });

  // --- 11/12. Edición posterior del cliente sobre lo que aplicó la migración.
  it("edición posterior del logo se preserva en el rollback", async () => {
    await aplicar(); // fila nueva con ambos defaults
    // El cliente cambia el logo después del up().
    await setBrand({ logoUrl: "/uploads/nuevo.png", faviconUrl: FAVICON_URL });
    await revertir();
    const brand = await readBrand();
    // El favicon (sin editar) se revierte; el logo editado se conserva.
    expect(brand.exists).toBe(true);
    expect(brand.value).toEqual({ logoUrl: "/uploads/nuevo.png" });
  });

  it("edición posterior del favicon se preserva en el rollback", async () => {
    await aplicar();
    await setBrand({ logoUrl: LOGO_URL, faviconUrl: "/uploads/nuevo-fav.png" });
    await revertir();
    const brand = await readBrand();
    // El logo por defecto se revierte y su propiedad se elimina; la fila queda
    // porque todavía tiene el favicon editado.
    expect(brand.exists).toBe(true);
    expect(brand.value).toEqual({ faviconUrl: "/uploads/nuevo-fav.png" });
  });

  // --- 13. Propiedad agregada después del up(): se preserva; no se borra. ---
  it("una clave agregada después del up() sobrevive al rollback", async () => {
    await aplicar();
    const actual = (await readBrand()).value as Brand;
    await setBrand({ ...actual, tagline: "Agregado luego de migrar" });
    await revertir();
    const brand = await readBrand();
    expect(brand.exists).toBe(true);
    expect(brand.value).toEqual({ tagline: "Agregado luego de migrar" });
  });

  // --- 3. Propiedades inexistentes en una fila con otras claves. ------------
  it("propiedades inexistentes: se agregan en up() y se quitan en down()", async () => {
    await setBrand({ name: "Sólo nombre" });
    await aplicar();
    expect((await readBrand()).value).toEqual({
      name: "Sólo nombre",
      logoUrl: LOGO_URL,
      faviconUrl: FAVICON_URL,
    });
    await revertir();
    expect((await readBrand()).value).toEqual({ name: "Sólo nombre" });
  });

  // --- Forma inesperada (arreglo / no-objeto): se preserva sin tocar. -------
  it("forma inesperada (arreglo) no se modifica ni se borra", async () => {
    await setBrand([]);
    await aplicar(); // no toca una forma inesperada
    await revertir();
    const row = await rawRow("brand");
    expect(row).toBeTruthy();
    expect(jsonColumn(row!.value)).toEqual([]);
  });

  // --- up(): idempotencia y no-sobrescritura del snapshot. ------------------
  it("up() no sobreescribe un snapshot ya existente", async () => {
    await delBrand();
    await logo.up(db); // fila inexistente => snapshot filaExistia:false
    const snap1 = jsonColumn<Brand>((await rawRow(SNAP_LOGO))!.value);
    // El cliente carga un logo y se reejecuta up() (idempotencia de knex a mano).
    await setBrand({ logoUrl: "/uploads/x.png" });
    await logo.up(db);
    const snap2 = jsonColumn<Brand>((await rawRow(SNAP_LOGO))!.value);
    expect(snap2).toEqual(snap1); // el snapshot original se conserva
  });

  it("up() no pisa un valor personalizado", async () => {
    await setBrand({ logoUrl: "/uploads/x.png", faviconUrl: "/uploads/y.png" });
    await aplicar();
    expect((await readBrand()).value).toEqual({ logoUrl: "/uploads/x.png", faviconUrl: "/uploads/y.png" });
  });

  // --- 20. Los snapshots desaparecen tras un rollback exitoso. --------------
  it("los snapshots se eliminan después de un rollback exitoso", async () => {
    await aplicar();
    expect(await rawRow(SNAP_LOGO)).toBeTruthy();
    expect(await rawRow(SNAP_FAVICON)).toBeTruthy();
    await revertir();
    expect(await rawRow(SNAP_LOGO)).toBeUndefined();
    expect(await rawRow(SNAP_FAVICON)).toBeUndefined();
  });

  // --- 18. Ciclo migrate → rollback → migrate. ------------------------------
  it("ciclo aplicar → revertir → aplicar deja el mismo estado y snapshots frescos", async () => {
    await delBrand();
    await aplicar();
    const primera = (await readBrand()).value;
    await revertir();
    expect(await readBrand()).toEqual({ exists: false });
    await aplicar();
    expect((await readBrand()).value).toEqual(primera);
    expect(await rawRow(SNAP_LOGO)).toBeTruthy();
    expect(await rawRow(SNAP_FAVICON)).toBeTruthy();
  });

  // --- 14. Fail-closed: migración aplicada pero snapshot ausente. -----------
  it("fail-closed: down() del logo aborta sin snapshot y no toca datos", async () => {
    await setBrand({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL, name: "Marca" });
    // No se corre up(): simula una base migrada antes de la corrección.
    await db("settings").where({ key: SNAP_LOGO }).del();
    await expect(logo.down(db)).rejects.toThrow(/sin snapshot/i);
    // Datos intactos.
    expect((await readBrand()).value).toEqual({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL, name: "Marca" });
  });

  it("fail-closed: down() del favicon aborta sin snapshot y no toca datos", async () => {
    await setBrand({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
    await db("settings").where({ key: SNAP_FAVICON }).del();
    await expect(favicon.down(db)).rejects.toThrow(/sin snapshot/i);
    expect((await readBrand()).value).toEqual({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
  });

  // --- 15. Fail-closed: snapshot con contenido inválido. --------------------
  it("fail-closed: down() aborta ante un snapshot inválido", async () => {
    await setBrand({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
    await db("settings")
      .insert({ key: SNAP_LOGO, value: JSON.stringify("no soy un snapshot") })
      .onConflict("key")
      .merge({ value: JSON.stringify("no soy un snapshot") });
    await expect(logo.down(db)).rejects.toThrow(/inválido|invalido|desconocida/i);
    expect((await readBrand()).value).toEqual({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
  });

  // --- 16. Fail-closed: snapshot de una versión de formato desconocida. -----
  it("fail-closed: down() aborta ante un snapshot de versión desconocida", async () => {
    await setBrand({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
    const futuro = {
      formato: 99,
      migracion: LOGO_MIG,
      propiedad: "logoUrl",
      filaExistia: false,
      formaInesperada: false,
      propiedadExistia: false,
      valorAnterior: null,
      aplicoCambio: true,
      valorAplicado: LOGO_URL,
    };
    await db("settings")
      .insert({ key: SNAP_LOGO, value: JSON.stringify(futuro) })
      .onConflict("key")
      .merge({ value: JSON.stringify(futuro) });
    await expect(logo.down(db)).rejects.toThrow(/desconocida|formato/i);
    // El snapshot inválido no se borra (se abortó antes).
    expect(await rawRow(SNAP_LOGO)).toBeTruthy();
    expect((await readBrand()).value).toEqual({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
  });

  // --- 17. Rollback LIFO completo desde una base sembrada sintética. --------
  it("rollback LIFO completo preserva una fila sembrada sintética", async () => {
    await setBrand({ name: "Marca de prueba", tagline: "Lema sintético" });
    await aplicar();
    expect((await readBrand()).value).toEqual({
      name: "Marca de prueba",
      tagline: "Lema sintético",
      logoUrl: LOGO_URL,
      faviconUrl: FAVICON_URL,
    });
    await revertir();
    expect((await readBrand()).value).toEqual({ name: "Marca de prueba", tagline: "Lema sintético" });
  });
});
