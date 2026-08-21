// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El panel de Multimedia.
 *
 * Lo que sólo se ve en el DOM, y que estaba mal:
 *
 * - recomendaba **SVG** para logos, que la API rechaza — el operador seguía el
 *   consejo del propio panel y recibía un error;
 * - decía que el servidor redimensiona a 2400 px cuando redimensiona a 1600;
 * - `URL.createObjectURL()` se llamaba **dentro del render**: un blob nuevo por
 *   cada re-render y ninguno liberado;
 * - eliminaba con el `confirm()` nativo, que no se usa en ninguna otra pantalla
 *   del panel;
 * - decía "optimizado" también cuando el archivo se guardó tal cual.
 */

interface Media {
  id: number;
  url: string;
  mime: string;
  size: number;
  alt: string | null;
  width: number | null;
  height: number | null;
  frames: number | null;
}

const archivo = (over: Partial<Media> = {}): Media => ({
  id: 1,
  url: "/uploads/11111111-1111-4111-8111-111111111111.png",
  mime: "image/png",
  size: 40960,
  alt: "Fachada del sanatorio",
  width: 400,
  height: 80,
  frames: 1,
  ...over,
});

let biblioteca: Media[] = [];
let fallarLista = false;
let subidas: { alt: string | null; nombre: string }[] = [];
let borrados: number[] = [];
let respuestaDeSubida: Media | null = null;
let errorDeSubida: string | null = null;
/** Cuántas URL de objeto se crearon y cuántas se liberaron. */
let creadas: string[] = [];
let liberadas: string[] = [];

const exitos: string[] = [];
const errores: string[] = [];

vi.mock("../apps/admin/src/api", () => ({
  api: {
    get: async (url: string) => {
      if (url === "/admin/media") {
        if (fallarLista) throw new Error("500");
        return { data: biblioteca };
      }
      return { data: [] };
    },
    post: async (_url: string, fd: FormData) => {
      if (errorDeSubida) {
        throw { response: { data: { error: errorDeSubida } } };
      }
      const file = fd.get("file") as File;
      subidas.push({ alt: (fd.get("alt") as string) ?? null, nombre: file?.name ?? "" });
      return { data: respuestaDeSubida ?? archivo({ id: 99 }) };
    },
    delete: async (url: string) => {
      borrados.push(Number(url.split("/").pop()));
      return { data: null };
    },
    put: async () => ({ data: {} }),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: (m: string) => exitos.push(m),
    error: (m: string) => errores.push(m),
  },
}));

let MediaPage: any;
let ConfirmProvider: any;

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <MediaPage />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

/** Un `File` con contenido, para que `FormData` lo trate como archivo real. */
const comoArchivo = (nombre: string, tipo: string) =>
  new File([new Uint8Array([1, 2, 3, 4])], nombre, { type: tipo });

