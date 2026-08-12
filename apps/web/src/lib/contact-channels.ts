import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { ContactChannel } from "@sa/shared";

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
} as const;

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
