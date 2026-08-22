import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../api";
import type { AppointmentFormProps } from "@sa/shared/blocks";
import { CHANNEL_KEYS, waDigits, useContactChannels } from "../lib/contact-channels";
import { irA } from "../lib/navigate";
import { obtenerAtribucion } from "../lib/attribution";
import Captcha, { useCaptchaConfig } from "../components/Captcha";

/**
 * Solicitud de turno: se registra y después sale a WhatsApp.
 *
 * WhatsApp sigue siendo el canal con el que se coordina el turno — el registro
 * no lo reemplaza—. Lo que agrega es que la solicitud **exista** para el
 * sanatorio aunque la conversación nunca ocurra: antes el formulario abría
 * WhatsApp y no dejaba rastro de nada.
 *
 * El orden importa: primero el `201`, después la salida. Si se hiciera al
 * revés, la navegación se lleva la página y el registro nunca termina.
 *
 * ## Lo que este formulario no puede hacer
 *
 * - **Perder lo que la persona escribió.** Si la API falla, el estado queda
 *   intacto y se puede reintentar. Y queda una salida explícita —"Continuar
 *   sólo por WhatsApp"— que dice con todas las letras que la solicitud no se
 *   registró.
 * - **Registrar dos veces.** Cada formulario lleva una clave de envío estable;
 *   el doble clic, el reintento y la respuesta perdida traen la misma y la API
 *   devuelve la solicitud que ya existe.
 * - **Guardar nada en el navegador.** Ni el borrador, ni el token del CAPTCHA.
 */

const inputClass =
  "border rounded px-3 py-2 w-full bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition";

