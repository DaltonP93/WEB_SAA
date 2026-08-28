import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { sanitizeHtml, stripHtml, mapEmbedUrl, safeLinkHref } from "../html.js";
import { rateLimit } from "../rate-limit.js";
import { captchaPublicConfig, verifyCaptcha } from "../captcha.js";
import { publicChannelValues } from "../contact-values.js";
import { isEmergencyCta } from "../institutional-red.js";
import { HttpError, badRequest, conflict, notFound } from "../http.js";
import { instanteDesdeHoraLocal } from "../timezone.js";
import { normalizarSeo } from "../seo.js";
import { redirectsActivos } from "../redirects.js";
import { filtrarPaginaPublica } from "../pages-visibilidad.js";
import { ANALITICA_VACIA, sanearAtribucion, validarAnalitica } from "../marketing.js";
import { CONSENT_VERSION, nuevoTokenBaja } from "../newsletter.js";

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
const PUBLIC_SETTING_KEYS = ["brand", "theme", "contact", "seo", "analytics"];

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

/**
 * `analytics` se normaliza al salir.
 *
 * Los IDs de medición son públicos por naturaleza —terminan en el navegador de
 * cualquiera que abra el sitio—, así que exponerlos no filtra nada. Pero una
 * fila editada a mano podría traer un valor con forma inválida, y el front lo
 * interpolaría en la URL de un script. Se devuelve siempre la forma validada:
 * los tres IDs, cada uno con formato correcto o vacío.
 */
function publicAnalytics(value: unknown): unknown {
  const raw = typeof value === "string" ? safeParse(value) : value;
  const r = validarAnalitica(raw);
  return r.ok ? r.value : ANALITICA_VACIA;
}

publicRouter.get("/settings", async (_req, res) => {
  const rows = await db("settings").whereIn("key", PUBLIC_SETTING_KEYS).select("key", "value");
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    out[r.key] =
      r.key === "contact"
        ? publicContact(r.value)
        : r.key === "analytics"
          ? publicAnalytics(r.value)
          : r.key === "seo"
            ? normalizarSeo(r.value)
            : r.value;
  }
  // Si nunca se configuró, la clave no existe en la base: el front igual espera
  // los tres campos, así que se completa con la forma vacía (medición apagada).
  if (!("analytics" in out)) out.analytics = ANALITICA_VACIA;
  // No sale de la base: es configuración del entorno. Sólo el proveedor y la
  // site key —la clave secreta nunca se envía—. `null` = sin verificación, y
  // el front no dibuja ningún widget.
  out.captcha = captchaPublicConfig();
  res.json(out);
});

/**
 * Los redirects 301 activos, para que el front (SPA) también redirija del lado
 * del cliente las rutas que administra el panel —no sólo las cuatro legacy—.
 * Sale de la misma caché en memoria que usa el middleware, así que refleja el
 * último cambio sin consultar la base en cada request. `to` ya viene validado
 * como ruta interna.
 */
publicRouter.get("/redirects", (_req, res) => {
  res.json(redirectsActivos());
});

publicRouter.get("/menus", async (_req, res) => {
  const rows = await db("menus").select("location", "items");
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.location] = r.items;
  res.json(out);
});

publicRouter.get("/pages", async (_req, res) => {
  const rows = await filtrarPaginaPublica(db("pages"), db)
    .orderBy("order")
    .select("id", "slug", "title");
  res.json(rows);
});

publicRouter.get("/pages/:slug", async (req, res) => {
  const page = await filtrarPaginaPublica(db("pages").where({ slug: req.params.slug }), db).first();
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
  /**
   * De dónde vino esta conversión (utm_*, gclid, fbclid, landing, referrer).
   *
   * Se acepta cualquier objeto y se **sanea** después con `sanearAtribucion`:
   * la validación es una allowlist de claves, no un esquema rígido, porque el
   * conjunto de parámetros de campaña no es fijo. Opcional: la mayoría de las
   * conversiones no traen ninguno.
   */
  attribution: z.record(z.string(), z.unknown()).optional(),
  // Honeypot: si viene con contenido, es spam.
  website: z.string().max(200).optional(),
});

/**
 * Momento preferido, interpretado en la zona del sanatorio.
 *
 * `<input type="datetime-local">` manda una hora de pared sin offset, y
 * `new Date(valor)` la resolvía con la zona del proceso: un VPS en UTC
 * guardaba las 10:30 UTC para quien eligió las 10:30 de Asunción. La hora que
 * quedaba almacenada dependía de cómo estuviera configurada la máquina, y no
 * fallaba en ningún lado — sólo quedaba mal.
 */
const parsePreferredAt = (value: string | undefined) => instanteDesdeHoraLocal(value);

