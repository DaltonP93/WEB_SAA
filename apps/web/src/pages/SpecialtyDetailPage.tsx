import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import Avatar from "../components/Avatar";
import LucideIcon from "../components/LucideIcon";
import { resolveIcon } from "../lib/icons";
import PageSkeleton from "../components/PageSkeleton";

export default function SpecialtyDetailPage() {
  const { slug } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["specialty", slug],
    queryFn: async () => (await api.get(`/public/specialties/${slug}`)).data,
  });
  if (isLoading) return <PageSkeleton />;
  if (!data) return <div className="container-x py-12">No encontrada.</div>;
  const doctors = data.doctors ?? [];
  return (
    <>
      <section className="bg-primary text-white py-12">
        <div className="container-x">
          <div className="flex items-center gap-4">
            <span className="w-14 h-14 shrink-0 rounded-full bg-white/10 flex items-center justify-center">
              <LucideIcon name={resolveIcon("specialty", data)} className="w-7 h-7" />
            </span>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold">{data.name}</h1>
              {data.description && <p className="opacity-90 mt-1 max-w-2xl">{data.description}</p>}
            </div>
          </div>
        </div>
      </section>
      <section className="container-x py-10">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="text-xl font-bold text-primary">
            Profesionales {doctors.length > 0 && <span className="text-gray-500 font-normal">({doctors.length})</span>}
          </h2>
          <Link to="/especialidades" className="text-sm text-primary hover:underline">
            ← Ver todas las especialidades
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {doctors.map((d: any) => (
            <article key={d.id} className="group bg-white rounded shadow p-4 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <Link to={`/profesionales/${d.slug}`} className="flex-1">
                <div className="aspect-square mb-3 rounded overflow-hidden bg-gray-100">
                  <Avatar src={d.photoUrl} alt={d.name} size="full" rounded={false} />
                </div>
                <h3 className="font-semibold text-primary mb-3">{d.name}</h3>
              </Link>
              <div className="mt-auto grid gap-2">
                <Link
                  to={`/profesionales/${d.slug}`}
                  className="block text-center text-xs font-semibold py-2 rounded border border-primary text-primary hover:bg-primary hover:text-white transition"
                >
                  Más información
                </Link>
                <Link to={`/turnos?doctor=${encodeURIComponent(d.slug)}`} className="btn-turno btn-sm w-full">
                  Reservar turno
                </Link>
              </div>
            </article>
          ))}
        </div>
        {doctors.length === 0 && (
          <p className="text-sm text-gray-500">No hay profesionales cargados en esta especialidad todavía.</p>
        )}
      </section>
    </>
  );
}
