// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La bandeja de Turnos, su entrada de menú y la tarjeta del Dashboard.
 *
 * Lo que sólo se ve en el DOM:
 *
 * - que el contador del menú y el del Dashboard salgan del `total` del
 *   servidor y no del largo de la lista recibida, que viene acotada por un
 *   límite: con más pendientes que el tope de una página, contar lo que llegó
 *   da de menos y el operador ve un número tranquilizador y falso;
 * - que eliminar pase por el diálogo de confirmación y no por el `confirm()`
 *   nativo, que en el panel no se usa en ningún lado;
 * - que el CSV salga con los filtros puestos y no con la tabla entera.
 */

interface Turno {
  id: number;
  name: string;
  phone: string;
  email: string;
  preferred_at: string | null;
  message: string | null;
  status: string;
  consent_at: string | null;
  created_at: string;
  updated_at: string | null;
  doctor_name: string | null;
  specialty_name: string | null;
}

/** Respuesta mínima y bien formada de `data-readiness`, que el Dashboard pide. */
const READINESS = {
  overall: "review",
  summary: { resolved: 0, pending: 15, review: 1, total: 16 },
  sections: [],
  warnings: [],
};

const turno = (over: Partial<Turno> = {}): Turno => ({
  id: 1,
  name: "Ana Prueba",
  phone: "+595 981 000 111",
  email: "ana.prueba@ejemplo.test",
  preferred_at: null,
  message: "Prefiero por la mañana.",
  status: "pendiente",
  consent_at: "2026-08-20T10:00:00.000Z",
  created_at: "2026-08-20T10:00:00.000Z",
  updated_at: null,
  doctor_name: null,
  specialty_name: "Cardiología",
  ...over,
});

/** Lo que devuelve la API según la query string con la que se la llamó. */
let respuesta: (qs: string) => { items: Turno[]; total: number } = () => ({ items: [], total: 0 });
let urlsPedidas: string[] = [];
let escrituras: { method: string; url: string; body?: any }[] = [];
let fallarLista = false;
/** Blobs que `downloadCsv` mandó a `URL.createObjectURL`. */
let blobs: Blob[] = [];

vi.mock("../apps/admin/src/api", () => ({
  api: {
    get: async (url: string) => {
      urlsPedidas.push(url);
      if (url.startsWith("/admin/appointments")) {
        if (fallarLista) throw new Error("500");
        return { data: respuesta(url.split("?")[1] ?? "") };
      }
      // El Dashboard monta además la tarjeta de Datos pendientes, que espera
      // la forma real de su endpoint. Devolverle un array la haría fallar por
      // un motivo ajeno a lo que se prueba acá.
      if (url.includes("data-readiness")) return { data: READINESS };
      return { data: [] };
    },
    put: async (url: string, body: any) => {
      escrituras.push({ method: "put", url, body });
      return { data: {} };
    },
    delete: async (url: string) => {
      escrituras.push({ method: "delete", url });
      return { data: null };
    },
    post: async () => ({ data: {} }),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));

let AppointmentsPage: any;
let AdminLayout: any;
let DashboardPage: any;
let ConfirmProvider: any;
let createMemoryRouter: any;
let RouterProvider: any;

function montar(rutas: any[], entrada: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(rutas, { basename: "/admin", initialEntries: [entrada] });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

const soloBandeja = () => [{ path: "/turnos", element: <AppointmentsPage /> }];

/**
 * El contenedor del diálogo de confirmación.
 *
 * `ConfirmDialog` no declara `role="dialog"`, así que se lo ubica por su
 * título. Hace falta acotar: "Eliminar" y "Cancelar" existen también como
 * acciones de la fila, y sin acotar el clic caería en la de atrás.
 */
async function abrirDialogo() {
  const titulo = await screen.findByText(/Eliminar solicitud/i);
  return titulo.closest("div.card") as HTMLElement;
}

/** La tarjeta de Turnos del Dashboard, para no confundirla con el badge. */
async function tarjetaDeTurnos() {
  const label = await screen.findByText("Turnos pendientes");
  return label.closest("a") as HTMLElement;
}

/** Lee un Blob sin depender de `Blob.text()`, que jsdom no implementa. */
function leerBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(blob);
  });
}

