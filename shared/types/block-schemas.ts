import { z } from "zod";
import type { BlockType } from "./blocks";
import {
  EMERGENCY_VARIANT_MESSAGE,
  isEmergencyCta,
} from "./institutional-red";
import { isLucideIconName } from "./lucide-icons";
import { VIDEO_URL_MESSAGE, isAllowedVideoUrl } from "./embed-hosts";

const urlLike = z.string().trim().max(500).optional().or(z.literal(""));
const html = z.string().max(100_000);
const columns2to4 = z.union([z.literal(2), z.literal(3), z.literal(4)]);
const itemText = z.string().max(500).optional().or(z.literal(""));

/**
 * Icono dentro de un bloque: mismo criterio que en las entidades del panel.
 * Un nombre inexistente no dibuja nada y el error sólo se ve en el sitio ya
 * publicado, así que se rechaza al guardar.
 */
const blockIcon = z
  .string()
  .trim()
  .max(64)
  .refine((v) => v === "" || isLucideIconName(v), {
    message: "icono inexistente en lucide: elegí uno del selector del panel",
  })
  .optional()
  .or(z.literal(""));

/** Dos ítems de la misma grilla con el mismo icono se leen como error de carga. */
function noRepeatedIcons(
  items: { icon?: string | null }[] | undefined,
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  (items ?? []).forEach((item, index) => {
    const icon = item?.icon;
    if (!icon) return;
    if (seen.has(icon)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "icon"],
        message: `el icono "${icon}" ya se usa en esta grilla: elegí otro`,
      });
    }
    seen.add(icon);
  });
}

const cardItemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  text: itemText,
  icon: blockIcon,
  imageUrl: urlLike,
  href: urlLike,
}).strip();

/**
 * CTA: el rojo es exclusivo de Emergencias.
 *
 * `variant: "emergency"` es la única forma de pedir rojo y sólo se acepta si
 * el bloque habla de Emergencias. El override libre `background` nunca puede
 * traer un rojo, ni siquiera en un bloque de Emergencias (ahí el color lo
 * pone la variante, no el contenido cargado).
 */
const ctaSchema = z.object({
  title: z.string().trim().min(1).max(180),
  text: z.string().max(500).optional().or(z.literal("")),
  ctaLabel: z.string().trim().min(1).max(80),
  ctaHref: z.string().trim().min(1).max(500),
  variant: z.enum(["emergency", "primary", "secondary", "muted"]).optional(),
}).strip().superRefine((value, ctx) => {
  // `.strip()` descarta `background` si todavía llega de un panel viejo: el
  // color lo define la variante y no hay override libre. Perseguir "todos los
  // rojos" en CSS es una carrera perdida; no aceptar color arbitrario, no.
  if (value.variant === "emergency" && !isEmergencyCta(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["variant"], message: EMERGENCY_VARIANT_MESSAGE });
  }
});

