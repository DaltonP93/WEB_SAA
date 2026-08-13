import type { Knex } from "knex";

/**
 * Saca del producto la clave `settings.scripts`.
 *
 * Era un campo de "Scripts personalizados" del panel: un textarea de
 * JavaScript que se inyectaba en el sitio. La API dejó de guardarlo y el panel
 * dejó de ofrecerlo, pero la fila podía seguir en la base de instalaciones
 * viejas — y una fila con JavaScript arbitrario guardado no es algo que
 * convenga dejar ahí esperando a que alguien vuelva a leerla.
 *
 * Meta Pixel, Google Ads y Analytics van a entrar por módulos propios, con su
 * propio permiso y su propia validación, no por un campo de texto libre.
 *
 * No destructiva: guarda el valor en un snapshot antes de borrar la fila, así
 * que `down()` la deja exactamente como estaba. Idempotente: si ya corrió, no
 * vuelve a tocar nada.
 */

const SNAPSHOT_KEY = "snapshot_retirar_scripts_20260819000000";
const RETIRED_KEY = "scripts";

interface Snapshot {
  createdAt: string;
  /** `null` si la fila no existía: `down()` no debe inventarla. */
  value: string | null;
  existed: boolean;
}

export async function up(knex: Knex): Promise<void> {
  const already = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (already) return;

  const row = await knex("settings").where({ key: RETIRED_KEY }).first("value");
  const snapshot: Snapshot = {
    createdAt: new Date().toISOString(),
    // La columna es JSON: MySQL la devuelve parseada y MariaDB como string.
    // Se guarda siempre como texto para restaurarla igual en los dos.
    value: row ? (typeof row.value === "string" ? row.value : JSON.stringify(row.value)) : null,
    existed: Boolean(row),
  };

  await knex("settings").insert({
    key: SNAPSHOT_KEY,
    value: JSON.stringify(snapshot),
    updated_at: knex.fn.now(),
  });

  if (snapshot.existed) {
    await knex("settings").where({ key: RETIRED_KEY }).del();
  }
}

export async function down(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: SNAPSHOT_KEY }).first("value");
  if (!row) return;
  const snapshot = (typeof row.value === "string" ? JSON.parse(row.value) : row.value) as Snapshot;

  if (snapshot.existed && snapshot.value !== null) {
    await knex("settings")
      .insert({ key: RETIRED_KEY, value: snapshot.value, updated_at: knex.fn.now() })
      .onConflict("key")
      .merge({ value: snapshot.value, updated_at: knex.fn.now() });
  }

  await knex("settings").where({ key: SNAPSHOT_KEY }).del();
}
