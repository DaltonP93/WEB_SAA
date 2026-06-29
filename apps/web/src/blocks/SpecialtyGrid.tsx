import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { SpecialtyGridProps } from "@sa/shared/blocks";
import type { Specialty } from "@sa/shared";
import LucideIcon, { isIconName } from "../components/LucideIcon";
import SkeletonCard from "../components/SkeletonCard";

const SLUG_ICON: Record<string, string> = {
  cardiologia: "heart-pulse",
  pediatria: "baby",
  "ginecologia-y-obstetricia": "venus",
  traumatologia: "bone",
  neurologia: "brain",
  oftalmologia: "eye",
  otorrinolaringologia: "ear",
  urologia: "droplet",
  dermatologia: "scan-face",
  endocrinologia: "pill",
  gastroenterologia: "microscope",
  nefrologia: "droplets",
  neumologia: "lungs",
  oncologia: "ribbon",
  psiquiatria: "brain-circuit",
  reumatologia: "activity",
  "cirugia-general": "scissors",
  "medicina-interna": "stethoscope",
  "medicina-familiar": "users",
  anestesiologia: "syringe",
};

function resolveIcon(s: Specialty): string {
  if (s.icon && isIconName(s.icon)) return s.icon;
  const fallback = SLUG_ICON[s.slug];
  if (fallback && isIconName(fallback)) return fallback;
  return "stethoscope";
}

export default function SpecialtyGrid({ columns = 4, showCount }: SpecialtyGridProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["specialties"],
    queryFn: async () => (await api.get("/public/specialties")).data as Specialty[],
  });
  const items = showCount ? (data ?? []).slice(0, showCount) : data ?? [];
  const cols = { 3: "md:grid-cols-3", 4: "md:grid-cols-4", 6: "md:grid-cols-6" }[columns];
  return (
    <section className="container-x section-y-md">
      <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 text-primary">Especialidades</h2>
      {isLoading ? (
        <div className={`grid grid-cols-2 ${cols} gap-4`}>
          <SkeletonCard count={8} variant="compact" />
        </div>
      ) : (
        <div className={`grid grid-cols-2 ${cols} gap-4`}>
          {items.map((s) => {
            const iconName = resolveIcon(s);
            return (
              <Link to={`/especialidades/${s.slug}`} key={s.id} className="group bg-white rounded shadow p-5 text-center hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-secondary/10 flex items-center justify-center text-secondary">
                  <LucideIcon name={iconName} className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-sm">{s.name}</h3>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
