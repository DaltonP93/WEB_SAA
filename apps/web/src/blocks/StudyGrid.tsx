import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { StudyGridProps } from "@sa/shared/blocks";
import LucideIcon from "../components/LucideIcon";
import SkeletonCard from "../components/SkeletonCard";
import { resolveIcon } from "../lib/icons";
import { studyHref, usePageSlugs } from "../lib/links";

interface StudyRow {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
}

const GROUPS: { key: string; title: string; icon: string }[] = [
  { key: "laboratorio", title: "Laboratorio clínico y bacteriológico", icon: "flask-conical" },
  { key: "imagenes", title: "Estudios por imágenes", icon: "scan" },
  { key: "cardiologicos", title: "Estudios cardiológicos", icon: "heart-pulse" },
  { key: "biopsias", title: "Biopsias y anatomía patológica", icon: "microscope" },
];

function StudyCard({ s, href }: { s: StudyRow; href?: string }) {
  const inner = (
    <>
      <div className="w-10 h-10 shrink-0 rounded-full bg-secondary/10 text-secondary-700 flex items-center justify-center">
        <LucideIcon name={resolveIcon("study", s)} className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold text-primary">{s.name}</h3>
        {s.description && <p className="text-sm text-gray-600 mt-1">{s.description}</p>}
      </div>
    </>
  );
  const className =
    "group flex items-start gap-3 bg-white border border-gray-100 rounded p-4 shadow-sm hover:shadow-md hover:border-secondary-200 hover:-translate-y-0.5 transition-all duration-300";
  return href ? (
    <Link to={href} className={className}>{inner}</Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

export default function StudyGrid({ columns = 3, showCount, grouped, heading, category }: StudyGridProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["studies"],
    queryFn: async () => (await api.get("/public/studies")).data as StudyRow[],
  });
  const pageSlugs = usePageSlugs();
  const all = category ? (data ?? []).filter((s) => s.category === category) : data ?? [];
  const cols = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[columns];

  if (isLoading) {
    return (
      <section className="container-x section-y-md">
        <div className={`grid grid-cols-1 ${cols} gap-5`}>
          <SkeletonCard count={6} />
        </div>
      </section>
    );
  }

  // Sin estudios publicados no inventamos un catálogo: se avisa que la
  // información está en confirmación.
  if (all.length === 0) {
    return (
      <section className="container-x section-y-md">
        {heading && <h2 className="text-2xl md:text-3xl font-bold text-center mb-6 text-primary">{heading}</h2>}
        <div className="rounded border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <p className="font-semibold text-primary">Información a confirmar con el sanatorio</p>
          <p className="text-sm text-gray-600 mt-1">
            Estamos revisando el listado de estudios disponibles. Consultanos por los canales de
            contacto y te confirmamos el estudio que necesitás.
          </p>
        </div>
      </section>
    );
  }

  if (!grouped) {
    const items = showCount ? all.slice(0, showCount) : all;
    return (
      <section className="container-x section-y-md">
        {heading && <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 text-primary">{heading}</h2>}
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${cols} gap-4`}>
          {items.map((s) => <StudyCard key={s.id} s={s} href={studyHref(s, pageSlugs)} />)}
        </div>
      </section>
    );
  }

  const known = new Set(GROUPS.map((g) => g.key));
  const sections = [
    ...GROUPS.map((g) => ({
      title: g.title,
      icon: g.icon,
      items: all.filter((s) => s.category === g.key),
    })),
    { title: "Otros estudios", icon: "clipboard-check", items: all.filter((s) => !known.has(s.category ?? "")) },
  ].filter((sec) => sec.items.length > 0);

  return (
    <section className="container-x section-y-md space-y-10">
      {heading && <h2 className="text-2xl md:text-3xl font-bold text-center text-primary">{heading}</h2>}
      {sections.map((sec) => (
        <div key={sec.title}>
          <div className="flex items-center gap-2 mb-5 pb-2 border-b border-gray-100">
            <span className="w-8 h-8 rounded-full bg-primary/5 text-primary flex items-center justify-center">
              <LucideIcon name={sec.icon} className="w-4 h-4" />
            </span>
            <h3 className="text-xl font-bold text-primary">{sec.title}</h3>
            <span className="ml-auto text-xs text-gray-500">{sec.items.length} estudios</span>
          </div>
          <div className={`grid grid-cols-1 sm:grid-cols-2 ${cols} gap-4`}>
            {sec.items.map((s) => <StudyCard key={s.id} s={s} href={studyHref(s, pageSlugs)} />)}
          </div>
        </div>
      ))}
    </section>
  );
}
