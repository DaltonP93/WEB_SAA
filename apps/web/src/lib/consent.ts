import { useEffect, useState } from "react";

/**
 * Consentimiento de analítica, del lado del visitante.
 *
 * La regla es una sola y ordena todo lo demás: **nada de medición de terceros
 * carga hasta que la persona lo acepta**. No es una cortesía; es la diferencia
 * entre un sitio que respeta al visitante y uno que lo rastrea antes de
 * preguntarle.
 *
 * ## Qué se guarda, y qué no
 *
 * Sólo la decisión: `analytics: true|false`, con la fecha y una versión. No se
 * guarda ningún identificador de la persona. Vive en `localStorage` porque es
 * una preferencia del navegador de quien mira, no un dato del sanatorio: no
 * viaja al servidor y no tiene por qué.
 *
 * ## Por qué una versión
 *
 * Si mañana la medición cambia de alcance —se agrega otra categoría, otra
 * plataforma—, un "acepté" viejo no puede seguir valiendo para algo que esa
 * persona nunca vio. Subir `CONSENT_VERSION` invalida las decisiones anteriores
 * y vuelve a preguntar. Es lo correcto y además lo que exige cualquier régimen
 * de privacidad serio.
 *
 * ## `null` no es `false`
 *
 * `null` = "todavía no decidió" → se muestra el aviso y **no** se mide.
 * `false` = "decidió que no" → no se muestra el aviso y no se mide.
 * `true` = "aceptó" → se puede medir. Confundir `null` con `false` haría que el
 * aviso no apareciera nunca, o que reapareciera después de un rechazo.
 */

export const CONSENT_VERSION = 1;
const CLAVE = "saa_consent";

export interface Consentimiento {
  version: number;
  analytics: boolean;
  at: string;
}

/**
 * La decisión vigente, o `null` si no hay ninguna que aplique.
 *
 * Devuelve `null` también cuando la guardada es de una versión anterior: esa
 * decisión ya no vale. Todo acceso a `localStorage` va en `try/catch` porque en
 * modo privado o con almacenamiento bloqueado, leerlo lanza.
 */
export function leerConsentimiento(): Consentimiento | null {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return null;
    const v = JSON.parse(crudo) as Partial<Consentimiento>;
    if (v.version !== CONSENT_VERSION || typeof v.analytics !== "boolean") return null;
    return { version: CONSENT_VERSION, analytics: v.analytics, at: typeof v.at === "string" ? v.at : "" };
  } catch {
    return null;
  }
}

/** Un evento propio para que todas las pestañas/componentes reaccionen al cambio. */
const EVENTO = "saa:consent";

export function guardarConsentimiento(analytics: boolean): void {
  const valor: Consentimiento = { version: CONSENT_VERSION, analytics, at: new Date().toISOString() };
  try {
    localStorage.setItem(CLAVE, JSON.stringify(valor));
  } catch {
    // Si no se puede persistir, igual se avisa a la sesión actual: la decisión
    // vale mientras la pestaña siga abierta, y no medir es el lado seguro.
  }
  window.dispatchEvent(new CustomEvent(EVENTO));
}

/**
 * La decisión, reactiva.
 *
 * `decidido` distingue "todavía no sé" (no dibujar nada) de "ya cargó y no hay
 * decisión" (mostrar el aviso). En el primer render `decidido` es `false` para
 * no parpadear el banner antes de leer `localStorage`.
 */
export function useConsentimiento() {
  const [consent, setConsent] = useState<Consentimiento | null>(null);
  const [decidido, setDecidido] = useState(false);

  useEffect(() => {
    const releer = () => {
      setConsent(leerConsentimiento());
      setDecidido(true);
    };
    releer();
    window.addEventListener(EVENTO, releer);
    // `storage` cubre el cambio hecho en otra pestaña del mismo sitio.
    window.addEventListener("storage", releer);
    return () => {
      window.removeEventListener(EVENTO, releer);
      window.removeEventListener("storage", releer);
    };
  }, []);

  return {
    /** `true` sólo si aceptó explícitamente la analítica. */
    analiticaPermitida: consent?.analytics === true,
    /** Hay una decisión guardada (sea cual sea). */
    hayDecision: consent !== null,
    /** Ya se leyó `localStorage` al menos una vez. */
    decidido,
    aceptar: () => guardarConsentimiento(true),
    rechazar: () => guardarConsentimiento(false),
  };
}
