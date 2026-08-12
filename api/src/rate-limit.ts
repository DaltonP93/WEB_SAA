import type { RequestHandler } from "express";

/**
 * Rate limiting en memoria por IP.
 *
 * La API corre como un único proceso PM2, así que un contador en memoria
 * alcanza y evita sumar una dependencia. Si algún día se escala a varias
 * instancias hay que mover esto a Redis o a la base.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Mensaje devuelto al superar el límite. */
  message?: string;
  /** Discriminador extra además de la IP (por ejemplo, el email en login). */
  keyFor?: (req: Parameters<RequestHandler>[0]) => string;
}

export function rateLimit({
  windowMs,
  max,
  message = "Demasiadas solicitudes. Esperá unos minutos e intentá de nuevo.",
  keyFor,
}: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  return (req, res, next) => {
    const now = Date.now();

    // Limpieza perezosa para que el Map no crezca sin control.
    if (now - lastSweep > windowMs) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastSweep = now;
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const key = keyFor ? `${ip}:${keyFor(req)}` : ip;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message, retryAfter });
    }

    return next();
  };
}
