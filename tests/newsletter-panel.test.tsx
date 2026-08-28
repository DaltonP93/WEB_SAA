// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La bandeja de Newsletter en el panel: carga, error con reintento, búsqueda,
 * paginación, exportación y baja. Todo lo que una respuesta de API no prueba del
 * lado de la pantalla.
 */

interface Llamada { metodo: string; url: string; cuerpo?: any }
const llamadas: Llamada[] = [];
let fixture: any[] = [];
let getError = false;
let deferred: { promise: Promise<void>; release: () => void } | null = null;

function parse(url: string) {
  const qs = new URLSearchParams(url.split("?")[1] ?? "");
  return { q: qs.get("q") ?? "", limit: Number(qs.get("limit") ?? 20), offset: Number(qs.get("offset") ?? 0) };
}

vi.mock("../apps/admin/src/api", () => ({
  api: {
    get: async (url: string) => {
      llamadas.push({ metodo: "GET", url });
      if (url.startsWith("/admin/newsletter/export")) return { data: "Fecha,Email,Estado\r\n" };
      if (deferred) await deferred.promise;
      if (getError) throw Object.assign(new Error("500"), { response: { status: 500, data: { error: "boom" } } });
      const { q, limit, offset } = parse(url);
      const filtrados = q ? fixture.filter((s) => s.email.includes(q)) : fixture;
      return { data: { items: filtrados.slice(offset, offset + limit), total: filtrados.length, limit, offset } };
    },
    put: async (url: string, cuerpo?: any) => { llamadas.push({ metodo: "PUT", url, cuerpo }); return { data: {} }; },
    delete: async (url: string) => { llamadas.push({ metodo: "DELETE", url }); return { data: null }; },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("react-hot-toast", () => ({
  default: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

let NewsletterPage: any;
let ConfirmProvider: any;

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <NewsletterPage />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}
const boton = (t: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === t) as HTMLButtonElement;

beforeEach(async () => {
  llamadas.length = 0;
  getError = false;
  deferred = null;
  toastError.mockClear();
  toastSuccess.mockClear();
  fixture = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    email: `sub${String(i).padStart(2, "0")}@ejemplo.test`,
    source: "/",
    active: i !== 0, // el primero está de baja
    consent_at: "2026-08-27T00:00:00Z",
    consent_version: "1",
    created_at: "2026-08-27T00:00:00Z",
    attribution: null,
  }));
  NewsletterPage = (await import("../apps/admin/src/pages/NewsletterPage")).default;
  ConfirmProvider = (await import("../apps/admin/src/components/ConfirmDialog")).ConfirmProvider;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("bandeja Newsletter", () => {
  it("muestra el estado de carga y luego la lista", async () => {
    let release!: () => void;
    deferred = { promise: new Promise<void>((r) => (release = r)), release: () => {} };
    montar();
    expect(screen.getByText("Cargando…")).toBeTruthy();
    deferred = null;
    release();
    await screen.findByText("sub00@ejemplo.test");
  });

  it("muestra error con reintento y se recupera", async () => {
    getError = true;
    montar();
    await screen.findByText(/No se pudo cargar/i);
    getError = false;
    fireEvent.click(boton("Reintentar"));
    await screen.findByText("sub00@ejemplo.test");
  });

  it("pagina: primera página 20, Siguiente pide el offset 20", async () => {
    montar();
    await screen.findByText("sub00@ejemplo.test");
    // 20 filas en la primera página (no aparece la 21).
    expect(screen.queryByText("sub20@ejemplo.test")).toBeNull();
    fireEvent.click(boton("Siguiente"));
    await screen.findByText("sub20@ejemplo.test");
    expect(llamadas.some((l) => l.metodo === "GET" && l.url.includes("offset=20"))).toBe(true);
  });

  it("busca por email (llama a la API con q y filtra)", async () => {
    montar();
    await screen.findByText("sub00@ejemplo.test");
    fireEvent.change(screen.getByLabelText("Buscar por email"), { target: { value: "sub07@ejemplo.test" } });
    await waitFor(() => expect(llamadas.some((l) => l.url.includes("q=sub07"))).toBe(true));
    await screen.findByText("sub07@ejemplo.test");
  });

  it("exporta el CSV (pide el endpoint de export)", async () => {
    (URL as any).createObjectURL = vi.fn(() => "blob:x");
    (URL as any).revokeObjectURL = vi.fn();
    montar();
    await screen.findByText("sub00@ejemplo.test");
    fireEvent.click(boton("Exportar CSV"));
    await waitFor(() => expect(llamadas.some((l) => l.url.startsWith("/admin/newsletter/export"))).toBe(true));
  });

  it("da de baja un suscriptor activo (PUT active:false, sin borrar)", async () => {
    montar();
    const fila = (await screen.findByText("sub01@ejemplo.test")).closest("div.p-4") as HTMLElement;
    fireEvent.click(Array.from(fila.querySelectorAll("button")).find((b) => b.textContent === "Dar de baja")!);
    await waitFor(() => {
      const put = llamadas.find((l) => l.metodo === "PUT" && l.url === "/admin/newsletter/2");
      expect(put).toBeTruthy();
      expect(put!.cuerpo.active).toBe(false);
    });
    expect(llamadas.some((l) => l.metodo === "DELETE")).toBe(false);
  });
});
