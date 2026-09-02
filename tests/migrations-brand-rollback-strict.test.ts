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
 * Validación estricta del snapshot de marca (defectos de la auditoría del PR #29).
 *
 * Dos defectos bloqueantes contra `bc2439a`:
 *
 *  1. `leerSnapshot()` aceptaba un objeto parcial (sólo `formato` + tres
 *     booleanos) y hacía un cast al tipo completo. Un snapshot forjado sin
 *     `migracion`/`propiedad`/`formaInesperada`/`valorAnterior` pasaba, y
 *     `down()` podía **borrar una fila legítima** `settings.brand`.
 *  2. Si `up()` encontraba un snapshot preexistente corrupto, no lo validaba:
 *     lo conservaba pero igual modificaba `settings.brand`, dejando un estado
 *     sin restauración segura.
 *
 * Estas pruebas fallan contra `bc2439a` y pasan sólo con la validación estricta.
 * Fixtures 100% sintéticos.
 *
 *   TEST_DATABASE=1 TEST_DB_NAME=sanatorio_test pnpm test tests/migrations-brand-rollback-strict.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_brand_strict`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const LOGO_URL = "/logo-sanatorio.png";
const FAVICON_URL = "/favicon.png";
const FAVICON_MIG = "20260828000000_brand_favicon.ts";
const LOGO_MIG = "20260827000000_brand_logo.ts";
const SNAP_LOGO = "snapshot_brand_logo_20260827000000";
const SNAP_FAVICON = "snapshot_brand_favicon_20260828000000";

type Migration = { up: (k: Knex) => Promise<void>; down: (k: Knex) => Promise<void> };
type Brand = Record<string, unknown>;

/** Un snapshot legítimo de logo (fila creada por la migración, prop ausente antes). */
function snapshotLogoValido(): Record<string, unknown> {
  return {
    formato: 1,
    migracion: LOGO_MIG,
    propiedad: "logoUrl",
    filaExistia: false,
    formaInesperada: false,
    propiedadExistia: false,
    valorAnterior: null,
    aplicoCambio: true,
    valorAplicado: LOGO_URL,
  };
}

describeDb("validación estricta del snapshot de marca", () => {
  let db: Knex;
  let favicon: Migration;
  let logo: Migration;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    favicon = (await migrationSource.getMigration(FAVICON_MIG)) as Migration;
    logo = (await migrationSource.getMigration(LOGO_MIG)) as Migration;
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  async function setBrand(value: unknown): Promise<void> {
    await db("settings")
      .insert({ key: "brand", value: JSON.stringify(value) })
      .onConflict("key")
      .merge({ value: JSON.stringify(value) });
  }
  async function setSnap(key: string, value: unknown): Promise<void> {
    await db("settings")
      .insert({ key, value: JSON.stringify(value) })
      .onConflict("key")
      .merge({ value: JSON.stringify(value) });
  }
  async function raw(key: string): Promise<{ value: unknown } | undefined> {
    return db("settings").where({ key }).first();
  }
  async function readBrand(): Promise<{ exists: boolean; value?: Brand }> {
    const row = await raw("brand");
    return row ? { exists: true, value: jsonColumn<Brand>(row.value) } : { exists: false };
  }

  beforeEach(async () => {
    await db("settings").whereIn("key", ["brand", SNAP_LOGO, SNAP_FAVICON]).del();
  });

  // ---- Defecto 1: snapshot forjado parcial no debe borrar una fila legítima -
  it("DEFECTO 1 (logo): un snapshot parcial forjado no puede borrar una fila legítima", async () => {
    // Fila legítima preexistente, idéntica al default por coincidencia.
    await setBrand({ logoUrl: LOGO_URL });
    // El snapshot forjado exacto del informe de auditoría (faltan campos).
    await setSnap(SNAP_LOGO, {
      formato: 1,
      filaExistia: false,
      propiedadExistia: false,
      aplicoCambio: true,
      valorAplicado: LOGO_URL,
    });
    await expect(logo.down(db)).rejects.toThrow();
    // La fila legítima sigue intacta.
    expect(await readBrand()).toEqual({ exists: true, value: { logoUrl: LOGO_URL } });
    // El snapshot inválido no se borra (se abortó antes).
    expect(await raw(SNAP_LOGO)).toBeTruthy();
  });

  it("DEFECTO 1 (favicon): un snapshot parcial forjado no puede borrar una propiedad legítima", async () => {
    await setBrand({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
    await setSnap(SNAP_FAVICON, {
      formato: 1,
      filaExistia: false,
      propiedadExistia: false,
      aplicoCambio: true,
      valorAplicado: FAVICON_URL,
    });
    await expect(favicon.down(db)).rejects.toThrow();
    expect((await readBrand()).value).toEqual({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
  });

  // ---- Defecto 2: up() con snapshot preexistente corrupto no debe tocar brand
  it("DEFECTO 2 (logo): up() ante un snapshot corrupto aborta sin modificar brand ni el snapshot", async () => {
    await setBrand({});
    const corrupto = { formato: 1, filaExistia: "no-booleano" }; // inválido
    await setSnap(SNAP_LOGO, corrupto);
    await expect(logo.up(db)).rejects.toThrow();
    // brand no cambió…
    expect(await readBrand()).toEqual({ exists: true, value: {} });
    // …y el snapshot corrupto quedó exactamente igual (no se pisó ni se borró).
    expect(jsonColumn(await raw(SNAP_LOGO).then((r) => r!.value))).toEqual(corrupto);
  });

  it("DEFECTO 2 (favicon): up() ante un snapshot corrupto aborta sin modificar brand", async () => {
    await setBrand({ logoUrl: LOGO_URL });
    await setSnap(SNAP_FAVICON, { formato: 1, propiedadExistia: 3 });
    await expect(favicon.up(db)).rejects.toThrow();
    expect((await readBrand()).value).toEqual({ logoUrl: LOGO_URL });
  });

  // ---- Validación estricta por campo (down() debe abortar sin tocar nada) ----
  const legit = snapshotLogoValido();
  const casosInvalidos: Array<{ nombre: string; snap: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>) }> = [
    { nombre: "falta formato", snap: (s) => { const c = { ...s }; delete c.formato; return c; } },
    { nombre: "falta migracion", snap: (s) => { const c = { ...s }; delete c.migracion; return c; } },
    { nombre: "falta propiedad", snap: (s) => { const c = { ...s }; delete c.propiedad; return c; } },
    { nombre: "falta filaExistia", snap: (s) => { const c = { ...s }; delete c.filaExistia; return c; } },
    { nombre: "falta formaInesperada", snap: (s) => { const c = { ...s }; delete c.formaInesperada; return c; } },
    { nombre: "falta propiedadExistia", snap: (s) => { const c = { ...s }; delete c.propiedadExistia; return c; } },
    { nombre: "falta valorAnterior", snap: (s) => { const c = { ...s }; delete c.valorAnterior; return c; } },
    { nombre: "falta aplicoCambio", snap: (s) => { const c = { ...s }; delete c.aplicoCambio; return c; } },
    { nombre: "falta valorAplicado", snap: (s) => { const c = { ...s }; delete c.valorAplicado; return c; } },
    { nombre: "migracion incorrecta", snap: (s) => ({ ...s, migracion: FAVICON_MIG }) },
    { nombre: "propiedad incorrecta", snap: (s) => ({ ...s, propiedad: "faviconUrl" }) },
    { nombre: "formato desconocido", snap: (s) => ({ ...s, formato: 2 }) },
    { nombre: "filaExistia no booleano", snap: (s) => ({ ...s, filaExistia: 1 }) },
    { nombre: "formaInesperada contradictoria (true sin fila)", snap: (s) => ({ ...s, formaInesperada: true }) },
    { nombre: "aplicoCambio=true con valorAplicado null", snap: (s) => ({ ...s, valorAplicado: null }) },
    { nombre: "aplicoCambio=true con valorAplicado ajeno", snap: (s) => ({ ...s, valorAplicado: "/otro.png" }) },
    { nombre: "aplicoCambio=false con valorAplicado no nulo", snap: (s) => ({ ...s, aplicoCambio: false, propiedadExistia: true, valorAnterior: "/x.png", valorAplicado: LOGO_URL }) },
    { nombre: "propiedadExistia=false con valorAnterior no nulo", snap: (s) => ({ ...s, valorAnterior: "/algo.png" }) },
    { nombre: "clave extra no permitida", snap: (s) => ({ ...s, extra: "x" }) },
    { nombre: "procedencia contradictoria (fila no existía pero aplicoCambio=false)", snap: (s) => ({ ...s, aplicoCambio: false, valorAplicado: null }) },
  ];

  it.each(casosInvalidos)("logo down() aborta ante snapshot inválido: $nombre", async ({ snap }) => {
    await setBrand({ logoUrl: LOGO_URL });
    const value = typeof snap === "function" ? snap(legit) : snap;
    await setSnap(SNAP_LOGO, value);
    await expect(logo.down(db)).rejects.toThrow();
    // No se tocó ni la fila ni el snapshot.
    expect((await readBrand()).value).toEqual({ logoUrl: LOGO_URL });
    expect(await raw(SNAP_LOGO)).toBeTruthy();
  });

  // ---- up() con snapshot válido preexistente: idempotente, no toca nada ------
  it("up() con snapshot válido preexistente es un no-op idempotente y preserva personalizaciones", async () => {
    // El sanatorio personalizó el logo DESPUÉS del up() original.
    await setBrand({ logoUrl: "/uploads/propio.png", name: "Marca" });
    const snap = snapshotLogoValido();
    await setSnap(SNAP_LOGO, snap);
    await logo.up(db); // no debe recalcular ni pisar
    expect((await readBrand()).value).toEqual({ logoUrl: "/uploads/propio.png", name: "Marca" });
    expect(jsonColumn(await raw(SNAP_LOGO).then((r) => r!.value))).toEqual(snap);
  });

  // ---- down() con snapshot inválido no modifica ninguna fila -----------------
  it("down() ante snapshot inválido no modifica settings.brand ni borra el snapshot", async () => {
    await setBrand({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL, name: "Marca" });
    await setSnap(SNAP_LOGO, { formato: 1, migracion: LOGO_MIG }); // incompleto
    await expect(logo.down(db)).rejects.toThrow();
    expect((await readBrand()).value).toEqual({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL, name: "Marca" });
    expect(await raw(SNAP_LOGO)).toBeTruthy();
  });

  // ---- Snapshot válido => down() sí restaura (no rompimos el camino feliz) ---
  it("con snapshot válido, down() del logo restaura y borra el snapshot", async () => {
    await setBrand({ logoUrl: LOGO_URL });
    await setSnap(SNAP_LOGO, snapshotLogoValido());
    await logo.down(db);
    // filaExistia:false + propiedad se quita + fila vacía => se borra la fila.
    expect(await readBrand()).toEqual({ exists: false });
    expect(await raw(SNAP_LOGO)).toBeUndefined();
  });
});
