import { Router } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { badRequest, notFound } from "../../http.js";
import { formatearEnZona, inicioDelDia, inicioDelDiaSiguiente } from "../../timezone.js";
import { leerAtribucion, type Atribucion } from "../../marketing.js";

/**
 * Bandeja de solicitudes de turno.
 *
 * WhatsApp sigue siendo el canal con el que se coordina: acá no se responde
 * nada. Lo que hace esta bandeja es que la solicitud **exista** para el
 * sanatorio aunque el paciente nunca llegue a escribir por WhatsApp, o escriba
 * desde otro número, o la conversación se pierda entre cientos.
 *
 * Los filtros se validan igual que un payload: con `parse()` un `status`
 * inventado daba **500 "error interno"**, porque el manejador global convierte
 * en 500 todo lo que no sea `HttpError`.
 *
 * ## El orden y la paginación los resuelve el servidor
 *
 * La tabla del panel recibía las primeras 200 filas y buscaba, ordenaba y
 * paginaba sobre eso. Con más de 200 solicitudes, buscar un apellido que
 * estuviera en la 300 devolvía "sin resultados" — y el operador no tenía cómo
 * saber que el dato existía. Ahora `q`, el orden y la ventana viajan a la base.
 */

export const appointmentsRouter = Router();

const ESTADOS = ["pendiente", "confirmado", "cancelado"] as const;

/**
 * Columnas por las que se puede ordenar.
 *
 * Es una allowlist y no una validación de forma: el valor entra en la
 * cláusula `ORDER BY`, así que aceptar "cualquier string que parezca una
 * columna" sería dejar decidir al cliente qué se ejecuta. Las claves son las
 * que el panel expone como ordenables; el valor es la columna real.
 */
const ORDENABLES: Record<string, string> = {
  created_at: "a.created_at",
  name: "a.name",
  status: "a.status",
  preferred_at: "a.preferred_at",
  specialty_name: "s.name",
  doctor_name: "d.name",
};

/** Fecha en formato `YYYY-MM-DD`, la que emite un `<input type="date">`. */
const fecha = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "usá el formato AAAA-MM-DD")
  .refine((v) => inicioDelDia(v) !== undefined, "fecha inválida");

