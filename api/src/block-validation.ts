import { z } from "zod";
import type { BlockType } from "@sa/shared/blocks";

const urlLike = z.string().trim().max(500).optional().or(z.literal(""));
const html = z.string().max(100_000);
const columns2to4 = z.union([z.literal(2), z.literal(3), z.literal(4)]);
const itemText = z.string().max(500).optional().or(z.literal(""));

const cardItemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  text: itemText,
  icon: z.string().trim().max(64).optional().or(z.literal("")),
  imageUrl: urlLike,
  href: urlLike,
}).strip();

const blockPropsSchemas = {
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
  cards: z.object({ columns: columns2to4, heading: z.string().max(180).optional().or(z.literal("")), items: z.array(cardItemSchema).max(24) }).strip(),
  accordion: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    items: z.array(z.object({ title: z.string().trim().min(1).max(180), body: html }).strip()).max(24),
  }).strip(),
  slider: z.object({
    slides: z.array(z.object({ imageUrl: z.string().trim().min(1).max(500), title: z.string().max(180).optional().or(z.literal("")), text: itemText, href: urlLike }).strip()).max(20),
    autoplayMs: z.number().int().min(0).max(60_000).optional(),
  }).strip(),
  gallery: z.object({
    columns: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    images: z.array(z.object({ url: z.string().trim().min(1).max(500), alt: z.string().max(180).optional().or(z.literal("")) }).strip()).max(60),
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
  newsGrid: z.object({ limit: z.number().int().positive().max(50), columns: columns2to4 }).strip(),
  mapEmbed: z.object({
    embedHtml: html,
    height: z.number().int().min(160).max(900).optional(),
    heading: z.string().max(180).optional().or(z.literal("")),
    text: z.string().max(500).optional().or(z.literal("")),
    directionsUrl: urlLike,
  }).strip(),
  videoEmbed: z.object({ url: z.string().trim().min(1).max(500), caption: z.string().max(180).optional().or(z.literal("")) }).strip(),
  contactForm: z.object({ heading: z.string().max(180).optional().or(z.literal("")), showPhone: z.boolean().optional() }).strip(),
  appointmentForm: z.object({ heading: z.string().max(180).optional().or(z.literal("")), defaultSpecialtyId: z.number().int().positive().optional() }).strip(),
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
      icon: z.string().trim().max(64).optional().or(z.literal("")),
    }).strip()).max(8),
  }).strip(),
  scheduleTable: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    text: z.string().max(500).optional().or(z.literal("")),
    areaKeys: z.array(z.string().trim().max(64)).max(20).optional(),
  }).strip(),
  cta: z.object({
    title: z.string().trim().min(1).max(180),
    text: z.string().max(500).optional().or(z.literal("")),
    ctaLabel: z.string().trim().min(1).max(80),
    ctaHref: z.string().trim().min(1).max(500),
    background: z.string().max(80).optional().or(z.literal("")),
    variant: z.enum(["accent", "primary", "secondary", "muted"]).optional(),
  }).strip(),
  stats: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    items: z.array(z.object({
      value: z.string().trim().min(1).max(40),
      label: z.string().trim().min(1).max(120),
      icon: z.string().trim().max(64).optional().or(z.literal("")),
    }).strip()).max(12),
  }).strip(),
  logos: z.object({
    heading: z.string().max(180).optional().or(z.literal("")),
    logos: z.array(z.object({ imageUrl: z.string().trim().min(1).max(500), alt: z.string().max(180).optional().or(z.literal("")), href: urlLike }).strip()).max(30),
  }).strip(),
  spacer: z.object({ height: z.number().int().min(0).max(240) }).strip(),
} satisfies Record<BlockType, z.ZodTypeAny>;

export function validateBlockProps(type: string, props: unknown) {
  const schema = blockPropsSchemas[type as BlockType];
  if (!schema) return { success: false as const, error: `tipo de bloque desconocido: ${type}` };
  const parsed = schema.safeParse(props);
  if (!parsed.success) return { success: false as const, error: parsed.error.flatten() };
  return { success: true as const, data: parsed.data };
}
