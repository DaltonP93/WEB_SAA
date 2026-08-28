// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El Page Builder: restauración segura y guardado atómico, del lado del panel.
 *
 * Lo que una prueba de API no puede ver: que restaurar avisa antes de descartar
 * cambios sin guardar, que los botones se bloquean mientras hay una operación en
 * curso, y que un guardado que la API rechaza (por ejemplo, la página se movió a
 * la papelera en otra pestaña) muestra un error accionable en vez de un clic
 * que no hace nada.
 */

interface Llamada {
  metodo: string;
  url: string;
  cuerpo?: unknown;
}
const llamadas: Llamada[] = [];
const respuestas: Record<string, unknown> = {};
const errores: Record<string, { status: number; error: string }> = {};
// Promesas que el test resuelve a mano, para simular respuestas diferidas.
const diferidos: Record<string, { promise: Promise<void>; release: () => void }> = {};

function diferir(clave: string) {
  let release!: () => void;
  const promise = new Promise<void>((res) => (release = res));
  diferidos[clave] = { promise, release };
}
async function quizasEsperar(clave: string) {
  if (diferidos[clave]) await diferidos[clave].promise;
}
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
      await quizasEsperar(`POST ${url}`);
      quizasFallar(`POST ${url}`);
      return { data: {} };
    },
    put: async (url: string, cuerpo?: unknown) => {
      llamadas.push({ metodo: "PUT", url, cuerpo });
      await quizasEsperar(`PUT ${url}`);
      quizasFallar(`PUT ${url}`);
      return { data: {} };
    },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("react-hot-toast", () => ({
  default: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

let PageBuilderPage: any;
let ConfirmProvider: any;

function paginaBase() {
  respuestas["/admin/pages/5"] = {
    id: 5,
    slug: "sobre-nosotros",
    title: "Original",
    status: "draft",
    seo: { title: "", description: "" },
    blocks: [{ id: 1, type: "spacer", order: 0, props: { height: 20 } }],
  };
  respuestas["/admin/pages/5/revisions"] = [
    { id: 9, created_at: "2026-08-27T00:00:00Z", author: "Admin", title: "Vieja", blockCount: 1 },
  ];
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Router de datos (createMemoryRouter): `useUnsavedGuard` usa `useBlocker`,
  // que sólo existe en un data router —igual que en el admin real.
  const router = createMemoryRouter([{ path: "/pages/:id", element: <PageBuilderPage /> }], {
    initialEntries: ["/pages/5"],
  });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

const boton = (texto: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === texto) as HTMLButtonElement;

async function abrirHistorial() {
  fireEvent.click(boton("Historial"));
  await screen.findByText("Historial de versiones");
  // Esperar a que la lista de versiones cargue y aparezca su botón Restaurar.
  await waitFor(() => expect(boton("Restaurar")).toBeTruthy());
}

beforeEach(async () => {
  llamadas.length = 0;
  for (const k of Object.keys(errores)) delete errores[k];
  for (const k of Object.keys(diferidos)) delete diferidos[k];
  toastError.mockClear();
  toastSuccess.mockClear();
  paginaBase();
  PageBuilderPage = (await import("../apps/admin/src/pages/PageBuilderPage")).default;
  ConfirmProvider = (await import("../apps/admin/src/components/ConfirmDialog")).ConfirmProvider;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Page Builder · restauración segura", () => {
  it("avisa que se descartan los cambios sin guardar antes de restaurar", async () => {
    montar();
    const titulo = (await screen.findByDisplayValue("Original")) as HTMLInputElement;
    // Cambio local sin guardar.
    fireEvent.change(titulo, { target: { value: "Editado sin guardar" } });

    await abrirHistorial();
    fireEvent.click(boton("Restaurar"));

    // El diálogo advierte explícitamente el descarte.
    const aviso = await screen.findByText(/cambios sin guardar/i);
    expect(aviso.textContent).toMatch(/descartar/i);

    // Confirmar dispara el POST de restauración.
    const dialogo = (await screen.findByText("Restaurar versión")).parentElement as HTMLElement;
    fireEvent.click(Array.from(dialogo.querySelectorAll("button")).find((b) => b.textContent === "Restaurar")!);

    await waitFor(() =>
      expect(llamadas.some((l) => l.metodo === "POST" && l.url === "/admin/pages/5/revisions/9/restore")).toBe(true),
    );
    // Tras restaurar se refresca la página (segundo GET) y se limpia el estado.
    await waitFor(() =>
      expect(llamadas.filter((l) => l.metodo === "GET" && l.url === "/admin/pages/5").length).toBeGreaterThanOrEqual(2),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("bloquea Guardar y Restaurar mientras la restauración está en curso (respuesta diferida)", async () => {
    diferir("POST /admin/pages/5/revisions/9/restore");
    montar();
    await screen.findByDisplayValue("Original");
    await abrirHistorial();

    fireEvent.click(boton("Restaurar"));
    // Sin cambios locales: el diálogo pide confirmar igual.
    const dialogo = (await screen.findByText("Restaurar versión")).parentElement as HTMLElement;
    fireEvent.click(Array.from(dialogo.querySelectorAll("button")).find((b) => b.textContent === "Restaurar")!);

    // Con la respuesta aún pendiente, los dos botones quedan deshabilitados.
    await waitFor(() => expect(boton("Guardar").disabled).toBe(true));
    expect(boton("Restaurar").disabled).toBe(true);

    // Al liberar la respuesta, se rehabilitan.
    diferidos["POST /admin/pages/5/revisions/9/restore"].release();
    await waitFor(() => expect(boton("Guardar").disabled).toBe(false));
  });

  it("un guardado rechazado (página en la papelera) muestra un error accionable", async () => {
    errores["PUT /admin/pages/5/content"] = { status: 404, error: "no encontrada" };
    montar();
    await screen.findByDisplayValue("Original");

    fireEvent.click(boton("Guardar"));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("no encontrada"));
    // El botón vuelve a estar disponible para reintentar.
    await waitFor(() => expect(boton("Guardar").disabled).toBe(false));
    // Guardó por el endpoint atómico, no en dos llamadas separadas.
    expect(llamadas.some((l) => l.url === "/admin/pages/5/content")).toBe(true);
    expect(llamadas.some((l) => l.url === "/admin/pages/5" && l.metodo === "PUT")).toBe(false);
  });
});
