import type { Knex } from "knex";

/**
 * Quién está usando un archivo de la biblioteca.
 *
 * Borrar un archivo referenciado no falla: rompe la página que lo usa, y se
 * nota recién cuando alguien la visita y ve un hueco. La fila desaparece de
 * Multimedia, el archivo desaparece del disco, y el `imageUrl` del bloque
 * sigue apuntando a una URL que ahora da 404. Nadie relaciona las dos cosas.
 *
 * Las ubicaciones que se buscan son las que **existen** en este esquema, no
 * las que uno supondría:
 *
 * | Dónde | Cómo |
 * |---|---|
 * | Bloques de páginas | `blocks.props`, JSON con la URL adentro |
 * | Logo institucional | `settings["brand"].logoUrl` |
 * | Imagen para redes | `settings["seo"].ogImage` |
 * | Fotos de médicos | `doctors.photo_url` |
 *
 * Los bloques viven en su **propia tabla**, con `page_id` y `props` JSON; no
 * hay una columna `blocks` en `pages`. Y no hay más columnas de imagen en el
 * esquema: `specialties`, `services` y `studies` usan iconos lucide por
 * nombre, no archivos.
 *
 * ## Qué se devuelve y qué no
 *
 * Sólo **dónde** y **cuántas**: "3 bloques en 2 páginas", con el título de la
 * página. Nunca el contenido institucional de esos bloques. Quien borra
 * necesita saber a qué ir a cambiar, no leer la página desde un mensaje de
 * error.
 */

export interface Referencia {
  /** Etiqueta funcional de la ubicación, para mostrar en el panel. */
  lugar: string;
  /** Cuántas veces aparece ahí. */
  cantidad: number;
  /** A dónde ir a corregirlo, como ruta interna del panel. */
  ruta?: string;
}

/**
 * Cuántas veces aparece `url` dentro de un valor JSON arbitrario.
 *
 * Recorre el árbol en vez de buscar en el texto serializado: así `"/uploads/a.png"`
 * no cuenta como referencia de `/uploads/a.pn`, y una URL que aparezca dentro
 * de una clave —no de un valor— no cuenta.
 */
export function contarEnJson(valor: unknown, url: string): number {
  if (typeof valor === "string") return valor === url ? 1 : 0;
  if (Array.isArray(valor)) return valor.reduce((n: number, v) => n + contarEnJson(v, url), 0);
  if (valor && typeof valor === "object") {
    return Object.values(valor as Record<string, unknown>).reduce(
      (n: number, v) => n + contarEnJson(v, url),
      0,
    );
  }
  return 0;
}

/** MariaDB devuelve las columnas JSON como string; MySQL 8 ya parseadas. */
function comoJson(valor: unknown): unknown {
  if (typeof valor !== "string") return valor;
  try {
    return JSON.parse(valor);
  } catch {
    return null;
  }
}

/**
 * Todas las ubicaciones que usan `url`, vacío si el archivo está libre.
 *
 * Se consulta sobre el esquema efectivo. Si mañana aparece otra entidad con
 * imágenes hay que agregarla acá **y** a `tests/media-referencias.test.ts`:
 * una referencia que este archivo no conoce es un borrado que rompe contenido
 * sin avisar.
 */
export async function referenciasDe(db: Knex, url: string): Promise<Referencia[]> {
  const encontradas: Referencia[] = [];

  // 1. Bloques de páginas. La URL puede estar en `imageUrl`, en `url`, dentro
  //    de un array de logos o de slides. Por eso se recorre el árbol entero de
  //    `props` y no un conjunto de claves conocidas: una clave nueva en un
  //    bloque futuro quedaría fuera y el borrado volvería a romper contenido.
  const bloques = await db("blocks as b")
    .leftJoin("pages as p", "p.id", "b.page_id")
    .select("b.props", "p.title", "p.slug", "p.id as page_id");

  let apariciones = 0;
  const paginas = new Set<string>();
  for (const bloque of bloques) {
    const n = contarEnJson(comoJson(bloque.props), url);
    if (n === 0) continue;
    apariciones += n;
    paginas.add(String(bloque.title ?? bloque.slug ?? `#${bloque.page_id}`));
  }
  if (apariciones > 0) {
    const titulos = [...paginas];
    encontradas.push({
      lugar: `Bloques de ${titulos.length === 1 ? "la página" : "las páginas"} ${titulos.join(", ")}`,
      cantidad: apariciones,
      ruta: "/pages",
    });
  }

  // 2 y 3. Ajustes institucionales.
  const ajustes = await db("settings").whereIn("key", ["brand", "seo"]).select("key", "value");
  for (const fila of ajustes) {
    const valor = comoJson(fila.value) as Record<string, unknown> | null;
    if (!valor) continue;
    if (fila.key === "brand" && valor.logoUrl === url) {
      encontradas.push({ lugar: "Logo institucional", cantidad: 1, ruta: "/settings" });
    }
    if (fila.key === "seo" && valor.ogImage === url) {
      encontradas.push({ lugar: "Imagen para redes sociales (SEO)", cantidad: 1, ruta: "/settings" });
    }
  }

  // 4. Fotos de médicos.
  const medicos = await db("doctors").where({ photo_url: url }).select("id", "name");
  if (medicos.length > 0) {
    encontradas.push({
      lugar: `Foto de ${medicos.map((m: { name: string }) => m.name).join(", ")}`,
      cantidad: medicos.length,
      ruta: "/doctors",
    });
  }

  return encontradas;
}
