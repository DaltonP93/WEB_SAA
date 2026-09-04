import type { Knex } from "knex";

/**
 * Flujo editorial: amplía `pages.status` de dos estados (`draft`/`published`) a
 * cinco, para el ciclo borrador → revisión → aprobado → publicado → archivado.
 *
 *   draft      → en edición (autor).
 *   in_review  → enviado a revisión (autor lo manda; no publica).
 *   approved   → aprobado, listo para publicar (revisor/editor).
 *   published  → público (único estado visible en el sitio; sin cambios).
 *   archived   → retirado del público pero conservado en el catálogo (≠ papelera).
 *
 * **Sólo `published` es público.** El criterio de visibilidad
 * (`api/src/pages-visibilidad.ts`) no cambia: `in_review`/`approved`/`archived`
 * se comportan como `draft` para el sitio. La papelera (`deleted_at`) y el
 * agendado (`publish_at`) son ortogonales a estos estados.
 *
 * Sólo cambia el dominio del enum; no toca ninguna fila (todo lo existente es
 * `draft`/`published`, que siguen siendo válidos).
 *
 * `down()` es reversible con **pérdida controlada**: antes de angostar el enum,
 * mapea los estados nuevos a `draft` (si no, MySQL rechazaría el `MODIFY` por
 * valores fuera del dominio). Es la reversión correcta: los estados intermedios
 * y el archivado no son públicos, así que volver a `draft` no expone nada. Un
 * `archived` pierde la marca de "estuvo publicado", aceptable al revertir.
 */

const ENUM_NUEVO = "ENUM('draft','in_review','approved','published','archived')";
const ENUM_VIEJO = "ENUM('draft','published')";
const ESTADOS_NUEVOS = ["in_review", "approved", "archived"];

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE \`pages\` MODIFY \`status\` ${ENUM_NUEVO} NOT NULL DEFAULT 'draft'`);
}

export async function down(knex: Knex): Promise<void> {
  await knex("pages").whereIn("status", ESTADOS_NUEVOS).update({ status: "draft" });
  await knex.raw(`ALTER TABLE \`pages\` MODIFY \`status\` ${ENUM_VIEJO} NOT NULL DEFAULT 'draft'`);
}
