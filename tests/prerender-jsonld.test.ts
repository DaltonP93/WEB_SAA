import { describe, expect, it } from "vitest";
// @ts-expect-error — script de build en JS puro, sin tipos.
import { buildStudiesHtml, injectHead, jsonForScript } from "../apps/web/scripts/prerender.mjs";

/**
 * El JSON-LD del prerender no puede cerrar su propio `<script>`.
 *
 * El script metía `JSON.stringify(jsonLd)` tal cual dentro de
 * `<script type="application/ld+json">`. El contenido de un `<script>` no es
 * HTML parseado: el navegador corta el bloque en el primer `</script` que
 * aparezca, aunque esté adentro de una cadena JSON. Como el JSON-LD lleva el
 * nombre de cada estudio —dato administrable—, un estudio llamado
 * `</script><meta http-equiv="refresh" …>` cerraba el bloque e inyectaba ese
 * markup en el HTML estático que sirve Nginx.
 */

/** Lo que un nombre de estudio no debería poder hacer. */
const PAYLOAD = '</script><meta http-equiv="refresh" content="0;url=https://evil.test">';

const SHELL = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Sanatorio</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

/** Extrae el contenido del bloque JSON-LD tal como lo leería el navegador. */
function jsonLdBlock(html: string): string {
  const start = html.indexOf('<script type="application/ld+json">');
  expect(start, "no se generó el bloque JSON-LD").toBeGreaterThan(-1);
  const from = start + '<script type="application/ld+json">'.length;
  // El navegador corta en el primer `</script`, no en el que "corresponde".
  const end = html.toLowerCase().indexOf("</script", from);
  return html.slice(from, end);
}

describe("serialización de JSON para un <script>", () => {
  it("escapa lo que podría cerrar la etiqueta", () => {
    const out = jsonForScript({ name: PAYLOAD });
    expect(out).not.toContain("</script");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    // Y sigue siendo JSON válido con el valor intacto.
    expect(JSON.parse(out)).toEqual({ name: PAYLOAD });
  });

  it("escapa los separadores de línea de JavaScript", () => {
    const value = { name: "a b c" };
    const out = jsonForScript(value);
    expect(out).not.toContain(" ");
    expect(out).not.toContain(" ");
    expect(JSON.parse(out)).toEqual(value);
  });

  it("no rompe el contenido normal", () => {
    const value = { name: "Ecografía 3D & 4D", desc: "Con «comillas» y ñ" };
    expect(JSON.parse(jsonForScript(value))).toEqual(value);
  });
});

describe("HTML prerenderizado con un estudio hostil", () => {
  const studies = [
    { slug: "hostil", name: PAYLOAD, category: "imagenes", description: PAYLOAD },
    { slug: "normal", name: "Ecografía", category: "imagenes", description: "Estudio por imágenes" },
  ];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Estudios",
    itemListElement: studies.map((s, i) => ({ "@type": "ListItem", position: i + 1, name: s.name })),
  };
  const html =
    injectHead(SHELL, {
      title: "Estudios",
      description: "Listado",
      canonical: "https://sanatorio.test/estudios/",
      jsonLd,
    }).replace('<div id="root"></div>', `<div id="root">${buildStudiesHtml(studies)}</div>`);

  it("no queda markup ejecutable en el HTML final", () => {
    // El payload puede aparecer como texto escapado —es inerte—, pero nunca
    // como una etiqueta que el navegador vaya a ejecutar.
    expect(html).not.toMatch(/<meta[^>]*http-equiv/i);
    expect(html).toContain("evil.test"); // sigue ahí, pero neutralizado
    // Un solo <script>: el del JSON-LD. Si el payload hubiera cerrado el
    // bloque, el resto del documento habría quedado fuera.
    expect(html.match(/<script/gi) ?? []).toHaveLength(1);
    expect(html.match(/<\/script>/gi) ?? []).toHaveLength(1);
  });

  it("el JSON-LD extraído se puede parsear", () => {
    const parsed = JSON.parse(jsonLdBlock(html));
    expect(parsed["@type"]).toBe("ItemList");
    // El nombre viaja completo: se escapó, no se recortó.
    expect(parsed.itemListElement[0].name).toBe(PAYLOAD);
    expect(parsed.itemListElement[1].name).toBe("Ecografía");
  });

  it("el nombre también sale escapado en el cuerpo de la página", () => {
    const body = html.slice(html.indexOf('<div id="root">'));
    expect(body).not.toContain("<meta http-equiv");
    expect(body).toContain("&lt;/script&gt;");
  });

  it("el documento sigue cerrando bien", () => {
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).toContain("</head>");
  });
});
