// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El widget anti-spam, con DOM real.
 *
 * Dos fallas que sólo se ven ejecutando el componente:
 *
 * 1. Cuando el proveedor llamaba a `error-callback`, el componente sólo
 *    borraba el token. El formulario no se enteraba: el botón quedaba
 *    deshabilitado —porque sigue sin token— y sin ningún texto que explicara
 *    por qué. La persona no tenía forma de saber que había que reintentar.
 *
 * 2. La promesa del `<script>` se cacheaba también cuando fallaba, así que un
 *    corte momentáneo del CDN dejaba el formulario inservible hasta recargar
 *    la página: cada reintento recibía la misma promesa ya rechazada.
 *
 * Buscar strings en el fuente no prueba nada de esto, así que acá se monta el
 * componente, se dispara el callback del proveedor y se mira el DOM.
 */

const CONFIG = { provider: "turnstile", siteKey: "site-de-prueba" };

/** El tope real que espera el componente, para no repetirlo acá como número. */
const { GLOBAL_TIMEOUT_MS } = await import("../apps/web/src/components/Captcha");
/** Un poco más, para que corra el sondeo que cae después del vencimiento. */
const GLOBAL_POLL_MARGEN = 200;

/** Opciones con las que el componente llamó a `render()` del proveedor. */
let widgetOptions: Record<string, any> | null = null;
/** Cuántas veces el proveedor dibujó el widget. */
let renderCount = 0;
/** Scripts que el componente pidió cargar, en orden. */
let requestedScripts: string[] = [];
/** Qué debe hacer el próximo `<script>`: cargar bien o fallar. */
let scriptShouldFail = false;
/** Ids de widget que el proveedor recibió en `reset()`. */
let resetCalls: (string | number | undefined)[] = [];

vi.mock("../apps/web/src/api", () => ({
  api: { get: async () => ({ data: { captcha: CONFIG } }) },
}));

/**
 * jsdom no descarga scripts: se intercepta `appendChild` y se dispara `onload`
 * o `onerror` según el caso, que es exactamente lo que hace el navegador.
 */
function installScriptStub() {
  const realAppend = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation(((node: any) => {
    if (node?.tagName !== "SCRIPT") return realAppend(node);
    requestedScripts.push(node.src);
    queueMicrotask(() => {
      if (scriptShouldFail) node.onerror?.(new Event("error"));
      else {
        (window as any).turnstile = {
          render: (_el: HTMLElement, opts: Record<string, any>) => {
            widgetOptions = opts;
            renderCount += 1;
            return `widget-${renderCount}`;
          },
          reset: (id?: string | number) => {
            resetCalls.push(id);
          },
        };
        node.onload?.(new Event("load"));
      }
    });
    return node;
  }) as any);
}

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

let Captcha: typeof import("../apps/web/src/components/Captcha").default;
let ContactForm: typeof import("../apps/web/src/blocks/ContactForm").default;
let resetCaptchaScriptCache: () => void;

beforeEach(async () => {
  widgetOptions = null;
  renderCount = 0;
  requestedScripts = [];
  resetCalls = [];
  scriptShouldFail = false;
  const mod = await import("../apps/web/src/components/Captcha");
  Captcha = mod.default;
  resetCaptchaScriptCache = mod.resetCaptchaScriptCache;
  resetCaptchaScriptCache();
  ContactForm = (await import("../apps/web/src/blocks/ContactForm")).default;
  installScriptStub();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as any).turnstile;
  // Los `<script>` que hayan quedado en el documento no pueden pasar al caso
  // siguiente: varias pruebas cuentan cuántas copias del SDK hay en la página.
  for (const el of Array.from(document.querySelectorAll("script"))) el.remove();
});

