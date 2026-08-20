import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api";
import DataTable, { type DataTableColumn } from "../components/DataTable";
import { useConfirm } from "../components/ConfirmDialog";
import { downloadCsv } from "../lib/csv";

/**
 * Bandeja de solicitudes de turno.
 *
 * El turno se coordina por WhatsApp; acá no se responde nada. Lo que esta
 * pantalla resuelve es que la solicitud exista para el sanatorio aunque el
 * paciente no llegue a escribir, escriba desde otro número o su mensaje se
 * pierda entre cientos.
 *
 * Los datos personales que se ven acá **sólo se ven acá**: el endpoint público
 * nunca los devuelve y esta pantalla cuelga de `requireAuth`.
 */

type Estado = "pendiente" | "confirmado" | "cancelado";

interface Turno {
  id: number;
  name: string;
  phone: string;
  email: string;
  preferred_at: string | null;
  message: string | null;
  status: Estado;
  consent_at: string | null;
  created_at: string;
  updated_at: string | null;
  doctor_name: string | null;
  specialty_name: string | null;
}

export const APPOINTMENTS_KEY = "adm-appointments";

const ESTADOS: { value: Estado; label: string; clase: string }[] = [
  { value: "pendiente", label: "Pendiente", clase: "bg-amber-100 text-amber-900 border-amber-200" },
  { value: "confirmado", label: "Confirmado", clase: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { value: "cancelado", label: "Cancelado", clase: "bg-gray-100 text-gray-600 border-gray-200" },
];

const etiqueta = (estado: string) => ESTADOS.find((e) => e.value === estado) ?? ESTADOS[0];

const fecha = (valor: string | null) => (valor ? new Date(valor).toLocaleString() : "—");

export default function AppointmentsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();

  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Los filtros van en la clave: cambiar uno pide de nuevo al servidor en vez
  // de recortar en el navegador una lista que puede venir truncada por el
  // límite. La búsqueda libre sí la resuelve `DataTable` sobre lo que llegó.
  const filtros = { status, from, to };
  const list = useQuery({
    queryKey: [APPOINTMENTS_KEY, filtros],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      return (await api.get(`/admin/appointments${qs ? `?${qs}` : ""}`)).data as {
        items: Turno[];
        total: number;
      };
    },
  });

  const rows = useMemo(() => list.data?.items ?? [], [list.data]);

  const invalidar = () => qc.invalidateQueries({ queryKey: [APPOINTMENTS_KEY] });

  const cambiar = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: Estado }) =>
      api.put(`/admin/appointments/${id}`, { status }),
    onSuccess: () => {
      toast.success("Estado actualizado");
      invalidar();
    },
    onError: () => toast.error("No se pudo actualizar el estado"),
  });

  const borrar = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/appointments/${id}`),
    onSuccess: () => {
      toast.success("Solicitud eliminada");
      invalidar();
    },
    onError: () => toast.error("No se pudo eliminar la solicitud"),
  });

  async function eliminar(t: Turno) {
    const ok = await confirm({
      title: "Eliminar solicitud",
      message: `¿Eliminar la solicitud de ${t.name}? No se puede deshacer.`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (ok) borrar.mutate(t.id);
  }

  function exportar() {
    downloadCsv(
      "turnos.csv",
      rows.map((t) => ({
        created_at: fecha(t.created_at),
        name: t.name,
        phone: t.phone,
        email: t.email,
        specialty: t.specialty_name ?? "",
        doctor: t.doctor_name ?? "",
        preferred_at: fecha(t.preferred_at),
        status: etiqueta(t.status).label,
        message: t.message ?? "",
      })),
      [
        { key: "created_at", header: "Solicitado" },
        { key: "name", header: "Nombre" },
        { key: "phone", header: "Teléfono" },
        { key: "email", header: "Email" },
        { key: "specialty", header: "Especialidad" },
        { key: "doctor", header: "Médico" },
        { key: "preferred_at", header: "Preferencia" },
        { key: "status", header: "Estado" },
        { key: "message", header: "Mensaje" },
      ],
    );
  }

  const columnas: DataTableColumn<Turno>[] = [
    {
      key: "created_at",
      header: "Solicitado",
      sortable: true,
      accessor: (t) => t.created_at ?? "",
      render: (t) => <span className="whitespace-nowrap">{fecha(t.created_at)}</span>,
    },
    {
      key: "name",
      header: "Paciente",
      sortable: true,
      accessor: (t) => t.name,
      render: (t) => (
        <div>
          <div className="font-medium">{t.name}</div>
          <div className="text-xs text-gray-500">
            {t.phone}
            {t.email ? ` · ${t.email}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "specialty_name",
      header: "Especialidad / médico",
      sortable: true,
      accessor: (t) => `${t.specialty_name ?? ""} ${t.doctor_name ?? ""}`.trim(),
      render: (t) => (
        <div className="text-xs">
          <div>{t.specialty_name ?? "—"}</div>
          {t.doctor_name && <div className="text-gray-500">{t.doctor_name}</div>}
        </div>
      ),
    },
    {
      key: "preferred_at",
      header: "Preferencia",
      accessor: (t) => t.preferred_at ?? "",
      render: (t) => <span className="text-xs whitespace-nowrap">{fecha(t.preferred_at)}</span>,
    },
    {
      key: "status",
      header: "Estado",
      sortable: true,
      accessor: (t) => t.status,
      render: (t) => {
        const e = etiqueta(t.status);
        return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${e.clase}`}>{e.label}</span>;
      },
    },
    {
      key: "message",
      header: "Mensaje",
      accessor: (t) => t.message ?? "",
      render: (t) => <span className="text-xs text-gray-600 line-clamp-2">{t.message ?? "—"}</span>,
    },
  ];

  const pendientes = rows.filter((t) => t.status === "pendiente").length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Turnos</h1>
      <p className="text-sm text-gray-500 mb-6">
        Solicitudes recibidas desde el sitio. La coordinación sigue siendo por WhatsApp; acá queda el
        registro para que ninguna se pierda.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="label" htmlFor="f-estado">Estado</label>
          <select id="f-estado" value={status} onChange={(e) => setStatus(e.target.value)} className="input">
            <option value="">Todos</option>
            {ESTADOS.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-desde">Desde</label>
          <input id="f-desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="f-hasta">Hasta</label>
          <input id="f-hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
        </div>
        <button onClick={exportar} className="btn-secondary" disabled={rows.length === 0}>
          Exportar CSV
        </button>
        <span className="text-sm text-gray-500 ml-auto">
          {rows.length} solicitudes · {pendientes} pendientes
        </span>
      </div>

      {list.isError ? (
        <div className="card p-5 border-red-200 bg-red-50">
          <p className="text-sm text-red-800 font-medium">No se pudieron cargar las solicitudes.</p>
          <button onClick={() => list.refetch()} className="btn-secondary mt-3">Reintentar</button>
        </div>
      ) : (
        <DataTable
          columns={columnas}
          rows={rows}
          getRowId={(t) => t.id}
          loading={list.isLoading}
          searchPlaceholder="Buscar por nombre, teléfono, email, médico o especialidad…"
          emptyMessage="No hay solicitudes de turno con esos filtros."
          actions={(t) => (
            <div className="flex items-center justify-end gap-2">
              {t.status !== "confirmado" && (
                <button onClick={() => cambiar.mutate({ id: t.id, status: "confirmado" })} className="text-emerald-700 text-xs">
                  Confirmar
                </button>
              )}
              {t.status !== "cancelado" && (
                <button onClick={() => cambiar.mutate({ id: t.id, status: "cancelado" })} className="text-amber-700 text-xs">
                  Cancelar
                </button>
              )}
              {t.status !== "pendiente" && (
                <button onClick={() => cambiar.mutate({ id: t.id, status: "pendiente" })} className="text-brand text-xs">
                  Volver a pendiente
                </button>
              )}
              <button onClick={() => eliminar(t)} className="text-red-600 text-xs">Eliminar</button>
            </div>
          )}
        />
      )}
    </div>
  );
}
