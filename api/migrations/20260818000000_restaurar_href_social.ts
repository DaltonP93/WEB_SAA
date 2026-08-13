import type { Knex } from "knex";

/**
 * Devuelve el perfil de red que pisó la migración de fuente única.
 *
 * `20260816000000_fuente_unica_contacto` decidía si un canal social estaba
 * "vacío" mirando únicamente `value`:
 *
 *     if (value && !byKey.get(network.key)?.value) {
 *       await knex("contact_channels").where({ key }).update({ href: value, value });
 *     }
 *
 * Una fila cargada desde el panel podía tener el perfil en `href` y `value`
 * vacío —es la forma natural de cargar una red: el enlace es el dato—. Para
 * esa fila la condición daba verdadero y el `href` real quedaba reemplazado
 * por el valor viejo de `settings.social`, que era justamente el que el
 * sanatorio había dejado de usar.
 *
 * Esa migración ya está fusionada y puede haberse aplicado, así que no se
 * edita: la corrección va acá.
 *
 * **Qué se restaura.** Sólo los casos que se pueden demostrar con el snapshot
 * que dejó aquella migración, y con las tres condiciones a la vez:
 *
 *  1. la fila original tenía `href` válido y `value` vacío;
 *  2. el `href` y el `value` actuales son exactamente el valor legacy que la
 *     migración movió (esa es su huella: escribió el mismo valor en los dos);
 *  3. por lo tanto no hay edición posterior del cliente — cualquier cambio
 *     hecho desde el panel rompe la coincidencia exacta y la fila se deja
 *     como está.
 *
 * **Lo que no se puede restaurar.** Las instalaciones que corrieron la versión
 * anterior de aquella migración tienen un snapshot que guardaba sólo `key` y
 * `value`: ahí el `href` original no existe en ningún lado y adivinarlo sería
 * inventar un dato institucional. Esos casos se informan por consola para que
 * se resuelvan contra el backup, y la migración no los toca.
 */

const SNAPSHOT_KEY = "snapshot_restaurar_href_social_20260818000000";
const SOURCE_SNAPSHOT_KEY = "snapshot_fuente_unica_contacto_20260816000000";

/** Las mismas redes que sumó la migración de fuente única. */
const SOCIAL_KEYS = ["facebook", "instagram", "youtube", "linkedin"];

interface RestoredRow {
  key: string;
  /** Lo que había antes de esta migración (el valor legacy que quedó pisando). */
  from: { href: string | null; value: string | null };
  /** Lo que esta migración escribió (el dato original del cliente). */
  to: { href: string | null; value: string | null };
}

interface Snapshot {
  createdAt: string;
  restored: RestoredRow[];
  /** Canales que se detectaron sospechosos pero no se pudieron restaurar. */
  unrecoverable: string[];
}

function parseJson(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * ¿El `href` original era un enlace utilizable?
 *
 * Se comprueba acá y no importando el validador de la API: una migración tiene
 * que comportarse igual dentro de diez versiones, y para eso no puede depender
 * de código que va a seguir cambiando.
 */
function looksLikeProfileUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw || /[<>\s]/.test(raw)) return false;
  if (!/^https:\/\//i.test(raw)) return false;
  try {
    return new URL(raw).hostname.includes(".");
  } catch {
    return false;
  }
}

const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export async function up(knex: Knex): Promise<void> {
  const already = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (already) return;

  const snapshot: Snapshot = { createdAt: new Date().toISOString(), restored: [], unrecoverable: [] };

  const sourceRow = await knex("settings").where({ key: SOURCE_SNAPSHOT_KEY }).first("value");
  const source = sourceRow ? parseJson(sourceRow.value) : null;
  // Sin el snapshot de origen no hay con qué comparar: puede ser una
  // instalación nueva (los canales los creó la migración, no pisó nada) o una
  // donde ya se revirtió. En los dos casos no hay nada que restaurar.
  if (source && Array.isArray(source.channels)) {
    const legacySocial = (source.social ?? {}) as Record<string, unknown>;
    const originals = source.channels as { key: string; value?: unknown; href?: unknown }[];

    for (const key of SOCIAL_KEYS) {
      const original = originals.find((c) => c.key === key);
      // Si la fila no existía antes, la migración la creó: no pisó nada.
      if (!original) continue;

      const legacy = trimmed(legacySocial[key]);
      if (!legacy) continue; // no había valor viejo que mover

      const current = await knex("contact_channels").where({ key }).first("href", "value");
      if (!current) continue;
      // La huella de la migración: el mismo valor en las dos columnas.
      if (trimmed(current.href) !== legacy || trimmed(current.value) !== legacy) continue;

      // El snapshot viejo no guardaba `href`: el dato original se perdió y no
      // se inventa. Queda anotado para revisarlo contra el backup.
      if (!("href" in original)) {
        snapshot.unrecoverable.push(key);
        continue;
      }

      const originalHref = trimmed(original.href);
      const originalValue = trimmed(original.value);
      // Sólo el caso afectado: href cargado y value vacío.
      if (!originalHref || originalValue) continue;
      if (!looksLikeProfileUrl(originalHref)) continue;
      if (originalHref === legacy) continue; // ya era el mismo dato

      await knex("contact_channels")
        .where({ key })
        .update({ href: originalHref, value: (original.value as string | null) ?? null });

      snapshot.restored.push({
        key,
        from: { href: legacy, value: legacy },
        to: { href: originalHref, value: (original.value as string | null) ?? null },
      });
    }
  }

  if (snapshot.unrecoverable.length > 0) {
    console.warn(
      `[20260818000000] ${snapshot.unrecoverable.join(", ")}: el enlace pudo haber sido ` +
        "reemplazado por la migración de fuente única, pero el snapshot de aquella versión no " +
        "guardaba el valor anterior. Revisá esos canales contra el backup previo al deploy.",
    );
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

  for (const entry of snapshot.restored ?? []) {
    const current = await knex("contact_channels").where({ key: entry.key }).first("href", "value");
    if (!current) continue;
    // Sólo se deshace si la fila sigue como la dejó `up()`. Si el sanatorio la
    // editó después, su edición vale más que volver al estado anterior.
    if (trimmed(current.href) !== trimmed(entry.to.href)) continue;
    if (trimmed(current.value) !== trimmed(entry.to.value)) continue;
    await knex("contact_channels")
      .where({ key: entry.key })
      .update({ href: entry.from.href, value: entry.from.value });
  }

  await knex("settings").where({ key: SNAPSHOT_KEY }).del();
}
