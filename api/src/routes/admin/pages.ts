import { Router } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { sanitizeHtml, sanitizeMapEmbed, safeLinkHref } from "../../html.js";
import { validateBlockProps } from "../../block-validation.js";
import { instanteDesdeHoraLocal } from "../../timezone.js";

export const pagesRouter = Router();

const COLUMNAS_LISTA = ["id", "slug", "title", "status", "order", "publish_at", "updated_at"] as const;

pagesRouter.get("/", async (_req, res) => {
  // La papelera vive aparte: la lista principal muestra sólo lo que no está
  // borrado.
  const rows = await db("pages").whereNull("deleted_at").orderBy("order").select(...COLUMNAS_LISTA);
  res.json(rows);
});

/**
 * La papelera: páginas borradas de forma recuperable. Va **antes** de `/:id`
 * para que Express no interprete "papelera" como un id.
 */
pagesRouter.get("/papelera", async (_req, res) => {
  const rows = await db("pages")
    .whereNotNull("deleted_at")
    .orderBy("deleted_at", "desc")
    .select("id", "slug", "title", "status", "deleted_at");
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
  // Se acepta como texto y se interpreta abajo en la zona institucional; el
  // esquema sólo comprueba que sea texto o nulo (vaciar el agendamiento).
  publish_at: z.string().nullable().optional(),
});

/**
 * Traduce el `publish_at` del payload a lo que se guarda.
 *
 * Devuelve `{ set: Date|null }` cuando hay que escribir la columna, o
 * `{ invalido: true }` cuando vino algo que no es una fecha. La zona la resuelve
 * `instanteDesdeHoraLocal` (institucional), no la del proceso.
 */
function resolverPublishAt(valor: string | null | undefined): { set: Date | null } | { invalido: true } {
  const instante = instanteDesdeHoraLocal(valor);
  if (instante === undefined) return { invalido: true }; // vino texto, pero no es fecha
  return { set: instante }; // null (vaciar) o Date (agendar)
}

pagesRouter.post("/", async (req, res) => {
  const parsed = pageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido", issues: parsed.error.issues });
  const p = parsed.data;

  let publishAt: Date | null = null;
  if (p.publish_at !== undefined && p.publish_at !== null && p.publish_at !== "") {
    const r = resolverPublishAt(p.publish_at);
    if ("invalido" in r) return res.status(400).json({ error: "publish_at no es una fecha válida" });
    publishAt = r.set;
  }

  const [id] = await db("pages").insert({
    slug: p.slug,
    title: p.title,
    status: p.status ?? "draft",
    seo: p.seo ? JSON.stringify(p.seo) : null,
    order: p.order ?? 0,
    publish_at: publishAt,
  });
  res.status(201).json({ id });
});

pagesRouter.put("/:id", async (req, res) => {
  const parsed = pageSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido", issues: parsed.error.issues });
  const p = parsed.data;
  const patch: any = { ...p };
  if (p.seo !== undefined) patch.seo = JSON.stringify(p.seo);
  // `publish_at` sólo se toca si vino la clave: ausente = no cambia; ""/null =
  // se desagenda; texto de fecha = se agenda; texto no-fecha = 400.
  if ("publish_at" in p) {
    const r = resolverPublishAt(p.publish_at ?? null);
    if ("invalido" in r) return res.status(400).json({ error: "publish_at no es una fecha válida" });
    patch.publish_at = r.set;
  }
  patch.updated_at = db.fn.now();
  const n = await db("pages").where({ id: req.params.id }).whereNull("deleted_at").update(patch);
  if (n === 0) return res.status(404).json({ error: "no encontrada" });
  res.json({ ok: true });
});

/** Borrado recuperable: va a la papelera, no se pierde. */
pagesRouter.delete("/:id", async (req, res) => {
  const n = await db("pages")
    .where({ id: req.params.id })
    .whereNull("deleted_at")
    .update({ deleted_at: db.fn.now() });
  if (n === 0) return res.status(404).json({ error: "no encontrada" });
  res.status(204).end();
});

/** Restaurar desde la papelera. */
pagesRouter.post("/:id/restore", async (req, res) => {
  const n = await db("pages")
    .where({ id: req.params.id })
    .whereNotNull("deleted_at")
    .update({ deleted_at: null, updated_at: db.fn.now() });
  if (n === 0) return res.status(404).json({ error: "no está en la papelera" });
  res.json({ ok: true });
});

/**
 * Borrado definitivo: sólo desde la papelera, y esto sí es irreversible (se
 * lleva los bloques por cascade). Exigir que ya esté en la papelera evita
 * destruir una página viva de un solo click.
 */
pagesRouter.delete("/:id/definitivo", async (req, res) => {
  const fila = await db("pages").where({ id: req.params.id }).whereNotNull("deleted_at").first();
  if (!fila) return res.status(404).json({ error: "no está en la papelera" });
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
