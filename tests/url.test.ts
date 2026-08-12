import { describe, expect, it } from "vitest";
import { isInternalHref, isSafeExternalHref, safeInternalHref } from "../apps/web/src/lib/url";

/**
 * Los href los carga el panel. Nos aseguramos de que un valor mal cargado no
 * se transforme en una redirección fuera del sitio.
 */

describe("isInternalHref", () => {
  it("acepta rutas internas", () => {
    expect(isInternalHref("/turnos")).toBe(true);
  });

  it("rechaza protocol-relative y backslash", () => {
    expect(isInternalHref("//evil.test")).toBe(false);
    expect(isInternalHref("/\\evil.test")).toBe(false);
  });

  it("rechaza absolutas y vacíos", () => {
    expect(isInternalHref("https://evil.test")).toBe(false);
    expect(isInternalHref("")).toBe(false);
    expect(isInternalHref(undefined)).toBe(false);
  });
});

describe("safeInternalHref", () => {
  it("normaliza barras repetidas", () => {
    expect(safeInternalHref("//evil.test")).toBe("/evil.test");
    expect(safeInternalHref("/\\evil.test")).toBe("/evil.test");
  });

  it("cae al fallback si no es interna", () => {
    expect(safeInternalHref("https://evil.test")).toBe("/");
    expect(safeInternalHref(undefined, "/inicio")).toBe("/inicio");
  });
});

describe("isSafeExternalHref", () => {
  it("acepta http, mailto y tel", () => {
    expect(isSafeExternalHref("https://x.test")).toBe(true);
    expect(isSafeExternalHref("mailto:a@b.test")).toBe(true);
    expect(isSafeExternalHref("tel:+595")).toBe(true);
  });

  it("rechaza javascript:", () => {
    expect(isSafeExternalHref("javascript:alert(1)")).toBe(false);
  });
});
