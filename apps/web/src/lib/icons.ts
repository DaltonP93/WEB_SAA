import { isIconName } from "../components/LucideIcon";

/**
 * Fallbacks de iconos por slug para especialidades, servicios y estudios.
 *
 * El icono real se carga desde la DB (`icon` del registro, editable en el
 * admin). Estos mapas existen para que nada quede con el mismo icono genérico
 * cuando el cliente todavía no cargó uno: cada slug conocido tiene un icono
 * propio. Todos los nombres están verificados contra lucide 0.460 — los que
 * no existen en esa versión (`lungs`, `venus`, `flask`) no se usan.
 */

export const SPECIALTY_ICON: Record<string, string> = {
  cardiologia: "heart-pulse",
  "rehabilitacion-cardiaca": "activity",
  pediatria: "baby",
  neonatologia: "baby",
  "ginecologia-y-obstetricia": "flower",
  mastologia: "ribbon",
  traumatologia: "bone",
  neurologia: "brain",
  neurocirugia: "brain-cog",
  psiquiatria: "brain-circuit",
  psicologia: "speech",
  oftalmologia: "eye",
  otorrinolaringologia: "ear",
  urologia: "droplet",
  nefrologia: "droplets",
  dermatologia: "scan-face",
  endocrinologia: "atom",
  diabetologia: "candy",
  gastroenterologia: "utensils",
  coloproctologia: "git-branch",
  neumologia: "wind",
  oncologia: "shield-plus",
  hematologia: "test-tube",
  infectologia: "biohazard",
  reumatologia: "hand",
  flebologia: "waves",
  geriatria: "hourglass",
  fisioterapia: "dumbbell",
  nutricion: "salad",
  odontologia: "smile",
  "cirugia-general": "scissors",
  "medicina-interna": "stethoscope",
  "clinica-medica": "clipboard-list",
  "medicina-familiar": "users",
  anestesiologia: "syringe",
  "ayuda-espiritual": "book-heart",
};

export const SERVICE_ICON: Record<string, string> = {
  internacion: "bed",
  emergencias: "siren",
  cirugia: "scissors",
  consultorios: "clipboard-list",
  maternidad: "baby",
  uti: "heart-pulse",
  fisioterapia: "dumbbell",
  "diagnostico-por-imagenes": "scan",
  laboratorio: "flask-conical",
  "banco-de-sangre": "droplet",
  "comedor-ovo-lacto-vegetariano": "salad",
  "seguro-medico-samap": "shield-check",
  odontologia: "smile",
  "estudios-cardiologicos": "activity",
  biopsias: "microscope",
  farmacia: "pill",
  ambulancia: "ambulance",
  "atencion-espiritual": "book-heart",
};

export const STUDY_ICON: Record<string, string> = {
  laboratorio: "flask-conical",
  bacteriologia: "bug",
  ecografias: "waves",
  "ecografia-3d-4d": "baby",
  tomografia: "scan",
  resonancia: "magnet",
  "rayos-x": "bone",
  mamografia: "ribbon",
  densitometria: "bone",
  endoscopia: "search",
  electrocardiograma: "activity",
  ecocardiograma: "heart-pulse",
  "ecocardiografia-transesofagica": "heart",
  "eco-doppler": "waves",
  ergometria: "dumbbell",
  "eco-estres": "trending-up",
  mapa: "gauge",
  holter: "watch",
  biopsias: "microscope",
  "citologia-papanicolaou": "microscope",
  "puncion-aspirativa": "pipette",
};

const DEFAULT_ICON: Record<"specialty" | "service" | "study", string> = {
  specialty: "stethoscope",
  service: "hospital",
  study: "clipboard-check",
};

/**
 * Devuelve el nombre lucide a usar: primero el cargado en la DB, después el
 * fallback por slug y, como último recurso, el genérico de la familia.
 */
export function resolveIcon(
  kind: "specialty" | "service" | "study",
  entity: { slug?: string | null; icon?: string | null },
): string {
  if (entity.icon && isIconName(entity.icon)) return entity.icon;
  const map = kind === "specialty" ? SPECIALTY_ICON : kind === "service" ? SERVICE_ICON : STUDY_ICON;
  const fallback = entity.slug ? map[entity.slug] : undefined;
  if (fallback && isIconName(fallback)) return fallback;
  return DEFAULT_ICON[kind];
}

/** Emojis y otros valores que no son nombres lucide se muestran tal cual. */
export function isEmojiIcon(value?: string | null): boolean {
  return !!value && !isIconName(value) && value.length <= 4;
}
