import { Router } from "express";
import { db } from "../../db.js";
import { leerAtribucion } from "../../marketing.js";
import { formatearEnZona } from "../../timezone.js";
import { celdaCsv } from "./appointments.js";

/**
 * Bandeja de suscriptores de novedades.
 *
 * Lista con búsqueda y paginación (la tabla puede crecer sin techo, así que no
 * se trae entera), exporta a CSV y permite dar de baja o reactivar. La
 * exportación es el objetivo: llevarse los correos a donde el sanatorio decida
 * enviar las novedades, sin atar el proyecto a un proveedor de mailing.
 *
 * El CSV incluye fecha y estado del consentimiento, y **nunca** el token de baja.
 */
export const newsletterRouter = Router();

function serialize(row: any) {
  return {
    id: row.id,
    email: row.email,
    source: row.source ?? null,
    active: Boolean(row.active),
    consent_at: row.consent_at,
    consent_version: row.consent_version ?? null,
    unsubscribed_at: row.unsubscribed_at ?? null,
    created_at: row.created_at,
    attribution: leerAtribucion(row.attribution),
    // `unsubscribe_token` NO se serializa: es secreto de la baja pública.
  };
}

const MAX_LIMIT = 100;

newsletterRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), MAX_LIMIT);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const base = () => {
    let qb = db("newsletter_subscribers");
    if (q) qb = qb.where("email", "like", `%${q}%`);
    return qb;
  };

  const [{ total }] = await base().count<{ total: number }[]>({ total: "*" });
  const rows = await base().orderBy("created_at", "desc").limit(limit).offset(offset).select("*");
  res.json({ items: rows.map(serialize), total: Number(total), limit, offset });
});

newsletterRouter.get("/export", async (_req, res) => {
  const filas = await db("newsletter_subscribers").orderBy("created_at", "desc").select("*");
  const columnas: [string, (r: any) => unknown][] = [
    ["Fecha", (r) => formatearEnZona(r.created_at)],
    ["Email", (r) => r.email],
    ["Estado", (r) => (r.active ? "activo" : "baja")],
    ["Baja", (r) => formatearEnZona(r.unsubscribed_at)],
    ["Consentimiento", (r) => formatearEnZona(r.consent_at)],
    ["Versión consentimiento", (r) => r.consent_version ?? ""],
    ["Origen", (r) => r.source ?? ""],
    ["Campaña", (r) => leerAtribucion(r.attribution)?.utm_campaign ?? ""],
    ["utm_source", (r) => leerAtribucion(r.attribution)?.utm_source ?? ""],
    ["utm_medium", (r) => leerAtribucion(r.attribution)?.utm_medium ?? ""],
  ];
  const lineas = [
    columnas.map(([h]) => celdaCsv(h)).join(","),
    ...filas.map((r: Record<string, unknown>) => columnas.map(([, v]) => celdaCsv(v(r))).join(",")),
  ];
  const csv = "﻿" + lineas.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", 'attachment; filename="newsletter.csv"');
  res.send(csv);
});

/**
 * Dar de baja o reactivar desde el panel (sin borrar la fila).
 *
 * La baja sella `unsubscribed_at` (cuándo ocurrió) igual que la baja pública;
 * reactivar la limpia. Así el momento de la baja queda registrado venga de donde
 * venga.
 */
newsletterRouter.put("/:id", async (req, res) => {
  const active = req.body?.active;
  if (typeof active !== "boolean") return res.status(400).json({ error: "active debe ser booleano" });
  const n = await db("newsletter_subscribers")
    .where({ id: req.params.id })
    .update({ active, unsubscribed_at: active ? null : db.fn.now() });
  if (n === 0) return res.status(404).json({ error: "no encontrado" });
  res.json({ ok: true });
});

/** Borrado definitivo desde el panel (distinto de la baja, que conserva la fila). */
newsletterRouter.delete("/:id", async (req, res) => {
  const n = await db("newsletter_subscribers").where({ id: req.params.id }).del();
  if (n === 0) return res.status(404).json({ error: "no encontrado" });
  res.status(204).end();
});
