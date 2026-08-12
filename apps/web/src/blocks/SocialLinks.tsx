import type { SocialLinksProps } from "@sa/shared/blocks";
import SocialIcon, { type SocialKind } from "../components/SocialIcon";
import { CHANNEL_KEYS, channelHref, socialChannels, useContactChannels } from "../lib/contact-channels";
import { isSafeExternalHref } from "../lib/url";

/*
 * Colores oficiales de cada red: excepción de marca, no el rojo institucional.
 * El #FF0000 de YouTube es el color del tercero y sólo se usa acá, como fondo
 * del ícono circular; no sale del token `accent` del tema ni se aplica nunca a
 * un llamado a la acción. Ver `shared/types/institutional-red.ts`.
 */
const NETWORKS: Record<SocialKind, { label: string; brand: string }> = {
  facebook: { label: "Facebook", brand: "bg-[#1877F2]" },
  instagram: { label: "Instagram", brand: "bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]" },
  youtube: { label: "YouTube", brand: "bg-[#FF0000]" },
  linkedin: { label: "LinkedIn", brand: "bg-[#0A66C2]" },
  whatsapp: { label: "WhatsApp", brand: "bg-[#25D366]" },
};

export default function SocialLinks({
  heading = "Conócenos en nuestras redes",
  text,
  muted = true,
}: SocialLinksProps) {
  // Redes y WhatsApp salen de la misma tabla que el resto de los canales.
  const { channels, firstWithValue } = useContactChannels();
  const whatsappChannel = firstWithValue(CHANNEL_KEYS.general, CHANNEL_KEYS.turnos);
  const whatsappHref = whatsappChannel ? channelHref(whatsappChannel) : undefined;

  const links = socialChannels(channels)
    .filter((s) => isSafeExternalHref(s.href))
    .map((s) => ({ key: s.key as SocialKind, href: s.href, ...NETWORKS[s.key as SocialKind] }));
  if (whatsappHref) {
    links.push({ key: "whatsapp", href: whatsappHref, ...NETWORKS.whatsapp });
  }
  if (links.length === 0) return null;

  return (
    <section className={muted ? "bg-gray-50 section-y-md" : "section-y-md"}>
      <div className="container-x text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-primary mb-2">{heading}</h2>
        <p className="text-gray-600 mb-8 max-w-2xl mx-auto">
          {text ?? "Seguinos para enterarte de novedades, campañas de salud y consejos de nuestros profesionales."}
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          {links.map((n) => (
            <a
              key={n.key}
              href={n.href}
              target="_blank"
              rel="noreferrer"
              aria-label={n.label}
              className="group flex flex-col items-center gap-2"
            >
              <span
                className={`w-14 h-14 rounded-full text-white flex items-center justify-center shadow-sm group-hover:shadow-md group-hover:-translate-y-1 transition-all duration-300 ${n.brand}`}
              >
                <SocialIcon kind={n.key} className="w-6 h-6" />
              </span>
              <span className="text-sm font-medium text-ink/80 group-hover:text-primary transition">{n.label}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
