import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { SpecialtyGridProps } from "@sa/shared/blocks";
import type { Specialty } from "@sa/shared";
import LucideIcon from "../components/LucideIcon";
import SkeletonCard from "../components/SkeletonCard";
import { resolveIcon } from "../lib/icons";

export default function SpecialtyGrid({
  columns = 4,
  showCount,
  heading = "Especialidades médicas",
  compact = false,
}: SpecialtyGridProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["specialties"],
    queryFn: async () => (await api.get("/public/specialties")).data as Specialty[],
  });
  const all = data ?? [];
  const items = showCount ? all.slice(0, showCount) : all;
  const cols = { 3: "md:grid-cols-3", 4: "md:grid-cols-4", 6: "md:grid-cols-6" }[columns];

  return (
    <section className="container-x section-y-md">
      {heading && (
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-2 text-primary">{heading}</h2>
      )}
      {!isLoading && all.length > 0 && (
        <p className="text-center text-sm text-gray-600 mb-8">
          {all.length} especialidades · elegí una para ver sus profesionales
        </p>
      )}
      {isLoading ? (
        <div className={`grid grid-cols-2 ${cols} gap-4`}>
          <SkeletonCard count={8} variant="compact" />
        </div>
      ) : compact ? (
        <div className="flex flex-wrap gap-2 justify-center">
          {items.map((s) => (
            <Link
              key={s.id}
              to={`/especialidades/${s.slug}`}
              className="inline-flex items-center gap-2 rounded-full border border-primary-100 bg-white px-4 py-2 text-sm hover:border-primary hover:text-primary hover:shadow-sm transition"
            >
              <LucideIcon name={resolveIcon("specialty", s)} className="w-4 h-4 text-secondary-700" />
              {s.name}
            </Link>
          ))}
        </div>
      ) : (
        <div className={`grid grid-cols-2 ${cols} gap-4`}>
          {items.map((s) => (
            <Link
              to={`/especialidades/${s.slug}`}
              key={s.id}
              className="group bg-white rounded shadow p-5 text-center hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
            >
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-secondary/10 flex items-center justify-center text-secondary-700 group-hover:bg-secondary/20 transition">
                <LucideIcon name={resolveIcon("specialty", s)} className="w-6 h-6" />
              </div>
              <h3 className="font-semibold text-sm">{s.name}</h3>
            </Link>
          ))}
        </div>
      )}
      {showCount && all.length > items.length && (
        <div className="text-center mt-8">
          <Link to="/especialidades" className="btn-outline btn-sm">
            Ver todas las especialidades
          </Link>
        </div>
      )}
    </section>
  );
}