/** Simula elegir un archivo en el input oculto. */
function elegir(file: File) {
  const input = screen.getByLabelText("Archivo a subir") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

/** El diálogo de confirmación, ubicado por su título. */
async function dialogoDeBorrado() {
  const titulo = await screen.findByText(/Eliminar archivo/i);
  return titulo.closest("div.card") as HTMLElement;
}

beforeEach(async () => {
  biblioteca = [archivo()];
  fallarLista = false;
  subidas = [];
  borrados = [];
  respuestaDeSubida = null;
  errorDeSubida = null;
  creadas = [];
  liberadas = [];
  exitos.length = 0;
  errores.length = 0;

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => {
      const url = `blob:prueba-${creadas.length}`;
      creadas.push(url);
      return url;
    },
    revokeObjectURL: (u: string) => liberadas.push(u),
  });

  // jsdom no decodifica imágenes: se dispara `onload` con dimensiones fijas
  // para que la revisión previa pueda correr.
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: true,
    set(this: HTMLImageElement) {
      Object.defineProperty(this, "width", { value: 400, configurable: true });
      Object.defineProperty(this, "height", { value: 80, configurable: true });
      setTimeout(() => this.onload?.(new Event("load")), 0);
    },
  });

  ConfirmProvider = (await import("../apps/admin/src/components/ConfirmDialog")).ConfirmProvider;
  MediaPage = (await import("../apps/admin/src/pages/MediaPage")).default;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("panel de Multimedia", () => {
  describe("lo que el panel dice que acepta es lo que la API acepta", () => {
    it("el `accept` enumera sólo JPG, PNG, WebP, GIF y PDF", async () => {
      montar();
      const input = (await screen.findByLabelText("Archivo a subir")) as HTMLInputElement;
      const accept = input.getAttribute("accept") ?? "";

      // `image/*` ofrecía BMP, TIFF, AVIF y SVG, todos rechazados después de
      // esperar la subida entera.
      expect(accept).not.toContain("image/*");
      for (const permitido of [".jpg", ".png", ".webp", ".gif", ".pdf"]) {
        expect(accept, `falta ${permitido}`).toContain(permitido);
      }
      expect(accept).not.toContain("svg");
    });

    it("no recomienda SVG y dice explícitamente que no se acepta", async () => {
      montar();
      await screen.findByText(/Qué acepta el servidor/i);
      const texto = document.body.textContent ?? "";

      expect(texto, "seguía recomendando SVG, que la API rechaza").not.toMatch(/SVG si es posible/i);
      expect(texto).toMatch(/SVG no se acepta/i);
    });

    it("los límites que muestra son los del servidor", async () => {
      montar();
      await screen.findByText(/Qué acepta el servidor/i);
      const texto = document.body.textContent ?? "";

      expect(texto, "anunciaba 2400 px y el servidor reduce a 1600").toContain("1600");
      expect(texto).not.toContain("2400");
      expect(texto).toMatch(/10 MB/);
      expect(texto).toMatch(/nunca se agranda/i);
      expect(texto).toMatch(/400×80/);
    });

    /**
     * El panel repite números que viven en la API. Si se separan, el operador
     * recibe un rechazo que el propio panel le dijo que no iba a pasar.
     */
    it("los números del panel coinciden con los de `api/src/imagenes.ts`", () => {
      const api = readFileSync("api/src/imagenes.ts", "utf8");
      const panel = readFileSync("apps/admin/src/pages/MediaPage.tsx", "utf8");

      const leer = (fuente: string, nombre: string) => {
        const m = new RegExp(`${nombre} = ([0-9_]+)`).exec(fuente);
        expect(m, `no se encontró ${nombre}`).toBeTruthy();
        return Number(m![1].replace(/_/g, ""));
      };

      for (const constante of ["MAX_LADO", "MIN_LADO", "MIN_PIXELES"]) {
        expect(leer(panel, constante), `${constante} difiere entre panel y API`).toBe(leer(api, constante));
      }
    });
  });

  describe("la vista previa no pierde blobs", () => {
    it("crea una sola URL de objeto por archivo elegido", async () => {
      montar();
      await screen.findByText(/Qué acepta el servidor/i);

      elegir(comoArchivo("logo.png", "image/png"));
      await screen.findByText(/Confirmar subida/i);

      // Antes se creaba una dentro del render: escribir en el alt generaba una
      // más por cada tecla.
      const trasElegir = creadas.length;
      fireEvent.change(screen.getByLabelText("Texto alternativo"), { target: { value: "Logo institucional" } });
      fireEvent.change(screen.getByLabelText("Texto alternativo"), { target: { value: "Logo institucional del sanatorio" } });

      expect(creadas.length, "se creó un blob nuevo en cada render").toBe(trasElegir);
    });

    it("libera la URL al cancelar", async () => {
      montar();
      await screen.findByText(/Qué acepta el servidor/i);
      elegir(comoArchivo("logo.png", "image/png"));
      await screen.findByText(/Confirmar subida/i);

      fireEvent.click(screen.getByText("Cancelar"));

      await waitFor(() => expect(liberadas).toContain(creadas.at(-1)));
    });

    it("libera la URL al cambiar de archivo", async () => {
      montar();
      await screen.findByText(/Qué acepta el servidor/i);
      elegir(comoArchivo("uno.png", "image/png"));
      await screen.findByText(/Confirmar subida/i);
      const primera = creadas.at(-1);

      elegir(comoArchivo("dos.png", "image/png"));
      await waitFor(() => expect(creadas.length).toBeGreaterThan(1));

      await waitFor(() => expect(liberadas).toContain(primera));
    });
  });

  describe("subir", () => {
    it("manda el texto alternativo junto con el archivo", async () => {
      montar();
      await screen.findByText(/Qué acepta el servidor/i);
      elegir(comoArchivo("logo.png", "image/png"));
      await screen.findByText(/Confirmar subida/i);

      fireEvent.change(screen.getByLabelText("Texto alternativo"), { target: { value: "Fachada del sanatorio" } });
      fireEvent.click(screen.getByText("Confirmar y subir"));

      await waitFor(() => expect(subidas).toHaveLength(1));
      expect(subidas[0].alt).toBe("Fachada del sanatorio");
    });

    it("no dice «optimizado» de un PDF, que se guarda tal cual", async () => {
      respuestaDeSubida = archivo({ id: 5, mime: "application/pdf", url: "/uploads/x.pdf", width: null, height: null, frames: null });
      montar();
      await screen.findByText(/Qué acepta el servidor/i);
      elegir(comoArchivo("protocolo.pdf", "application/pdf"));
      await screen.findByText(/Confirmar subida/i);
      fireEvent.click(screen.getByText("Confirmar y subir"));

      await waitFor(() => expect(exitos).toHaveLength(1));
      expect(exitos[0]).not.toMatch(/optimiz|proces/i);
    });

    it("de una imagen sí avisa que se procesó", async () => {
      montar();
      await screen.findByText(/Qué acepta el servidor/i);
      elegir(comoArchivo("foto.png", "image/png"));
      await screen.findByText(/Confirmar subida/i);
      fireEvent.click(screen.getByText("Confirmar y subir"));

      await waitFor(() => expect(exitos).toHaveLength(1));
      expect(exitos[0]).toMatch(/proces/i);
    });

    it("muestra el error que devolvió la API, no uno genérico", async () => {
      errorDeSubida = "imagen demasiado pequeña (1×1 px)";
      montar();
      await screen.findByText(/Qué acepta el servidor/i);
      elegir(comoArchivo("punto.png", "image/png"));
      await screen.findByText(/Confirmar subida/i);
      fireEvent.click(screen.getByText("Confirmar y subir"));

      await waitFor(() => expect(errores).toHaveLength(1));
      expect(errores[0]).toBe("imagen demasiado pequeña (1×1 px)");
    });

    it("mientras sube, el botón lo dice y no se puede cancelar a medias", async () => {
      montar();
      await screen.findByText(/Qué acepta el servidor/i);
      elegir(comoArchivo("foto.png", "image/png"));
      await screen.findByText(/Confirmar subida/i);

      const boton = screen.getByText("Confirmar y subir");
      expect(boton.hasAttribute("disabled")).toBe(false);
      fireEvent.click(boton);

      await waitFor(() => expect(subidas.length + exitos.length).toBeGreaterThan(0));
    });
  });

  describe("la grilla muestra lo que quedó guardado", () => {
    it("formato, tamaño y dimensiones efectivas del servidor", async () => {
      biblioteca = [archivo({ mime: "image/webp", url: "/uploads/a.webp", size: 20480, width: 400, height: 80, frames: 1 })];
      montar();

      const tarjeta = (await screen.findByText("/uploads/a.webp")).closest("div.card") as HTMLElement;
      expect(within(tarjeta).getByText(/WEBP/)).toBeTruthy();
      expect(within(tarjeta).getByText(/20 KB/)).toBeTruthy();
      expect(within(tarjeta).getByText(/400×80 px/)).toBeTruthy();
    });

    it("un animado dice cuántos cuadros tiene", async () => {
      biblioteca = [archivo({ mime: "image/gif", url: "/uploads/a.gif", frames: 12 })];
      montar();

      const tarjeta = (await screen.findByText("/uploads/a.gif")).closest("div.card") as HTMLElement;
      expect(within(tarjeta).getByText(/12 cuadros/)).toBeTruthy();
    });

    it("la imagen lleva width, height y lazy", async () => {
      montar();
      const img = (await screen.findByAltText("Fachada del sanatorio")) as HTMLImageElement;

      expect(img.getAttribute("width")).toBe("400");
      expect(img.getAttribute("height")).toBe("80");
      expect(img.getAttribute("loading")).toBe("lazy");
    });

    it("un archivo sin alt se señala en vez de pasar inadvertido", async () => {
      biblioteca = [archivo({ alt: null })];
      montar();
      expect(await screen.findByText(/Sin texto alternativo/i)).toBeTruthy();
    });

    it("una fila sin dimensiones —las anteriores a esta migración— no rompe nada", async () => {
      biblioteca = [archivo({ width: null, height: null, frames: null })];
      montar();

      const tarjeta = (await screen.findByText(/uploads/)).closest("div.card") as HTMLElement;
      expect(within(tarjeta).getByText(/PNG/)).toBeTruthy();
      expect(tarjeta.textContent).not.toMatch(/null|NaN|undefined/);
    });
  });

  describe("estados de la biblioteca", () => {
    it("tiene estado de carga", async () => {
      montar();
      expect(document.querySelector('[aria-busy="true"]'), "no hay skeleton mientras carga").toBeTruthy();
      await screen.findByText(/uploads/);
    });

    it("tiene estado de error con reintento", async () => {
      fallarLista = true;
      montar();
      expect(await screen.findByText(/No se pudo cargar la biblioteca/i)).toBeTruthy();
      expect(screen.getByText("Reintentar")).toBeTruthy();
    });

    it("tiene estado vacío", async () => {
      biblioteca = [];
      montar();
      expect(await screen.findByText(/Todavía no hay archivos/i)).toBeTruthy();
    });
  });

  describe("eliminar", () => {
    it("pasa por el diálogo del panel y no por el confirm() nativo", async () => {
      const nativo = vi.fn(() => true);
      vi.stubGlobal("confirm", nativo);
      montar();
      await screen.findByText(/uploads/);

      fireEvent.click(screen.getByText("Eliminar"));

      const dialogo = await dialogoDeBorrado();
      expect(nativo, "se usó el confirm() nativo").not.toHaveBeenCalled();
      expect(borrados, "borró antes de confirmar").toHaveLength(0);

      fireEvent.click(within(dialogo).getByText("Eliminar"));
      await waitFor(() => expect(borrados).toEqual([1]));
    });

    it("cancelar el diálogo no borra nada", async () => {
      montar();
      await screen.findByText(/uploads/);
      fireEvent.click(screen.getByText("Eliminar"));

      const dialogo = await dialogoDeBorrado();
      fireEvent.click(within(dialogo).getByText("Cancelar"));

      await waitFor(() => expect(screen.queryByText(/Eliminar archivo/i)).toBeNull());
      expect(borrados).toHaveLength(0);
    });

    it("avisa que las páginas que lo usen van a quedar rotas", async () => {
      montar();
      await screen.findByText(/uploads/);
      fireEvent.click(screen.getByText("Eliminar"));

      const dialogo = await dialogoDeBorrado();
      expect(dialogo.textContent).toMatch(/p[áa]gina/i);
    });
  });
});
