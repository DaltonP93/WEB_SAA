import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api";
import { THEME_COLOR_KEYS, THEME_PALETTE } from "@sa/shared/institutional-red";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";

/**
 * Los únicos ajustes que este formulario edita y envía.
 *
 * Antes se guardaba la respuesta entera del GET y se reenviaba tal cual, así
 * que el panel se convertía en un intermediario de claves que no administra
 * —los snapshots de las migraciones, la marca de los seeds— y cualquier
 * cambio de forma en esa ida y vuelta las corrompía. La API valida la misma
 * lista (`ADMIN_SETTING_KEYS` en `api/src/routes/admin/settings.ts`); acá se
 * repite para no depender de que la respuesta venga ya filtrada.
 */
const ADMIN_SETTING_KEYS = ["brand", "theme", "contact", "seo", "analytics"] as const;

export default function SettingsPage() {
  const q = useQuery({
    queryKey: ["adm-settings"],
    queryFn: async () => (await api.get("/admin/settings")).data,
  });
  const [s, setS] = useState<any>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    const only: Record<string, unknown> = {};
    for (const key of ADMIN_SETTING_KEYS) if (key in q.data) only[key] = q.data[key];
    setS(only);
    setDirty(false);
  }, [q.data]);

  const save = useMutation({
    mutationFn: async (payload: any) => {
      const body: Record<string, unknown> = {};
      for (const key of ADMIN_SETTING_KEYS) if (key in payload) body[key] = payload[key];
      return (await api.put("/admin/settings", body)).data;
    },
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
        <button onClick={() => save.mutate(s)} className="btn-primary btn-lg">Guardar cambios</button>
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
        {/*
          Los colores se eligen de la paleta institucional, no con un selector
          libre. Un color arbitrario podía pintar de rojo cualquier parte del
          sitio —el rojo es exclusivo de Emergencias— y además rompía la
          identidad de marca. La API valida lo mismo, así que un panel viejo
          tampoco puede guardar un color de fuera de la paleta.
        */}
        <p className="text-sm text-gray-600 mb-4">
          Los colores son los institucionales. El rojo (<code>accent</code>) identifica
          únicamente a Emergencias y por eso no se cambia.
        </p>
        <div className="grid md:grid-cols-3 gap-4">
          {THEME_COLOR_KEYS.map((c) => {
            const options = THEME_PALETTE[c] ?? [];
            const current = (s.theme?.[c] ?? options[0] ?? "").toLowerCase();
            const locked = options.length < 2;
            return (
              <div key={c}>
                <label className="label">{c}</label>
                <div className="flex flex-wrap gap-2 items-center">
                  {options.map((color) => (
                    <button
                      key={color}
                      type="button"
                      disabled={locked}
                      onClick={() => setKey("theme", { [c]: color })}
                      aria-pressed={current === color}
                      title={color}
                      className={`h-10 w-12 rounded border-2 ${current === color ? "border-primary" : "border-gray-200"} ${locked ? "cursor-not-allowed" : ""}`}
                      style={{ background: color }}
                    >
                      <span className="sr-only">{color}</span>
                    </button>
                  ))}
                  <span className="text-xs text-gray-500">{current}</span>
                </div>
                {locked && <p className="mt-1 text-xs text-gray-500">Fijo por identidad de marca.</p>}
              </div>
            );
          })}
          <div><label className="label">Font Heading</label><input className="input" value={s.theme?.fontHeading ?? ""} onChange={(e) => setKey("theme", { fontHeading: e.target.value })} placeholder="Open Sans" /></div>
          <div><label className="label">Font Body</label><input className="input" value={s.theme?.fontBody ?? ""} onChange={(e) => setKey("theme", { fontBody: e.target.value })} placeholder="Open Sans" /></div>
          <div><label className="label">Radius</label><input className="input" value={s.theme?.radius ?? ""} onChange={(e) => setKey("theme", { radius: e.target.value })} placeholder="0.5rem" /></div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Ubicación</h2>
        {/*
          Teléfonos, WhatsApp, correos, Emergencias, GTH y redes se editan en
          "Canales de contacto"; los horarios, en "Horarios de atención". Antes
          también estaban acá y se podían editar por duplicado: un número
          quedaba distinto según dónde se mirara. La API descarta esos campos
          si llegan, así que no alcanza con volver a agregarlos al formulario.
        */}
        <p className="text-sm text-gray-600 mb-4">
          Los teléfonos, WhatsApp, correos y redes se cargan en{" "}
          <Link to="/contact-channels" className="text-primary underline">Canales de contacto</Link>{" "}
          y los horarios en{" "}
          <Link to="/schedules" className="text-primary underline">Horarios de atención</Link>.
          Cada dato vive en un solo lugar.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><label className="label">Dirección</label><input className="input" value={s.contact?.address ?? ""} onChange={(e) => setKey("contact", { address: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="label">Link "Cómo llegar" (Google Maps)</label><input className="input" value={s.contact?.mapsUrl ?? ""} onChange={(e) => setKey("contact", { mapsUrl: e.target.value })} placeholder="https://www.google.com/maps/…" /></div>
          <div className="md:col-span-2"><label className="label">Mapa de Google</label>
            <textarea className="input" rows={3} value={s.contact?.mapEmbed ?? ""} onChange={(e) => setKey("contact", { mapEmbed: e.target.value })} />
            <p className="mt-1 text-xs text-gray-500">
              Pegá el iframe que da Google Maps (Compartir → Insertar un mapa) o la URL sola.
              Se guarda sólo la URL: el sitio arma el mapa por su cuenta, sin insertar HTML.
            </p>
          </div>
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
        <h2 className="font-semibold mb-3">Analítica y marketing</h2>
        <p className="text-sm text-gray-600 mb-3">
          Pegá el <strong>identificador</strong> de cada plataforma, no el código que te dan. Lo que
          quede vacío se ignora. La medición sólo carga en el sitio cuando el visitante acepta el
          aviso de cookies; si nadie configuró ningún ID, ese aviso no aparece.
        </p>
        <div className="grid gap-4">
          <div>
            <label className="label" htmlFor="an-ga4">Google Analytics 4</label>
            <input
              id="an-ga4"
              className="input"
              placeholder="G-XXXXXXXXXX"
              value={s.analytics?.ga4 ?? ""}
              onChange={(e) => setKey("analytics", { ga4: e.target.value.trim() })}
            />
          </div>
          <div>
            <label className="label" htmlFor="an-gtm">Google Tag Manager</label>
            <input
              id="an-gtm"
              className="input"
              placeholder="GTM-XXXXXXX"
              value={s.analytics?.gtm ?? ""}
              onChange={(e) => setKey("analytics", { gtm: e.target.value.trim() })}
            />
          </div>
          <div>
            <label className="label" htmlFor="an-meta">Meta (Facebook) Pixel</label>
            <input
              id="an-meta"
              className="input"
              placeholder="Sólo números"
              value={s.analytics?.metaPixel ?? ""}
              onChange={(e) => setKey("analytics", { metaPixel: e.target.value.trim() })}
            />
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          La política de seguridad del sitio (CSP) ya permite los hosts de Google y Meta: alcanza con
          cargar el ID acá y que el visitante acepte el aviso de cookies.
        </p>
      </section>


      <div className="flex justify-end">
        <button onClick={() => save.mutate(s)} className="btn-primary btn-lg">Guardar cambios</button>
      </div>
    </div>
  );
}
