// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La pantalla Datos pendientes, su entrada de menú y la tarjeta del Dashboard.
 *
 * Tres cosas que sólo se ven en el DOM:
 *
 * 1. **Las rutas del endpoint son internas.** El admin corre con
 *    `basename="/admin"`, así que React Router antepone el prefijo solo. Si el
 *    endpoint devolviera `/admin/schedules`, el enlace apuntaría a
 *    `/admin/admin/schedules` y el operador llegaría a una pantalla en blanco
 *    sin ningún error que lo delate. Acá se monta con el mismo `basename` real
 *    y se leen los `href` renderizados.
 *
 * 2. **La pantalla no imprime datos del sanatorio.** Se le da a propósito una
 *    respuesta contaminada —con teléfonos, correos y horarios metidos en campos
 *    que la pantalla no tendría que mirar— y se comprueba que ninguno llega al
 *    DOM. Una pantalla que vuelca el payload tal cual pasaría la prueba de la
 *    API y fallaría acá.
 *
 * 3. **La tarjeta del Dashboard lee `summary`, no lo recalcula.** Se le manda un
 *    `summary` que no coincide con `sections` y se exige que muestre el
 *    `summary`: si alguien reintrodujera el cálculo en el panel, esta prueba lo
 *    detecta.
 */

const respuestas: Record<string, unknown> = {};
let fallar = false;
let demorar: Promise<void> | null = null;

