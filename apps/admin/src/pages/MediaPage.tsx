import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api";
import { useConfirm } from "../components/ConfirmDialog";

/**
 * Biblioteca multimedia.
 *
 * Lo que esta pantalla decía no era lo que el servidor hacía:
 *
 * - recomendaba **SVG** para logos, y la API lo rechaza (no hay saneo de SVG,
 *   y un SVG es un documento que puede traer scripts adentro);
 * - `accept="image/*"` ofrecía subir BMP, TIFF, AVIF o SVG, todos rechazados
 *   después de esperar la subida entera;
 * - anunciaba que el servidor redimensiona a 2400 px cuando redimensiona a
 *   1600;
 * - exigía 200 × 200 antes de subir, con lo que un logo de 400 × 80 no
 *   llegaba nunca a la API — que ahora sí lo acepta;
 * - decía "Subido y optimizado" también cuando el archivo se conservó tal
 *   cual, que es lo que pasa con un PDF y con un GIF animado.
 *
 * Los límites de acá tienen que coincidir con `api/src/imagenes.ts`. La
 * prueba `tests/media-panel.test.tsx` compara los dos archivos y falla si se
 * separan.
 */

/** Espejo de `MAX_UPLOAD_MB` en la API. */
const MAX_MB = 10;
/** Espejo de `MAX_LADO` en `api/src/imagenes.ts`. */
const MAX_LADO = 1600;
/** Espejo de `MIN_LADO` y `MIN_PIXELES`. */
const MIN_LADO = 16;
const MIN_PIXELES = 1024;

/** Exactamente lo que la API acepta, ni uno más. */
const ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.pdf,image/jpeg,image/png,image/webp,image/gif,application/pdf";
const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

interface Media {
  id: number;
  url: string;
  mime: string;
  size: number;
  alt: string | null;
  width: number | null;
  height: number | null;
  frames: number | null;
}

interface Revision {
  ok: boolean;
  width?: number;
  height?: number;
  errors: string[];
  warnings: string[];
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

/** `image/webp` → `WEBP`, `application/pdf` → `PDF`. */
const formato = (mime: string) => (mime.split("/")[1] ?? mime).replace("jpeg", "jpg").toUpperCase();

/**
 * Revisión en el navegador, antes de gastar la subida.
 *
 * Es una cortesía, no la validación: la que manda es la del servidor, que mira
 * los bytes. Acá sólo se atajan los casos obvios para no hacer esperar a nadie
 * por un archivo que va a rebotar.
 */
function revisar(file: File, url: string): Promise<Revision> {
  return new Promise((resolve) => {
    const r: Revision = { ok: true, errors: [], warnings: [] };
    if (file.size > MAX_MB * 1024 * 1024) {
      r.errors.push(`El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB (máximo ${MAX_MB} MB).`);
      r.ok = false;
    }
    if (file.type && !TIPOS.includes(file.type)) {
      r.errors.push("Tipo de archivo no permitido. Usá JPG, PNG, WebP, GIF o PDF.");
      r.ok = false;
    }
    if (file.type === "application/pdf" || !file.type.startsWith("image/")) return resolve(r);

    const img = new Image();
    img.onload = () => {
      r.width = img.width;
      r.height = img.height;
      if (img.width < MIN_LADO || img.height < MIN_LADO || img.width * img.height < MIN_PIXELES) {
        r.errors.push(`Imagen demasiado pequeña (${img.width}×${img.height} px).`);
        r.ok = false;
      } else if (img.width > MAX_LADO || img.height > MAX_LADO) {
        r.warnings.push(`Se va a redimensionar a ${MAX_LADO} px de lado mayor.`);
      }
      resolve(r);
    };
    img.onerror = () => {
      r.errors.push("No pude leer el archivo como imagen.");
      r.ok = false;
      resolve(r);
    };
    img.src = url;
  });
}

export default function MediaPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [pendiente, setPendiente] = useState<{ file: File; revision: Revision; url: string } | null>(null);
  const [alt, setAlt] = useState("");

