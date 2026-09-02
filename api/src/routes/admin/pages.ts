import { Router } from "express";
import type { Knex } from "knex";
import { z } from "zod";
import { db } from "../../db.js";
import { sanitizeHtml, sanitizeMapEmbed, safeLinkHref } from "../../html.js";
import { validateBlockProps } from "../../block-validation.js";
import { instanteDesdeHoraLocal } from "../../timezone.js";
import { notFound } from "../../http.js";
import { registrarAccion, actorDe } from "../../audit.js";

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

const seoSchema = z
  .object({
    title: z.string().max(70).optional().or(z.literal("")),
    description: z.string().max(170).optional().or(z.literal("")),
    ogImage: z.string().max(500).optional().or(z.literal("")),
  })
  .strip();

const pageSchema = z.object({
  slug: z.string().trim().min(1).max(191).regex(/^[a-z0-9-]+$/),
  title: z.string().trim().min(1).max(255),
  status: z.enum(["draft", "published"]).optional(),
  seo: seoSchema.optional(),
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
  await registrarAccion({ ...actorDe(req), action: "create", resourceType: "pages", resourceId: id, meta: { slug: p.slug } });
  res.status(201).json({ id });
});

/**
 * Construye el patch de metadatos desde un payload parcial. Resuelve `publish_at`
 * en la zona institucional. Lanza 400 si la fecha vino como texto no-fecha.
 */
function construirMetaPatch(p: {
  title?: string;
  slug?: string;
  status?: "draft" | "published";
  seo?: unknown;
  order?: number;
  publish_at?: string | null;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (p.title !== undefined) patch.title = p.title;
  if (p.slug !== undefined) patch.slug = p.slug;
  if (p.status !== undefined) patch.status = p.status;
  if (p.order !== undefined) patch.order = p.order;
  if (p.seo !== undefined) patch.seo = p.seo ? JSON.stringify(p.seo) : null;
  if ("publish_at" in p) {
    const r = resolverPublishAt(p.publish_at ?? null);
    if ("invalido" in r) throw new PublishAtInvalido();
    patch.publish_at = r.set;
  }
  return patch;
}

class PublishAtInvalido extends Error {}

pagesRouter.put("/:id", async (req, res) => {
  const parsed = pageSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido", issues: parsed.error.issues });
  let patch: Record<string, unknown>;
  try {
    patch = construirMetaPatch(parsed.data);
  } catch (e) {
    if (e instanceof PublishAtInvalido) return res.status(400).json({ error: "publish_at no es una fecha válida" });
    throw e;
  }
  patch.updated_at = db.fn.now();
  // La papelera es intocable desde la edición: `whereNull(deleted_at)`.
  const n = await db("pages").where({ id: req.params.id }).whereNull("deleted_at").update(patch);
  if (n === 0) return res.status(404).json({ error: "no encontrada" });
  // Publicar/despublicar quedan como acciones propias; el resto es una edición.
  const accion = patch.status === "published" ? "publish" : patch.status === "draft" ? "unpublish" : "update";
  await registrarAccion({ ...actorDe(req), action: accion, resourceType: "pages", resourceId: req.params.id });
  res.json({ ok: true });
});

const scheduleSchema = z.object({ publish_at: z.string() });

/**
 * Programar la publicación: pasa la página a `published` con una fecha **futura**.
 *
 * La decisión de "es futura" vive acá, en el backend, no en el navegador. El
 * `<input type="datetime-local">` manda una hora de pared sin offset; validarla
 * con `new Date(...)` la interpretaría en la zona accidental de la máquina del
 * editor, así que "las 10:00" podían quedar en el pasado o el futuro según dónde
 * esté sentado. `instanteDesdeHoraLocal` la interpreta en `America/Asuncion`
 * —la misma zona que usa el servidor para guardar `publish_at`— y la comparación
 * contra `Date.now()` es entre instantes absolutos, independiente de zonas.
 *
 * "Publicar ya" es otra cosa (status published + `publish_at: null`) y va por el
 * `PUT` de metadatos; acá una fecha pasada se rechaza.
 */
pagesRouter.post("/:id/schedule", async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido" });
  const instante = instanteDesdeHoraLocal(parsed.data.publish_at);
  if (instante === null) return res.status(400).json({ error: "Hay que indicar una fecha para programar." });
  if (instante === undefined) return res.status(400).json({ error: "La fecha no es válida." });
  if (instante.getTime() <= Date.now()) {
    return res
      .status(400)
      .json({ error: "La fecha de publicación tiene que ser futura. Para publicar ya, usá “Publicar”." });
  }
  const n = await db("pages")
    .where({ id: req.params.id })
    .whereNull("deleted_at")
    .update({ status: "published", publish_at: instante, updated_at: db.fn.now() });
  if (n === 0) return res.status(404).json({ error: "no encontrada" });
  await registrarAccion({ ...actorDe(req), action: "schedule", resourceType: "pages", resourceId: req.params.id });
  res.json({ ok: true });
});

