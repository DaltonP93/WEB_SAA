// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Confirmar el alcance de Biopsias **desde el panel**.
 *
 * El mecanismo llegó como API sola: `PUT /api/admin/data-confirmations/:item`,
 * probado y funcionando, y sin una sola línea en el panel que lo usara. La guía
 * de carga terminaba explicándole a un administrador de sanatorio cómo mandar
 * un `PUT` con curl. Una función que sólo se puede ejercer desde una terminal
 * no está entregada, y eso no lo detecta ninguna prueba de API.
 *
 * Lo que se comprueba acá sólo existe en el DOM:
 *
 * 1. Que el formulario aparezca **para quien puede usarlo** y no para quien
 *    va a recibir un 403.
 * 2. Que lo que se manda sea lo que la API acepta —y **sólo** eso: la fecha y
 *    el autor los pone el servidor.
 * 3. Que un rechazo del servidor se **vea**. Una mutación sin `onError` deja al
 *    operador apretando un botón que no hace nada.
 * 4. Que no se ofrezca confirmar cuando no hay nada que confirmar.
 */

interface Llamada {
  metodo: string;
  url: string;
  cuerpo?: unknown;
}

const llamadas: Llamada[] = [];
const respuestas: Record<string, unknown> = {};
/** Errores a devolver por método+url, para probar los rechazos del servidor. */
const errores: Record<string, { status: number; error: string }> = {};

function quizasFallar(clave: string) {
  const e = errores[clave];
  if (!e) return;
  throw Object.assign(new Error(String(e.status)), {
    response: { status: e.status, data: { error: e.error } },
  });
}

