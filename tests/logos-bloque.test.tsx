// @vitest-environment jsdom
import { render, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import Logos from "../apps/web/src/blocks/Logos";
import { LOGOS_OPACIDAD_POR_DEFECTO, type LogoItem } from "@sa/shared/blocks";

/**
 * El bloque `Logos` en el sitio público, con datos nuevos y con los que ya
 * están guardados.
 *
 * Lo que se corrige acá no fallaba: se veía mal o se comportaba mal, que es
 * más difícil de detectar.
 *
 * - **Layout shift.** Sin `width`/`height` el navegador no sabe cuánto espacio
 *   reservar, así que la fila arranca con altura cero y empuja todo lo que
 *   está debajo cuando llega cada logo.
 * - **Un enlace anónimo.** Un logo enlazado sin `alt` produce un `<a>` cuyo
 *   contenido es una imagen sin texto: un lector de pantalla lo anuncia como
 *   "enlace" y nada más. En una fila de doce logos, doce enlaces idénticos.
 * - **Opacidad fija.** `opacity-80` estaba en la clase y no se podía cambiar.
 * - **Sin activo/inactivo.** Para sacar un convenio del sitio había que
 *   borrarlo, y volver a cargarlo entero si volvía.
 *
 * ## Compatibilidad
 *
 * Los bloques guardados traen tres claves: `imageUrl`, `alt` y `href`. Todo lo
 * demás es opcional, y los defaults reproducen exactamente lo anterior. Las
 * pruebas de "legacy" usan **sólo** esas tres claves a propósito.
 */

const dibujar = (props: Parameters<typeof Logos>[0]) =>
  render(
    <MemoryRouter>
      <Logos {...props} />
    </MemoryRouter>,
  );

const LEGACY: LogoItem[] = [
  { imageUrl: "/uploads/a.png", alt: "Obra social A", href: "https://a.test" },
  { imageUrl: "/uploads/b.png", alt: "Obra social B" },
];

const NUEVO: LogoItem[] = [
  { imageUrl: "/uploads/a.png", alt: "Obra social A", href: "https://a.test", active: true, width: 400, height: 80 },
  { imageUrl: "/uploads/b.png", alt: "Obra social B", active: false, width: 300, height: 100 },
  { imageUrl: "/uploads/c.png", alt: "Obra social C", href: "/convenios", active: true, width: 200, height: 60 },
];

afterEach(cleanup);

describe("bloque Logos, datos nuevos", () => {
  it("no muestra los logos desactivados", () => {
    const { container } = dibujar({ logos: NUEVO });

    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector('img[src="/uploads/b.png"]'), "se dibujó un logo inactivo").toBeNull();
  });

  it("cada imagen lleva width, height, lazy y decoding", () => {
    const { container } = dibujar({ logos: NUEVO });
    const img = container.querySelector('img[src="/uploads/a.png"]')!;

    expect(img.getAttribute("width"), "sin width la fila salta al cargar").toBe("400");
    expect(img.getAttribute("height")).toBe("80");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
  });

  it("la imagen no se desborda ni se deforma", () => {
    const { container } = dibujar({ logos: NUEVO });
    const clases = container.querySelector("img")!.getAttribute("class") ?? "";

    // Sin `max-w-full` un logo ancho empuja la fila fuera de la pantalla en un
    // teléfono; sin `object-contain` se recorta o se estira.
    expect(clases).toContain("max-w-full");
    expect(clases).toContain("object-contain");
  });

  it("la opacidad es la configurada y no una clase fija", () => {
    const { container } = dibujar({ logos: NUEVO, opacity: 45 });
    const fila = container.querySelector("section > div") as HTMLElement;

    expect(fila.style.opacity).toBe("0.45");
    // `opacity-80` en la clase no se podía cambiar desde el panel, y una clase
    // `opacity-${n}` generada no existiría en el CSS compilado.
    expect(fila.getAttribute("class") ?? "").not.toMatch(/opacity-\d/);
  });

  it("un enlace externo sale con noopener y noreferrer", () => {
    const { container } = dibujar({ logos: NUEVO });
    const a = container.querySelector('a[href="https://a.test"]')!;

    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("un enlace interno no se abre en otra pestaña", () => {
    const { container } = dibujar({ logos: NUEVO });
    const a = container.querySelector('a[href="/convenios"]')!;

    expect(a.getAttribute("target")).toBeNull();
  });

  it("un logo enlazado tiene nombre accesible", () => {
    const { container } = dibujar({ logos: NUEVO });
    const a = container.querySelector('a[href="https://a.test"]') as HTMLElement;

    // El nombre del enlace sale del alt de la imagen que contiene.
    expect(within(a).getByAltText("Obra social A")).toBeTruthy();
  });

  it("con todos los logos desactivados el bloque no deja una sección vacía", () => {
    const { container } = dibujar({ logos: NUEVO.map((l) => ({ ...l, active: false })) });
    expect(container.querySelector("section")).toBeNull();
  });

  it("dimensiones inválidas se omiten en vez de escribirse", () => {
    const { container } = dibujar({
      logos: [{ imageUrl: "/uploads/a.png", alt: "A", width: 0, height: -5 as number }],
    });
    const img = container.querySelector("img")!;

    // `width="0"` reservaría cero espacio, que es peor que no declarar nada.
    expect(img.getAttribute("width")).toBeNull();
    expect(img.getAttribute("height")).toBeNull();
  });
});

describe("bloque Logos, datos legacy", () => {
  it("un bloque guardado con las tres claves de siempre se sigue viendo igual", () => {
    const { container } = dibujar({ heading: "Convenios", logos: LEGACY });

    // Sin `active`, los dos se muestran: el default es mostrar.
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector("h2")?.textContent).toBe("Convenios");
  });

  it("sin opacidad configurada usa la que tenía fija antes", () => {
    const { container } = dibujar({ logos: LEGACY });
    const fila = container.querySelector("section > div") as HTMLElement;

    expect(fila.style.opacity).toBe(String(LOGOS_OPACIDAD_POR_DEFECTO / 100));
  });

  it("sin dimensiones no inventa un tamaño", () => {
    const { container } = dibujar({ logos: LEGACY });
    const img = container.querySelector('img[src="/uploads/a.png"]')!;

    // Poner un tamaño supuesto deformaría el logo. Mejor sin declarar: el
    // layout shift es el problema anterior, y se resuelve editando el bloque.
    expect(img.getAttribute("width")).toBeNull();
    expect(img.getAttribute("height")).toBeNull();
    // Lo demás sí aplica igual.
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("una fila legacy enlazada SIN alt no se publica como enlace", () => {
    const { container } = dibujar({
      logos: [{ imageUrl: "/uploads/x.png", href: "https://x.test" }],
    });

    // Un `<a>` con una imagen sin texto adentro es un enlace que no dice a
    // dónde va. Se prefiere perder el destino —recuperable editando— antes
    // que publicar navegación que nadie puede usar.
    expect(container.querySelector("a"), "quedó un enlace sin nombre accesible").toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("una fila legacy con alt vacío tampoco se publica como enlace", () => {
    const { container } = dibujar({
      logos: [{ imageUrl: "/uploads/x.png", alt: "   ", href: "https://x.test" }],
    });
    expect(container.querySelector("a")).toBeNull();
  });

  it("una fila legacy sin alt y sin enlace se muestra normalmente", () => {
    const { container } = dibujar({ logos: [{ imageUrl: "/uploads/x.png" }] });

    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("legacy y nuevo conviven en el mismo bloque", () => {
    const { container } = dibujar({
      logos: [
        { imageUrl: "/uploads/viejo.png", alt: "Viejo", href: "https://v.test" },
        { imageUrl: "/uploads/nuevo.png", alt: "Nuevo", active: true, width: 400, height: 80 },
        { imageUrl: "/uploads/oculto.png", alt: "Oculto", active: false },
      ],
    });

    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector('img[src="/uploads/viejo.png"]')?.getAttribute("width")).toBeNull();
    expect(container.querySelector('img[src="/uploads/nuevo.png"]')?.getAttribute("width")).toBe("400");
  });

  it("un array vacío o ausente no rompe el render", () => {
    expect(() => dibujar({ logos: [] })).not.toThrow();
    expect(() => dibujar({ logos: undefined as never })).not.toThrow();
  });
});