const filtrosSchema = z.object({
  status: z.enum(ESTADOS).optional(),
  from: fecha.optional(),
  to: fecha.optional(),
  /** Búsqueda libre sobre nombre, teléfono, correo, médico y especialidad. */
  q: z.string().trim().max(120).optional(),
  sort: z
    .string()
    .trim()
    .refine((v) => v in ORDENABLES, "columna de orden no permitida")
    .optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  // Un tope siempre presente: la bandeja crece sin límite y el panel no puede
  // pedir la tabla entera por descuido.
  limit: z.coerce.number().int().positive().max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

type Filtros = z.infer<typeof filtrosSchema>;

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

const COLUMNAS = [
  "a.id",
  "a.name",
  "a.phone",
  "a.email",
  "a.preferred_at",
  "a.message",
  "a.status",
  "a.consent_at",
  "a.attribution",
  "a.created_at",
  "a.updated_at",
  "d.name as doctor_name",
  "s.name as specialty_name",
];

/**
 * Normaliza la atribución de una fila para la respuesta.
 *
 * La columna JSON vuelve como string en MariaDB y parseada en MySQL 8, y una
 * fila vieja o editada a mano podría traer cualquier cosa: `leerAtribucion`
 * devuelve siempre la forma saneada o `null`. Así el panel recibe un objeto
 * consistente y no el string crudo del motor.
 */
function conAtribucion<T extends { attribution?: unknown }>(fila: T): T & { attribution: Atribucion | null } {
  return { ...fila, attribution: leerAtribucion(fila.attribution) };
}

function aplicarFiltros(qb: any, f: Filtros) {
  if (f.status) qb.where("a.status", f.status);
  if (f.from) qb.where("a.created_at", ">=", inicioDelDia(f.from)!);
  // El "hasta" incluye el día entero, y se expresa como "menor que el inicio
  // del día siguiente". Con `<= 23:59:59.999` habría que razonar sobre la
  // precisión de la columna: lo que caiga en el último milisegundo del día
  // queda dentro o fuera según cómo esté declarada, y eso no se ve nunca.
  if (f.to) qb.where("a.created_at", "<", inicioDelDiaSiguiente(f.to)!);
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

/** Orden pedido, o el de siempre: lo último que entró, primero. */
function aplicarOrden(qb: any, f: Filtros) {
  const columna = f.sort ? ORDENABLES[f.sort] : "a.created_at";
  const direccion = f.dir ?? (f.sort ? "asc" : "desc");
  qb.orderBy(columna, direccion);
  // Desempate estable: sin esto, dos filas con el mismo valor pueden
  // intercambiarse entre páginas y una solicitud aparece dos veces o ninguna.
  if (columna !== "a.id") qb.orderBy("a.id", "desc");
  return qb;
}

const leerFiltros = (query: unknown): Filtros => {
  const parsed = filtrosSchema.safeParse(query);
  if (!parsed.success) throw badRequest("filtros invalidos", parsed.error.flatten().fieldErrors);
  return parsed.data;
};

appointmentsRouter.get("/", async (req, res) => {
  const f = leerFiltros(req.query);

  const [{ total }] = await aplicarFiltros(consultaBase(), f).count({ total: "a.id" });

  const filas = await aplicarOrden(aplicarFiltros(consultaBase(), f), f)
    .limit(f.limit)
    .offset(f.offset)
    .select(COLUMNAS);

  res.json({ items: filas.map(conAtribucion), total: Number(total), limit: f.limit, offset: f.offset });
});

/**
 * Exportación completa de lo que coincide con los filtros.
 *
 * No es la página que se ve: es **todo** el resultado. Exportar sólo lo
 * cargado producía un archivo que parece completo y no lo es, que en una
 * planilla de trabajo es peor que no exportar nada.
 *
 * Se arma en el servidor porque acá está el resultado entero sin recorrer
 * páginas, y porque el archivo tiene que salir con `Cache-Control: no-store`:
 * lleva nombres, teléfonos y correos de pacientes, y no puede quedar en
 * ninguna caché intermedia.
 */
appointmentsRouter.get("/export", async (req, res) => {
  const f = leerFiltros(req.query);

  const filas = await aplicarOrden(aplicarFiltros(consultaBase(), f), f).select(COLUMNAS);

  const columnas: [string, (r: any) => unknown][] = [
    ["Solicitado", (r) => formatearEnZona(r.created_at)],
    ["Nombre", (r) => r.name],
    ["Teléfono", (r) => r.phone],
    ["Email", (r) => r.email],
    ["Especialidad", (r) => r.specialty_name ?? ""],
    ["Médico", (r) => r.doctor_name ?? ""],
    ["Preferencia", (r) => formatearEnZona(r.preferred_at)],
    ["Estado", (r) => r.status],
    ["Mensaje", (r) => r.message ?? ""],
    // Atribución: las tres columnas que sirven en una planilla de marketing.
    // El resto (utm_term, utm_content, gclid, fbclid) vive en la respuesta de
    // la bandeja; en el CSV serían columnas casi siempre vacías.
    ["Origen", (r) => leerAtribucion(r.attribution)?.utm_source ?? ""],
    ["Medio", (r) => leerAtribucion(r.attribution)?.utm_medium ?? ""],
    ["Campaña", (r) => leerAtribucion(r.attribution)?.utm_campaign ?? ""],
    ["Actualizado", (r) => formatearEnZona(r.updated_at)],
  ];

  const lineas = [
    columnas.map(([h]) => celdaCsv(h)).join(","),
    ...filas.map((r: Record<string, unknown>) =>
      columnas.map(([, valor]) => celdaCsv(valor(r))).join(","),
    ),
  ];
  // BOM para que Excel abra el archivo en UTF-8 sin preguntar.
  const csv = "﻿" + lineas.join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", 'attachment; filename="turnos.csv"');
  res.send(csv);
});

/**
 * Una celda de CSV, escapada y sin poder ejecutarse.
 *
 * Excel y LibreOffice interpretan como fórmula lo que empieza con `=`, `+`,
 * `-`, `@` o un control, y una fórmula puede llamar a otra hoja o a un
 * servicio externo. El contenido de estas celdas lo escribe cualquiera que
 * complete el formulario público, así que se le antepone un apóstrofo: la
 * planilla lo muestra como texto y no lo evalúa.
 */
export function celdaCsv(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  const neutralizado = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return /[",\n\r]/.test(neutralizado) ? `"${neutralizado.replace(/"/g, '""')}"` : neutralizado;
}

appointmentsRouter.put("/:id", async (req, res) => {
  const parsed = estadoSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("payload invalido", parsed.error.flatten().fieldErrors);

  const actual = await db("appointments").where({ id: req.params.id }).first("id");
  if (!actual) throw notFound("solicitud no encontrada");

  await db("appointments")
    .where({ id: req.params.id })
    .update({ status: parsed.data.status, updated_at: db.fn.now() });

  const fila = await consultaBase().where("a.id", req.params.id).first(COLUMNAS);
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
