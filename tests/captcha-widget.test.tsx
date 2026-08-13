// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/** Opciones con las que el componente llamó a `render()` del proveedor. */
let widgetOptions: Record<string, any> | null = null;
/** Cuántas veces el proveedor dibujó el widget. */
let renderCount = 0;
/** Scripts que el componente pidió cargar, en orden. */
let requestedScripts: string[] = [];
/** Qué debe hacer el próximo `<script>`: cargar bien o fallar. */
let scriptShouldFail = false;

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
            return "widget-1";
          },
          reset: () => {},
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

  it("ofrece reintentar y vuelve a dibujar el widget", async () => {
    renderWithQuery(<Captcha onToken={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(renderCount).toBe(1));

    widgetOptions!["error-callback"]();
    const retry = await screen.findByRole("button", { name: /reintentar/i });

    fireEvent.click(retry);

    await waitFor(() => expect(renderCount).toBe(2));
    // Y el mensaje de error se va mientras se reintenta.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
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
    await waitFor(() => expect(requestedScripts).toHaveLength(2));
    await waitFor(() => expect(renderCount).toBe(1));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
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
});
