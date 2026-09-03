/**
 * Modelo de permisos del panel (RBAC por capacidades).
 *
 * Antes había dos roles binarios (`superadmin`/`editor`) y sólo dos routers
 * comprobaban rol; el resto quedaba escribible por cualquier sesión autenticada.
 * Acá se define un modelo de **capacidades** (`recurso.acción`) y una **matriz
 * central** rol → capacidades. La autorización real la hace el backend
 * (`requirePermiso`/`requirePermisoPorMetodo` en `auth.ts`, aplicados en
 * `routes/admin/index.ts`); el front sólo oculta lo que la sesión no puede hacer.
 *
 * Regla de diseño: **denegación por defecto**. Un método sin capacidad declarada
 * se rechaza (403), así un router nuevo nace cerrado en vez de abierto.
 *
 * Los roles nuevos (`autor`, `revisor`, `analista_marketing`, `operador_leads`,
 * `auditor`) se definen sobre los recursos que **hoy existen**. A medida que se
 * construyan los módulos editoriales/marketing/CRM, esos roles ganarán las
 * capacidades específicas correspondientes (p. ej. aprobar, enviar campañas).
 */

export const ROLES = [
  "superadmin",
  "admin",
  "editor",
  "autor",
  "revisor",
  "analista_marketing",
  "operador_leads",
  "auditor",
] as const;

export type Rol = (typeof ROLES)[number];

export const CAPACIDADES = [
  "content.read",
  "content.write",
  "content.publish",
  "content.delete",
  "leads.read",
  "leads.write",
  "settings.read",
  "settings.write",
  "data.confirm",
  "users.manage",
  "audit.read",
] as const;

export type Capacidad = (typeof CAPACIDADES)[number];

const TODAS: Capacidad[] = [...CAPACIDADES];

/**
 * Matriz rol → capacidades. Fuente única de la autorización.
 *
 * - `superadmin`: todo.
 * - `admin`: todo el contenido, leads y settings + lectura de auditoría; **no**
 *   gestiona usuarios ni confirma datos institucionales (reservado a superadmin).
 * - `editor`: contenido completo (incluye publicar y borrar), leads y settings.
 *   Es el rol actual: conserva exactamente lo que ya podía hacer (sin regresión).
 * - `autor`: crea y edita contenido en borrador; **no** publica ni borra.
 * - `revisor`: edita y **publica** contenido; no borra. El aprobador que además
 *   puede corregir y publicar.
 * - `analista_marketing`: lee contenido, leads y settings (para atribución/SEO).
 * - `operador_leads`: gestiona la bandeja de leads (turnos/mensajes/newsletter).
 * - `auditor`: sólo lectura en todo, incluida la bitácora.
 */
export const ROL_CAPACIDADES: Record<Rol, ReadonlySet<Capacidad>> = {
  superadmin: new Set(TODAS),
  admin: new Set<Capacidad>([
    "content.read",
    "content.write",
    "content.publish",
    "content.delete",
    "leads.read",
    "leads.write",
    "settings.read",
    "settings.write",
    "audit.read",
  ]),
  editor: new Set<Capacidad>([
    "content.read",
    "content.write",
    "content.publish",
    "content.delete",
    "leads.read",
    "leads.write",
    "settings.read",
    "settings.write",
  ]),
  autor: new Set<Capacidad>(["content.read", "content.write"]),
  revisor: new Set<Capacidad>(["content.read", "content.write", "content.publish"]),
  analista_marketing: new Set<Capacidad>(["content.read", "leads.read", "settings.read"]),
  operador_leads: new Set<Capacidad>(["content.read", "leads.read", "leads.write"]),
  auditor: new Set<Capacidad>(["content.read", "leads.read", "settings.read", "audit.read"]),
};

export function esRol(valor: unknown): valor is Rol {
  return typeof valor === "string" && (ROLES as readonly string[]).includes(valor);
}

/** ¿El rol tiene la capacidad? Un rol desconocido no tiene ninguna. */
export function tieneCapacidad(rol: unknown, cap: Capacidad): boolean {
  if (!esRol(rol)) return false;
  return ROL_CAPACIDADES[rol].has(cap);
}

/** Las capacidades de un rol, como arreglo estable (para el front y `/auth/me`). */
export function capacidadesDe(rol: unknown): Capacidad[] {
  if (!esRol(rol)) return [];
  return CAPACIDADES.filter((c) => ROL_CAPACIDADES[rol].has(c));
}
