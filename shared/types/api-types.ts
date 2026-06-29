export interface Settings {
  brand?: {
    name?: string;
    tagline?: string;
    logoUrl?: string;
    faviconUrl?: string;
  };
  contact?: {
    address?: string;
    phones?: string[];
    email?: string;
    hours?: string;
    whatsapp?: string;
  };
  social?: {
    facebook?: string;
    instagram?: string;
    youtube?: string;
  };
  theme?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    bg?: string;
    text?: string;
    fontHeading?: string;
    fontBody?: string;
    radius?: string;
  };
  seo?: {
    title?: string;
    description?: string;
    ogImage?: string;
  };
}

export interface Doctor {
  id: number;
  slug: string;
  name: string;
  photo_url?: string;
  bio?: string;
  specialties: Specialty[];
}

export interface Specialty {
  id: number;
  slug: string;
  name: string;
  description?: string;
  icon_url?: string;
}

export interface Service {
  id: number;
  slug: string;
  name: string;
  description?: string;
  icon_url?: string;
}

export interface Study {
  id: number;
  slug: string;
  name: string;
  description?: string;
}

export interface NewsItem {
  id: number;
  slug: string;
  title: string;
  summary?: string;
  content?: string;
  image_url?: string;
  published_at?: string;
}

export interface Page {
  id: number;
  slug: string;
  title: string;
  blocks: import("./blocks").Block[];