  /**
   * La URL del preview se revoca al cambiar de archivo y al desmontar.
   *
   * Antes se creaba con `URL.createObjectURL(pending.file)` **dentro del
   * render**: cada re-render generaba un blob nuevo y ninguno se liberaba.
   * Tipear en cualquier campo de la pantalla dejaba un archivo entero más en
   * memoria, y el navegador los retiene hasta que se cierra la pestaña.
   */
  useEffect(() => {
    const url = pendiente?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pendiente?.url]);

  const list = useQuery({
    queryKey: ["adm-media"],
    queryFn: async () => (await api.get("/admin/media")).data as Media[],
  });

  const subir = useMutation({
    mutationFn: async ({ file, alt }: { file: File; alt: string }) => {
      const fd = new FormData();
      fd.append("file", file);
      if (alt.trim()) fd.append("alt", alt.trim());
      return (await api.post("/admin/media", fd, { headers: { "Content-Type": "multipart/form-data" } })).data as Media;
    },
    onSuccess: (row) => {
      // "Optimizado" sólo cuando efectivamente se recomprimió. Un PDF se
      // valida y se guarda igual; decir que se optimizó sería inventar.
      toast.success(row.mime === "application/pdf" ? "Archivo subido" : "Imagen subida y procesada");
      setPendiente(null);
      setAlt("");
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["adm-media"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "No se pudo subir el archivo"),
  });

  const borrar = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/media/${id}`),
    onSuccess: () => {
      toast.success("Archivo eliminado");
      qc.invalidateQueries({ queryKey: ["adm-media"] });
    },
    onError: () => toast.error("No se pudo eliminar el archivo"),
  });

  async function elegir(file: File) {
    const url = URL.createObjectURL(file);
    const revision = await revisar(file, url);
    if (!revision.ok) {
      URL.revokeObjectURL(url);
      revision.errors.forEach((e) => toast.error(e));
      setPendiente(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setPendiente({ file, revision, url });
  }

  function cancelar() {
    setPendiente(null);
    setAlt("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function eliminar(m: Media) {
    const ok = await confirm({
      title: "Eliminar archivo",
      message: "Se borra de la biblioteca y del disco. Si alguna página lo usa, va a quedar rota.",
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (ok) borrar.mutate(m.id);
  }

  const archivos = list.data ?? [];

  return (
    <div>
      <div className="flex justify-between items-start gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Multimedia</h1>
          <p className="text-xs text-gray-500 mt-1">
            Logos, fotos de médicos, banners e imágenes para los bloques del sitio.
          </p>
        </div>
        <div className="flex-shrink-0">
          <input
            ref={fileRef}
            type="file"
            hidden
            aria-label="Archivo a subir"
            accept={ACCEPT}
            onChange={(e) => e.target.files?.[0] && elegir(e.target.files[0])}
          />
          <button onClick={() => fileRef.current?.click()} className="btn-primary">Subir archivo</button>
        </div>
      </div>

      <div className="card p-4 mb-6 bg-blue-50 border-blue-200 text-sm">
        <h2 className="font-semibold text-brand mb-2">Qué acepta el servidor</h2>
        <ul className="space-y-1 text-gray-700">
          <li>• <strong>Formatos</strong>: JPG, PNG, WebP, GIF y PDF. Cada uno se guarda en su propio formato.</li>
          <li>• <strong>Transparencia y animación</strong>: se conservan. Un GIF o un WebP animado mantiene todos sus cuadros.</li>
          <li>• <strong>Peso máximo</strong>: {MAX_MB} MB.</li>
          <li>
            • <strong>Tamaño</strong>: se reduce al lado mayor de {MAX_LADO} px si lo supera; nunca se agranda. Un logo
            apaisado (por ejemplo 400×80) se acepta tal cual.
          </li>
          <li>• <strong>Fotos de médicos</strong>: cuadrada (1:1). Encuadre rostro y hombros.</li>
          <li>• <strong>Banners / hero</strong>: horizontal 16:9, 1600×900 px o más.</li>
          <li>• <strong>Logos</strong>: PNG o WebP con fondo transparente. SVG no se acepta por ahora.</li>
          <li>• Las fotos pierden su EXIF al procesarse: no se publica dónde ni con qué se tomaron.</li>
        </ul>
      </div>

      {pendiente && (
        <div className="card p-4 mb-6 border-2 border-brand">
          <h2 className="font-semibold mb-3">Confirmar subida</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              {pendiente.file.type.startsWith("image/") ? (
                <img src={pendiente.url} alt="Vista previa" className="aspect-square w-full object-cover rounded border" />
              ) : (
                <div className="aspect-square flex items-center justify-center bg-gray-100 rounded text-4xl border">📄</div>
              )}
            </div>
            <div className="md:col-span-2 text-sm space-y-2">
              <div><strong>Archivo:</strong> {pendiente.file.name}</div>
              <div><strong>Tamaño:</strong> {kb(pendiente.file.size)}</div>
              {pendiente.revision.width && (
                <div><strong>Dimensiones:</strong> {pendiente.revision.width}×{pendiente.revision.height} px</div>
              )}
              {pendiente.revision.warnings.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs">
                  {pendiente.revision.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
              <div>
                <label className="label" htmlFor="alt-nuevo">Texto alternativo</label>
                <input
                  id="alt-nuevo"
                  className="input"
                  value={alt}
                  maxLength={255}
                  onChange={(e) => setAlt(e.target.value)}
                  placeholder="Qué se ve en la imagen, para quien no puede verla"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Opcional, pero sin él la imagen no existe para un lector de pantalla ni para un buscador.
                </p>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => subir.mutate({ file: pendiente.file, alt })} disabled={subir.isPending} className="btn-primary">
                  {subir.isPending ? "Subiendo…" : "Confirmar y subir"}
                </button>
                <button onClick={cancelar} disabled={subir.isPending} className="btn-secondary">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {list.isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-2">
              <div className="aspect-square w-full rounded bg-gray-200 animate-pulse" />
              <div className="h-3 mt-2 bg-gray-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <div className="card p-5 border-red-200 bg-red-50">
          <p className="text-sm text-red-800 font-medium">No se pudo cargar la biblioteca.</p>
          <button onClick={() => list.refetch()} className="btn-secondary mt-3">Reintentar</button>
        </div>
      ) : archivos.length === 0 ? (
        <div className="card p-10 text-center text-sm text-gray-500">Todavía no hay archivos en la biblioteca.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {archivos.map((m) => (
            <div key={m.id} className="card p-2">
              {m.mime.startsWith("image/") ? (
                <img
                  src={m.url}
                  alt={m.alt ?? ""}
                  loading="lazy"
                  decoding="async"
                  width={m.width ?? undefined}
                  height={m.height ?? undefined}
                  className="aspect-square w-full object-cover rounded"
                />
              ) : (
                <div className="aspect-square flex items-center justify-center bg-gray-100 rounded text-3xl">📄</div>
              )}
              <div className="text-xs text-gray-600 mt-1 break-all">{m.url}</div>
              <div className="text-xs text-gray-400">
                {/* Lo que informa el servidor sobre el archivo que quedó, no
                    sobre el que se eligió: son distintos cuando se recomprime. */}
                {formato(m.mime)} · {kb(m.size)}
                {m.width && m.height ? ` · ${m.width}×${m.height} px` : ""}
                {m.frames && m.frames > 1 ? ` · ${m.frames} cuadros` : ""}
              </div>
              {m.alt ? (
                <div className="text-xs text-gray-500 truncate" title={m.alt}>{m.alt}</div>
              ) : (
                <div className="text-xs text-amber-700">Sin texto alternativo</div>
              )}
              <div className="flex justify-between mt-1">
                <button onClick={() => navigator.clipboard.writeText(m.url)} className="text-xs text-brand">Copiar URL</button>
                <button onClick={() => eliminar(m)} disabled={borrar.isPending} className="text-xs text-red-600">Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
