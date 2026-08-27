import { Router } from "express";
import { db } from "../../db.js";
import { leerAtribucion } from "../../marketing.js";
import { formatearEnZona } from "../../timezone.js";
import { celdaCsv } from "./appointments.js";

/**
 * Bandeja de suscriptores de novedades.
 *
 * Lista, exporta a CSV y permite dar de baja. La exportación es el objetivo:
 * llevarse los correos a donde el sanatorio decida enviar las novedades, sin
 * atar el proyecto a un proveedor de mailing.
 */
export const newsletterRouter = Router();

function serialize(row: any) {
  return {
    id: row.id,
    email: row.email,
    source: row.source ?? null,
    created_at: row.created_at,
    attribution: leerAtribucion(row.attribution),
  };
}

newsletterRouter.get("/", async (_req, res) => {
  const rows = await db("newsletter_subscribers").orderBy("created_at", "desc").select("*");
  res.json({ items: rows.map(serialize), total: rows.length });
});

newsletterRouter.get("/export", async (_req, res) => {
  const filas = await db("newsletter_subscribers").orderBy("created_at", "desc").select("*");
  const columnas: [string, (r: any) => unknown][] = [
    ["Fecha", (r) => formatearEnZona(r.created_at)],
    ["Email", (r) => r.email],
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
  res.setHeader("Content-Disposition", 'attachment; filename="newsletter.csv"');
  res.send(csv);
});

newsletterRouter.delete("/:id", async (req, res) => {
  const n = await db("newsletter_subscribers").where({ id: req.params.id }).del();
  if (n === 0) return res.status(404).json({ error: "no encontrado" });
  res.status(204).end();
});