/**
 * El contenido de una solicitud, normalizado para poder compararlo.
 *
 * Es lo que decide si un reenvío con la misma clave es *el mismo* pedido o uno
 * distinto. No entra nada que cambie entre intentos legítimos —el token del
 * CAPTCHA es de un solo uso, el honeypot es del formulario y las marcas de
 * tiempo son del servidor—: incluirlos haría que todo reintento pareciera un
 * pedido diferente y el 409 saltaría siempre.
 */
interface Contenido {
  name: string;
  phone: string;
  email: string;
  specialtyId: number | null;
  doctorId: number | null;
  preferredAt: number | null;
  message: string | null;
}

const contenidoDelPayload = (d: {
  name: string;
  phone: string;
  email: string;
  specialtyId?: number;
  doctorId?: number;
  message?: string;
}, preferido: Date | null): Contenido => ({
  name: d.name,
  phone: d.phone,
  email: d.email,
  specialtyId: d.specialtyId ?? null,
  doctorId: d.doctorId ?? null,
  preferredAt: preferido ? preferido.getTime() : null,
  message: d.message ?? null,
});

const contenidoDeLaFila = (f: Record<string, unknown>): Contenido => ({
  name: String(f.name ?? ""),
  phone: String(f.phone ?? ""),
  email: String(f.email ?? ""),
  specialtyId: f.specialty_id === null || f.specialty_id === undefined ? null : Number(f.specialty_id),
  doctorId: f.doctor_id === null || f.doctor_id === undefined ? null : Number(f.doctor_id),
  preferredAt: f.preferred_at ? new Date(f.preferred_at as string).getTime() : null,
  message: f.message === null || f.message === undefined || f.message === "" ? null : String(f.message),
});

