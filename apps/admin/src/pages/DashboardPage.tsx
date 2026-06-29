import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";

const SITE_URL = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined) ?? window.location.origin;

function Stat({ to, label, value, sub, loading }: { to: string; label: string; value: number; sub?: string; loading: boolean }) {
  return (
    <Link to={to} className="card p-5 hover:shadow">
      <div className="text-xs text-gray-500">{label}</div>
      {loading ? (
        <div className="h-9 w-16 my-1 bg-gray-200 rounded animate-pulse" />
      ) : (
        <div className="text-3xl font-bold text-brand">{value}</div>
      )}
      {loading ? (
        <div className="h-3 w-20 mt-1 bg-gray-100 rounded animate-pulse" />
      ) : (
        sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Stat to="/messages" label="Mensajes nuevos" value={messagesNew} loading={msgs.isLoading} />
        <Stat to="/doctors" label="Médicos" value={(docs.data ?? []).length} loading={docs.isLoading} />
        <Stat to="/specialties" label="Especialidades" value={(specs.data ?? []).length} loading={specs.isLoading} />
        <Stat to="/pages" label="Páginas" value={pageList.length} sub={`${pagesPub} publicadas / ${pageList.length - pagesPub} borradores`} loading={pages.isLoading} />
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
            <ul className="divide-y">
              {recent.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <Link to="/messages" className="flex items-center gap-3 py-2 text-sm hover:bg-gray-50 -mx-2 px-2 rounded">
                    <span>✉️</span>
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
