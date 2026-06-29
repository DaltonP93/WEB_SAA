import { Link } from "react-router-dom";
import type { CtaProps } from "@sa/shared/blocks";

export default function Cta(p: CtaProps) {
  return (
    <section className="bg-accent text-white py-12" style={p.background ? { background: p.background } : undefined}>
      <div className="container-x flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{p.title}</h2>
          {p.text && <p className="opacity-95 mt-1">{p.text}</p>}
        </div>
        <Link to={p.ctaHref} className="bg-white text-primary px-6 py-3 rounded font-semibold hover:bg-gray-100">
          {p.ctaLabel}
        </Link>
      </div>
    </section>
  );
}
