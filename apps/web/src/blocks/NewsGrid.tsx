import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { NewsGridProps } from "@sa/shared/blocks";

export default function NewsGrid({ limit, columns = 3 }: NewsGridProps) {
  const { data } = useQuery({
    queryKey: ["news", limit],
    queryFn: async () => (await api.get("/public/news", { params: { limit } })).data,
  });
  const cols = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[columns];
  return (
    <section className="container-x py-12">
      <h2 className="text-2xl md:text-3xl font-bold mb-6 text-primary">Noticias</h2>
      <div className={`grid grid-cols-1 ${cols} gap-5`}>
        {(data ?? []).map((n: any) => (
          <Link to={`/noticias/${n.slug}`} key={n.id} className="bg-white rounded shadow overflow-hidden hover:shadow-lg transition">
            {n.cover_url && <img src={n.cover_url} alt={n.title} className="w-full h-48 object-cover" />}
            <div className="p-4">
              <h3 className="font-semibold text-primary">{n.title}</h3>
              {n.excerpt && <p className="text-sm text-gray-600 mt-1">{n.excerpt}</p>}
              {n.published_at && <p className="text-xs text-gray-400 mt-2">{new Date(n.published_at).toLocaleDateString("es-PY")}</p>}
            </div>
          </Link>
        ))}
      </div>
      {(!data || data.length === 0) && <p className="text-gray-500">Próximamente publicaremos novedades.</p>}
    </section>
  );
}
