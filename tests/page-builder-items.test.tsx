// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mover } from "../apps/admin/src/components/BlockPropsEditor";

/**
 * El editor genérico de listas del Page Builder.
 *
 * ## Por qué el reordenamiento vive en el editor y no en cada bloque
 *
 * El orden de un array `kind: "items"` es el orden en que se publica, y hasta
 * ahora la única forma de cambiarlo era borrar los ítems de abajo y volver a
 * escribirlos a mano. Eso afecta por igual a tarjetas, acordeón, slider,
 * galería, pasos, estadísticas y logos — siete bloques con el mismo problema y
 * ninguna razón para resolverlo siete veces.
 *
 * Estando en el editor, un bloque nuevo que declare un campo de este tipo lo
 * recibe sin escribir una línea. La última prueba de este archivo comprueba
 * exactamente eso.
 *
 * ## Subir/Bajar y no arrastrar
 *
 * Dos botones funcionan con teclado, con lector de pantalla y en un teléfono,
 * sin necesitar una alternativa aparte. Un drag-and-drop necesitaría las tres
 * cosas implementadas por separado para llegar al mismo lugar.
 */

let mediaDisponible: any[] = [];
let fallarMedia = false;

vi.mock("../apps/admin/src/api", () => ({
  api: {
    get: async (url: string) => {
      if (url === "/admin/media") {
        if (fallarMedia) throw new Error("500");
        return { data: mediaDisponible };
      }
      return { data: [] };
    },
    post: async () => ({ data: {} }),
    put: async () => ({ data: {} }),
    patch: async () => ({ data: {} }),
    delete: async () => ({ data: null }),
  },
}));

let BlockPropsEditor: any;
let QueryClient: any;
let QueryClientProvider: any;
let MemoryRouter: any;

/**
 * Monta el editor y devuelve las props que fue produciendo.
 *
 * Se guarda cada `onChange`: así se puede afirmar sobre el valor exacto que se
 * habría guardado, y no sólo sobre lo que se ve.
 */
