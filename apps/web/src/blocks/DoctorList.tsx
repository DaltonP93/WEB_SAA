import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, Stethoscope, UserRound, X } from "lucide-react";
import { api } from "../api";
import type { DoctorListProps } from "@sa/shared/blocks";
import type { Doctor, Specialty } from "@sa/shared";
import Avatar from "../components/Avatar";
import SkeletonCard from "../components/SkeletonCard";
import LucideIcon from "../components/LucideIcon";
import { resolveIcon } from "../lib/icons";

const selectClass =
  "border rounded px-3 py-2 bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition";

export default function DoctorList({
  showSearch = true,
  limit,
  specialtyFilter,
  heading,
  intro,
}: DoctorListProps) {
  const [q, setQ] = useState("");
  const [spec, setSpec] = useState("");
  const [doctorSlug, setDoctorSlug] = useState("");

  const specs = useQuery({
    queryKey: ["specialties"],
    queryFn: async () => (await api.get("/public/specialties")).data as Specialty[],
  });

  // specialtyFilter viene por id desde el page builder: lo traducimos a slug.
  useEffect(() => {
    if (!specialtyFilter || !specs.data) return;
    const match = specs.data.find((s) => s.id === specialtyFilter);
    if (match) setSpec((current) => current || match.slug);
  }, [specialtyFilter, specs.data]);

  const doctors = useQuery({
    queryKey: ["doctors", q, spec],
    queryFn: async () =>
      (await api.get("/public/doctors", { params: { q: q || undefined, specialty: spec || undefined } }))
        .data as Doctor[],
  });

  // Al cambiar de especialidad, el médico elegido deja de tener sentido.
  useEffect(() => {
    setDoctorSlug("");
  }, [spec]);

  const found = doctors.data ?? [];
  const filtered = useMemo(
    () => (doctorSlug ? found.filter((d) => d.slug === doctorSlug) : found),
    [found, doctorSlug],
  );
  const items = limit ? filtered.slice(0, limit) : filtered;
  const activeSpecialty = specs.data?.find((s) => s.slug === spec);
  const hasFilters = !!(q || spec || doctorSlug);

  return (
    <section className="container-x section-y-md">
      {heading && <h2 className="text-2xl md:text-3xl font-bold text-primary mb-2">{heading}</h2>}
      {intro && <p className="text-gray-600 mb-6 max-w-2xl">{intro}</p>}

      {showSearch && (
        <div className="bg-gray-50 border border-gray-100 rounded p-4 mb-6">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label htmlFor="doctor-specialty" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">
                <Stethoscope className="w-3.5 h-3.5" aria-hidden />
                Especialidad
              </label>
              <select
                id="doctor-specialty"
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                className={`${selectClass} w-full`}
              >
                <option value="">Todas las especialidades</option>
                {(specs.data ?? []).map((s) => (
                  <option key={s.id} value={s.slug}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="doctor-select" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">
                <UserRound className="w-3.5 h-3.5" aria-hidden />
                Médico
              </label>
              <select
                id="doctor-select"
                value={doctorSlug}
                onChange={(e) => setDoctorSlug(e.target.value)}
                className={`${selectClass} w-full`}
                disabled={doctors.isLoading || found.length === 0}
              >
                <option value="">
                  {spec ? `Todos los médicos de ${activeSpecialty?.name ?? "la especialidad"}` : "Todos los médicos"}
                </option>
                {found.map((d) => (
                  <option key={d.id} value={d.slug}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="doctor-search" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">
                <Search className="w-3.5 h-3.5" aria-hidden />
                Buscar por nombre
              </label>
              <input
                id="doctor-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ej.: González"
                className={`${selectClass} w-full`}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <p className="text-sm text-gray-600">
              {doctors.isLoading
                ? "Buscando…"
                : `${items.length} ${items.length === 1 ? "profesional" : "profesionales"}`}
              {activeSpecialty && ` en ${activeSpecialty.name}`}
            </p>
            {hasFilters && (
              <button
                type="button"
                onClick={() => { setQ(""); setSpec(""); setDoctorSlug(""); }}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <X className="w-3.5 h-3.5" aria-hidden />
                Limpiar filtros
              </button>
            )}
          </div>
        </div>
      )}

      {activeSpecialty && (
        <div className="flex items-center gap-2 mb-4 text-primary">
          <span className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center text-secondary-700">
            <LucideIcon name={resolveIcon("specialty", activeSpecialty)} className="w-4 h-4" />
          </span>
          <h3 className="font-semibold">{activeSpecialty.name}</h3>
        </div>
      )}

      {doctors.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          <SkeletonCard count={8} />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {items.map((d) => (
            <article key={d.id} className="group bg-white rounded shadow p-4 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <Link to={`/profesionales/${d.slug}`} className="flex-1">
                <div className="aspect-square mb-3 rounded overflow-hidden bg-gray-100">
                  <Avatar src={d.photoUrl} alt={d.name} size="full" rounded={false} />
                </div>
                <h3 className="font-semibold text-primary">{d.name}</h3>
                <p className="text-xs text-gray-600 mt-1 mb-3">{(d.specialties ?? []).map((s) => s.name).join(", ")}</p>
              </Link>
              <div className="mt-auto grid gap-2">
                <Link
                  to={`/profesionales/${d.slug}`}
                  className="block text-center text-xs font-semibold py-2 rounded border border-primary text-primary hover:bg-primary hover:text-white transition"
                >
                  Más información
                </Link>
                <Link
                  to={`/turnos?doctor=${encodeURIComponent(d.slug)}`}
                  className="btn-turno btn-sm w-full"
                >
                  Reservar turno
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
      {items.length === 0 && !doctors.isLoading && (
        <p className="text-center text-gray-500 py-8">No se encontraron médicos con esos filtros.</p>
      )}
    </section>
  );
}
