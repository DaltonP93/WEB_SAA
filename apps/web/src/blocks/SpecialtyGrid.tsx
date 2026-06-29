import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { SpecialtyGridProps } from "@sa/shared/blocks";
import type { Specialty } from "@sa/shared";

export default function SpecialtyGrid({ columns = 4, showCount }: SpecialtyGridProps) {
  const { data } = useQuery({
    queryKey: ["specialties"],
    queryFn: async () => (await api.get("/public/specialties")).data as Specialty[],
  });
  const items = showCount ? (data ?? []).slice(0, showCount) : data ?? [];
  const cols = { 3: "md:grid-cols-3", 4: "md:grid-cols-4", 6: "md:grid-cols-6" }[columns];
  return (
    <section className="container-x py-12">
      <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 text-primary">Especialidades</h2>
      <div className={`grid grid-cols-2 ${cols} gap-4`}>
        {items.map((s) => (
          <Link to={`/especialidades/${s.slug}`} key={s.id} className="bg-white rounded shadow p-5 text-center hover:shadow-lg hover:-translate-y-0.5 transition">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-secondary/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-secondary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
            </div>
            <h3 className="font-semibold text-sm">{s.name}</h3>
          </Link>
        ))}
      </div>
    </section>
  );
}
