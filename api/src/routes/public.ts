import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { sanitizeHtml, stripHtml, mapEmbedUrl, safeLinkHref } from "../html.js";
import { rateLimit } from "../rate-limit.js";
import { captchaPublicConfig, verifyCaptcha } from "../captcha.js";
import { publicChannelValues } from "../contact-values.js";
import { isEmergencyCta } from "../institutional-red.js";
import { HttpError, badRequest, notFound } from "../http.js";

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

/**
 * `contact` se sanea al salir, no sólo al guardarse.
 *
 * El saneo del panel no alcanza: una fila vieja —o escrita directo en la
 * base— llega tal cual a la respuesta pública. El mapa deja de viajar como
 * HTML: se publica únicamente la URL validada, y el enlace "Cómo llegar"
 * pasa por la misma validación que cualquier destino administrable.
 */
function publicContact(value: unknown): Record<string, unknown> {
  const raw = typeof value === "string" ? safeParse(value) : value;
  const contact = { ...((raw ?? {}) as Record<string, unknown>) };
  // `mapEmbed` no se publica: sólo su URL, ya validada contra Google Maps.
  const embedUrl = mapEmbedUrl(typeof contact.mapEmbed === "string" ? contact.mapEmbed : "");
  delete contact.mapEmbed;
  contact.mapEmbedUrl = embedUrl;
  contact.mapsUrl = safeLinkHref(typeof contact.mapsUrl === "string" ? contact.mapsUrl : "") ?? "";
  if (typeof contact.address === "string") contact.address = stripHtml(contact.address);
  return contact;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

publicRouter.get("/settings", async (_req, res) => {
  const rows = await db("settings").whereIn("key", PUBLIC_SETTING_KEYS).select("key", "value");
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = r.key === "contact" ? publicContact(r.value) : r.value;
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
      // `props` se parsea antes de sanear: MySQL devuelve la columna JSON ya
      // parseada pero MariaDB la devuelve como string, y sobre un string el
      // saneo no recorre nada y el HTML sale intacto.
      props: publicBlockProps(b.type, parseJson(b.props)),
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
  // Segunda capa: lo que no valide contra su `kind` no se publica. Cubre las
  // filas que se escribieron antes de que la API validara, o directo en la base.
  res.json(rows.map((r) => publicChannelValues(r)));
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
  /**
   * Aceptación explícita del uso de los datos para gestionar la solicitud.
   *
   * `literal(true)` y no `boolean()`: un `false`, un `"no"` o la ausencia del
   * campo tienen que fallar igual. Sin esto, un cliente que no dibuje la
   * casilla registraría solicitudes sin consentimiento y nada lo delataría.
   */
  consent: z.literal(true, {
    errorMap: () => ({ message: "hay que aceptar el uso de los datos para gestionar la solicitud" }),
  }),
  /**
   * Clave del intento, generada por el cliente.
   *
   * Identifica al formulario, no a la petición: el mismo formulario reenviado
   * —doble clic, reintento del navegador, respuesta perdida— trae la misma
   * clave y no puede crear una segunda solicitud.
   */
  submissionKey: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "clave de envío inválida"),
  // Honeypot: si viene con contenido, es spam.
  website: z.string().max(200).optional(),
});

/** Momento preferido: se acepta vacío, pero si viene tiene que ser una fecha. */
function parsePreferredAt(value: string | undefined): Date | null | undefined {
  if (value === undefined || value.trim() === "") return null;
  const t = new Date(value);
  return Number.isFinite(t.getTime()) ? t : undefined;
}

/**
 * Comprueba que el médico y la especialidad existan y se correspondan.
 *
 * Los dos ids llegan del cliente. Sin verificarlos, una solicitud puede quedar
 * apuntando a un médico que no existe —la FK lo rechazaría con un 500— o, peor,
 * a un médico real con una especialidad que no ejerce: eso no falla en ningún
 * lado y le llega al operador como un dato plausible y equivocado.
 */
async function validarReferencias(doctorId?: number, specialtyId?: number): Promise<string | null> {
  if (specialtyId !== undefined) {
    const especialidad = await db("specialties").where({ id: specialtyId }).first("id");
    if (!especialidad) return "la especialidad indicada no existe";
  }
  if (doctorId === undefined) return null;

  const medico = await db("doctors").where({ id: doctorId }).first("id");
  if (!medico) return "el médico indicado no existe";
  if (specialtyId === undefined) return null;

  const vinculo = await db("doctor_specialty")
    .where({ doctor_id: doctorId, specialty_id: specialtyId })
    .first();
  return vinculo ? null : "el médico indicado no atiende esa especialidad";
}

