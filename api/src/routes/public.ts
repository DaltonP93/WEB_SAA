import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { sanitizeHtml, stripHtml, sanitizeMapEmbed, safeLinkHref } from "../html.js";
import { rateLimit } from "../rate-limit.js";
import { captchaPublicConfig, verifyCaptcha } from "../captcha.js";
import { badRequest, notFound } from "../http.js";

export const publicRouter = Router();

/**
 * Formularios públicos: límite por IP + payload acotado. Los valores se
 * pueden ajustar por entorno sin tocar código.
 */
const formsLimiter = rateLimit({
  windowMs: Number(process.env.PUBLIC_FORMS_RATE_WINDOW_MS ?? 15 * 60 * 1000),
  max: Number(process.env.PUBLIC_FORMS_RATE_MAX ?? 10),
  message: "Recibimos varios envíos desde esta conexión. Esperá unos minutos e intentá de nuevo.",
});

/** Campo trampa: los bots completan todo, las personas no lo ven. */
function isHoneypotFilled(body: unknown): boolean {
  const value = (body as { website?: unknown } | null)?.website;
  return typeof value === "string" && value.trim().length > 0;
}

/** Texto plano: sin HTML, recortado y con longitud acotada. */
const plainText = (max: number) =>
  z.string().transform((value) => stripHtml(value).slice(0, max));

/**
 * Ajustes públicos.
 *
 * Se devuelven sólo las claves que el sitio usa. La tabla `settings` guarda
 * además cosas internas —los snapshots que dejan las migraciones para poder
 * revertirse, por ejemplo—, y devolver la tabla entera las publicaba junto con
 * el resto. Los teléfonos, correos y horarios ya no están acá: viven en
 * `/public/contact-channels` y `/public/schedules`.
 */
const PUBLIC_SETTING_KEYS = ["brand", "theme", "contact", "seo"];

publicRouter.get("/settings", async (_req, res) => {
  const rows = await db("settings").whereIn("key", PUBLIC_SETTING_KEYS).select("key", "value");
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = r.value;
  // No sale de la base: es configuración del entorno. Sólo el proveedor y la
  // site key —la clave secreta nunca se envía—. `null` = sin verificación, y
  // el front no dibuja ningún widget.
  out.captcha = captchaPublicConfig();
  res.json(out);
});

publicRouter.get("/menus", async (_req, res) => {
  const rows = await db("menus").select("location", "items");
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.location] = r.items;
  res.json(out);
});

publicRouter.get("/pages", async (_req, res) => {
  const rows = await db("pages").where({ status: "published" }).orderBy("order").select("id", "slug", "title");
  res.json(rows);
});

publicRouter.get("/pages/:slug", async (req, res) => {
  const page = await db("pages").where({ slug: req.params.slug, status: "published" }).first();
  if (!page) throw notFound("página no encontrada");
  const blocks = await db("blocks").where({ page_id: page.id }).orderBy("order");
  const visibleBlocks = blocks.filter((block) => shouldExposePublicBlock(page.slug, block));
  res.json({
    ...page,
    seo: page.seo,
    blocks: visibleBlocks.map((b, order) => ({
      id: b.id,
      type: b.type,
      order,
      props: sanitizeBlockProps(b.props),
    })),
  });
});

publicRouter.get("/specialties", async (_req, res) => {
  const rows = await db("specialties").orderBy("order").orderBy("name");
  res.json(rows);
});

publicRouter.get("/specialties/:slug", async (req, res) => {
  const sp = await db("specialties").where({ slug: req.params.slug }).first();
  if (!sp) throw notFound("especialidad no encontrada");
  const rows = await db("doctors as d")
    .join("doctor_specialty as ds", "ds.doctor_id", "d.id")
    .where("ds.specialty_id", sp.id)
    .orderByRaw("COALESCE(d.`order`, 9999) ASC")
    .orderByRaw("LOWER(SUBSTRING_INDEX(d.name, ' ', -1)) ASC")
    .orderBy("d.name")
    .select("d.id", "d.slug", "d.name", "d.photo_url");
  const doctors = rows.map((d) => ({ id: d.id, slug: d.slug, name: d.name, photoUrl: d.photo_url }));
  res.json({ ...sp, doctors });
});

