import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CardItem, CardsProps } from "@sa/shared/blocks";
import LucideIcon, { isIconName } from "../components/LucideIcon";
import { isInternalHref, isSafeExternalHref, safeInternalHref } from "../lib/url";

function CardIcon({ icon }: { icon: string }) {
  return (
    <div className="w-11 h-11 rounded-full bg-secondary/10 text-secondary-700 flex items-center justify-center mb-3 group-hover:bg-secondary/20 transition">
      {isIconName(icon) ? <LucideIcon name={icon} className="w-5 h-5" /> : <span className="text-xl leading-none">{icon}</span>}
    </div>
  );
}

function CardShell({ item, children }: { item: CardItem; children: ReactNode }) {
  const className =
    "group block bg-white rounded shadow-sm border border-gray-100 hover:shadow-lg hover:border-primary-100 hover:-translate-y-1 transition-all duration-300 overflow-hidden";
  const href = item.href?.trim();
  if (!href) return <div className={className}>{children}</div>;
  // Los enlaces internos usan el router; los externos (tel:, mailto:, http) un <a>.
  if (isInternalHref(href)) {
    return <Link to={safeInternalHref(href)} className={className}>{children}</Link>;
  }
  if (!isSafeExternalHref(href)) return <div className={className}>{children}</div>;
  const external = /^https?:\/\//i.test(href);
  return (
    <a href={href} className={className} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}

export default function Cards({ columns, items, heading }: CardsProps) {
  const cols = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[columns];
  return (
    <section className="container-x section-y-md">
      {heading && <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 text-primary">{heading}</h2>}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${cols} gap-5`}>
        {items.map((it, i) => (
          <CardShell key={i} item={it}>
            {it.imageUrl && (
              <img
                src={it.imageUrl}
                alt={it.title}
                className="w-full h-44 object-cover group-hover:scale-105 transition-transform duration-300"
              />
            )}
            <div className="p-5">
              {it.icon && !it.imageUrl && <CardIcon icon={it.icon} />}
              <h3 className="font-semibold text-primary">{it.title}</h3>
              {it.text && <p className="text-sm text-gray-600 mt-1">{it.text}</p>}
            </div>
          </CardShell>
        ))}
      </div>
    </section>
  );
}
