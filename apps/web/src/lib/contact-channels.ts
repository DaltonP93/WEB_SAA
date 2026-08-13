import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { ContactChannel, Schedule } from "@sa/shared";

/**
 * Canales de contacto: fuente única (tabla `contact_channels`, administrable
 * desde el panel). Header, footer, Turnos, Contacto y el bloque de canales leen
 * de acá; ningún número vive duplicado en props de bloques ni en migraciones.
 */

/** Claves conocidas que usa el layout. El resto se descubre por datos. */
export const CHANNEL_KEYS = {
  emergencias: "emergencias",
  turnos: "whatsapp-turnos",
  general: "whatsapp-general",
  gth: "gth",
  email: "email-general",
  recepcion: "recepcion",
} as const;

/**
 * Redes sociales. También son canales: antes vivían en `settings.social` y el
 * panel dejaba editarlas por duplicado, así que un perfil podía quedar
 * distinto según dónde se mirara.
 */
export const SOCIAL_KEYS = ["facebook", "instagram", "youtube", "linkedin"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

export function useContactChannels() {
  const { data, isLoading } = useQuery({
    queryKey: ["contact-channels"],
    queryFn: async () => (await api.get("/public/contact-channels")).data as ContactChannel[],
    staleTime: 5 * 60_000,
  });

  const channels = useMemo(() => data ?? [], [data]);
  const byKey = useMemo(() => new Map(channels.map((c) => [c.key, c])), [channels]);

  return {
    channels,
    isLoading,
    get: (key: string) => byKey.get(key),
    /** Primer canal con valor cargado entre las claves dadas. */
    firstWithValue: (...keys: string[]) => keys.map((k) => byKey.get(k)).find((c) => c?.value),
  };
}

/** Sólo dígitos, como espera wa.me. */
export function waDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/**
 * Construye el enlace del canal. Devuelve undefined cuando no hay dato
 * cargado: preferimos mostrar "A confirmar" antes que un enlace vacío.
 */
export function channelHref(channel: Pick<ContactChannel, "kind" | "value" | "message" | "href">): string | undefined {
  if (channel.kind === "url") {
    const href = channel.href?.trim();
    return href || undefined;
  }

  const value = channel.value?.trim();
  if (!value) return undefined;

  if (channel.kind === "email") {
    // Un correo mal cargado no debe generar un mailto: roto.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${value}` : undefined;
  }

  if (channel.kind === "whatsapp") {
    const digits = waDigits(value);
    // wa.me necesita el número en formato internacional completo.
    if (digits.length < 8) return undefined;
    const message = channel.message?.trim();
    return message
      ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
      : `https://wa.me/${digits}`;
  }

  // phone
  const tel = value.replace(/[^0-9+]/g, "");
  return tel.replace(/\D/g, "").length >= 6 ? `tel:${tel}` : undefined;
}

export const PENDING_LABEL = "A confirmar";

/** Los canales de redes con URL válida, en el orden en que se muestran. */
export function socialChannels(
  channels: Pick<ContactChannel, "key" | "kind" | "value" | "href" | "message">[],
): { key: SocialKey; href: string }[] {
  const byKey = new Map(channels.map((c) => [c.key, c]));
  return SOCIAL_KEYS.flatMap((key) => {
    const channel = byKey.get(key);
    if (!channel) return [];
    const href = channelHref(channel);
    return href ? [{ key, href }] : [];
  });
}

/**
 * Horarios publicados: fuente única (tabla `schedules`). Devuelve sólo los que
 * el sanatorio marcó activos y con horario cargado; mientras no haya ninguno,
 * el sitio avisa que están en confirmación en vez de mostrar horas inventadas.
 */
export function useSchedules() {
  const { data, isLoading } = useQuery({
    queryKey: ["schedules"],
    queryFn: async () => (await api.get("/public/schedules")).data as Schedule[],
    staleTime: 5 * 60_000,
  });
  return { schedules: data ?? [], isLoading };
}
