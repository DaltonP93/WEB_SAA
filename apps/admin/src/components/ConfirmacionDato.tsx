import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api";
import { useConfirm } from "./ConfirmDialog";
import { useSesion } from "../hooks/useSesion";

/**
 * Registrar y retirar la confirmación escrita de un ítem.
 *
 * El mecanismo existía sólo como API: `PUT /api/admin/data-confirmations/:item`
 * con un `scope`. Funcionaba, estaba probado, y **no había forma de usarlo
 * desde el panel**: la guía de carga terminaba explicándole a un administrador
 * de sanatorio cómo mandar un `PUT` con curl. Una función que sólo se puede
 * ejercer desde una terminal no está entregada.
 *
 * ## Qué muestra
 *
 * Confirmado: quién, cuándo y **qué** se confirmó. Lo último es lo que
 * importa: "el alcance está confirmado" sin decir cuál es el alcance no le
 * sirve a quien tiene que revisarlo seis meses después.
 *
 * Sin confirmar: por qué está pendiente y, si quien mira puede confirmarlo, el
 * formulario para hacerlo.
 *
 * ## Por qué el editor ve el estado pero no el formulario
 *
 * Confirmar es una afirmación institucional y la API la reserva a
 * `superadmin`. Ofrecerle el formulario a un editor sería invitarlo a escribir
 * el alcance completo para recibir un 403 al guardar. Se le dice qué falta y
 * quién puede hacerlo — que es lo accionable para él: pedírselo a esa persona.
 */

export interface Confirmacion {
  confirmedAt: string;
  confirmedBy: { id: number | null; name: string | null };
  scope: string;
  note: string | null;
}

/** Espejo del mínimo que valida `cuerpoSchema` en la API. */
const MINIMO_ALCANCE = 10;

/**
 * La fecha, en la zona del sanatorio y en palabras.
 *
 * Un ISO crudo en pantalla obliga a quien lee a hacer la cuenta del huso.
 */
function cuando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-PY", {
    timeZone: "America/Asuncion",
    dateStyle: "long",
    timeStyle: "short",
  });
}

export default function ConfirmacionDato({
  item,
  confirmation,
  motivo,
}: {
  item: string;
  confirmation: Confirmacion | null;
  motivo?: string;
}) {
  const qc = useQueryClient();
  const confirmar = useConfirm();
  const { esSuperadmin } = useSesion();
  const [abierto, setAbierto] = useState(false);
  const [scope, setScope] = useState("");
  const [note, setNote] = useState("");

  const invalidar = () => qc.invalidateQueries({ queryKey: ["adm-data-readiness"] });

  const registrar = useMutation({
    mutationFn: async () =>
      api.put(`/admin/data-confirmations/${item}`, {
        scope: scope.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success("Confirmación registrada");
      setAbierto(false);
      setScope("");
      setNote("");
      invalidar();
    },
    // Sin esto, un rechazo del servidor no dice nada y el operador vuelve a
    // apretar el mismo botón esperando otro resultado.
    onError: (e: any) => toast.error(e.response?.data?.error ?? "No se pudo registrar la confirmación"),
  });

  const retirar = useMutation({
    mutationFn: async () => api.delete(`/admin/data-confirmations/${item}`),
    onSuccess: () => {
      toast.success("Confirmación retirada");
      invalidar();
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "No se pudo retirar la confirmación"),
  });

  async function pedirRetiro() {
    const ok = await confirmar({
      title: "Retirar la confirmación",
      message:
        "El ítem vuelve a figurar como pendiente de confirmación. Hacelo si el alcance dejó de ser " +
        "correcto: cambiaron los plazos, se dejó de hacer un estudio.",
      confirmLabel: "Retirar",
      danger: true,
    });
    if (ok) retirar.mutate();
  }

  if (confirmation) {
    return (
      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-900">
          Confirmado por {confirmation.confirmedBy.name ?? "el sanatorio"}
        </p>
        <p className="text-xs text-emerald-800 mt-0.5">{cuando(confirmation.confirmedAt)}</p>

        <dl className="mt-3 text-sm text-emerald-900">
          <dt className="text-xs uppercase tracking-wider font-semibold text-emerald-700">
            Alcance confirmado
          </dt>
          <dd className="mt-1 whitespace-pre-wrap">{confirmation.scope}</dd>
          {confirmation.note && (
            <>
              <dt className="text-xs uppercase tracking-wider font-semibold text-emerald-700 mt-3">
                Nota
              </dt>
              <dd className="mt-1 whitespace-pre-wrap">{confirmation.note}</dd>
            </>
          )}
        </dl>

        {esSuperadmin && (
          <button
            onClick={pedirRetiro}
            disabled={retirar.isPending}
            className="btn-secondary text-sm mt-4"
          >
            Retirar confirmación
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm text-amber-900">{motivo}</p>

      {!esSuperadmin && (
        <p className="text-xs text-amber-800 mt-2">
          Sólo un usuario con rol <strong>superadmin</strong> puede registrar esta confirmación.
        </p>
      )}

      {esSuperadmin && !abierto && (
        <button onClick={() => setAbierto(true)} className="btn-primary text-sm mt-3">
          Registrar confirmación
        </button>
      )}

      {esSuperadmin && abierto && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="label" htmlFor={`scope-${item}`}>
              Qué se confirma
            </label>
            <textarea
              id={`scope-${item}`}
              className="input min-h-[7rem]"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="Qué estudios se hacen, con qué requisitos y en qué plazos se entregan."
            />
            <p className="text-xs text-gray-600 mt-1">
              Queda como constancia de qué se afirmó, con tu nombre y la fecha. Escribilo con
              suficiente detalle para que otra persona pueda revisarlo más adelante.
            </p>
          </div>

          <div>
            <label className="label" htmlFor={`note-${item}`}>
              Nota interna (opcional)
            </label>
            <input
              id={`note-${item}`}
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Quién lo confirmó, en qué reunión, con qué documento."
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setAbierto(false);
                setScope("");
                setNote("");
              }}
              className="btn-secondary"
            >
              Cancelar
            </button>
            <button
              onClick={() => registrar.mutate()}
              // El mismo mínimo que aplica la API. Sin esto el botón está
              // habilitado, el servidor contesta 400 y el operador no sabe qué
              // le faltó.
              disabled={scope.trim().length < MINIMO_ALCANCE || registrar.isPending}
              className="btn-primary"
            >
              {registrar.isPending ? "Guardando…" : "Confirmar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
