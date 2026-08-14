import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/**
 * Verificación anti-spam (Cloudflare Turnstile o reCAPTCHA v2).
 *
 * La configuración la decide el servidor: `/public/settings` devuelve
 * `captcha: { provider, siteKey }` cuando está activa y `null` cuando no. Sin
 * configuración este componente no dibuja nada y los formularios siguen
 * funcionando igual — que es el estado actual, porque las claves las tiene que
 * cargar el sanatorio.
 *
 * La clave secreta nunca llega acá: el token que devuelve el widget lo valida
 * la API contra el proveedor.
 */

export interface CaptchaConfig {
  provider: string;
  siteKey: string;
}

interface WidgetApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | number;
  reset: (id?: string | number) => void;
}

declare global {
  interface Window {
    turnstile?: WidgetApi;
    grecaptcha?: WidgetApi;
  }
}

const SCRIPTS: Record<string, { src: string; global: "turnstile" | "grecaptcha" }> = {
  turnstile: {
    src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    global: "turnstile",
  },
  recaptcha: {
    src: "https://www.google.com/recaptcha/api.js?render=explicit",
    global: "grecaptcha",
  },
};

/** Config del servidor. Cacheada: es la misma consulta que usa el layout. */
export function useCaptchaConfig(): { config: CaptchaConfig | null; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/public/settings")).data,
    staleTime: 5 * 60_000,
  });
  const captcha = data?.captcha as CaptchaConfig | null | undefined;
  return { config: captcha ?? null, isLoading };
}

const loaded = new Map<string, Promise<void>>();

/**
 * Carga el script del proveedor una sola vez.
 *
 * Una promesa **rechazada** se saca del caché: si quedaba guardada, un fallo
 * puntual del CDN dejaba el formulario roto para el resto de la sesión, porque
 * todo reintento recibía la misma promesa ya rechazada.
 */
function loadScript(src: string): Promise<void> {
  const existing = loaded.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      el.remove();
      reject(new Error(`no se pudo cargar ${src}`));
    };
    document.head.appendChild(el);
  }).catch((err) => {
    loaded.delete(src);
    throw err;
  });
  loaded.set(src, promise);
  return promise;
}

/** Sólo para las pruebas: deja el caché de scripts como al arrancar. */
export function resetCaptchaScriptCache() {
  loaded.clear();
}

const LOAD_ERROR =
  "No pudimos cargar la verificación anti-spam. Revisá tu conexión y volvé a intentar.";
const CHALLENGE_ERROR =
  "La verificación anti-spam falló. Volvé a intentar; si sigue fallando, escribinos por WhatsApp.";

interface Props {
  /** Recibe el token, o null cuando expira o falla. */
  onToken: (token: string | null) => void;
  /** Se avisa si el widget no pudo cargarse, para bloquear el envío. */
  onError?: (message: string | null) => void;
}

/**
 * De qué tipo fue la falla. Cambia qué hay que hacer para reintentar:
 *
 * - `load`: el `<script>` del proveedor no se descargó. Hay que volver a
 *   pedirlo, y para eso primero sacar del caché la promesa rechazada.
 * - `challenge`: el SDK está cargado y el que falló fue el desafío. Se
 *   resetea el widget con la API del proveedor; volver a insertar el `<script>`
 *   dejaría dos copias del SDK en la página.
 */
type ErrorKind = "load" | "challenge";

export default function Captcha({ onToken, onError }: Props) {
  const { config } = useCaptchaConfig();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | number | null>(null);
  const [error, setError] = useState<{ message: string; kind: ErrorKind } | null>(null);
  /** Cambiarlo vuelve a correr el efecto: es el botón "Reintentar". */
  const [attempt, setAttempt] = useState(0);

  const fail = useCallback(
    (message: string, kind: ErrorKind) => {
      // Los tres a la vez: sin token el envío no puede pasar la verificación,
      // el formulario necesita saberlo para no dejar el botón deshabilitado
      // sin explicación, y la persona necesita leer qué pasó.
      onToken(null);
      setError({ message, kind });
      onError?.(message);
    },
    [onToken, onError],
  );

  /**
   * Reintenta según lo que falló.
   *
   * Un error del desafío no justifica volver a bajar el SDK: la página
   * terminaría con dos `<script>` del proveedor, y el segundo puede pisar el
   * estado del primero. Con el SDK ya cargado alcanza `reset(widgetId)`, que
   * es la API que Turnstile y reCAPTCHA exponen justamente para esto.
   */
  const retry = useCallback(() => {
    const kind = error?.kind;
    const script = config ? SCRIPTS[config.provider] : undefined;

    if (kind === "challenge" && script) {
      const widget = window[script.global];
      if (widget && widgetId.current !== null) {
        setError(null);
        onError?.(null);
        onToken(null);
        widget.reset(widgetId.current);
        return;
      }
    }

    // Falló la descarga (o no hay widget que resetear): se vuelve a montar el
    // widget. No hace falta tocar el caché —`loadScript` ya descarta sola la
    // promesa rechazada— y borrarlo a mano sería peor: si la promesa se había
    // resuelto (el script cargó pero el proveedor no expuso su API), el
    // siguiente intento insertaría un segundo `<script>` del mismo SDK.
    widgetId.current = null;
    setAttempt((n) => n + 1);
    // config/onToken/onError son estables; `error` es lo único que cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error?.kind, config?.provider, onToken, onError]);

  useEffect(() => {
    if (!config) return;
    const script = SCRIPTS[config.provider];
    if (!script) {
      // El servidor validó el proveedor; si igual llega uno raro, se avisa en
      // vez de dejar un hueco silencioso.
      fail("La verificación anti-spam está mal configurada.", "load");
      return;
    }

    let cancelled = false;
    setError(null);
    onError?.(null);

    loadScript(script.src)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const widget = window[script.global];
        if (!widget) throw new Error("el proveedor no expuso su API");
        containerRef.current.innerHTML = "";
        widgetId.current = widget.render(containerRef.current, {
          sitekey: config.siteKey,
          callback: (token: string) => {
            if (cancelled) return;
            setError(null);
            onError?.(null);
            onToken(token);
          },
          "expired-callback": () => {
            if (!cancelled) fail("La verificación venció. Resolvela de nuevo para enviar.", "challenge");
          },
          "error-callback": () => {
            if (!cancelled) fail(CHALLENGE_ERROR, "challenge");
          },
          "expired_callback": () => {
            if (!cancelled) fail("La verificación venció. Resolvela de nuevo para enviar.", "challenge");
          },
        });
      })
      .catch(() => {
        if (!cancelled) fail(LOAD_ERROR, "load");
      });

    return () => {
      cancelled = true;
    };
    // onToken/onError se reciben como callbacks estables desde el formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.provider, config?.siteKey, attempt]);

  if (!config) return null;

  return (
    <div>
      <div ref={containerRef} className="min-h-[70px]" />
      {error && (
        <p role="alert" className="text-sm text-amber-700 mt-1">
          {error.message}{" "}
          <button
            type="button"
            className="underline font-medium"
            onClick={() => retry()}
          >
            Reintentar
          </button>
        </p>
      )}
    </div>
  );
}
