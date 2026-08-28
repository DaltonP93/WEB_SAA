import { useId, useState } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { api } from "../api";
import type { NewsletterProps } from "@sa/shared/blocks";
import { CONSENT_TEXT } from "@sa/shared/consent";
import { obtenerAtribucion } from "../lib/attribution";

const inputClass =
  "border rounded px-3 py-2 w-full bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition";

/**
 * Finalidad declarada del consentimiento. Es **fuente única** en
 * `@sa/shared/consent`, la misma que el servidor sella con `CONSENT_VERSION`: el
 * texto que la persona lee acá no puede divergir de la versión registrada. Si el
 * texto cambia, se sube la versión.
 */
const PURPOSE = CONSENT_TEXT;

/**
 * Bloque de suscripción a novedades. El correo se guarda en la captura propia
 * (`/public/newsletter`); el honeypot (`website`) frena bots y la atribución
 * viaja como en las demás conversiones. Cada instancia usa `useId()` para que
 * dos bloques en la misma página no compartan el id del input.
 *
 * Mensaje de éxito **preciso**: registra la solicitud. No afirma que ya existe
 * un envío automático —no lo hay hasta que se conecte un proveedor—.
 */
export default function Newsletter({
  heading = "Recibí nuestras novedades",
  text = "",
  buttonLabel = "Suscribirme",
}: NewsletterProps) {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot: invisible para personas
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    try {
      await api.post("/public/newsletter", {
        email,
        source: window.location.pathname,
        website,
        attribution: obtenerAtribucion(),
      });
      setState("ok");
      setEmail("");
    } catch {
      setState("error");
    }
  }

  return (
    <section className="container-x section-y-md">
      <div className="max-w-xl">
        <h2 className="text-2xl font-bold mb-2 text-primary">{heading}</h2>
        {text && <p className="text-gray-600 mb-2">{text}</p>}
        {state === "ok" ? (
          <p className="text-green-700 inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            ¡Listo! Registramos tu solicitud para recibir novedades.
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3">
            <label htmlFor={emailId} className="sr-only">Correo electrónico</label>
            <input
              id={emailId}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              className={inputClass}
              disabled={state === "loading"}
            />
            {/* Honeypot: fuera de la vista y del foco. */}
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="hidden"
            />
            <button
              disabled={state === "loading"}
              className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
            >
              {state === "loading" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {state === "error" ? "Reintentar" : buttonLabel}
            </button>
          </form>
        )}
        {state === "error" && (
          <p role="alert" className="text-amber-700 inline-flex items-center gap-2 mt-2">
            <AlertCircle className="w-4 h-4" />
            No pudimos registrar tu correo. Revisá la dirección e intentá de nuevo.
          </p>
        )}
        {state !== "ok" && <p className="text-xs text-gray-500 mt-2">{PURPOSE}</p>}
      </div>
    </section>
  );
}