vi.mock("../apps/admin/src/api", () => ({
  api: {
    get: async (url: string) => {
      if (demorar) await demorar;
      if (fallar && url.includes("data-readiness")) throw new Error("500");
      return { data: respuestas[url] ?? [] };
    },
    post: async () => ({ data: {} }),
    put: async () => ({ data: {} }),
    delete: async () => ({ data: null }),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));

let AdminLayout: any;
let DataReadinessPage: any;
let DashboardPage: any;
let createMemoryRouter: any;
let RouterProvider: any;

/** Valores que la pantalla nunca debería imprimir. */
const TELEFONO = "+595 21 000 111";
const CORREO = "canal.de.prueba@ejemplo.test";
const HORARIO = "07:00 a 19:00";
const NOTA = "Guardia activa todos los dias del anno.";

/** La forma real que devuelve `GET /api/admin/data-readiness`. */
const readiness = () => ({
  overall: "review",
  summary: { resolved: 3, pending: 11, review: 2, total: 16 },
  sections: [
    {
      id: "contact-channels",
      label: "Canales de contacto",
      status: "pending",
      route: "/contact-channels",
      complete: 1,
      total: 8,
      items: [
        { key: "emergencias", label: "Emergencias", expectedKind: "phone", status: "empty" },
        { key: "recepcion", label: "Recepción", expectedKind: "phone", status: "complete" },
        { key: "gth", label: "Trabajá con nosotros", expectedKind: "email", status: "inactive" },
      ],
    },
    {
      id: "schedules",
      label: "Horarios de atención",
      status: "pending",
      route: "/schedules",
      publishable: 1,
      total: 7,
      items: [
        { key: "consultorios", label: "Consultorios externos", status: "complete" },
        { key: "laboratorio", label: "Laboratorio (extracciones)", status: "empty" },
        { key: "imagenes", label: "Estudios por imágenes", status: "missing" },
      ],
    },
    {
      id: "biopsias",
      label: "Alcance de Biopsias",
      status: "review",
      route: "/pages/12",
      pageSlug: "estudios-biopsias",
      reason: "Requiere confirmación escrita del sanatorio.",
    },
  ],
  warnings: [
    {
      code: "emergencias_nota_sin_revisar",
      severity: "warning",
      route: "/schedules",
      message: "La fila de Emergencias tiene una nota anterior que nadie revisó.",
    },
  ],
});

function montar(rutas: any[], entrada: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(rutas, { basename: "/admin", initialEntries: [entrada] });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** Todos los destinos de enlace del DOM, ya resueltos por React Router. */
const enlaces = () =>
  Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href")!);

beforeEach(async () => {
  fallar = false;
  demorar = null;
  respuestas["/admin/data-readiness"] = readiness();
  respuestas["/admin/contact-messages"] = [];
  respuestas["/admin/doctors"] = [];
  respuestas["/admin/pages"] = [];
  respuestas["/admin/specialties"] = [];

  const rr = await import("react-router-dom");
  createMemoryRouter = rr.createMemoryRouter;
  RouterProvider = rr.RouterProvider;
  AdminLayout = (await import("../apps/admin/src/components/AdminLayout")).default;
  DataReadinessPage = (await import("../apps/admin/src/pages/DataReadinessPage")).default;
  DashboardPage = (await import("../apps/admin/src/pages/DashboardPage")).default;
});

afterEach(() => cleanup());

describe("pantalla Datos pendientes", () => {
  const soloPantalla = () => [{ path: "/datos-pendientes", element: <DataReadinessPage /> }];

  it("muestra las tres secciones", async () => {
    montar(soloPantalla(), "/admin/datos-pendientes");

    expect(await screen.findByText("Canales de contacto")).toBeTruthy();
    expect(screen.getByText("Horarios de atención")).toBeTruthy();
    expect(screen.getByText("Alcance de Biopsias")).toBeTruthy();
  });

  it("distingue los tres estados con texto, no sólo con color", async () => {
    montar(soloPantalla(), "/admin/datos-pendientes");
    await screen.findByText("Canales de contacto");

    // Un lector que no distingue colores tiene que poder leer el estado.
    expect(screen.getAllByText("Falta cargar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Requiere revisión").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Falta el dato").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No existe la fila").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Desactivado").length).toBeGreaterThan(0);
  });

  it("un horario cargado y sin publicar se lee distinto de uno que falta", async () => {
    respuestas["/admin/data-readiness"] = {
      ...readiness(),
      sections: readiness().sections.map((s: any) =>
        s.id === "schedules"
          ? { ...s, items: [{ key: "visitas", label: "Visitas a internados", status: "inactive" }] }
          : s,
      ),
    };
    montar(soloPantalla(), "/admin/datos-pendientes");

    expect(await screen.findByText("Cargado, sin publicar")).toBeTruthy();
  });

  it("muestra el resumen que manda el servidor", async () => {
    montar(soloPantalla(), "/admin/datos-pendientes");
    await screen.findByText("Canales de contacto");

    expect(screen.getByText("Resueltos").parentElement!.textContent).toContain("3");
    expect(screen.getByText("Requieren revisión").parentElement!.textContent).toContain("2");
    expect(screen.getByText("Total").parentElement!.textContent).toContain("16");
  });

  it("muestra el aviso y su enlace", async () => {
    montar(soloPantalla(), "/admin/datos-pendientes");

    expect(await screen.findByText(/nota anterior que nadie revis/i)).toBeTruthy();
  });

  it("tiene estado de carga", async () => {
    let liberar: () => void = () => {};
    demorar = new Promise<void>((r) => {
      liberar = r;
    });
    montar(soloPantalla(), "/admin/datos-pendientes");

    expect(screen.getByText("Datos pendientes")).toBeTruthy();
    expect(screen.queryByText("Canales de contacto")).toBeNull();

    liberar();
    demorar = null;
    expect(await screen.findByText("Canales de contacto")).toBeTruthy();
  });

  it("tiene estado de error con reintento", async () => {
    fallar = true;
    montar(soloPantalla(), "/admin/datos-pendientes");

    expect(await screen.findByText(/No se pudo consultar el estado/i)).toBeTruthy();
    expect(screen.getByText("Reintentar")).toBeTruthy();
  });
});

describe("las rutas se resuelven bajo basename=/admin", () => {
  const conLayout = () => [
    {
      path: "/",
      element: <AdminLayout />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: "datos-pendientes", element: <DataReadinessPage /> },
      ],
    },
  ];

  it("ningún enlace de la pantalla produce /admin/admin/…", async () => {
    montar(conLayout(), "/admin/datos-pendientes");
    // Se espera un texto que **sólo** existe en la pantalla: "Canales de
    // contacto" también es una entrada del menú, así que esperarlo daba por
    // renderizado el contenido cuando todavía no había llegado.
    await screen.findByText("Alcance de Biopsias");

    const hrefs = enlaces();
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, `enlace duplicado: ${href}`).not.toMatch(/^\/admin\/admin(\/|$)/);
    }
  });

  it("cada sección enlaza a su pantalla con el prefijo puesto una sola vez", async () => {
    montar(conLayout(), "/admin/datos-pendientes");
    await screen.findByText("Alcance de Biopsias");

    const hrefs = enlaces();
    expect(hrefs).toContain("/admin/contact-channels");
    expect(hrefs).toContain("/admin/schedules");
    expect(hrefs).toContain("/admin/pages/12");
  });

  it("la entrada del menú existe y apunta a /admin/datos-pendientes", async () => {
    montar(conLayout(), "/admin/datos-pendientes");

    const item = await screen.findByText("Datos pendientes", { selector: "span" });
    const enlace = item.closest("a");
    expect(enlace, "la entrada del menú tiene que ser un enlace").toBeTruthy();
    expect(enlace!.getAttribute("href")).toBe("/admin/datos-pendientes");
  });

  it("el menú sigue teniendo las pantallas donde se resuelve cada caso", async () => {
    montar(conLayout(), "/admin/datos-pendientes");
    await screen.findByText("Alcance de Biopsias");

    const hrefs = enlaces();
    expect(hrefs).toContain("/admin/contact-channels");
    expect(hrefs).toContain("/admin/schedules");
    expect(hrefs).toContain("/admin/pages");
  });
});

