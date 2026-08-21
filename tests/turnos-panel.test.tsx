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

/**
 * Lo que devuelve la API según la query string con la que se la llamó.
 *
 * Puede devolver una promesa: así una prueba deja una respuesta colgada y
 * observa qué se ve **durante** la transición, que es cuando la tabla muestra
 * filas de la consulta anterior.
 */
type Pagina = { items: Turno[]; total: number };
let respuesta: (qs: string) => Pagina | Promise<Pagina> = () => ({ items: [], total: 0 });
let urlsPedidas: string[] = [];
let escrituras: { method: string; url: string; body?: any }[] = [];
let fallarLista = false;
/** Lo que devuelve el endpoint de exportación. */
let csvDelServidor = "\ufeffNombre,Teléfono\r\nAna Prueba,+595 981 000 111";
/** Blobs que la descarga mandó a `URL.createObjectURL`. */
let blobs: Blob[] = [];

vi.mock("../apps/admin/src/api", () => ({
  api: {
    get: async (url: string, _config?: unknown) => {
      urlsPedidas.push(url);
      if (url.startsWith("/admin/appointments/export")) {
        // El CSV lo arma la API con **todo** el resultado; el panel sólo lo
        // descarga. Devolverlo como texto es lo que hace el endpoint real.
        return { data: csvDelServidor };
      }
      if (url.startsWith("/admin/appointments")) {
        if (fallarLista) throw new Error("500");
        return { data: await respuesta(url.split("?")[1] ?? "") };
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
  csvDelServidor = "\ufeffNombre,Teléfono\r\nAna Prueba,+595 981 000 111";
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

  it("la búsqueda viaja al servidor, no recorta la página en el navegador", async () => {
    // Recortar en el cliente buscaba dentro de lo recibido: con más
    // solicitudes que el tope de una página, un apellido que estuviera más
    // abajo daba "sin resultados" aunque existiera.
    respuesta = (qs) =>
      qs.includes("q=Bruno")
        ? { items: [turno({ id: 2, name: "Bruno Prueba", email: "bruno@ejemplo.test" })], total: 1 }
        : { items: [turno()], total: 1 };
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Ana Prueba");

    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/i), { target: { value: "Bruno" } });

    await waitFor(() => expect(urlsPedidas.some((u) => u.includes("q=Bruno"))).toBe(true));
    expect(await screen.findByText("Bruno Prueba")).toBeTruthy();
    expect(screen.queryByText("Ana Prueba")).toBeNull();
  });

  it("espera a que se deje de tipear antes de consultar", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Ana Prueba");
    const antes = urlsPedidas.length;

    const caja = screen.getByPlaceholderText(/Buscar por nombre/i);
    for (const texto of ["B", "Br", "Bru", "Brun", "Bruno"]) {
      fireEvent.change(caja, { target: { value: texto } });
    }

    // Sin debounce cada tecla dispara una consulta y las respuestas pueden
    // llegar desordenadas: la de "Bru" después de la de "Bruno".
    expect(urlsPedidas.length).toBe(antes);
    await waitFor(() => expect(urlsPedidas.some((u) => u.includes("q=Bruno"))).toBe(true));
    const consultas = urlsPedidas.slice(antes).filter((u) => u.includes("q="));
    expect(consultas.length, "se consultó por cada tecla").toBeLessThanOrEqual(2);
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
  it("descarga el archivo que arma el servidor, no la página visible", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Ana Prueba");

    fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/i }));

    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(
      urlsPedidas.some((u) => u.startsWith("/admin/appointments/export")),
      "el CSV tiene que pedirse al endpoint que ve el resultado entero",
    ).toBe(true);
    // `readAsText` consume la marca de orden de bytes, como cualquier
    // navegador: se compara el contenido, no el BOM.
    const texto = await leerBlob(blobs[0]);
    expect(texto).toBe(csvDelServidor.replace(/^\ufeff/, ""));
  });

  it("la exportación se lleva los filtros puestos, sin límite ni desplazamiento", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Ana Prueba");
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "confirmado" } });
    await waitFor(() => expect(urlsPedidas.some((u) => u.includes("status=confirmado"))).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/i }));

    await waitFor(() => expect(blobs).toHaveLength(1));
    const pedido = urlsPedidas.filter((u) => u.startsWith("/admin/appointments/export")).at(-1)!;
    expect(pedido).toContain("status=confirmado");
    // Con `limit`/`offset` el archivo saldría truncado a una página.
    expect(pedido).not.toContain("limit=");
    expect(pedido).not.toContain("offset=");
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

