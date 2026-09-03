import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import type { Rol, Capacidad } from "./permisos.js";
import { tieneCapacidad } from "./permisos.js";

const SECRET = process.env.JWT_SECRET ?? "dev-secret";
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

export function verifyToken(t: string): AuthPayload {
  return jwt.verify(t, SECRET) as AuthPayload;
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function comparePassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "no token" });
  try {
    req.user = verifyToken(h.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: "token invalido" });
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
