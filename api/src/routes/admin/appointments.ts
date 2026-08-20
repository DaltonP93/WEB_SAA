import { Router } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { badRequest, notFound } from "../../http.js";

/**
 * Bandeja de solicitudes de turno.
 *
 * WhatsApp sigue siendo el canal con el que se coordina: acá no se responde
 * nada. Lo que hace esta bandeja es que la solicitud **exista** para el
 * sanatorio aunque el paciente nunca llegue a escribir por WhatsApp, o escriba
 * desde otro número, o la conversación se pierda entre cientos.
 *
 * Los filtros se validan igual que un payload. Antes el router usaba
 * `schema.parse()`, que lanza: un `status` inventado no daba 400 sino un
 * **500 "error interno"**, porque el manejador global convierte en 500 todo lo
 * que no sea `HttpError`. El operador leía una falla del servidor por haber
 * escrito mal un filtro.
 */

export const appointmentsRouter = Router();

const ESTADOS = ["pendiente", "confirmado", "cancelado"] as const;

/** Fecha en formato `YYYY-MM-DD`, la que emite un `<input type="date">`. */
const fecha = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "usá el formato AAAA-MM-DD")
  .refine((v) => Number.isFinite(new Date(`${v}T00:00:00`).getTime()), "fecha inválida");

const filtrosSchema = z.object({
  status: z.enum(ESTADOS).optional(),
  from: fecha.optional(),
  to: fecha.optional(),
  /** Búsqueda libre sobre nombre, teléfono, correo, médico y especialidad. */
  q: z.string().trim().max(120).optional(),
  // Un tope siempre presente: la bandeja crece sin límite y el panel no puede
  // pedir la tabla entera por descuido.
  limit: z.coerce.number().int().positive().max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

const estadoSchema = z.object({ status: z.enum(ESTADOS) });

/** `LIKE` con los comodines del usuario escapados: `%` y `_` son literales. */
function comoLiteral(valor: string): string {
  return `%${valor.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Consulta base con los nombres de médico y especialidad ya resueltos. */
function consultaBase() {
  return db("appointments as a")
    .leftJoin("doctors as d", "d.id", "a.doctor_id")
    .leftJoin("specialties as s", "s.id", "a.specialty_id");
}

function aplicarFiltros(qb: any, f: z.infer<typeof filtrosSchema>) {
  if (f.status) qb.where("a.status", f.status);
  if (f.from) qb.where("a.created_at", ">=", new Date(`${f.from}T00:00:00`));
  // El "hasta" incluye el día entero: quien filtra por una fecha espera ver lo
  // de esa fecha, no lo anterior a su medianoche.
  if (f.to) qb.where("a.created_at", "<=", new Date(`${f.to}T23:59:59.999`));
  if (f.q) {
    const patron = comoLiteral(f.q);
    qb.where((w: any) =>
      w
        .where("a.name", "like", patron)
        .orWhere("a.phone", "like", patron)
        .orWhere("a.email", "like", patron)
        .orWhere("d.name", "like", patron)
        .orWhere("s.name", "like", patron),
    );
  }
  return qb;
}

appointmentsRouter.get("/", async (req, res) => {
  const parsed = filtrosSchema.safeParse(req.query);
  if (!parsed.success) throw badRequest("filtros invalidos", parsed.error.flatten().fieldErrors);
  const f = parsed.data;

  const [{ total }] = await aplicarFiltros(consultaBase(), f).count({ total: "a.id" });

  const items = await aplicarFiltros(consultaBase(), f)
    .orderBy("a.created_at", "desc")
    .orderBy("a.id", "desc")
    .limit(f.limit)
    .offset(f.offset)
    .select(
      "a.id",
      "a.name",
      "a.phone",
      "a.email",
      "a.preferred_at",
      "a.message",
      "a.status",
      "a.consent_at",
      "a.created_at",
      "a.updated_at",
      "d.name as doctor_name",
      "s.name as specialty_name",
    );

  res.json({ items, total: Number(total), limit: f.limit, offset: f.offset });
});

appointmentsRouter.put("/:id", async (req, res) => {
  const parsed = estadoSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("payload invalido", parsed.error.flatten().fieldErrors);

  const actual = await db("appointments").where({ id: req.params.id }).first("id");
  if (!actual) throw notFound("solicitud no encontrada");

  await db("appointments")
    .where({ id: req.params.id })
    .update({ status: parsed.data.status, updated_at: db.fn.now() });

  const fila = await consultaBase()
    .where("a.id", req.params.id)
    .first(
      "a.id",
      "a.name",
      "a.phone",
      "a.email",
      "a.preferred_at",
      "a.message",
      "a.status",
      "a.consent_at",
      "a.created_at",
      "a.updated_at",
      "d.name as doctor_name",
      "s.name as specialty_name",
    );
  res.json(fila);
});

appointmentsRouter.delete("/:id", async (req, res) => {
  const actual = await db("appointments").where({ id: req.params.id }).first("id");
  // Antes devolvía 204 aunque no existiera: el panel no podía distinguir
  // "borrado" de "nunca estuvo", y un id equivocado pasaba por éxito.
  if (!actual) throw notFound("solicitud no encontrada");
  await db("appointments").where({ id: req.params.id }).del();
  res.status(204).end();
});
