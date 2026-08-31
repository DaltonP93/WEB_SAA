import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "../api";
import BlockRenderer from "../blocks/BlockRenderer";
import PageSkeleton from "../components/PageSkeleton";

export default function DynamicPage({ slug }: { slug?: string }) {
  const params = useParams();
  const s = slug ?? params.slug ?? "home";
  const { data, isLoading, isError } = useQuery({
    queryKey: ["page", s],
    queryFn: async () => (await api.get(`/public/pages/${s}`)).data,
  });

  if (isLoading) return <PageSkeleton />;
  if (isError || !data) return <div className="container-x py-12">Página no encontrada.</div>;
  const canonicalUrl = `${window.location.origin}${s === "home" ? "/" : `/${s}`}`;
  const title = data.seo?.title ?? data.title;
  const description = data.seo?.description ?? "";

  return (
    <>
      <Helmet>
        <title>{title}</title>
        {description && <meta name="description" content={description} />}
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:type" content="website" />
      </Helmet>
      <BlockRenderer blocks={data.blocks} />
    </>
  );
}
