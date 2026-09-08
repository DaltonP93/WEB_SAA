import { Router } from "express";
import type { Knex } from "knex";
import { z } from "zod";
import { db } from "../../db.js";
import { sanitizeHtml, sanitizeMapEmbed, safeLinkHref } from "../../html.js";
import { validateBlockProps } from "../../block-validation.js";
import { instanteDesdeHoraLocal } from "../../timezone.js";
import { notFound } from "../../http.js";
import { registrarAccion, actorDe, type AuditAction } from "../../audit.js";
import { tieneCapacidad } from "../../permisos.js";
import type { Request, Response } from "express";

/**
 * Publicar/despublicar/programar exige `content.publish`, además de la
 * `content.write` que ya pide el montaje del router. Así un `autor` (que tiene
 * `content.write` pero no `content.publish`) puede crear y editar borradores pero
 * no cambiar el estado de publicación; un `revisor`/`editor` sí. No se distingue
 * por método HTTP —un `PUT` puede ser editar o publicar—, por eso se comprueba
 * acá, sobre el payload.
 */
const puedePublicar = (req: Request): boolean => tieneCapacidad(req.user?.role, "content.publish");

export const pagesRouter = Router();

const COLUMNAS_LISTA = ["id", "slug", "title", "status", "order", "publish_at", "updated_at"] as const;

/**
 * Resultado de una operación de estado resuelta dentro de una transacción:
 * o una respuesta HTTP de error decidida bajo el lock, o el estado de origen
 * (`desde`) que se leyó al aplicar el cambio. Explícito para que el `"http" in …`
 * narrowing sea inequívoco fuera de la transacción.
 */
type ResultadoEstado = { http: 403 | 404 | 409; body: { error: string } } | { desde: string };

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

/**
 * Alta de página. Acepta un `status` **inicial** (borrador por defecto; publicar
 * de entrada exige `content.publish`), porque fijar el estado de una página que
 * todavía no existe no es *cambiar* el estado de una existente —eso es lo que el
 * flujo editorial reserva a las transiciones—. NO acepta `publish_at`: agendar es
 * `POST /:id/schedule` sobre una página ya creada.
 */
const pageCreateSchema = z.object({
  slug: z.string().trim().min(1).max(191).regex(/^[a-z0-9-]+$/),
  title: z.string().trim().min(1).max(255),
  status: z.enum(["draft", "published"]).optional(),
  seo: seoSchema.optional(),
  order: z.number().int().optional(),
});

/**
 * Edición de metadatos (`PUT /:id`) y de contenido (`/content`): NO llevan
 * `status` ni `publish_at`. La publicación —estado y fecha— se controla **sólo**
 * por las transiciones del flujo editorial y por `POST /:id/schedule`. Un cliente
 * viejo que mande esos campos recibe un 400 explícito (ver `rechazarCamposDeEstado`).
 */
const pageMetaSchema = z.object({
  slug: z.string().trim().min(1).max(191).regex(/^[a-z0-9-]+$/).optional(),
  title: z.string().trim().min(1).max(255).optional(),
  seo: seoSchema.optional(),
  order: z.number().int().optional(),
});

/**
 * Rechaza, con un 400 claro, cualquier intento de cambiar la publicación por la
 * puerta de la edición. `status` y `publish_at` sólo se tocan por las
 * transiciones / `schedule`; aceptarlos acá era el agujero que este bloqueante
 * cierra (una edición podía publicar o despublicar sin pasar por el flujo).
 * Devuelve `true` si ya respondió.
 */
function rechazarCamposDeEstado(req: Request, res: Response): boolean {
  const b = req.body as Record<string, unknown> | null | undefined;
  if (b && typeof b === "object" && ("status" in b || "publish_at" in b)) {
    res.status(400).json({
      error:
        "El estado y la fecha de publicación se cambian con las acciones del flujo editorial (enviar, aprobar, publicar, despublicar, archivar) y con “programar”, no editando la página.",
    });
    return true;
  }
  return false;
}

pagesRouter.post("/", async (req, res) => {
  const parsed = pageCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido", issues: parsed.error.issues });
  const p = parsed.data;
  if (p.status === "published" && !puedePublicar(req)) return res.status(403).json({ error: "forbidden" });

  const [id] = await db("pages").insert({
    slug: p.slug,
    title: p.title,
    status: p.status ?? "draft",
    seo: p.seo ? JSON.stringify(p.seo) : null,
    order: p.order ?? 0,
    publish_at: null,
  });
  await registrarAccion({ ...actorDe(req), action: "create", resourceType: "pages", resourceId: id, meta: { slug: p.slug } });
  res.status(201).json({ id });
});

