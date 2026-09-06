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

export function signToken(p: AuthPayload, authVersion: number): string {
  // `av` (versión de sesión) viaja en el token; `requireAuth` la compara contra la
  // base. Algoritmo fijado a HS256 de forma explícita: la clave es simétrica y no
  // se acepta ninguna otra familia ni `alg: none` (defensa contra confusión de
  // algoritmo).
  return jwt.sign({ ...p, av: authVersion }, SECRET, { algorithm: "HS256", expiresIn: EXPIRES as any });
}

export function verifyToken(t: string): AuthPayload & { av?: number; iat?: number } {
  // Se fija `algorithms: ["HS256"]` al verificar: un token con `alg: none` u otra
  // familia se rechaza aunque parezca válido.
  return jwt.verify(t, SECRET, { algorithms: ["HS256"] }) as AuthPayload & { av?: number; iat?: number };
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function comparePassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

/**
 * Autentica **contra la base**, no sólo contra el token.
 *
 * El token stateless probaba la identidad pero no reflejaba cambios posteriores:
 * cambiarle el rol a un usuario, darlo de baja o revocarle las sesiones no tenía
 * efecto hasta que expiraba (hasta 7 días). Ahora, verificada la firma, se relee
 * el usuario y:
 *  - si ya no existe (baja) → 401;
 *  - si la **versión de sesión** del token (`av`) no coincide **exactamente** con
 *    `users.auth_version` (revocación / cambio de contraseña) → 401;
 *  - el `role` sale de la base, no del token, así un cambio de rol rige en la
 *    próxima request.
 *
 * **Fail-closed** en la versión: un token sin `av` (emitido antes de la migración
 * de `auth_version`) o una `auth_version` que no sea un número (columna ausente
 * durante un rollback, valor corrupto) se rechazan. No hay comparación por tiempo,
 * ni truncamiento ni margen: es igualdad de enteros, así que no hay carrera aunque
 * el login y el cambio de contraseña ocurran en el mismo milisegundo.
 *
 * Es un lookup por PK por request (costo despreciable en un panel). Si la base no
 * responde, el error se propaga al manejador central (503), no se traduce a 401.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "no token" });
  let decoded: AuthPayload & { av?: number; iat?: number };
  try {
    decoded = verifyToken(h.slice(7));
  } catch {
    return res.status(401).json({ error: "token invalido" });
  }
  try {
    // Se leen todas las columnas (no una lista fija): así, si el esquema quedó por
    // debajo de la migración de `auth_version` durante un rollback, la columna
    // ausente da `undefined` y la sesión se rechaza (fail-closed), en vez de un 500
    // por seleccionar una columna inexistente. `password_hash` queda en memoria
    // pero nunca se copia a `req.user`.
    const user = await db("users").where({ id: decoded.id }).first();
    if (!user) return res.status(401).json({ error: "sesion invalida" });
    const av = decoded.av;
    const actual = user.auth_version;
    if (typeof av !== "number" || typeof actual !== "number" || av !== actual) {
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