const mismoContenido = (a: Contenido, b: Contenido): boolean =>
  (Object.keys(a) as (keyof Contenido)[]).every((k) => a[k] === b[k]);

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
  // El orden de este handler es el contrato, no una preferencia de estilo.
  //
  // 1. honeypot (y el rate limit, que es el middleware de arriba);
  // 2. forma del payload;
  // 3. normalización de la fecha;
  // 4. búsqueda de la clave de envío;
  // 5. si ya existe con el mismo contenido → se devuelve, sin CAPTCHA;
  // 6. si existe con otro contenido → 409, sin tocar la fila;
  // 7. clave nueva → referencias y CAPTCHA;
  // 8. insertar;
  // 9. en la carrera del índice único, comparar de nuevo antes de responder.
  //
  // El CAPTCHA estaba en el paso 2 y ahí rompía el reintento: el token es de
  // un solo uso, así que quien reenviaba tras una respuesta perdida traía uno
  // ya consumido y recibía 400 sobre una solicitud que **ya estaba guardada**.
  // Verificarlo después de resolver la idempotencia no abre ninguna puerta:
  // una clave que todavía no existe sigue exigiendo CAPTCHA válido, y una que
  // ya existe no crea nada.
  if (isHoneypotFilled(req.body)) {
    // Respondemos 201 para no darle información útil al bot.
    console.warn("[spam] honeypot activado en /appointments");
    return res.status(201).json({ id: null });
  }
  const parsed = appointmentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("payload invalido", parsed.error.flatten().fieldErrors);
  }
  const d = parsed.data;

  const preferido = parsePreferredAt(d.preferredAt);
  if (preferido === undefined) throw badRequest("payload invalido", { preferredAt: ["fecha inválida"] });

  const contenido = contenidoDelPayload(d, preferido);

  /**
   * Resuelve una clave que ya existe: o es el mismo pedido, o es un conflicto.
   *
   * Devolver éxito sin comparar sería peor que duplicar: el cliente recibiría
   * el id de una solicitud **distinta** y creería que la suya se registró.
   */
  const resolverExistente = (fila: Record<string, unknown> | undefined) => {
    if (!fila) return null;
    if (!mismoContenido(contenido, contenidoDeLaFila(fila))) {
      throw conflict(
        "esa clave de envío ya se usó para una solicitud con otros datos. " +
          "Recargá el formulario para empezar una solicitud nueva.",
      );
    }
    return res.status(200).json({ id: fila.id, duplicate: true });
  };

  const yaEstaba = await db("appointments").where({ submission_key: d.submissionKey }).first();
  const respuestaPrevia = resolverExistente(yaEstaba);
  if (respuestaPrevia) return respuestaPrevia;

  const problema = await validarReferencias(d.doctorId, d.specialtyId);
  if (problema) throw badRequest(problema);

  if (!(await verifyCaptcha(d.captchaToken, req.ip))) {
    throw badRequest("verificación anti-spam fallida");
  }

  // La atribución se sanea y se guarda como JSON (o NULL). No es dato personal
  // —es de dónde vino el clic, no quién lo dio—, pero como todo lo demás de la
  // fila, no va a los logs: el `catch` de abajo sólo conserva el código del
  // motor, nunca el cuerpo.
  const atribucion = sanearAtribucion(d.attribution);

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
    attribution: atribucion ? JSON.stringify(atribucion) : null,
  };

  try {
    const [id] = await db("appointments").insert(fila);
    return res.status(201).json({ id });
  } catch (err) {
    // Dos peticiones simultáneas pasan las dos por la búsqueda de arriba y las
    // dos insertan. El índice único deja pasar una sola; la que pierde
    // encuentra acá la fila de la que ganó — y la compara igual, porque una
    // carrera entre payloads distintos también es un conflicto.
    if (esClaveRepetida(err)) {
      const ganadora = await db("appointments").where({ submission_key: d.submissionKey }).first();
      const respuesta = resolverExistente(ganadora);
      if (respuesta) return respuesta;
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

/**
 * Suscripción a novedades. Un solo campo (email) más el honeypot y el
 * rate-limit: un correo suelto no justifica un CAPTCHA, y la trampa + el límite
 * por conexión frenan el spam automatizado. Idempotente: reenviar el mismo
 * correo no crea duplicados ni revela si ya estaba (no hay enumeración); si
 * estaba dado de baja, lo reactiva.
 *
 * `source` admite una ruta completa (no se trunca a un valor chico). El
 * consentimiento lo estampa el servidor —`consent_at` y `consent_version`—: el
 * cliente no puede afirmar cuándo ni qué aceptó.
 */
const newsletterSchema = z.object({
  email: z.string().trim().max(190).email(),
  source: plainText(512).optional(),
  attribution: z.record(z.string(), z.unknown()).optional(),
  website: z.string().max(200).optional(),
});
publicRouter.post("/newsletter", formsLimiter, async (req, res) => {
  if (isHoneypotFilled(req.body)) {
    console.warn("[spam] honeypot activado en /newsletter");
    return res.status(201).json({ ok: true });
  }
  const parsed = newsletterSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("payload invalido", parsed.error.flatten().fieldErrors);
  }
  const d = parsed.data;
  const atribucion = sanearAtribucion(d.attribution);
  // Alta nueva o reactivación de una baja: en conflicto de email se actualiza
  // sólo el consentimiento y el estado, conservando la atribución original
  // (first-touch) y el token de baja ya emitido. Nunca se registra el email.
  await db("newsletter_subscribers")
    .insert({
      email: d.email,
      source: d.source ?? null,
      attribution: atribucion ? JSON.stringify(atribucion) : null,
      consent_at: db.fn.now(),
      consent_version: CONSENT_VERSION,
      active: true,
      unsubscribed_at: null,
      unsubscribe_token: nuevoTokenBaja(),
    })
    .onConflict("email")
    // Reactivar una baja: se renueva el consentimiento y se limpia la marca de
    // baja (`unsubscribed_at` vuelve a NULL). Se conserva la atribución
    // first-touch y el token ya emitido.
    .merge(["consent_at", "consent_version", "active", "unsubscribed_at"]);
  res.status(201).json({ ok: true });
});

/**
 * Baja pública por token opaco. No revela si el token existía (siempre 200):
 * quien tenga el token da de baja ese correo; quien no, no aprende nada. La
 * baja **no borra**: marca inactivo y sella `unsubscribed_at` (cuándo ocurrió),
 * conservando la evidencia. El token no se registra en logs.
 *
 * **Alcance:** el endpoint queda preparado, pero el enlace de baja se le
 * entregará a la persona recién cuando exista un proveedor de envío de correos
 * (hoy no hay dónde incluir el enlace en un email). Hasta entonces la baja se
 * opera desde el panel. No es todavía un flujo de baja plenamente operable de
 * cara al público.
 */
const bajaSchema = z.object({ token: z.string().min(10).max(200) });
publicRouter.post("/newsletter/baja", formsLimiter, async (req, res) => {
  const parsed = bajaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(200).json({ ok: true });
  }
  await db("newsletter_subscribers")
    .where({ unsubscribe_token: parsed.data.token })
    .update({ active: false, unsubscribed_at: db.fn.now() });
  res.status(200).json({ ok: true });
});

const contactSchema = z.object({
  name: plainText(160).pipe(z.string().min(2, "nombre demasiado corto")),
  email: z.string().trim().max(190).email(),
  phone: plainText(40).optional(),
  message: plainText(4000).pipe(z.string().min(5, "mensaje demasiado corto")),
  captchaToken: z.string().max(4000).optional(),
  attribution: z.record(z.string(), z.unknown()).optional(),
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
  const atribucion = sanearAtribucion(d.attribution);
  const [id] = await db("contact_messages").insert({
    name: d.name,
    email: d.email,
    phone: d.phone ?? null,
    message: d.message,
    attribution: atribucion ? JSON.stringify(atribucion) : null,
  });
  res.status(201).json({ id });
});
