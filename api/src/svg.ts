import sanitizeHtmlLib from "sanitize-html";

/**
 * Saneo de SVG, y por qué hasta ahora estaba rechazado.
 *
 * Un SVG no es una imagen: es un documento XML que el navegador ejecuta. Puede
 * traer `<script>`, manejadores `onload`, `<foreignObject>` con HTML adentro,
 * animaciones SMIL que reescriben atributos en tiempo de ejecución, hojas de
 * estilo con `@import` a un servidor ajeno, y referencias externas que filtran
 * quién está mirando la página. Aceptarlo "porque es un logo" es aceptar que
 * cualquiera con acceso al panel publique código en el sitio.
 *
 * Por eso se rechazaba: sin saneo, la única postura honesta era no aceptarlo.
 * Esto es el saneo.
 *
 * ## Cómo
 *
 * Con `sanitize-html`, que ya sanea el HTML del panel: parsea el documento y
 * descarta todo lo que no esté **explícitamente** permitido. Un filtro por
 * expresiones regulares no da esa garantía — `<scr<script>ipt>` y las
 * mayúsculas alcanzan para burlarlo.
 *
 * Tres diferencias con el saneo de HTML:
 *
 * 1. **`lowerCaseAttributeNames: false`.** En SVG los nombres de atributo
 *    distinguen mayúsculas: `viewBox` en minúsculas no es nada, y un logo sin
 *    `viewBox` deja de escalar.
 * 2. **Se rechaza antes de parsear** lo que un parser no debería ni ver:
 *    `<!DOCTYPE`, `<!ENTITY` y las instrucciones de proceso. Las entidades
 *    externas son XXE, que lee archivos del servidor.
 * 3. **Se verifica el resultado**: tiene que seguir siendo un `<svg>` y no
 *    puede haber quedado vacío.
 *
 * ## Qué queda afuera, y por qué
 *
 * | Elemento | Motivo |
 * |---|---|
 * | `script` | ejecuta |
 * | `foreignObject` | mete HTML —y con él, todo lo anterior— dentro del SVG |
 * | `style` | `@import` y `url()` traen recursos de otro servidor |
 * | `image` | referencia externa: filtra la IP de quien mira |
 * | `use` con destino externo | lo mismo, y puede traer contenido no saneado |
 * | `animate`, `set`, `animateTransform` | reescriben atributos en runtime; `set attributeName="href"` convierte un enlace inocente en `javascript:` |
 * | `a` | un logo no necesita ser un enlace desde adentro del archivo; el bloque ya tiene su propio `href` |
 * | `on*` | manejadores de evento |
 * | `style=` | `url(...)` y `expression(...)` |
 *
 * Queda una defensa más por debajo: la CSP de la API es `default-src 'none'`,
 * así que un SVG abierto directamente en `/uploads` no puede ejecutar nada
 * aunque el saneo fallara. Se sanea igual: una sola capa no es una garantía.
 */

/** Elementos de dibujo y estructura. Nada que ejecute ni que traiga recursos. */
const ELEMENTOS = [
  "svg", "g", "defs", "symbol", "title", "desc", "metadata",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textPath",
  "linearGradient", "radialGradient", "stop", "pattern",
  "clipPath", "mask", "filter",
  "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feComposite",
  "feFlood", "feMerge", "feMergeNode", "feMorphology", "feDropShadow",
  "marker", "switch",
];

/** Atributos comunes a casi todo. Presentación y geometría, nunca comportamiento. */
const COMUNES = [
  "id", "class", "transform", "opacity", "visibility", "display",
  "fill", "fill-opacity", "fill-rule", "clip-rule", "clip-path", "mask", "filter",
  "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit",
  "color", "vector-effect", "shape-rendering", "paint-order",
];

const TEXTO = [
  "x", "y", "dx", "dy", "font-family", "font-size", "font-weight", "font-style",
  "text-anchor", "dominant-baseline", "letter-spacing", "word-spacing", "writing-mode",
];

