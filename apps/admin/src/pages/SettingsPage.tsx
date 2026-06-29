import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";

export default function SettingsPage() {
  const q = useQuery({
    queryKey: ["adm-settings"],
    queryFn: async () => (await api.get("/admin/settings")).data,
  });
  const [s, setS] = useState<any>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (q.data) { setS(q.data); setDirty(false); } }, [q.data]);

  const save = useMutation({
    mutationFn: async (payload: any) => (await api.put("/admin/settings", payload)).data,
    onSuccess: () => { setDirty(false); toast.success("Guardado"); },
    onError: () => toast.error("Error al guardar"),
  });

  useUnsavedGuard(dirty && !save.isPending);

  function setKey(k: string, v: any) { setS({ ...s, [k]: { ...(s[k] ?? {}), ...v } }); setDirty(true); }

  if (!q.data) return <div>Cargando…</div>;

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Branding & configuración</h1>
        <button onClick={() => save.mutate(s)} className="btn-primary">Guardar cambios</button>
      </div>

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Marca</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="label">Nombre</label><input className="input" value={s.brand?.name ?? ""} onChange={(e) => setKey("brand", { name: e.target.value })} /></div>
          <div><label className="label">Tagline</label><input className="input" value={s.brand?.tagline ?? ""} onChange={(e) => setKey("brand", { tagline: e.target.value })} /></div>
          <div><label className="label">Logo URL</label><input className="input" value={s.brand?.logoUrl ?? ""} onChange={(e) => setKey("brand", { logoUrl: e.target.value })} /></div>
          <div><label className="label">Favicon URL</label><input className="input" value={s.brand?.faviconUrl ?? ""} onChange={(e) => setKey("brand", { faviconUrl: e.target.value })} /></div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Tema (colores y tipografía)</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {(["primary", "secondary", "accent", "bg", "text"] as const).map((c) => (
            <div key={c}>
              <label className="label">{c}</label>
              <div className="flex gap-2">
                <input type="color" value={s.theme?.[c] ?? "#000000"} onChange={(e) => setKey("theme", { [c]: e.target.value })} className="h-10 w-12 border rounded" />
                <input className="input" value={s.theme?.[c] ?? ""} onChange={(e) => setKey("theme", { [c]: e.target.value })} />
              </div>
            </div>
          ))}
          <div><label className="label">Font Heading</label><input className="input" value={s.theme?.fontHeading ?? ""} onChange={(e) => setKey("theme", { fontHeading: e.target.value })} placeholder="Open Sans" /></div>
          <div><label className="label">Font Body</label><input className="input" value={s.theme?.fontBody ?? ""} onChange={(e) => setKey("theme", { fontBody: e.target.value })} placeholder="Open Sans" /></div>
          <div><label className="label">Radius</label><input className="input" value={s.theme?.radius ?? ""} onChange={(e) => setKey("theme", { radius: e.target.value })} placeholder="0.5rem" /></div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Contacto</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="label">Dirección</label><input className="input" value={s.contact?.address ?? ""} onChange={(e) => setKey("contact", { address: e.target.value })} /></div>
          <div><label className="label">Email</label><input className="input" value={s.contact?.email ?? ""} onChange={(e) => setKey("contact", { email: e.target.value })} /></div>
          <div><label className="label">WhatsApp</label><input className="input" value={s.contact?.whatsapp ?? ""} onChange={(e) => setKey("contact", { whatsapp: e.target.value })} placeholder="+595981000000" /></div>
          <div><label className="label">Teléfonos (separados por coma)</label>
            <input className="input" value={(s.contact?.phones ?? []).join(", ")} onChange={(e) => setKey("contact", { phones: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
          </div>
          <div className="md:col-span-2"><label className="label">Horarios</label><input className="input" value={s.contact?.hours ?? ""} onChange={(e) => setKey("contact", { hours: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="label">Embed de mapa (HTML)</label>
            <textarea className="input" rows={3} value={s.contact?.mapEmbed ?? ""} onChange={(e) => setKey("contact", { mapEmbed: e.target.value })} />
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Redes sociales</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {(["facebook", "instagram", "youtube", "linkedin"] as const).map((k) => (
            <div key={k}><label className="label">{k}</label><input className="input" value={s.social?.[k] ?? ""} onChange={(e) => setKey("social", { [k]: e.target.value })} /></div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-3">SEO</h2>
        <div className="grid gap-4">
          <div><label className="label">Título</label><input className="input" value={s.seo?.title ?? ""} onChange={(e) => setKey("seo", { title: e.target.value })} /></div>
          <div><label className="label">Descripción</label><textarea className="input" rows={2} value={s.seo?.description ?? ""} onChange={(e) => setKey("seo", { description: e.target.value })} /></div>
          <div><label className="label">OG Image</label><input className="input" value={s.seo?.ogImage ?? ""} onChange={(e) => setKey("seo", { ogImage: e.target.value })} /></div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Scripts personalizados</h2>
        <label className="label">{`<head>`}</label>
        <textarea className="input font-mono text-xs" rows={3} value={s.scripts?.head ?? ""} onChange={(e) => setKey("scripts", { head: e.target.value })} />
        <label className="label mt-3">Antes de {`</body>`}</label>
        <textarea className="input font-mono text-xs" rows={3} value={s.scripts?.bodyEnd ?? ""} onChange={(e) => setKey("scripts", { bodyEnd: e.target.value })} />
      </section>

      <div className="flex justify-end">
        <button onClick={() => save.mutate(s)} className="btn-primary">Guardar cambios</button>
      </div>
    </div>
  );
}
