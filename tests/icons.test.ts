import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { SPECIALTY_ICON, SERVICE_ICON, STUDY_ICON } from "../apps/web/src/lib/icons";
import { LUCIDE_ICON_NAMES, isLucideIconName } from "../api/src/lucide-icons";

/**
 * El mapa de iconos falla en silencio: un nombre que no existe en la versión
 * instalada de lucide simplemente no renderiza nada. Estas pruebas lo
 * convierten en un error de CI.
 */

const LUCIDE_NAMES = new Set(Object.keys(dynamicIconImports as Record<string, unknown>));
const ROOT = path.resolve(__dirname, "..");

/** Iconos escritos a mano en los componentes (no vienen del mapa). */
function iconNamesInFile(relPath: string, patterns: RegExp[]): string[] {
  const content = readFileSync(path.join(ROOT, relPath), "utf8");
  const found: string[] = [];
  for (const re of patterns) {
    for (const m of content.matchAll(re)) found.push(m[1]);
  }
  return found;
}

describe("mapa de iconos", () => {
  const maps: [string, Record<string, string>][] = [
    ["especialidades", SPECIALTY_ICON],
    ["servicios", SERVICE_ICON],
    ["estudios", STUDY_ICON],
  ];

  it.each(maps)("todos los iconos de %s existen en lucide", (_name, map) => {
    const missing = Object.entries(map).filter(([, icon]) => !LUCIDE_NAMES.has(icon));
    expect(missing, `iconos inexistentes: ${missing.map(([k, v]) => `${k}→${v}`).join(", ")}`).toEqual([]);
  });

  it.each(maps)("no hay iconos repetidos dentro de la grilla de %s", (_name, map) => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [slug, icon] of Object.entries(map)) {
      const previous = seen.get(icon);
      if (previous) duplicates.push(`${icon} (${previous} y ${slug})`);
      else seen.set(icon, slug);
    }
    expect(duplicates, `iconos repetidos: ${duplicates.join(", ")}`).toEqual([]);
  });

  it("los iconos que cargan las migraciones existen en lucide", () => {
    const files = [
      "api/migrations/20260812000000_web_minuta_ajustes.ts",
      "api/migrations/20260813000002_minuta_correcciones.ts",
    ];
    const bad: string[] = [];
    for (const file of files) {
      for (const icon of iconNamesInFile(file, [/icon:\s*"([a-z0-9-]+)"/g])) {
        if (!LUCIDE_NAMES.has(icon)) bad.push(`${file}: ${icon}`);
      }
    }
    expect(bad, `iconos inexistentes en migraciones: ${bad.join(", ")}`).toEqual([]);
  });

  it("los iconos escritos en los componentes existen en lucide", () => {
    const files = [
      "apps/web/src/blocks/StudyGrid.tsx",
      "apps/web/src/blocks/ContactChannels.tsx",
      "apps/web/src/lib/icons.ts",
    ];
    const bad: string[] = [];
    for (const file of files) {
      const names = iconNamesInFile(file, [
        /icon:\s*"([a-z0-9-]+)"/g,
        /LucideIcon name="([a-z0-9-]+)"/g,
        /DEFAULT_ICON[\s\S]*?:\s*"([a-z0-9-]+)"/g,
      ]);
      for (const icon of names) if (!LUCIDE_NAMES.has(icon)) bad.push(`${file}: ${icon}`);
    }
    expect(bad, `iconos inexistentes: ${bad.join(", ")}`).toEqual([]);
  });
});

/**
 * La API valida nombres de iconos con una lista generada, porque
 * `lucide-react` es dependencia del front y no del servidor. Si alguien
 * actualiza lucide sin regenerar, la validación empieza a rechazar iconos
 * nuevos (o a aceptar iconos que ya no existen) sin que nadie se entere.
 */
describe("lista de iconos generada para la API", () => {
  it("coincide con la versión instalada de lucide-react", () => {
    const installed = [...LUCIDE_NAMES].sort();
    expect(
      [...LUCIDE_ICON_NAMES],
      "regenerá con: node scripts/generate-lucide-names.mjs",
    ).toEqual(installed);
  });

  it("las dos copias (api y shared) son idénticas byte a byte", () => {
    const api = readFileSync(path.join(ROOT, "api/src/lucide-icons.ts"), "utf8");
    const shared = readFileSync(path.join(ROOT, "shared/types/lucide-icons.ts"), "utf8");
    expect(shared).toBe(api);
  });

  it("isLucideIconName acepta nombres reales y rechaza inventados", () => {
    expect(isLucideIconName("heart-pulse")).toBe(true);
    expect(isLucideIconName("estetoscopio-magico")).toBe(false);
    expect(isLucideIconName("")).toBe(false);
    expect(isLucideIconName(undefined)).toBe(false);
  });
});
