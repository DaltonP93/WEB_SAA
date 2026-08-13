import type { Knex } from "knex";

/**
 * Fuente única de contacto, redes y horarios.
 *
 * `contact_channels` y `schedules` ya existían, pero `settings.contact` seguía
 * teniendo `phones`, `email`, `whatsapp`, `emergencyPhone`, `gthEmail` y
 * `hours`, y `settings.social` guardaba las redes aparte. El panel permitía
 * editar ambos lados, así que un número podía quedar distinto según dónde se
 * mirara y nadie sabía cuál era el bueno.
 *
 * Esta migración:
 *  1. suma las redes sociales como canales (`kind: "url"`), moviendo el valor
 *     que hubiera en `settings.social` para no perder lo ya cargado;
 *  2. mueve a `contact_channels` los valores sueltos de `settings.contact`,
 *     sólo cuando el canal correspondiente todavía está vacío (lo cargado
 *     desde el panel en la tabla manda);
 *  3. borra esos campos de `settings`. La API además los descarta al guardar,
 *     así que no vuelven a aparecer.
 *
 * `settings.contact` conserva `address`, `mapEmbed` y `mapsUrl`: son de la
 * institución, no canales de contacto, y no están duplicados en ningún lado.
 *
 * No destructiva e idempotente: guarda un snapshot la primera vez y, si ya
 * corrió, no vuelve a tocar nada. `down()` restaura los settings exactos y
 * borra los canales de redes que haya creado.
 */

const SNAPSHOT_KEY = "snapshot_fuente_unica_contacto_20260816000000";

/** Redes que el sitio muestra, en el orden en que aparecen. */
const SOCIAL_CHANNELS = [
  { key: "facebook", label: "Facebook", order: 20 },
  { key: "instagram", label: "Instagram", order: 21 },
  { key: "youtube", label: "YouTube", order: 22 },
  { key: "linkedin", label: "LinkedIn", order: 23 },
];

/** Campo suelto de `settings.contact` → canal que pasa a ser su dueño. */
const CONTACT_TO_CHANNEL: { field: string; channel: string }[] = [
  { field: "emergencyPhone", channel: "emergencias" },
  { field: "whatsapp", channel: "whatsapp-general" },
  { field: "email", channel: "email-general" },
  { field: "gthEmail", channel: "gth" },
];

/** Campos que dejan de vivir en `settings`. */
const RETIRED_CONTACT_FIELDS = [
  "phones",
  "email",
  "whatsapp",
  "hours",
  "emergencyPhone",
  "gthEmail",
];

interface Snapshot {
  createdAt: string;
  contact: unknown;
  social: unknown;
  /** Si `settings.social` existía: si no, `down()` no debe inventarlo. */
  hadSocial: boolean;
  /** Canales que existían antes, para saber cuáles creó la migración. */
  existingChannelKeys: string[];
  /** Valores previos de los canales que se completaron desde settings. */
  channelValues: { key: string; value: string | null }[];
}

function parseJson(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function up(knex: Knex): Promise<void> {
  const alreadyRan = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (alreadyRan) return;

  const contactRow = await knex("settings").where({ key: "contact" }).first();
  const socialRow = await knex("settings").where({ key: "social" }).first();
  const contact = (parseJson(contactRow?.value) ?? {}) as Record<string, unknown>;
  const social = (parseJson(socialRow?.value) ?? {}) as Record<string, unknown>;

  const existing = await knex("contact_channels").select("key", "value");
  const snapshot: Snapshot = {
    createdAt: new Date().toISOString(),
    contact,
    social,
    hadSocial: Boolean(socialRow),
    existingChannelKeys: existing.map((c) => c.key as string),
    channelValues: existing.map((c) => ({ key: c.key as string, value: c.value ?? null })),
  };

  await knex("settings").insert({
    key: SNAPSHOT_KEY,
    value: JSON.stringify(snapshot),
    updated_at: knex.fn.now(),
  });

  const byKey = new Map(existing.map((c) => [c.key as string, c]));

  // ------------------------------------------------ 1. redes como canales
  for (const network of SOCIAL_CHANNELS) {
    const value = typeof social[network.key] === "string" ? (social[network.key] as string).trim() : "";
    if (byKey.has(network.key)) {
      // Ya existe: sólo se completa si está vacío.
      if (value && !byKey.get(network.key)?.value) {
        await knex("contact_channels").where({ key: network.key }).update({ href: value, value });
      }
      continue;
    }
    await knex("contact_channels").insert({
      key: network.key,
      label: network.label,
      kind: "url",
      value: value || null,
      href: value || null,
      note: "Perfil oficial del sanatorio.",
      order: network.order,
      // Sin URL cargada no se muestra: mejor nada que un enlace roto.
      active: Boolean(value),
    });
  }

  // -------------------------------------- 2. valores sueltos → canales
  for (const { field, channel } of CONTACT_TO_CHANNEL) {
    const value = typeof contact[field] === "string" ? (contact[field] as string).trim() : "";
    if (!value) continue;
    const row = byKey.get(channel);
    if (!row || row.value) continue; // lo cargado en la tabla manda
    await knex("contact_channels").where({ key: channel }).update({ value });
  }

  // El primer teléfono suelto va a recepción si ese canal está vacío.
  const phones = Array.isArray(contact.phones) ? (contact.phones as unknown[]) : [];
  const firstPhone = phones.find((p) => typeof p === "string" && p.trim());
  if (firstPhone && !byKey.get("recepcion")?.value) {
    await knex("contact_channels").where({ key: "recepcion" }).update({ value: String(firstPhone).trim() });
  }

  // ----------------------------------------- 3. limpiar settings
  const nextContact = { ...contact };
  for (const field of RETIRED_CONTACT_FIELDS) delete nextContact[field];
  await knex("settings")
    .where({ key: "contact" })
    .update({ value: JSON.stringify(nextContact), updated_at: knex.fn.now() });
  await knex("settings").where({ key: "social" }).del();
}

export async function down(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: SNAPSHOT_KEY }).first("value");
  if (!row) return;
  const snapshot = parseJson(row.value) as Snapshot;

  await knex("settings")
    .where({ key: "contact" })
    .update({ value: JSON.stringify(snapshot.contact ?? {}), updated_at: knex.fn.now() });

  if (snapshot.hadSocial) {
    await knex("settings")
      .insert({ key: "social", value: JSON.stringify(snapshot.social ?? {}), updated_at: knex.fn.now() })
      .onConflict("key")
      .merge({ value: JSON.stringify(snapshot.social ?? {}), updated_at: knex.fn.now() });
  }

  // Se borran sólo los canales que creó esta migración.
  const previous = new Set(snapshot.existingChannelKeys ?? []);
  for (const network of SOCIAL_CHANNELS) {
    if (!previous.has(network.key)) {
      await knex("contact_channels").where({ key: network.key }).del();
    }
  }

  // Y se devuelven los valores previos de los canales que se completaron.
  for (const channel of snapshot.channelValues ?? []) {
    await knex("contact_channels").where({ key: channel.key }).update({ value: channel.value });
  }

  await knex("settings").where({ key: SNAPSHOT_KEY }).del();
}
