import type { HeroProps } from "@sa/shared/blocks";
import { Link } from "react-router-dom";

/**
 * CTA del hero. El principal usa el cyan institucional (mismo color que
 * "Reservar turno" en el resto del sitio); el secundario, contorno blanco.
 * Nunca rojo: ese color es sólo de Emergencias.
 */
function CTA({ to, label, variant = "primary" }: { to: string; label: string; variant?: "primary" | "outline" }) {
  const base = "px-6 py-3 text-base";
  const isExternal = /^https?:\/\//i.test(to) || to.startsWith("tel:") || to.startsWith("mailto:");

  const className =
    variant === "outline"
      ? `btn ${base} border-2 border-white text-white hover:bg-white hover:text-primary active:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary`
      : `btn-turno-on-dark ${base}`;

  if (isExternal) {
    return (
      <a href={to} className={className} {...(to.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
        {label}
      </a>
    );
  }
  return (
    <Link to={to} className={className}>
      {label}
    </Link>
  );
}

export default function Hero(p: HeroProps) {
  const requestedVariant = p.variant ?? "centered";
  const variant = requestedVariant === "split" && !p.imageUrl ? "centered" : requestedVariant;
  const showImage = variant === "split" && !!p.imageUrl;
  const alignment = variant === "left" || showImage ? "text-left" : "text-center";
  const useAnimated = p.animatedBg ?? false;

  const bgClass = useAnimated ? "hero-animated-bg" : "bg-gradient-to-br from-primary to-secondary";
  const overlay = (p.overlay ?? 40) / 100;

  const content = (
    <>
      {p.eyebrow && (
        <span className="inline-block mb-4 text-xs md:text-sm uppercase tracking-[0.18em] font-semibold text-white/90 border border-white/30 rounded-full px-3 py-1">
          {p.eyebrow}
        </span>
      )}
      <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold mb-4 text-balance text-white">
        {p.title}
      </h1>
      {p.subtitle && (
        <p className={`text-lg md:text-xl opacity-95 max-w-2xl ${variant === "centered" ? "mx-auto" : ""}`}>
          {p.subtitle}
        </p>
      )}
      {(p.ctaLabel || p.secondaryCtaLabel) && (
        <div className={`mt-6 flex flex-wrap gap-3 ${variant === "centered" ? "justify-center" : ""}`}>
          {p.ctaLabel && p.ctaHref && <CTA to={p.ctaHref} label={p.ctaLabel} variant="primary" />}
          {p.secondaryCtaLabel && p.secondaryCtaHref && (
            <CTA to={p.secondaryCtaHref} label={p.secondaryCtaLabel} variant="outline" />
          )}
        </div>
      )}
    </>
  );

  if (showImage) {
    return (
      <section className="relative text-white">
        <div className={`absolute inset-0 ${bgClass}`} />
        <div className="relative container-x grid md:grid-cols-2 gap-8 items-center py-16 md:py-24">
          <div className={alignment}>{content}</div>
          <div className="relative">
            <div className="aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl border border-white/20">
              <img
                src={p.imageUrl}
                alt=""
                className="w-full h-full object-cover"
                loading="eager"
                decoding="async"
              />
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`relative ${bgClass} text-white`}>
      {p.imageUrl && (
        <div className="absolute inset-0">
          <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black" style={{ opacity: overlay }} />
        </div>
      )}
      <div className={`relative container-x py-20 md:py-28 ${alignment}`}>
        {content}
      </div>
    </section>
  );
}
