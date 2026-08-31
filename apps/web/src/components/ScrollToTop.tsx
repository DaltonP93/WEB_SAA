import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Lleva la vista al tope en cada navegación. Sin esto, salir desde el pie de una
 * página larga deja la siguiente pantalla scrolleada a la mitad.
 *
 * Dos excepciones deliberadas:
 * - `POP` (botón atrás/adelante): el navegador restaura la posición previa y
 *   pisarla es peor que no hacer nada.
 * - Enlaces con ancla (`/pagina#seccion`): el destino es la sección, no el tope.
 *
 * El salto es instantáneo a propósito. Queda tapado por el fade de salida de
 * `AnimatePresence` en `App.tsx`, así que no se percibe como un corte; un scroll
 * suave, en cambio, se interrumpiría a mitad de camino cuando la página vieja se
 * desmonta y el documento pierde altura.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const tipo = useNavigationType();

  useEffect(() => {
    if (tipo === "POP" || hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, hash, tipo]);

  return null;
}
