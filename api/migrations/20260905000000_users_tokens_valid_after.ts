import type { Knex } from "knex";

/**
 * Revocación de sesiones JWT: marca por-usuario `tokens_valid_after`.
 *
 * El token es *stateless* y vive lo que diga `JWT_EXPIRES_IN` (configurable). Sin
 * esta columna, cambiarle la contraseña a un usuario no invalidaba los tokens ya
 * emitidos hasta que expiraban solos (hasta 7 días por defecto), sobre un panel
 * con PII de pacientes.
 *
 * Con la columna, `requireAuth` compara el `iat` (instante de emisión) del token
 * contra este valor: un token emitido **antes** de `tokens_valid_after` se rechaza
 * con 401. Poner `tokens_valid_after = ahora` cierra todas las sesiones abiertas
 * de ese usuario (deben volver a entrar).
 *
 * `NULL` = sin restricción: ningún token de ese usuario está revocado (el caso por
 * defecto). Reversible: `down()` la quita. No toca ninguna fila existente.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("users", "tokens_valid_after")) return;
  await knex.schema.alterTable("users", (t) => {
    t.datetime("tokens_valid_after").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("users", "tokens_valid_after")) {
    await knex.schema.alterTable("users", (t) => {
      t.dropColumn("tokens_valid_after");
    });
  }
}
