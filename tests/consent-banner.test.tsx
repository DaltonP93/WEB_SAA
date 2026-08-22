// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ConsentBanner from "../apps/web/src/components/ConsentBanner";
import { leerConsentimiento } from "../apps/web/src/lib/consent";

/**
 * El aviso de consentimiento, que gobierna si la medición carga.
 *
 * Lo que se prueba sólo se ve en el DOM y en `localStorage`:
 *
 * - aparece mientras no hay decisión y desaparece cuando la hay;
 * - "Rechazar" existe y tiene el mismo peso que "Aceptar" (sin patrón oscuro);
 * - la decisión persiste, y `false` (rechazó) no reabre el aviso.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ConsentBanner", () => {
  it("aparece cuando no hay decisión, con las dos opciones", () => {
    render(<ConsentBanner />);
    const aceptar = screen.getByText("Aceptar");
    const rechazar = screen.getByText("Rechazar");
    expect(aceptar).toBeTruthy();
    // Rechazar no es un enlace escondido: es un botón, igual que aceptar.
    expect(rechazar.tagName).toBe("BUTTON");
    expect(aceptar.tagName).toBe("BUTTON");
  });

  it("aceptar guarda analytics=true y cierra el aviso", () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByText("Aceptar"));

    expect(leerConsentimiento()?.analytics).toBe(true);
    expect(screen.queryByText("Aceptar"), "el aviso siguió visible tras decidir").toBeNull();
  });

  it("rechazar guarda analytics=false y cierra el aviso", () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByText("Rechazar"));

    expect(leerConsentimiento()?.analytics).toBe(false);
    expect(screen.queryByText("Rechazar")).toBeNull();
  });

  it("no reaparece si ya hay una decisión guardada (ni siquiera un rechazo)", () => {
    localStorage.setItem(
      "saa_consent",
      JSON.stringify({ version: 1, analytics: false, at: new Date().toISOString() }),
    );
    render(<ConsentBanner />);
    // Un rechazo es una decisión: el aviso no vuelve a molestar.
    expect(screen.queryByText("Aceptar")).toBeNull();
    expect(screen.queryByText("Rechazar")).toBeNull();
  });

  it("una decisión de una versión anterior se ignora y el aviso vuelve", () => {
    localStorage.setItem(
      "saa_consent",
      JSON.stringify({ version: 0, analytics: true, at: new Date().toISOString() }),
    );
    render(<ConsentBanner />);
    // Cambió el alcance de la medición: un "sí" viejo no vale para algo nuevo.
    expect(screen.getByText("Aceptar")).toBeTruthy();
  });
});
