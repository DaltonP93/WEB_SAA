import type { Knex } from "knex";

/**
 * Corrige el rollback de `20260827000000_brand_logo` y
 * `20260828000000_brand_favicon`.
 *
 * Aquellas migraciones **crean** la fila `settings.brand` cuando todavía no
 * existe (`insert ... onConflict.merge`), pero su `down()` sólo la **actualiza**
 * vaciando su campo (`logoUrl`/`faviconUrl` → `""`); nunca la borra. Sobre una
 * base donde `brand` no existía —una instalación migrada pero **sin sembrar**,
 * como la de `tests/migrations.test.ts`— revertir la cadena deja una fila
 * residual `{ logoUrl: "", faviconUrl: "" }` que en el estado anterior no
 * estaba. El snapshot de la prueba lo detecta y el rollback deja de ser exacto.
 *
 * ## Cómo se desarma sin editar migraciones ya fusionadas
 *
 * Esta migración es **posterior**, así que en un rollback su `down()` corre
 * **antes** que el de `brand_favicon` y `brand_logo`. Si detecta que la fila
 * `brand` es exactamente la que aquellas auto-crearon —sus únicas claves son
 * `logoUrl`/`faviconUrl` y valen el asset por defecto que sus `down()` van a
 * vaciar— la elimina acá. Al no quedar fila, los `down()` de
 * `brand_favicon`/`brand_logo` (que sólo actúan `if (row)` y jamás insertan) se
 * vuelven no-ops y no reintroducen el residuo.
 *
 * **No** se borra la fila si tiene cualquier otra clave (`name`, `tagline`,
 * colores…) o si `logoUrl`/`faviconUrl` fueron personalizados: en esos casos la
 * fila preexistía a estas migraciones —la siembra la crea con `name`+`tagline`—
 * y su contenido se preserva íntegro. El defecto está sólo en el rollback, así
 * que `up()` no toca datos.
 */

const BRAND_KEY = "brand";
const LOGO_URL = "/logo-sanatorio.png";
const FAVICON_URL = "/favicon.png";
/**
 * Claves que `brand_logo`/`brand_favicon` inyectan por defecto. Una fila cuyas
 * claves son un subconjunto de éstas —y con esos valores por defecto— sólo
 * existe porque esas dos migraciones la crearon.
 */
const AUTO_KEYS = new Set(["logoUrl", "faviconUrl"]);

/** Parseo tolerante: MySQL devuelve el JSON ya parseado; otros motores, string. */
function parseBrand(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * ¿La fila `brand` es exactamente la que `brand_logo`/`brand_favicon`
 * auto-crearon, sin ninguna personalización del sanatorio?
 *
 * Verdadero sólo si no tiene más claves que `logoUrl`/`faviconUrl` y las que
 * tiene valen el asset por defecto (el mismo que sus `down()` van a vaciar).
 * Ante JSON inválido, arreglos o cualquier forma inesperada devuelve `false`,
 * de modo que la fila se preserva.
 */
function esFilaAutogenerada(brand: Record<string, unknown> | null): boolean {
  if (!brand) return false;
  const keys = Object.keys(brand);
  if (keys.length === 0) return false;
  if (!keys.every((k) => AUTO_KEYS.has(k))) return false;
  if ("logoUrl" in brand && brand.logoUrl !== LOGO_URL) return false;
  if ("faviconUrl" in brand && brand.faviconUrl !== FAVICON_URL) return false;
  return true;
}

export async function up(): Promise<void> {
  // Sin cambios de datos: el defecto está únicamente en el rollback. Al no
  // escribir nada, es idempotente por definición.
}

export async function down(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: BRAND_KEY }).first();
  if (!row) return; // Fila ausente: nada que desarmar. Idempotente.
  if (esFilaAutogenerada(parseBrand(row.value))) {
    await knex("settings").where({ key: BRAND_KEY }).del();
  }
  // En cualquier otro caso la fila preexistía o fue personalizada: se preserva y
  // los `down()` de `brand_favicon`/`brand_logo` la ajustan según su propio guard.
}
