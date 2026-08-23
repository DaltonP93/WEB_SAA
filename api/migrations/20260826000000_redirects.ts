import type { Knex } from "knex";

/**
 * Redirects 301 en una tabla, no fijos en el codigo.
 *
 * Las cuatro rutas viejas del portal vivian repetidas en tres lugares
 * (`legacy-redirects.ts`, el `<Navigate>` del front y el `nginx.conf`). Se
 * mueven a una tabla editable desde el panel, y **se siembran esas mismas
 * cuatro** para que nada cambie: quien tenia un enlace a
 * `/portal-resultados-diagnostico` lo sigue teniendo redirigido a
 * `/portal-paciente`. No se inventa ningun redirect nuevo.
 *
 * `from_path` es unico y normalizado (minusculas, sin barra final) por la API
 * antes de guardar; `active` permite apagar un redirect sin borrarlo. El destino
 * lo valida la API como ruta interna del mismo sitio (no open redirect).
 *
 * Reversible: `down()` borra la tabla entera. Como las cuatro legacy siguen
 * existiendo como respaldo en `redirects.ts` (la cache arranca con ellas), y
 * en produccion tambien en el `nginx.conf`, revertir la migracion no deja el
 * portal sin redirigir.
 */

const CANONICAL = "/portal-paciente";
const LEGACY = [
  "/portal-resultados-diagnostico",
  "/portal-resultados-laboratorio",
  "/portal-presupuestos-cirugia",
  "/portal-facturacion-electronica",
];

export async function up(knex: Knex): Promise<void> {
  const existe = await knex.schema.hasTable("redirects");
  if (!existe) {
    await knex.schema.createTable("redirects", (t) => {
      t.increments("id").primary();
      t.string("from_path", 300).notNullable().unique();
      t.string("to_path", 300).notNullable();
      t.boolean("active").notNullable().defaultTo(true);
      t.timestamps(true, true);
    });
  }

  // Siembra idempotente de las cuatro legacy: si ya estan, no se tocan.
  for (const from of LEGACY) {
    await knex("redirects")
      .insert({ from_path: from, to_path: CANONICAL, active: true })
      .onConflict("from_path")
      .ignore();
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("redirects")) {
    await knex.schema.dropTable("redirects");
  }
}
