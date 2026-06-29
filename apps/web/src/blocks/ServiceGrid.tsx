import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { ServiceGridProps } from "@sa/shared/blocks";
import SkeletonCard from "../components/SkeletonCard";

export default function ServiceGrid({ columns = 3, showCount }: ServiceGridProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["services"],
    queryFn: async () => (await api.get("/public/services")).data,
  });
  const items = showCount ? (data ?? []).slice(0, showCount) : data ?? [];
  const cols = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[columns];
  return (
    <section className="bg-gray-50 section-y-md">
      <div className="container-x">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 text-primary">Servicios</h2>
        {isLoading ? (
          <div className={`grid grid-cols-1 ${cols} gap-5`}>
            <SkeletonCard count={6} />
          </div>
        ) : (
          <div className={`grid grid-cols-1 ${cols} gap-5`}>
            {items.map((s: any) => (
              <div key={s.id} className="group bg-white rounded shadow p-5 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                <h3 className="font-semibold text-primary">{s.name}</h3>
                {s.description && <p className="text-sm text-gray-600 mt-2">{s.description}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
