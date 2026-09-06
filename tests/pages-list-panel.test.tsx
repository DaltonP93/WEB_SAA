// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La lista de Páginas: publicación programada desde el panel.
 *
 * Lo que una prueba de API no ve: que el panel distingue Borrador / Publicada /
 * Programada, que "Programar" desde un borrador publica y agenda en una sola
 * acción, y que una fecha pasada se rechaza con un aviso (programar es a futuro).
 */

interface Llamada { metodo: string; url: string; cuerpo?: any }
const llamadas: Llamada[] = [];
const respuestas: Record<string, unknown> = {};

vi.mock("../apps/admin/src/api", () => ({
  api: {
    get: async (url: string) => { llamadas.push({ metodo: "GET", url }); return { data: respuestas[url] ?? [] }; },
    put: async (url: string, cuerpo?: any) => { llamadas.push({ metodo: "PUT", url, cuerpo }); return { data: {} }; },
    post: async (url: string, cuerpo?: any) => {
      llamadas.push({ metodo: "POST", url, cuerpo });
      // Simula el contrato del backend `/schedule`: la decisión de "fecha futura"
      // vive en el servidor (zona Asunción). Se rechaza el pasado de forma
      // determinística por el año, sin depender del reloj ni de la zona del navegador.
      if (url.endsWith("/schedule")) {
        const anio = Number(String(cuerpo?.publish_at ?? "").slice(0, 4));
        if (!anio || anio <= 2025) {
          throw Object.assign(new Error("400"), {
            response: { status: 400, data: { error: "La fecha de publicación tiene que ser futura. Para publicar ya, usá “Publicar”." } },
          });
        }
      }
      return { data: {} };
    },
    delete: async (url: string) => { llamadas.push({ metodo: "DELETE", url }); return { data: null }; },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("react-hot-toast", () => ({
  default: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

let PagesListPage: any;
let ConfirmProvider: any;

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <MemoryRouter>
          <PagesListPage />
        </MemoryRouter>
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

const filaDe = async (titulo: string): Promise<HTMLElement> => {
  const t = await screen.findByText(titulo);
  return t.closest("div.p-4") as HTMLElement;
};

beforeEach(async () => {
  llamadas.length = 0;
  toastError.mockClear();
  toastSuccess.mockClear();
  respuestas["/admin/pages"] = [
    { id: 1, slug: "borrador", title: "En borrador", status: "draft", order: 0, publish_at: null },
    { id: 2, slug: "publicada", title: "Ya publicada", status: "published", order: 1, publish_at: null },
    { id: 3, slug: "agendada", title: "A futuro", status: "published", order: 2, publish_at: "2099-01-01T00:00:00Z" },
    { id: 4, slug: "revision", title: "Mandada a revisión", status: "in_review", order: 3, publish_at: null },
    { id: 5, slug: "aprobada", title: "Lista aprobada", status: "approved", order: 4, publish_at: null },
    { id: 6, slug: "archivada", title: "Vieja archivada", status: "archived", order: 5, publish_at: null },
  ];
  // Sesión con todas las capacidades de contenido: así se ven todas las acciones.
  // Un caso aparte prueba el gateo con un autor (sin content.publish).
  respuestas["/auth/me"] = {
    user: {
      id: 1,
      email: "admin@sanatorio.local",
      name: "Admin",
      role: "editor",
      capabilities: ["content.read", "content.write", "content.publish", "content.delete", "leads.read", "leads.write", "settings.read", "settings.write"],
    },
  };
  PagesListPage = (await import("../apps/admin/src/pages/PagesListPage")).default;
  ConfirmProvider = (await import("../apps/admin/src/components/ConfirmDialog")).ConfirmProvider;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Páginas · publicación programada", () => {
  it("distingue Borrador, Publicada y Programada", async () => {
    montar();
    expect(within(await filaDe("En borrador")).getByText("Borrador")).toBeTruthy();
    expect(within(await filaDe("Ya publicada")).getByText("Publicada")).toBeTruthy();
    expect(within(await filaDe("A futuro")).getByText("Programada")).toBeTruthy();
  });

  it("programar un borrador manda la hora de pared cruda al endpoint del backend", async () => {
    montar();
    const fila = await filaDe("En borrador");
    fireEvent.click(within(fila).getByText("Programar"));
    const input = fila.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2099-01-01T10:00" } });

    const submit = Array.from(fila.querySelectorAll("button")).find(
      (b) => b.textContent === "Programar" && b.className.includes("btn-primary"),
    )!;
    fireEvent.click(submit);

    await waitFor(() => {
      const post = llamadas.find((l) => l.metodo === "POST" && l.url === "/admin/pages/1/schedule");
      expect(post, "tuvo que llamar al endpoint /schedule").toBeTruthy();
      // Manda la hora de pared TAL CUAL: no la convierte con la zona del navegador.
      // La interpretación en zona Asunción y la decisión de "futura" son del backend.
      expect(post!.cuerpo.publish_at).toBe("2099-01-01T10:00");
    });
    // No usa el PUT genérico para programar.
    expect(llamadas.some((l) => l.metodo === "PUT")).toBe(false);
  });

  it("una fecha pasada la rechaza el backend (zona Asunción) y se muestra el aviso", async () => {
    montar();
    const fila = await filaDe("En borrador");
    fireEvent.click(within(fila).getByText("Programar"));
    const input = fila.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2000-01-01T10:00" } });

    const submit = Array.from(fila.querySelectorAll("button")).find(
      (b) => b.textContent === "Programar" && b.className.includes("btn-primary"),
    )!;
    fireEvent.click(submit);

    // El cliente igual manda la hora cruda; es el backend el que decide y rechaza.
    await waitFor(() => {
      const post = llamadas.find((l) => l.metodo === "POST" && l.url === "/admin/pages/1/schedule");
      expect(post).toBeTruthy();
      expect(post!.cuerpo.publish_at).toBe("2000-01-01T10:00");
    });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/futura/i);
  });

  it("Publicar un borrador lo publica y limpia la programación (publish_at NULL)", async () => {
    montar();
    const fila = await filaDe("En borrador");
    fireEvent.click(within(fila).getByText("Publicar"));
    await waitFor(() => {
      const put = llamadas.find((l) => l.metodo === "PUT" && l.url === "/admin/pages/1");
      expect(put).toBeTruthy();
      expect(put!.cuerpo.status).toBe("published");
      expect(put!.cuerpo.publish_at).toBeNull();
    });
  });

  it("Despublicar una publicada la pasa a borrador y limpia la programación", async () => {
    montar();
    const fila = await filaDe("Ya publicada");
    fireEvent.click(within(fila).getByText("Despublicar"));
    await waitFor(() => {
      const put = llamadas.find((l) => l.metodo === "PUT" && l.url === "/admin/pages/2");
      expect(put).toBeTruthy();
      expect(put!.cuerpo.status).toBe("draft");
      expect(put!.cuerpo.publish_at).toBeNull();
    });
  });

  it("Quitar programación deja la página publicada ya (publish_at NULL, sin tocar el status)", async () => {
    montar();
    const fila = await filaDe("A futuro"); // programada (published + publish_at futuro)
    fireEvent.click(within(fila).getByText("Programar")); // abre el panel con "Quitar programación"
    fireEvent.click(within(fila).getByText("Quitar programación"));
    await waitFor(() => {
      const put = llamadas.find((l) => l.metodo === "PUT" && l.url === "/admin/pages/3");
      expect(put).toBeTruthy();
      expect(put!.cuerpo.publish_at).toBeNull();
      expect(put!.cuerpo.status).toBeUndefined(); // no cambia el estado
    });
  });
});

describe("Páginas · flujo editorial", () => {
  it("muestra los estados del flujo (En revisión, Aprobado, Archivada)", async () => {
    montar();
    expect(within(await filaDe("Mandada a revisión")).getByText("En revisión")).toBeTruthy();
    expect(within(await filaDe("Lista aprobada")).getByText("Aprobado")).toBeTruthy();
    expect(within(await filaDe("Vieja archivada")).getByText("Archivada")).toBeTruthy();
  });

  it("un borrador se envía a revisión por el endpoint /submit", async () => {
    montar();
    fireEvent.click(within(await filaDe("En borrador")).getByText("Enviar a revisión"));
    await waitFor(() =>
      expect(llamadas.find((l) => l.metodo === "POST" && l.url === "/admin/pages/1/submit")).toBeTruthy(),
    );
  });

  it("una página en revisión se aprueba (/approve) y se puede volver a borrador (/return)", async () => {
    montar();
    const fila = await filaDe("Mandada a revisión");
    fireEvent.click(within(fila).getByText("Aprobar"));
    await waitFor(() =>
      expect(llamadas.find((l) => l.metodo === "POST" && l.url === "/admin/pages/4/approve")).toBeTruthy(),
    );
    fireEvent.click(within(fila).getByText("Volver a borrador"));
    await waitFor(() =>
      expect(llamadas.find((l) => l.metodo === "POST" && l.url === "/admin/pages/4/return")).toBeTruthy(),
    );
  });

  it("una aprobada se publica (/publish); una archivada se desarchiva (/unarchive)", async () => {
    montar();
    fireEvent.click(within(await filaDe("Lista aprobada")).getByText("Publicar"));
    await waitFor(() =>
      expect(llamadas.find((l) => l.metodo === "POST" && l.url === "/admin/pages/5/publish")).toBeTruthy(),
    );
    fireEvent.click(within(await filaDe("Vieja archivada")).getByText("Desarchivar"));
    await waitFor(() =>
      expect(llamadas.find((l) => l.metodo === "POST" && l.url === "/admin/pages/6/unarchive")).toBeTruthy(),
    );
  });

  it("una publicada ofrece Archivar (/archive)", async () => {
    montar();
    fireEvent.click(within(await filaDe("Ya publicada")).getByText("Archivar"));
    await waitFor(() =>
      expect(llamadas.find((l) => l.metodo === "POST" && l.url === "/admin/pages/2/archive")).toBeTruthy(),
    );
  });

  it("un autor (sin content.publish) ve 'Enviar a revisión' pero no 'Publicar' ni 'Aprobar'", async () => {
    respuestas["/auth/me"] = {
      user: { id: 9, email: "autor@sanatorio.local", name: "Autor", role: "autor", capabilities: ["content.read", "content.write"] },
    };
    montar();
    const borrador = await filaDe("En borrador");
    expect(within(borrador).getByText("Enviar a revisión")).toBeTruthy();
    expect(within(borrador).queryByText("Publicar")).toBeNull();
    expect(within(borrador).queryByText("Programar")).toBeNull(); // programar exige content.publish
    expect(within(borrador).queryByText("Eliminar")).toBeNull(); // eliminar exige content.delete

    const revision = await filaDe("Mandada a revisión");
    expect(within(revision).queryByText("Aprobar")).toBeNull();
    // Pero sí puede retirar su envío (content.write).
    expect(within(revision).getByText("Volver a borrador")).toBeTruthy();
  });
});
