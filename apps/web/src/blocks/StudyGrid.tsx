import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { StudyGridProps } from "@sa/shared/blocks";

const GROUPS: { key: string; title: string }[] = [
  { key: "laboratorio", title: "Laboratorio" },
  { key: "imagenes", title: "Estudios por imágenes" },
];

function StudyCard({ s }: { s: any }) {
  return (
    <div className="bg-white border rounded p-5 hover:shadow transition">
      <h3 className="font-semibold text-primary">{s.name}</h3>
      {s.description && <p className="text-sm text-gray-600 mt-2">{s.description}</p>}
    </div>
  );
}

export default function StudyGrid({ columns = 3, showCount, grouped }: StudyGridProps) {
  const { data } = useQuery({
    queryKey: ["studies"],
    queryFn: async () => (await api.get("/public/studies")).data,
  });
  const all = (data ?? []) as any[];
  const cols = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[columns];

  if (!grouped) {
    const items = showCount ? all.slice(0, showCount) : all;
    return (
      <section className="container-x py-12">
        <div className={`grid grid-cols-1 ${cols} gap-5`}>
          {items.map((s: any) => <StudyCard key={s.id} s={s} />)}
        </div>
      </section>
    );
  }

  const known = new Set(GROUPS.map((g) => g.key));
  const sections = [
    ...GROUPS.map((g) => ({ title: g.title, items: all.filter((s) => s.category === g.key) })),
    { title: "Otros estudios", items: all.filter((s) => !known.has(s.category)) },
  ].filter((sec) => sec.items.length > 0);

  return (
    <section className="container-x py-12 space-y-10">
      {sections.map((sec) => (
        <div key={sec.title}>
          <h2 className="text-xl font-bold text-primary mb-5">{sec.title}</h2>
          <div className={`grid grid-cols-1 ${cols} gap-5`}>
            {sec.items.map((s: any) => <StudyCard key={s.id} s={s} />)}
          </div>
        </div>
      ))}
    </section>
  );
}
