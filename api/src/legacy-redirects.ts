import type { RequestHandler } from "express";

/**
 * Rutas viejas del portal, unificadas en `/portal-paciente` (minuta, punto 23).
 *
 * El front ya las redirigía con `<Navigate>`, pero eso es una redirección de
 * cliente: el servidor responde 200 con el HTML del sitio y recién el
 * JavaScript cambia la URL. Para un buscador —o para cualquier cliente que no
 * ejecute JS— la página vieja sigue existiendo y compitiendo con la canónica.
 *
 * Acá se responde un 301 de verdad. En producción la misma lista está en el
 * `nginx.conf` que arma `scripts/deploy/setup-vps.sh`, así que la redirección
 * ocurre antes de tocar Node; este middleware cubre el caso de que la API
 * quede expuesta directamente y sirve además para poder probarlo.
 */

export const PORTAL_CANONICAL = "/portal-paciente";

export const LEGACY_PORTAL_PATHS = [
  "/portal-resultados-diagnostico",
  "/portal-resultados-laboratorio",
  "/portal-presupuestos-cirugia",
  "/portal-facturacion-electronica",
] as const;

const REDIRECTS = new Map<string, string>(
  LEGACY_PORTAL_PATHS.map((from) => [from, PORTAL_CANONICAL]),
);

/** Normaliza barras finales y mayúsculas para no depender de cómo llegó el link. */
function normalize(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return (trimmed || "/").toLowerCase();
}

export const legacyRedirects: RequestHandler = (req, res, next) => {
  const target = REDIRECTS.get(normalize(req.path));
  if (!target) return next();
  // 301: el destino es definitivo y queremos que el buscador transfiera el
  // enlace a la ruta canónica.
  res.redirect(301, target);
};
