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
  | "mapEmbed"
  | "videoEmbed"
  | "contactForm"
  | "appointmentForm"
  | "contactChannels"
  | "socialLinks"
  | "steps"
  | "scheduleTable"
  | "cta"
  | "stats"
  | "logos"
  | "newsletter"
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
  /**
   * Especialidad por slug: más estable que el id, que cambia entre entornos.
   * Con `lockSpecialty` la lista queda restringida a esa especialidad.
   */
  specialtySlug?: string;
  /** Fija la especialidad: oculta el selector y no muestra otros médicos. */
  lockSpecialty?: boolean;
  showSearch?: boolean;
  limit?: number;
  heading?: string;
  /** Texto de ayuda debajo del título. */
  intro?: string;
  /** Mensaje cuando la especialidad todavía no tiene profesionales cargados. */
  emptyText?: string;
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

export interface MapEmbedProps {
  /**
   * Lo que pega quien administra: el `<iframe>` que da Google, o la URL sola.
   * Se guarda ya normalizado a URL y **no se publica**: la API expone
   * `embedUrl`. El front no recibe HTML del mapa en ningún caso.
   */
  embedHtml: string;
  /**
   * URL validada de Google Maps. **Sólo de salida**: la calcula la API en cada
   * respuesta a partir de `embedHtml` y el schema de escritura la descarta.
   * Si se pudiera guardar, una fila con `embedHtml` inocente y `embedUrl`
   * peligroso pisaba el valor calculado.
   */
  embedUrl?: string;
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

/**
 * Bloque de suscripción a novedades. Un título, un texto y el campo de correo.
 * El correo se guarda en `newsletter_subscribers` (captura propia, sin proveedor
 * externo); la lista y el export están en el panel.
 */
export interface NewsletterProps {
  heading?: string;
  text?: string;
  buttonLabel?: string;
}

/**
 * Bloque de canales de contacto.
 *
 * Los datos NO viven en el bloque: se administran en Configuración → Canales de
 * contacto (tabla `contact_channels`) y el bloque sólo elige cuáles mostrar.
 * Así un número se cambia en un único lugar.
 */
export interface ContactChannelsProps {
  heading?: string;
  text?: string;
  columns?: 2 | 3 | 4;
  /** Claves de canal a mostrar, en orden. Vacío = todos los activos. */
  keys?: string[];
}

/**
 * Infografía de pasos (item 9): explica un proceso en 3-4 pasos numerados,
 * con icono y texto. Editable desde el panel.
 */
export interface StepItem {
  title: string;
  text?: string;
  icon?: string;
}

export interface StepsProps {
  heading?: string;
  text?: string;
  items: StepItem[];
  /** Fondo suave para separar la sección del resto. */
  muted?: boolean;
}

/**
 * Tabla de horarios. Los datos viven en la tabla `schedules` (administrable);
 * si no hay ninguno activo, el bloque avisa que están en confirmación en vez
 * de publicar horarios inventados.
 */
export interface ScheduleTableProps {
  heading?: string;
  text?: string;
  /** Filtra por área/servicio; vacío = todas. */
  areaKeys?: string[];
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
  /**
   * `emergency` es la única variante roja, y sólo se acepta cuando el CTA
   * apunta a `/emergencias` y su texto lo dice. No hay override de color
   * libre: el `background` arbitrario se retiró porque era la vía para meter
   * rojo sin pedir la variante.
   */
  variant?: "emergency" | "primary" | "secondary" | "muted";
}

export interface StatsProps {
  heading?: string;
  items: { value: string; label: string; icon?: string }[];
}

/**
 * Un logo de convenio o aliado.
 *
 * Todo lo que se agregó después de `imageUrl`, `alt` y `href` es **opcional**:
 * los bloques que ya existen en la base se guardaron con esas tres claves y
 * tienen que seguir funcionando sin que nadie los edite. Lo que falta se
 * resuelve con un default que reproduce lo que se veía antes.
 */
export interface LogoItem {
  imageUrl: string;
  alt?: string;
  href?: string;
  /** Sin cargar, el logo se muestra: los bloques anteriores no traen el campo. */
  active?: boolean;
  /** Dimensiones reales del archivo, para que el sitio no salte al cargar. */
  width?: number;
  height?: number;
}

export interface LogosProps {
  heading?: string;
  logos: LogoItem[];
  /**
   * Opacidad de la fila, de 0 a 100.
   *
   * El bloque tenía `opacity-80` fijo en la clase. Ahora es configurable, y
   * cuando falta —todos los bloques anteriores— vale 80: un bloque existente
   * se sigue viendo exactamente igual hasta que alguien decida cambiarlo.
   */
  opacity?: number;
}

/** Lo que valía el `opacity-80` fijo de la versión anterior del bloque. */
export const LOGOS_OPACIDAD_POR_DEFECTO = 80;

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
  | BaseBlock<"mapEmbed", MapEmbedProps>
  | BaseBlock<"videoEmbed", VideoEmbedProps>
  | BaseBlock<"contactForm", ContactFormProps>
  | BaseBlock<"appointmentForm", AppointmentFormProps>
  | BaseBlock<"contactChannels", ContactChannelsProps>
  | BaseBlock<"socialLinks", SocialLinksProps>
  | BaseBlock<"steps", StepsProps>
  | BaseBlock<"scheduleTable", ScheduleTableProps>
  | BaseBlock<"cta", CtaProps>
  | BaseBlock<"stats", StatsProps>
  | BaseBlock<"logos", LogosProps>
  | BaseBlock<"newsletter", NewsletterProps>
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
    defaults: { heading: "Canales de atención", columns: 3, keys: [] } satisfies ContactChannelsProps,
  },
  { type: "socialLinks", label: "Redes sociales", defaults: { heading: "Conócenos en nuestras redes" } satisfies SocialLinksProps },
  {
    type: "steps",
    label: "Infografía de pasos",
    defaults: { heading: "Cómo sacar tu turno", items: [], muted: true } satisfies StepsProps,
  },
  {
    type: "scheduleTable",
    label: "Horarios de atención",
    defaults: { heading: "Horarios de atención" } satisfies ScheduleTableProps,
  },
  { type: "cta", label: "Llamado a la accion", defaults: { title: "", ctaLabel: "Ver mas", ctaHref: "#", variant: "primary" } satisfies CtaProps },
  { type: "stats", label: "Estadisticas", defaults: { items: [] } satisfies StatsProps },
  { type: "logos", label: "Logos", defaults: { logos: [] } satisfies LogosProps },
  { type: "newsletter", label: "Newsletter", defaults: { heading: "Recibí nuestras novedades", text: "", buttonLabel: "Suscribirme" } satisfies NewsletterProps },
  { type: "spacer", label: "Espacio", defaults: { height: 40 } satisfies SpacerProps },
];