vi.mock("../apps/admin/src/api", () => ({
  api: {
    get: async (url: string) => {
      llamadas.push({ metodo: "GET", url });
      quizasFallar(`GET ${url}`);
      return { data: respuestas[url] ?? [] };
    },
    post: async (url: string, cuerpo?: unknown) => {
      llamadas.push({ metodo: "POST", url, cuerpo });
      quizasFallar(`POST ${url}`);
      return { data: {} };
    },
    put: async (url: string, cuerpo?: unknown) => {
      llamadas.push({ metodo: "PUT", url, cuerpo });
      quizasFallar(`PUT ${url}`);
      return { data: {} };
    },
    delete: async (url: string) => {
      llamadas.push({ metodo: "DELETE", url });
      quizasFallar(`DELETE ${url}`);
      return { data: null };
    },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("react-hot-toast", () => ({
  default: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

let DataReadinessPage: any;
let ConfirmProvider: any;
let MemoryRouter: any;

const ALCANCE =
  "Biopsias de piel y mucosa oral, con derivación externa y entrega en 10 días hábiles.";

/** La respuesta real del endpoint, con la sección de Biopsias parametrizable. */
const readiness = (biopsias: Record<string, unknown>) => ({
  overall: "review",
  summary: { resolved: 3, pending: 11, review: 2, total: 16 },
  sections: [
    {
      id: "biopsias",
      label: "Alcance de Biopsias",
      status: "review",
      route: "/pages/12",
      pageSlug: "estudios-biopsias",
      reason: "Requiere confirmación escrita del sanatorio sobre alcance, requisitos y plazos.",
      confirmable: true,
      confirmation: null,
      ...biopsias,
    },
  ],
  warnings: [],
});

const confirmada = {
  confirmedAt: "2026-08-20T13:45:00.000Z",
  confirmedBy: { id: 1, name: "Dirección Médica" },
  scope: ALCANCE,
  note: null,
};

function comoRol(role: "superadmin" | "editor") {
  respuestas["/auth/me"] = { user: { id: 7, email: "x@y.test", name: "Quien Sea", role } };
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // La pantalla usa `<Link>`: sin contexto de router, react-router revienta al
  // renderizar y el fallo no dice nada sobre lo que se está probando.
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConfirmProvider>
          <DataReadinessPage />
        </ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** El bloque de la sección de Biopsias, ya cargado. */
async function seccion() {
  const titulo = await screen.findByText("Alcance de Biopsias");
  return titulo.closest("section") as HTMLElement;
}

beforeEach(async () => {
  llamadas.length = 0;
  for (const k of Object.keys(errores)) delete errores[k];
  toastError.mockClear();
  toastSuccess.mockClear();
  comoRol("superadmin");
  respuestas["/admin/data-readiness"] = readiness({});

  DataReadinessPage = (await import("../apps/admin/src/pages/DataReadinessPage")).default;
  ConfirmProvider = (await import("../apps/admin/src/components/ConfirmDialog")).ConfirmProvider;
  MemoryRouter = (await import("react-router-dom")).MemoryRouter;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("confirmar el alcance de Biopsias desde el panel", () => {
  describe("quién ve el formulario", () => {
    it("un superadmin puede registrar la confirmación", async () => {
      montar();
      const s = await seccion();
      expect(await within(s).findByText("Registrar confirmación")).toBeTruthy();
    });

    it("un editor ve el estado y quién puede confirmarlo, no el formulario", async () => {
      comoRol("editor");
      montar();
      const s = await seccion();

      await waitFor(() => expect(within(s).queryByText(/Sólo un usuario con rol/i)).toBeTruthy());
      // Ofrecerle el formulario sería invitarlo a escribir el alcance entero
      // para recibir un 403 al guardar.
      expect(
        within(s).queryByText("Registrar confirmación"),
        "se le ofreció confirmar a quien no puede",
      ).toBeNull();
      expect(within(s).getByText(/superadmin/i)).toBeTruthy();
    });

    it("mientras no se sabe el rol no se ofrece la acción", async () => {
      // Ante la duda no se ofrece: mostrar el botón y que el servidor conteste
      // 403 es peor que no mostrarlo, porque el operador ya escribió el texto.
      errores["GET /auth/me"] = { status: 500, error: "x" };
      montar();
      const s = await seccion();

      await waitFor(() => expect(within(s).queryByText(/Requiere confirmación escrita/i)).toBeTruthy());
      expect(within(s).queryByText("Registrar confirmación")).toBeNull();
    });
  });

  describe("qué se manda", () => {
    async function abrirFormulario() {
      montar();
      const s = await seccion();
      fireEvent.click(await within(s).findByText("Registrar confirmación"));
      return s;
    }

    it("no se puede confirmar sin escribir un alcance suficiente", async () => {
      const s = await abrirFormulario();
      const boton = within(s).getByText("Confirmar") as HTMLButtonElement;

      // El mismo mínimo que aplica la API: si el botón estuviera habilitado, el
      // servidor contestaría 400 y el operador no sabría qué le faltó.
      expect(boton.disabled, "se podía confirmar sin alcance").toBe(true);

      fireEvent.change(within(s).getByLabelText("Qué se confirma"), { target: { value: "corto" } });
      expect(boton.disabled, "se aceptó un alcance de 5 caracteres").toBe(true);

      fireEvent.change(within(s).getByLabelText("Qué se confirma"), { target: { value: ALCANCE } });
      expect(boton.disabled).toBe(false);
    });

    it("manda el alcance, y no manda la fecha ni el autor", async () => {
      const s = await abrirFormulario();
      fireEvent.change(within(s).getByLabelText("Qué se confirma"), { target: { value: ALCANCE } });
      fireEvent.click(within(s).getByText("Confirmar"));

      const put = await waitFor(() => {
        const l = llamadas.find((c) => c.metodo === "PUT");
        expect(l, "no se llamó al endpoint de confirmaciones").toBeTruthy();
        return l!;
      });

      expect(put.url).toBe("/admin/data-confirmations/biopsias");
      expect(put.cuerpo).toEqual({ scope: ALCANCE });
      // Si el panel los mandara, quien confirma podría fechar su propia
      // confirmación y atribuirla a otro. La API los ignora; el panel tampoco
      // los inventa.
      expect(Object.keys(put.cuerpo as object)).not.toContain("confirmedAt");
      expect(Object.keys(put.cuerpo as object)).not.toContain("confirmedBy");
    });

    it("la nota viaja sólo si se escribió", async () => {
      const s = await abrirFormulario();
      fireEvent.change(within(s).getByLabelText("Qué se confirma"), { target: { value: ALCANCE } });
      fireEvent.change(within(s).getByLabelText("Nota interna (opcional)"), {
        target: { value: "Acta de dirección del 12/08" },
      });
      fireEvent.click(within(s).getByText("Confirmar"));

      const put = await waitFor(() => {
        const l = llamadas.find((c) => c.metodo === "PUT");
        expect(l).toBeTruthy();
        return l!;
      });
      expect(put.cuerpo).toEqual({ scope: ALCANCE, note: "Acta de dirección del 12/08" });
    });

    it("un rechazo del servidor se ve, no se traga", async () => {
      errores["PUT /admin/data-confirmations/biopsias"] = {
        status: 400,
        error: "payload invalido",
      };
      const s = await abrirFormulario();
      fireEvent.change(within(s).getByLabelText("Qué se confirma"), { target: { value: ALCANCE } });
      fireEvent.click(within(s).getByText("Confirmar"));

      // Sin `onError` el rechazo desaparece y el operador vuelve a apretar el
      // mismo botón esperando otro resultado.
      await waitFor(() => expect(toastError).toHaveBeenCalledWith("payload invalido"));
      expect(toastSuccess, "se avisó de un éxito que no ocurrió").not.toHaveBeenCalled();
    });
  });

  describe("cuando ya está confirmado", () => {
    beforeEach(() => {
      respuestas["/admin/data-readiness"] = readiness({
        status: "complete",
        confirmation: confirmada,
      });
    });

    it("muestra quién, cuándo y qué se confirmó", async () => {
      montar();
      const s = await seccion();

      expect(await within(s).findByText(/Dirección Médica/)).toBeTruthy();
      // Lo que de verdad importa: sin el alcance, la constancia no dice qué se
      // afirmó y no le sirve a quien la revise después.
      expect(within(s).getByText(ALCANCE), "no se muestra qué se confirmó").toBeTruthy();
      expect(within(s).getByText(/Alcance confirmado/i)).toBeTruthy();
    });

    it("la fecha se muestra en palabras, no como ISO crudo", async () => {
      montar();
      const s = await seccion();
      await within(s).findByText(/Dirección Médica/);

      expect(s.textContent, "quedó el ISO sin formatear").not.toContain("2026-08-20T13:45");
      expect(s.textContent).toMatch(/2026/);
    });

    it("un superadmin puede retirarla, y se le avisa qué implica", async () => {
      montar();
      const s = await seccion();
      fireEvent.click(await within(s).findByText("Retirar confirmación"));

      // Pasa por el diálogo del proyecto, no por el `confirm()` del navegador.
      const dialogo = await screen.findByText(/Retirar la confirmación/i);
      expect(dialogo).toBeTruthy();
      expect(document.body.textContent).toMatch(/vuelve a figurar como pendiente/i);

      fireEvent.click(screen.getByText("Retirar"));
      await waitFor(() =>
        expect(llamadas.some((c) => c.metodo === "DELETE")).toBe(true),
      );
    });

    it("un editor no puede retirarla", async () => {
      comoRol("editor");
      montar();
      const s = await seccion();

      await within(s).findByText(/Dirección Médica/);
      expect(within(s).queryByText("Retirar confirmación")).toBeNull();
    });
  });

  describe("cuando no hay nada que confirmar", () => {
    it("sin la página, no se ofrece confirmar: se explica el problema mayor", async () => {
      respuestas["/admin/data-readiness"] = readiness({
        confirmable: false,
        reason: "No existe la página de Biopsias en el sitio. Revisá el listado de Páginas.",
      });
      montar();
      const s = await seccion();

      expect(await within(s).findByText(/No existe la página de Biopsias/)).toBeTruthy();
      // El endpoint de confirmaciones aceptaría el PUT igual —no mira páginas—,
      // así que el panel guardaría con éxito y el ítem seguiría en `review`. Un
      // éxito que no cambia nada es peor que un botón ausente.
      expect(
        within(s).queryByText("Registrar confirmación"),
        "se ofreció confirmar una página que no existe",
      ).toBeNull();
    });
  });
});