beforeEach(async () => {
  urlsPedidas = [];
  escrituras = [];
  blobs = [];
  fallarLista = false;
  respuesta = () => ({ items: [turno()], total: 1 });

  // jsdom no implementa las URL de objeto; se capturan los blobs para poder
  // leer el CSV que realmente se generó.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (b: Blob) => {
      blobs.push(b);
      return "blob:prueba";
    },
    revokeObjectURL: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const rr = await import("react-router-dom");
  createMemoryRouter = rr.createMemoryRouter;
  RouterProvider = rr.RouterProvider;
  ConfirmProvider = (await import("../apps/admin/src/components/ConfirmDialog")).ConfirmProvider;
  AppointmentsPage = (await import("../apps/admin/src/pages/AppointmentsPage")).default;
  AdminLayout = (await import("../apps/admin/src/components/AdminLayout")).default;
  DashboardPage = (await import("../apps/admin/src/pages/DashboardPage")).default;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bandeja de Turnos", () => {
  it("lista las solicitudes con sus datos de contacto", async () => {
    montar(soloBandeja(), "/admin/turnos");

    expect(await screen.findByText("Ana Prueba")).toBeTruthy();
    expect(screen.getByText(/\+595 981 000 111/)).toBeTruthy();
    expect(screen.getByText("Cardiología")).toBeTruthy();
    // "Pendiente" también es una opción del filtro: se busca el badge de la
    // fila, no cualquier texto que diga lo mismo.
    const fila = screen.getByText("Ana Prueba").closest("tr")!;
    expect(within(fila).getByText("Pendiente")).toBeTruthy();
  });

  it("aclara que la coordinación sigue siendo por WhatsApp", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Ana Prueba");
    expect(document.body.textContent).toMatch(/coordinaci[óo]n sigue siendo por WhatsApp/i);
  });

  it("tiene estado de carga", async () => {
    respuesta = () => ({ items: [turno()], total: 1 });
    montar(soloBandeja(), "/admin/turnos");
    // El encabezado ya está mientras la tabla todavía no.
    expect(screen.getByText("Turnos")).toBeTruthy();
    expect(screen.queryByText("Ana Prueba")).toBeNull();
    await screen.findByText("Ana Prueba");
  });

  it("tiene estado vacío", async () => {
    respuesta = () => ({ items: [], total: 0 });
    montar(soloBandeja(), "/admin/turnos");
    expect(await screen.findByText(/No hay solicitudes de turno con esos filtros/i)).toBeTruthy();
  });

  it("tiene estado de error con reintento", async () => {
    fallarLista = true;
    montar(soloBandeja(), "/admin/turnos");
    expect(await screen.findByText(/No se pudieron cargar las solicitudes/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reintentar/i })).toBeTruthy();
  });
});

describe("filtros", () => {
  it("el estado y las fechas viajan al servidor, no se recortan en el navegador", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Ana Prueba");

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "confirmado" } });
    await waitFor(() => expect(urlsPedidas.some((u) => u.includes("status=confirmado"))).toBe(true));

    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-08-31" } });
    await waitFor(() =>
      expect(urlsPedidas.some((u) => u.includes("from=2026-08-01") && u.includes("to=2026-08-31"))).toBe(true),
    );
  });

  it("la búsqueda libre filtra la tabla", async () => {
    respuesta = () => ({
      items: [turno(), turno({ id: 2, name: "Bruno Prueba", email: "bruno@ejemplo.test" })],
      total: 2,
    });
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Bruno Prueba");

    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/i), { target: { value: "Bruno" } });

    await waitFor(() => expect(screen.queryByText("Ana Prueba")).toBeNull());
    expect(screen.getByText("Bruno Prueba")).toBeTruthy();
  });
});

