import type { ContactChannelItem, ContactChannelsProps } from "@sa/shared/blocks";
import LucideIcon, { isIconName } from "../components/LucideIcon";

/**
 * Canales de atención diferenciados por tipo (item 25 de la minuta):
 * WhatsApp por tipo de atención, teléfonos, correos y el número de
 * Emergencias claramente identificado — el único que usa el rojo de marca.
 */

const KIND_ICON: Record<ContactChannelItem["kind"], string> = {
  whatsapp: "message-circle",
  phone: "phone",
  email: "mail",
  emergency: "siren",
};

const KIND_LABEL: Record<ContactChannelItem["kind"], string> = {
  whatsapp: "WhatsApp",
  phone: "Llamar",
  email: "Escribir",
  emergency: "Emergencias 24hs",
};

function digits(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function hrefFor(item: ContactChannelItem): string | undefined {
  const value = item.value?.trim();
  if (!value) return undefined;
  if (item.kind === "email") return `mailto:${value}`;
  if (item.kind === "whatsapp") {
    const number = digits(value);
    if (!number) return undefined;
    return item.message
      ? `https://wa.me/${number}?text=${encodeURIComponent(item.message)}`
      : `https://wa.me/${number}`;
  }
  const number = value.replace(/[^0-9+]/g, "");
  return number ? `tel:${number}` : undefined;
}

function Channel({ item }: { item: ContactChannelItem }) {
  const href = hrefFor(item);
  const emergency = item.kind === "emergency";
  const whatsapp = item.kind === "whatsapp";
  const iconName = item.icon && isIconName(item.icon) ? item.icon : KIND_ICON[item.kind];

  const tone = emergency
    ? "border-accent/40 bg-accent/5 hover:border-accent"
    : whatsapp
      ? "border-green-200 bg-green-50/60 hover:border-green-500"
      : "border-gray-100 bg-white hover:border-primary";
  const iconTone = emergency
    ? "bg-accent text-white"
    : whatsapp
      ? "bg-green-600 text-white"
      : "bg-primary/5 text-primary";

  const content = (
    <>
      <div className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center ${iconTone}`}>
        <LucideIcon name={iconName} className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className={`text-xs font-semibold uppercase tracking-wide ${emergency ? "text-accent-700" : "text-gray-500"}`}>
          {emergency ? KIND_LABEL.emergency : KIND_LABEL[item.kind]}
        </p>
        <h3 className="font-semibold text-primary">{item.label}</h3>
        {item.value ? (
          <p className={`mt-0.5 font-medium ${emergency ? "text-accent-700 text-lg" : "text-ink"}`}>{item.value}</p>
        ) : (
          <p className="mt-0.5 text-sm text-gray-500 italic">Número a confirmar</p>
        )}
        {item.note && <p className="text-sm text-gray-600 mt-1">{item.note}</p>}
      </div>
    </>
  );

  const className = `flex items-start gap-3 rounded border p-4 shadow-sm transition-all duration-300 ${tone} ${
    href ? "hover:shadow-md hover:-translate-y-0.5" : "opacity-90"
  }`;

  if (!href) return <div className={className}>{content}</div>;

  const external = href.startsWith("http");
  return (
    <a
      href={href}
      className={className}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {content}
    </a>
  );
}

export default function ContactChannels({ heading, text, columns = 3, items }: ContactChannelsProps) {
  const list = items ?? [];
  if (list.length === 0) return null;
  const cols = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[columns];
  return (
    <section className="container-x section-y-md">
      {heading && <h2 className="text-2xl md:text-3xl font-bold text-primary mb-2">{heading}</h2>}
      {text && <p className="text-gray-600 mb-6 max-w-2xl">{text}</p>}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${cols} gap-4`}>
        {list.map((item, i) => <Channel key={`${item.kind}-${item.label}-${i}`} item={item} />)}
      </div>
    </section>
  );
}
