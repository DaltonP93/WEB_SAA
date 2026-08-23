import { Router } from "express";
import { db } from "../../db.js";
import { cargarRedirects, validarRedirect } from "../../redirects.js";

/**
 * CRUD de redirects 301.
 *
 * Bespoke y no `crudRouter` por tres motivos que el genérico no cubre:
 *
 * - la validación es cruzada (origen y destino se validan juntos, con la
 *   garantía de que el destino es interno) y normaliza el origen antes de
 *   guardar;
 * - un origen repetido es un **409**, no un error de esquema;
 * - después de cada cambio hay que **refrescar la caché** en memoria que lee el
 *   middleware, o el redirect nuevo no se aplicaría hasta el próximo arranque.
 */
export const redirectsRouter = Router();

function serialize(row: any) {
  return {
    id: row.id,
    from: row.from_path,
    to: row.to_path,
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

redirectsRouter.get("/", async (_req, res) => {
  const filas = await db("redirects").orderBy("from_path").select("*");
  res.json(filas.map(serialize));
});

redirectsRouter.post("/", async (req, res) => {
  const r = validarRedirect(req.body);
  if (!r.ok) return res.status(400).json({ error: "payload invalido", issues: r.errores });

  const activo = req.body?.active === undefined ? true : Boolean(req.body.active);
  const yaExiste = await db("redirects").where({ from_path: r.value.from }).first();
  if (yaExiste) {
    return res.status(409).json({ error: `ya existe un redirect para "${r.value.from}"` });
  }

  const [id] = await db("redirects").insert({
    from_path: r.value.from,
    to_path: r.value.to,
    active: activo,
  });
  await cargarRedirects();
  const fila = await db("redirects").where({ id }).first();
  res.status(201).json(serialize(fila));
});

redirectsRouter.put("/:id", async (req, res) => {
  const actual = await db("redirects").where({ id: req.params.id }).first();
  if (!actual) return res.status(404).json({ error: "no encontrado" });

  const r = validarRedirect({
    from: req.body?.from ?? actual.from_path,
    to: req.body?.to ?? actual.to_path,
  });
  if (!r.ok) return res.status(400).json({ error: "payload invalido", issues: r.errores });

  // El origen puede haber cambiado: no puede pisar el de otra fila.
  const choque = await db("redirects")
    .where({ from_path: r.value.from })
    .whereNot({ id: req.params.id })
    .first();
  if (choque) {
    return res.status(409).json({ error: `ya existe un redirect para "${r.value.from}"` });
  }

  const cambios: Record<string, unknown> = {
    from_path: r.value.from,
    to_path: r.value.to,
    updated_at: db.fn.now(),
  };
  if (req.body?.active !== undefined) cambios.active = Boolean(req.body.active);

  await db("redirects").where({ id: req.params.id }).update(cambios);
  await cargarRedirects();
  const fila = await db("redirects").where({ id: req.params.id }).first();
  res.json(serialize(fila));
});

redirectsRouter.delete("/:id", async (req, res) => {
  const actual = await db("redirects").where({ id: req.params.id }).first();
  if (!actual) return res.status(404).json({ error: "no encontrado" });
  await db("redirects").where({ id: req.params.id }).del();
  await cargarRedirects();
  res.status(204).end();
});
