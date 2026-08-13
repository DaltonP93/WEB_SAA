import { useEffect, useRef, useState } from "react";
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

function loadScript(src: string): Promise<void> {
  const existing = loaded.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`no se pudo cargar ${src}`));
    document.head.appendChild(el);
  });
  loaded.set(src, promise);
  return promise;
}

interface Props {
  /** Recibe el token, o null cuando expira o falla. */
  onToken: (token: string | null) => void;
  /** Se avisa si el widget no pudo cargarse, para bloquear el envío. */
  onError?: (message: string | null) => void;
}

export default function Captcha({ onToken, onError }: Props) {
  const { config } = useCaptchaConfig();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    const script = SCRIPTS[config.provider];
    if (!script) {
      // El servidor validó el proveedor; si igual llega uno raro, se avisa en
      // vez de dejar un hueco silencioso.
      const message = "La verificación anti-spam está mal configurada.";
      setError(message);
      onError?.(message);
      return;
    }

    let cancelled = false;
    loadScript(script.src)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const widget = window[script.global];
        if (!widget) throw new Error("el proveedor no expuso su API");
        widgetId.current = widget.render(containerRef.current, {
          sitekey: config.siteKey,
          callback: (token: string) => {
            setError(null);
            onError?.(null);
            onToken(token);
          },
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
          "expired_callback": () => onToken(null),
        });
      })
      .catch(() => {
        if (cancelled) return;
        const message =
          "No pudimos cargar la verificación anti-spam. Revisá tu conexión o escribinos por WhatsApp.";
        setError(message);
        onError?.(message);
      });

    return () => {
      cancelled = true;
    };
    // onToken/onError se reciben como callbacks estables desde el formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.provider, config?.siteKey]);

  if (!config) return null;

  return (
    <div>
      <div ref={containerRef} className="min-h-[70px]" />
      {error && (
        <p role="alert" className="text-sm text-accent-700 mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
