import type { Knex } from "knex";

/**
 * Cierra dos huecos que quedaron de las rondas anteriores.
 *
 * 1. **"Emergencias 24hs"**. El canal de Emergencias se creó con ese nombre y
 *    con una nota que afirma cobertura ("Guardia activa todos los días del
 *    año"). El sanatorio todavía no confirmó ese horario, así que no puede
 *    publicarse. Queda "Emergencias", sin afirmación de cobertura.
 *
 * 2. **`background` suelto en los bloques**. El override libre de color se
 *    retiró del schema: la variante define el color y no hay forma de pedir
 *    uno arbitrario. Las filas viejas que todavía lo traen se limpian acá,
 *    porque el schema sólo lo descarta cuando alguien vuelve a guardar.
 *
 * No destructiva e idempotente: guarda un snapshot la primera vez y, si ya
 * corrió, no vuelve a tocar nada. `down()` restaura los valores exactos.
 */

const SNAPSHOT_KEY = "snapshot_rojo_y_horarios_20260817000000";

interface Snapshot {
  createdAt: string;
  /** Canales con su label y nota previos. */
  channels: { key: string; label: string; note: string | null }[];
  /** Props completas de cada bloque que tenía `background`. */
  blocks: { id: number; props: unknown }[];
}

function parseJson(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Afirmaciones de cobertura horaria que el sanatorio no confirmó. */
const UNCONFIRMED_COVERAGE = /24\s*(?:hs|horas|h\b)|24\s*\/\s*7|365\s*d[ií]as|guardia\s+(?:m[ée]dica\s+)?activa/i;

export async function up(knex: Knex): Promise<void> {
  const alreadyRan = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (alreadyRan) return;

  const snapshot: Snapshot = { createdAt: new Date().toISOString(), channels: [], blocks: [] };

  // ------------------------------------------ 1. canales sin "24hs"
  const channels = await knex("contact_channels").select("key", "label", "note");
  for (const channel of channels) {
    const label = String(channel.label ?? "");
    const note = channel.note == null ? null : String(channel.note);
    const nextLabel = UNCONFIRMED_COVERAGE.test(label)
      ? label.replace(/\s*24\s*(?:hs|horas|h\b)\.?/gi, "").replace(/\s{2,}/g, " ").trim()
      : label;
    // La nota afirmaba cobertura; se vacía hasta que el sanatorio la confirme.
    const nextNote = note && UNCONFIRMED_COVERAGE.test(note) ? "" : note;
    if (nextLabel === label && nextNote === note) continue;

    snapshot.channels.push({ key: channel.key, label, note });
    await knex("contact_channels")
      .where({ key: channel.key })
      .update({ label: nextLabel || label, note: nextNote });
  }

  // ---------------------------------- 2. `background` fuera de los bloques
  const blocks = await knex("blocks").select("id", "props");
  for (const block of blocks) {
    const props = parseJson(block.props);
    if (!props || typeof props !== "object" || !("background" in props)) continue;
    snapshot.blocks.push({ id: block.id, props });
    const next = { ...(props as Record<string, unknown>) };
    delete next.background;
    await knex("blocks").where({ id: block.id }).update({ props: JSON.stringify(next) });
  }

  await knex("settings").insert({
    key: SNAPSHOT_KEY,
    value: JSON.stringify(snapshot),
    updated_at: knex.fn.now(),
  });
}

export async function down(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: SNAPSHOT_KEY }).first("value");
  if (!row) return;
  const snapshot = parseJson(row.value) as Snapshot;

  for (const channel of snapshot.channels ?? []) {
    await knex("contact_channels")
      .where({ key: channel.key })
      .update({ label: channel.label, note: channel.note });
  }

  for (const block of snapshot.blocks ?? []) {
    await knex("blocks")
      .where({ id: block.id })
      .update({ props: JSON.stringify(block.props ?? {}) });
  }

  await knex("settings").where({ key: SNAPSHOT_KEY }).del();
}