/** Borrado recuperable: va a la papelera, no se pierde. */
pagesRouter.delete("/:id", async (req, res) => {
  const n = await db("pages")
    .where({ id: req.params.id })
    .whereNull("deleted_at")
    .update({ deleted_at: db.fn.now() });
  if (n === 0) return res.status(404).json({ error: "no encontrada" });
  await registrarAccion({ ...actorDe(req), action: "trash", resourceType: "pages", resourceId: req.params.id });
  res.status(204).end();
});

/** Restaurar desde la papelera. */
pagesRouter.post("/:id/restore", async (req, res) => {
  const n = await db("pages")
    .where({ id: req.params.id })
    .whereNotNull("deleted_at")
    .update({ deleted_at: null, updated_at: db.fn.now() });
  if (n === 0) return res.status(404).json({ error: "no está en la papelera" });
  await registrarAccion({ ...actorDe(req), action: "restore", resourceType: "pages", resourceId: req.params.id });
  res.json({ ok: true });
});

/**
 * Borrado definitivo: **un solo DELETE condicional atómico** sobre una fila que
 * siga en la papelera. Sin "consultar y después borrar" —esa ventana permitía
 * que la página se restaurara entre medio y se destruyera igual—. Si nada
 * coincide (no existe o no está en la papelera), 404.
 */
pagesRouter.delete("/:id/definitivo", async (req, res) => {
  const n = await db("pages").where({ id: req.params.id }).whereNotNull("deleted_at").del();
  if (n === 0) return res.status(404).json({ error: "no está en la papelera" });
  await registrarAccion({ ...actorDe(req), action: "purge", resourceType: "pages", resourceId: req.params.id });
  res.status(204).end();
});

// ------------------------------------------------------ historial de versiones

/** JSON de columna: MariaDB lo devuelve como string, MySQL 8 ya parseado. */
function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Cuántas versiones se conservan por página. Las más viejas se descartan. */
const MAX_REVISIONES = 30;

/**
 * Archiva una foto del estado **actual** de la página —título, slug, estado,
 * SEO, `publish_at` y bloques— y poda las versiones que exceden el tope.
 *
 * Se llama **antes** de reemplazar contenido, no después. Ésa es la corrección
 * central: con "archivar después" la primera edición de una página existente
 * pisaba su contenido original y recién archivaba el nuevo, así que lo viejo se
 * perdía. Archivando el estado actual antes de tocarlo, la versión anterior
 * siempre queda recuperable, incluida la primera edición.
 *
 * La foto es completa y consistente: sale de una sola lectura de la fila y sus
 * bloques dentro de la misma transacción, así que nunca mezcla metadatos nuevos
 * con bloques viejos.
 */
async function archivarActual(trx: Knex.Transaction, pageId: number, userId?: number): Promise<void> {
  const page = await trx("pages").where({ id: pageId }).first();
  if (!page) return;
  const blocks = await trx("blocks").where({ page_id: pageId }).orderBy("order").select("type", "props", "order");
  const snapshot = {
    title: page.title,
    slug: page.slug,
    status: page.status,
    seo: parseJson(page.seo) ?? null,
    publish_at: page.publish_at ?? null,
    blocks: blocks.map((b) => ({ type: b.type, props: parseJson(b.props), order: b.order })),
  };
  await trx("page_revisions").insert({
    page_id: pageId,
    snapshot: JSON.stringify(snapshot),
    created_by: userId ?? null,
  });
  // Poda: se conservan las MAX_REVISIONES más nuevas (id descendente).
  const sobrantes = await trx("page_revisions")
    .where({ page_id: pageId })
    .orderBy("id", "desc")
    .offset(MAX_REVISIONES)
    .select("id");
  if (sobrantes.length > 0) {
    await trx("page_revisions").whereIn("id", sobrantes.map((r) => r.id)).del();
  }
}

