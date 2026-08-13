import { describe, expect, it } from "vitest";
import {
  isSafeLinkHref,
  safeLinkHref,
  sanitizeHtml,
  sanitizeMapEmbed,
  stripHtml,
} from "../api/src/html";

/**
 * Regresión de XSS almacenado.
 *
 * Todo lo que guarda el panel termina en `dangerouslySetInnerHTML`, así que el
 * saneo tiene que resistir las evasiones clásicas del filtro por regex que
 * había antes: entidades HTML, `srcdoc`, SVG/MathML, atributos de evento,
 * protocolos ofuscados y etiquetas mal formadas.
 */

const hasScriptish = (html: string) =>
  /<script|<iframe|<svg|<math|on\w+\s*=|javascript:|srcdoc/i.test(html);

describe("sanitizeHtml", () => {
  const payloads: [string, string][] = [
    ["script simple", '<p>hola</p><script>alert(1)</script>'],
    ["script mal formado", '<script >alert(1)</script foo="bar">'],
    ["script sin cerrar", '<script>alert(1)'],
    ["script anidado", '<scr<script>ipt>alert(1)</script>'],
    ["atributo de evento", '<img src="x" onerror="alert(1)">'],
    ["evento con mayúsculas y espacios", '<div OnMouseOver = "alert(1)">x</div>'],
    ["javascript: en href", '<a href="javascript:alert(1)">click</a>'],
    ["javascript: con entidades", '<a href="java&#115;cript:alert(1)">click</a>'],
    ["javascript: con tab", '<a href="java\tscript:alert(1)">click</a>'],
    ["data: uri", '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>'],
    ["vbscript:", '<a href="vbscript:msgbox(1)">x</a>'],
    ["iframe", '<iframe src="https://evil.test"></iframe>'],
    ["iframe srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ["svg onload", '<svg onload="alert(1)"><circle r="10"/></svg>'],
    ["svg script", '<svg><script>alert(1)</script></svg>'],
    ["mathml", '<math><mtext><script>alert(1)</script></mtext></math>'],
    ["object", '<object data="javascript:alert(1)"></object>'],
    ["embed", '<embed src="https://evil.test">'],
    ["style con expresión", '<style>body{background:url("javascript:alert(1)")}</style>'],
    ["form", '<form action="https://evil.test"><input name="a"></form>'],
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=https://evil.test">'],
    ["base", '<base href="https://evil.test/">'],
    ["comentario condicional", '<!--[if IE]><script>alert(1)</script><![endif]-->'],
    ["entidad en el tag", '&#60;script&#62;alert(1)&#60;/script&#62;'],
  ];

  it.each(payloads)("neutraliza: %s", (_name, payload) => {
    const out = sanitizeHtml(payload) ?? "";
    expect(hasScriptish(out), `salida insegura: ${out}`).toBe(false);
  });

  it("conserva el contenido editorial legítimo", () => {
    const html =
      '<h2>Título</h2><p>Un <strong>texto</strong> con <a href="/turnos">enlace</a> y ' +
      '<a href="https://ejemplo.test">externo</a>.</p><ul><li>uno</li></ul>' +
      '<table><thead><tr><th scope="col">A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>';
    const out = sanitizeHtml(html) ?? "";
    expect(out).toContain("<h2>Título</h2>");
    expect(out).toContain("<strong>texto</strong>");
    expect(out).toContain('href="/turnos"');
    expect(out).toContain("<table>");
  });

  it("agrega rel de seguridad a los enlaces externos", () => {
    const out = sanitizeHtml('<a href="https://ejemplo.test">x</a>') ?? "";
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("stripHtml deja sólo texto", () => {
    expect(stripHtml('<p>hola <script>alert(1)</script><b>mundo</b></p>')).toBe("hola mundo");
  });
});

describe("isSafeLinkHref", () => {
  const unsafe = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "java&#115;cript:alert(1)",
    "&#106;avascript:alert(1)",
    "javascript&colon;alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://evil.test/x",
    "//evil.test",
    "/\\evil.test",
    "\\\\evil.test",
    "",
  ];

  it.each(unsafe)("rechaza %s", (href) => {
    expect(isSafeLinkHref(href)).toBe(false);
    expect(safeLinkHref(href)).toBeUndefined();
  });

  const safe = ["/turnos", "#seccion", "https://ejemplo.test", "http://ejemplo.test", "mailto:a@b.test", "tel:+595211234"];

  it.each(safe)("acepta %s", (href) => {
    expect(isSafeLinkHref(href)).toBe(true);
    expect(safeLinkHref(href)).toBe(href);
  });
});

describe("sanitizeMapEmbed", () => {
  it("del iframe se queda sólo con la URL: no devuelve HTML", () => {
    const input =
      '<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12" width="600" height="450" loading="lazy"></iframe>';
    const out = sanitizeMapEmbed(input);
    expect(out).toBe("https://www.google.com/maps/embed?pb=!1m18!1m12");
    // Nada de HTML sobrevive: el front arma el iframe con atributos fijos.
    expect(out).not.toContain("<");
  });

  it("un iframe con manejadores de evento se descarta entero", () => {
    // No se le extrae el src: un `onload` es señal de que el valor fue
    // manipulado, y no hay razón para rescatar nada de ahí.
    expect(
      sanitizeMapEmbed(
        '<iframe src="https://www.google.com/maps/embed?pb=!1m18" onload="alert(1)"></iframe>',
      ),
    ).toBe("");
    expect(sanitizeMapEmbed('<iframe srcdoc="<script>alert(1)</script>"></iframe>')).toBe("");
  });

  it("acepta la URL sola, sin iframe", () => {
    expect(sanitizeMapEmbed("https://www.google.com/maps/embed?pb=!1m18")).toBe(
      "https://www.google.com/maps/embed?pb=!1m18",
    );
  });

  it("acepta el formato legacy con output=embed", () => {
    const input = '<iframe src="https://maps.google.com/maps?q=Asunci%C3%B3n&output=embed"></iframe>';
    expect(sanitizeMapEmbed(input)).toContain("maps.google.com/maps?q=");
  });

  const rejected: [string, string][] = [
    ["host ajeno", '<iframe src="https://evil.test/maps/embed?pb=1"></iframe>'],
    ["subdominio falso", '<iframe src="https://google.com.evil.test/maps/embed"></iframe>'],
    ["http sin TLS", '<iframe src="http://www.google.com/maps/embed?pb=1"></iframe>'],
    ["srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ["javascript", '<iframe src="javascript:alert(1)"></iframe>'],
    ["ruta que no es embed", '<iframe src="https://www.google.com/search?q=x"></iframe>'],
    ["sin output=embed", '<iframe src="https://maps.google.com/maps?q=x"></iframe>'],
    ["no es iframe", '<script>alert(1)</script>'],
    ["HTML suelto sin src", '<div onclick="alert(1)">mapa</div>'],
    ["iframe con srcdoc y sin src", '<iframe srcdoc="<img src=x onerror=alert(1)>"></iframe>'],
  ];

  it.each(rejected)("rechaza: %s", (_name, input) => {
    expect(sanitizeMapEmbed(input)).toBe("");
  });
});
