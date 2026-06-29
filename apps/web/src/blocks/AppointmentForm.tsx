import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { AppointmentFormProps } from "@sa/shared/blocks";

export default function AppointmentForm({ heading = "Solicitar turno", defaultSpecialtyId }: AppointmentFormProps) {
  const [searchParams] = useSearchParams();
  const doctorSlugParam = searchParams.get("doctor") ?? "";

  const settings = useQuery({ queryKey: ["settings"], queryFn: async () => (await api.get("/public/settings")).data });
  const specs = useQuery({ queryKey: ["specialties"], queryFn: async () => (await api.get("/public/specialties")).data });
  // Cargar info del doctor si vino por query param ?doctor=slug
  const doctor = useQuery({
    queryKey: ["doctor-for-form", doctorSlugParam],
    enabled: !!doctorSlugParam,
    queryFn: async () => (await api.get(`/public/doctors/${doctorSlugParam}`)).data,
  });

  const [form, setForm] = useState({
    name: "",
    specialtyId: defaultSpecialtyId ? String(defaultSpecialtyId) : "",
    preferredAt: "",
    message: "",
  });

  // Cuando el doctor se carga, pre-seleccionar su especialidad (si tiene 1).
  useEffect(() => {
    if (!doctor.data) return;
    setForm((f) => ({
      ...f,
      specialtyId: f.specialtyId || (doctor.data.specialties?.[0]?.id ? String(doctor.data.specialties[0].id) : f.specialtyId),
    }));
  }, [doctor.data]);

  const waNumber = useMemo(() => (settings.data?.contact?.whatsapp ?? "").replace(/[^0-9]/g, ""), [settings.data]);

  function specialtyName(): string | undefined {
    if (!form.specialtyId) return undefined;
    return ((specs.data ?? []) as any[]).find((s) => String(s.id) === form.specialtyId)?.name;
  }

  function waHref(): string {
    const lines = ["Hola, quisiera solicitar un turno."];
    if (form.name.trim()) lines.push(`Nombre: ${form.name.trim()}`);
    if (doctor.data?.name) lines.push(`Médico: ${doctor.data.name}`);
    const spec = specialtyName();
    if (spec) lines.push(`Especialidad: ${spec}`);
    if (form.preferredAt) lines.push(`Fecha y hora preferidas: ${new Date(form.preferredAt).toLocaleString()}`);
    if (form.message.trim()) lines.push(`Detalle: ${form.message.trim()}`);
    return `https://wa.me/${waNumber}?text=${encodeURIComponent(lines.join("\n"))}`;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!waNumber) return;
    window.open(waHref(), "_blank", "noopener,noreferrer");
  }

  return (
    <section className="container-x py-12">
      <h2 className="text-2xl font-bold mb-6 text-primary">{heading}</h2>
      {doctor.data && (
        <div className="mb-4 max-w-2xl p-3 bg-secondary/10 border border-secondary/30 rounded text-sm">
          Reservando con <strong>{doctor.data.name}</strong>
          {doctor.data.specialties?.length ? ` · ${doctor.data.specialties.map((s: any) => s.name).join(", ")}` : ""}
        </div>
      )}
      <p className="mb-6 max-w-2xl text-sm text-ink/70">
        Completá los datos y te llevamos a WhatsApp para coordinar tu turno con la recepción.
      </p>
      <form onSubmit={submit} className="grid gap-4 max-w-2xl">
        <div>
          <label htmlFor="appt-name" className="block text-sm font-medium mb-1">Nombre completo</label>
          <input id="appt-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border rounded px-3 py-2 w-full" />
        </div>
        <div>
          <label htmlFor="appt-specialty" className="block text-sm font-medium mb-1">Especialidad (opcional)</label>
          <select id="appt-specialty" value={form.specialtyId} onChange={(e) => setForm({ ...form, specialtyId: e.target.value })} className="border rounded px-3 py-2 w-full">
            <option value="">Seleccionar especialidad</option>
            {(specs.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="appt-datetime" className="block text-sm font-medium mb-1">Fecha y hora preferidas (opcional)</label>
          <input id="appt-datetime" type="datetime-local" value={form.preferredAt} onChange={(e) => setForm({ ...form, preferredAt: e.target.value })} className="border rounded px-3 py-2 w-full" />
        </div>
        <div>
          <label htmlFor="appt-message" className="block text-sm font-medium mb-1">Mensaje / detalles (opcional)</label>
          <textarea id="appt-message" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="border rounded px-3 py-2 w-full" />
        </div>
        <button disabled={!waNumber} className="btn-primary self-start inline-flex items-center gap-2">
          <span aria-hidden>💬</span>
          {waNumber ? "Solicitar turno por WhatsApp" : "WhatsApp no disponible"}
        </button>
        {!waNumber && <p className="text-sm text-red-700">No hay un número de WhatsApp configurado. Comunicate por los datos de contacto.</p>}
      </form>
    </section>
  );
}