/** ¿El error es el choque contra el índice único de `submission_key`? */
function esClaveRepetida(err: unknown): boolean {
  const e = err as { code?: string; errno?: number; message?: string };
  return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
}

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
    if (key === "embedUrl") {
      // Nunca se publica lo guardado: `embedUrl` lo calcula `publicBlockProps`
      // a partir de `embedHtml`. Una fila podía traer un `embedHtml` válido y
      // un `embedUrl` con `javascript:`, y el guardado pisaba al calculado.
      continue;
    }
    if (typeof value === "string" && HTML_KEYS.has(key)) {
      out[key] = sanitizeHtml(value) ?? "";
    } else if (typeof value === "string" && key === "embedHtml") {
      // El bloque publica la URL, no el iframe: el front no inserta HTML.
      out.embedUrl = mapEmbedUrl(value);
    } else if (typeof value === "string" && LINK_KEYS.has(key)) {
      out[key] = safeLinkHref(value) ?? "";
    } else {
      out[key] = sanitizeBlockProps(value);
    }
  }
  return out;
}

/**
 * Reglas que dependen del tipo de bloque, aplicadas al salir.
 *
 * El saneo general trabaja clave por clave y no sabe qué bloque está mirando.
 * Hay dos invariantes que sí necesitan ese contexto:
 *
 * - **El rojo se recalcula.** `variant: "emergency"` guardado no alcanza: una
 *   fila vieja o escrita fuera de la API podía tener la variante roja con
 *   destino `/turnos`. Se vuelve a pedir la confirmación de `isEmergencyCta()`
 *   y, si no da, el bloque sale en `primary`.
 * - **`embedUrl` siempre se calcula.** Si no hay `embedHtml` válido, se
 *   publica vacío en vez de arrastrar lo que hubiera guardado.
 */
function publicBlockProps(type: string, props: unknown): unknown {
  const sanitized = sanitizeBlockProps(props);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return sanitized;
  const out = sanitized as Record<string, unknown>;

  if (type === "cta" && out.variant === "emergency") {
    const confirmed = isEmergencyCta({
      title: typeof out.title === "string" ? out.title : null,
      text: typeof out.text === "string" ? out.text : null,
      ctaLabel: typeof out.ctaLabel === "string" ? out.ctaLabel : null,
      ctaHref: typeof out.ctaHref === "string" ? out.ctaHref : null,
    });
    if (!confirmed) out.variant = "primary";
  }

  if (type === "mapEmbed") {
    // Se calcula sobre el valor guardado, no sobre el saneado: el saneo no
    // publica `embedHtml`, así que mirarlo ahí daría siempre vacío.
    const stored = (props as { embedHtml?: unknown } | null)?.embedHtml;
    out.embedUrl = mapEmbedUrl(typeof stored === "string" ? stored : "");
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

  const preferido = parsePreferredAt(d.preferredAt);
  if (preferido === undefined) throw badRequest("payload invalido", { preferredAt: ["fecha inválida"] });

  const problema = await validarReferencias(d.doctorId, d.specialtyId);
  if (problema) throw badRequest(problema);

  // Idempotencia, primer intento: si la clave ya está, se devuelve lo que hay.
  const existente = await db("appointments").where({ submission_key: d.submissionKey }).first("id");
  if (existente) return res.status(200).json({ id: existente.id, duplicate: true });

  const fila = {
    name: d.name,
    phone: d.phone,
    email: d.email,
    specialty_id: d.specialtyId ?? null,
    doctor_id: d.doctorId ?? null,
    preferred_at: preferido,
    message: d.message ?? null,
    submission_key: d.submissionKey,
    consent_at: new Date(),
  };

  try {
    const [id] = await db("appointments").insert(fila);
    return res.status(201).json({ id });
  } catch (err) {
    // Idempotencia, segundo intento: dos peticiones simultáneas pasan las dos
    // por el `select` de arriba y las dos insertan. El índice único deja pasar
    // una sola; la que pierde encuentra acá la fila de la que ganó.
    if (esClaveRepetida(err)) {
      const fila = await db("appointments").where({ submission_key: d.submissionKey }).first("id");
      if (fila) return res.status(200).json({ id: fila.id, duplicate: true });
    }
    // El error de mysql2 trae el SQL con los valores incrustados: nombre,
    // teléfono, correo y mensaje del paciente. Loguearlo tal cual mandaría
    // datos personales a los logs del servidor, así que se corta acá y sólo
    // se conserva el código del motor.
    const code = (err as { code?: string })?.code ?? "desconocido";
    console.error(`[appointments] no se pudo registrar la solicitud (${code})`);
    throw new HttpError(500, "no se pudo registrar la solicitud");
  }
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
