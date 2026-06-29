import type { HeroProps } from "@sa/shared/blocks";
import { Link } from "react-router-dom";

export default function Hero(p: HeroProps) {
  const variant = p.variant ?? "centered";
  const alignment = variant === "left" ? "text-left" : "text-center";
  return (
    <section className="relative bg-gradient-to-br from-primary to-secondary text-white">
      {p.imageUrl && (
        <div className="absolute inset-0">
          <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black" style={{ opacity: (p.overlay ?? 40) / 100 }} />
        </div>
      )}
      <div className={`relative container-x py-20 md:py-28 ${alignment}`}>
        <h1 className="text-3xl md:text-5xl font-bold mb-4">{p.title}</h1>
        {p.subtitle && <p className="text-lg md:text-xl opacity-95 max-w-2xl mx-auto">{p.subtitle}</p>}
        {p.ctaLabel && p.ctaHref && (
          <Link to={p.ctaHref} className="inline-block mt-6 bg-white text-primary px-6 py-3 rounded font-semibold hover:bg-gray-100">
            {p.ctaLabel}
          </Link>
        )}
      </div>
    </section>
  );
}
