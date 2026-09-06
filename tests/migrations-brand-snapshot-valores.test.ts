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
// El preflight es .mjs y exporta su validador y el contrato de las migraciones.
// Se importa para la PARIDAD: el mismo veredicto que la validación de la migración.
import { validarSnapshot as validarPreflight, MIGRACIONES_MARCA } from "../scripts/deploy/brand-snapshot-preflight.mjs";

/**
 * Bloqueante A — snapshots de logo/favicon por valor (Agente 0).
 *
 * `debeAplicar` decidía por *truthiness*: `false`/`0` se tomaban como "vacío" y se
 * pisaban con el default (y el snapshot quedaba con `valorAnterior` no-string y
 * `aplicoCambio=true`, que el validador rechaza); `true`/número/objeto/arreglo
 * daban `aplicoCambio=false` con `valorAnterior` no-string, que el validador
 * también rechazaba. Resultado: `up()` persistía snapshots que `down()` y el
 * preflight consideraban inválidos, y valores legítimos se perdían.
 *
 * Contrato correcto: aplicar el default SÓLO si la propiedad no existe, es `null`
 * o es `""`. Preservar `false`, `0`, `true`, números, objetos, arreglos y strings
 * personalizados. El snapshot admite cualquier valor JSON. Invariantes:
 *  - todo snapshot que escribe `up()` lo acepta el preflight;
 *  - todo snapshot que escribe `up()` lo acepta `down()`;
 *  - `down(up(S)) = S` exactamente si no hubo edición posterior;
 *  - una edición posterior se preserva;
 *  - base vieja sin snapshot bloquea sin mutar.
 *
 * Estas pruebas fallan contra `40c3b11` (truthiness) y pasan con el contrato por
 * igualdad estricta. Fixtures 100% sintéticos.
 *
 *   TEST_DATABASE=1 pnpm test tests/migrations-brand-snapshot-valores.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_brand_valores`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const LOGO_MIG = "20260827000000_brand_logo.ts";
const FAVICON_MIG = "20260828000000_brand_favicon.ts";
const SNAP_LOGO = "snapshot_brand_logo_20260827000000";
const SNAP_FAVICON = "snapshot_brand_favicon_20260828000000";
const LOGO_URL = "/logo-sanatorio.png";
const FAVICON_URL = "/favicon.png";

type Migration = { up: (k: Knex) => Promise<void>; down: (k: Knex) => Promise<void>; validarSnapshot?: (v: unknown) => unknown };
type Brand = Record<string, unknown>;

interface PropCfg {
  nombre: string;
  mig: string;
  prop: string;
  def: string;
  snapKey: string;
  borraFilaVacia: boolean; // sólo el logo borra la fila settings.brand si queda vacía
}

const CFGS: PropCfg[] = [
  { nombre: "logo", mig: LOGO_MIG, prop: "logoUrl", def: LOGO_URL, snapKey: SNAP_LOGO, borraFilaVacia: true },
  { nombre: "favicon", mig: FAVICON_MIG, prop: "faviconUrl", def: FAVICON_URL, snapKey: SNAP_FAVICON, borraFilaVacia: false },
];

/** Valores que NO se deben pisar: se preservan como dato preexistente. */
const VALORES_PRESERVADOS: Array<{ nombre: string; valor: unknown }> = [
  { nombre: "string personalizado", valor: "/uploads/propio.png" },
  { nombre: "default preexistente (coincidencia)", valor: "__DEFAULT__" }, // se sustituye por cfg.def
  { nombre: "false", valor: false },
  { nombre: "0", valor: 0 },
  { nombre: "true", valor: true },
  { nombre: "número no cero", valor: 42 },
  { nombre: "objeto", valor: { a: 1, b: "x" } },
  { nombre: "arreglo", valor: [1, 2, 3] },
];

/** Valores que SÍ se toman como vacío y se pisan con el default. */
const VALORES_VACIOS: Array<{ nombre: string; estadoInicial: "sinFila" | "sinProp" | "null" | "vacio" }> = [
  { nombre: "fila ausente", estadoInicial: "sinFila" },
  { nombre: "propiedad ausente", estadoInicial: "sinProp" },
  { nombre: "null", estadoInicial: "null" },
  { nombre: '""', estadoInicial: "vacio" },
];

