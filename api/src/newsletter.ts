import { randomBytes } from "node:crypto";

/**
 * Consentimiento de la suscripción a novedades.
 *
 * El texto de finalidad y su versión son **fuente única** en
 * `@sa/shared/consent`, consumida por el servidor (para sellar la versión) y por
 * el bloque público (para mostrar el texto). Acá sólo se reexportan para el
 * resto del backend; nunca se copia el literal, para que el texto que la persona
 * lee no pueda divergir de la versión que se registra.
 */
export { CONSENT_VERSION, CONSENT_TEXT } from "@sa/shared/consent";

/**
 * Token de baja: opaco y no predecible. 24 bytes aleatorios en base64url (~32
 * caracteres). No se deriva del email ni del id, así que tener uno no permite
 * adivinar el de otro suscriptor.
 *
 * **Alcance actual:** el token y el endpoint de baja quedan preparados, pero el
 * enlace de baja se le entregará a la persona recién cuando exista un proveedor
 * de envío de correos. Todavía no es un flujo de baja plenamente operable de
 * cara al público: hasta entonces la baja se opera desde el panel. El token no
 * se expone en el panel, el CSV ni los logs.
 */
export function nuevoTokenBaja(): string {
  return randomBytes(24).toString("base64url");
}
