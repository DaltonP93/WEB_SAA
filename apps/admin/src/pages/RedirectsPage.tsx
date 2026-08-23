import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api";

/**
 * Gestor de redirects 301.
 *
 * Antes las rutas viejas vivían fijas en el código. Acá se agregan, editan y
 * apagan sin tocar nada: origen y destino, los dos rutas internas del mismo
 * sitio. El destino tiene que empezar con "/" —la API rechaza cualquier cosa
 * que apunte afuera para que un redirect no se vuelva una vía de phishing—.
 */

interface Redirect {
  id: number;
  from: string;
  to: string;
  active: boolean;
}

export default function RedirectsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["adm-redirects"],
    queryFn: async () => (await api.get("/admin/redirects")).data as Redirect[],
  });

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const invalidar = () => qc.invalidateQueries({ queryKey: ["adm-redirects"] });

  const crear = useMutation({
    mutationFn: async () => (await api.post("/admin/redirects", { from, to })).data,
    onSuccess: () => {
      setFrom("");
      setTo("");
      invalidar();
      toast.success("Redirect creado");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? "No se pudo crear"),
  });

  const alternar = useMutation({
    mutationFn: async (r: Redirect) =>
      (await api.put(`/admin/redirects/${r.id}`, { active: !r.active })).data,
    onSuccess: () => invalidar(),
    onError: () => toast.error("No se pudo cambiar"),
  });

  const borrar = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/redirects/${id}`),
    onSuccess: () => {
      invalidar();
      toast.success("Redirect eliminado");
    },
    onError: () => toast.error("No se pudo eliminar"),
  });

  if (!q.data) return <div>Cargando…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Redirects 301</h1>
        <p className="text-sm text-gray-600 mt-1">
          Redirecciones permanentes de una ruta vieja a una nueva. Sirven para no perder los enlaces
          y el posicionamiento cuando cambia una dirección. El destino tiene que ser una ruta del
          mismo sitio (empieza con <code>/</code>).
        </p>
      </div>

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Nuevo redirect</h2>
        <div className="grid md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div>
            <label className="label" htmlFor="rd-from">Desde (ruta vieja)</label>
            <input
              id="rd-from"
              className="input"
              placeholder="/pagina-vieja"
              value={from}
              onChange={(e) => setFrom(e.target.value.trim())}
            />
          </div>
          <div>
            <label className="label" htmlFor="rd-to">Hacia (ruta nueva)</label>
            <input
              id="rd-to"
              className="input"
              placeholder="/pagina-nueva"
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
            />
          </div>
          <button
            className="btn-primary btn-lg"
            disabled={!from || !to || crear.isPending}
            onClick={() => crear.mutate()}
          >
            Agregar
          </button>
        </div>
      </section>

      <section className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Desde</th>
              <th className="p-3">Hacia</th>
              <th className="p-3">Estado</th>
              <th className="p-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {q.data.length === 0 && (
              <tr><td className="p-3 text-gray-500" colSpan={4}>Todavía no hay redirects.</td></tr>
            )}
            {q.data.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-mono">{r.from}</td>
                <td className="p-3 font-mono">{r.to}</td>
                <td className="p-3">
                  <span className={r.active ? "text-emerald-700" : "text-gray-400"}>
                    {r.active ? "Activo" : "Apagado"}
                  </span>
                </td>
                <td className="p-3 text-right space-x-2">
                  <button className="btn-secondary" onClick={() => alternar.mutate(r)}>
                    {r.active ? "Apagar" : "Activar"}
                  </button>
                  <button className="btn-danger" onClick={() => borrar.mutate(r.id)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
