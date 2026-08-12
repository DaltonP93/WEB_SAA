import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SocialLinksProps } from "@sa/shared/blocks";
import SocialIcon, { type SocialKind } from "../components/SocialIcon";

const NETWORKS: { key: SocialKind; label: string; brand: string }[] = [
  { key: "facebook", label: "Facebook", brand: "bg-[#1877F2]" },
  { key: "instagram", label: "Instagram", brand: "bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]" },
  { key: "youtube", label: "YouTube", brand: "bg-[#FF0000]" },
  { key: "linkedin", label: "LinkedIn", brand: "bg-[#0A66C2]" },
];

export default function SocialLinks({
  heading = "Conócenos en nuestras redes",
  text,
  muted = true,
}: SocialLinksProps) {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/public/settings")).data,
  });
  const social = (data?.social ?? {}) as Record<string, string | undefined>;
  const whatsapp = (data?.contact?.whatsapp ?? "").replace(/[^0-9]/g, "");

  const links = NETWORKS.filter((n) => !!social[n.key]).map((n) => ({
    ...n,
    href: social[n.key] as string,
  }));
  if (whatsapp) {
    links.push({ key: "whatsapp", label: "WhatsApp", brand: "bg-[#25D366]", href: `https://wa.me/${whatsapp}` });
  }
  if (links.length === 0) return null;

  return (
    <section className={muted ? "bg-gray-50 section-y-md" : "section-y-md"}>
      <div className="container-x text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-primary mb-2">{heading}</h2>
        <p className="text-gray-600 mb-8 max-w-2xl mx-auto">
          {text ?? "Seguinos para enterarte de novedades, campañas de salud y consejos de nuestros profesionales."}
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          {links.map((n) => (
            <a
              key={n.key}
              href={n.href}
              target="_blank"
              rel="noreferrer"
              aria-label={n.label}
              className="group flex flex-col items-center gap-2"
            >
              <span
                className={`w-14 h-14 rounded-full text-white flex items-center justify-center shadow-sm group-hover:shadow-md group-hover:-translate-y-1 transition-all duration-300 ${n.brand}`}
              >
                <SocialIcon kind={n.key} className="w-6 h-6" />
              </span>
              <span className="text-sm font-medium text-ink/80 group-hover:text-primary transition">{n.label}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