describe("el widget avisa cuando el desafío falla", () => {
  it("limpia el token, muestra el error y se lo pasa al formulario", async () => {
    const onToken = vi.fn();
    const onError = vi.fn();
    renderWithQuery(<Captcha onToken={onToken} onError={onError} />);

    await waitFor(() => expect(widgetOptions).not.toBeNull());
    // Primero un token bueno, para ver que después se limpia.
    widgetOptions!.callback("token-bueno");
    expect(onToken).toHaveBeenLastCalledWith("token-bueno");

    widgetOptions!["error-callback"]();

    // 1. el token se limpia
    expect(onToken).toHaveBeenLastCalledWith(null);
    // 2. se muestra el error
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/verificación anti-spam falló/i);
    // 3. y el formulario se entera
    expect(onError).toHaveBeenLastCalledWith(expect.stringMatching(/anti-spam/i));
  });

  it("el vencimiento también avisa, no sólo borra el token", async () => {
    const onToken = vi.fn();
    const onError = vi.fn();
    renderWithQuery(<Captcha onToken={onToken} onError={onError} />);
    await waitFor(() => expect(widgetOptions).not.toBeNull());

    widgetOptions!["expired-callback"]();

    expect(onToken).toHaveBeenLastCalledWith(null);
    expect((await screen.findByRole("alert")).textContent).toMatch(/venció/i);
    expect(onError).toHaveBeenLastCalledWith(expect.stringMatching(/venció/i));
  });

  it("reintenta con reset() y sin volver a bajar el SDK", async () => {
    // El SDK ya está cargado: lo que falló fue el desafío. Volver a insertar
    // el `<script>` dejaría dos copias del proveedor en la página.
    renderWithQuery(<Captcha onToken={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(renderCount).toBe(1));
    expect(requestedScripts).toHaveLength(1);

    widgetOptions!["error-callback"]();
    fireEvent.click(await screen.findByRole("button", { name: /reintentar/i }));

    // Se resetea el widget que ya estaba…
    await waitFor(() => expect(resetCalls).toEqual(["widget-1"]));
    // …y no se pidió el script de nuevo ni se dibujó otro widget.
    expect(requestedScripts).toHaveLength(1);
    expect(document.querySelectorAll("script").length).toBeLessThanOrEqual(1);
    expect(renderCount).toBe(1);
    // Y el mensaje de error se va mientras se reintenta.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("el vencimiento también se reintenta con reset()", async () => {
    renderWithQuery(<Captcha onToken={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(renderCount).toBe(1));

    widgetOptions!["expired-callback"]();
    fireEvent.click(await screen.findByRole("button", { name: /reintentar/i }));

    await waitFor(() => expect(resetCalls).toHaveLength(1));
    expect(requestedScripts).toHaveLength(1);
  });
});

describe("un fallo de red del proveedor no rompe la sesión", () => {
  it("avisa y permite reintentar la descarga del script", async () => {
    scriptShouldFail = true;
    const onError = vi.fn();
    renderWithQuery(<Captcha onToken={vi.fn()} onError={onError} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/no pudimos cargar/i);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/no pudimos cargar/i));
    expect(requestedScripts).toHaveLength(1);

    // El CDN se recupera y la persona reintenta.
    scriptShouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));

    // La promesa rechazada no quedó cacheada: se pide el script otra vez.
    // Este sí es el caso en que corresponde volver a descargarlo.
    await waitFor(() => expect(requestedScripts).toHaveLength(2));
    await waitFor(() => expect(renderCount).toBe(1));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    // Y no se resetea nada: no había widget que resetear.
    expect(resetCalls).toEqual([]);
  });

  it("un componente nuevo tampoco hereda la promesa fallida", async () => {
    scriptShouldFail = true;
    const first = renderWithQuery(<Captcha onToken={vi.fn()} onError={vi.fn()} />);
    await screen.findByRole("alert");
    first.unmount();

    scriptShouldFail = false;
    renderWithQuery(<Captcha onToken={vi.fn()} onError={vi.fn()} />);
    // Antes, este segundo montaje recibía la promesa rechazada del primero y
    // nunca dibujaba el widget.
    await waitFor(() => expect(renderCount).toBe(1));
  });
});

