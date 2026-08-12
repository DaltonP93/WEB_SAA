/**
 * Genera la lista de nombres de iconos de la versión de lucide-react
 * instalada, en `api/src/lucide-icons.ts` y `shared/types/lucide-icons.ts`.
 *
 * La API valida los nombres que carga el panel, pero `lucide-react` es una
 * dependencia del front, no del back: en vez de sumarla al servidor se
 * congela la lista acá. `tests/icons.test.ts` compara la lista generada con el
 * paquete instalado, así que actualizar lucide sin regenerar rompe CI.
 *
 *   node scripts/generate-lucide-names.mjs
 */

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(ROOT, "apps/web/package.json"));

const mod = require("lucide-react/dynamicIconImports");
const names = Object.keys(mod.default ?? mod).sort();

if (names.length < 500) {
  console.error(`Lista sospechosamente corta (${names.length}); no se escribe nada.`);
  process.exit(1);
}

const body = `/**
 * Nombres de iconos válidos de lucide-react. **Archivo generado.**
 *
 * Se regenera con \`node scripts/generate-lucide-names.mjs\` y lo compara con
 * el paquete instalado \`tests/icons.test.ts\`. La API lo usa para rechazar
 * nombres inexistentes sin depender de lucide-react en el servidor.
 */

export const LUCIDE_ICON_NAMES: readonly string[] = [
${names.map((n) => `  ${JSON.stringify(n)},`).join("\n")}
];

const NAMES = new Set(LUCIDE_ICON_NAMES);

/** ¿Es un nombre de icono existente en la versión instalada de lucide? */
export function isLucideIconName(value: unknown): value is string {
  return typeof value === "string" && NAMES.has(value);
}
`;

// Dos copias byte a byte iguales: la API no puede importar valores de
// `shared/` (rootDir) y `shared/` no depende de lucide-react.
const targets = ["api/src/lucide-icons.ts", "shared/types/lucide-icons.ts"];
for (const rel of targets) {
  writeFileSync(resolve(ROOT, rel), body, "utf8");
  console.log(`${rel}: ${names.length} iconos`);
}
