import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../api";
import { useConfirm } from "../components/ConfirmDialog";

/** Fecha legible; si no se puede parsear, se muestra el valor crudo. */
function fecha(v: any): string {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

function estaAgendada(p: any): boolean {
  if (!p.publish_at) return false;
  const t = new Date(p.publish_at).getTime();
  return !isNaN(t) && t > Date.now();
}

/** Tres estados distinguibles: borrador, publicada, o programada al futuro. */
function etiquetaEstado(p: any): "Borrador" | "Publicada" | "Programada" {
  if (p.status !== "published") return "Borrador";
  return estaAgendada(p) ? "Programada" : "Publicada";
}

export default function PagesListPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [verPapelera, setVerPapelera] = useState(false);
  const q = useQuery({ queryKey: ["adm-pages"], queryFn: async () => (await api.get("/admin/pages")).data });
  const papelera = useQuery({
    queryKey: ["adm-pages-papelera"],
    queryFn: async () => (await api.get("/admin/pages/papelera")).data,
    enabled: verPapelera,
  });

  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [programando, setProgramando] = useState<number | null>(null);
  const [cuando, setCuando] = useState("");

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["adm-pages"] });
    qc.invalidateQueries({ queryKey: ["adm-pages-papelera"] });
  };

  const create = useMutation({
    mutationFn: async () => (await api.post("/admin/pages", { slug, title, status: "draft" })).data,
    onSuccess: () => { toast.success("Creada"); setSlug(""); setTitle(""); setCreating(false); refetchAll(); },
    onError: () => toast.error("Error al crear"),
  });
  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/pages/${id}`),
    onSuccess: () => { toast.success("Movida a la papelera"); refetchAll(); },
    onError: () => toast.error("Error al eliminar"),
  });
  const restore = useMutation({
    mutationFn: async (id: number) => api.post(`/admin/pages/${id}/restore`),
    onSuccess: () => { toast.success("Restaurada"); refetchAll(); },
    onError: () => toast.error("Error al restaurar"),
  });
  const purgar = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/pages/${id}/definitivo`),
    onSuccess: () => { toast.success("Eliminada definitivamente"); refetchAll(); },
    onError: () => toast.error("Error al eliminar"),
  });
  // Semántica explícita de publicación (documentada en CLAUDE_CONTEXT §18.7):
  //  - Publicar: published + publish_at NULL → visible ya, sin agenda pendiente.
  //  - Despublicar: draft + publish_at NULL. Un borrador que conservara una
  //    agenda vieja se re-publicaría oculto al volver a publicar; limpiar la
  //    fecha evita ese estado confuso.
  //  - Programar: published + fecha futura, decidido en el backend (zona
  //    Asunción, no la del navegador).
  //  - Quitar programación: publish_at NULL dejando published → visible ya.
  const publicarYa = useMutation({
    mutationFn: async (p: any) => (await api.put(`/admin/pages/${p.id}`, { status: "published", publish_at: null })).data,
    onSuccess: () => { toast.success("Publicada"); refetchAll(); },
    onError: () => toast.error("Error al publicar"),
  });
  const despublicar = useMutation({
    mutationFn: async (p: any) => (await api.put(`/admin/pages/${p.id}`, { status: "draft", publish_at: null })).data,
    onSuccess: () => { toast.success("Despublicada"); refetchAll(); },
    onError: () => toast.error("Error al despublicar"),
  });
  const programarMut = useMutation({
    // La validación de "fecha futura" la hace el backend en zona Asunción, no el
    // navegador: el endpoint `/schedule` interpreta la hora de pared y rechaza el
    // pasado. Acá sólo se envía lo que eligió el editor.
    mutationFn: async (v: { id: number; publish_at: string }) =>
      (await api.post(`/admin/pages/${v.id}/schedule`, { publish_at: v.publish_at })).data,
    onSuccess: () => { toast.success("Programada"); setProgramando(null); setCuando(""); refetchAll(); },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? "Error al programar"),
  });
  const quitarProg = useMutation({
    mutationFn: async (p: any) => (await api.put(`/admin/pages/${p.id}`, { publish_at: null })).data,
    onSuccess: () => { toast.success("Programación quitada"); refetchAll(); },
    onError: () => toast.error("Error al quitar la programación"),
  });

  function enviarProgramacion(p: any) {
    if (!cuando) return;
    programarMut.mutate({ id: p.id, publish_at: cuando });
  }

  async function askDelete(p: any) {
    if (await confirm({ title: "Mover a la papelera", message: `¿Mover "${p.title}" a la papelera? Se puede restaurar después.`, confirmLabel: "Mover a papelera", danger: true })) {
      del.mutate(p.id);
    }
  }
  async function askPurge(p: any) {
    if (await confirm({ title: "Eliminar definitivamente", message: `¿Eliminar "${p.title}" para siempre? Esto borra la página y sus bloques y no se puede deshacer.`, confirmLabel: "Eliminar para siempre", danger: true })) {
      purgar.mutate(p.id);
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Páginas</h1>
        <div className="flex gap-2">
          <button onClick={() => setVerPapelera(!verPapelera)} className="btn-secondary">
            {verPapelera ? "Ver páginas" : "Ver papelera"}
          </button>
          {!verPapelera && <button onClick={() => setCreating(!creating)} className="btn-primary">+ Nueva página</button>}
        </div>
      </div>

      {!verPapelera && creating && (
        <div className="card p-4 mb-4 flex gap-3 items-end">
          <div className="flex-1"><label className="label">Título</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="flex-1"><label className="label">Slug</label><input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ej. nuestros-valores" /></div>
          <button onClick={() => create.mutate()} disabled={!slug || !title} className="btn-primary">Crear</button>
        </div>
      )}

      {verPapelera ? (
        <div className="card divide-y">
          {(papelera.data ?? []).length === 0 && <div className="p-4 text-gray-500">La papelera está vacía.</div>}
          {(papelera.data ?? []).map((p: any) => (
            <div key={p.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold">{p.title}</div>
                <div className="text-xs text-gray-500">/{p.slug} · borrada {fecha(p.deleted_at)}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => restore.mutate(p.id)} className="btn-secondary">Restaurar</button>
                <button onClick={() => askPurge(p)} className="btn-danger">Eliminar definitivamente</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card divide-y">
          {(q.data ?? []).map((p: any) => (
            <div key={p.id} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{p.title}</div>
                  <div className="text-xs text-gray-500">
                    /{p.slug} ·{" "}
                    <span
                      className={
                        etiquetaEstado(p) === "Publicada"
                          ? "text-green-700"
                          : etiquetaEstado(p) === "Programada"
                            ? "text-amber-700"
                            : "text-gray-500"
                      }
                    >
                      {etiquetaEstado(p)}
                    </span>
                    {estaAgendada(p) && <span className="ml-2 text-amber-700">· desde {fecha(p.publish_at)}</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => (p.status === "published" ? despublicar : publicarYa).mutate(p)}
                    className="btn-secondary"
                    title="Cambiar estado"
                  >
                    {p.status === "published" ? "Despublicar" : "Publicar"}
                  </button>
                  <button onClick={() => { setProgramando(programando === p.id ? null : p.id); setCuando(""); }} className="btn-secondary">
                    Programar
                  </button>
                  <Link to={`/pages/${p.id}`} className="btn-secondary">Editar bloques</Link>
                  <button onClick={() => askDelete(p)} className="btn-danger">Eliminar</button>
                </div>
              </div>
              {programando === p.id && (
                <div className="mt-3 flex items-end gap-3 bg-gray-50 p-3 rounded">
                  <div>
                    <label className="label">Publicar a partir de (hora de Asunción)</label>
                    <input type="datetime-local" className="input" value={cuando} onChange={(e) => setCuando(e.target.value)} />
                  </div>
                  <button className="btn-primary" disabled={!cuando || programarMut.isPending} onClick={() => enviarProgramacion(p)}>
                    Programar
                  </button>
                  {p.publish_at && (
                    <button className="btn-secondary" disabled={quitarProg.isPending} onClick={() => quitarProg.mutate(p)}>
                      Quitar programación
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