/**
 * Construye el patch de metadatos desde un payload parcial (sólo edición: título,
 * slug, SEO y orden). `status` y `publish_at` NO se tocan por acá —los gobiernan
 * las transiciones y `schedule`—, por eso no aparecen.
 */
function construirMetaPatch(p: {
  title?: string;
  slug?: string;
  seo?: unknown;
  order?: number;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (p.title !== undefined) patch.title = p.title;
  if (p.slug !== undefined) patch.slug = p.slug;
  if (p.order !== undefined) patch.order = p.order;
  if (p.seo !== undefined) patch.seo = p.seo ? JSON.stringify(p.seo) : null;
  return patch;
}

pagesRouter.put("/:id", async (req, res) => {
  if (rechazarCamposDeEstado(req, res)) return;
  const parsed = pageMetaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido", issues: parsed.error.issues });
  const patch = construirMetaPatch(parsed.data);
  patch.updated_at = db.fn.now();
  // La papelera es intocable desde la edición: `whereNull(deleted_at)`.
  const n = await db("pages").where({ id: req.params.id }).whereNull("deleted_at").update(patch);
  if (n === 0) return res.status(404).json({ error: "no encontrada" });
  // Editar metadatos no cambia la publicación: siempre es `update`.
  await registrarAccion({ ...actorDe(req), action: "update", resourceType: "pages", resourceId: req.params.id });
  res.json({ ok: true });
});

const scheduleSchema = z.object({ publish_at: z.string() });

/**
 * Estados desde los que se puede programar. Programar es publicar con fecha
 * futura, así que sale de los mismos estados que la transición `publish`
 * (revisado y listo) más `published` (reprogramar una página ya publicada).
 * Desde `draft` o `archived` da 409: hay que pasar antes por el flujo.
 */
const SCHEDULE_DESDE = ["in_review", "approved", "published"];

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
 * Atómico y serializado: se bloquea la fila con `FOR UPDATE`, se decide sobre el
 * estado ya bloqueado (existe / no está en la papelera / estado de origen válido)
 * y se escribe dentro de la misma transacción. Dos programaciones simultáneas no
 * se pisan. "Publicar ya" es la transición `publish` (limpia `publish_at`); acá
 * una fecha pasada se rechaza.
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
  if (!puedePublicar(req)) return res.status(403).json({ error: "forbidden" });
  const id = Number(req.params.id);
  const resultado = await db.transaction<ResultadoEstado>(async (trx) => {
    const page = await trx("pages").where({ id }).forUpdate().first();
    if (!page || page.deleted_at != null) return { http: 404, body: { error: "no encontrada" } };
    if (!SCHEDULE_DESDE.includes(page.status)) {
      return { http: 409, body: { error: `no se puede programar desde el estado "${page.status}"` } };
    }
    await trx("pages").where({ id }).update({ status: "published", publish_at: instante, updated_at: trx.fn.now() });
    return { desde: page.status as string };
  });
  if ("http" in resultado) return res.status(resultado.http).json(resultado.body);
  await registrarAccion({
    ...actorDe(req),
    action: "schedule",
    resourceType: "pages",
    resourceId: id,
    meta: { from: resultado.desde, to: "published" },
  });
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
  seo: seoSchema.optional(),
  blocks: z.array(z.object({ type: z.string(), props: z.unknown() })).max(80),
});

/**
 * Guardado atómico completo de la página: metadatos + bloques en **una sola
 * operación**. Es lo que usa el Page Builder, para no partir el guardado en dos
 * llamadas (metadatos por un lado, bloques por otro) que dejaban fotos
 * intermedias inconsistentes y estado a medias si la segunda fallaba.
 *
 * **No cambia la publicación.** No acepta `status` ni `publish_at`: guardar el
 * contenido nunca publica, despublica ni reprograma —eso es del flujo editorial y
 * de `schedule`—. Un cliente viejo que los mande recibe 400 (`rechazarCamposDeEstado`).
 *
 * Orden dentro de la transacción: cargar la fila viva (404 si no está o está en
 * la papelera) → **archivar el estado anterior** → aplicar metadatos → reemplazar
 * bloques. Si algo falla, la transacción revierte entera: nunca quedan metadatos
 * actualizados con bloques a medias.
 */
