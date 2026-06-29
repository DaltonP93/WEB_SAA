import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "../api";
import type { Doctor, Specialty } from "@sa/shared";

export default function DoctorDetailPage() {
  const { slug } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["doctor", slug],
    queryFn: async () => (await api.get(`/public/doctors/${slug}`)).data,
  });
  if (isLoading) return <div className="container-x py-12">Cargando…</div>;
  if (!data) return <div className="container-x py-12">No encontrado.</div>;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Physician",
    name: data.name,
    image: data.photoUrl,
    description: data.bio?.replace(/<[^>]+>/g, ""),
    medicalSpecialty: (data.specialties ?? []).map((s: any) => s.name),
    url: `${window.location.origin}/profesionales/${data.slug}`,
  };

  return (
    <>
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <section className="container-x py-12 grid md:grid-cols-3 gap-8">
        <div>
          <div className="aspect-square rounded overflow-hidden bg-gray-100">
            {data.photoUrl ? <img src={data.photoUrl} alt={data.name} loading="lazy" decoding="async" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-5xl text-gray-400">👤</div>}
          </div>
        </div>
        <div className="md:col-span-2">
          <h1 className="text-3xl font-bold text-primary">{data.name}</h1>
          <p className="text-gray-600 mt-2">{(data.specialties ?? []).map((s: any) => s.name).join(", ")}</p>
          {data.bio && <div className="prose mt-4" dangerouslySetInnerHTML={{ __html: data.bio }} />}
        </div>
      </section>
    </>
  );
}
