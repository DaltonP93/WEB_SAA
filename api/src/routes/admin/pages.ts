import { Router } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { sanitizeHtml, sanitizeMapEmbed, safeLinkHref } from "../../html.js";
import { validateBlockProps } from "../../block-validation.js";

export const pagesRouter = Router();

pagesRouter.get("/", async (_req, res) => {
  const rows = await db("pages").orderBy("order").select("id", "slug", "title", "status", "order");
  res.json(rows);
});

pagesRouter.get("/:id", async (req, res) => {
  const page = await db("pages").where({ id: req.params.id }).first();
  if (!page) return res.status(404).json({ error: "no encontrada" });
  const blocks = await db("blocks").where({ page_id: page.id }).orderBy("order");
  res.json({
    ...page,
    blocks: blocks.map((b) => ({ id: b.id, type: b.type, order: b.order, props: b.props })),
  });
});

const pageSchema = z.object({
  slug: z.string().trim().min(1).max(191).regex(/^[a-z0-9-]+$/),
  title: z.string().trim().min(1).max(255),
  status: z.enum(["draft", "published"]).optional(),
  seo: z.object({
    title: z.string().max(70).optional().or(z.literal("")),
    description: z.string().max(170).optional().or(z.literal("")),
    ogImage: z.string().max(500).optional().or(z.literal("")),
  }).strip().optional(),
  order: z.number().int().optional(),
});

pagesRouter.post("/", async (req, res) => {
  const p = pageSchema.parse(req.body);
  const [id] = await db("pages").insert({
    slug: p.slug,
    title: p.title,
    status: p.status ?? "draft",
    seo: p.seo ? JSON.stringify(p.seo) : null,
    order: p.order ?? 0,
  });
  res.status(201).json({ id });
});

pagesRouter.put("/:id", async (req, res) => {
  const p = pageSchema.partial().parse(req.body);
  const patch: any = { ...p };
  if (p.seo !== undefined) patch.seo = JSON.stringify(p.seo);
  patch.updated_at = db.fn.now();
  await db("pages").where({ id: req.params.id }).update(patch);
  res.json({ ok: true });
});

pagesRouter.delete("/:id", async (req, res) => {
  await db("pages").where({ id: req.params.id }).del();
  res.status(204).end();
});

const blocksReplaceSchema = z.object({
  blocks: z.array(
    z.object({
      type: z.string(),
      props: z.unknown(),
    }),
  ).max(80),
});

pagesRouter.put("/:id/blocks", async (req, res) => {
  const pageId = Number(req.params.id);
  const parsed = blocksReplaceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido" });
  const blocks = parsed.data.blocks.map((b, index) => {
    const result = validateBlockProps(b.type, sanitizeBlockProps(b.props));
    if (!result.success) return { ok: false as const, index, type: b.type, error: result.error };
    return { ok: true as const, type: b.type, props: result.data };
  });
  const invalid = blocks.find((b) => !b.ok);
  if (invalid) return res.status(400).json({ error: "bloque invalido", block: invalid });
  await db.transaction(async (trx) => {
    await trx("blocks").where({ page_id: pageId }).del();
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b.ok) continue;
      await trx("blocks").insert({
        page_id: pageId,
        type: b.type,
        props: JSON.stringify(b.props),
        order: i,
      });
    }
    await trx("pages").where({ id: pageId }).update({ updated_at: trx.fn.now() });
  });
  res.json({ ok: true });
});

/**
 * Saneo profundo de los props de un bloque.
 *
 * - `html`/`body`: HTML con allowlist.
 * - `embedHtml`: sólo el iframe del mapa, reconstruido y validado.
 * - claves de enlace (`href`, `ctaHref`, `directionsUrl`…): se descartan si el
 *   destino no es seguro, para que un `javascript:` nunca llegue al front.
 */
const HTML_KEYS = new Set(["html", "body"]);
const LINK_KEYS = new Set([
  "href",
  "ctaHref",
  "secondaryCtaHref",
  "directionsUrl",
  "imageUrl",
  "url",
]);

function sanitizeBlockProps(props: unknown): unknown {
  if (Array.isArray(props)) return props.map(sanitizeBlockProps);
  if (!props || typeof props !== "object") return props;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    // `embedUrl` es de sólo salida: la API lo calcula al publicar. Aceptarlo
    // al escribir permitía guardar un destino que después pisaba al calculado.
    if (key === "embedUrl") continue;
    if (typeof value === "string" && HTML_KEYS.has(key)) {
      out[key] = sanitizeHtml(value) ?? "";
    } else if (typeof value === "string" && key === "embedHtml") {
      out[key] = sanitizeMapEmbed(value);
    } else if (typeof value === "string" && LINK_KEYS.has(key)) {
      out[key] = safeLinkHref(value) ?? "";
    } else {
      out[key] = sanitizeBlockProps(value);
    }
  }
  return out;
}