const ATRIBUTOS: Record<string, string[]> = {
  svg: [...COMUNES, "viewBox", "width", "height", "xmlns", "xmlns:xlink", "version",
        "preserveAspectRatio", "role", "aria-label", "aria-labelledby", "aria-hidden", "focusable"],
  g: [...COMUNES, ...TEXTO],
  defs: COMUNES,
  symbol: [...COMUNES, "viewBox", "preserveAspectRatio"],
  title: [],
  desc: [],
  metadata: [],
  path: [...COMUNES, "d", "pathLength"],
  rect: [...COMUNES, "x", "y", "width", "height", "rx", "ry"],
  circle: [...COMUNES, "cx", "cy", "r"],
  ellipse: [...COMUNES, "cx", "cy", "rx", "ry"],
  line: [...COMUNES, "x1", "y1", "x2", "y2"],
  polyline: [...COMUNES, "points"],
  polygon: [...COMUNES, "points"],
  text: [...COMUNES, ...TEXTO],
  tspan: [...COMUNES, ...TEXTO],
  textPath: [...COMUNES, ...TEXTO, "startOffset", "method", "spacing"],
  linearGradient: [...COMUNES, "x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform", "spreadMethod"],
  radialGradient: [...COMUNES, "cx", "cy", "r", "fx", "fy", "gradientUnits", "gradientTransform", "spreadMethod"],
  stop: [...COMUNES, "offset", "stop-color", "stop-opacity"],
  pattern: [...COMUNES, "x", "y", "width", "height", "patternUnits", "patternContentUnits", "patternTransform", "viewBox", "preserveAspectRatio"],
  clipPath: [...COMUNES, "clipPathUnits"],
  mask: [...COMUNES, "x", "y", "width", "height", "maskUnits", "maskContentUnits"],
  filter: [...COMUNES, "x", "y", "width", "height", "filterUnits", "primitiveUnits"],
  feGaussianBlur: [...COMUNES, "in", "stdDeviation", "result", "edgeMode"],
  feOffset: [...COMUNES, "in", "dx", "dy", "result"],
  feBlend: [...COMUNES, "in", "in2", "mode", "result"],
  feColorMatrix: [...COMUNES, "in", "type", "values", "result"],
  feComposite: [...COMUNES, "in", "in2", "operator", "k1", "k2", "k3", "k4", "result"],
  feFlood: [...COMUNES, "flood-color", "flood-opacity", "result"],
  feMerge: [...COMUNES, "result"],
  feMergeNode: [...COMUNES, "in"],
  feMorphology: [...COMUNES, "in", "operator", "radius", "result"],
  feDropShadow: [...COMUNES, "in", "dx", "dy", "stdDeviation", "flood-color", "flood-opacity", "result"],
  marker: [...COMUNES, "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits", "viewBox"],
  switch: COMUNES,
};

/**
 * Lo que ni siquiera debe llegar al parser.
 *
 * `<!ENTITY>` es XXE: una entidad externa hace que el parser lea un archivo
 * del servidor —`/etc/passwd`, `api/.env`— y lo incruste en el documento.
 * `<!DOCTYPE>` es lo que la habilita. Las instrucciones de proceso
 * (`<?xml-stylesheet?>`) cargan hojas de estilo externas.
 *
 * No se limpian: se rechaza el archivo. Un SVG institucional exportado por
 * cualquier herramienta de diseño no trae nada de esto, así que su presencia
 * no es un descuido de formato.
 */
const PROHIBIDO_ANTES_DE_PARSEAR: [RegExp, string][] = [
  [/<!DOCTYPE/i, "el SVG declara un DOCTYPE"],
  [/<!ENTITY/i, "el SVG declara entidades"],
  [/<\?xml-stylesheet/i, "el SVG referencia una hoja de estilo externa"],
];

