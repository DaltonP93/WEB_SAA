import type { Request } from "express";
import { createHash } from "node:crypto";
import { db } from "./db.js";
import { errorSeguro } from "./log-seguro.js";

/**
 * Bitácora **operativa** de acciones administrativas (contrato de cobertura).
 *
 * `registrarAccion` es **best-effort**: nunca lanza y se ejecuta **después** de la
 * acción principal, así que cualquier fallo (tabla ausente, base caída, proceso
 * caído entre la mutación y el insert) se traga. **Contrato explícito: esto es una
 * bitácora operativa para trazabilidad, no un registro de auditoría con garantía
 * de integridad completa.** No promete que toda mutación tenga su fila: en un
 * incidente puede faltar. Si en el futuro una operación necesitara auditoría
 * **obligatoria**, habría que escribir mutación y bitácora en la misma transacción
 * o vía outbox — es una decisión de alcance del propietario, no está implementado.
 *
 * Nunca se guarda PII: el emisor pasa sólo metadatos de operación (id de recurso,
 * slug, cambio de rol) y `meta` se sanea como defensa. El correo de un intento de
 * acceso fallido se guarda **seudonimizado** (`seudonimoEmail`), nunca en claro.
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

/**
 * IP del operador para la bitácora, derivada de `req.ip`.
 *
 * `req.ip` respeta `trust proxy` (configurado en `app.ts` como `loopback`): sólo
 * cree en `X-Forwarded-For` cuando la conexión entrante es el proxy de confianza
 * (Nginx en loopback); en cualquier otro caso es la IP del peer directo. Antes se
 * leían `X-Real-IP`/`X-Forwarded-For` **a ciegas**, así que si el puerto de la API
 * quedaba accesible sin pasar por Nginx, cualquiera falsificaba la IP registrada.
 * No se leen esas cabeceras acá: la decisión de en quién confiar es de Express.
 */
export function ipDe(req: Request): string | null {
  const ip = req.ip ?? req.socket?.remoteAddress ?? null;
  return ip ? String(ip).slice(0, 45) : null;
}

/**
 * Seudónimo estable de un correo para la bitácora (SHA-256 truncado, hex).
 *
 * En un intento de acceso fallido no se sabe quién es, pero guardar el correo en
 * claro mete PII en una tabla que se lee desde el panel. El seudónimo permite
 * correlacionar intentos repetidos contra el mismo correo sin almacenarlo: se
 * normaliza (trim + minúsculas) y se hashea. No es reversible salvo por fuerza
 * bruta sobre correos ya conocidos.
 */
export function seudonimoEmail(email: string): string {
  return createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex").slice(0, 16);
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