describe("tarjeta del Dashboard", () => {
  const soloDashboard = () => [{ path: "/", element: <DashboardPage /> }];

  it("muestra resueltos sobre total y el peor estado", async () => {
    montar(soloDashboard(), "/admin/");

    expect(await screen.findByText("3 / 16")).toBeTruthy();
    expect(screen.getByText("Requiere revisión")).toBeTruthy();
  });

  it("lee summary y no lo recalcula desde sections", async () => {
    // `summary` dice 5/16; `sections` no da esa cuenta por ningún lado. Si la
    // tarjeta derivara los números de `sections`, mostraría otra cosa.
    respuestas["/admin/data-readiness"] = {
      ...readiness(),
      summary: { resolved: 5, pending: 9, review: 2, total: 16 },
    };
    montar(soloDashboard(), "/admin/");

    expect(await screen.findByText("5 / 16")).toBeTruthy();
  });

  it("enlaza a la pantalla con el prefijo puesto una sola vez", async () => {
    montar(soloDashboard(), "/admin/");
    await screen.findByText("3 / 16");

    expect(enlaces()).toContain("/admin/datos-pendientes");
  });

  it("si el endpoint falla, la tarjeta desaparece y el resto del Dashboard sigue", async () => {
    fallar = true;
    montar(soloDashboard(), "/admin/");

    expect(await screen.findByText("Inicio")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/\/ 16$/)).toBeNull());
  });
});

describe("el panel no imprime datos del sanatorio", () => {
  it("ni siquiera si la respuesta viniera contaminada", async () => {
    // Campos que el contrato prohíbe y la pantalla no lee. Si alguien volcara
    // el payload tal cual —un `<pre>{JSON.stringify(data)}</pre>` de depuración
    // que se queda—, esto lo detecta.
    const base = readiness();
    respuestas["/admin/data-readiness"] = {
      ...base,
      sections: base.sections.map((s: any) =>
        s.items
          ? {
              ...s,
              items: s.items.map((i: any) => ({
                ...i,
                value: TELEFONO,
                email: CORREO,
                hours: HORARIO,
                note: NOTA,
              })),
            }
          : s,
      ),
    };

    montar([{ path: "/datos-pendientes", element: <DataReadinessPage /> }], "/admin/datos-pendientes");
    await screen.findByText("Alcance de Biopsias");

    const texto = document.body.textContent ?? "";
    for (const dato of [TELEFONO, CORREO, HORARIO, NOTA]) {
      expect(texto, `se imprimió "${dato}"`).not.toContain(dato);
    }
    // Ni teléfonos ni correos por forma, no sólo por literal.
    expect(texto).not.toMatch(/\+\d[\d\s().-]{7,}/);
    expect(texto).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(texto).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("con la respuesta real tampoco aparece nada parecido a un dato", async () => {
    montar([{ path: "/datos-pendientes", element: <DataReadinessPage /> }], "/admin/datos-pendientes");
    await screen.findByText("Alcance de Biopsias");

    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/\+\d[\d\s().-]{7,}/);
    expect(texto).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(texto).not.toMatch(/\d{1,2}:\d{2}/);
    // Y sí muestra los nombres de fila, que no son datos pendientes.
    expect(texto).toContain("Emergencias");
    expect(texto).toContain("Consultorios externos");
  });
});

describe("la tarjeta del Dashboard no puede llevarse la pantalla", () => {
  const soloDashboard = () => [{ path: "/", element: <DashboardPage /> }];

  /**
   * Formas que rompían el render.
   *
   * `q.data.summary.resolved` sobre cualquiera de estas lanza, y una excepción
   * durante el render desmonta el árbol entero: se cae **todo** el Dashboard
   * —stats, actividad reciente, accesos rápidos— por un endpoint secundario.
   */
  const MALFORMADAS: [string, unknown][] = [
    ["un array", []],
    ["un objeto vacío", {}],
    ["sin summary", { overall: "pending", sections: [] }],
    ["summary incompleto", { overall: "pending", summary: { resolved: 1 } }],
    ["summary con textos", { overall: "pending", summary: { resolved: "1", pending: "2", review: "0", total: "3" } }],
    ["overall inventado", { overall: "explotado", summary: { resolved: 1, pending: 2, review: 0, total: 3 } }],
    ["null", null],
    ["una cadena", "no soy un objeto"],
  ];

  it.each(MALFORMADAS)("con %s el resto del Dashboard sigue en pie", async (_q, payload) => {
    respuestas["/admin/data-readiness"] = payload;
    montar(soloDashboard(), "/admin/");

    // Lo que tiene que seguir visible: el encabezado y las tarjetas de stats.
    expect(await screen.findByText("Inicio")).toBeTruthy();
    expect(await screen.findByText("Mensajes nuevos")).toBeTruthy();
    expect(screen.getByText("Accesos rápidos")).toBeTruthy();

    // Y la tarjeta que no pudo dibujarse no aparece a medias.
    await waitFor(() => expect(screen.queryByText("Datos pendientes")).toBeNull());
  });

  it("con la respuesta correcta la tarjeta sí se muestra", async () => {
    // Control: el blindaje no puede ser "no dibujar nunca".
    montar(soloDashboard(), "/admin/");
    expect(await screen.findByText("Datos pendientes")).toBeTruthy();
    expect(await screen.findByText("3 / 16")).toBeTruthy();
  });
});
