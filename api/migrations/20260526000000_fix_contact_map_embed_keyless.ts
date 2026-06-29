import type { Knex } from "knex";

const SANATORIO_MAP_EMBED =
  '<iframe src="https://maps.google.com/maps?q=Sanatorio%20Adventista%20de%20Asunci%C3%B3n%2C%20Silvio%20Pettirossi%20380%2C%20Asunci%C3%B3n%2C%20Paraguay&z=17&output=embed" width="100%" height="400" style="border:0;" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>';

export async function up(knex: Knex): Promise<void> {
  const contactRow = await knex("settings").where({ key: "contact" }).first("value");
  if (contactRow) {
    const current = parseJson(contactRow.value);
    if (current && typeof current === "object" && !Array.isArray(current)) {
      await knex("settings")
        .where({ key: "contact" })
        .update({
          value: JSON.stringify({ ...current, mapEmbed: SANATORIO_MAP_EMBED }),
          updated_at: knex.fn.now(),
        });
    }
  }

  const contactPage = await knex("pages").where({ slug: "contacto" }).first("id");
  if (!contactPage) return;

  const blocks = await knex("blocks").where({ page_id: contactPage.id, type: "mapEmbed" });
  for (const block of blocks) {
    const props = parseJson(block.props);
    const nextProps = props && typeof props === "object" && !Array.isArray(props)
      ? { ...props, embedHtml: SANATORIO_MAP_EMBED, height: Number((props as { height?: unknown }).height) || 400 }
      : { embedHtml: SANATORIO_MAP_EMBED, height: 400 };

    await knex("blocks").where({ id: block.id }).update({ props: JSON.stringify(nextProps) });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // No-op: previous migration left a broken embed; do not restore it.
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
