import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/** Slugs de las páginas publicadas, para linkear solo cuando el destino existe. */
export function usePageSlugs(): Set<string> {
  const { data } = useQuery({
    queryKey: ["pages"],
    queryFn: async () => (await api.get("/public/pages")).data as { slug: string }[],
    staleTime: 5 * 60_000,
  });
  return useMemo(() => new Set((data ?? []).map((p) => p.slug)), [data]);
}

/** Servicios cuya página de detalle no coincide con su propio slug. */
const SERVICE_PAGE: Record<string, string> = {
  laboratorio: "estudios-laboratorio",
  "diagnostico-por-imagenes": "estudios-diagnostico-imagenes",
  "estudios-cardiologicos": "estudios-cardiologicos",
  biopsias: "estudios-biopsias",
  "seguro-medico-samap": "samap",
  consultorios: "especialidades",
};

/** Cada categoría de estudio tiene su página de detalle. */
const STUDY_CATEGORY_PAGE: Record<string, string> = {
  laboratorio: "estudios-laboratorio",
  imagenes: "estudios-diagnostico-imagenes",
  cardiologicos: "estudios-cardiologicos",
  biopsias: "estudios-biopsias",
};

export function serviceHref(slug: string, pageSlugs: Set<string>): string | undefined {
  const target = SERVICE_PAGE[slug] ?? slug;
  return pageSlugs.has(target) ? `/${target}` : undefined;
}

export function studyHref(
  study: { slug?: string | null; category?: string | null },
  pageSlugs: Set<string>,
): string | undefined {
  const target = study.category ? STUDY_CATEGORY_PAGE[study.category] : undefined;
  return target && pageSlugs.has(target) ? `/${target}` : undefined;
}
