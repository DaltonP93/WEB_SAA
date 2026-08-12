import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { api } from "../api";
import type { ScheduleTableProps } from "@sa/shared/blocks";

interface ScheduleRow {
  id: number;
  key: string;
  area: string;
  days: string | null;
  hours: string | null;
  note: string | null;
}

/**
 * Horarios de atención (item 18).
 *
 * Se publican únicamente los horarios que el sanatorio cargó y activó desde el
 * panel. Mientras no haya ninguno, la sección lo dice explícitamente: no se
 * inventan horas ni se dejan datos de ejemplo como si fueran definitivos.
 */
export default function ScheduleTable({ heading, text, areaKeys }: ScheduleTableProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["schedules"],
    queryFn: async () => (await api.get("/public/schedules")).data as ScheduleRow[],
    staleTime: 5 * 60_000,
  });

  const all = data ?? [];
  const rows = areaKeys?.length ? all.filter((r) => areaKeys.includes(r.key)) : all;

  return (
    <section className="container-x section-y-md">
      {heading && <h2 className="text-2xl md:text-3xl font-bold text-primary mb-2">{heading}</h2>}
      {text && <p className="text-gray-600 mb-6 max-w-2xl">{text}</p>}

      {isLoading ? (
        <div className="h-32 rounded bg-gray-100 animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="rounded border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <Clock className="w-6 h-6 mx-auto text-gray-500 mb-2" aria-hidden />
          <p className="font-semibold text-primary">Horarios en proceso de confirmación</p>
          <p className="text-sm text-gray-600 mt-1">
            Estamos actualizando los horarios de atención. Mientras tanto, consultanos por los
            canales de contacto y te confirmamos el horario del servicio que necesitás.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Horarios de atención por área</caption>
            <thead>
              <tr className="bg-gray-50">
                <th scope="col" className="px-4 py-3 font-semibold text-primary">Área</th>
                <th scope="col" className="px-4 py-3 font-semibold text-primary">Días</th>
                <th scope="col" className="px-4 py-3 font-semibold text-primary">Horario</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 align-top">
                  <th scope="row" className="px-4 py-3 font-medium text-ink">
                    {r.area}
                    {r.note && <span className="block text-xs font-normal text-gray-600">{r.note}</span>}
                  </th>
                  <td className="px-4 py-3 text-gray-700">{r.days || "—"}</td>
                  <td className="px-4 py-3 text-gray-700">{r.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
