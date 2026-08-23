import { describe, expect, it } from "vitest";
import { esDestinoInterno, normalizarOrigen, validarRedirect } from "../api/src/redirects.js";

/**
 * El corazon de los redirects: que un destino nunca apunte afuera del sitio.
 * Pura, sin base:
 *
 *   pnpm test tests/redirects.test.ts
 *
 * Un redirect con destino externo es un open redirect: una URL del sanatorio
 * que lleva a donde el atacante quiera. La validacion de que el destino es
 * interno es la linea de defensa, no una cortesia.
 */

describe("normalizarOrigen", () => {
  it("saca la barra final y pasa a minusculas", () => {
    expect(normalizarOrigen("/Portal/")).toBe("/portal");
    expect(normalizarOrigen("/A/B/")).toBe("/a/b");
    expect(normalizarOrigen("/")).toBe("/");
    expect(normalizarOrigen("")).toBe("/");
  });
});

describe("esDestinoInterno (guarda contra open redirect)", () => {
  it("acepta rutas internas normales", () => {
    for (const to of ["/", "/portal-paciente", "/a/b/c", "/x?y=1&z=2", "/p-a_g.e"]) {
      expect(esDestinoInterno(to), to).toBe(true);
    }
  });

  it("rechaza destinos externos y trucos de escape", () => {
    for (const to of [
      "//evil.com",
      "/\\evil.com",
      "https://evil.com",
      "http://evil.com",
      "javascript:alert(1)",
      "evil.com",
      "  /espacio-al-inicio",
      "/con espacio",
      "/con<script>",
      "",
    ]) {
      expect(esDestinoInterno(to), `deberia rechazar: ${JSON.stringify(to)}`).toBe(false);
    }
  });

  it("rechaza un destino que no es texto", () => {
    expect(esDestinoInterno(null)).toBe(false);
    expect(esDestinoInterno(123)).toBe(false);
    expect(esDestinoInterno(undefined)).toBe(false);
  });
});

describe("validarRedirect", () => {
  it("acepta un par valido y normaliza el origen", () => {
    const r = validarRedirect({ from: "/Vieja/", to: "/nueva" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ from: "/vieja", to: "/nueva" });
  });

  it("rechaza un destino externo", () => {
    const r = validarRedirect({ from: "/vieja", to: "https://evil.com" });
    expect(r.ok).toBe(false);
  });

  it("rechaza from y to iguales (bucle)", () => {
    expect(validarRedirect({ from: "/misma", to: "/misma" }).ok).toBe(false);
    // Aun con distinta grafia/barra, el origen normalizado coincide.
    expect(validarRedirect({ from: "/Misma/", to: "/misma" }).ok).toBe(false);
  });

  it("rechaza redirigir la raiz", () => {
    expect(validarRedirect({ from: "/", to: "/algo" }).ok).toBe(false);
  });

  it("rechaza un from que no empieza con / o trae espacios", () => {
    expect(validarRedirect({ from: "vieja", to: "/nueva" }).ok).toBe(false);
    expect(validarRedirect({ from: "/con espacio", to: "/nueva" }).ok).toBe(false);
  });

  it("un payload que no es objeto es un error, no un 500", () => {
    expect(validarRedirect("x").ok).toBe(false);
    expect(validarRedirect(null).ok).toBe(false);
  });
});
