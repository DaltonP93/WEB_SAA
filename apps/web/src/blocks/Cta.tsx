import { Link } from "react-router-dom";
import type { CtaProps } from "@sa/shared/blocks";
import { isEmergencyCta } from "@sa/shared/institutional-red";
import LucideIcon from "../components/LucideIcon";
import { isInternalHref, isSafeExternalHref, safeInternalHref } from "../lib/url";

type Variant = NonNullable<CtaProps["variant"]>;

const VARIANT_BG: Record<Variant, string> = {
  emergency: "bg-accent text-white",
  primary: "bg-primary text-white",
  secondary: "bg-secondary-700 text-white",
  muted: "bg-gray-100 text-ink",
};

const VARIANT_BTN: Record<Variant, string> = {
  emergency: "bg-white text-accent-700 hover:bg-gray-100",
  primary: "bg-white text-primary hover:bg-gray-100",
  secondary: "bg-white text-secondary-700 hover:bg-gray-100",
  muted: "bg-primary text-white hover:opacity-90",
};

export default function Cta(p: CtaProps) {
  /*
   * El rojo institucional es exclusivo de Emergencias y sólo lo enciende
   * `variant: "emergency"`. Cualquier otro valor —incluida la variante
   * histórica "accent" que quedó en contenido viejo— cae en primary. No hay
   * override de color: el `background` libre se retiró.
   *
   * "Exclusivo de Emergencias" no significa "Emergencias todo rojo": la franja
   * full-width coral cortaba el home (navy + cyan sobre blanco) de forma
   * agresiva. Desde acá `emergency` se dibuja como tarjeta —borde, ícono,
   * título y botón en coral sobre fondo claro—, el mismo lenguaje que ya usa
   * la tarjeta del canal `emergencias` en ContactChannels.tsx. El servicio
   * sigue siendo el único elemento rojo del sitio; sólo baja la proporción.
   * Las demás variantes siguen siendo franjas de color a ancho completo.
   */
  const requested = p.variant as string | undefined;
  let variant: Variant = requested && requested in VARIANT_BG ? (requested as Variant) : "primary";
  // El rojo no se hereda de la fila: se vuelve a comprobar acá. Un bloque
  // viejo —o escrito fuera de la API— puede traer `variant: "emergency"` con
  // destino /turnos, y confiar en el dato guardado lo pintaba de rojo igual.
  if (variant === "emergency" && !isEmergencyCta(p)) variant = "primary";
  const sectionBg = VARIANT_BG[variant];
  const btnClass = VARIANT_BTN[variant];
  const isEmergency = variant === "emergency";
  const raw = p.ctaHref ?? "#";
  const isInternal = isInternalHref(raw);
  // Un destino externo que no sea http(s)/mailto/tel no se enlaza.
  const href = isInternal || isSafeExternalHref(raw) ? raw : "#";
  const linkClass = isEmergency
    ? "btn-emergency btn-lg whitespace-nowrap"
    : `px-6 py-3 rounded font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 whitespace-nowrap ${btnClass}`;

  // Las reglas de URL no se duplican entre los dos layouts: el enlace se arma
  // una sola vez y cada layout lo coloca donde corresponde.
  const cta = isInternal ? (
    <Link to={safeInternalHref(href)} className={linkClass}>{p.ctaLabel}</Link>
  ) : (
    <a
      href={href}
      className={linkClass}
      {...(/^https?:\/\//i.test(href) ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {p.ctaLabel}
    </a>
  );

  if (isEmergency) {
    return (
      <section className="bg-white section-y-md">
        <div className="container-x">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 rounded-lg border border-accent/30 border-l-4 border-l-accent bg-accent-50/60 shadow-sm p-6 sm:p-8">
            <div className="flex items-start gap-3">
              {/* En la tarjeta el ícono es la señal de identidad del servicio,
                  no un adorno: también se muestra en mobile. */}
              <span className="flex w-11 h-11 shrink-0 rounded-full bg-accent text-white items-center justify-center">
                <LucideIcon name="siren" className="w-6 h-6" />
              </span>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-accent-700">{p.title}</h2>
                {p.text && <p className="mt-1 text-gray-700">{p.text}</p>}
              </div>
            </div>
            {cta}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`${sectionBg} section-y-md`}>
      <div className="container-x flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div>
            <h2 className="text-2xl font-bold">{p.title}</h2>
            {p.text && <p className="opacity-95 mt-1">{p.text}</p>}
          </div>
        </div>
        {cta}
      </div>
    </section>
  );
}