describeDb("Bloqueante A · snapshots de marca por valor", () => {
  let db: Knex;
  const migs: Record<string, Migration> = {};

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    migs[LOGO_MIG] = (await migrationSource.getMigration(LOGO_MIG)) as Migration;
    migs[FAVICON_MIG] = (await migrationSource.getMigration(FAVICON_MIG)) as Migration;
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  beforeEach(async () => {
    await db("settings").whereIn("key", ["brand", SNAP_LOGO, SNAP_FAVICON]).del();
  });

  async function setBrand(value: unknown): Promise<void> {
    await db("settings").insert({ key: "brand", value: JSON.stringify(value) }).onConflict("key").merge({ value: JSON.stringify(value) });
  }
  async function delBrand(): Promise<void> {
    await db("settings").where({ key: "brand" }).del();
  }
  async function readBrand(): Promise<{ exists: boolean; value?: Brand }> {
    const row = await db("settings").where({ key: "brand" }).first();
    return row ? { exists: true, value: jsonColumn<Brand>(row.value) } : { exists: false };
  }
  async function readSnap(key: string): Promise<unknown> {
    const row = await db("settings").where({ key }).first();
    return row ? jsonColumn(row.value) : undefined;
  }
  const cfgPreflight = (c: PropCfg) => MIGRACIONES_MARCA.find((m: any) => m.migracion === c.mig)!;

  for (const c of CFGS) {
    describe(`${c.nombre}`, () => {
      for (const v of VALORES_PRESERVADOS) {
        it(`preserva un valor preexistente: ${v.nombre}`, async () => {
          const valor = v.valor === "__DEFAULT__" ? c.def : v.valor;
          await setBrand({ [c.prop]: valor, otra: "no-tocar" });

          await migs[c.mig].up(db);

          // 1. No pisó el valor.
          expect((await readBrand()).value).toEqual({ [c.prop]: valor, otra: "no-tocar" });
          // 2. El snapshot que escribió up() lo acepta el preflight (paridad + invariante).
          const snap = await readSnap(c.snapKey);
          expect(validarPreflight(snap, cfgPreflight(c)), `snapshot rechazado por el preflight: ${v.nombre}`).toEqual({ ok: true });
          // 3. down(up(S)) = S exactamente.
          await migs[c.mig].down(db);
          expect((await readBrand()).value).toEqual({ [c.prop]: valor, otra: "no-tocar" });
          expect(await readSnap(c.snapKey)).toBeUndefined();
        });
      }

      for (const v of VALORES_VACIOS) {
        it(`aplica el default cuando está vacío: ${v.nombre}`, async () => {
          // Estado inicial + estado esperado tras down().
          if (v.estadoInicial === "sinFila") await delBrand();
          else if (v.estadoInicial === "sinProp") await setBrand({ otra: "x" });
          else if (v.estadoInicial === "null") await setBrand({ [c.prop]: null, otra: "x" });
          else await setBrand({ [c.prop]: "", otra: "x" });

          await migs[c.mig].up(db);

          // 1. Aplicó el default.
          expect((await readBrand()).value?.[c.prop]).toBe(c.def);
          // 2. Snapshot aceptado por el preflight.
          const snap = await readSnap(c.snapKey);
          expect(validarPreflight(snap, cfgPreflight(c))).toEqual({ ok: true });

          // 3. down() restaura el estado previo exacto.
          await migs[c.mig].down(db);
          const after = await readBrand();
          if (v.estadoInicial === "sinFila") {
            if (c.borraFilaVacia) expect(after).toEqual({ exists: false });
            else expect(after.value).toEqual({}); // el favicon no borra la fila (lo hace el logo)
          } else if (v.estadoInicial === "sinProp") {
            expect(after.value).toEqual({ otra: "x" }); // propiedad removida
          } else if (v.estadoInicial === "null") {
            expect(after.value).toEqual({ [c.prop]: null, otra: "x" });
          } else {
            expect(after.value).toEqual({ [c.prop]: "", otra: "x" });
          }
          expect(await readSnap(c.snapKey)).toBeUndefined();
        });
      }

      it("forma inesperada (fila no-objeto): no aplica y down() no muta", async () => {
        await setBrand("no-soy-un-objeto");
        await migs[c.mig].up(db);
        expect((await readBrand()).value).toBe("no-soy-un-objeto" as unknown as Brand);
        const snap = await readSnap(c.snapKey);
        expect(validarPreflight(snap, cfgPreflight(c))).toEqual({ ok: true });
        await migs[c.mig].down(db);
        expect((await readBrand()).value).toBe("no-soy-un-objeto" as unknown as Brand);
        expect(await readSnap(c.snapKey)).toBeUndefined();
      });

      it("una edición posterior se preserva (down no pisa lo que ya no es el default)", async () => {
        await setBrand({ otra: "x" }); // prop ausente ⇒ up aplica el default
        await migs[c.mig].up(db);
        expect((await readBrand()).value?.[c.prop]).toBe(c.def);
        // El sanatorio personaliza DESPUÉS del up().
        await setBrand({ [c.prop]: "/uploads/personalizado.png", otra: "x" });
        await migs[c.mig].down(db);
        // down() no restaura porque el valor ya no es el aplicado: preserva la edición.
        expect((await readBrand()).value).toEqual({ [c.prop]: "/uploads/personalizado.png", otra: "x" });
      });

      it("base vieja sin snapshot: down() bloquea sin mutar", async () => {
        await setBrand({ [c.prop]: c.def, otra: "x" });
        // No hay snapshot (base migrada antes de la corrección).
        await expect(migs[c.mig].down(db)).rejects.toThrow();
        expect((await readBrand()).value).toEqual({ [c.prop]: c.def, otra: "x" });
      });
    });
  }

  // LIFO real: logo.up → favicon.up → favicon.down → logo.down devuelve S exacto.
  it("round-trip LIFO logo+favicon devuelve el estado exacto (fila ausente)", async () => {
    await delBrand();
    await migs[LOGO_MIG].up(db);
    await migs[FAVICON_MIG].up(db);
    expect((await readBrand()).value).toEqual({ logoUrl: LOGO_URL, faviconUrl: FAVICON_URL });
    await migs[FAVICON_MIG].down(db);
    await migs[LOGO_MIG].down(db);
    expect(await readBrand()).toEqual({ exists: false });
  });

  it("round-trip LIFO preserva valores no-default mezclados (false + objeto)", async () => {
    await setBrand({ logoUrl: false, faviconUrl: { custom: true } });
    await migs[LOGO_MIG].up(db);
    await migs[FAVICON_MIG].up(db);
    expect((await readBrand()).value).toEqual({ logoUrl: false, faviconUrl: { custom: true } });
    await migs[FAVICON_MIG].down(db);
    await migs[LOGO_MIG].down(db);
    expect((await readBrand()).value).toEqual({ logoUrl: false, faviconUrl: { custom: true } });
  });
});

