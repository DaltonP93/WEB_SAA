import { useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";

/**
 * Misma barra de progreso que el sitio público, sin framer-motion: el admin no
 * lo tiene entre sus dependencias y no vale la pena agregarlo (cualquier cambio
 * en `pnpm-lock.yaml` es un riesgo extra en el deploy con `--frozen-lockfile`).
 *
 * Acá pesa sobre todo durante los fetch de los CRUDs, que es donde la espera se
 * nota.
 */

const DELAY_APARICION = 120;
const DURACION_SALIDA = 240;
const GRACIA_NAVEGACION = 150;

/** `matchMedia` no existe en jsdom (ni en un render fuera del navegador): sin la
 *  guarda, cualquier test que monte el layout revienta. */
function usaMovimientoReducido() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function TopProgressBar() {
  const isFetching = useIsFetching();
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);
  const [avance, setAvance] = useState(0);
  const [navegando, setNavegando] = useState(false);
  const primeraRuta = useRef(true);
  const reduced = usaMovimientoReducido();

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
    <div aria-hidden className="fixed inset-x-0 top-0 z-[70] h-[3px] pointer-events-none">
      <div
        className="h-full bg-brand2"
        style={{
          width: reduced ? "100%" : `${avance}%`,
          opacity: avance >= 100 ? 0 : 1,
          boxShadow: "0 0 8px rgb(0 188 209 / 0.55)",
          transition: reduced
            ? `opacity ${DURACION_SALIDA}ms linear`
            : `width 200ms ease-out, opacity ${DURACION_SALIDA}ms ease-out`,
        }}
      />
    </div>
  );
}
