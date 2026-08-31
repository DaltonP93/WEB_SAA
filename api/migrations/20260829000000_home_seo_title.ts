import type { Knex } from "knex";

/**
 * La pestaña del navegador en "/" mostraba el título SEO de la página home,
 * que quedó igual al título administrativo de la página ("Inicio"). Lo
 * reemplaza por el nombre completo del sanatorio, mucho más útil como texto
 * de pestaña/marcador — sin tocar el título administrativo (el que aparece
 * en el listado de páginas del panel), que sigue siendo "Inicio".
 *
 * Solo toca la fila si el SEO título sigue siendo exactamente "Inicio": si
 * el sanatorio ya lo personalizó desde el panel, no lo pisa.
 */
const OLD_SEO_TITLE = "Inicio";
const NEW_SEO_TITLE = "Sanatorio Adventista de Asunción";

function parseJson(value: unknown): any {
  return typeof value === "string" ? JSON.parse(value) : value;
}

export async function up(knex: Knex): Promise<void> {
  const row = await knex("pages").where({ slug: "home" }).first();
  if (!row) return;
  const seo = parseJson(row.seo) ?? {};
  if (seo.title !== OLD_SEO_TITLE) return;
  await knex("pages")
    .where({ slug: "home" })
    .update({ seo: JSON.stringify({ ...seo, title: NEW_SEO_TITLE }) });
}

export async function down(knex: Knex): Promise<void> {
  const row = await knex("pages").where({ slug: "home" }).first();
  if (!row) return;
  const seo = parseJson(row.seo) ?? {};
  if (seo.title !== NEW_SEO_TITLE) return;
  await knex("pages")
    .where({ slug: "home" })
    .update({ seo: JSON.stringify({ ...seo, title: OLD_SEO_TITLE }) });
}