function montar(type: string, props: any) {
  const emitidos: any[] = [];
  let actuales = props;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const vista = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BlockPropsEditor
          type={type}
          props={actuales}
          onChange={(p: any) => {
            emitidos.push(p);
            actuales = p;
            vista.rerender(
              <QueryClientProvider client={client}>
                <MemoryRouter>
                  <BlockPropsEditor type={type} props={actuales} onChange={(q: any) => emitidos.push(q)} />
                </MemoryRouter>
              </QueryClientProvider>,
            );
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { emitidos, ultimo: () => emitidos[emitidos.length - 1] };
}

/** Los encabezados "Item #n" en el orden en que están en pantalla. */
const encabezados = () => screen.getAllByText(/^Item #\d+$/).map((e) => e.textContent);

/** El contenedor de un ítem, por su número. */
const item = (n: number) => screen.getByText(`Item #${n}`).closest("div.border") as HTMLElement;

beforeEach(async () => {
  mediaDisponible = [];
  fallarMedia = false;

  const rq = await import("@tanstack/react-query");
  QueryClient = rq.QueryClient;
  QueryClientProvider = rq.QueryClientProvider;
  MemoryRouter = (await import("react-router-dom")).MemoryRouter;
  BlockPropsEditor = (await import("../apps/admin/src/components/BlockPropsEditor")).default;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("mover", () => {
  it("mueve sin mutar el original", () => {
    const original = [{ a: 1 }, { a: 2 }, { a: 3 }];
    const copia = [...original];
    const r = mover(original, 0, 2);

    expect(r.map((x) => x.a)).toEqual([2, 3, 1]);
    expect(original, "mutó el array recibido").toEqual(copia);
    expect(r).not.toBe(original);
  });

  it("conserva la identidad de los objetos movidos", () => {
    const a = { titulo: "uno", anidado: { x: 1 } };
    const arr = [a, { titulo: "dos" }];
    const r = mover(arr, 0, 1);

    // La misma referencia, no una copia superficial: así un ítem conserva todo
    // lo que tenga adentro, incluidos campos que el editor no conoce.
    expect(r[1]).toBe(a);
    expect(r[1].anidado).toBe(a.anidado);
  });

  it("los índices fuera de rango devuelven el mismo array", () => {
    const arr = [{ a: 1 }, { a: 2 }];
    expect(mover(arr, 0, 0)).toBe(arr);
    expect(mover(arr, -1, 1)).toBe(arr);
    expect(mover(arr, 0, 5)).toBe(arr);
    expect(mover(arr, 9, 0)).toBe(arr);
  });
});

describe("reordenamiento en el editor", () => {
  const TRES = {
    columns: 3,
    items: [
      { title: "Primero", text: "a", href: "/uno" },
      { title: "Segundo", text: "b", href: "/dos" },
      { title: "Tercero", text: "c", href: "/tres" },
    ],
  };

  it("el primer ítem no puede subir", () => {
    montar("cards", TRES);
    expect(within(item(1)).getByRole("button", { name: /subir/i }).hasAttribute("disabled")).toBe(true);
    expect(within(item(1)).getByRole("button", { name: /bajar/i }).hasAttribute("disabled")).toBe(false);
  });

  it("el último ítem no puede bajar", () => {
    montar("cards", TRES);
    expect(within(item(3)).getByRole("button", { name: /bajar/i }).hasAttribute("disabled")).toBe(true);
    expect(within(item(3)).getByRole("button", { name: /subir/i }).hasAttribute("disabled")).toBe(false);
  });

  it("un ítem del medio puede ir en las dos direcciones", () => {
    montar("cards", TRES);
    expect(within(item(2)).getByRole("button", { name: /subir/i }).hasAttribute("disabled")).toBe(false);
    expect(within(item(2)).getByRole("button", { name: /bajar/i }).hasAttribute("disabled")).toBe(false);
  });

  it("subir el segundo lo pone primero", () => {
    const { ultimo } = montar("cards", TRES);
    fireEvent.click(within(item(2)).getByRole("button", { name: /subir/i }));

    expect(ultimo().items.map((i: any) => i.title)).toEqual(["Segundo", "Primero", "Tercero"]);
  });

  it("bajar el segundo lo pone último", () => {
    const { ultimo } = montar("cards", TRES);
    fireEvent.click(within(item(2)).getByRole("button", { name: /bajar/i }));

    expect(ultimo().items.map((i: any) => i.title)).toEqual(["Primero", "Tercero", "Segundo"]);
  });

  it("mover conserva todas las propiedades del objeto, también las que el editor no dibuja", () => {
    const conExtras = {
      items: [
        { title: "Primero", text: "a", icon: "heart", campoDesconocido: { profundo: [1, 2] } },
        { title: "Segundo", text: "b" },
      ],
    };
    const { ultimo } = montar("cards", conExtras);
    fireEvent.click(within(item(1)).getByRole("button", { name: /bajar/i }));

    const movido = ultimo().items[1];
    expect(movido).toEqual(conExtras.items[0]);
    // Incluida una clave que ningún `itemFields` declara: perderla al mover
    // sería borrar datos guardados sin que nadie lo pidiera.
    expect(movido.campoDesconocido).toEqual({ profundo: [1, 2] });
  });

  it("el orden en pantalla sigue al orden real", async () => {
    montar("cards", TRES);
    expect(encabezados()).toEqual(["Item #1", "Item #2", "Item #3"]);

    fireEvent.click(within(item(3)).getByRole("button", { name: /subir/i }));

    await waitFor(() => {
      expect(within(item(2)).getByDisplayValue("Tercero")).toBeTruthy();
    });
  });

  it("los botones tienen nombre accesible con la posición", () => {
    montar("cards", TRES);

    // "↑" solo no le dice nada a un lector de pantalla, y tres pares de
    // botones idénticos son indistinguibles.
    expect(within(item(2)).getByRole("button", { name: "Subir tarjetas 2" })).toBeTruthy();
    expect(within(item(2)).getByRole("button", { name: "Bajar tarjetas 2" })).toBeTruthy();
    expect(within(item(2)).getByRole("button", { name: "Quitar tarjetas 2" })).toBeTruthy();
  });

  it("agregar y quitar siguen funcionando", () => {
    const { ultimo } = montar("cards", TRES);

    fireEvent.click(screen.getByText("Agregar item"));
    expect(ultimo().items).toHaveLength(4);

    cleanup();
    const segunda = montar("cards", TRES);
    fireEvent.click(within(item(2)).getByRole("button", { name: /quitar/i }));
    expect(segunda.ultimo().items.map((i: any) => i.title)).toEqual(["Primero", "Tercero"]);
  });

  it("con un solo ítem no se puede ni subir ni bajar", () => {
    montar("cards", { items: [{ title: "Único" }] });
    expect(within(item(1)).getByRole("button", { name: /subir/i }).hasAttribute("disabled")).toBe(true);
    expect(within(item(1)).getByRole("button", { name: /bajar/i }).hasAttribute("disabled")).toBe(true);
  });

  /**
   * El punto de haberlo puesto en el editor genérico: cualquier bloque que
   * declare `kind: "items"` lo recibe sin código propio.
   */
  it.each([
    ["cards", "items", "title"],
    ["accordion", "items", "title"],
    ["slider", "slides", "title"],
    ["gallery", "images", "alt"],
    ["steps", "items", "title"],
    ["stats", "items", "label"],
    ["logos", "logos", "alt"],
  ])("%s también tiene reordenamiento", (tipo, campo, textoClave) => {
    montar(tipo, {
      [campo]: [
        { [textoClave]: "Uno" },
        { [textoClave]: "Dos" },
      ],
    });

    expect(within(item(1)).getByRole("button", { name: /subir/i }).hasAttribute("disabled")).toBe(true);
    expect(within(item(1)).getByRole("button", { name: /bajar/i }).hasAttribute("disabled")).toBe(false);
    expect(within(item(2)).getByRole("button", { name: /subir/i }).hasAttribute("disabled")).toBe(false);
  });
});

describe("selector multimedia en los campos de imagen", () => {
  const IMAGENES = [
    {
      id: 1,
      url: "/uploads/logo-a.png",
      mime: "image/png",
      size: 20480,
      alt: "Obra social A",
      width: 400,
      height: 80,
      frames: 1,
    },
    {
      id: 2,
      url: "/uploads/foto.jpg",
      mime: "image/jpeg",
      size: 80000,
      alt: "Fachada",
      width: 1600,
      height: 900,
      frames: 1,
    },
    {
      id: 3,
      url: "/uploads/protocolo.pdf",
      mime: "application/pdf",
      size: 5000,
      alt: null,
      width: null,
      height: null,
      frames: null,
    },
  ];

  beforeEach(() => {
    mediaDisponible = IMAGENES;
  });

  /**
   * Abre el selector y espera a que la biblioteca **termine de cargar**.
   *
   * El diálogo aparece de inmediato con el esqueleto: la consulta arranca
   * recién al abrirse (`enabled: abierto`). Afirmar sobre la grilla sin
   * esperar mira el esqueleto y no la lista.
   */
  const abrir = async () => {
    fireEvent.click(screen.getAllByText("Elegir de Multimedia")[0]);
    const dialogo = await screen.findByRole("dialog", { name: /elegir imagen/i });
    await waitFor(() => expect(dialogo.querySelector('[aria-busy="true"]')).toBeNull());
    return dialogo;
  };

  it("no ofrece PDFs", async () => {
    montar("logos", { logos: [{ alt: "" }] });
    await abrir();

    // Un PDF en un campo `imageUrl` produce un `<img>` roto en el sitio.
    expect(screen.queryByRole("button", { name: /protocolo\.pdf/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Obra social A/i })).toBeTruthy();
  });

  it("elegir una imagen completa URL, alt y dimensiones del ítem", async () => {
    const { ultimo } = montar("logos", { logos: [{}] });
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: /Obra social A/i }));

    await waitFor(() => expect(ultimo().logos[0].imageUrl).toBe("/uploads/logo-a.png"));
    const logo = ultimo().logos[0];
    // Pegar una URL a mano no puede traer estas tres, y sin las dimensiones el
    // sitio salta al cargar cada logo.
    expect(logo.alt).toBe("Obra social A");
    expect(logo.width).toBe(400);
    expect(logo.height).toBe(80);
  });

  it("no pisa un alt que alguien ya escribió", async () => {
    const { ultimo } = montar("logos", { logos: [{ alt: "Mi texto propio" }] });
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: /Obra social A/i }));

    await waitFor(() => expect(ultimo().logos[0].imageUrl).toBeTruthy());
    expect(ultimo().logos[0].alt).toBe("Mi texto propio");
  });

  it("se puede escribir una URL externa a mano", async () => {
    const { ultimo } = montar("logos", { logos: [{}] });
    const entrada = screen.getAllByPlaceholderText(/uploads.*o una URL completa/i)[0];

    fireEvent.change(entrada, { target: { value: "https://cdn.externo.test/logo.svg" } });

    // Hay imágenes institucionales alojadas fuera; quitar esta posibilidad
    // rompería bloques que ya la usan.
    expect(ultimo().logos[0].imageUrl).toBe("https://cdn.externo.test/logo.svg");
  });

  it("la búsqueda filtra por alt y por nombre de archivo", async () => {
    montar("logos", { logos: [{}] });
    await abrir();

    fireEvent.change(screen.getByLabelText("Buscar imagen"), { target: { value: "fachada" } });
    expect(screen.queryByRole("button", { name: /Obra social A/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Fachada/i })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Buscar imagen"), { target: { value: "logo-a" } });
    expect(screen.getByRole("button", { name: /Obra social A/i })).toBeTruthy();
  });

  it("una búsqueda sin resultados lo dice y ofrece ir a Multimedia", async () => {
    montar("logos", { logos: [{}] });
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar imagen"), { target: { value: "no-existe" } });

    expect(screen.getByText(/Ninguna imagen coincide/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Multimedia/i })).toBeTruthy();
  });

  it("la biblioteca vacía ofrece subir", async () => {
    mediaDisponible = [];
    montar("logos", { logos: [{}] });
    await abrir();

    expect(screen.getByText(/Todavía no hay imágenes/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Multimedia/i })).toBeTruthy();
  });

  it("un fallo al cargar la biblioteca se muestra con reintento", async () => {
    fallarMedia = true;
    montar("logos", { logos: [{}] });
    await abrir();

    expect(await screen.findByText(/No se pudo cargar la biblioteca/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("Quitar deja el campo vacío", async () => {
    const { ultimo } = montar("logos", { logos: [{ imageUrl: "/uploads/logo-a.png" }] });

    fireEvent.click(screen.getAllByRole("button", { name: /Quitar imagen/i })[0]);
    expect(ultimo().logos[0].imageUrl).toBe("");
  });

  it("el botón que abre declara que controla un diálogo", async () => {
    montar("logos", { logos: [{}] });
    const boton = screen.getAllByText("Elegir de Multimedia")[0];

    expect(boton.getAttribute("aria-haspopup")).toBe("dialog");
    expect(boton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(boton);
    await waitFor(() => expect(boton.getAttribute("aria-expanded")).toBe("true"));
  });

  it("Escape cierra el selector y devuelve el foco", async () => {
    montar("logos", { logos: [{}] });
    const boton = screen.getAllByText("Elegir de Multimedia")[0];
    fireEvent.click(boton);
    await screen.findByRole("dialog", { name: /elegir imagen/i });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Sin devolver el foco, quien navega con teclado queda al principio de la
    // página después de cerrar.
    expect(document.activeElement).toBe(boton);
  });

  it("la imagen ya elegida se marca como actual", async () => {
    montar("logos", { logos: [{ imageUrl: "/uploads/foto.jpg" }] });
    await abrir();

    expect(screen.getByRole("button", { name: /Fachada/i }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: /Obra social A/i }).getAttribute("aria-current")).toBeNull();
  });

  it("el nombre accesible de cada opción incluye las dimensiones", async () => {
    montar("logos", { logos: [{}] });
    await abrir();

    // "Imagen 1", "Imagen 2" no le sirve a nadie para elegir.
    expect(screen.getByRole("button", { name: "Elegir Obra social A, 400×80 píxeles" })).toBeTruthy();
  });
});
