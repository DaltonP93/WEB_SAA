import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export default function SpecialtyDetailPage() {
  const { slug } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["specialty", slug],
    queryFn: async () => (await api.get(`/public/specialties/${slug}`)).data,
  });
  if (isLoading) return <div className="container-x py-12">Cargando…</div>;
  if (!data) return <div className="container-x py-12">No encontrada.</div>;
  return (
    <>
      <section className="bg-primary text-white py-12">
        <div className="container-x">
          <h1 className="text-3xl md:text-4xl font-bold">{data.name}</h1>
          {data.description && <p className="opacity-90 mt-1 max-w-2xl">{data.description}</p>}
        </div>
      </section>
      <section className="container-x py-10">
        <h2 className="text-xl font-bold mb-4">Profesionales</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {(data.doctors ?? []).map((d: any) => (
            <div key={d.id} className="bg-white rounded shadow p-4 hover:shadow-lg transition flex flex-col">
              <Link to={`/profesionales/${d.slug}`} className="flex-1">
                <div className="aspect-square mb-3 rounded overflow-hidden bg-gray-100">
                  {d.photoUrl ? <img src={d.photoUrl} alt={d.name} loading="lazy" decoding="async" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-3xl text-gray-400">👤</div>}
                </div>
                <h3 className="font-semibold text-primary mb-3">{d.name}</h3>
              </Link>
              <Link
                to={`/turnos?doctor=${encodeURIComponent(d.slug)}`}
                className="mt-auto block text-center text-xs font-semibold py-2 rounded bg-secondary text-white hover:opacity-90 transition"
              >
                Reservar turno
              </Link>
            </div>
          ))}
        </div>
        {(data.doctors ?? []).length === 0 && (
          <p className="text-sm text-gray-500">No hay profesionales cargados en esta especialidad todavía.</p>
        )}
      </section>
    </>
  );
}
