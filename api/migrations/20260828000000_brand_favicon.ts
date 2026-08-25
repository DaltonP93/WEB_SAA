import type { Knex } from "knex";

/**
 * Setea el favicon institucional por defecto (asset estático servido en
 * /favicon.png, ver apps/web/public/) cuando settings.brand.faviconUrl
 * todavía está vacío. Reemplaza el ícono genérico que usaba la pestaña del
 * navegador por el isotipo real del sanatorio (recortado de Logo 5).
 *
 * No pisa un favicon que el sanatorio ya haya cargado a mano desde el admin.
 */
const FAVICON_URL = "/favicon.png";

export async function up(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: "brand" }).first();
  const current = row?.value ?? {};
  const brand = typeof current === "string" ? JSON.parse(current) : current;
  if (brand.faviconUrl) return;
  const next = { ...brand, faviconUrl: FAVICON_URL };
  await knex("settings")
    .insert({ key: "brand", value: JSON.stringify(next) })
    .onConflict("key")
    .merge({ value: JSON.stringify(next), updated_at: knex.fn.now() });
}

export async function down(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: "brand" }).first();
  if (!row) return;
  const current = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  if (current.faviconUrl !== FAVICON_URL) return;
  const reverted = { ...current, faviconUrl: "" };
  await knex("settings")
    .where({ key: "brand" })
    .update({ value: JSON.stringify(reverted), updated_at: knex.fn.now() });
}
