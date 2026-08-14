import type { VideoEmbedProps } from "@sa/shared/blocks";
import { isAllowedVideoEmbed, toVideoEmbedUrl } from "@sa/shared/embed-hosts";

/**
 * Video embebido, de los proveedores que la CSP permite.
 *
 * Antes se aceptaba cualquier URL https. La CSP de producción sólo lista
 * algunos hosts en `frame-src`, así que ese iframe pasaba la validación del
 * front y el navegador lo bloqueaba igual: quedaba un rectángulo negro sin
 * ninguna explicación.
 *
 * La lista de proveedores es una sola —`shared/types/embed-hosts.ts`— y de ahí
 * sale también lo que la CSP permite y lo que la API acepta guardar. De YouTube
 * y Vimeo se reconstruye la URL de embed a partir del id, así que lo que entra
 * al `src` no depende de lo que haya guardado el panel.
 */
export default function VideoEmbed({ url, caption }: VideoEmbedProps) {
  const src = toVideoEmbedUrl(url);
  // Segunda comprobación sobre el valor final: si el reescrito no cae en la
  // lista, no se dibuja nada.
  if (!isAllowedVideoEmbed(src)) return null;
  return (
    <section className="container-x py-8">
      <div className="aspect-video rounded overflow-hidden bg-black">
        <iframe src={src} className="w-full h-full" allowFullScreen title={caption ?? "video"} />
      </div>
      {caption && <p className="text-center text-sm text-gray-500 mt-2">{caption}</p>}
    </section>
  );
}