/**
 * Los elementos cuyo **contenido** también se tira, no sólo la etiqueta.
 *
 * A la izquierda el nombre en minúsculas; a la derecha la única grafía que un
 * SVG legítimo puede traer. El mapa existe por un fallo concreto que encontró
 * la prueba de `<SCRIPT>` en mayúsculas.
 *
 * `lowerCaseTags: false` es obligatorio en SVG —`linearGradient`, `clipPath`,
 * `feGaussianBlur` y `textPath` dejan de existir en minúsculas—, pero tiene un
 * costo: `sanitize-html` compara los nombres tal cual vienen. `<SCRIPT>` no
 * coincide con `script`, así que no entraba en `nonTextTags`: la etiqueta se
 * descartaba y **su contenido quedaba como texto suelto dentro del SVG**. El
 * saneador informaba éxito y el código seguía en el archivo publicado.
 *
 * Lo que **no** se hace es renombrar la etiqueta a su forma canónica desde
 * `transformTags`. Se probó, y funciona a medias: `sanitize-html` recuerda el
 * renombre por profundidad y no lo limpia al cerrar, así que el siguiente
 * hermano al mismo nivel cerraba con la etiqueta ajena —un `<rect/>` salía
 * como `<rect></script>`—. Producir XML mal formado para tapar un agujero es
 * cambiar un problema por otro.
 *
 * Se rechaza el archivo, y no por comodidad: SVG es XML y sus nombres de
 * elemento distinguen mayúsculas, así que `<SCRIPT>` **no es** el elemento
 * script de SVG ni ninguna otra cosa válida. Ninguna herramienta de diseño lo
 * emite. Su presencia no es un descuido de formato: es alguien probando si el
 * saneador compara nombres sin normalizar.
 */
const PELIGROSOS: Record<string, string> = {
  script: "script",
  style: "style",
  foreignobject: "foreignObject",
  iframe: "iframe",
  object: "object",
  embed: "embed",
  a: "a",
  use: "use",
  image: "image",
  handler: "handler",
  // Las animaciones no se descartan sólo como etiqueta: `<set attributeName=
  // "href" to="javascript:…">` convierte un enlace inocente en uno que
  // ejecuta, y su contenido no tiene por qué conservarse.
  animate: "animate",
  set: "set",
  animatetransform: "animateTransform",
  animatemotion: "animateMotion",
  discard: "discard",
};

/** Los nombres canónicos: los únicos que `sanitize-html` va a tener que reconocer. */
const SIN_TEXTO = [...new Set(Object.values(PELIGROSOS))];

/**
 * ¿Hay algún elemento peligroso escrito en una grafía que no es la suya?
 *
 * Devuelve el nombre encontrado, o `null`. Se mira el texto crudo porque el
 * objetivo es justamente no depender de cómo lo normalice un parser.
 */
function grafiaEvasiva(texto: string): string | null {
  for (const [, nombre] of texto.matchAll(/<\s*([A-Za-z][\w:.-]*)/g)) {
    const canonico = PELIGROSOS[nombre.toLowerCase()];
    if (canonico && nombre !== canonico) return nombre;
  }
  return null;
}

/**
 * Referencias internas y nada más.
 *
 * `url(#recorte)` y `href="#simbolo"` apuntan al propio documento y son la
 * forma normal de usar gradientes y símbolos. Cualquier otra cosa —`url(http…)`,
 * `href="//host"`, `javascript:`— sale del archivo.
 */