publicRouter.get("/doctors", async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const specialty = req.query.specialty as string | undefined;
  // Orden por apellido: tomamos el último token del nombre (Dr./Dra. quedan al inicio).
  // Fallback al campo `order` para empujar destacados arriba.
  let qb = db("doctors as d")
    .select("d.id", "d.slug", "d.name", "d.photo_url")
    .orderByRaw("LOWER(SUBSTRING_INDEX(d.name, ' ', -1)) ASC")
    .orderBy("d.name");
  if (q) qb = qb.where("d.name", "like", `%${q}%`);
  if (specialty) {
    qb = qb
      .join("doctor_specialty as ds", "ds.doctor_id", "d.id")
      .join("specialties as s", "s.id", "ds.specialty_id")
      .where("s.slug", specialty);
  }
  const rows = await qb;
  // adjuntar especialidades en batch
  const linksMap = new Map<number, any[]>();
  if (rows.length) {
    const ids = rows.map((d) => d.id);
    const links = await db("doctor_specialty as ds")
      .join("specialties as s", "s.id", "ds.specialty_id")
      .whereIn("ds.doctor_id", ids)
      .select("ds.doctor_id", "s.id", "s.slug", "s.name");
    for (const l of links) {
      const arr = linksMap.get(l.doctor_id) ?? [];
      arr.push({ id: l.id, slug: l.slug, name: l.name });
      linksMap.set(l.doctor_id, arr);
    }
  }
  // Devolver camelCase para consistencia con el frontend
  const doctors = rows.map((d) => ({
    id: d.id,
    slug: d.slug,
    name: d.name,
    photoUrl: d.photo_url,
    specialties: linksMap.get(d.id) ?? [],
  }));
  res.json(doctors);
});

publicRouter.get("/doctors/:slug", async (req, res) => {
  const d = await db("doctors").where({ slug: req.params.slug }).first();
  if (!d) throw notFound("médico no encontrado");
  const specialties = await db("doctor_specialty as ds")
    .join("specialties as s", "s.id", "ds.specialty_id")
    .where("ds.doctor_id", d.id)
    .select("s.id", "s.slug", "s.name");
  res.json({
    id: d.id,
    slug: d.slug,
    name: d.name,
    photoUrl: d.photo_url,
    bio: sanitizeHtml(d.bio),
    schedule: d.schedule,
    specialties,
  });
});

/**
 * Canales de contacto activos. Fuente única para header, footer, bloques de
 * contacto y turnos. Los que no tienen valor cargado igual se devuelven: la UI
 * los muestra como "A confirmar" en vez de generar un enlace inválido.
 */
publicRouter.get("/contact-channels", async (_req, res) => {
  const rows = await db("contact_channels")
    .where({ active: true })
    .orderBy("order")
    .orderBy("id")
    .select("id", "key", "label", "kind", "value", "note", "message", "href", "icon", "order");
  res.json(
    rows.map((r) => ({
      ...r,
      value: r.value?.trim() ? r.value.trim() : null,
    })),
  );
});

/**
 * Horarios publicados. Sólo los que el sanatorio marcó como activos y con
 * horario cargado: mientras no haya ninguno, el sitio avisa que están en
 * confirmación en vez de mostrar horas inventadas.
 */
publicRouter.get("/schedules", async (_req, res) => {
  const rows = await db("schedules")
    .where({ active: true })
    .orderBy("order")
    .orderBy("id")
    .select("id", "key", "area", "service_slug", "days", "hours", "note", "order");
  res.json(
    rows
      .filter((r) => r.hours?.trim())
      .map((r) => ({ ...r, serviceSlug: r.service_slug ?? null })),
  );
});

publicRouter.get("/services", async (_req, res) => {
  res.json(await db("services").orderBy("order"));
});
/**
 * Sólo los estudios que el sanatorio marcó como publicados: el catálogo puede
 * estar cargado sin afirmar todavía que la prestación existe.
 */
