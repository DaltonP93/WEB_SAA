export type BlockType =
  | "hero"
  | "richText"
  | "cards"
  | "accordion"
  | "slider"
  | "gallery"
  | "doctorList"
  | "specialtyGrid"
  | "serviceGrid"
  | "studyGrid"
  | "newsGrid"
  | "mapEmbed"
  | "videoEmbed"
  | "contactForm"
  | "appointmentForm"
  | "contactChannels"
  | "socialLinks"
  | "cta"
  | "stats"
  | "logos"
  | "spacer";

export interface BaseBlock<T extends BlockType, P> {
  id: number;
  type: T;
  order: number;
  props: P;
}

export interface HeroProps {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaHref?: string;
  variant?: "centered" | "left" | "split";
  overlay?: number;
  eyebrow?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  animatedBg?: boolean;
}

export interface RichTextProps {
  html: string;
}

export interface CardItem {
  title: string;
  text?: string;
  icon?: string;
  imageUrl?: string;
  href?: string;
}
export interface CardsProps {
  columns: 2 | 3 | 4;
  items: CardItem[];
  heading?: string;
}

export interface AccordionProps {
  heading?: string;
  items: { title: string; body: string }[];
}

export interface SliderProps {
  slides: { imageUrl: string; title?: string; text?: string; href?: string }[];
  autoplayMs?: number;
}

export interface GalleryProps {
  columns: 2 | 3 | 4 | 5;
  images: { url: string; alt?: string }[];
}

export interface DoctorListProps {
  /** Preselecciona una especialidad por id (el visitante puede cambiarla). */
  specialtyFilter?: number;
  showSearch?: boolean;
  limit?: number;
  heading?: string;
  /** Texto de ayuda debajo del título. */
  intro?: string;
}

export interface SpecialtyGridProps {
  columns: 3 | 4 | 6;
  showCount?: number;
  heading?: string;
  /** Variante compacta: chips en vez de tarjetas grandes. */
  compact?: boolean;
}

export interface ServiceGridProps {
  columns: 2 | 3 | 4;
  showCount?: number;
  heading?: string;
  /** Variante compacta: tarjetas de una línea con icono. */
  compact?: boolean;
}

export interface StudyGridProps {
  columns: 2 | 3 | 4;
  showCount?: number;
  /** Agrupa los estudios por categoría (Laboratorio / Imágenes / Cardiológicos / Biopsias). */
  grouped?: boolean;
  heading?: string;
  /** Muestra solo una categoría ("laboratorio" | "imagenes" | "cardiologicos" | "biopsias"). */
  category?: string;
}

export interface NewsGridProps {
  limit: number;
  columns: 2 | 3 | 4;
}

export interface MapEmbedProps {
  embedHtml: string;
  height?: number;
  heading?: string;
  text?: string;
  /** Link "Cómo llegar" (Google Maps). Si se omite se usa el de configuración. */
  directionsUrl?: string;
}

export interface VideoEmbedProps {
  url: string;
  caption?: string;
}

export interface ContactFormProps {
  heading?: string;
  showPhone?: boolean;
}

export interface AppointmentFormProps {
  heading?: string;
  defaultSpecialtyId?: number;
}

/** Canal de contacto directo (WhatsApp, teléfono, email, emergencias). */
export type ContactChannelKind = "whatsapp" | "phone" | "email" | "emergency";

export interface ContactChannelItem {
  kind: ContactChannelKind;
  /** Tipo de atención: "Turnos", "Estudios y laboratorio", "Trabajá con nosotros"… */
  label: string;
  /** Número o correo. Si queda vacío se muestra como "a confirmar" y no se linkea. */
  value?: string;
  note?: string;
  /** Mensaje pre-cargado para los links de WhatsApp. */
  message?: string;
  icon?: string;
}

export interface ContactChannelsProps {
  heading?: string;
  text?: string;
  columns?: 2 | 3 | 4;
  items: ContactChannelItem[];
}

export interface SocialLinksProps {
  heading?: string;
  text?: string;
  /** Fondo suave en vez de blanco. */
  muted?: boolean;
}

export interface CtaProps {
  title: string;
  text?: string;
  ctaLabel: string;
  ctaHref: string;
  background?: string;
  variant?: "accent" | "primary" | "secondary" | "muted";
}

