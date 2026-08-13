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
/** `hsl(0 90% 60%)` / `hsla(350,90%,60%,.8)` → RGB aproximado. */
function fromHsl(token: string): Rgb | null {
  const m = /^hsla?\(([^)]+)\)$/.exec(token);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  let h = parseFloat(parts[0]);
  if (Number.isNaN(h)) return null;
  if (/turn$/.test(parts[0])) h *= 360;
  else if (/rad$/.test(parts[0])) h = (h * 180) / Math.PI;
  const sat = parseFloat(parts[1]) / 100;
  const light = parseFloat(parts[2]) / 100;
  if (Number.isNaN(sat) || Number.isNaN(light)) return null;
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m2 = light - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m2) * 255, (g + m2) * 255, (b + m2) * 255];
}

/**
 * `oklch()` y `color-mix()` no se intentan convertir.
 *
 * Convertir oklch bien exige el pipeline completo de color; y `color-mix()`
 * depende de lo que haya adentro. En vez de aproximar mal, se tratan como
 * sospechosos: un color administrable no necesita esas sintaxis, así que
 * rechazarlas es más seguro que interpretarlas.
 */
const OPAQUE_SYNTAX = /\b(oklch|oklab|lch|lab|color-mix|color)\s*\(/i;

export function isInstitutionalRed(value: string | undefined | null): boolean {
  if (!value) return false;
  const text = value.toLowerCase();
  if (OPAQUE_SYNTAX.test(text)) return true;
  const tokens = [
    ...(text.match(/#[0-9a-f]{3,8}\b/g) ?? []),
    ...(text.match(/rgba?\([^)]*\)/g) ?? []),
    ...(text.match(/hsla?\([^)]*\)/g) ?? []),
    ...(text.match(/[a-z]+/g) ?? []).filter((w) => NAMED_REDS.has(w)),
  ];
  for (const token of tokens) {
    if (NAMED_REDS.has(token)) return true;
    const rgb = token.startsWith("#")
      ? fromHex(token)
      : token.startsWith("hsl")
        ? fromHsl(token)
        : fromFunctional(token);
    if (rgb && rgb.every((n) => Number.isFinite(n)) && isRedRgb(rgb)) return true;
  }
  return false;
}

function normalizeText(parts: (string | undefined | null)[]): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * ¿El texto habla de Emergencias?
 *
 * Sólo "emergencia(s)". Antes también valía "urgencia", que aparece en
 * descripciones de cualquier servicio ("cirugías de urgencia") y alcanzaba
 * para pedir el rojo desde un bloque que no era de Emergencias.
 */
export function mentionsEmergency(...parts: (string | undefined | null)[]): boolean {
  return /emergenc/.test(normalizeText(parts));
}

/** Destino canónico de Emergencias. */
export const EMERGENCY_HREF = "/emergencias";

/**
 * ¿El CTA es realmente de Emergencias?
 *
 * Hacen falta las dos cosas: que apunte a `/emergencias` y que el texto lo
 * diga. Con sólo una, cualquier bloque que mencionara la palabra podía pedir
 * el rojo institucional.
 */
export function isEmergencyCta(props: {
  title?: string | null;
  text?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
}): boolean {
  const href = (props.ctaHref ?? "").trim().toLowerCase().replace(/\/+$/, "");
  if (href !== EMERGENCY_HREF) return false;
  return mentionsEmergency(props.title, props.text, props.ctaLabel);
}

/** Mensajes usados por los schemas (duplicados en la API). */
export const RED_RESERVED_MESSAGE =
  "El rojo institucional está reservado para Emergencias: no se puede cargar como fondo.";
export const EMERGENCY_VARIANT_MESSAGE =
  "La variante 'emergency' requiere que el CTA apunte a /emergencias y que su texto hable de Emergencias.";

/**
 * Paleta institucional: los únicos colores que el panel puede elegir.
 *
 * Reconocer "todos los rojos posibles" es una carrera perdida: siempre queda
 * una sintaxis nueva (`oklch`, `color-mix`, un espacio de color futuro). Con
 * una allowlist el problema se invierte — lo que no está listado no entra— y
 * además protege la identidad de marca, que es lo que la regla busca en
 * primer lugar.
 *
 * `accent` es el rojo de Emergencias y por eso no es configurable: cambiarlo
 * sería pintar de otro color el único elemento que debe destacarse.
 */
export const THEME_PALETTE: Record<string, readonly string[]> = {
  // Adventist Health: Pantone 7462 C.
  primary: ["#005587"],
  // Adventist Health: Pantone 311 C.
  secondary: ["#00b5da"],
  // Rojo de Emergencias. No se cambia.
  accent: ["#f5543f"],
  bg: ["#ffffff", "#f9fafb"],
  text: ["#1a1a1a", "#111827"],
};

/** Slots de `settings.theme` que son colores (el resto son fuentes y radios). */
export const THEME_COLOR_KEYS = Object.keys(THEME_PALETTE);

/** ¿El color está aprobado para ese slot del tema? */
export function isApprovedThemeColor(slot: string, value: unknown): boolean {
  const allowed = THEME_PALETTE[slot];
  if (!allowed) return true; // no es un slot de color
  if (typeof value !== "string") return false;
  return allowed.includes(value.trim().toLowerCase());
}

export const THEME_COLOR_MESSAGE =
  "color fuera de la paleta institucional: elegí uno de los aprobados para ese campo";
