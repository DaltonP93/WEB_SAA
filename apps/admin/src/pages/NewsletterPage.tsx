import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api";
import { useConfirm } from "../components/ConfirmDialog";

interface Suscriptor {
  id: number;
  email: string;
  source: string | null;
  active: boolean;
  consent_at: string | null;
  consent_version: string | null;
  created_at: string;
  attribution: { utm_source?: string; utm_campaign?: string } | null;
}
interface Pagina {
  items: Suscriptor[];
  total: number;
  limit: number;
  offset: number;
}

function fecha(v: any): string {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

const LIMIT = 20;

export default function NewsletterPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [exportando, setExportando] = useState(false);

  const query = useQuery({
    queryKey: ["adm-newsletter", q, offset],
    queryFn: async () =>
      (await api.get(`/admin/newsletter?q=${encodeURIComponent(q)}&limit=${LIMIT}&offset=${offset}`)).data as Pagina,
    placeholderData: keepPreviousData,
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["adm-newsletter"] });

  const cambiarEstado = useMutation({
    mutationFn: async (s: Suscriptor) => (await api.put(`/admin/newsletter/${s.id}`, { active: !s.active })).data,
    onSuccess: (_d, s: Suscriptor) => { toast.success(s.active ? "Dado de baja" : "Reactivado"); invalidar(); },
    onError: () => toast.error("No se pudo cambiar el estado"),
  });
  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/newsletter/${id}`),
    onSuccess: () => { toast.success("Eliminado"); invalidar(); },
    onError: () => toast.error("No se pudo eliminar"),
  });

  async function exportar() {
    setExportando(true);
    try {
      const res = await api.get("/admin/newsletter/export", { responseType: "text", transformResponse: [(d) => d] });
      const blob = new Blob([res.data as string], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "newsletter.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error("No se pudo exportar");
    } finally {
      setExportando(false);
    }
  }

  async function askDelete(s: Suscriptor) {
    if (await confirm({ title: "Eliminar suscriptor", message: `¿Eliminar definitivamente a ${s.email}? Para conservar la evidencia, usá “Dar de baja”.`, confirmLabel: "Eliminar", danger: true })) {
      del.mutate(s.id);
    }
  }

  const data = query.data;
  const total = data?.total ?? 0;
  const desde = total === 0 ? 0 : offset + 1;
  const hasta = Math.min(offset + LIMIT, total);

  return (
    <div>
      <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Newsletter</h1>
        <div className="flex gap-2 items-center">
          <input
            className="input"
            placeholder="Buscar por email…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setOffset(0); }}
            aria-label="Buscar por email"
          />
          <button onClick={exportar} disabled={exportando || total === 0} className="btn-primary">
            {exportando ? "Exportando…" : "Exportar CSV"}
          </button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="card p-6 text-gray-500">Cargando…</div>
      ) : query.isError ? (
        <div className="card p-6 text-amber-700 flex items-center justify-between">
          <span>No se pudo cargar la lista.</span>
          <button className="btn-secondary" onClick={() => query.refetch()}>Reintentar</button>
        </div>
      ) : (
        <>
          <div className="card divide-y">
            {(data?.items ?? []).length === 0 && (
              <div className="p-4 text-gray-500">{q ? "Sin resultados para esa búsqueda." : "Todavía no hay suscriptores."}</div>
            )}
            {(data?.items ?? []).map((s) => (
              <div key={s.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    <span className="truncate">{s.email}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${s.active ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-600"}`}>
                      {s.active ? "Activo" : "Baja"}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    Alta {fecha(s.created_at)}
                    {s.consent_at ? ` · consintió ${fecha(s.consent_at)}${s.consent_version ? ` (v${s.consent_version})` : ""}` : ""}
                    {s.source ? ` · desde ${s.source}` : ""}
                    {s.attribution?.utm_campaign ? ` · campaña ${s.attribution.utm_campaign}` : ""}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className="btn-secondary" onClick={() => cambiarEstado.mutate(s)}>
                    {s.active ? "Dar de baja" : "Reactivar"}
                  </button>
                  <button className="btn-danger" onClick={() => askDelete(s)}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
            <span>{total === 0 ? "0 suscriptores" : `${desde}–${hasta} de ${total}`}</span>
            <div className="flex gap-2">
              <button className="btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
                Anterior
              </button>
              <button className="btn-secondary" disabled={hasta >= total} onClick={() => setOffset(offset + LIMIT)}>
                Siguiente
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
