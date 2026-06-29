import { Routes, Route, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { api, applyTheme } from "./api";
import Layout from "./components/Layout";
import DynamicPage from "./pages/DynamicPage";
import DoctorsPage from "./pages/DoctorsPage";
import DoctorDetailPage from "./pages/DoctorDetailPage";
import SpecialtyDetailPage from "./pages/SpecialtyDetailPage";
import NewsListPage from "./pages/NewsListPage";
import NewsDetailPage from "./pages/NewsDetailPage";
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  const location = useLocation();
  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/public/settings")).data,
  });

  useEffect(() => {
    if (settingsQ.data?.theme) applyTheme(settingsQ.data.theme);
  }, [settingsQ.data]);

  const brand = settingsQ.data?.brand;
  const seo = settingsQ.data?.seo;
  const contact = settingsQ.data?.contact;
  const canonicalUrl = `${window.location.origin}${location.pathname}`;
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "MedicalOrganization",
    name: brand?.name ?? "Sanatorio Adventista de Asunción",
    url: window.location.origin,
    logo: brand?.logoUrl ? absoluteUrl(brand.logoUrl) : undefined,
    address: contact?.address,
    telephone: contact?.phones?.[0],
    email: contact?.email,
  };

  return (
    <>
      <Helmet>
        <title>{seo?.title ?? brand?.name ?? "Sanatorio Adventista"}</title>
        {seo?.description && <meta name="description" content={seo.description} />}
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={seo?.title ?? brand?.name ?? "Sanatorio Adventista"} />
        <meta property="og:description" content={seo?.description ?? ""} />
        <meta property="og:image" content={seo?.ogImage ?? brand?.logoUrl ?? ""} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={seo?.title ?? brand?.name ?? "Sanatorio Adventista"} />
        <meta name="twitter:description" content={seo?.description ?? ""} />
        <meta name="twitter:image" content={seo?.ogImage ?? brand?.logoUrl ?? ""} />
        {brand?.faviconUrl && <link rel="icon" href={brand.faviconUrl} />}
        <script type="application/ld+json">{JSON.stringify(orgJsonLd)}</script>
      </Helmet>
      <Layout settings={settingsQ.data}>
        <Routes>
          <Route path="/" element={<DynamicPage slug="home" />} />
          <Route path="/profesionales" element={<DoctorsPage />} />
          <Route path="/profesionales/:slug" element={<DoctorDetailPage />} />
          <Route path="/especialidades/:slug" element={<SpecialtyDetailPage />} />
          <Route path="/noticias" element={<NewsListPage />} />
          <Route path="/noticias/:slug" element={<NewsDetailPage />} />
          <Route path="/:slug" element={<DynamicPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
    </>
  );
}

function absoluteUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
}
