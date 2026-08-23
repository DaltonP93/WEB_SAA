/**
 * Definición canónica de las rutas viejas del portal, unificadas en
 * `/portal-paciente` (minuta, punto 23).
 *
 * Antes este archivo también tenía el middleware que las redirigía. Ahora los
 * redirects 301 son administrables y viven en la tabla `redirects` (ver
 * `redirects.ts`): estas constantes quedan como la **lista legacy** que tres
 * lugares comparten y una prueba mantiene en sincronía —
 *
 * - `redirects.ts` la usa para la caché inicial (comportamiento a prueba de base
 *   caída) y la migración `20260826000000_redirects.ts` la siembra en la tabla;
 * - el `<Navigate>` del front (`apps/web/src/App.tsx`) la redirige del lado del
 *   cliente;
 * - el `nginx.conf` que arma `scripts/deploy/setup-vps.sh` la redirige en
 *   producción, antes de tocar Node.
 *
 * `tests/sitemap.test.ts` verifica que las tres capas listen exactamente estas
 * rutas: si Nginx responde antes que Node y le falta una, el 301 no ocurriría
 * en producción por más que la API lo tenga.
 */

export const PORTAL_CANONICAL = "/portal-paciente";

export const LEGACY_PORTAL_PATHS = [
  "/portal-resultados-diagnostico",
  "/portal-resultados-laboratorio",
  "/portal-presupuestos-cirugia",
  "/portal-facturacion-electronica",
] as const;