const SOLO_FRAGMENTO = /^#[A-Za-z_][\w.:-]*$/;
const URL_INTERNA = /^url\(\s*['"]?#[A-Za-z_][\w.:-]*['"]?\s*\)$/;

/** Un color o `none`/`currentColor`, o una referencia interna a un gradiente. */
function valorDePinturaSeguro(valor: string): boolean {
  const v = valor.trim();
  if (v === "" || v === "none" || v === "currentColor" || v === "transparent") return true;
  if (URL_INTERNA.test(v)) return true;
  // `url(` en cualquier otra forma se descarta; el resto son colores.
  return !/url\s*\(/i.test(v) && !/[<>]/.test(v);
}

export type ResultadoSvg = { ok: true; svg: string; width: number | null; height: number | null } | { ok: false; error: string };

/**
 * Sanea un SVG y devuelve los bytes que sí se pueden publicar.
 *
 * Devuelve el texto saneado, no el original: guardar el original y "confiar en
 * que el saneo lo revisó" deja el archivo peligroso en el disco esperando a
 * que alguien lo sirva por otra vía.
 */
export function sanearSvg(entrada: string): ResultadoSvg {
  const texto = String(entrada ?? "");

  for (const [patron, motivo] of PROHIBIDO_ANTES_DE_PARSEAR) {
    if (patron.test(texto)) return { ok: false, error: motivo };
  }
  if (!/<svg[\s>]/i.test(texto)) return { ok: false, error: "el archivo no es un SVG" };

  // Ver `PELIGROSOS`: una grafía que no es la canónica no es un descuido.
  if (grafiaEvasiva(texto)) return { ok: false, error: "el SVG trae una etiqueta escrita para evadir el saneo" };

  const limpio = sanitizeHtmlLib(texto, {
    allowedTags: ELEMENTOS,
    allowedAttributes: ATRIBUTOS,
    // En SVG los nombres de atributo distinguen mayúsculas: `viewBox` en
    // minúsculas no existe, y sin él un logo deja de escalar.
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
    // El contenido de estos no se conserva como texto: se descarta entero.
    nonTextTags: SIN_TEXTO,
    disallowedTagsMode: "discard",
    allowedSchemes: [],
    allowVulnerableTags: false,
    transformTags: {
      "*": (tagName, attribs) => {
        const salida: Record<string, string> = {};
        for (const [nombre, valor] of Object.entries(attribs)) {
          // Doble red: `on*` no está en ninguna allowlist, pero un nombre de
          // atributo es lo último donde conviene confiar en una sola capa.
          if (/^on/i.test(nombre)) continue;
          if (/^(href|xlink:href|src)$/i.test(nombre)) {
            if (SOLO_FRAGMENTO.test(valor)) salida[nombre] = valor;
            continue;
          }
          if (!valorDePinturaSeguro(valor)) continue;
          salida[nombre] = valor;
        }
        return { tagName, attribs: salida };
      },
    },
  });

  if (!/<svg[\s>]/i.test(limpio)) return { ok: false, error: "el SVG no quedó utilizable después de sanearlo" };

  return { ok: true, svg: limpio, ...dimensiones(limpio) };
}

/**
 * Ancho y alto **sin rasterizar**.
 *
 * Sharp podría abrirlo y decirlo, pero abrirlo es correr librsvg sobre un
 * archivo que subió alguien: otro parser más sobre entrada no confiable, para
 * averiguar dos números que están escritos en el propio archivo. Se leen del
 * texto ya saneado.
 */
function dimensiones(svg: string): { width: number | null; height: number | null } {
  const etiqueta = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";

  const numero = (valor: string | undefined): number | null => {
    if (!valor) return null;
    // `width="100px"` y `width="100"` son lo mismo. `width="50%"` es relativo
    // al contenedor y no dice cuánto mide: no sirve para reservar espacio.
    const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(valor);
    if (!m) return null;
    const n = Math.round(Number(m[1]));
    return Number.isFinite(n) && n > 0 && n <= 10000 ? n : null;
  };

  const atributo = (nombre: string) =>
    new RegExp(`\\b${nombre}\\s*=\\s*["']([^"']*)["']`, "i").exec(etiqueta)?.[1];

  const w = numero(atributo("width"));
  const h = numero(atributo("height"));
  if (w && h) return { width: w, height: h };

  // Sin width/height explícitos, el viewBox da la proporción y el tamaño
  // nominal, que es lo que usa el navegador para dibujarlo.
  const caja = atributo("viewBox");
  if (caja) {
    const partes = caja.trim().split(/[\s,]+/).map(Number);
    if (partes.length === 4 && partes.every((n) => Number.isFinite(n))) {
      const [, , cw, ch] = partes;
      if (cw > 0 && ch > 0 && cw <= 10000 && ch <= 10000) {
        return { width: Math.round(cw), height: Math.round(ch) };
      }
    }
  }
  return { width: w, height: h };
}
