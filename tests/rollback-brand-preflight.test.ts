import { describe, expect, it } from "vitest";
import {
  MIGRACIONES_MARCA,
  evaluarPreflight,
  validarSnapshot,
  mensajeBloqueo,
} from "../scripts/deploy/brand-snapshot-preflight.mjs";

/**
 * Núcleo del preflight de procedencia de marca, sin base ni bash.
 *
 * `evaluarPreflight` decide si un rollback debe abortarse ANTES del primer
 * `migrate:down` según la lista `PENDIENTES` y el estado de los snapshots. Estas
 * pruebas no existían contra `bc2439a` (el módulo no existía).
 *
 *   pnpm test tests/rollback-brand-preflight.test.ts
 */

const LOGO_MIG = "20260827000000_brand_logo.ts";
const FAVICON_MIG = "20260828000000_brand_favicon.ts";
const HOME_SEO = "20260829000000_home_seo_title.ts";
const OTRA = "20260825000000_attribution.ts";

const SNAP_LOGO = "snapshot_brand_logo_20260827000000";
const SNAP_FAVICON = "snapshot_brand_favicon_20260828000000";

function snapValido(cfg: { migracion: string; propiedad: string; valorPorDefecto: string }) {
  return {
    formato: 1,
    migracion: cfg.migracion,
    propiedad: cfg.propiedad,
    filaExistia: false,
    formaInesperada: false,
    propiedadExistia: false,
    valorAnterior: null,
    aplicoCambio: true,
    valorAplicado: cfg.valorPorDefecto,
  };
}

/** Un `leerSnapshot` de mentira alimentado por un mapa clave→valor. */
function getterDesde(mapa: Record<string, unknown>) {
  return async (key: string) => (key in mapa ? mapa[key] : undefined);
}

describe("preflight de procedencia de marca", () => {
  const cfgLogo = MIGRACIONES_MARCA.find((m) => m.migracion === LOGO_MIG)!;
  const cfgFav = MIGRACIONES_MARCA.find((m) => m.migracion === FAVICON_MIG)!;

  it("no bloquea un rollback que no cruza migraciones de marca", async () => {
    const res = await evaluarPreflight({
      pendientes: [HOME_SEO, OTRA],
      leerSnapshot: getterDesde({}),
    });
    expect(res.bloquear).toBe(false);
    expect(res.cruzadas).toEqual([]);
  });

  it("no bloquea si las migraciones de marca cruzadas tienen snapshot válido", async () => {
    const res = await evaluarPreflight({
      pendientes: [HOME_SEO, FAVICON_MIG, LOGO_MIG],
      leerSnapshot: getterDesde({
        [SNAP_LOGO]: JSON.stringify(snapValido(cfgLogo)),
        [SNAP_FAVICON]: JSON.stringify(snapValido(cfgFav)),
      }),
    });
    expect(res.bloquear).toBe(false);
    expect(res.cruzadas.sort()).toEqual([LOGO_MIG, FAVICON_MIG].sort());
    expect(res.faltantes).toEqual([]);
  });

  it("bloquea cuando una migración más nueva precede a favicon/logo sin snapshot", async () => {
    // PENDIENTES incluye una migración más nueva (home_seo) ANTES de favicon/logo
    // en el orden de reversión: sin el preflight, su down() correría primero.
    const res = await evaluarPreflight({
      pendientes: [HOME_SEO, FAVICON_MIG, LOGO_MIG],
      leerSnapshot: getterDesde({}), // ningún snapshot
    });
    expect(res.bloquear).toBe(true);
    expect(res.faltantes.map((f) => f.migracion).sort()).toEqual([LOGO_MIG, FAVICON_MIG].sort());
    for (const f of res.faltantes) expect(f.motivo).toMatch(/ausente/i);
  });

  it("bloquea cuando el snapshot de una migración de marca es inválido", async () => {
    const res = await evaluarPreflight({
      pendientes: [FAVICON_MIG],
      leerSnapshot: getterDesde({ [SNAP_FAVICON]: JSON.stringify({ formato: 1, migracion: FAVICON_MIG }) }),
    });
    expect(res.bloquear).toBe(true);
    expect(res.faltantes).toHaveLength(1);
    expect(res.faltantes[0].migracion).toBe(FAVICON_MIG);
    expect(res.faltantes[0].motivo).toMatch(/estructura inesperada/i);
  });

  it("bloquea si falta uno de los dos snapshots aunque el otro sea válido", async () => {
    const res = await evaluarPreflight({
      pendientes: [FAVICON_MIG, LOGO_MIG],
      leerSnapshot: getterDesde({ [SNAP_LOGO]: JSON.stringify(snapValido(cfgLogo)) }), // falta favicon
    });
    expect(res.bloquear).toBe(true);
    expect(res.faltantes).toHaveLength(1);
    expect(res.faltantes[0].migracion).toBe(FAVICON_MIG);
  });

  it("bloquea (fail-closed) si el snapshot no se puede leer", async () => {
    const res = await evaluarPreflight({
      pendientes: [LOGO_MIG],
      leerSnapshot: async () => {
        throw new Error("conexión caída");
      },
    });
    expect(res.bloquear).toBe(true);
    expect(res.faltantes[0].motivo).toMatch(/no se pudo leer/i);
  });

  it("el mensaje de bloqueo pide un backup anterior a las migraciones, no uno reciente", () => {
    const msg = mensajeBloqueo([{ migracion: FAVICON_MIG, snapshotKey: SNAP_FAVICON, motivo: "snapshot ausente" }]);
    expect(msg).toMatch(/ANTERIOR a estas migraciones/i);
    expect(msg).toMatch(/no\s+reconstruye el estado anterior/i);
    expect(msg).toContain("PROCEDENCIA DE MARCA");
  });

  it("validarSnapshot acepta un snapshot legítimo y rechaza uno parcial forjado", () => {
    expect(validarSnapshot(JSON.stringify(snapValido(cfgLogo)), cfgLogo).ok).toBe(true);
    const forjado = { formato: 1, filaExistia: false, propiedadExistia: false, aplicoCambio: true, valorAplicado: cfgLogo.valorPorDefecto };
    expect(validarSnapshot(JSON.stringify(forjado), cfgLogo).ok).toBe(false);
  });
});
