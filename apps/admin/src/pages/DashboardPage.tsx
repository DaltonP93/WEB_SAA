import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Mail, Stethoscope, HeartPulse, FileText, ClipboardList, type LucideIcon } from "lucide-react";
import { api } from "../api";
import type { Readiness } from "./DataReadinessPage";

const SITE_URL = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined) ?? window.location.origin;

function Stat({
  to,
  label,
  value,
  sub,
  loading,
  icon: Icon,
}: {
  to: string;
  label: string;
  value: number;
  sub?: string;
  loading: boolean;
  icon: LucideIcon;
}) {
  return (
    <Link
      to={to}
      className="card p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">{label}</div>
        <div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-white transition">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      {loading ? (
        <div className="h-9 w-16 my-1 bg-gray-200 rounded animate-pulse" />
      ) : (
        <div className="text-4xl font-bold text-brand tabular-nums">{value}</div>
      )}
      {loading ? (
        <div className="h-3 w-20 mt-1 bg-gray-100 rounded animate-pulse" />
      ) : (
        sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>
      )}
    </Link>
  );
}

const ESTADO: Record<Readiness["overall"], { texto: string; chip: string }> = {
  complete: { texto: "Completo", chip: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  pending: { texto: "Falta cargar", chip: "bg-amber-100 text-amber-900 border-amber-200" },
  review: { texto: "Requiere revisión", chip: "bg-red-100 text-red-800 border-red-200" },
};

/**
 * Estado de carga de los datos institucionales, en la primera pantalla.
 *
 * Los números salen tal cual de `summary`: el servidor ya decidió qué cuenta
 * como resuelto, qué falta cargar y qué necesita que una persona lo mire.
 * Recalcularlo desde `sections` sería una segunda definición del mismo criterio
 * —y la tarjeta y la pantalla terminarían diciendo cosas distintas—.
 */
function ReadinessCard() {
  const q = useQuery<Readiness>({
    queryKey: ["adm-data-readiness"],
    queryFn: async () => (await api.get("/admin/data-readiness")).data,
  });

  if (q.isError) return null;

  const estado = q.data ? ESTADO[q.data.overall] : null;

  return (
    <Link
      to="/datos-pendientes"
      className="card p-5 mb-6 block hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <ClipboardList className="w-4 h-4" />
        </div>
        <div className="text-sm font-semibold">Datos pendientes</div>
        {estado && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${estado.chip}`}>
            {estado.texto}
          </span>
        )}
        <span className="ml-auto text-xs text-brand">Ver detalle →</span>
      </div>

      {q.isLoading || !q.data ? (
        <div className="h-9 w-40 mt-3 bg-gray-200 rounded animate-pulse" />
      ) : (
        <>
          <div className="text-3xl font-bold text-brand tabular-nums mt-2">
            {q.data.summary.resolved} / {q.data.summary.total}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {q.data.summary.pending} sin cargar · {q.data.summary.review} para revisar
          </div>
        </>
      )}
    </Link>
  );
}

export default function DashboardPage() {
  const msgs = useQuery({ queryKey: ["adm-msg"], queryFn: async () => (await api.get("/admin/contact-messages")).data });
  const docs = useQuery({ queryKey: ["adm-doctors"], queryFn: async () => (await api.get("/admin/doctors")).data });
  const pages = useQuery({ queryKey: ["adm-pages"], queryFn: async () => (await api.get("/admin/pages")).data });
  const specs = useQuery({ queryKey: ["adm-specialties"], queryFn: async () => (await api.get("/admin/specialties")).data });

  const msgList = (msgs.data ?? []) as any[];
  const pageList = (pages.data ?? []) as any[];

  const messagesNew = msgList.filter((m) => m.status === "nuevo").length;
  const pagesPub = pageList.filter((p) => p.status === "published").length;

  const recent = msgList
    .slice(0, 8)
    .map((m) => ({ kind: "msg" as const, id: m.id, name: m.name, label: "Mensaje", created_at: m.created_at }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const recentLoading = msgs.isLoading;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Inicio</h1>

      <ReadinessCard />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat to="/messages" label="Mensajes nuevos" value={messagesNew} loading={msgs.isLoading} icon={Mail} />
        <Stat to="/doctors" label="Médicos" value={(docs.data ?? []).length} loading={docs.isLoading} icon={Stethoscope} />
        <Stat to="/specialties" label="Especialidades" value={(specs.data ?? []).length} loading={specs.isLoading} icon={HeartPulse} />
        <Stat to="/pages" label="Páginas" value={pageList.length} sub={`${pagesPub} publicadas / ${pageList.length - pagesPub} borradores`} loading={pages.isLoading} icon={FileText} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3">Actividad reciente</h2>
          {recentLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div className="text-sm text-gray-400">Sin actividad.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recent.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <Link to="/messages" className="flex items-center gap-3 py-2 text-sm hover:bg-gray-50 -mx-2 px-2 rounded transition">
                    <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="font-medium truncate">{r.name}</span>
                    <span className="text-xs text-gray-400">{r.label}</span>
                    <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-3">Accesos rápidos</h2>
          <div className="flex flex-col gap-2">
            <Link to="/doctors/new" className="btn-secondary text-center">+ Médico</Link>
            <Link to="/pages" className="btn-secondary text-center">+ Página</Link>
            <a href={SITE_URL} target="_blank" rel="noreferrer" className="btn-primary text-center">
              Ver sitio público →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
