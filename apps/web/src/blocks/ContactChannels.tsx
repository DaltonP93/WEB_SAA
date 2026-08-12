import type { ContactChannelsProps } from "@sa/shared/blocks";
import type { ContactChannel } from "@sa/shared";
import LucideIcon, { isIconName } from "../components/LucideIcon";
import { CHANNEL_KEYS, PENDING_LABEL, channelHref, useContactChannels } from "../lib/contact-channels";

/**
 * Canales de atención diferenciados por tipo (item 25 de la minuta).
 *
 * Los datos salen de Configuración → Canales de contacto: el bloque sólo elige
 * cuáles muestra. Emergencias es el único canal que usa el rojo de marca.
 */

const KIND_ICON: Record<ContactChannel["kind"], string> = {
  whatsapp: "message-circle",
  phone: "phone",
  email: "mail",
  url: "link",
};

const KIND_LABEL: Record<ContactChannel["kind"], string> = {
  whatsapp: "WhatsApp",
  phone: "Llamar",
  email: "Escribir",
  url: "Abrir",
};

function Channel({ channel }: { channel: ContactChannel }) {
  const href = channelHref(channel);
  const isEmergency = channel.key === CHANNEL_KEYS.emergencias;
  const isWhatsapp = channel.kind === "whatsapp";
  const iconName = channel.icon && isIconName(channel.icon) ? channel.icon : KIND_ICON[channel.kind];

  const tone = isEmergency
    ? "border-accent/40 bg-accent/5 hover:border-accent"
    : isWhatsapp
      ? "border-green-200 bg-green-50/60 hover:border-green-600"
      : "border-gray-200 bg-white hover:border-primary";
  const iconTone = isEmergency
    ? "bg-accent text-white"
    : isWhatsapp
      ? "bg-green-600 text-white"
      : "bg-primary/5 text-primary";

  const content = (
    <>
      <div className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center ${iconTone}`}>
        <LucideIcon name={iconName} className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className={`text-xs font-semibold uppercase tracking-wide ${isEmergency ? "text-accent-700" : "text-gray-600"}`}>
          {isEmergency ? "Emergencias 24hs" : KIND_LABEL[channel.kind]}
        </p>
        <h3 className="font-semibold text-primary">{channel.label}</h3>
        {channel.value ? (
          <p className={`mt-0.5 font-medium break-words ${isEmergency ? "text-accent-700 text-lg" : "text-ink"}`}>
            {channel.value}
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-gray-600 italic">{PENDING_LABEL}</p>
        )}
        {channel.note && <p className="text-sm text-gray-600 mt-1">{channel.note}</p>}
      </div>
    </>
  );

  const className = `flex items-start gap-3 rounded border p-4 shadow-sm transition-all duration-300 ${tone}`;

  // Sin dato cargado no se genera enlace: una tarjeta informativa, no un <a> vacío.
  if (!href) {
    return (
      <div className={className} aria-label={`${channel.label}: ${PENDING_LABEL}`}>
        {content}
      </div>
    );
  }

  const external = href.startsWith("http");
  return (
    <a
      href={href}
      className={`${className} hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {content}
    </a>
  );
}

export default function ContactChannels({ heading, text, columns = 3, keys }: ContactChannelsProps) {
  const { channels, isLoading } = useContactChannels();

  const selected = keys?.length
    ? keys.map((k) => channels.find((c) => c.key === k)).filter((c): c is ContactChannel => !!c)
    : channels;

  if (isLoading || selected.length === 0) return null;

  const cols = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[columns];
  return (
    <section className="container-x section-y-md">
      {heading && <h2 className="text-2xl md:text-3xl font-bold text-primary mb-2">{heading}</h2>}
      {text && <p className="text-gray-600 mb-6 max-w-2xl">{text}</p>}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${cols} gap-4`}>
        {selected.map((channel) => (
          <Channel key={channel.key} channel={channel} />
        ))}
      </div>
    </section>
  );
}
