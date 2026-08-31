import SkeletonCard from "./SkeletonCard";

type Variante = "page" | "doctor" | "section";

/**
 * Silueta de carga a nivel de pantalla, en reemplazo del texto suelto
 * "Cargando…". Reutiliza `SkeletonCard` para las grillas: el pulso, los radios y
 * los tamaños de tarjeta ya están definidos ahí.
 *
 * - `page`    página del CMS (banda de hero + texto + grilla)
 * - `doctor`  ficha de profesional (foto cuadrada + datos)
 * - `section` tramo de contenido, para el fallback de los bloques lazy
 */
export default function PageSkeleton({ variant = "page" }: { variant?: Variante }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Cargando contenido…</span>
      {variant === "page" && <SiluetaPagina />}
      {variant === "doctor" && <SiluetaProfesional />}
      {variant === "section" && <SiluetaSeccion />}
    </div>
  );
}

function SiluetaPagina() {
  return (
    <>
      <div className="h-64 md:h-80 bg-gray-100 animate-pulse" />
      <div className="container-x section-y-sm">
        <div className="animate-pulse space-y-3 max-w-2xl">
          <div className="h-7 bg-gray-200 rounded w-2/5" />
          <div className="h-3 bg-gray-100 rounded w-full" />
          <div className="h-3 bg-gray-100 rounded w-4/5" />
        </div>
        <SkeletonCard count={3} className="mt-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" />
      </div>
    </>
  );
}

function SiluetaProfesional() {
  return (
    <section className="container-x py-12 grid md:grid-cols-3 gap-8 animate-pulse">
      <div className="aspect-square rounded bg-gray-200" />
      <div className="md:col-span-2 space-y-3">
        <div className="h-8 bg-gray-200 rounded w-3/5" />
        <div className="h-3 bg-gray-100 rounded w-2/5" />
        <div className="h-3 bg-gray-100 rounded w-full mt-6" />
        <div className="h-3 bg-gray-100 rounded w-11/12" />
        <div className="h-3 bg-gray-100 rounded w-3/4" />
      </div>
    </section>
  );
}

function SiluetaSeccion() {
  return (
    <div className="container-x section-y-sm">
      <div className="animate-pulse space-y-3 max-w-xl">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="h-3 bg-gray-100 rounded w-full" />
        <div className="h-3 bg-gray-100 rounded w-2/3" />
      </div>
    </div>
  );
}
