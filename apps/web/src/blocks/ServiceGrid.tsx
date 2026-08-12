import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { ServiceGridProps } from "@sa/shared/blocks";
import type { Service } from "@sa/shared";
import LucideIcon from "../components/LucideIcon";
import SkeletonCard from "../components/SkeletonCard";
import { resolveIcon } from "../lib/icons";
import { serviceHref, usePageSlugs } from "../lib/links";

function CardBody({ s, compact }: { s: Service; compact: boolean }) {
  return (
    <>
      <div
        className={`${compact ? "w-10 h-10" : "w-12 h-12"} shrink-0 rounded-full bg-primary/5 text-primary flex items-center justify-center group-hover:bg-primary/10 transition`}
      >
        <LucideIcon name={resolveIcon("service", s)} className={compact ? "w-5 h-5" : "w-6 h-6"} />
      </div>
      <div className="min-w-0">
        <h3 className={`font-semibold text-primary ${compact ? "text-sm" : ""}`}>{s.name}</h3>
        {s.description && !compact && <p className="text-sm text-gray-600 mt-1">{s.description}</p>}
      </div>
    </>
  );
}

export default function ServiceGrid({
  columns = 3,
  showCount,
  heading = "Servicios",
  compact = false,
}: ServiceGridProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["services"],
    queryFn: async () => (await api.get("/public/services")).data as Service[],
  });
  const pageSlugs = usePageSlugs();
  const all = data ?? [];
  const items = showCount ? all.slice(0, showCount) : all;
  const cols = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[columns];
  const cardClass = `group flex items-start gap-3 bg-white rounded border border-gray-100 shadow-sm hover:shadow-md hover:border-primary-100 hover:-translate-y-0.5 transition-all duration-300 ${
    compact ? "p-3 items-center" : "p-5"
  }`;

  return (
    <section className="bg-gray-50 section-y-md">
      <div className="container-x">
        {heading && (
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 text-primary">{heading}</h2>
        )}
        {isLoading ? (
          <div className={`grid grid-cols-1 ${cols} gap-4`}>
            <SkeletonCard count={6} />
          </div>
        ) : (
          <div className={`grid grid-cols-1 sm:grid-cols-2 ${cols} gap-4`}>
            {items.map((s) => {
              const href = serviceHref(s.slug, pageSlugs);
              return href ? (
                <Link key={s.id} to={href} className={cardClass}>
                  <CardBody s={s} compact={compact} />
                </Link>
              ) : (
                <div key={s.id} className={cardClass}>
                  <CardBody s={s} compact={compact} />
                </div>
              );
            })}
          </div>
        )}
        {showCount && all.length > items.length && (
          <div className="text-center mt-8">
            <Link to="/servicios" className="btn-outline btn-sm">
              Ver todos los servicios
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