/** Clave de envío del intento. Aleatoria, opaca y sin ningún dato adentro. */
function nuevaClave(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const VACIO = { name: "", phone: "", email: "", specialtyId: "", preferredAt: "", message: "" };

/**
 * La hora que la persona eligió, tal cual, sin pasar por `Date`.
 *
 * `<input type="datetime-local">` da una hora de pared —`"2027-03-15T10:30"`—
 * sin zona. `new Date(...).toLocaleString()` la interpretaba con la zona del
 * navegador, así que el mensaje de WhatsApp podía decir una hora distinta de
 * la que se marcó y de la que la API guarda (que es hora de Asunción).
 * Reformatear el texto no supone nada y no puede equivocarse.
 */
function horaElegida(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(valor);
  if (!m) return valor;
  const [, y, mes, d, h, min] = m;
  return `${d}/${mes}/${y} ${h}:${min}`;
}

export default function AppointmentForm({ heading = "Solicitar turno", defaultSpecialtyId }: AppointmentFormProps) {
  const [searchParams] = useSearchParams();
  const doctorSlugParam = searchParams.get("doctor") ?? "";

  const specs = useQuery({ queryKey: ["specialties"], queryFn: async () => (await api.get("/public/specialties")).data });
  // El WhatsApp de turnos sale de Canales de contacto (fuente única).
  const { firstWithValue } = useContactChannels();
  const turnosChannel = firstWithValue(CHANNEL_KEYS.turnos, CHANNEL_KEYS.general);
  // Cargar info del doctor si vino por query param ?doctor=slug
  const doctor = useQuery({
    queryKey: ["doctor-for-form", doctorSlugParam],
    enabled: !!doctorSlugParam,
    queryFn: async () => (await api.get(`/public/doctors/${doctorSlugParam}`)).data,
  });

  const [form, setForm] = useState({
    ...VACIO,
    specialtyId: defaultSpecialtyId ? String(defaultSpecialtyId) : "",
  });
  const [consent, setConsent] = useState(false);
  /** Honeypot: los bots lo completan, las personas no lo ven. */
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // La clave vive lo que vive el formulario: un reenvío del mismo intento
  // trae la misma y la API no crea una segunda solicitud.
  const claveRef = useRef(nuevaClave());

  const { config: captcha } = useCaptchaConfig();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [serverCaptchaError, setServerCaptchaError] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const captchaPending = Boolean(captcha) && !captchaToken;

  // Cuando el doctor se carga, pre-seleccionar su especialidad (si tiene 1).
  useEffect(() => {
    if (!doctor.data) return;
    setForm((f) => ({
      ...f,
      specialtyId: f.specialtyId || (doctor.data.specialties?.[0]?.id ? String(doctor.data.specialties[0].id) : f.specialtyId),
    }));
  }, [doctor.data]);

  const waNumber = useMemo(() => (turnosChannel?.value ? waDigits(turnosChannel.value) : ""), [turnosChannel]);

  function specialtyName(): string | undefined {
    if (!form.specialtyId) return undefined;
    return ((specs.data ?? []) as any[]).find((s) => String(s.id) === form.specialtyId)?.name;
  }

  function waHref(): string {
    const lines = ["Hola, quisiera solicitar un turno."];
    if (form.name.trim()) lines.push(`Nombre: ${form.name.trim()}`);
    if (form.phone.trim()) lines.push(`Teléfono: ${form.phone.trim()}`);
    if (doctor.data?.name) lines.push(`Médico: ${doctor.data.name}`);
    const spec = specialtyName();
    if (spec) lines.push(`Especialidad: ${spec}`);
    if (form.preferredAt) lines.push(`Fecha y hora preferidas: ${horaElegida(form.preferredAt)}`);
    if (form.message.trim()) lines.push(`Detalle: ${form.message.trim()}`);
    return `https://wa.me/${waNumber}?text=${encodeURIComponent(lines.join("\n"))}`;
  }

  /** Lo mínimo para no mandar a la API algo que va a rebotar igual. */
  function problema(): string | null {
    if (form.name.trim().length < 2) return "Escribí tu nombre completo.";
    if (form.phone.trim().length < 4) return "Escribí un teléfono de contacto.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) return "Escribí un correo válido.";
    if (!consent) return "Necesitamos tu aceptación para gestionar la solicitud.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Doble clic, Enter repetido: mientras hay una solicitud en curso no sale
    // otra. El `disabled` del botón cubre el clic; esto cubre el resto.
    if (state === "loading") return;
    if (!waNumber) return;

    const falla = problema();
    if (falla) {
      setErrorMsg(falla);
      setState("error");
      return;
    }

    setState("loading");
    setErrorMsg(null);
    try {
      await api.post("/public/appointments", {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        specialtyId: form.specialtyId ? Number(form.specialtyId) : undefined,
        doctorId: doctor.data?.id ?? undefined,
        preferredAt: form.preferredAt || undefined,
        message: form.message.trim() || undefined,
        consent: true,
        submissionKey: claveRef.current,
        captchaToken: captchaToken ?? undefined,
        // De dónde vino esta solicitud, si la persona llegó por una campaña.
        // `undefined` cuando no hay atribución: no se manda una clave vacía.
        attribution: obtenerAtribucion(),
        website,
      });

      const destino = waHref();
      setState("ok");
      // Se limpia lo que ya no hace falta. El token del CAPTCHA es de un solo
      // uso y no se conserva; la clave se renueva para que una segunda
      // solicitud sea una solicitud nueva y no un duplicado ignorado.
      setForm({ ...VACIO });
      setConsent(false);
      setCaptchaToken(null);
      setCaptchaKey((k) => k + 1);
      claveRef.current = nuevaClave();
      // Navegación en la misma pestaña: después de un `await`, `window.open()`
      // ya no cuenta como respuesta a un gesto y el navegador lo bloquea.
      irA(destino);
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (message?.includes("anti-spam")) {
        setServerCaptchaError("La verificación anti-spam no pasó. Probá de nuevo.");
        setCaptchaToken(null);
        setCaptchaKey((k) => k + 1);
      }
      // El formulario queda como estaba: se puede corregir y reintentar.
      setErrorMsg(
        message && !message.includes("anti-spam")
          ? message
          : "No pudimos registrar tu solicitud. Probá de nuevo en un momento.",
      );
      setState("error");
    }
  }

  return (
    <section className="container-x section-y-md">
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
          <input id="appt-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor="appt-phone" className="block text-sm font-medium mb-1">Teléfono</label>
          <input id="appt-phone" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor="appt-email" className="block text-sm font-medium mb-1">Email</label>
          <input id="appt-email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor="appt-specialty" className="block text-sm font-medium mb-1">Especialidad (opcional)</label>
          <select id="appt-specialty" value={form.specialtyId} onChange={(e) => setForm({ ...form, specialtyId: e.target.value })} className={inputClass}>
            <option value="">Seleccionar especialidad</option>
            {(specs.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="appt-datetime" className="block text-sm font-medium mb-1">Fecha y hora preferidas (opcional)</label>
          <input id="appt-datetime" type="datetime-local" value={form.preferredAt} onChange={(e) => setForm({ ...form, preferredAt: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor="appt-message" className="block text-sm font-medium mb-1">Mensaje / detalles (opcional)</label>
          <textarea id="appt-message" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className={inputClass} />
        </div>

        {/* Honeypot: fuera de la vista y fuera del recorrido de teclado. */}
        <div aria-hidden className="hidden">
          <label htmlFor="appt-website">No completar</label>
          <input id="appt-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>

        <Captcha
          key={`captcha-${captchaKey}`}
          onToken={setCaptchaToken}
          onError={(message) => {
            setCaptchaError(message);
            if (message) setServerCaptchaError(null);
          }}
        />
        {serverCaptchaError && <p role="alert" className="text-sm text-amber-700">{serverCaptchaError}</p>}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            required
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1"
            aria-describedby="appt-consent-help"
          />
          <span id="appt-consent-help">
            Acepto que el sanatorio use estos datos para gestionar mi solicitud de turno.{" "}
            <Link to="/privacidad" className="text-primary underline">Política de privacidad</Link>
          </span>
        </label>

        <button
          disabled={!waNumber || state === "loading" || captchaPending}
          title={captchaError ?? (captchaPending ? "Completá la verificación anti-spam" : undefined)}
          className="btn-turno btn-lg self-start inline-flex items-center gap-2 disabled:opacity-50"
        >
          {state === "loading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <span aria-hidden>💬</span>}
          {waNumber ? (state === "loading" ? "Enviando…" : "Solicitar turno por WhatsApp") : "WhatsApp no disponible"}
        </button>

        <AnimatePresence>
          {state === "ok" && (
            <motion.div key="ok" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-sm text-green-700">
              <p className="inline-flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Registramos tu solicitud. Te llevamos a WhatsApp para coordinar.
              </p>
            </motion.div>
          )}
          {state === "error" && (
            <motion.div key="err" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-sm">
              <p role="alert" className="text-amber-700 inline-flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {errorMsg}
              </p>
              {waNumber && (
                <p className="mt-2 text-ink/70">
                  Podés{" "}
                  {/* Salida explícita: es un clic del usuario, así que abrir en
                      otra pestaña acá sí es legítimo y no lo bloquea nadie. */}
                  <a href={waHref()} target="_blank" rel="noreferrer" className="text-primary underline">
                    continuar sólo por WhatsApp
                  </a>
                  . Tené en cuenta que en ese caso <strong>tu solicitud no queda registrada</strong> y
                  se coordina únicamente por el chat.
                </p>
              )}
            </motion.div>
          )}
          {!waNumber && (
            <motion.p
              key="no-wa"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-sm text-amber-700 inline-flex items-center gap-2"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-600 inline-block" />
              El WhatsApp de turnos todavía no está configurado. Escribinos por los otros canales de contacto.
            </motion.p>
          )}
        </AnimatePresence>
      </form>
    </section>
  );
}
