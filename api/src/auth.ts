import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import type { Rol, Capacidad } from "./permisos.js";
import { tieneCapacidad } from "./permisos.js";
import { db } from "./db.js";

const SECRET = process.env.JWT_SECRET ?? "dev-secret";
// Duración del token, **configurable** por `JWT_EXPIRES_IN` (formato de
// `jsonwebtoken`: "15m", "8h", "7d"…). Cuanto más corta, menor la ventana en que
// un token robado sirve; la revocación (abajo) la complementa para los casos en
// que hay que cortar una sesión antes de que expire.
const EXPIRES = process.env.JWT_EXPIRES_IN ?? "7d";

// Valores que alguna vez estuvieron en los .env de ejemplo: si quedan en
// producción, cualquiera puede firmar un token de superadmin.
const PLACEHOLDER_SECRETS = new Set([
  "dev-secret",
  "cambia-este-secreto-en-produccion",
  "changeme",
  "secret",
]);

if (process.env.NODE_ENV === "production") {
  if (PLACEHOLDER_SECRETS.has(SECRET)) {
    throw new Error(
      "JWT_SECRET tiene un valor de ejemplo. Generá uno real: openssl rand -base64 48",
    );
  }
  if (SECRET.length < 32) {
    throw new Error("JWT_SECRET debe tener al menos 32 caracteres en producción");
  }
}

export interface AuthPayload {
  id: number;
  email: string;
  role: Rol;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function signToken(p: AuthPayload): string {
  return jwt.sign(p, SECRET, { expiresIn: EXPIRES as any });
}

export function verifyToken(t: string): AuthPayload & { iat?: number } {
  return jwt.verify(t, SECRET) as AuthPayload & { iat?: number };
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function comparePassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

/**
 * Instante de corte para revocar sesiones, **truncado al segundo**.
 *
 * Los `iat` de JWT son segundos enteros (`Math.floor(now/1000)`). Si el corte se
 * guardara con fracción, MySQL 8 lo **redondea** al segundo en una columna
 * `DATETIME(0)` —hacia arriba desde `.5`—, y un token emitido en ese mismo
 * segundo quedaría del lado equivocado: el caso real es cambiar la contraseña y
 * volver a entrar de inmediato, cuyo token nuevo (iat de ese segundo) se
 * rechazaría hasta ~1 s. Truncar el corte al segundo alinea ambos: nunca revoca
 * un token emitido en el segundo del corte o después.
 */
export function instanteRevocacion(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

/**
 * Un token está revocado si se emitió **antes** del `tokens_valid_after` del
 * usuario. `iat` viene en segundos (estándar JWT); la columna es un instante
 * absoluto que el driver devuelve como `Date`. Un token sin `iat` no se puede
 * ubicar en el tiempo, así que se trata como revocado (fail-closed).
 */
function sesionRevocada(iat: number | undefined, validoDesde: Date | string | null): boolean {
  if (validoDesde == null) return false; // sin corte: nada revocado
  if (iat === undefined) return true;
  const corte = validoDesde instanceof Date ? validoDesde.getTime() : new Date(validoDesde).getTime();
  if (Number.isNaN(corte)) return false; // valor ilegible: no bloquear por un dato roto
  return iat * 1000 < corte;
}

/**
 * Autentica **contra la base**, no sólo contra el token.
 *
 * El token stateless probaba la identidad pero no reflejaba cambios posteriores:
 * cambiarle el rol a un usuario, darlo de baja o revocarle las sesiones no tenía
 * efecto hasta que el token expiraba (hasta 7 días). Ahora, verificada la firma,
 * se relee el usuario y:
 *  - si ya no existe (baja) → 401;
 *  - si el token se emitió antes de `tokens_valid_after` (revocación / cambio de
 *    contraseña) → 401;
 *  - el `role` sale de la base, no del token, así un cambio de rol rige en la
 *    próxima request.
 *
 * Es un lookup por PK por request (costo despreciable en un panel). Si la base no
 * responde, el error se propaga al manejador central (503), no se traduce a 401.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "no token" });
  let decoded: AuthPayload & { iat?: number };
  try {
    decoded = verifyToken(h.slice(7));
  } catch {
    return res.status(401).json({ error: "token invalido" });
  }
  try {
    // Se leen todas las columnas (no una lista fija) para que la revocación sea
    // resiliente a que `tokens_valid_after` todavía no exista: durante un rollback
    // el esquema puede estar en un punto anterior a esa migración, y una lista fija
    // con esa columna haría fallar (500) cada request autenticada, dejando el panel
    // inaccesible justo cuando hace falta operarlo. Ausente → `undefined` →
    // `sesionRevocada` lo trata como "sin corte" (no revoca). `password_hash` queda
    // en memoria pero nunca se copia a `req.user`.
    const user = await db("users").where({ id: decoded.id }).first();
    if (!user) return res.status(401).json({ error: "sesion invalida" });
    if (sesionRevocada(decoded.iat, user.tokens_valid_after ?? null)) {
      return res.status(401).json({ error: "sesion expirada" });
    }
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: AuthPayload["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "no auth" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

/**
 * Exige una capacidad concreta (RBAC por capacidades, ver `permisos.ts`). La
 * autorización real vive acá, en el backend, no en el ocultamiento del front.
 */
export function requirePermiso(cap: Capacidad) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "no auth" });
    if (!tieneCapacidad(req.user.role, cap)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

/**
 * Exige la capacidad según el método HTTP: `GET`/`HEAD` → `read`, `DELETE` →
 * `delete`, el resto (`POST`/`PUT`/`PATCH`) → `write`. **Denegación por defecto**:
 * un método sin capacidad declarada en el mapa se rechaza con 403, así un router
 * nuevo montado sin la entrada correspondiente queda cerrado en lugar de abierto.
 */
export function requirePermisoPorMetodo(map: { read?: Capacidad; write?: Capacidad; delete?: Capacidad }) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "no auth" });
    const metodo = req.method.toUpperCase();
    const cap = metodo === "GET" || metodo === "HEAD" ? map.read : metodo === "DELETE" ? map.delete : map.write;
    if (!cap || !tieneCapacidad(req.user.role, cap)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}