publicRouter.get("/studies", async (_req, res) => {
  res.json(await db("studies").where({ published: true }).orderBy("order"));
});
/**
 * Noticias quedó fuera del producto (item 7 de la minuta): no hay endpoints
 * públicos para listarlas ni consultarlas. La tabla se conserva como archivo
 * histórico, pero no hay ninguna vía pública para publicar su contenido.
 */

const appointmentSchema = z.object({
  name: plainText(160).pipe(z.string().min(2, "nombre demasiado corto")),
  phone: plainText(40).pipe(z.string().min(4, "teléfono inválido")),
  email: z.string().trim().max(190).email(),
  specialtyId: z.number().int().positive().optional(),
  doctorId: z.number().int().positive().optional(),
  preferredAt: z.string().trim().max(40).optional(),
  message: plainText(2000).optional(),
  captchaToken: z.string().max(4000).optional(),
  // Honeypot: si viene con contenido, es spam.
  website: z.string().max(200).optional(),
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

/**
 * Tipos de bloque retirados del producto. Aunque queden filas viejas en la
 * base, no se sirven: así Noticias no puede reaparecer por datos históricos.
 */
const RETIRED_BLOCK_TYPES = new Set(["newsGrid"]);

function shouldExposePublicBlock(pageSlug: string, block: { type: string; props: unknown }) {
  if (RETIRED_BLOCK_TYPES.has(block.type)) return false;
  if (block.type !== "cta") return true;
  // CTAs con acciones directas (tel:, mailto:, WhatsApp, Google Maps) siempre se muestran.
  const props = parseJson(block.props) as { ctaHref?: unknown } | null;
  const href = props?.ctaHref;
  if (typeof href === "string") {
    if (/^(tel:|mailto:)/i.test(href)) return true;
    if (/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(href)) return true;
    if (/^https?:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(href)) return true;
  }
  // CTAs internos genéricos: solo se muestran en el home y si el título habla de emergencias.
  if (pageSlug !== "home") return false;
  return blockTitleIncludes(block.props, "emergencia");
}

function blockTitleIncludes(props: unknown, needle: string) {
  const parsed = parseJson(props);
  if (!parsed || typeof parsed !== "object" || !("title" in parsed)) return false;
  const title = (parsed as { title?: unknown }).title;
  return typeof title === "string" && normalizeText(title).includes(needle);
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
publicRouter.post("/appointments", formsLimiter, async (req, res) => {
  if (isHoneypotFilled(req.body)) {
    // Respondemos 201 para no darle información útil al bot.
    console.warn("[spam] honeypot activado en /appointments");
    return res.status(201).json({ id: null });
  }
  const parsed = appointmentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("payload invalido", parsed.error.flatten().fieldErrors);
  }
  if (!(await verifyCaptcha(parsed.data.captchaToken, req.ip))) {
    throw badRequest("verificación anti-spam fallida");
  }
  const d = parsed.data;
  const [id] = await db("appointments").insert({
    name: d.name,
    phone: d.phone,
    email: d.email,
    specialty_id: d.specialtyId ?? null,
    doctor_id: d.doctorId ?? null,
    preferred_at: d.preferredAt ?? null,
    message: d.message ?? null,
  });
  res.status(201).json({ id });
});

const contactSchema = z.object({
  name: plainText(160).pipe(z.string().min(2, "nombre demasiado corto")),
  email: z.string().trim().max(190).email(),
  phone: plainText(40).optional(),
  message: plainText(4000).pipe(z.string().min(5, "mensaje demasiado corto")),
  captchaToken: z.string().max(4000).optional(),
  website: z.string().max(200).optional(),
});
publicRouter.post("/contact-messages", formsLimiter, async (req, res) => {
  if (isHoneypotFilled(req.body)) {
    console.warn("[spam] honeypot activado en /contact-messages");
    return res.status(201).json({ id: null });
  }
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("payload invalido", parsed.error.flatten().fieldErrors);
  }
  if (!(await verifyCaptcha(parsed.data.captchaToken, req.ip))) {
    throw badRequest("verificación anti-spam fallida");
  }
  const d = parsed.data;
  const [id] = await db("contact_messages").insert({
    name: d.name,
    email: d.email,
    phone: d.phone ?? null,
    message: d.message,
  });
  res.status(201).json({ id });
});