describe("paginación por servidor", () => {
  /** 250 solicitudes en la base, 20 por página: 13 páginas, la última con 10. */
  const MUCHAS = 250;
  const POR_PAGINA = 20;
  const PAGINAS = Math.ceil(MUCHAS / POR_PAGINA);
  const OFFSET_ULTIMA = (PAGINAS - 1) * POR_PAGINA;

  const paginado = (qs: string) => {
    const params = new URLSearchParams(qs);
    const offset = Number(params.get("offset") ?? 0);
    const limit = Number(params.get("limit") ?? POR_PAGINA);
    const q = params.get("q") ?? "";
    const total = q ? 1 : MUCHAS;
    const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) =>
      turno({ id: offset + i + 1, name: q ? "Zulema Prueba" : `Paciente ${offset + i} Prueba` }),
    );
    return { items, total };
  };

  beforeEach(() => {
    respuesta = paginado;
  });

  it("el contador muestra el total del servidor, no las filas recibidas", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Paciente 0 Prueba");

    // Con `rows.length` diría 20 y el operador creería que no hay más.
    expect(screen.getByText(`${MUCHAS} solicitudes`)).toBeTruthy();
  });

  it("se puede llegar a la última página y ahí hay filas de verdad", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Paciente 0 Prueba");

    fireEvent.click(screen.getByRole("button", { name: String(PAGINAS) }));

    await waitFor(() => expect(urlsPedidas.some((u) => u.includes(`offset=${OFFSET_ULTIMA}`))).toBe(true));
    expect(await screen.findByText(`Paciente ${OFFSET_ULTIMA} Prueba`)).toBeTruthy();
    // La última página trae el resto, no una página entera.
    expect(screen.queryByText(`Paciente ${MUCHAS} Prueba`)).toBeNull();
  });

  it("una fila de la última página se puede confirmar y eliminar", async () => {
    // Con el recorte en el navegador, esta fila no existía en ninguna página y
    // no había forma de tocarla.
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Paciente 0 Prueba");
    fireEvent.click(screen.getByRole("button", { name: String(PAGINAS) }));
    const ultima = await screen.findByText(`Paciente ${OFFSET_ULTIMA} Prueba`);

    const fila = ultima.closest("tr")!;
    fireEvent.click(within(fila).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(escrituras).toHaveLength(1));
    expect(escrituras[0]).toMatchObject({
      method: "put",
      url: `/admin/appointments/${OFFSET_ULTIMA + 1}`,
    });

    fireEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    const dialogo = await abrirDialogo();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(escrituras).toHaveLength(2));
    expect(escrituras[1].method).toBe("delete");
  });

  it("cambiar un filtro vuelve a la primera página", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Paciente 0 Prueba");
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    await waitFor(() => expect(urlsPedidas.some((u) => u.includes("offset=80"))).toBe(true));

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "confirmado" } });

    // Quedarse en la página 5 de otro conjunto muestra una tabla vacía sobre
    // un total que dice que hay resultados.
    await waitFor(() => {
      const ultima = urlsPedidas.filter((u) => u.includes("status=confirmado")).at(-1);
      expect(ultima).toContain("offset=0");
    });
  });

  it("buscar también vuelve a la primera página", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Paciente 0 Prueba");
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    await waitFor(() => expect(urlsPedidas.some((u) => u.includes("offset=80"))).toBe(true));

    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/i), { target: { value: "Zulema" } });

    await waitFor(() => {
      const ultima = urlsPedidas.filter((u) => u.includes("q=Zulema")).at(-1);
      expect(ultima).toContain("offset=0");
    });
    expect(await screen.findByText("Zulema Prueba")).toBeTruthy();
  });

  it("una búsqueda sin coincidencias no deja las filas anteriores", async () => {
    respuesta = (qs) => (qs.includes("q=") ? { items: [], total: 0 } : paginado(qs));
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Paciente 0 Prueba");

    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/i), { target: { value: "no-existe" } });

    expect(await screen.findByText(/No hay solicitudes de turno con esos filtros/i)).toBeTruthy();
    expect(screen.queryByText("Paciente 0 Prueba")).toBeNull();
    expect(screen.getByText("0 solicitudes")).toBeTruthy();
  });

  it("ordenar por una columna se lo pide al servidor", async () => {
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Paciente 0 Prueba");

    fireEvent.click(screen.getByText("Paciente"));

    // Ordenar en el navegador sólo reacomodaría las 20 filas visibles.
    await waitFor(() => expect(urlsPedidas.some((u) => u.includes("sort=name&dir=asc"))).toBe(true));
    fireEvent.click(screen.getByText("Paciente"));
    await waitFor(() => expect(urlsPedidas.some((u) => u.includes("sort=name&dir=desc"))).toBe(true));
  });
});

