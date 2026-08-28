import { randomBytes } from "node:crypto";

/**
 * Consentimiento de la suscripción a novedades.
 *
 * `CONSENT_VERSION` identifica el texto de finalidad que estaba vigente cuando la
 * persona se suscribió. Si el texto cambia, se sube la versión: así lo aceptado
 * antes no se confunde con lo aceptado después. El texto que se le muestra vive
 * en el bloque `Newsletter` del sitio; esta constante es el registro del lado del
 * servidor de qué versión estaba en efecto.
 */
export const CONSENT_VERSION = "1";

/**
 * Finalidad declarada (para referencia y documentación). El bloque público
 * muestra este mismo sentido; al cambiarlo hay que subir `CONSENT_VERSION`.
 */
export const PURPOSE_TEXT =
  "Usamos tu correo únicamente para enviarte novedades del Sanatorio Adventista de Asunción. " +
  "Podés darte de baja en cualquier momento.";

/**
 * Token de baja: opaco y no predecible. 24 bytes aleatorios en base64url (~32
 * caracteres). No se deriva del email ni del id, así que tener uno no permite
 * adivinar el de otro suscriptor.
 */
export function nuevoTokenBaja(): string {
  return randomBytes(24).toString("base64url");
}
