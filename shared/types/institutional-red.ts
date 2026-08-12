/**
 * Rojo institucional: reservado para Emergencias.
 *
 * Regla de marca del sanatorio (minuta, punto 12): el rojo sólo identifica a
 * Emergencias. En el producto eso se traduce en dos cosas:
 *
 * 1. Un CTA se pinta de rojo únicamente con `variant: "emergency"`, y esa
 *    variante sólo se acepta si el bloque habla de Emergencias.
 * 2. Ningún bloque puede colar rojo por la puerta de atrás con un override
 *    libre (`background`). Por eso el chequeo trabaja sobre el tono y no
 *    sobre un valor puntual: `#f5543f`, `red`, `#f00`, `rgb(255,0,0)` y un
 *    degradado con una parada roja quedan todos rechazados.
 *
 * **Excepción de marca (colores oficiales de redes sociales).** El rojo de
 * YouTube (`#FF0000`) no es el rojo institucional: es el color oficial de un
 * tercero. Vive exclusivamente en la lista `NETWORKS` de
 * `apps/web/src/components/../blocks/SocialLinks.tsx`, como fondo del ícono
 * circular de la red, junto a los de Facebook, Instagram y LinkedIn. No es
 * administrable desde el panel, no usa el token `accent` del tema y nunca se
 * aplica a un llamado a la acción. Esta función no se ejecuta sobre esos
 * colores porque no provienen de contenido cargado; si alguien intentara
 * cargar `#FF0000` como fondo de un CTA, sí sería rechazado.
 *
 * Este archivo existe dos veces, byte a byte igual, en
 * `shared/types/institutional-red.ts` y en `api/src/institutional-red.ts`,
 * porque la API no puede importar valores de `shared/` (`rootDir`).
 * `tests/emergency-red.test.ts` compara ambas copias y falla si divergen.
 */

/** Nombres CSS que caen dentro de la familia del rojo institucional. */
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
    const [r, g, b] = [hex[0], hex[1], hex[2]].map((c) => parseInt(c + c, 16));
    return [r, g, b];
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

/** ¿El color cae en la familia del rojo? Trabaja en HSL para tolerar variantes. */
function isRedRgb([r, g, b]: Rgb): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2 / 255;
  if (delta === 0) return false;
  const s = delta / (255 - Math.abs(2 * l * 255 - 255));
  // Grises, casi negros y casi blancos no leen como rojo institucional.
  if (s < 0.25 || l < 0.15 || l > 0.85) return false;
  let h: number;
  if (max === r) h = 60 * (((g - b) / delta + 6) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);
  return h <= 20 || h >= 340;
}

/**
 * `true` si el valor contiene algún rojo institucional.
 *
 * Acepta el string completo tal como lo carga el panel: puede ser un color
 * suelto, un `linear-gradient(...)` o cualquier valor de `background`. Se
 * revisa cada token de color por separado para que una parada roja dentro de
 * un degradado tampoco pase.
 */
export function isInstitutionalRed(value: string | undefined | null): boolean {
  if (!value) return false;
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

/**
 * ¿El bloque habla de Emergencias?
 *
 * Se compara sin tildes ni mayúsculas para que "Emergencias", "emergencia" y
 * "EMERGENCIAS 24" pasen igual, y se acepta también un destino `/emergencias`.
 */
export function mentionsEmergency(...parts: (string | undefined | null)[]): boolean {
  const text = parts
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /emergenc|urgenc/.test(text);
}

/** Mensajes usados por los schemas (duplicados en la API). */
export const RED_RESERVED_MESSAGE =
  "El rojo institucional está reservado para Emergencias: no se puede cargar como fondo.";
export const EMERGENCY_VARIANT_MESSAGE =
  "La variante 'emergency' sólo se permite en bloques de Emergencias.";
