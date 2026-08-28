/**
 * Consentimiento de la suscripción a novedades — **fuente única**.
 *
 * El texto de finalidad y su versión viven acá y **sólo acá**. Antes había una
 * copia en el servidor (`api/src/newsletter.ts`) y otra en el bloque público
 * (`apps/web/src/blocks/Newsletter.tsx`), y las dos se habían desincronizado:
 * si el texto que la persona lee no es el que el servidor registra como
 * aceptado, la evidencia de consentimiento deja de valer. Ahora el bloque
 * muestra `CONSENT_TEXT` y el servidor sella `CONSENT_VERSION`; una prueba falla
 * si divergen.
 *
 * Regla: **si `CONSENT_TEXT` cambia, hay que subir `CONSENT_VERSION`.** Así lo
 * aceptado antes no se confunde con lo aceptado después.
 */

/** Versión del texto de finalidad vigente. Subir junto con cualquier cambio de `CONSENT_TEXT`. */
export const CONSENT_VERSION = "1";

/** El texto que la persona lee al suscribirse, y contra el que se registra la versión. */
export const CONSENT_TEXT =
  "Usamos tu correo únicamente para enviarte novedades del Sanatorio Adventista de Asunción. " +
  "Podés darte de baja en cualquier momento.";
