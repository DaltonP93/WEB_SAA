// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_TEXT, CONSENT_VERSION } from "@sa/shared/consent";

/**
 * El texto de consentimiento y su versión tienen **una sola fuente**
 * (`@sa/shared/consent`), consumida por el bloque público y por el servidor. Esta
 * prueba falla si el texto que la persona ve diverge de la versión que el
 * servidor registra: sin esa correspondencia, la evidencia de consentimiento no
 * vale.
 */

vi.mock("../apps/web/src/api", () => ({ api: { post: vi.fn() } }));
vi.mock("../apps/web/src/lib/attribution", () => ({ obtenerAtribucion: () => null }));

let Newsletter: any;
let serverNewsletter: any;

beforeEach(async () => {
  Newsletter = (await import("../apps/web/src/blocks/Newsletter")).default;
  serverNewsletter = await import("../api/src/newsletter");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("consentimiento de newsletter · fuente única", () => {
  it("el bloque muestra exactamente el texto compartido", () => {
    render(<Newsletter heading="Novedades" />);
    // Si alguien reemplaza el texto del bloque por un literal distinto, esto rompe.
    expect(screen.getByText(CONSENT_TEXT)).toBeTruthy();
  });

  it("el servidor sella la misma versión y el mismo texto que se muestra", () => {
    // El backend no puede tener una copia divergente: reexporta de la misma fuente.
    expect(serverNewsletter.CONSENT_VERSION).toBe(CONSENT_VERSION);
    expect(serverNewsletter.CONSENT_TEXT).toBe(CONSENT_TEXT);
  });
});