describe("el formulario de contacto frente a un captcha en error", () => {
  it("explica por qué no se puede enviar", async () => {
    renderWithQuery(<ContactForm heading="Contacto" />);
    await waitFor(() => expect(widgetOptions).not.toBeNull());

    const button = screen.getByRole("button", { name: /enviar/i }) as HTMLButtonElement;
    // Sin token el envío no puede pasar la verificación: sigue bloqueado.
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toMatch(/completá la verificación/i);

    widgetOptions!["error-callback"]();

    await waitFor(() => expect(button.getAttribute("title")).toMatch(/anti-spam falló/i));
    expect(button.disabled).toBe(true);
    // Y el motivo está a la vista, no sólo en el title.
    expect((await screen.findByRole("alert")).textContent).toMatch(/anti-spam falló/i);
  });

  it("con el desafío resuelto el botón se habilita", async () => {
    renderWithQuery(<ContactForm heading="Contacto" />);
    await waitFor(() => expect(widgetOptions).not.toBeNull());

    widgetOptions!.callback("token-bueno");

    await waitFor(() =>
      expect((screen.getByRole("button", { name: /enviar/i }) as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("el mensaje y el bloqueo duran hasta que llega un token válido", async () => {
    renderWithQuery(<ContactForm heading="Contacto" />);
    await waitFor(() => expect(widgetOptions).not.toBeNull());
    const button = screen.getByRole("button", { name: /enviar/i }) as HTMLButtonElement;

    widgetOptions!["error-callback"]();
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toMatch(/anti-spam falló/i);
    expect(button.disabled).toBe(true);

    // Se reintenta: el widget se resetea, pero todavía no hay token.
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await waitFor(() => expect(resetCalls).toHaveLength(1));
    expect(button.disabled).toBe(true);

    // Recién con el desafío resuelto se habilita.
    widgetOptions!.callback("token-bueno");
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/**
 * El caso que dejaba el formulario inservible hasta recargar la página.
 *
 * El `<script>` baja y dispara `load`, pero `window.turnstile` nunca aparece:
 * un CDN que devolvió un cuerpo truncado, un SDK que no llegó a instalarse. El
 * `load` no es la señal de que el proveedor esté listo, y el componente lo
 * tomaba como tal: comprobaba la API justo después, fallaba, y en el caché
 * quedaba una promesa **resuelta**. Cada reintento recibía esa misma promesa,
 * volvía a encontrar la API ausente y volvía a fallar, para siempre.
 *
 * La corrección no es sólo borrar la entrada del caché: si el `<script>`
 * inservible sigue en el documento, el reintento agrega un segundo SDK. Hay que
 * descartar las dos cosas, y por eso acá se cuentan los `<script>` del DOM real
 * —el stub los inserta de verdad— y no una lista paralela.
 *
 * Se usan timers falsos porque la espera de la API global tiene un tope.
 */
describe("el SDK no se duplica nunca", () => {
  /** Si el próximo `<script>` publica `window.turnstile` al cargar. */
  let exponerApi = false;

  const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  const scriptsEnElDom = () => Array.from(document.querySelectorAll(`script[src="${SRC}"]`));

  /** Avanza el reloj falso dejando que React procese lo que se dispare. */
  const avanzar = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  beforeEach(() => {
    // Este stub sí inserta el nodo en el documento: es lo que se va a contar.
    vi.restoreAllMocks();
    exponerApi = false;
    const realAppend = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, "appendChild").mockImplementation(((node: any) => {
      if (node?.tagName !== "SCRIPT") return realAppend(node);
      requestedScripts.push(node.src);
      const insertado = realAppend(node);
      queueMicrotask(() => {
        if (exponerApi) {
          (window as any).turnstile = {
            render: (_el: HTMLElement, opts: Record<string, any>) => {
              widgetOptions = opts;
              renderCount += 1;
              return `widget-${renderCount}`;
            },
            reset: (id?: string | number) => {
              resetCalls.push(id);
            },
          };
        }
        node.onload?.(new Event("load"));
      });
      return insertado;
    }) as any);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("espera la API global antes de dar el script por bueno", async () => {
    renderWithQuery(<Captcha onToken={vi.fn()} onError={vi.fn()} />);
    await avanzar(0);

    // El `load` ya llegó y la API no está. Todavía no es un error: el SDK
    // puede tardar, y avisar acá rompería los casos lentos que sí funcionan.
    expect(scriptsEnElDom()).toHaveLength(1);
    await avanzar(GLOBAL_TIMEOUT_MS / 2);
    expect(screen.queryByRole("alert")).toBeNull();

    // Agotada la espera sí se avisa.
    await avanzar(GLOBAL_TIMEOUT_MS);
    expect(screen.getByRole("alert").textContent).toMatch(/no pudimos cargar/i);
  });

  it("el reintento inserta UNA copia nueva y el formulario se recupera de verdad", async () => {
    renderWithQuery(<ContactForm heading="Contacto" />);
    await avanzar(0);
    expect(requestedScripts).toHaveLength(1);

    // Primer intento: el SDK nunca aparece.
    await avanzar(GLOBAL_TIMEOUT_MS + GLOBAL_POLL_MARGEN);
    expect(screen.getByRole("alert").textContent).toMatch(/no pudimos cargar/i);
    // El `<script>` inservible se fue del documento: si quedara, el reintento
    // dejaría dos copias del proveedor en la página.
    expect(scriptsEnElDom()).toHaveLength(0);
    const boton = screen.getByRole("button", { name: /enviar/i }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);

    // Segundo intento, con el proveedor ya sano.
    exponerApi = true;
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await avanzar(0);

    // Exactamente una copia: ni cero (no se reintentó) ni dos (se acumuló).
    expect(scriptsEnElDom()).toHaveLength(1);
    expect(requestedScripts).toHaveLength(2);
    expect(renderCount).toBe(1);

    // Recuperación estable: token válido, alerta ausente, botón habilitado.
    await act(async () => {
      widgetOptions!.callback("token-bueno");
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(boton.disabled).toBe(false);

    // Y sigue así pasado el tope de espera: no era un estado transitorio entre
    // dos fallos, era la recuperación.
    await avanzar(GLOBAL_TIMEOUT_MS * 2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(scriptsEnElDom()).toHaveLength(1);
    expect(boton.disabled).toBe(false);
  });

  it("dos fallos seguidos tampoco acumulan copias", async () => {
    renderWithQuery(<Captcha onToken={vi.fn()} onError={vi.fn()} />);
    await avanzar(0);
    await avanzar(GLOBAL_TIMEOUT_MS + GLOBAL_POLL_MARGEN);
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await avanzar(0);
    // Durante el segundo intento hay una sola copia en vuelo…
    expect(scriptsEnElDom()).toHaveLength(1);

    await avanzar(GLOBAL_TIMEOUT_MS + GLOBAL_POLL_MARGEN);
    // …y al fallar también se descarta.
    expect(screen.getByRole("alert").textContent).toMatch(/no pudimos cargar/i);
    expect(scriptsEnElDom()).toHaveLength(0);
    expect(requestedScripts).toHaveLength(2);

    // El tercer intento, con el CDN sano, se recupera igual.
    exponerApi = true;
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await avanzar(0);
    expect(scriptsEnElDom()).toHaveLength(1);
    expect(renderCount).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("un componente nuevo después del fallo tampoco hereda nada", async () => {
    const primero = renderWithQuery(<Captcha onToken={vi.fn()} onError={vi.fn()} />);
    await avanzar(0);
    await avanzar(GLOBAL_TIMEOUT_MS + GLOBAL_POLL_MARGEN);
    expect(screen.getByRole("alert")).toBeTruthy();
    primero.unmount();

    exponerApi = true;
    renderWithQuery(<Captcha onToken={vi.fn()} onError={vi.fn()} />);
    await avanzar(0);

    expect(renderCount).toBe(1);
    expect(scriptsEnElDom()).toHaveLength(1);
  });
});
