import type { NextFunction, Request, RequestHandler, Response, Router } from "express";

/**
 * Utilidades HTTP: errores tipados, captura de rechazos en handlers `async` y
 * respuestas que no filtran detalles internos.
 *
 * Express 4 no captura las promesas rechazadas de un handler `async`: el
 * rechazo sube como `unhandledRejection` y, con el comportamiento por defecto
 * de Node ≥15, tira el proceso abajo. Un timeout de MySQL alcanzaba para
 * dejar la API caída. `wrapRouterAsync` envuelve todos los handlers de un
 * router para derivar el error al middleware de errores.
 */

export class HttpError extends Error {
  status: number;
  /** Detalle opcional y seguro para el cliente (por ejemplo, issues de Zod). */
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message = "payload invalido", details?: unknown) =>
  new HttpError(400, message, details);
export const notFound = (message = "no encontrado") => new HttpError(404, message);
export const tooManyRequests = (message = "demasiadas solicitudes") => new HttpError(429, message);

/** Envuelve un handler async para que sus rechazos lleguen a `next(err)`. */
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    try {
      const result = handler(req, res, next) as unknown;
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Acota cuánto puede tardar una consulta antes de dar por perdida la request.
 *
 * `acquireConnectionTimeout` cubre esperar una conexión libre del pool, pero
 * no una consulta que quedó colgada con la conexión ya tomada. Sin esto una
 * base que no responde deja la request abierta hasta que corte el cliente.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      console.error(`[timeout] ${label} superó ${ms}ms`);
      reject(new HttpError(503, "servicio no disponible temporalmente"));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

interface ExpressLayer {
  handle?: unknown;
  route?: { stack?: ExpressLayer[] };
  name?: string;
}

/**
 * Recorre el stack de un router (incluidas las rutas anidadas) y envuelve cada
 * handler con `asyncHandler`. Se aplica una sola vez por router al montarlo.
 */
export function wrapRouterAsync<T extends Router>(router: T): T {
  const stack = (router as unknown as { stack?: ExpressLayer[] }).stack;
  if (!Array.isArray(stack)) return router;

  const wrapLayer = (layer: ExpressLayer) => {
    if (layer.route?.stack) {
      layer.route.stack.forEach(wrapLayer);
      return;
    }
    const handle = layer.handle;
    if (typeof handle !== "function") return;
    // Los middlewares de error tienen 4 argumentos: se dejan como están.
    if (handle.length >= 4) return;
    if ((handle as { __asyncWrapped?: boolean }).__asyncWrapped) return;
    // Un router montado como middleware trae su propio stack: bajamos a él.
    const nested = (handle as unknown as { stack?: ExpressLayer[] }).stack;
    if (Array.isArray(nested)) {
      nested.forEach(wrapLayer);
      return;
    }
    const wrapped = asyncHandler(handle as RequestHandler) as RequestHandler & {
      __asyncWrapped?: boolean;
    };
    wrapped.__asyncWrapped = true;
    layer.handle = wrapped;
  };

  stack.forEach(wrapLayer);
  return router;
}

/** Errores de conexión/consulta a la base, para responder 503 en vez de 500. */
export function isDatabaseError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (typeof code !== "string") return false;
  return [
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "ENOTFOUND",
    "ECONNRESET",
    "EPIPE",
    "PROTOCOL_CONNECTION_LOST",
    "ER_CON_COUNT_ERROR",
    "ER_ACCESS_DENIED_ERROR",
    "KnexTimeoutError",
  ].includes(code);
}

/**
 * Middleware de errores: loguea todo del lado del servidor y devuelve al
 * cliente sólo lo que es seguro mostrar.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (res.headersSent) return;

  if (err instanceof HttpError) {
    if (err.status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
    return res.status(err.status).json({
      error: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
  }

  const isDbDown = isDatabaseError(err) || (err as Error)?.name === "KnexTimeoutError";
  console.error(`[${req.method} ${req.originalUrl}]`, err);

  if (isDbDown) {
    return res.status(503).json({ error: "servicio no disponible temporalmente" });
  }
  // Nunca devolvemos err.message: puede contener SQL, rutas o credenciales.
  return res.status(500).json({ error: "error interno" });
}
