// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { construirAtribucion, capturarAtribucion, obtenerAtribucion } from "../apps/web/src/lib/attribution";
import { cargarAnalitica, hayMedicion, medicionesValidas } from "../apps/web/src/lib/analytics";

/**
 * La parte de marketing que vive en el navegador: captura de atribución y carga
 * de la medición. Corre en jsdom.
 *
 * Lo que se prueba acá no se puede ver en la API: que el first-touch no se pise,
 * que el loader no inyecte dos veces, y que un ID con forma inválida no termine
 * en el `src` de un script.
 */

describe("construirAtribucion", () => {
  it("captura los utm y el gclid, y agrega landing y referrer", () => {
    const r = construirAtribucion(
      "?utm_source=instagram&utm_medium=social&utm_campaign=verano&gclid=abc",
      "https://instagram.com/algo/perfil",
      "/turnos",
    );
    expect(r).toEqual({
      utm_source: "instagram",
      utm_medium: "social",
      utm_campaign: "verano",
      gclid: "abc",
      landing: "/turnos",
      // Sólo el host del referente, no la URL entera.
      referrer: "instagram.com",
    });
  });

  it("sin ningún parámetro de campaña devuelve null (no registra landing sola)", () => {
    expect(construirAtribucion("?otra=cosa", "https://google.com", "/")).toBeNull();
    expect(construirAtribucion("", "", "/")).toBeNull();
  });

  it("un referente no parseable no rompe la captura", () => {
    const r = construirAtribucion("?utm_source=x", "no-es-una-url", "/");
    expect(r?.utm_source).toBe("x");
    expect(r?.referrer).toBeUndefined();
  });
});

describe("capturarAtribucion (first-touch por sesión)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    // jsdom permite reescribir location con la API de history.
    window.history.replaceState({}, "", "/aterrizaje?utm_source=meta&utm_campaign=lanzamiento");
  });
  afterEach(() => sessionStorage.clear());

  it("guarda la primera visita con parámetros", () => {
    capturarAtribucion();
    expect(obtenerAtribucion()).toMatchObject({ utm_source: "meta", utm_campaign: "lanzamiento" });
  });

  it("no pisa la atribución ya guardada aunque cambie la URL", () => {
    capturarAtribucion();
    // La persona navega a otra campaña dentro de la misma sesión.
    window.history.replaceState({}, "", "/otra?utm_source=google");
    capturarAtribucion();
    // Sigue la primera: es la que originó la sesión.
    expect(obtenerAtribucion()?.utm_source, "el first-touch se pisó").toBe("meta");
  });

  it("una visita directa no guarda nada", () => {
    window.history.replaceState({}, "", "/");
    capturarAtribucion();
    expect(obtenerAtribucion()).toBeUndefined();
  });
});

describe("medicionesValidas / hayMedicion", () => {
  it("deja pasar sólo los IDs con forma correcta", () => {
    const r = medicionesValidas({ ga4: "G-OK123456", gtm: "no-vale", metaPixel: "999888777" });
    expect(r).toEqual({ ga4: "G-OK123456", metaPixel: "999888777" });
    expect(hayMedicion(r)).toBe(true);
  });

  it("sin IDs válidos, no hay medición", () => {
    expect(hayMedicion({ ga4: "", gtm: "", metaPixel: "" })).toBe(false);
    expect(hayMedicion(null)).toBe(false);
    expect(hayMedicion({ ga4: "basura" })).toBe(false);
  });
});

describe("cargarAnalitica", () => {
  const scripts = () => Array.from(document.querySelectorAll("script[data-saa-analytics]"));

  beforeEach(() => {
    for (const s of scripts()) s.remove();
    delete (window as any).gtag;
    delete (window as any).dataLayer;
    delete (window as any).fbq;
  });

  it("inyecta el script de GA4 con el id en el src", () => {
    cargarAnalitica({ ga4: "G-ABC12345" });
    const s = scripts();
    expect(s).toHaveLength(1);
    expect(s[0].getAttribute("src")).toContain("gtag/js?id=G-ABC12345");
    expect((window as any).gtag, "no se instaló gtag").toBeTypeOf("function");
  });

  it("es idempotente: llamarla dos veces no duplica el script", () => {
    cargarAnalitica({ ga4: "G-ABC12345" });
    cargarAnalitica({ ga4: "G-ABC12345" });
    expect(scripts().filter((s) => s.getAttribute("src")?.includes("G-ABC12345"))).toHaveLength(1);
  });

  it("un ID con forma inválida no inyecta nada (no llega al src)", () => {
    cargarAnalitica({ ga4: "G-x\"></script><script>alert(1)" });
    expect(scripts(), "un valor inválido terminó como script").toHaveLength(0);
  });

  it("carga las tres plataformas cuando las tres son válidas", () => {
    cargarAnalitica({ ga4: "G-ABC12345", gtm: "GTM-ABCD12", metaPixel: "1234567890" });
    const srcs = scripts().map((s) => s.getAttribute("src") ?? "");
    expect(srcs.some((u) => u.includes("gtag/js"))).toBe(true);
    expect(srcs.some((u) => u.includes("gtm.js"))).toBe(true);
    expect(srcs.some((u) => u.includes("fbevents.js"))).toBe(true);
    expect((window as any).fbq).toBeTypeOf("function");
  });

  it("sin config no inyecta nada", () => {
    cargarAnalitica(null);
    cargarAnalitica({});
    expect(scripts()).toHaveLength(0);
  });
});