interface BloqueValido {
  type: string;
  props: unknown;
}
interface BloqueInvalido {
  ok: false;
  index: number;
  type: string;
  error: unknown;
}

/** Valida y sanea la lista de bloques; devuelve los válidos o el primero roto. */
function validarBloques(
  raw: { type: string; props?: unknown }[],
): { ok: true; validados: BloqueValido[] } | { ok: false; invalido: BloqueInvalido } {
  const validados: BloqueValido[] = [];
  for (let index = 0; index < raw.length; index++) {
    const b = raw[index];
    const result = validateBlockProps(b.type, sanitizeBlockProps(b.props));
    if (!result.success) {
      return { ok: false, invalido: { ok: false, index, type: b.type, error: result.error } };
    }
    validados.push({ type: b.type, props: result.data });
  }
  return { ok: true, validados };
}

/** Reemplaza todos los bloques de la página por los validados, en orden. */
async function reemplazarBloques(
  trx: Knex.Transaction,
  pageId: number,
  validados: BloqueValido[],
): Promise<void> {
  await trx("blocks").where({ page_id: pageId }).del();
  for (let i = 0; i < validados.length; i++) {
    await trx("blocks").insert({
      page_id: pageId,
      type: validados[i].type,
      props: JSON.stringify(validados[i].props),
      order: i,
    });
  }
}

/** Carga la fila viva (no borrada) o lanza 404. Bloquea con `FOR UPDATE`. */
async function cargarPaginaViva(trx: Knex.Transaction, pageId: number) {
  const page = await trx("pages").where({ id: pageId }).forUpdate().first();
  if (!page || page.deleted_at != null) throw notFound("no encontrada");
  return page;
}

const contentSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  slug: z.string().trim().min(1).max(191).regex(/^[a-z0-9-]+$/).optional(),
  status: z.enum(["draft", "published"]).optional(),
  seo: seoSchema.optional(),
  publish_at: z.string().nullable().optional(),
  blocks: z.array(z.object({ type: z.string(), props: z.unknown() })).max(80),
});

/**
 * Guardado atómico completo de la página: metadatos + bloques en **una sola
 * operación**. Es lo que usa el Page Builder, para no partir el guardado en dos
 * llamadas (metadatos por un lado, bloques por otro) que dejaban fotos
 * intermedias inconsistentes y estado a medias si la segunda fallaba.
 *
 * Orden dentro de la transacción: cargar la fila viva (404 si no está o está en
 * la papelera) → **archivar el estado anterior** → aplicar metadatos → reemplazar
 * bloques. Si algo falla, la transacción revierte entera: nunca quedan metadatos
 * actualizados con bloques a medias.
 */
pagesRouter.put("/:id/content", async (req, res) => {
  const pageId = Number(req.params.id);
  const parsed = contentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido", issues: parsed.error.issues });

  const bloques = validarBloques(parsed.data.blocks);
  if (!bloques.ok) return res.status(400).json({ error: "bloque invalido", block: bloques.invalido });

  let metaPatch: Record<string, unknown>;
  try {
    metaPatch = construirMetaPatch(parsed.data);
  } catch (e) {
    if (e instanceof PublishAtInvalido) return res.status(400).json({ error: "publish_at no es una fecha válida" });
    throw e;
  }

  await db.transaction(async (trx) => {
    await cargarPaginaViva(trx, pageId);
    await archivarActual(trx, pageId, req.user?.id);
    await trx("pages")
      .where({ id: pageId })
      .update({ ...metaPatch, updated_at: trx.fn.now() });
    await reemplazarBloques(trx, pageId, bloques.validados);
  });
  res.json({ ok: true });
});

const blocksReplaceSchema = z.object({
  blocks: z.array(
    z.object({
      type: z.string(),
      props: z.unknown(),
    }),
  ).max(80),
});

/**
 * Guardado de sólo bloques. Se conserva por compatibilidad; el Page Builder usa
 * `/content`. Aplica el mismo contrato de historial: archiva el estado anterior
 * antes de reemplazar, respeta la papelera y es atómico.
 */
