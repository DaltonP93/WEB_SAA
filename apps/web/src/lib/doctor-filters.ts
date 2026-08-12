import type { Doctor } from "@sa/shared";

/**
 * Lógica de filtrado y conteo de la guía médica, separada del componente para
 * poder probarla. El contador tiene que distinguir cuántos profesionales se
 * encontraron de cuántos se están mostrando: con `limit` no son lo mismo.
 */

export interface DoctorResultSummary {
  /** Total que coincide con los filtros. */
  total: number;
  /** Cuántos se muestran (puede ser menor por `limit`). */
  shown: number;
  /** Cuántos quedaron fuera por el límite. */
  hiddenByLimit: number;
  /** Texto listo para la UI. */
  label: string;
}

export function filterByDoctor(doctors: Doctor[], doctorSlug: string): Doctor[] {
  if (!doctorSlug) return doctors;
  return doctors.filter((d) => d.slug === doctorSlug);
}

export function summarizeDoctors(
  doctors: Doctor[],
  options: { limit?: number; isLoading?: boolean } = {},
): DoctorResultSummary {
  const total = doctors.length;
  // Un límite inválido (0, negativo, NaN) se ignora en vez de vaciar la lista.
  const limit =
    typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : undefined;
  const shown = limit ? Math.min(limit, total) : total;
  const hiddenByLimit = total - shown;

  let label: string;
  if (options.isLoading) label = "Buscando…";
  else if (total === 0) label = "Sin resultados";
  else if (hiddenByLimit > 0) label = `Mostrando ${shown} de ${total} profesionales`;
  else label = `${total} ${total === 1 ? "profesional" : "profesionales"}`;

  return { total, shown, hiddenByLimit, label };
}
