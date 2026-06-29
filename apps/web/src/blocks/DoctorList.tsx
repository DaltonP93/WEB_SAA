import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { DoctorListProps } from "@sa/shared/blocks";
import type { Doctor, Specialty } from "@sa/shared";

export default function DoctorList({ showSearch = true, limit }: DoctorListProps) {
  const [q, setQ] = useState("");
  const [spec, setSpec] = useState("");

  const specs = useQuery({
    queryKey: ["specialties"],
    queryFn: async () => (await api.get("/public/specialties")).data as Specialty[],
  });
  const doctors = useQuery({
    queryKey: ["doctors", q, spec],
    queryFn: async () =>
      (await api.get("/public/doctors", { params: { q: q || undefined, specialty: spec || undefined } })).data as Doctor[],
  });

  const items = limit ? (doctors.data ?? []).slice(0, limit) : doctors.data ?? [];

  return (
    <section className="container-x py-10">
      {showSearch && (
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar médico por nombre…"
            className="border rounded px-3 py-2 flex-1"
            aria-label="Buscar médico"
          />
          <select value={spec} onChange={(e) => setSpec(e.target.value)} className="border rounded px-3 py-2" aria-label="Filtrar por especialidad">
            <option value="">Todas las especialidades</option>
            {(specs.data ?? []).map((s) => (
              <option key={s.id} value={s.slug}>{s.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {items.map((d) => (
          <div key={d.id} className="bg-white rounded shadow p-4 hover:shadow-lg transition flex flex-col">
            <Link to={`/profesionales/${d.slug}`} className="flex-1">
              <div className="aspect-square mb-3 rounded overflow-hidden bg-gray-100">
                {d.photoUrl ? <img src={d.photoUrl} alt={d.name} loading="lazy" decoding="async" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-3xl text-gray-400">👤</div>}
              </div>
              <h3 className="font-semibold text-primary">{d.name}</h3>
              <p className="text-xs text-gray-600 mt-1 mb-3">{(d.specialties ?? []).map((s) => s.name).join(", ")}</p>
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
      {items.length === 0 && !doctors.isLoading && <p className="text-center text-gray-500 py-8">No se encontraron médicos.</p>}
    </section>
  );
}
