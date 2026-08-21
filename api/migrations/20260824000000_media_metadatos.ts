import type { Knex } from "knex";

/**
 * Metadatos efectivos de cada archivo de la biblioteca.
 *
 * `media` guardaba url, mime, tamaño, alt y quién subió — y nada sobre el
 * archivo que quedó. La biblioteca no podía decir de qué tamaño era una
 * imagen sin descargarla, ni distinguir un GIF animado de uno fijo, ni
 * detectar que un `.webp` guardado tenía adentro bytes JPEG. Ese último caso
 * existía de verdad: el pipeline convertía a JPEG sin cambiar la extensión.
 *
 * Se agregan tres columnas, todas anulables:
 *
 * - `width` y `height`: las de **un** cuadro, ya procesado y redimensionado.
 * - `frames`: cuántos cuadros tiene. 1 en una imagen fija.
 *
 * Anulables porque un PDF no tiene ninguna de las tres, y porque las filas que
 * ya existen se subieron con el pipeline viejo: no se puede afirmar su tamaño
 * sin volver a abrir cada archivo, y esta migración no toca archivos. Quedan
 * en `NULL`, que es "no se sabe" y no "cero".
 *
 * `animated` no es una columna: se deriva de `frames > 1`. Guardar las dos
 * permite que se contradigan.
 *
 * No se edita `20260516000001_init.ts`: ya está aplicada en la base del
 * sanatorio y una migración aplicada no se reescribe.
 */

const COLUMNAS = ["width", "height", "frames"] as const;

export async function up(knex: Knex): Promise<void> {
  const faltantes: string[] = [];
  for (const columna of COLUMNAS) {
    if (!(await knex.schema.hasColumn("media", columna))) faltantes.push(columna);
  }
  if (faltantes.length === 0) return;

  await knex.schema.alterTable("media", (t) => {
    // Sin `defaultTo`: el valor por defecto de una columna anulable es NULL, y
    // NULL es exactamente lo que corresponde a "todavía no se midió".
    if (faltantes.includes("width")) t.integer("width").unsigned().nullable();
    if (faltantes.includes("height")) t.integer("height").unsigned().nullable();
    if (faltantes.includes("frames")) t.integer("frames").unsigned().nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  const presentes: string[] = [];
  for (const columna of COLUMNAS) {
    if (await knex.schema.hasColumn("media", columna)) presentes.push(columna);
  }
  if (presentes.length === 0) return;

  await knex.schema.alterTable("media", (t) => {
    t.dropColumns(...presentes);
  });
}
