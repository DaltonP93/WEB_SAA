import type { Request, Response, NextFunction } from "express";
import { db } from "./db.js";
import { errorSeguro } from "./log-seguro.js";

/**
 * Bitácora de acciones administrativas.
 *
 * `registrarAccion` es **best-effort**: nunca lanza. Registrar la acción no
 * puede romper ni demorar la acción principal —el contenido ya se guardó cuando
 * esto corre—, así que cualquier fallo (tabla ausente, base caída) se traga y se
 * loguea de forma segura. La contrapartida es que en un incidente de base puede
 * faltar una fila; para el uso de este proyecto (trazabilidad operativa, no
 * cumplimiento legal estricto) es el compromiso correcto.
 *
 * Nunca se guarda PII de pacientes: el emisor pasa sólo metadatos de operación
 * (id de recurso, slug, cambio de rol). `meta` se sanea igual como defensa.
 */

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "publish"
  | "unpublish"
  | "schedule"
  | "trash"
  | "restore"
  | "purge"
  | "restore_revision"
  // Flujo editorial (transiciones de estado de páginas).
  | "submit_review"
  | "approve"
  | "return_draft"
  | "archive"
  | "unarchive"
  | "role_change"
  | "login_ok"
  | "login_fail";

export interface Actor {
  actorId: number | null;
  actorName: string | null;
  actorRole: string | null;
  ip: string | null;
}

export interface RegistroEntrada extends Partial<Actor> {
  action: AuditAction;
  resourceType?: string | null;
  resourceId?: string | number | null;
  meta?: Record<string, unknown> | null;
}

const MAX_META_STR = 200;
const MAX_META_KEYS = 20;

/**
 * Claves cuyo valor nunca se persiste en la bitácora, aunque sea un escalar: un
 * emisor futuro podría pasar sin querer una contraseña, un token o un hash en
 * `meta`. Hoy ningún emisor lo hace (verificado), pero la bitácora se lee desde
 * el panel y no es lugar para un secreto. Se compara sobre la clave en minúsculas.
 */
const CLAVES_SENSIBLES = /(pass|password|contrase|token|secret|authorization|api[_-]?key|_hash)/i;

/**
 * Recorta `meta` a algo chico y no sensible: descarta valores que no sean
 * escalares simples, acota strings, limita la cantidad de claves y **redacta las
 * claves sensibles** (contraseñas/tokens/hashes) aunque sean escalares. El emisor
 * ya pasa sólo metadatos de operación; esto es una segunda barrera.
 */
export function sanitizarMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(meta)) {
    if (n >= MAX_META_KEYS) break;
    if (CLAVES_SENSIBLES.test(k)) continue; // se descarta por nombre, no se registra
    if (v === null || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
      n++;
    } else if (typeof v === "string") {
      out[k] = v.slice(0, MAX_META_STR);
      n++;
    }
    // objetos/arrays se descartan: no queremos volcar payloads acá.
  }
  return out;
}

/** IP del operador, sin depender de `trust proxy`. Nginx setea X-Real-IP. */
export function ipDe(req: Request): string | null {
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real) return real.slice(0, 45);
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim().slice(0, 45);
  const direct = req.ip ?? req.socket?.remoteAddress ?? null;
  return direct ? String(direct).slice(0, 45) : null;
}

/** Actor + IP a partir del request autenticado. */
export function actorDe(req: Request): Actor {
  return {
    actorId: req.user?.id ?? null,
    actorName: req.user?.name ?? null,
    actorRole: req.user?.role ?? null,
    ip: ipDe(req),
  };
}

/**
 * Extrae el id de recurso de la URL original de una mutación (`/api/admin/<tipo>/<id>`,
 * o anidado `/api/admin/<tipo>/<id>/<sub>`). Devuelve el primer segmento numérico
 * que sigue al tipo, o `null` (un `POST` de alta no lleva id). Se lee de
 * `originalUrl` —estable, sin los valores de query— porque `req.params` ya no
 * conserva el `:id` del sub-router cuando dispara el evento `finish`.
 */
export function idDeUrl(originalUrl: string, resourceType: string): string | null {
  const path = (originalUrl.split("?")[0] ?? "").split("#")[0];
  const partes = path.split("/").filter(Boolean);
  const i = partes.lastIndexOf(resourceType);
  if (i === -1) return null;
  const siguiente = partes[i + 1];
  return siguiente && /^\d+$/.test(siguiente) ? siguiente : null;
}

/**
 * Auditoría **centralizada** para los routers que no la registran por dentro
 * (doctors, menus, settings, media, redirects, appointments, contact-messages,
 * newsletter). Se monta como middleware del router y registra una fila tras cada
 * mutación con respuesta 2xx —el `finish` del response garantiza que la acción
 * ya terminó bien—. Las lecturas (`GET`/`HEAD`) no se auditan. La acción se
 * deriva del método (POST→create, DELETE→delete, resto→update). El actor y la IP
 * se capturan **ahora**, con `req.user` ya puesto por `requireAuth`, porque en
 * `finish` el request puede haber cambiado. No reemplaza a la auditoría de grano
 * fino (pages/users registran acciones específicas por dentro): esos routers no
 * llevan este middleware para no duplicar filas.
 */
export function auditarMutaciones(resourceType: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const metodo = req.method.toUpperCase();
    if (metodo === "GET" || metodo === "HEAD" || metodo === "OPTIONS") return next();
    const actor = actorDe(req);
    const originalUrl = req.originalUrl;
    // En un alta (`POST` a la colección) el id no está en la URL sino en el cuerpo
    // de la respuesta (`{ id }`). Se lo mira al pasar por `res.json` para que la
    // fila de auditoría del `create` también lleve el id del recurso creado.
    let idDeCuerpo: string | null = null;
    const jsonOriginal = res.json.bind(res);
    res.json = (body: unknown) => {
      const id = (body as { id?: unknown } | null)?.id;
      if (typeof id === "number" || typeof id === "string") idDeCuerpo = String(id);
      return jsonOriginal(body);
    };
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return; // sólo éxitos
      const action: AuditAction = metodo === "DELETE" ? "delete" : metodo === "POST" ? "create" : "update";
      const resourceId = idDeUrl(originalUrl, resourceType) ?? idDeCuerpo;
      void registrarAccion({ ...actor, action, resourceType, resourceId });
    });
    next();
  };
}

export async function registrarAccion(e: RegistroEntrada): Promise<void> {
  try {
    await db("admin_audit_log").insert({
      actor_id: e.actorId ?? null,
      actor_name: e.actorName ?? null,
      actor_role: e.actorRole ?? null,
      action: e.action,
      resource_type: e.resourceType ?? null,
      resource_id: e.resourceId !== undefined && e.resourceId !== null ? String(e.resourceId) : null,
      meta: e.meta ? JSON.stringify(sanitizarMeta(e.meta)) : null,
      ip: e.ip ?? null,
      created_at: db.fn.now(),
    });
  } catch (err) {
    // No romper la acción principal. Log seguro, sin PII ni sql.
    console.error(`[audit] no se pudo registrar ${e.action} sobre ${e.resourceType ?? "-"}: ${errorSeguro(err)}`);
  }
}
