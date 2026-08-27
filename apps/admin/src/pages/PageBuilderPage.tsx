import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import toast from "react-hot-toast";
import { BLOCK_REGISTRY, type BlockType } from "../../../../shared/types/blocks";
import { api } from "../api";
import BlockPropsEditor from "../components/BlockPropsEditor";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";

interface BlockDraft { _key: string; type: BlockType; props: any; }

function SortableBlock({ b, selected, onSelect, onRemove }: { b: BlockDraft; selected: boolean; onSelect: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: b._key });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className={`card p-3 flex items-center gap-3 ${selected ? "ring-2 ring-brand" : ""}`}>
      <button {...attributes} {...listeners} className="cursor-grab text-gray-400 text-lg" title="arrastrar">⋮⋮</button>
      <button onClick={onSelect} className="flex-1 text-left">
        <div className="text-sm font-medium">{BLOCK_REGISTRY.find((r) => r.type === b.type)?.label ?? b.type}</div>
        <div className="text-xs text-gray-500 truncate">{JSON.stringify(b.props).slice(0, 80)}</div>
      </button>
      <button onClick={onRemove} className="text-red-600 text-xs">Quitar</button>
    </div>
  );
}

export default function PageBuilderPage() {
  const { id } = useParams();
  const pageId = Number(id);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["adm-page", pageId],
    queryFn: async () => (await api.get(`/admin/pages/${pageId}`)).data,
  });

  const [page, setPage] = useState<any>(null);
  const [blocks, setBlocks] = useState<BlockDraft[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (q.data) {
      setPage({ slug: q.data.slug, title: q.data.title, status: q.data.status, seo: q.data.seo });
      setBlocks((q.data.blocks ?? []).map((b: any, i: number) => ({ _key: `${b.id}-${i}`, type: b.type, props: b.props })));
      setDirty(false);
    }
  }, [q.data]);

  const saveMeta = useMutation({
    mutationFn: async () => (await api.put(`/admin/pages/${pageId}`, page)).data,
  });
  const saveBlocks = useMutation({
    mutationFn: async () => (await api.put(`/admin/pages/${pageId}/blocks`, { blocks: blocks.map(({ type, props }) => ({ type, props })) })).data,
  });

  const [verHistorial, setVerHistorial] = useState(false);
  const revisiones = useQuery({
    queryKey: ["adm-page-rev", pageId],
    queryFn: async () => (await api.get(`/admin/pages/${pageId}/revisions`)).data as any[],
    enabled: verHistorial,
  });
  const restaurar = useMutation({
    mutationFn: async (revId: number) => (await api.post(`/admin/pages/${pageId}/revisions/${revId}/restore`)).data,
    onSuccess: () => {
      toast.success("Versión restaurada");
      qc.invalidateQueries({ queryKey: ["adm-page", pageId] });
      qc.invalidateQueries({ queryKey: ["adm-page-rev", pageId] });
    },
    onError: () => toast.error("No se pudo restaurar"),
  });

  useUnsavedGuard(dirty && !saveMeta.isPending && !saveBlocks.isPending);

  async function saveAll() {
    try {
      await saveMeta.mutateAsync();
      await saveBlocks.mutateAsync();
      setDirty(false);
      toast.success("Guardado");
      qc.invalidateQueries({ queryKey: ["adm-page", pageId] });
    } catch (err: any) {
      const block = err?.response?.data?.block;
      toast.error(block ? `Bloque ${block.index + 1}: revisar campos` : "Error al guardar");
    }
  }

  function addBlock(type: BlockType) {
    const def = BLOCK_REGISTRY.find((r) => r.type === type);
    setBlocks([...blocks, { _key: `new-${Date.now()}`, type, props: { ...(def?.defaults as any) } }]);
    setDirty(true);
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = blocks.findIndex((b) => b._key === e.active.id);
    const newIdx = blocks.findIndex((b) => b._key === e.over!.id);
    setBlocks(arrayMove(blocks, oldIdx, newIdx));
    setDirty(true);
  }

  if (!page) return <div>Cargando…</div>;
  const sel = blocks.find((b) => b._key === selected);
  const previewBase = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined) ?? window.location.origin;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{page.title}</h1>
        <div className="flex gap-2">
          <a href={`${previewBase.replace(/\/$/, "")}/${page.slug === "home" ? "" : page.slug}`} target="_blank" rel="noreferrer" className="btn-secondary">Ver en sitio</a>
          <button onClick={() => setVerHistorial((v) => !v)} className="btn-secondary">Historial</button>
          <button onClick={saveAll} className="btn-primary btn-lg">Guardar</button>
        </div>
      </div>

      {verHistorial && (
        <div className="card p-4 mb-6">
          <h2 className="font-semibold mb-1">Historial de versiones</h2>
          <p className="text-xs text-gray-500 mb-3">
            Cada vez que guardás queda una versión. Restaurar aplica los bloques de esa versión como
            estado actual; también queda guardada, así que restaurar se puede deshacer.
          </p>
          {revisiones.isLoading && <div className="text-sm text-gray-500">Cargando…</div>}
          {revisiones.data && revisiones.data.length === 0 && (
            <div className="text-sm text-gray-500">Todavía no hay versiones guardadas.</div>
          )}
          <div className="divide-y">
            {(revisiones.data ?? []).map((r: any) => (
              <div key={r.id} className="py-2 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{r.created_at ? new Date(r.created_at).toLocaleString() : `#${r.id}`}</span>
                  <span className="text-gray-500"> · {r.blockCount} bloque{r.blockCount === 1 ? "" : "s"}{r.author ? ` · ${r.author}` : ""}</span>
                </div>
                <button className="btn-secondary" disabled={restaurar.isPending} onClick={() => restaurar.mutate(r.id)}>
                  Restaurar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-4 mb-6 grid md:grid-cols-4 gap-3">
        <div><label className="label">Título</label><input className="input" value={page.title} onChange={(e) => { setPage({ ...page, title: e.target.value }); setDirty(true); }} /></div>
        <div><label className="label">Slug</label><input className="input" value={page.slug} onChange={(e) => { setPage({ ...page, slug: e.target.value }); setDirty(true); }} /></div>
        <div><label className="label">Estado</label>
          <select className="input" value={page.status} onChange={(e) => { setPage({ ...page, status: e.target.value }); setDirty(true); }}>
            <option value="draft">Borrador</option><option value="published">Publicada</option>
          </select>
        </div>
        <div><label className="label">SEO título</label><input className="input" maxLength={70} value={page.seo?.title ?? ""} onChange={(e) => { setPage({ ...page, seo: { ...(page.seo ?? {}), title: e.target.value } }); setDirty(true); }} /></div>
        <div><label className="label">SEO descripción</label><input className="input" maxLength={170} value={page.seo?.description ?? ""} onChange={(e) => { setPage({ ...page, seo: { ...(page.seo ?? {}), description: e.target.value } }); setDirty(true); }} /></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h2 className="font-semibold mb-2">Bloques</h2>
          <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={blocks.map((b) => b._key)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {blocks.map((b) => (
                  <SortableBlock
                    key={b._key}
                    b={b}
                    selected={selected === b._key}
                    onSelect={() => setSelected(b._key)}
                    onRemove={() => { setBlocks(blocks.filter((x) => x._key !== b._key)); setDirty(true); if (selected === b._key) setSelected(null); }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {blocks.length === 0 && <p className="text-sm text-gray-500">No hay bloques. Agregá uno desde el panel derecho.</p>}
        </div>

        <div>
          <h2 className="font-semibold mb-2">{sel ? "Editar bloque" : "Agregar bloque"}</h2>
          {sel ? (
            <div className="card p-4">
              <div className="text-xs text-gray-500 mb-2">Tipo: <b>{sel.type}</b></div>
              <BlockPropsEditor
                type={sel.type}
                props={sel.props}
                onChange={(p) => { setBlocks(blocks.map((x) => x._key === sel._key ? { ...x, props: p } : x)); setDirty(true); }}
              />
              <button type="button" onClick={() => setSelected(null)} className="btn-secondary mt-3 w-full">Cerrar</button>
            </div>
          ) : (
            <div className="card p-3 grid grid-cols-2 gap-2">
              {BLOCK_REGISTRY.map((r) => (
                <button key={r.type} type="button" onClick={() => addBlock(r.type)} className="btn-secondary text-left text-xs">{r.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
