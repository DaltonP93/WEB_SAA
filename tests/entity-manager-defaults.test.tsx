// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El formulario no puede decir una cosa y guardar otra.
 *
 * `EntityManager` dibujaba los checkbox con `checked={editing[f.key] ?? true}` y
 * el botón "Nuevo" arrancaba con `{}`. Resultado: en una fila nueva el checkbox
 * salía **marcado**, pero como nadie lo tocaba el campo no entraba en el
 * payload, y la base aplicaba su propio default. En `schedules` ese default es
 * `false`: la pantalla decía "Activado" y el horario se creaba despublicado.
 *
 * El síntoma para el sanatorio es de los peores posibles: cargás un horario, la
 * pantalla te muestra que está activo, guardás, y el sitio sigue diciendo
 * "Horarios en proceso de confirmación" sin ningún error.
 *
 * Ahora los defaults de creación son explícitos y tienen que coincidir con el
 * default de la columna.
 */

const enviados: { url: string; body: any }[] = [];
let filas: any[] = [];

vi.mock("../apps/admin/src/api", () => ({
  api: {
    get: async () => ({ data: filas }),
    post: async (url: string, body: any) => {
      enviados.push({ url, body });
      const fila = { id: 99, ...body };
      filas = [...filas, fila];
      return { data: fila };
    },
    put: async (url: string, body: any) => {
      enviados.push({ url, body });
      return { data: body };
    },
    delete: async () => ({ data: null }),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));

let SchedulesPage: any;
let ContactChannelsPage: any;
let StudiesPage: any;
let ConfirmProvider: any;

function montar(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  enviados.length = 0;
  filas = [];
  ConfirmProvider = (await import("../apps/admin/src/components/ConfirmDialog")).ConfirmProvider;
  SchedulesPage = (await import("../apps/admin/src/pages/SchedulesPage")).default;
  ContactChannelsPage = (await import("../apps/admin/src/pages/ContactChannelsPage")).default;
  StudiesPage = (await import("../apps/admin/src/pages/StudiesPage")).default;
});

afterEach(cleanup);

const checkboxDe = (nombre: RegExp) => {
  const etiqueta = screen.getByText(nombre);
  const contenedor = etiqueta.closest("div")!;
  return contenedor.querySelector('input[type="checkbox"]') as HTMLInputElement;
};

/** El input de texto que sigue a una etiqueta concreta del formulario. */
const campoDe = (nombre: RegExp) => {
  const etiqueta = screen.getByText(nombre);
  return etiqueta.closest("div")!.querySelector("input.input") as HTMLInputElement;
};

describe("Horarios: el checkbox de publicar arranca desmarcado", () => {
  it("al abrir la creación el checkbox está desmarcado", async () => {
    montar(<SchedulesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /nuevo/i }));

    // Antes salía marcado: `?? true` sobre un formulario que arranca vacío.
    expect(checkboxDe(/^Publicar$/).checked).toBe(false);
  });

  it("guardar sin tocarlo manda active=false explícito", async () => {
    montar(<SchedulesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /nuevo/i }));

    fireEvent.change(campoDe(/Área o tipo de atención/i), { target: { value: "Consultorios externos" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(enviados).toHaveLength(1));
    // El campo viaja en el payload: no se delega en el default de la columna.
    expect(enviados[0].body).toHaveProperty("active", false);
  });

  it("marcándolo, viaja active=true", async () => {
    montar(<SchedulesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /nuevo/i }));

    fireEvent.click(checkboxDe(/^Publicar$/));
    expect(checkboxDe(/^Publicar$/).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].body).toHaveProperty("active", true);
  });
});

describe("Canales: el default de creación es el de su columna", () => {
  it("un canal nuevo arranca activo, que es el default de la base", async () => {
    // La columna `contact_channels.active` tiene default 1: acá el checkbox
    // marcado sí es la verdad, y el arreglo de Horarios no puede invertirlo.
    montar(<ContactChannelsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /nuevo/i }));

    expect(checkboxDe(/^Activo$/).checked).toBe(true);
  });

  it("y guarda active=true explícito", async () => {
    montar(<ContactChannelsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /nuevo/i }));
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].body).toHaveProperty("active", true);
  });
});

