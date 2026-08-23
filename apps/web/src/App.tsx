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
import { CHANNEL_KEYS, socialChannels, useContactChannels } from "./lib/contact-channels";
import ConsentBanner from "./components/ConsentBanner";
import { useConsentimiento } from "./lib/consent";
import { cargarAnalitica, hayMedicion } from "./lib/analytics";
import { capturarAtribucion } from "./lib/attribution";

/**
 * Rutas del portal unificadas en /portal-paciente (item 23 de la minuta).
 *
 * Es el respaldo: si el endpoint de redirects no responde, estas cuatro se
 * redirigen igual del lado del cliente. La lista viva —incluidos los redirects
 * que se cargan desde el panel— llega de `/public/redirects`. `tests/sitemap.test.ts`
 * exige que esta constante siga listando exactamente las rutas legacy.
 */
const PORTAL_REDIRECTS = [
  "/portal-resultados-diagnostico",
  "/portal-resultados-laboratorio",
  "/portal-presupuestos-cirugia",
  "/portal-facturacion-electronica",
];

const PORTAL_CANONICAL = "/portal-paciente";

/** Sólo se redirige a rutas internas: nunca fuera del sitio. */
function esRutaInterna(to: unknown): to is string {
  return typeof to === "string" && to.startsWith("/") && to[1] !== "/" && !to.startsWith("/\\");
}

export default function App() {
  const location = useLocation();
  const reduced = useReducedMotion();
  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/public/settings")).data,
  });
  // Redirects administrables (incluye las cuatro legacy sembradas). Si falla, se
  // cae al respaldo estático de las legacy.
  const redirectsQ = useQuery({
    queryKey: ["redirects"],
    queryFn: async () => (await api.get("/public/redirects")).data as { from: string; to: string }[],
  });
  const redirects =
    redirectsQ.data && redirectsQ.data.length > 0
      ? redirectsQ.data.filter((r) => esRutaInterna(r.to))
      : PORTAL_REDIRECTS.map((from) => ({ from, to: PORTAL_CANONICAL }));

  useEffect(() => {
    if (settingsQ.data?.theme) applyTheme(settingsQ.data.theme);
  }, [settingsQ.data]);

  // La atribución se captura una vez, al arrancar: es la primera vista de la
  // sesión la que trae los parámetros de campaña. No depende del
  // consentimiento (ver `lib/attribution.ts`: es dato de primera parte que sólo
  // viaja si la persona envía un formulario).
  useEffect(() => {
    capturarAtribucion();
  }, []);

  const { analiticaPermitida } = useConsentimiento();
  const analytics = settingsQ.data?.analytics;
  const medicionConfigurada = hayMedicion(analytics);

  // La medición de terceros carga sólo con las dos condiciones a la vez: hay ID
  // configurado y la persona aceptó. Cualquier cambio en una de las dos vuelve
  // a evaluar; `cargarAnalitica` es idempotente, así que no duplica nada.
  useEffect(() => {
    if (medicionConfigurada && analiticaPermitida) cargarAnalitica(analytics);
  }, [medicionConfigurada, analiticaPermitida, analytics]);

  const brand = settingsQ.data?.brand;
  const seo = settingsQ.data?.seo;
  const contact = settingsQ.data?.contact;
  // Teléfono, correo y redes del JSON-LD salen de Canales de contacto, igual
  // que el header y el pie: no hay una copia en settings.
  const { channels, get } = useContactChannels();
  const telephone = get(CHANNEL_KEYS.emergencias)?.value || get(CHANNEL_KEYS.recepcion)?.value || undefined;
  const email = get(CHANNEL_KEYS.email)?.value || undefined;
  const sameAs = socialChannels(channels).map((s) => s.href);
  const canonicalUrl = `${window.location.origin}${location.pathname}`;
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "MedicalOrganization",
    name: brand?.name ?? "Sanatorio Adventista de Asunción",
    url: window.location.origin,
    logo: brand?.logoUrl ? absoluteUrl(brand.logoUrl) : undefined,
    address: contact?.address,
    telephone,
    email,
    ...(sameAs.length ? { sameAs } : {}),
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
        {/* Verificación de propiedad: la etiqueta sólo aparece si hay token
            configurado. El valor ya viene validado por formato desde la API. */}
        {seo?.verification?.google && (
          <meta name="google-site-verification" content={seo.verification.google} />
        )}
        {seo?.verification?.bing && <meta name="msvalidate.01" content={seo.verification.bing} />}
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
              {/* Redirects administrables: una sola ruta canónica para el
                  portal más lo que se cargue desde el panel. Las páginas sueltas
                  anteriores redirigen para no perder enlaces viejos. */}
              {redirects.map((r) => (
                <Route key={r.from} path={r.from} element={<Navigate to={r.to} replace />} />
              ))}
              {/* La sección Noticias se retiró del sitio público (minuta de ajustes).
                  El CRUD sigue en el admin por si se reactiva más adelante. */}
              <Route path="/:slug" element={<DynamicPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </Layout>
      {/* El aviso sólo aparece si hay algo que medir: sin ningún ID configurado
          no hay analítica que consentir. */}
      {medicionConfigurada && <ConsentBanner />}
    </>
  );
}

function absoluteUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
}
