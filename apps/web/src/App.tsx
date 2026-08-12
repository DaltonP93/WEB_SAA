import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { api, applyTheme } from "./api";
import Layout from "./components/Layout";
import DynamicPage from "./pages/DynamicPage";
import DoctorsPage from "./pages/DoctorsPage";
import DoctorDetailPage from "./pages/DoctorDetailPage";
import SpecialtyDetailPage from "./pages/SpecialtyDetailPage";
import NotFoundPage from "./pages/NotFoundPage";

/** Rutas del portal unificadas en /portal-paciente (item 23 de la minuta). */
const PORTAL_REDIRECTS = [
  "/portal-resultados-diagnostico",
  "/portal-resultados-laboratorio",
  "/portal-presupuestos-cirugia",
  "/portal-facturacion-electronica",
];

export default function App() {
  const location = useLocation();
  const reduced = useReducedMotion();
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
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: reduced ? 0 : 0.25, ease: "easeOut" }}
          >
            <Routes location={location}>
              <Route path="/" element={<DynamicPage slug="home" />} />
              <Route path="/profesionales" element={<DoctorsPage />} />
              <Route path="/profesionales/:slug" element={<DoctorDetailPage />} />
              <Route path="/especialidades/:slug" element={<SpecialtyDetailPage />} />
              {/* Portal del paciente: una sola ruta canónica. Las páginas
                  sueltas anteriores redirigen para no perder enlaces viejos. */}
              {PORTAL_REDIRECTS.map((from) => (
                <Route key={from} path={from} element={<Navigate to="/portal-paciente" replace />} />
              ))}
              {/* La sección Noticias se retiró del sitio público (minuta de ajustes).
                  El CRUD sigue en el admin por si se reactiva más adelante. */}
              <Route path="/:slug" element={<DynamicPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </Layout>
    </>
  );
}

function absoluteUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
}