describe("Estudios: el checkbox de publicar arranca desmarcado", () => {
  // `studies.published` tiene default 0, igual que `schedules.active`. El
  // síntoma es el mismo: la pantalla mostraba "Activado" y el estudio se creaba
  // sin publicar, sin ningún error que lo delatara.
  it("al abrir la creación el checkbox está desmarcado", async () => {
    montar(<StudiesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /nuevo/i }));

    expect(checkboxDe(/^Publicar en el sitio$/).checked).toBe(false);
  });

  it("guardar sin tocarlo manda published=false explícito", async () => {
    montar(<StudiesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /nuevo/i }));

    fireEvent.change(campoDe(/^Nombre$/), { target: { value: "Estudio de prueba" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(enviados).toHaveLength(1));
    // Presente y en false: no se delega en el default de la columna.
    expect(enviados[0].body).toHaveProperty("published", false);
  });

  it("marcándolo, viaja published=true", async () => {
    montar(<StudiesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /nuevo/i }));

    fireEvent.click(checkboxDe(/^Publicar en el sitio$/));
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].body).toHaveProperty("published", true);
  });
});

describe("Canales institucionales en el panel", () => {
  /**
   * Las filas llegan como las serializa la API: con `reserved` y `expectedKind`.
   * El panel no tiene —ni puede tener— su propia lista de las ocho claves.
   */
  const reservado = {
    id: 1,
    key: "emergencias",
    label: "Emergencias",
    kind: "phone",
    expectedKind: "phone",
    reserved: true,
    value: "",
    active: true,
    order: 0,
  };
  const propio = {
    id: 2,
    key: "consultorio-externo",
    label: "Consultorio externo",
    kind: "phone",
    expectedKind: null,
    reserved: false,
    value: "",
    active: true,
    order: 1,
  };

  it("una fila reservada no ofrece botón Eliminar", async () => {
    filas = [reservado];
    montar(<ContactChannelsPage />);

    await screen.findByText("Emergencias");
    expect(screen.queryByRole("button", { name: /^eliminar$/i })).toBeNull();
    expect(screen.getByText(/canal del sitio/i)).toBeTruthy();
  });

  it("una fila propia sí lo ofrece", async () => {
    filas = [propio];
    montar(<ContactChannelsPage />);

    await screen.findByText("Consultorio externo");
    expect(screen.getByRole("button", { name: /^eliminar$/i })).toBeTruthy();
  });

  it("editando una reservada, clave y tipo quedan bloqueados", async () => {
    filas = [reservado];
    montar(<ContactChannelsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /editar/i }));

    const clave = screen.getByDisplayValue("emergencias") as HTMLInputElement;
    expect(clave.disabled).toBe(true);
    const tipo = screen.getByDisplayValue("phone") as HTMLInputElement;
    expect(tipo.disabled).toBe(true);
    // Y se explica por qué, en vez de dejar un campo gris sin motivo.
    expect(screen.getAllByText(/canal institucional del sitio/i).length).toBeGreaterThan(0);
  });

  it("pero el nombre visible sigue siendo editable", async () => {
    filas = [reservado];
    montar(<ContactChannelsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /editar/i }));

    const label = screen.getByDisplayValue("Emergencias") as HTMLInputElement;
    expect(label.disabled).toBe(false);
  });

  it("editando una fila propia, clave y tipo se editan", async () => {
    filas = [propio];
    montar(<ContactChannelsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /editar/i }));

    expect((screen.getByDisplayValue("consultorio-externo") as HTMLInputElement).disabled).toBe(false);
  });

  it("al crear una fila nueva ningún campo está bloqueado", async () => {
    filas = [reservado];
    montar(<ContactChannelsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /nuevo/i }));

    for (const input of Array.from(document.querySelectorAll<HTMLInputElement>("input.input"))) {
      expect(input.disabled).toBe(false);
    }
  });

  it("al crear, el select de tipo existe y se puede elegir", async () => {
    // El bloqueo no oculta un campo: lo **reemplaza** por un `<input disabled>`
    // con el valor en texto. Si la condición se equivocara y aplicara al alta,
    // el `<select>` no existiría y el canal nuevo nacería sin tipo. Por eso no
    // alcanza con recorrer los `input`: hay que exigir el `select`.
    filas = [reservado];
    montar(<ContactChannelsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /nuevo/i }));

    const selects = Array.from(document.querySelectorAll<HTMLSelectElement>("select.input"));
    expect(selects.length, "el select de tipo desapareció del alta").toBe(1);
    expect(selects[0].disabled).toBe(false);

    fireEvent.change(selects[0], { target: { value: "whatsapp" } });
    fireEvent.change(campoDe(/Nombre visible/i), { target: { value: "WhatsApp de prueba" } });
    fireEvent.change(campoDe(/^Clave/i), { target: { value: "whatsapp-prueba" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].body).toMatchObject({ key: "whatsapp-prueba", kind: "whatsapp" });
  });

  describe("la protección alcanza a los ocho canales, no sólo a emergencias", () => {
    // El panel tenía su propia copia de las claves. Una copia se desincroniza
    // sin avisar: bastaba con que faltara una para que esa fila ofreciera un
    // "Eliminar" que la API contesta con 403. Ahora la marca viaja con la fila.
    const OCHO: [string, string][] = [
      ["emergencias", "phone"],
      ["whatsapp-turnos", "whatsapp"],
      ["whatsapp-estudios", "whatsapp"],
      ["whatsapp-general", "whatsapp"],
      ["whatsapp-samap", "whatsapp"],
      ["recepcion", "phone"],
      ["email-general", "email"],
      ["gth", "email"],
    ];

    const fila = (i: number, [key, kind]: [string, string]) => ({
      id: i + 1,
      key,
      label: `Canal ${key}`,
      kind,
      expectedKind: kind,
      reserved: true,
      value: "",
      active: true,
      order: i,
    });

    it("ninguno ofrece botón Eliminar y todos se marcan como canal del sitio", async () => {
      filas = OCHO.map((par, i) => fila(i, par));
      montar(<ContactChannelsPage />);

      await screen.findByText("Canal emergencias");
      expect(screen.queryAllByRole("button", { name: /^eliminar$/i })).toHaveLength(0);
      expect(screen.getAllByText(/canal del sitio/i)).toHaveLength(OCHO.length);
    });

    it("y una fila libre en la misma lista sí lo ofrece", async () => {
      // Control: la protección se decide por fila, no por pantalla.
      filas = [...OCHO.map((par, i) => fila(i, par)), { ...propio, id: 99 }];
      montar(<ContactChannelsPage />);

      await screen.findByText("Consultorio externo");
      expect(screen.queryAllByRole("button", { name: /^eliminar$/i })).toHaveLength(1);
      expect(screen.getAllByText(/canal del sitio/i)).toHaveLength(OCHO.length);
    });

    it.each(OCHO)("editando %s, clave y tipo quedan bloqueados", async (key, kind) => {
      filas = [fila(0, [key, kind])];
      montar(<ContactChannelsPage />);
      fireEvent.click(await screen.findByRole("button", { name: /editar/i }));

      expect((screen.getByDisplayValue(key) as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByDisplayValue(kind) as HTMLInputElement).disabled).toBe(true);
      // El `<select>` ni siquiera se dibuja: se reemplaza por el texto.
      expect(document.querySelectorAll("select.input")).toHaveLength(0);
      expect(screen.getAllByText(/canal institucional del sitio/i).length).toBeGreaterThan(0);
    });

    it.each(OCHO)("%s con el tipo equivocado desbloquea el tipo para repararlo", async (key, kind) => {
      // Un formulario que informa el problema y a la vez impide arreglarlo deja
      // al operador sin salida. La clave sigue bloqueada; el tipo no.
      const roto = kind === "email" ? "phone" : "email";
      filas = [{ ...fila(0, [key, kind]), kind: roto }];
      montar(<ContactChannelsPage />);
      fireEvent.click(await screen.findByRole("button", { name: /editar/i }));

      expect((screen.getByDisplayValue(key) as HTMLInputElement).disabled).toBe(true);
      const select = document.querySelector<HTMLSelectElement>("select.input");
      expect(select, "sin select no hay forma de reparar el tipo").toBeTruthy();
      expect(select!.disabled).toBe(false);
      expect(select!.value).toBe(roto);
      expect(screen.getAllByText(new RegExp(`debería ser "${kind}"`, "i")).length).toBeGreaterThan(0);

      fireEvent.change(select!, { target: { value: kind } });
      fireEvent.click(screen.getByRole("button", { name: /guardar/i }));
      await waitFor(() => expect(enviados).toHaveLength(1));
      expect(enviados[0].body).toMatchObject({ kind });
    });
  });
});