/**
 * Lo que se ve durante la transición entre dos consultas.
 *
 * `placeholderData` mantiene las filas de la respuesta anterior para que la
 * tabla no parpadee vacía al cambiar de página. El costo, que no se veía, es
 * que durante ese instante hay filas a la vista que **no pertenecen al filtro
 * nuevo** y sus botones seguían funcionando: confirmar "la primera de la
 * lista" mientras llega la respuesta actuaba sobre la solicitud vieja.
 */
describe("las filas de la consulta anterior no se pueden accionar", () => {
  /** Deja la próxima respuesta colgada hasta que la prueba la suelte. */
  let soltar: (() => void) | null = null;

  const conDemora = (fn: (qs: string) => Pagina | Promise<Pagina>) => {
    respuesta = fn;
  };

  beforeEach(() => {
    soltar = null;
  });

  it("mientras llega la página nueva, la fila vieja queda desactivada", async () => {
    respuesta = () => ({ items: [turno({ id: 7, name: "Vieja Prueba" })], total: 40 });
    montar(soloBandeja(), "/admin/turnos");
    const fila = (await screen.findByText("Vieja Prueba")).closest("tr")!;
    // Con la consulta ya resuelta, la fila sí se puede accionar.
    await waitFor(() => expect(within(fila).getByText("Confirmar").hasAttribute("disabled")).toBe(false));

    // La siguiente respuesta queda pendiente: es la transición.
    const espera = new Promise<void>((r) => {
      soltar = r;
    });
    conDemora(async (qs: string) => {
      await espera;
      return { items: [turno({ id: 99, name: "Nueva Prueba" })], total: 40 };
    });

    fireEvent.click(screen.getByText("Siguiente"));

    // La fila vieja sigue a la vista —eso es lo que evita el parpadeo— pero
    // ya no responde.
    const durante = (await screen.findByText("Vieja Prueba")).closest("tr")!;
    await waitFor(() => expect(within(durante).getByText("Confirmar").hasAttribute("disabled")).toBe(true));
    expect(document.querySelector("table")?.getAttribute("aria-busy")).toBe("true");

    const antes = escrituras.length;
    fireEvent.click(within(durante).getByText("Confirmar"));
    fireEvent.click(within(durante).getByText("Eliminar"));
    expect(escrituras.length, "se accionó una fila que ya no pertenece al filtro").toBe(antes);

    soltar!();
    expect(await screen.findByText("Nueva Prueba")).toBeTruthy();
  });

  it.each([
    ["la búsqueda", () => fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/i), { target: { value: "z" } })],
    ["el estado", () => fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "confirmado" } })],
    ["la fecha desde", () => fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-01-01" } })],
    ["el orden", () => fireEvent.click(screen.getByText("Paciente"))],
  ])("cambiar %s también desactiva las acciones", async (_q, cambiar) => {
    respuesta = () => ({ items: [turno({ id: 7, name: "Vieja Prueba" })], total: 40 });
    montar(soloBandeja(), "/admin/turnos");
    const fila = (await screen.findByText("Vieja Prueba")).closest("tr")!;
    await waitFor(() => expect(within(fila).getByText("Confirmar").hasAttribute("disabled")).toBe(false));

    const espera = new Promise<void>((r) => {
      soltar = r;
    });
    conDemora(async () => {
      await espera;
      return { items: [turno({ id: 7, name: "Vieja Prueba" })], total: 40 };
    });

    cambiar();

    await waitFor(
      () => {
        const actual = screen.getByText("Vieja Prueba").closest("tr")!;
        expect(within(actual).getByText("Confirmar").hasAttribute("disabled")).toBe(true);
      },
      { timeout: 3000 },
    );
    soltar!();
  });
});