export interface StatsProps {
  heading?: string;
  items: { value: string; label: string; icon?: string }[];
}

export interface LogosProps {
  heading?: string;
  logos: { imageUrl: string; alt?: string; href?: string }[];
}

export interface SpacerProps {
  height: number;
}

export type Block =
  | BaseBlock<"hero", HeroProps>
  | BaseBlock<"richText", RichTextProps>
  | BaseBlock<"cards", CardsProps>
  | BaseBlock<"accordion", AccordionProps>
  | BaseBlock<"slider", SliderProps>
  | BaseBlock<"gallery", GalleryProps>
  | BaseBlock<"doctorList", DoctorListProps>
  | BaseBlock<"specialtyGrid", SpecialtyGridProps>
  | BaseBlock<"serviceGrid", ServiceGridProps>
  | BaseBlock<"studyGrid", StudyGridProps>
  | BaseBlock<"newsGrid", NewsGridProps>
  | BaseBlock<"mapEmbed", MapEmbedProps>
  | BaseBlock<"videoEmbed", VideoEmbedProps>
  | BaseBlock<"contactForm", ContactFormProps>
  | BaseBlock<"appointmentForm", AppointmentFormProps>
  | BaseBlock<"contactChannels", ContactChannelsProps>
  | BaseBlock<"socialLinks", SocialLinksProps>
  | BaseBlock<"cta", CtaProps>
  | BaseBlock<"stats", StatsProps>
  | BaseBlock<"logos", LogosProps>
  | BaseBlock<"spacer", SpacerProps>;

export const BLOCK_REGISTRY: { type: BlockType; label: string; defaults: unknown }[] = [
  { type: "hero", label: "Hero", defaults: { title: "Titulo", subtitle: "", variant: "centered" } satisfies HeroProps },
  { type: "richText", label: "Texto enriquecido", defaults: { html: "<p>Contenido...</p>" } satisfies RichTextProps },
  { type: "cards", label: "Tarjetas", defaults: { columns: 3, items: [] } satisfies CardsProps },
  { type: "accordion", label: "Acordeon", defaults: { items: [] } satisfies AccordionProps },
  { type: "slider", label: "Slider", defaults: { slides: [] } satisfies SliderProps },
  { type: "gallery", label: "Galeria", defaults: { columns: 3, images: [] } satisfies GalleryProps },
  { type: "doctorList", label: "Lista de medicos", defaults: { showSearch: true } satisfies DoctorListProps },
  { type: "specialtyGrid", label: "Grid de especialidades", defaults: { columns: 4 } satisfies SpecialtyGridProps },
  { type: "serviceGrid", label: "Grid de servicios", defaults: { columns: 3 } satisfies ServiceGridProps },
  { type: "studyGrid", label: "Grid de estudios", defaults: { columns: 3 } satisfies StudyGridProps },
  { type: "mapEmbed", label: "Mapa Google", defaults: { embedHtml: "", height: 400 } satisfies MapEmbedProps },
  { type: "videoEmbed", label: "Video", defaults: { url: "" } satisfies VideoEmbedProps },
  { type: "contactForm", label: "Form Contacto", defaults: {} satisfies ContactFormProps },
  { type: "appointmentForm", label: "Form Turno", defaults: {} satisfies AppointmentFormProps },
  {
    type: "contactChannels",
    label: "Canales de contacto (WhatsApp / tel / email)",
    defaults: { heading: "Canales de atención", columns: 3, items: [] } satisfies ContactChannelsProps,
  },
  { type: "socialLinks", label: "Redes sociales", defaults: { heading: "Conócenos en nuestras redes" } satisfies SocialLinksProps },
  { type: "cta", label: "Llamado a la accion", defaults: { title: "", ctaLabel: "Ver mas", ctaHref: "#", variant: "primary" } satisfies CtaProps },
  { type: "stats", label: "Estadisticas", defaults: { items: [] } satisfies StatsProps },
  { type: "logos", label: "Logos", defaults: { logos: [] } satisfies LogosProps },
  { type: "spacer", label: "Espacio", defaults: { height: 40 } satisfies SpacerProps },
];
