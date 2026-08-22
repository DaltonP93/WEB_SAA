/**
 * Carga de la medición de terceros, con consentimiento y sin JS arbitrario.
 *
 * El panel guarda **identificadores** (ver `api/src/marketing.ts`), no un bloque
 * de código pegado. Este módulo toma esos IDs y carga el SDK oficial de cada
 * plataforma. La diferencia con el viejo campo `scripts` —que se retiró— es
 * exactamente esa: un ID sólo puede ser un ID; un `<script>` pegado puede hacer
 * cualquier cosa.
 *
 * Nada de esto corre sin dos condiciones a la vez:
 *
 * 1. hay un ID configurado para esa plataforma, y
 * 2. la persona aceptó la analítica (ver `consent.ts`).
 *
 * ## La CSP ya permite estos hosts
 *
 * La CSP del sitio es `default-src 'self'`, pero `script-src`/`connect-src` ya
 * incluyen los hosts de Google (GA4/GTM) y Meta —en la CSP de Nginx
 * (`scripts/deploy/setup-vps.sh`) y en la `<meta>` de `apps/web/index.html`, que
 * la prueba `tests/analytics-csp.test.ts` mantiene en sincronía—. No cargan nada
 * por sí mismos: sin un ID configurado no se inyecta ningún script que los use.
 *
 * Si por algún motivo la CSP desplegada no los tuviera, el navegador bloquearía
 * el script y la analítica simplemente no mediría: no rompe la página ni deja el
 * sitio a medias.
 */

export interface Analitica {
  ga4: string;
  gtm: string;
  metaPixel: string;
}

/** Los mismos formatos que valida la API. Acá se revalida antes de inyectar. */
const FORMATO: Record<keyof Analitica, RegExp> = {
  ga4: /^G-[A-Z0-9]{4,20}$/,
  gtm: /^GTM-[A-Z0-9]{4,12}$/,
  metaPixel: /^[0-9]{8,20}$/,
};

/** ¿Hay al menos un ID con forma válida? */
export function hayMedicion(config: Partial<Analitica> | null | undefined): boolean {
  if (!config) return false;
  return (Object.keys(FORMATO) as (keyof Analitica)[]).some(
    (k) => typeof config[k] === "string" && FORMATO[k].test(config[k] as string),
  );
}

/** Los IDs que van a cargarse (los válidos), o vacío. */
export function medicionesValidas(config: Partial<Analitica> | null | undefined): Partial<Analitica> {
  const salida: Partial<Analitica> = {};
  if (!config) return salida;
  for (const k of Object.keys(FORMATO) as (keyof Analitica)[]) {
    const v = config[k];
    if (typeof v === "string" && FORMATO[k].test(v)) salida[k] = v;
  }
  return salida;
}

/** Marca en el `<script>` para no inyectar dos veces el mismo proveedor. */
const MARCA = "data-saa-analytics";

function yaCargado(id: string): boolean {
  // Se compara el atributo a mano en vez de interpolarlo en un selector: los IDs
  // ya pasaron un formato estricto, pero no hace falta depender de `CSS.escape`
  // (que además no existe en todos los entornos) para algo que es una igualdad.
  return Array.from(document.querySelectorAll(`script[${MARCA}]`)).some(
    (s) => s.getAttribute(MARCA) === id,
  );
}

function agregarScript(id: string, atributos: Partial<HTMLScriptElement>, extra?: Record<string, string>): void {
  const s = document.createElement("script");
  s.setAttribute(MARCA, id);
  Object.assign(s, atributos);
  if (extra) for (const [k, v] of Object.entries(extra)) s.setAttribute(k, v);
  document.head.appendChild(s);
}

/**
 * Carga la medición que corresponda, una sola vez por ID.
 *
 * Idempotente: llamarla de nuevo tras un cambio de ruta no vuelve a inyectar
 * nada. Los IDs se revalidan acá aunque la API ya los haya validado, porque un
 * valor con forma inválida terminaría en el `src` de un script y no puede
 * confiarse en una sola capa. Un ID inválido se ignora en silencio: no es un
 * error del visitante.
 */
export function cargarAnalitica(config: Partial<Analitica> | null | undefined): void {
  const ids = medicionesValidas(config);

  if (ids.ga4 && !yaCargado(ids.ga4)) {
    agregarScript(ids.ga4, { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${ids.ga4}` });
    const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };
    w.dataLayer = w.dataLayer || [];
    w.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer!.push(arguments);
    };
    w.gtag("js", new Date());
    w.gtag("config", ids.ga4);
  }

  if (ids.gtm && !yaCargado(ids.gtm)) {
    const w = window as unknown as { dataLayer?: unknown[] };
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    agregarScript(ids.gtm, { async: true, src: `https://www.googletagmanager.com/gtm.js?id=${ids.gtm}` });
  }

  if (ids.metaPixel && !yaCargado(ids.metaPixel)) {
    agregarScript(ids.metaPixel, { async: true, src: "https://connect.facebook.net/en_US/fbevents.js" });
    const w = window as any;
    if (!w.fbq) {
      // El stub oficial de Meta: acumula las llamadas en una cola hasta que el
      // SDK real termina de cargar y las reproduce. Es `any` a propósito —la API
      // de fbq es variádica y no tiene tipos—; la contención está en que sólo se
      // llega acá con un `metaPixel` que pasó el formato numérico.
      const n: any = function () {
        // eslint-disable-next-line prefer-rest-params
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      n.queue = [];
      n.loaded = true;
      n.version = "2.0";
      w.fbq = n;
      w._fbq = n;
    }
    w.fbq("init", ids.metaPixel);
    w.fbq("track", "PageView");
  }
}
