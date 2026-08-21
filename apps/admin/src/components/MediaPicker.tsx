import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";

/**
 * Elegir una imagen de la biblioteca, en cualquier campo del panel.
 *
 * Antes los campos de imagen del Page Builder eran una caja de texto: había
 * que ir a Multimedia, copiar la URL a mano y pegarla. Eso produce dos cosas
 * que no se ven hasta que el sitio está publicado — una URL con un carácter de
 * más, y un `<img>` sin `width`/`height` que hace saltar la página al cargar,
 * porque quien pega una URL no copia también las dimensiones.
 *
 * El selector devuelve las cuatro cosas juntas: URL, alt, ancho y alto. Los
 * tres últimos salen de lo que el pipeline midió sobre el archivo real.
 *
 * ## Sólo imágenes
 *
 * La biblioteca guarda también PDFs. Un PDF en un campo `imageUrl` produce un
 * `<img>` roto en el sitio público, así que no se ofrecen. El filtro es por el
 * `mime` **efectivo** que calculó el servidor, no por la extensión de la URL.
 *
 * ## La URL manual sigue existiendo
 *
 * Se puede seguir escribiendo una URL a mano: hay imágenes institucionales
 * alojadas fuera, y quitar esa posibilidad rompería bloques que ya la usan.
 * Elegir de la biblioteca es el camino cómodo, no el único.
 */

export interface MediaSeleccionada {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

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

export const MEDIA_KEY = "adm-media";

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

/** `image/webp` → `WEBP`. */
const formato = (mime: string) => (mime.split("/")[1] ?? mime).replace("jpeg", "jpg").toUpperCase();

const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function MediaPicker({
  value,
  onChange,
  onPick,
  label = "Imagen",
  id,
}: {
  value: string;
  /** Cambio de la URL a secas, para la escritura manual. */
  onChange: (url: string) => void;
  /** Selección desde la biblioteca, con los metadatos que midió el servidor. */
  onPick?: (media: MediaSeleccionada) => void;
  label?: string;
  id?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const dialogoRef = useRef<HTMLDivElement>(null);
  const abrirRef = useRef<HTMLButtonElement>(null);

  const lista = useQuery({
    queryKey: [MEDIA_KEY],
    queryFn: async () => (await api.get("/admin/media")).data as Media[],
    // No hace falta consultar la biblioteca hasta que alguien la abre.
    enabled: abierto,
  });

  const imagenes = useMemo(() => {
    const todas = (lista.data ?? []).filter((m) => m.mime.startsWith("image/"));
    const q = norm(busqueda.trim());
    if (!q) return todas;
    // Se busca por texto alternativo y por nombre de archivo: son las dos
    // cosas que alguien recuerda de una imagen que subió.
    return todas.filter((m) => norm(`${m.alt ?? ""} ${m.url}`).includes(q));
  }, [lista.data, busqueda]);

  // Cerrar con Escape y devolver el foco al botón que abrió: sin esto, quien
  // navega con teclado queda al principio de la página después de cerrar.
  useEffect(() => {
    if (!abierto) return;
    function alTeclado(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setAbierto(false);
        abrirRef.current?.focus();
      }
    }
    window.addEventListener("keydown", alTeclado);
    dialogoRef.current?.querySelector<HTMLElement>("input,button")?.focus();
    return () => window.removeEventListener("keydown", alTeclado);
  }, [abierto]);

  function elegir(m: Media) {
    onChange(m.url);
    onPick?.({ url: m.url, alt: m.alt, width: m.width, height: m.height });
    setAbierto(false);
    abrirRef.current?.focus();
  }

  return (
    <div>
      <div className="flex gap-2 items-start">
        {value ? (
          <img
            src={value}
            alt=""
            className="h-12 w-12 object-contain border rounded bg-white flex-shrink-0"
            // Decorativa: el valor real ya se ve en la caja de texto de al lado.
            aria-hidden="true"
          />
        ) : (
          <div className="h-12 w-12 border rounded bg-gray-50 flex items-center justify-center text-gray-300 text-xs flex-shrink-0">
            —
          </div>
        )}
        <div className="flex-1 min-w-0">
          <input
            id={id}
            className="input"
            value={value ?? ""}
            placeholder="/uploads/… o una URL completa"
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="flex gap-2 mt-1">
            <button
              ref={abrirRef}
              type="button"
              className="btn-secondary text-xs"
              aria-haspopup="dialog"
              aria-expanded={abierto}
              onClick={() => setAbierto((v) => !v)}
            >
              Elegir de Multimedia
            </button>
            {value && (
              <button
                type="button"
                className="text-xs text-gray-500"
                onClick={() => onChange("")}
                aria-label={`Quitar ${label.toLowerCase()}`}
              >
                Quitar
              </button>
            )}
          </div>
        </div>
      </div>

      {abierto && (
        <div
          ref={dialogoRef}
          role="dialog"
          aria-modal="false"
          aria-label="Elegir imagen de Multimedia"
          className="border rounded mt-2 p-3 bg-white shadow-sm"
        >
          <div className="flex gap-2 items-center mb-3">
            <input
              className="input flex-1"
              placeholder="Buscar por texto alternativo o nombre…"
              aria-label="Buscar imagen"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            <button type="button" className="text-xs text-gray-500" onClick={() => setAbierto(false)}>
              Cerrar
            </button>
          </div>

          {lista.isLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="aspect-square rounded bg-gray-200 animate-pulse" />
              ))}
            </div>
          ) : lista.isError ? (
            <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded p-3">
              No se pudo cargar la biblioteca.
              <button type="button" className="btn-secondary text-xs ml-2" onClick={() => lista.refetch()}>
                Reintentar
              </button>
            </div>
          ) : imagenes.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center">
              {busqueda.trim()
                ? "Ninguna imagen coincide con esa búsqueda."
                : "Todavía no hay imágenes en la biblioteca."}
              <div className="mt-2">
                <Link to="/media" className="text-brand text-xs">
                  Ir a Multimedia para subir una
                </Link>
              </div>
            </div>
          ) : (
            <>
              <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-y-auto list-none">
                {imagenes.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => elegir(m)}
                      className={`w-full text-left border rounded p-1 hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand ${
                        m.url === value ? "border-brand ring-1 ring-brand" : ""
                      }`}
                      // El nombre accesible dice qué se elige y de qué tamaño;
                      // "Imagen 1", "Imagen 2" no le sirve a nadie.
                      aria-label={`Elegir ${m.alt || m.url.split("/").pop()}${
                        m.width && m.height ? `, ${m.width}×${m.height} píxeles` : ""
                      }`}
                      aria-current={m.url === value ? "true" : undefined}
                    >
                      <img
                        src={m.url}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        decoding="async"
                        className="aspect-square w-full object-contain bg-gray-50 rounded"
                      />
                      <div className="text-[11px] text-gray-500 mt-1 truncate">
                        {m.alt || m.url.split("/").pop()}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {formato(m.mime)} · {kb(m.size)}
                        {m.width && m.height ? ` · ${m.width}×${m.height}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-right">
                <Link to="/media" className="text-brand text-xs">
                  Subir una imagen nueva
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
