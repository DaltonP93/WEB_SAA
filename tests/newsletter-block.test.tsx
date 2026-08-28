// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El bloque público Newsletter.
 *
 * Lo que una prueba de API no ve: que dos bloques en la misma página no comparten
 * el id del input (usa `useId()`), y que un envío que falla muestra error y deja
 * reintentar hasta que sale bien.
 */

const post = vi.fn();
vi.mock("../apps/web/src/api", () => ({ api: { post: (...a: any[]) => post(...a) } }));
vi.mock("../apps/web/src/lib/attribution", () => ({ obtenerAtribucion: () => null }));

let Newsletter: any;

beforeEach(async () => {
  post.mockReset();
  Newsletter = (await import("../apps/web/src/blocks/Newsletter")).default;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("bloque Newsletter", () => {
  it("dos bloques en la misma página tienen inputs con id distinto", async () => {
    render(
      <>
        <Newsletter heading="Uno" />
        <Newsletter heading="Dos" />
      </>,
    );
    const inputs = Array.from(document.querySelectorAll('input[type="email"]')) as HTMLInputElement[];
    expect(inputs.length).toBe(2);
    expect(inputs[0].id).toBeTruthy();
    expect(inputs[0].id).not.toBe(inputs[1].id);
  });

  it("muestra error y permite reintentar hasta que el envío sale bien", async () => {
    post.mockRejectedValueOnce(new Error("red caída")).mockResolvedValueOnce({ data: { ok: true } });
    render(<Newsletter heading="Novedades" />);

    const input = document.querySelector('input[type="email"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "persona@ejemplo.test" } });
    fireEvent.submit(input.closest("form")!);

    // Falló: aparece el error y el botón invita a reintentar.
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button").textContent).toMatch(/Reintentar/i));

    // Reintento exitoso: mensaje de solicitud registrada (sin prometer envío auto).
    fireEvent.submit(input.closest("form")!);
    const ok = await screen.findByText(/Registramos tu solicitud/i);
    expect(ok).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(2);
  });
});
