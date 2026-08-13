import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { api } from "../api";
import type { ContactFormProps } from "@sa/shared/blocks";
import Captcha, { useCaptchaConfig } from "../components/Captcha";

const inputClass =
  "border rounded px-3 py-2 w-full bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition";

export default function ContactForm({ heading = "Contacto", showPhone = true }: ContactFormProps) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [shakeKey, setShakeKey] = useState(0);
  const reduced = useReducedMotion();

  // Verificación anti-spam. Sin configurar, `config` es null: no se dibuja
  // nada y el formulario funciona igual.
  const { config: captcha } = useCaptchaConfig();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  /** Problema del widget. Lo muestra el propio widget, junto a "Reintentar". */
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  /** Rechazo del servidor. Ese sí lo muestra el formulario. */
  const [serverCaptchaError, setServerCaptchaError] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const captchaPending = Boolean(captcha) && !captchaToken;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    try {
      await api.post("/public/contact-messages", {
        ...form,
        captchaToken: captchaToken ?? undefined,
      });
      setState("ok");
      setForm({ name: "", email: "", phone: "", message: "" });
      // El token es de un solo uso: se rehace el widget para poder enviar otro.
      setCaptchaToken(null);
      setCaptchaKey((k) => k + 1);
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (message?.includes("anti-spam")) {
        setServerCaptchaError("La verificación anti-spam no pasó. Probá de nuevo.");
        setCaptchaToken(null);
        setCaptchaKey((k) => k + 1);
      }
      setState("error");
      setShakeKey((k) => k + 1);
    }
  }

  const shakeTransition = reduced
    ? { duration: 0 }
    : { duration: 0.4, ease: "easeInOut" as const };

  return (
    <section className="container-x section-y-md">
      <h2 className="text-2xl font-bold mb-6 text-primary">{heading}</h2>
      <form onSubmit={submit} className="grid gap-4 max-w-2xl">
        <motion.div
          key={`shake-${shakeKey}`}
          animate={reduced ? {} : { x: [0, -6, 6, -4, 4, 0] }}
          transition={shakeTransition}
          className="grid gap-4"
        >
          <div>
            <label htmlFor="contact-name" className="block text-sm font-medium mb-1">Nombre</label>
            <input id="contact-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor="contact-email" className="block text-sm font-medium mb-1">Email</label>
            <input id="contact-email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
          </div>
          {showPhone && (
            <div>
              <label htmlFor="contact-phone" className="block text-sm font-medium mb-1">Teléfono</label>
              <input id="contact-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} />
            </div>
          )}
          <div>
            <label htmlFor="contact-message" className="block text-sm font-medium mb-1">Mensaje</label>
            <textarea id="contact-message" required rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className={inputClass} />
          </div>
        </motion.div>
        <Captcha
          key={`captcha-${captchaKey}`}
          onToken={setCaptchaToken}
          onError={(message) => {
            setCaptchaError(message);
            if (message) setServerCaptchaError(null);
          }}
        />
        {serverCaptchaError && (
          <p role="alert" className="text-sm text-amber-700">{serverCaptchaError}</p>
        )}
        <button
          disabled={state === "loading" || captchaPending}
          // Con el widget en error el botón sigue bloqueado —sin token el envío
          // se rechaza igual—, pero el motivo tiene que estar a la vista.
          title={captchaError ?? (captchaPending ? "Completá la verificación anti-spam" : undefined)}
          className="btn-primary self-start inline-flex items-center gap-2 disabled:opacity-50"
        >
          {state === "loading" ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Enviando…
            </>
          ) : (
            "Enviar"
          )}
        </button>
        <AnimatePresence>
          {state === "ok" && (
            <motion.p
              key="ok"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-green-700 inline-flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              ¡Mensaje enviado! Te contactaremos a la brevedad.
            </motion.p>
          )}
          {state === "error" && (
            <motion.p
              key="err"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-amber-700 inline-flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4" />
              Hubo un error. Intentá nuevamente.
            </motion.p>
          )}
        </AnimatePresence>
      </form>
    </section>
  );
}