describe("cambio de estado", () => {
  it("confirmar, cancelar y volver a pendiente llaman al endpoint", async () => {
    respuesta = () => ({ items: [turno({ status: "confirmado" })], total: 1 });
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Ana Prueba");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(escrituras).toHaveLength(1));
    expect(escrituras[0]).toMatchObject({ method: "put", url: "/admin/appointments/1", body: { status: "cancelado" } });

    fireEvent.click(screen.getByRole("button", { name: /Volver a pendiente/i }));
    await waitFor(() => expect(escrituras).toHaveLength(2));
    expect(escrituras[1].body).toEqual({ status: "pendiente" });
  });

  it("no ofrece el estado que la solicitud ya tiene", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Ana Prueba");
    // Está en "pendiente": no tiene sentido ofrecer "volver a pendiente".
    expect(screen.queryByRole("button", { name: /Volver a pendiente/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeTruthy();
  });
});

describe("eliminación", () => {
  it("pasa por el diálogo de confirmación, no por confirm()", async () => {
    const nativo = vi.spyOn(window, "confirm").mockReturnValue(true);
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Ana Prueba");

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    const dialogo = await abrirDialogo();
    expect(nativo, "el panel no usa confirm() nativo en ningún lado").not.toHaveBeenCalled();
    expect(escrituras, "todavía no se eliminó nada").toHaveLength(0);

    fireEvent.click(within(dialogo).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(escrituras).toHaveLength(1));
    expect(escrituras[0]).toMatchObject({ method: "delete", url: "/admin/appointments/1" });
  });

  it("cancelar el diálogo no elimina", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Ana Prueba");

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    const dialogo = await abrirDialogo();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Cancelar/i }));

    await waitFor(() => expect(screen.queryByText(/¿Eliminar la solicitud/i)).toBeNull());
    expect(escrituras).toHaveLength(0);
  });
});

describe("exportación CSV", () => {
  it("exporta lo que hay en pantalla, con encabezados en español", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Ana Prueba");

    fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/i }));

    await waitFor(() => expect(blobs).toHaveLength(1));
    const texto = await leerBlob(blobs[0]);
    expect(texto).toContain("Nombre");
    expect(texto).toContain("Teléfono");
    expect(texto).toContain("Ana Prueba");
    expect(texto).toContain("+595 981 000 111");
  });

  it("con la tabla vacía el botón está deshabilitado", async () => {
    respuesta = () => ({ items: [], total: 0 });
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText(/No hay solicitudes/i);

    expect((screen.getByRole("button", { name: /Exportar CSV/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("menú y Dashboard", () => {
  const conLayout = () => [
    {
      path: "/",
      element: <AdminLayout />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: "turnos", element: <AppointmentsPage /> },
      ],
    },
  ];

  it("la entrada del menú apunta a /admin/turnos", async () => {
    montar(conLayout(), "/admin/turnos");

    const item = await screen.findByText("Turnos", { selector: "span" });
    const enlace = item.closest("a");
    expect(enlace).toBeTruthy();
    expect(enlace!.getAttribute("href")).toBe("/admin/turnos");
  });

  it("el badge del menú usa el total del servidor, no el largo de la lista", async () => {
    // Doce pendientes, pero la página trae dos: contar lo recibido daría 2 y
    // el operador vería un número tranquilizador y falso.
    respuesta = (qs) =>
      qs.includes("status=pendiente")
        ? { items: [turno(), turno({ id: 2 })], total: 12 }
        : { items: [turno()], total: 1 };
    montar(conLayout(), "/admin/turnos");

    const item = await screen.findByText("Turnos", { selector: "span" });
    const enlace = item.closest("a")!;
    await waitFor(() => expect(enlace.textContent).toContain("12"));
  });

  it("la tarjeta del Dashboard muestra ese mismo total y enlaza a la bandeja", async () => {
    respuesta = (qs) =>
      qs.includes("status=pendiente") ? { items: [turno()], total: 12 } : { items: [], total: 0 };
    montar(conLayout(), "/admin/");

    // El 12 aparece dos veces —badge del menú y tarjeta—: se acota a la
    // tarjeta, o la aserción pasaría aunque la tarjeta mostrara otra cosa.
    const tarjeta = await tarjetaDeTurnos();
    await waitFor(() => expect(within(tarjeta).getByText("12")).toBeTruthy());

    const hrefs = Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/admin/turnos");
    expect(hrefs.every((h) => !h?.startsWith("/admin/admin"))).toBe(true);
  });

  it("la tarjeta aclara que se coordinan por WhatsApp", async () => {
    montar(conLayout(), "/admin/");
    const tarjeta = await tarjetaDeTurnos();
    // El subtítulo aparece recién con el dato cargado: mientras carga hay un
    // esqueleto, y buscarlo antes fallaría por una carrera, no por el texto.
    await waitFor(() => expect(within(tarjeta).getByText(/Se coordinan por WhatsApp/i)).toBeTruthy());
  });
});
