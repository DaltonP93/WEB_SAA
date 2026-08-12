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
import { filterByDoctor, summarizeDoctors } from "../lib/doctor-filters";

const selectClass =
  "border rounded px-3 py-2 bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition";

export default function DoctorList({
  showSearch = true,
  limit,
  specialtyFilter,
  specialtySlug,
  lockSpecialty = false,
  heading,
  intro,
  emptyText,
}: DoctorListProps) {
  const [q, setQ] = useState("");
  const [spec, setSpec] = useState(lockSpecialty ? (specialtySlug ?? "") : "");
  const [doctorSlug, setDoctorSlug] = useState("");

  const specs = useQuery({
    queryKey: ["specialties"],
    queryFn: async () => (await api.get("/public/specialties")).data as Specialty[],
  });

  // La especialidad puede venir por slug (estable) o por id (legado del page
  // builder). El slug manda; el id se resuelve contra el catálogo.
  useEffect(() => {
    if (!specs.data) return;
    if (specialtySlug) {
      const bySlug = specs.data.find((s) => s.slug === specialtySlug);
      if (bySlug) setSpec((current) => (lockSpecialty ? bySlug.slug : current || bySlug.slug));
      return;
    }
    if (specialtyFilter) {
      const byId = specs.data.find((s) => s.id === specialtyFilter);
      if (byId) setSpec((current) => (lockSpecialty ? byId.slug : current || byId.slug));
    }
  }, [specialtySlug, specialtyFilter, lockSpecialty, specs.data]);

  // Con especialidad bloqueada nunca consultamos sin filtro: si el slug no
  // resuelve todavía, no listamos médicos de otras especialidades.
  const lockedSlug = lockSpecialty ? specialtySlug || spec : undefined;
  const effectiveSpec = lockSpecialty ? lockedSlug : spec;
  const canQuery = !lockSpecialty || !!lockedSlug;

  const doctors = useQuery({
    queryKey: ["doctors", q, effectiveSpec ?? ""],
    enabled: canQuery,
    queryFn: async () =>
      (
        await api.get("/public/doctors", {
          params: { q: q || undefined, specialty: effectiveSpec || undefined },
        })
      ).data as Doctor[],
  });

  useEffect(() => {
    setDoctorSlug("");
  }, [spec]);

  const found = doctors.data ?? [];
  const filtered = useMemo(() => filterByDoctor(found, doctorSlug), [found, doctorSlug]);

  const activeSpecialty = specs.data?.find((s) => s.slug === (effectiveSpec ?? ""));
  const specialtyMissing = lockSpecialty && !!specialtySlug && !!specs.data && !activeSpecialty;
  const hasFilters = !!(q || (!lockSpecialty && spec) || doctorSlug);
  const isLoading = doctors.isLoading || (lockSpecialty && !canQuery) || specs.isLoading;
  const summary = summarizeDoctors(filtered, { limit, isLoading });
  const items = filtered.slice(0, summary.shown);
  const hiddenByLimit = summary.hiddenByLimit;

  const emptyMessage = specialtyMissing
    ? "La especialidad todavía no está disponible."
    : emptyText ||
      (activeSpecialty
        ? `Todavía no hay profesionales cargados en ${activeSpecialty.name}.`
        : "No se encontraron médicos con esos filtros.");

  return (
    <section className="container-x section-y-md">
      {heading && <h2 className="text-2xl md:text-3xl font-bold text-primary mb-2">{heading}</h2>}
      {intro && <p className="text-gray-600 mb-6 max-w-2xl">{intro}</p>}

      {showSearch && (
        <div className="bg-gray-50 border border-gray-200 rounded p-4 mb-6">
          <div className={`grid gap-3 ${lockSpecialty ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
            {!lockSpecialty && (
              <div>
                <label
                  htmlFor="doctor-specialty"
                  className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700 mb-1"
                >
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
                    <option key={s.id} value={s.slug}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label
                htmlFor="doctor-select"
                className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700 mb-1"
              >
                <UserRound className="w-3.5 h-3.5" aria-hidden />
                Médico
              </label>
              <select
                id="doctor-select"
                value={doctorSlug}
                onChange={(e) => setDoctorSlug(e.target.value)}
                className={`${selectClass} w-full`}
                disabled={isLoading || found.length === 0}
              >
                <option value="">
                  {activeSpecialty ? `Todos los médicos de ${activeSpecialty.name}` : "Todos los médicos"}
                </option>
                {found.map((d) => (
                  <option key={d.id} value={d.slug}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="doctor-search"
                className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700 mb-1"
              >
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3">
            {/* El contador distingue lo encontrado de lo que se muestra: con
                `limit` no son lo mismo. */}
            <p className="text-sm text-gray-700" aria-live="polite">
              {summary.label}
            </p>
            {!isLoading && activeSpecialty && (
              <span className="text-sm text-gray-600">· {activeSpecialty.name}</span>
            )}
            {!isLoading && q && <span className="text-sm text-gray-600">· nombre “{q}”</span>}
            {!isLoading && doctorSlug && <span className="text-sm text-gray-600">· 1 médico seleccionado</span>}
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  if (!lockSpecialty) setSpec("");
                  setDoctorSlug("");
                }}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
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

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          <SkeletonCard count={8} />
        </div>
      ) : items.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {items.map((d) => (
              <article
                key={d.id}
                className="group bg-white rounded shadow p-4 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col"
              >
                <Link
                  to={`/profesionales/${d.slug}`}
                  className="flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="aspect-square mb-3 rounded overflow-hidden bg-gray-100">
                    <Avatar src={d.photoUrl} alt={d.name} size="full" rounded={false} />
                  </div>
                  <h3 className="font-semibold text-primary">{d.name}</h3>
                  <p className="text-xs text-gray-600 mt-1 mb-3">
                    {(d.specialties ?? []).map((s) => s.name).join(", ")}
                  </p>
                </Link>
                <div className="mt-auto grid gap-2">
                  <Link
                    to={`/profesionales/${d.slug}`}
                    className="block text-center text-xs font-semibold py-2 rounded border border-primary text-primary hover:bg-primary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition"
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
          {hiddenByLimit > 0 && (
            <div className="text-center mt-8">
              <Link to="/profesionales" className="btn-outline btn-sm">
                Ver los {filtered.length} profesionales
              </Link>
            </div>
          )}
        </>
      ) : (
        <p className="text-center text-gray-600 py-8">{emptyMessage}</p>
      )}
    </section>
  );
}