pagesRouter.put("/:id/blocks", async (req, res) => {
  const pageId = Number(req.params.id);
  const parsed = blocksReplaceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido" });
  const bloques = validarBloques(parsed.data.blocks);
  if (!bloques.ok) return res.status(400).json({ error: "bloque invalido", block: bloques.invalido });
  await db.transaction(async (trx) => {
    await cargarPaginaViva(trx, pageId);
    await archivarActual(trx, pageId, req.user?.id);
    await reemplazarBloques(trx, pageId, bloques.validados);
    await trx("pages").where({ id: pageId }).update({ updated_at: trx.fn.now() });
  });
  res.json({ ok: true });
});

/** Historial de versiones de una página (más nueva primero). 404 si está en la papelera. */
pagesRouter.get("/:id/revisions", async (req, res) => {
  const pageId = Number(req.params.id);
  const page = await db("pages").where({ id: pageId }).first();
  if (!page || page.deleted_at != null) return res.status(404).json({ error: "no encontrada" });
  const rows = await db("page_revisions as r")
    .leftJoin("users as u", "u.id", "r.created_by")
    .where("r.page_id", pageId)
    .orderBy("r.id", "desc")
    .select("r.id", "r.created_at", "r.created_by", "r.snapshot", "u.name as author_name");
  res.json(
    rows.map((r) => {
      const snap = parseJson(r.snapshot) as any;
      return {
        id: r.id,
        created_at: r.created_at,
        author: r.author_name ?? null,
        title: snap?.title ?? null,
        blockCount: Array.isArray(snap?.blocks) ? snap.blocks.length : 0,
      };
    }),
  );
});

/**
 * Restaura una versión: aplica su título, estado, SEO, `publish_at` y bloques
 * como estado actual. **Archiva primero el estado actual**, de modo que restaurar
 * también se pueda deshacer (queda como una versión más). Atómico y con guarda
 * de papelera.
 *
 * El `slug` NO se restaura: es la identidad y la URL de la página. Cambiarlo al
 * volver a una versión vieja rompería enlaces y podría chocar con otra página.
 */
pagesRouter.post("/:id/revisions/:revId/restore", async (req, res) => {
  const pageId = Number(req.params.id);
  const revId = Number(req.params.revId);
  const rev = await db("page_revisions").where({ id: revId, page_id: pageId }).first();
  if (!rev) return res.status(404).json({ error: "versión no encontrada" });
  const snap = parseJson(rev.snapshot) as any;
  if (!snap || typeof snap !== "object") return res.status(422).json({ error: "versión ilegible" });

  const brutos: { type: string; props: unknown }[] = Array.isArray(snap.blocks)
    ? snap.blocks.map((b: any) => ({ type: String(b?.type), props: b?.props ?? {} }))
    : [];
  const bloques = validarBloques(brutos);
  // Una versión archivada ya pasó por validación al guardarse; si aun así trae
  // un bloque ilegible (fila editada a mano), se rechaza en vez de escribir basura.
  if (!bloques.ok) return res.status(422).json({ error: "versión con un bloque ilegible" });

  await db.transaction(async (trx) => {
    await cargarPaginaViva(trx, pageId);
    // Primero se archiva lo que hay ahora: así deshacer la restauración es volver
    // a esta versión recién creada.
    await archivarActual(trx, pageId, req.user?.id);
    await trx("pages")
      .where({ id: pageId })
      .update({
        title: snap.title,
        status: snap.status === "published" ? "published" : "draft",
        seo: snap.seo ? JSON.stringify(snap.seo) : null,
        // El snapshot guarda `publish_at` como texto ISO con `Z` (viene de
        // `JSON.stringify(Date)`). Escribir ese string crudo en la columna
        // DATETIME es frágil: MySQL 8 en modo estricto rechaza el `T`/`Z`, y una
        // base más laxa podría reinterpretarlo y correr el instante. Se
        // normaliza a `Date`, que el driver formatea igual que el guardado
        // original, así el instante restaurado es idéntico al archivado.
        publish_at: snap.publish_at ? new Date(snap.publish_at) : null,
        updated_at: trx.fn.now(),
      });
    await reemplazarBloques(trx, pageId, bloques.validados);
  });
  await registrarAccion({ ...actorDe(req), action: "restore_revision", resourceType: "pages", resourceId: pageId, meta: { revId } });
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
