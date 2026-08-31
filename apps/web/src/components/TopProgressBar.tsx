import { useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { useReducedMotion } from "framer-motion";

/**
 * Barra de progreso institucional en el borde superior. Cubre el hueco entre
 * pantallas: la transición de ruta desmonta la página vieja antes de que la
 * nueva tenga datos, y sin esta señal esos milisegundos se leen como un cuelgue.
 *
 * Implementación propia a propósito: no vale la pena una dependencia (nprogress)
 * para tres timers, y el `pnpm-lock.yaml` no debe moverse por un detalle visual.
 */

/** Gracia antes de mostrarse: con `staleTime: 60_000` muchas navegaciones salen
 *  de caché y la barra no debe llegar a parpadear. */
const DELAY_APARICION = 120;
/** Lo que tarda en desvanecerse una vez que llegó al 100%. */
const DURACION_SALIDA = 240;
/** Ventana en la que una navegación cuenta como "en curso" aunque react-query
 *  todavía no haya disparado el fetch de la página nueva. */
const GRACIA_NAVEGACION = 150;

export default function TopProgressBar() {
  const isFetching = useIsFetching();
  const { pathname } = useLocation();
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [avance, setAvance] = useState(0);
  const [navegando, setNavegando] = useState(false);
  const primeraRuta = useRef(true);

  // La carga inicial ya tiene el propio arranque del sitio como feedback: la
  // barra sólo habla de navegaciones posteriores.
  useEffect(() => {
    if (primeraRuta.current) {
      primeraRuta.current = false;
      return;
    }
    setNavegando(true);
    const t = window.setTimeout(() => setNavegando(false), GRACIA_NAVEGACION);
    return () => window.clearTimeout(t);
  }, [pathname]);

  const activo = navegando || isFetching > 0;

  useEffect(() => {
    if (activo) {
      const aparecer = window.setTimeout(() => {
        setVisible(true);
        setAvance(30);
      }, DELAY_APARICION);
      // Avance asintótico hacia 90: nunca anuncia el final antes de tiempo.
      const avanzar = window.setInterval(() => {
        setAvance((p) => (p === 0 ? p : p + (90 - p) * 0.12));
      }, 200);
      return () => {
        window.clearTimeout(aparecer);
        window.clearInterval(avanzar);
      };
    }
    setAvance((p) => (p > 0 ? 100 : 0));
    const ocultar = window.setTimeout(() => {
      setVisible(false);
      setAvance(0);
    }, DURACION_SALIDA);
    return () => window.clearTimeout(ocultar);
  }, [activo]);

  if (!visible) return null;

  return (
    // Por encima del header sticky (z-40) y del drawer móvil (z-60), debajo del
    // lightbox (z-100). `aria-hidden`: el estado de carga se comunica por los
    // skeletons, que sí son anunciados.
    <div aria-hidden className="fixed inset-x-0 top-0 z-[70] h-[3px] pointer-events-none">
      <div
        className="h-full bg-secondary"
        style={{
          // Con movimiento reducido la barra sigue apareciendo —es información
          // de estado, no decoración— pero sin animar el ancho.
          width: reduced ? "100%" : `${avance}%`,
          opacity: avance >= 100 ? 0 : 1,
          boxShadow: "0 0 8px rgb(var(--c-secondary) / 0.55)",
          transition: reduced
            ? `opacity ${DURACION_SALIDA}ms linear`
            : `width 200ms ease-out, opacity ${DURACION_SALIDA}ms ease-out`,
        }}
      />
    </div>
  );
}
