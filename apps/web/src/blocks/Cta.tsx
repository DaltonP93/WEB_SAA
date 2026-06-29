import { Link } from "react-router-dom";
import type { CtaProps } from "@sa/shared/blocks";

type Variant = NonNullable<CtaProps["variant"]>;

const VARIANT_BG: Record<Variant, string> = {
  accent: "bg-accent text-white",
  primary: "bg-primary text-white",
  secondary: "bg-secondary text-white",
  muted: "bg-gray-100 text-ink",
};

const VARIANT_BTN: Record<Variant, string> = {
  accent: "bg-white text-accent hover:bg-gray-100",
  primary: "bg-white text-primary hover:bg-gray-100",
  secondary: "bg-white text-secondary hover:bg-gray-100",
  muted: "bg-primary text-white hover:opacity-90",
};

export default function Cta(p: CtaProps) {
  const variant: Variant = p.variant ?? "accent";
  const sectionBg = VARIANT_BG[variant];
  const btnClass = VARIANT_BTN[variant];

  return (
    <section
      className={`${sectionBg} section-y-md`}
      style={p.background ? { background: p.background } : undefined}
    >
      <div className="container-x flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{p.title}</h2>
          {p.text && <p className="opacity-95 mt-1">{p.text}</p>}
        </div>
        <Link
          to={p.ctaHref}
          className={`px-6 py-3 rounded font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${btnClass}`}
        >
          {p.ctaLabel}
        </Link>
      </div>
    </section>
  );
}
