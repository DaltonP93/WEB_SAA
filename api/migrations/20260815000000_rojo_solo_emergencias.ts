import type { Knex } from "knex";

/**
 * El rojo institucional queda reservado para Emergencias (minuta, punto 12).
 *
 * Hasta ahora un CTA pedía rojo con `variant: "accent"`, disponible para
 * cualquier bloque, y además podía colarlo por el override libre `background`.
 * A partir de esta migración:
 *
 *  - la única variante roja es `emergency`, y el schema (`block-schemas.ts` /
 *    `block-validation.ts`) sólo la acepta si el bloque habla de Emergencias;
 *  - `background` no admite ningún rojo, ni siquiera en Emergencias: ahí el
 *    color lo pone la variante.
 *
 * Esta migración adapta el contenido ya cargado a esa regla:
 *  - `accent` → `emergency` si el bloque habla de Emergencias, si no `primary`;
 *  - `emergency` sin contenido de Emergencias → `primary`;
 *  - se descarta cualquier `background` rojo, del tipo de bloque que sea.
 *
 * Es no destructiva e idempotente: guarda un snapshot de cada prop que toca la
 * primera vez y, si ya corrió, no vuelve a pasar (una edición posterior del
 * cliente se conserva). `down()` restaura exactamente los valores previos.
 *
 * Nota: los colores oficiales de redes sociales (YouTube #FF0000 y compañía)
 * no entran acá. Viven en el componente `SocialLinks`, no son administrables y
 * no usan el token `accent` del tema; son una excepción de marca, no el rojo
 * institucional de llamadas a la acción.
 */

const SNAPSHOT_KEY = "snapshot_rojo_solo_emergencias_20260815000000";

interface BlockRow {
  id: number;
  type: string;
  props: unknown;
}

interface Snapshot {
  createdAt: string;
  /** Props completas de cada bloque modificado, indexadas por id. */
  blocks: { id: number; props: unknown }[];
}

function parseJson(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/*
 * Los helpers se copian acá a propósito. Una migración es una foto del pasado:
 * si importara `src/institutional-red.ts`, un cambio futuro en esa regla
 * cambiaría lo que hizo esta migración al correrla de nuevo en otro entorno.
 * La versión viva está en `shared/types/institutional-red.ts`.
 */

const NAMED_REDS = new Set([
  "red",
  "crimson",
  "firebrick",
  "darkred",
  "indianred",
  "tomato",
  "orangered",
  "salmon",
  "darksalmon",
  "lightsalmon",
  "lightcoral",
  "maroon",
  "coral",
]);

type Rgb = [number, number, number];

function fromHex(token: string): Rgb | null {
  const hex = token.replace("#", "");
  if (hex.length === 3 || hex.length === 4) {
    return [hex[0], hex[1], hex[2]].map((c) => parseInt(c + c, 16)) as Rgb;
  }
  if (hex.length === 6 || hex.length === 8) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

function fromFunctional(token: string): Rgb | null {
  const m = /^rgba?\(([^)]+)\)$/.exec(token);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
  if (parts.length < 3) return null;
  const nums = parts.map((p) => (p.endsWith("%") ? (parseFloat(p) * 255) / 100 : parseFloat(p)));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return [nums[0], nums[1], nums[2]] as Rgb;
}

function isRedRgb([r, g, b]: Rgb): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2 / 255;
  if (delta === 0) return false;
  const s = delta / (255 - Math.abs(2 * l * 255 - 255));
  if (s < 0.25 || l < 0.15 || l > 0.85) return false;
  let h: number;
  if (max === r) h = 60 * (((g - b) / delta + 6) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);
  return h <= 20 || h >= 340;
}

function isInstitutionalRed(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  const text = value.toLowerCase();
  const tokens = [
    ...(text.match(/#[0-9a-f]{3,8}\b/g) ?? []),
    ...(text.match(/rgba?\([^)]*\)/g) ?? []),
    ...(text.match(/[a-z]+/g) ?? []).filter((w) => NAMED_REDS.has(w)),
  ];
  for (const token of tokens) {
    if (NAMED_REDS.has(token)) return true;
    const rgb = token.startsWith("#") ? fromHex(token) : fromFunctional(token);
    if (rgb && rgb.every((n) => Number.isFinite(n)) && isRedRgb(rgb)) return true;
  }
  return false;
}

function mentionsEmergency(...parts: unknown[]): boolean {
  const text = parts
    .filter((p): p is string => typeof p === "string")
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /emergenc|urgenc/.test(text);
}

export async function up(knex: Knex): Promise<void> {
  const alreadyRan = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (alreadyRan) return;

  const snapshot: Snapshot = { createdAt: new Date().toISOString(), blocks: [] };

  const blocks = (await knex("blocks").select("id", "type", "props")) as BlockRow[];
  for (const block of blocks) {
    const props = parseJson(block.props);
    if (!props || typeof props !== "object") continue;

    const next = { ...props } as Record<string, unknown>;
    let changed = false;

    // 1. Variantes de CTA: el rojo pasa a pedirse explícitamente.
    if (block.type === "cta") {
      const variant = next.variant;
      const isEmergencyContent = mentionsEmergency(
        next.title,
        next.text,
        next.ctaLabel,
        next.ctaHref,
      );
      if (variant === "accent") {
        next.variant = isEmergencyContent ? "emergency" : "primary";
        changed = true;
      } else if (variant === "emergency" && !isEmergencyContent) {
        next.variant = "primary";
        changed = true;
      }
    }

    // 2. Overrides rojos: fuera, en cualquier tipo de bloque.
    if (isInstitutionalRed(next.background)) {
      delete next.background;
      changed = true;
    }

    if (!changed) continue;
    snapshot.blocks.push({ id: block.id, props });
    await knex("blocks").where({ id: block.id }).update({ props: JSON.stringify(next) });
  }

  await knex("settings").insert({
    key: SNAPSHOT_KEY,
    value: JSON.stringify(snapshot),
    updated_at: knex.fn.now(),
  });
}

export async function down(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: SNAPSHOT_KEY }).first("value");
  if (!row) return;
  const snapshot = parseJson(row.value) as Snapshot;

  for (const block of snapshot.blocks ?? []) {
    await knex("blocks")
      .where({ id: block.id })
      .update({ props: JSON.stringify(block.props ?? {}) });
  }

  await knex("settings").where({ key: SNAPSHOT_KEY }).del();
}