/**
 * Paridad de contrato (sin base): el validador de cada migración y el del
 * preflight tienen que dar el MISMO veredicto para cada snapshot. Evita que uno se
 * corrija y el otro no (que fue exactamente el defecto).
 */
describe("Bloqueante A · paridad migración ↔ preflight", () => {
  const base = {
    formato: 1,
    filaExistia: true,
    formaInesperada: false,
    propiedadExistia: true,
    aplicoCambio: false,
    valorAplicado: null,
  };
  const cfgs = [
    { mig: LOGO_MIG, prop: "logoUrl", def: LOGO_URL },
    { mig: FAVICON_MIG, prop: "faviconUrl", def: FAVICON_URL },
  ];

  it("mismo veredicto para una batería de snapshots (válidos e inválidos)", async () => {
    for (const c of cfgs) {
      const mod = (await migrationSource.getMigration(c.mig)) as Migration;
      const validarMig = mod.validarSnapshot;
      expect(typeof validarMig, `la migración ${c.mig} debe exportar validarSnapshot`).toBe("function");
      const cfgPre = MIGRACIONES_MARCA.find((m: any) => m.migracion === c.mig)!;
      const com = (extra: Record<string, unknown>) => ({ ...base, migracion: c.mig, propiedad: c.prop, ...extra });

      const bateria: Array<Record<string, unknown>> = [
        // Válidos (aplicoCambio=false, propiedad preexistente con distintos valores JSON).
        com({ valorAnterior: "/x.png" }),
        com({ valorAnterior: false }),
        com({ valorAnterior: 0 }),
        com({ valorAnterior: true }),
        com({ valorAnterior: 99 }),
        com({ valorAnterior: { k: 1 } }),
        com({ valorAnterior: [1, 2] }),
        // Válidos (aplicó el default).
        com({ propiedadExistia: false, filaExistia: false, valorAnterior: null, aplicoCambio: true, valorAplicado: c.def }),
        com({ valorAnterior: "", aplicoCambio: true, valorAplicado: c.def }),
        // Inválidos.
        com({ valorAnterior: null }), // aplicoCambio=false pero valorAnterior null ⇒ imposible
        com({ valorAnterior: "" }), // idem con ""
        com({ valorAnterior: "/x.png", aplicoCambio: true, valorAplicado: c.def }), // aplicó pero valorAnterior no vacío
        com({ propiedad: "otra" }),
        com({ formato: 2, valorAnterior: "/x.png" }),
        { ...com({ valorAnterior: "/x.png" }), extra: "clave-de-mas" },
      ];

      for (const snap of bateria) {
        const preOk = (validarPreflight(snap, cfgPre) as { ok: boolean }).ok;
        let migOk = true;
        try {
          validarMig!(snap);
        } catch {
          migOk = false;
        }
        expect(migOk, `veredicto divergente (${c.prop}): migración=${migOk} preflight=${preOk} en ${JSON.stringify(snap)}`).toBe(preOk);
      }
    }
  });
});