export const blockPropsSchemas = {
  hero: z.object({
    title: z.string().trim().min(1).max(180),
    eyebrow: z.string().max(120).optional().or(z.literal("")),
    subtitle: z.string().max(500).optional().or(z.literal("")),
    imageUrl: urlLike,
    ctaLabel: z.string().max(80).optional().or(z.literal("")),
    ctaHref: urlLike,
    secondaryCtaLabel: z.string().max(80).optional().or(z.literal("")),
    secondaryCtaHref: urlLike,
    variant: z.enum(["centered", "left", "split"]).optional(),
    overlay: z.number().min(0).max(100).optional(),
    animatedBg: z.boolean().optional(),
  }).strip(),
  richText: z.object({ html }).strip(),
  cards: z.object({
    columns: columns2to4,
    heading: z.string().max(180).optional().or(z.literal("")),
    items: z.array(cardItemSchema).max(24),
  }).strip().superRefine((value, ctx) => noRepeatedIcons(value.items, ctx)),
  accordion: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    items: z.array(z.object({
      title: z.string().trim().min(1).max(180),
      body: html,
    }).strip()).max(24),
  }).strip(),
  slider: z.object({
    slides: z.array(z.object({
      imageUrl: z.string().trim().min(1).max(500),
      title: z.string().max(180).optional().or(z.literal("")),
      text: itemText,
      href: urlLike,
    }).strip()).max(20),
    autoplayMs: z.number().int().min(0).max(60_000).optional(),
  }).strip(),
  gallery: z.object({
    columns: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    images: z.array(z.object({
      url: z.string().trim().min(1).max(500),
      alt: z.string().max(180).optional().or(z.literal("")),
    }).strip()).max(60),
  }).strip(),
  doctorList: z.object({
    specialtyFilter: z.number().int().positive().optional(),
    specialtySlug: z.string().trim().max(191).optional().or(z.literal("")),
    lockSpecialty: z.boolean().optional(),
    showSearch: z.boolean().optional(),
    limit: z.number().int().positive().max(100).optional(),
    heading: z.string().max(180).optional().or(z.literal("")),
    intro: z.string().max(500).optional().or(z.literal("")),
    emptyText: z.string().max(500).optional().or(z.literal("")),
  }).strip(),
  specialtyGrid: z.object({
    columns: z.union([z.literal(3), z.literal(4), z.literal(6)]),
    showCount: z.number().int().positive().max(100).optional(),
    heading: z.string().max(180).optional().or(z.literal("")),
    compact: z.boolean().optional(),
  }).strip(),
  serviceGrid: z.object({
    columns: columns2to4,
    showCount: z.number().int().positive().max(100).optional(),
    heading: z.string().max(180).optional().or(z.literal("")),
    compact: z.boolean().optional(),
  }).strip(),
  studyGrid: z.object({
    columns: columns2to4,
    showCount: z.number().int().positive().max(100).optional(),
    grouped: z.boolean().optional(),
    heading: z.string().max(180).optional().or(z.literal("")),
    category: z.string().trim().max(32).optional().or(z.literal("")),
  }).strip(),
  mapEmbed: z.object({
    // Se acepta el iframe que pega el administrador; se guarda normalizado a
    // URL (`sanitizeMapEmbed`). La salida pública publica `embedUrl`, que es
    // de sólo salida: no se acepta al escribir. Guardarlo permitía dejar un
    // `embedHtml` inocente junto a un `embedUrl` peligroso, y la salida
    // pisaba el valor calculado con el almacenado.
    embedHtml: html,
    height: z.number().int().min(160).max(900).optional(),
    heading: z.string().max(180).optional().or(z.literal("")),
    text: z.string().max(500).optional().or(z.literal("")),
    directionsUrl: urlLike,
  }).strip(),
  videoEmbed: z.object({
    // El proveedor se valida al guardar, no sólo al dibujar: antes el panel
    // aceptaba cualquier URL, decía "Guardado" y el bloque no renderizaba nada
    // porque la CSP no permite ese host.
    url: z.string().trim().min(1).max(500).refine(isAllowedVideoUrl, VIDEO_URL_MESSAGE),
    caption: z.string().max(180).optional().or(z.literal("")),
  }).strip(),
  contactForm: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    showPhone: z.boolean().optional(),
  }).strip(),
  appointmentForm: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    defaultSpecialtyId: z.number().int().positive().optional(),
  }).strip(),
  contactChannels: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    text: z.string().max(500).optional().or(z.literal("")),
    columns: columns2to4.optional(),
    // Los valores viven en la tabla contact_channels; acá sólo qué mostrar.
    keys: z.array(z.string().trim().max(64)).max(12).optional(),
  }).strip(),
  socialLinks: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    text: z.string().max(500).optional().or(z.literal("")),
    muted: z.boolean().optional(),
  }).strip(),
  steps: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    text: z.string().max(500).optional().or(z.literal("")),
    muted: z.boolean().optional(),
    items: z.array(z.object({
      title: z.string().trim().min(1).max(160),
      text: itemText,
      icon: blockIcon,
    }).strip()).max(8),
  }).strip().superRefine((value, ctx) => noRepeatedIcons(value.items, ctx)),
  scheduleTable: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    text: z.string().max(500).optional().or(z.literal("")),
    areaKeys: z.array(z.string().trim().max(64)).max(20).optional(),
  }).strip(),
  cta: ctaSchema,
  stats: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    items: z.array(z.object({
      value: z.string().trim().min(1).max(40),
      label: z.string().trim().min(1).max(120),
      icon: blockIcon,
    }).strip()).max(12),
  }).strip().superRefine((value, ctx) => noRepeatedIcons(value.items, ctx)),
  logos: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    logos: z.array(z.object({
      imageUrl: z.string().trim().min(1).max(500),
      alt: z.string().max(180).optional().or(z.literal("")),
      href: urlLike,
    }).strip()).max(30),
  }).strip(),
  spacer: z.object({
    height: z.number().int().min(0).max(240),
  }).strip(),
} satisfies Record<BlockType, z.ZodTypeAny>;

export function validateBlockProps(type: string, props: unknown) {
  const schema = blockPropsSchemas[type as BlockType];
  if (!schema) return { success: false as const, error: `tipo de bloque desconocido: ${type}` };
  const parsed = schema.safeParse(props);
  if (!parsed.success) return { success: false as const, error: parsed.error.flatten() };
  return { success: true as const, data: parsed.data };
}
