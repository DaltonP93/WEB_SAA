import type { VideoEmbedProps } from "@sa/shared/blocks";
import { safeIframeSrc } from "../lib/url";

/**
 * Video embebido.
 *
 * De YouTube y Vimeo se reconstruye la URL de embed a partir del id, así que
 * lo que entra al `src` no depende de lo que haya guardado el panel. Para
 * cualquier otro proveedor se exige una URL https; el resto —`javascript:`,
 * `data:`, http sin TLS— no se dibuja. Un iframe ejecuta lo que carga: es la
 * superficie donde menos se puede confiar en el dato almacenado.
 */
function getEmbed(url: string) {
  if (!url) return "";
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return safeIframeSrc(url);
}

export default function VideoEmbed({ url, caption }: VideoEmbedProps) {
  const src = getEmbed(url);
  if (!src) return null;
  return (
    <section className="container-x py-8">
      <div className="aspect-video rounded overflow-hidden bg-black">
        <iframe src={src} className="w-full h-full" allowFullScreen title={caption ?? "video"} />
      </div>
      {caption && <p className="text-center text-sm text-gray-500 mt-2">{caption}</p>}
    </section>
  );
}
