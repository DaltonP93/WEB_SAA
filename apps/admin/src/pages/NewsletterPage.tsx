import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api";
import { useConfirm } from "../components/ConfirmDialog";

interface Suscriptor {
  id: number;
  email: string;
  source: string | null;
  created_at: string;
  attribution: { utm_source?: string; utm_campaign?: string } | null;
}

function fecha(v: any): string {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

export default function NewsletterPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [exportando, setExportando] = useState(false);
  const q = useQuery({
    queryKey: ["adm-newsletter"],
    queryFn: async () => (await api.get("/admin/newsletter")).data as { items: Suscriptor[]; total: number },
  });

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/newsletter/${id}`),
    onSuccess: () => { toast.success("Suscriptor dado de baja"); qc.invalidateQueries({ queryKey: ["adm-newsletter"] }); },
    onError: () => toast.error("No se pudo dar de baja"),
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
    if (await confirm({ title: "Dar de baja", message: `¿Dar de baja a ${s.email}?`, confirmLabel: "Dar de baja", danger: true })) {
      del.mutate(s.id);
    }
  }

  if (!q.data) return <div>Cargando…</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Newsletter</h1>
          <p className="text-sm text-gray-600">{q.data.total} suscriptor{q.data.total === 1 ? "" : "es"}</p>
        </div>
        <button onClick={exportar} disabled={exportando || q.data.total === 0} className="btn-primary">
          {exportando ? "Exportando…" : "Exportar CSV"}
        </button>
      </div>

      <div className="card divide-y">
        {q.data.items.length === 0 && <div className="p-4 text-gray-500">Todavía no hay suscriptores.</div>}
        {q.data.items.map((s) => (
          <div key={s.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{s.email}</div>
              <div className="text-xs text-gray-500">
                {fecha(s.created_at)}
                {s.source ? ` · desde ${s.source}` : ""}
                {s.attribution?.utm_campaign ? ` · campaña ${s.attribution.utm_campaign}` : ""}
              </div>
            </div>
            <button onClick={() => askDelete(s)} className="btn-danger">Dar de baja</button>
          </div>
        ))}
      </div>
    </div>
  );
}
