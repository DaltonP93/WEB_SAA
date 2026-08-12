import { useQuery } from "@tanstack/react-query";
import { MapPin, Navigation } from "lucide-react";
import { api } from "../api";
import type { MapEmbedProps } from "@sa/shared/blocks";

export default function MapEmbed({ embedHtml, height = 400, heading, text, directionsUrl }: MapEmbedProps) {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/public/settings")).data,
  });
  const html = embedHtml || data?.contact?.mapEmbed || "";
  const address = text || data?.contact?.address || "";
  const directions = directionsUrl || data?.contact?.mapsUrl || "";
  if (!html) return null;
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
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}
