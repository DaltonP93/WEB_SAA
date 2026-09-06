import type { Knex } from "knex";

/**
 * Revocación de sesiones JWT por **versión de sesión** (`auth_version`), no por
 * corte temporal.
 *
 * El token es *stateless* y vive lo que diga `JWT_EXPIRES_IN`. Sin revocación,
 * cambiarle la contraseña a un usuario no invalidaba los tokens ya emitidos hasta
 * que expiraban solos (hasta 7 días), sobre un panel con PII de pacientes.
 *
 * `auth_version` es un entero por usuario. Cada JWT lleva la versión vigente al
 * emitirse (`av`). `requireAuth` la vuelve a leer de la base y **exige igualdad
 * exacta**: un token con una versión distinta se rechaza con 401. Cambiar la
 * contraseña **incrementa** la versión de forma atómica, así que todo token
 * anterior queda revocado y el token que se obtiene después del cambio vale de
 * inmediato — sin ventanas de tiempo, truncamientos ni carreras de reloj (el
 * corte por `DATETIME` que había antes dependía del segundo y podía revocar o no
 * un token emitido en el mismo instante del cambio).
 *
 * `NOT NULL DEFAULT 0`: los usuarios existentes arrancan en 0; los tokens emitidos
 * antes de esta migración **no llevan `av`** y `requireAuth` los rechaza
 * (fail-closed), forzando un relogin seguro. Reversible: `down()` la quita.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("users", "auth_version")) return;
  await knex.schema.alterTable("users", (t) => {
    t.integer("auth_version").notNullable().defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("users", "auth_version")) {
    await knex.schema.alterTable("users", (t) => {
      t.dropColumn("auth_version");
    });
  }
}
