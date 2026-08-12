export * from "./blocks";

export type UserRole = "superadmin" | "editor";

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export interface Specialty {
  id: number;
  slug: string;
  name: string;
  icon?: string | null;
  description?: string | null;
}

export interface Doctor {
  id: number;
  slug: string;
  name: string;
  photoUrl?: string | null;
  bio?: string | null;
  schedule?: Record<string, string> | null;
  specialties: Specialty[];
}

export interface Service {
  id: number;
  slug: string;
  name: string;
  icon?: string | null;
  description?: string | null;
  body?: string | null;
}

export interface Study {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  body?: string | null;
}

export interface NewsArticle {
  id: number;
  slug: string;
  title: string;
  excerpt?: string | null;
  body: string;
  coverUrl?: string | null;
  publishedAt: string | null;
  status: "draft" | "published";
}

/** Canal de contacto administrable (tabla contact_channels). */
export type ContactChannelKindDb = "whatsapp" | "phone" | "email" | "url";

export interface ContactChannel {
  id: number;
  /** Clave estable usada por bloques y layout (ej. "whatsapp-turnos"). */
  key: string;
  label: string;
  kind: ContactChannelKindDb;
  /** null = a confirmar; nunca se arma un enlace con esto vacío. */
  value: string | null;
  note?: string | null;
  message?: string | null;
  href?: string | null;
  icon?: string | null;
  order: number;
}

export interface MenuItem {
  label: string;
  href: string;
  children?: MenuItem[];
}

export interface Menu {
  location: "header" | "footer";
  items: MenuItem[];
}

export interface SiteSettings {
  brand: {
    name: string;
    logoUrl: string;
    faviconUrl: string;
    tagline?: string;
  };
  theme: {
    primary: string;
    secondary: string;
    accent: string;
    bg: string;
    text: string;
    fontHeading: string;
    fontBody: string;
    radius: string;
  };
  contact: {
    address: string;
    phones: string[];
    email: string;
    whatsapp: string;
    hours: string;
    mapEmbed: string;
    /** Número de Emergencias 24hs, destacado en header y footer. */
    emergencyPhone?: string;
    /** Correo de Gestión de Talento Humano ("Trabajá con nosotros"). */
    gthEmail?: string;
    /** Link "Cómo llegar" (Google Maps). */
    mapsUrl?: string;
  };
  social: {
    facebook?: string;
    instagram?: string;
    youtube?: string;
    linkedin?: string;
  };
  seo: {
    title: string;
    description: string;
    ogImage?: string;
  };
  scripts: {
    head?: string;
    bodyEnd?: string;
  };
}

export interface Page {
  id: number;
  slug: string;
  title: string;
  status: "draft" | "published";
  seo?: { title?: string; description?: string; ogImage?: string };
  blocks: import("./blocks").Block[];
}

export interface Appointment {
  id: number;
  name: string;
  phone: string;
  email: string;
  specialtyId?: number | null;
  doctorId?: number | null;
  preferredAt?: string | null;
  message?: string | null;
  status: "pendiente" | "confirmado" | "cancelado";
  createdAt: string;
}

export interface ContactMessage {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  message: string;
  status: "nuevo" | "leido" | "respondido";
  createdAt: string;
}

export interface MediaItem {
  id: number;
  url: string;
  mime: string;
  size: number;
  alt?: string | null;
  uploadedBy?: number | null;
  createdAt: string;
}