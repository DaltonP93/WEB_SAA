import { useQuery } from "@tanstack/react-query";
import { MapPin, Navigation } from "lucide-react";
import { api } from "../api";
import type { MapEmbedProps } from "@sa/shared/blocks";
import { isMapEmbedUrl, isSafeExternalHref } from "../lib/url";

/**
 * El mapa nunca llega como HTML.
 *
 * La API publica sólo la URL ya validada contra Google Maps (`embedUrl` en el
 * bloque, `contact.mapEmbedUrl` en los ajustes) y acá se arma el `<iframe>`
 * con atributos fijos. Antes esto usaba `dangerouslySetInnerHTML` con lo que
 * viniera de la base: el saneo al guardar no cubría filas viejas ni escrituras
 * directas. Sin HTML no hay nada que insertar.
 */
export default function MapEmbed({ embedUrl, height = 400, heading, text, directionsUrl }: MapEmbedProps) {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/public/settings")).data,
  });
  const candidate = embedUrl || data?.contact?.mapEmbedUrl || "";
  // Defensa en profundidad: el front vuelve a exigir un mapa de Google por
  // HTTPS aunque la API ya lo haya validado.
  const src = isMapEmbedUrl(candidate) ? candidate : "";
  const address = text || data?.contact?.address || "";
  const rawDirections = directionsUrl || data?.contact?.mapsUrl || "";
  const directions = isSafeExternalHref(rawDirections) ? rawDirections : "";
  if (!src) return null;
  return (
    <section className="container-x py-6">
      {heading && <h2 className="text-2xl md:text-3xl font-bold text-primary mb-2">{heading}</h2>}
      {(address || directions) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4 text-sm">
          {address && (
            <span className="inline-flex items-center gap-2 text-gray-600">
              <MapPin className="w-4 h-4 text-primary" aria-hidden />
              {address}
            </span>
          )}
          {directions && (
            <a
              href={directions}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
            >
              <Navigation className="w-4 h-4" aria-hidden />
              Cómo llegar
            </a>
          )}
        </div>
      )}
      <div
        style={{ height }}
        className="rounded-2xl overflow-hidden shadow-xl border border-gray-200"
      >
        <iframe
          src={src}
          title="Mapa de ubicación"
          width="100%"
          height="100%"
          style={{ border: 0 }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      </div>
    </section>
  );
}
