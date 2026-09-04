import { Router } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { badRequest } from "../../http.js";
import { requireRole } from "../../auth.js";
import { formatearEnZona, inicioDelDia, inicioDelDiaSiguiente } from "../../timezone.js";
import { celdaCsv } from "./appointments.js";

/**
 * Lectura de la bitácora de acciones administrativas (`admin_audit_log`).
 *
 * Sólo lectura y **solo superadmin**: la tabla puede contener el correo de un
 * intento de acceso fallido y la IP del operador, así que no la ve un editor.
 * No hay endpoints de escritura/borrado: la tabla es append-only; las filas las
 * escribe `api/src/audit.ts` desde cada acción real.
 *
 * Búsqueda, filtros, orden y ventana los resuelve el servidor (mismo patrón que
 * la bandeja de Turnos): la tabla crece sin techo y recortar sobre una página ya
 * traída escondería registros.
 */

export const auditRouter = Router();
auditRouter.use(requireRole("superadmin"));

const ACCIONES = [
  "create",
  "update",
  "delete",
  "publish",
  "unpublish",
  "schedule",
  "trash",
  "restore",
  "purge",
  "restore_revision",
  "role_change",
  "login_ok",
  "login_fail",
] as const;

/** Allowlist de columnas ordenables (el valor entra en el ORDER BY). */
const ORDENABLES: Record<string, string> = {
  created_at: "created_at",
  action: "action",
  resource_type: "resource_type",
  actor_name: "actor_name",
};

const fecha = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "usá el formato AAAA-MM-DD")
  .refine((v) => inicioDelDia(v) !== undefined, "fecha inválida");

const filtrosSchema = z.object({
  action: z.enum(ACCIONES).optional(),
  resource_type: z.string().trim().max(64).optional(),
  actor_id: z.coerce.number().int().positive().optional(),
  from: fecha.optional(),
  to: fecha.optional(),
  q: z.string().trim().max(120).optional(),
  sort: z
    .string()
    .trim()
    .refine((v) => v in ORDENABLES, "columna de orden no permitida")
    .optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

type Filtros = z.infer<typeof filtrosSchema>;

const COLUMNAS = [
  "id",
  "actor_id",
  "actor_name",
  "actor_role",
  "action",
  "resource_type",
  "resource_id",
  "meta",
  "ip",
  "created_at",
];

/** JSON de columna: MariaDB lo devuelve string, MySQL 8 ya parseado. */
function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function comoLiteral(valor: string): string {
  return `%${valor.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function aplicarFiltros(qb: any, f: Filtros) {
  if (f.action) qb.where("action", f.action);
  if (f.resource_type) qb.where("resource_type", f.resource_type);
  if (f.actor_id) qb.where("actor_id", f.actor_id);
  if (f.from) qb.where("created_at", ">=", inicioDelDia(f.from)!);
  if (f.to) qb.where("created_at", "<", inicioDelDiaSiguiente(f.to)!);
  if (f.q) {
    const patron = comoLiteral(f.q);
    qb.where((w: any) =>
      w
        .where("actor_name", "like", patron)
        .orWhere("resource_id", "like", patron)
        .orWhere("action", "like", patron),
    );
  }
  return qb;
}

function aplicarOrden(qb: any, f: Filtros) {
  const columna = f.sort ? ORDENABLES[f.sort] : "created_at";
  const direccion = f.dir ?? (f.sort ? "asc" : "desc");
  qb.orderBy(columna, direccion);
  // Desempate estable por id: dos filas del mismo instante no se intercambian
  // entre páginas.
  if (columna !== "id") qb.orderBy("id", "desc");
  return qb;
}

const leerFiltros = (query: unknown): Filtros => {
  const parsed = filtrosSchema.safeParse(query);
  if (!parsed.success) throw badRequest("filtros invalidos", parsed.error.flatten().fieldErrors);
  return parsed.data;
};

function normalizar(fila: Record<string, unknown>) {
  return { ...fila, meta: parseJson(fila.meta) };
}

auditRouter.get("/", async (req, res) => {
  const f = leerFiltros(req.query);

  const [{ total }] = await aplicarFiltros(db("admin_audit_log"), f).count({ total: "id" });

  const filas = await aplicarOrden(aplicarFiltros(db("admin_audit_log"), f), f)
    .limit(f.limit)
    .offset(f.offset)
    .select(COLUMNAS);

  res.json({ items: filas.map(normalizar), total: Number(total), limit: f.limit, offset: f.offset });
});

/** Exportación completa de lo que coincide con los filtros. `no-store`: puede llevar IPs y correos. */
auditRouter.get("/export", async (req, res) => {
  const f = leerFiltros(req.query);
  const filas = await aplicarOrden(aplicarFiltros(db("admin_audit_log"), f), f).select(COLUMNAS);

  const columnas: [string, (r: any) => unknown][] = [
    ["Fecha", (r) => formatearEnZona(r.created_at)],
    ["Actor", (r) => r.actor_name ?? ""],
    ["Rol", (r) => r.actor_role ?? ""],
    ["Acción", (r) => r.action],
    ["Recurso", (r) => r.resource_type ?? ""],
    ["ID recurso", (r) => r.resource_id ?? ""],
    ["Detalle", (r) => { const m = parseJson(r.meta); return m ? JSON.stringify(m) : ""; }],
    ["IP", (r) => r.ip ?? ""],
  ];

  const lineas = [
    columnas.map(([h]) => celdaCsv(h)).join(","),
    ...filas.map((r: Record<string, unknown>) => columnas.map(([, valor]) => celdaCsv(valor(r))).join(",")),
  ];
  const csv = "﻿" + lineas.join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", 'attachment; filename="auditoria.csv"');
  res.send(csv);
});
