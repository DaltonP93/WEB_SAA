import type { StepsProps } from "@sa/shared/blocks";
import LucideIcon, { isIconName } from "../components/LucideIcon";

/**
 * Infografía de pasos numerados (item 9 de la minuta).
 *
 * Accesible: es una lista ordenada real, el número no se lee dos veces
 * (`aria-hidden` en el badge) y la línea que une los pasos es decorativa.
 * Responsive: una columna en móvil, fila en escritorio.
 */
export default function Steps({ heading, text, items, muted = true }: StepsProps) {
  const steps = items ?? [];
  if (steps.length === 0) return null;

  return (
    <section className={muted ? "bg-gray-50 section-y-md" : "section-y-md"}>
      <div className="container-x">
        {heading && (
          <h2 className="text-2xl md:text-3xl font-bold text-center text-primary mb-2">{heading}</h2>
        )}
        {text && <p className="text-center text-gray-600 max-w-2xl mx-auto mb-10">{text}</p>}

        <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 counter-reset">
          {steps.map((step, i) => (
            <li key={`${step.title}-${i}`} className="relative flex flex-col items-center text-center">
              {/* Línea que conecta los pasos (decorativa, sólo en escritorio) */}
              {i < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className="hidden lg:block absolute top-7 left-1/2 w-full h-px bg-primary-100"
                />
              )}
              <span className="relative z-10 w-14 h-14 rounded-full bg-primary text-white flex items-center justify-center shadow-sm">
                {step.icon && isIconName(step.icon) ? (
                  <LucideIcon name={step.icon} className="w-6 h-6" />
                ) : step.icon ? (
                  <span className="text-xl leading-none">{step.icon}</span>
                ) : (
                  <span className="text-lg font-bold" aria-hidden="true">
                    {i + 1}
                  </span>
                )}
              </span>
              <span
                aria-hidden="true"
                className="mt-3 inline-flex items-center justify-center w-6 h-6 rounded-full bg-secondary-700 text-white text-xs font-bold"
              >
                {i + 1}
              </span>
              <h3 className="mt-2 font-semibold text-primary">{step.title}</h3>
              {step.text && <p className="text-sm text-gray-600 mt-1 max-w-xs">{step.text}</p>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
