import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { MapEmbedProps } from "@sa/shared/blocks";

export default function MapEmbed({ embedHtml, height = 400 }: MapEmbedProps) {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/public/settings")).data,
  });
  const html = embedHtml || data?.contact?.mapEmbed || "";
  if (!html) return null;
  return (
    <section className="container-x py-6">
      <div style={{ height }} className="rounded overflow-hidden" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
