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

describe("Canales institucionales en el panel", () => {
  const reservado = {
    id: 1,
    key: "emergencias",
    label: "Emergencias",
    kind: "phone",
    value: "",
    active: true,
    order: 0,
  };
  const propio = {
    id: 2,
    key: "consultorio-externo",
    label: "Consultorio externo",
    kind: "phone",
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
});
