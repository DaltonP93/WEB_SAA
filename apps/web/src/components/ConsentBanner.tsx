import { useConsentimiento } from "../lib/consent";

/**
 * Aviso de consentimiento de analítica.
 *
 * Aparece una sola vez, hasta que la persona decide. Dos principios:
 *
 * - **Consent-first.** No se mide nada antes de esta decisión. El banner no
 *   bloquea el contenido —no es un muro— pero la medición espera.
 * - **Sin patrones oscuros.** "Rechazar" es un botón tan visible como "Aceptar",
 *   no un enlace gris escondido. Un consentimiento que se obtiene escondiendo el
 *   "no" no es consentimiento.
 *
 * Sólo tiene sentido mostrarlo si hay algo que medir: si el sanatorio no
 * configuró ningún ID, no hay analítica que consentir y el banner no aparece.
 * Esa decisión la toma quien lo renderiza (`App`), que conoce la config.
 */
export default function ConsentBanner() {
  const { hayDecision, decidido, aceptar, rechazar } = useConsentimiento();

  // No dibujar hasta leer localStorage (evita el parpadeo del banner en quien
  // ya decidió), ni una vez que hay una decisión.
  if (!decidido || hayDecision) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Preferencias de medición"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white shadow-lg"
    >
      <div className="mx-auto max-w-5xl p-4 sm:flex sm:items-center sm:gap-6">
        <div className="text-sm text-gray-700 sm:flex-1">
          <p className="font-semibold text-gray-900">Medición del sitio</p>
          <p className="mt-1">
            Usamos herramientas de medición para entender cómo se usa el sitio y mejorarlo. Sólo se
            activan si aceptás. No hacen falta para navegar ni para pedir un turno.
          </p>
        </div>
        <div className="mt-3 flex gap-2 sm:mt-0">
          {/* Rechazar primero y con el mismo peso visual: no es la opción
              secundaria. */}
          <button onClick={rechazar} className="btn-secondary flex-1 sm:flex-none">
            Rechazar
          </button>
          <button onClick={aceptar} className="btn-primary flex-1 sm:flex-none">
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
