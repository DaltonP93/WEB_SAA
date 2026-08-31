import type { Knex } from "knex";

/**
 * Setea el logo institucional por defecto (asset estático servido en
 * /logo-sanatorio.png, ver apps/web/public/) cuando settings.brand.logoUrl
 * todavía está vacío.
 *
 * No pisa un logo que el sanatorio ya haya cargado a mano desde el admin.
 */
const LOGO_URL = "/logo-sanatorio.png";

export async function up(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: "brand" }).first();
  const current = row?.value ?? {};
  const brand = typeof current === "string" ? JSON.parse(current) : current;
  if (brand.logoUrl) return;
  const next = { ...brand, logoUrl: LOGO_URL };
  await knex("settings")
    .insert({ key: "brand", value: JSON.stringify(next) })
    .onConflict("key")
    .merge({ value: JSON.stringify(next), updated_at: knex.fn.now() });
}

export async function down(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: "brand" }).first();
  if (!row) return;
  const current = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  if (current.logoUrl !== LOGO_URL) return;
  const reverted = { ...current, logoUrl: "" };
  await knex("settings")
    .where({ key: "brand" })
    .update({ value: JSON.stringify(reverted), updated_at: knex.fn.now() });
}