/**
 * La última página después de eliminar.
 *
 * Con 21 solicitudes y páginas de 20, la página 2 tiene exactamente una fila.
 * Al eliminarla ese `offset` deja de existir: la API contesta bien —`items`
 * vacío y el total ya en 20— y el panel se quedaba mostrando una tabla vacía
 * sobre un contador que decía que había 20 resultados. No se salía sin
 * recargar a mano.
 */
describe("eliminar la única fila de la última página", () => {
  const VEINTIUNO = 21;

  it("vuelve sola a la última página que sí existe", async () => {
    let total = VEINTIUNO;
    respuesta = (qs) => {
      const params = new URLSearchParams(qs);
      const offset = Number(params.get("offset") ?? 0);
      const limit = Number(params.get("limit") ?? 20);
      const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) =>
        turno({ id: offset + i + 1, name: `Paciente ${offset + i} Prueba` }),
      );
      return { items, total };
    };

    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Paciente 0 Prueba");
    expect(screen.getByText("21 solicitudes")).toBeTruthy();

    // Página 2: una sola fila, la número 21.
    fireEvent.click(screen.getByText("Siguiente"));
    expect(await screen.findByText("Paciente 20 Prueba")).toBeTruthy();
    expect(screen.queryByText("Paciente 0 Prueba")).toBeNull();

    // Se elimina esa única fila. La API la borra de verdad del conjunto.
    const fila = screen.getByText("Paciente 20 Prueba").closest("tr")!;
    await waitFor(() => expect(within(fila).getByText("Eliminar").hasAttribute("disabled")).toBe(false));
    fireEvent.click(within(fila).getByText("Eliminar"));
    const dialogo = await abrirDialogo();
    total = VEINTIUNO - 1;
    fireEvent.click(within(dialogo).getByText("Eliminar"));

    await waitFor(() => expect(escrituras.some((e) => e.method === "delete")).toBe(true));

    // Termina mostrando las primeras 20, no una tabla vacía.
    //
    // Volver a la página 0 son dos pasos —el refetch trae el total nuevo y
    // recién ahí cambia la página—, así que la fila y el contador aparecen en
    // renders distintos: los dos se esperan.
    expect(await screen.findByText("Paciente 0 Prueba")).toBeTruthy();
    expect(await screen.findByText("20 solicitudes")).toBeTruthy();
    expect(screen.queryByText(/No hay solicitudes de turno con esos filtros/i)).toBeNull();
    await waitFor(() => expect(urlsPedidas.at(-1)).toContain("offset=0"));
  });

  it("si se borran todas, vuelve a la primera página y avisa que no hay nada", async () => {
    let total = VEINTIUNO;
    respuesta = (qs) => {
      const offset = Number(new URLSearchParams(qs).get("offset") ?? 0);
      const items = Array.from({ length: Math.max(0, Math.min(20, total - offset)) }, (_, i) =>
        turno({ id: offset + i + 1, name: `Paciente ${offset + i} Prueba` }),
      );
      return { items, total };
    };
    montar(soloBandeja(), "/admin/turnos");
    await screen.findByText("Paciente 0 Prueba");
    fireEvent.click(screen.getByText("Siguiente"));
    await screen.findByText("Paciente 20 Prueba");

    total = 0;
    const fila = screen.getByText("Paciente 20 Prueba").closest("tr")!;
    await waitFor(() => expect(within(fila).getByText("Eliminar").hasAttribute("disabled")).toBe(false));
    fireEvent.click(within(fila).getByText("Eliminar"));
    fireEvent.click(within(await abrirDialogo()).getByText("Eliminar"));

    expect(await screen.findByText(/No hay solicitudes de turno con esos filtros/i)).toBeTruthy();
    expect(await screen.findByText("0 solicitudes")).toBeTruthy();
    // Una página negativa pediría un offset inválido.
    await waitFor(() => expect(urlsPedidas.at(-1)).not.toMatch(/offset=-/));
  });
});