pagesRouter.put("/:id/content", async (req, res) => {
  if (rechazarCamposDeEstado(req, res)) return;
  const pageId = Number(req.params.id);
  const parsed = contentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido", issues: parsed.error.issues });

  const bloques = validarBloques(parsed.data.blocks);
  if (!bloques.ok) return res.status(400).json({ error: "bloque invalido", block: bloques.invalido });

  const metaPatch = construirMetaPatch(parsed.data);

  await db.transaction(async (trx) => {
    await cargarPaginaViva(trx, pageId);
    await archivarActual(trx, pageId, req.user?.id);
    await trx("pages")
      .where({ id: pageId })
      .update({ ...metaPatch, updated_at: trx.fn.now() });
    await reemplazarBloques(trx, pageId, bloques.validados);
  });
  // Guardar contenido no cambia la publicación: siempre es `update`.
  await registrarAccion({ ...actorDe(req), action: "update", resourceType: "pages", resourceId: pageId });
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
  // Reemplazar bloques no cambia el estado de publicación: siempre es una edición.
  await registrarAccion({ ...actorDe(req), action: "update", resourceType: "pages", resourceId: pageId });
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
 * Esquema estricto del snapshot que se restaura.
 *
 * Restaurar escribe en la página: la foto tiene que tener forma conocida antes de
 * aplicarse. Un snapshot ilegible o con forma inesperada (fila editada a mano,
 * versión de un esquema viejo) se rechaza con 422 en vez de volcar basura. Se
 * exige `title` y `blocks` (arreglo de `{type, props}`); `status`, `slug` y
 * `publish_at` se aceptan pero **no se aplican** (ver abajo).
 */
const revisionSnapshotSchema = z.object({
  title: z.string().min(1),
  slug: z.string().optional(),
  status: z.string().optional(),
  seo: seoSchema.nullable().optional(),
  publish_at: z.string().nullable().optional(),
  blocks: z.array(z.object({ type: z.string(), props: z.unknown() })),
});

/**
 * Restaura una versión: aplica su **contenido** —título, SEO y bloques— como
 * estado actual. **Archiva primero el estado actual**, de modo que restaurar
 * también se pueda deshacer (queda como una versión más). Atómico y con guarda
 * de papelera.
 *
 * Lo que restaurar NO toca, a propósito:
 * - `slug`: es la identidad y la URL; cambiarlo al volver a una versión vieja
 *   rompería enlaces y podría chocar con otra página.
 * - `status` y `publish_at`: la publicación se cambia **sólo** por las transiciones
 *   del flujo editorial y por `schedule`. Restaurar un contenido viejo no publica,
 *   despublica ni reprograma una página viva por la ventana trasera; la página
 *   conserva el estado y la fecha que tenía. Por eso restaurar sólo pide
 *   `content.write` (ya exigido por el montaje), no `content.publish`.
 */
pagesRouter.post("/:id/revisions/:revId/restore", async (req, res) => {
  const pageId = Number(req.params.id);
  const revId = Number(req.params.revId);
  const rev = await db("page_revisions").where({ id: revId, page_id: pageId }).first();
  if (!rev) return res.status(404).json({ error: "versión no encontrada" });

  const parsedSnap = revisionSnapshotSchema.safeParse(parseJson(rev.snapshot));
  if (!parsedSnap.success) return res.status(422).json({ error: "versión ilegible o incompatible" });
  const snap = parsedSnap.data;

  const bloques = validarBloques(snap.blocks.map((b) => ({ type: b.type, props: b.props ?? {} })));
  // Una versión archivada ya pasó por validación al guardarse; si aun así trae
  // un bloque ilegible (fila editada a mano), se rechaza en vez de escribir basura.
  if (!bloques.ok) return res.status(422).json({ error: "versión con un bloque ilegible" });

  await db.transaction(async (trx) => {
    // Bloquea la fila y confirma que sigue viva (404 si no está o está en la
    // papelera). Primero se archiva lo que hay ahora: así deshacer la restauración
    // es volver a esta versión recién creada.
    await cargarPaginaViva(trx, pageId);
    await archivarActual(trx, pageId, req.user?.id);
    await trx("pages")
      .where({ id: pageId })
      .update({
        title: snap.title,
        seo: snap.seo ? JSON.stringify(snap.seo) : null,
        updated_at: trx.fn.now(),
      });
    await reemplazarBloques(trx, pageId, bloques.validados);
  });
  await registrarAccion({ ...actorDe(req), action: "restore_revision", resourceType: "pages", resourceId: pageId, meta: { revId } });
  res.json({ ok: true });
});

// ---------------------------------------------------- flujo editorial (estados)

/**
 * Máquina de estados del flujo editorial: `draft → in_review → approved →
 * published → archived`. Cada transición declara desde qué estados es válida, a
 * cuál lleva, si exige `content.publish` (además de la `content.write` que ya
 * pide el montaje del router para los `POST`) y qué acción de bitácora deja.
 *
 * - `submit`/`return` sólo exigen `content.write`: un `autor` manda su propio
 *   borrador a revisión o lo retira; no publica.
 * - `approve`/`publish`/`unpublish`/`archive`/`unarchive` exigen `content.publish`
 *   (revisor/editor). `publish` limpia `publish_at` —publicar es "en vivo ahora";
 *   agendar es `POST /:id/schedule`—. `unpublish` es la vía **explícita** para
 *   retirar del público una página publicada (vuelve a `draft`, limpia `publish_at`).
 *
 * **Las transiciones son la ÚNICA forma de cambiar el estado.** La edición
 * (`PUT /:id`, `/content`) y el guardado del Page Builder no tocan `status` ni
 * `publish_at`; sólo estas transiciones y `schedule` lo hacen. La visibilidad
 * pública no cambia: sólo `published` es público (`pages-visibilidad.ts`);
 * `in_review`/`approved`/`archived` no se sirven, igual que un borrador. Los
 * estados intermedios y el archivado son ortogonales a la papelera (`deleted_at`).
 */
interface Transicion {
  desde: string[];
  hasta: string;
  requierePublicar: boolean;
  accion: AuditAction;
  extra?: Record<string, unknown>;
}

const TRANSICIONES: Record<string, Transicion> = {
  submit: { desde: ["draft"], hasta: "in_review", requierePublicar: false, accion: "submit_review" },
  approve: { desde: ["in_review"], hasta: "approved", requierePublicar: true, accion: "approve" },
  publish: { desde: ["approved", "in_review", "published"], hasta: "published", requierePublicar: true, accion: "publish", extra: { publish_at: null } },
  return: { desde: ["in_review", "approved"], hasta: "draft", requierePublicar: false, accion: "return_draft" },
  unpublish: { desde: ["published"], hasta: "draft", requierePublicar: true, accion: "unpublish", extra: { publish_at: null } },
  archive: { desde: ["published", "approved"], hasta: "archived", requierePublicar: true, accion: "archive" },
  unarchive: { desde: ["archived"], hasta: "draft", requierePublicar: true, accion: "unarchive" },
};

/**
 * Aplica una transición sobre la fila **bloqueada con `FOR UPDATE`**.
 *
 * La capacidad (`content.publish`) es del rol, no de la fila, así que se comprueba
 * **antes** de tomar el lock: un rol sin permiso recibe 403 sin revelar si la
 * página existe ni bloquear nada. Lo que **sí** depende de la fila —que exista y no
 * esté en la papelera (404) y que el estado de origen sea válido (409)— se decide
 * dentro de la transacción, sobre la fila ya bloqueada, y recién ahí se escribe.
 * Bloquear primero serializa dos transiciones simultáneas sobre la misma página: la
 * segunda espera a que la primera confirme, ve el estado nuevo y su origen ya no
 * coincide (409). Sin el lock, dos revisores podían leer el mismo estado y aplicar
 * dos transiciones sobre él. La bitácora registra el `from`/`to` leído bajo el lock.
 */
async function aplicarTransicion(req: Request, res: Response, nombre: keyof typeof TRANSICIONES) {
  const t = TRANSICIONES[nombre];
  if (t.requierePublicar && !puedePublicar(req)) return res.status(403).json({ error: "forbidden" });
  const id = Number(req.params.id);
  const resultado = await db.transaction<ResultadoEstado>(async (trx) => {
    const page = await trx("pages").where({ id }).forUpdate().first();
    if (!page || page.deleted_at != null) return { http: 404, body: { error: "no encontrada" } };
    if (!t.desde.includes(page.status)) {
      return { http: 409, body: { error: `no se puede "${nombre}" desde el estado "${page.status}"` } };
    }
    await trx("pages")
      .where({ id })
      .update({ status: t.hasta, updated_at: trx.fn.now(), ...(t.extra ?? {}) });
    return { desde: page.status as string };
  });
  if ("http" in resultado) return res.status(resultado.http).json(resultado.body);
  await registrarAccion({
    ...actorDe(req),
    action: t.accion,
    resourceType: "pages",
    resourceId: id,
    meta: { from: resultado.desde, to: t.hasta },
  });
  res.json({ ok: true, status: t.hasta });
}

pagesRouter.post("/:id/submit", (req, res) => aplicarTransicion(req, res, "submit"));
pagesRouter.post("/:id/approve", (req, res) => aplicarTransicion(req, res, "approve"));
pagesRouter.post("/:id/publish", (req, res) => aplicarTransicion(req, res, "publish"));
pagesRouter.post("/:id/return", (req, res) => aplicarTransicion(req, res, "return"));
pagesRouter.post("/:id/unpublish", (req, res) => aplicarTransicion(req, res, "unpublish"));
pagesRouter.post("/:id/archive", (req, res) => aplicarTransicion(req, res, "archive"));
pagesRouter.post("/:id/unarchive", (req, res) => aplicarTransicion(req, res, "unarchive"));

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
