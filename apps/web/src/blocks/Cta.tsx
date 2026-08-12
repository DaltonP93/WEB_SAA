import { Link } from "react-router-dom";
import type { CtaProps } from "@sa/shared/blocks";
import LucideIcon from "../components/LucideIcon";

type Variant = NonNullable<CtaProps["variant"]>;

const VARIANT_BG: Record<Variant, string> = {
  accent: "bg-accent text-white",
  primary: "bg-primary text-white",
  secondary: "bg-secondary-700 text-white",
  muted: "bg-gray-100 text-ink",
};

const VARIANT_BTN: Record<Variant, string> = {
  accent: "bg-white text-accent-700 hover:bg-gray-100",
  primary: "bg-white text-primary hover:bg-gray-100",
  secondary: "bg-white text-secondary-700 hover:bg-gray-100",
  muted: "bg-primary text-white hover:opacity-90",
};

export default function Cta(p: CtaProps) {
  // El rojo (accent) queda reservado para Emergencias: hay que pedirlo explícito.
  const variant: Variant = p.variant ?? "primary";
  const sectionBg = VARIANT_BG[variant];
  const btnClass = VARIANT_BTN[variant];
  const href = p.ctaHref ?? "#";
  const isInternal = href.startsWith("/");
  const linkClass = `px-6 py-3 rounded font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 whitespace-nowrap ${btnClass}`;

  return (
    <section
      className={`${sectionBg} section-y-md`}
      style={p.background ? { background: p.background } : undefined}
    >
      <div className="container-x flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          {variant === "accent" && (
            <span className="hidden sm:flex w-11 h-11 shrink-0 rounded-full bg-white/15 items-center justify-center">
              <LucideIcon name="siren" className="w-6 h-6" />
            </span>
          )}
          <div>
            <h2 className="text-2xl font-bold">{p.title}</h2>
            {p.text && <p className="opacity-95 mt-1">{p.text}</p>}
          </div>
        </div>
        {isInternal ? (
          <Link to={href} className={linkClass}>{p.ctaLabel}</Link>
        ) : (
          <a
            href={href}
            className={linkClass}
            {...(/^https?:\/\//i.test(href) ? { target: "_blank", rel: "noreferrer" } : {})}
          >
            {p.ctaLabel}
          </a>
        )}
      </div>
    </section>
  );
}
