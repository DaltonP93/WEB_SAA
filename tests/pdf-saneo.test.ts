import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { sanearPdf } from "../api/src/pdf.js";

/**
 * El PDF pasó de validado a saneado, y eso hay que probarlo por los bytes.
 *
 * La ronda anterior cambió la detección por cinco bytes por una validación
 * estructural real, y dejó escrito —correctamente— que **validar no es
 * sanear**: el archivo se guardaba como llegaba. Un PDF perfectamente válido
 * puede traer `/OpenAction`, que se ejecuta al abrirlo sin que nadie haga clic.
 *
 * Ahora se sanea. La prueba de que se sanea no puede ser "la función devolvió
 * ok": tiene que ser que **la carga útil no está en los bytes de salida**.
 *
 * Eso importa por una razón concreta y medida: borrar `/OpenAction` del
 * catálogo quita la *referencia*, pero pdf-lib escribe igual el objeto
 * huérfano, y el JavaScript sigue en el archivo. Un lector que siga el catálogo
 * no lo ejecutaría; el código estaría ahí de todos modos, y llamar "saneado" a
 * eso sería mentir. Por eso el documento se reconstruye con `copyPages`.
 *
 * Las pruebas de acá buscan la cadena literal en los bytes finales. Si alguien
 * vuelve a la versión que sólo borraba la referencia, fallan.
 *
 * No necesita base:
 *
 *   pnpm test tests/pdf-saneo.test.ts
 */

/** Una carga útil única: si aparece en la salida, no hay dudas de dónde salió. */
const PAYLOAD = "app.alert('SAA-PDF-PAYLOAD-4417')";

const texto = (bytes: Buffer | Uint8Array) => Buffer.from(bytes).toString("latin1");

/** Un PDF estructuralmente real. */
async function pdfReal(paginas = 1): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) doc.addPage([200, 200]).drawText(`Página ${i + 1}`);
  return doc;
}

/**
 * Un PDF que **ejecuta JavaScript al abrirse**.
 *
 * `/OpenAction` con una acción `/JavaScript` es la forma canónica: el lector la
 * dispara solo, sin interacción. Se agrega además a `/Names /JavaScript`, que
 * es la otra vía a nivel documento.
 */
async function pdfConJavaScript(paginas = 1): Promise<Buffer> {
  const doc = await pdfReal(paginas);
  const ctx = doc.context;

  const accion = ctx.obj({ S: PDFName.of("JavaScript"), JS: PDFString.of(PAYLOAD) });
  doc.catalog.set(PDFName.of("OpenAction"), ctx.register(accion));

  const nombres = ctx.obj({
    JavaScript: ctx.obj({ Names: ctx.obj([PDFString.of("saa"), ctx.register(accion)]) }),
  });
  doc.catalog.set(PDFName.of("Names"), ctx.register(nombres));

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Un PDF con una anotación que lanza un programa al hacer clic. */
async function pdfConAnotacionLaunch(): Promise<Buffer> {
  const doc = await pdfReal(1);
  const ctx = doc.context;
  const anotacion = ctx.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Link"),
    Rect: ctx.obj([0, 0, 100, 100]),
    A: ctx.obj({ S: PDFName.of("Launch"), F: PDFString.of("/usr/bin/SAA-LAUNCH-TARGET") }),
  });
  const pagina = doc.getPage(0).node;
  pagina.set(PDFName.of("Annots"), ctx.obj([ctx.register(anotacion)]));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Un PDF con acciones adicionales de documento (`/AA`): al imprimir, al cerrar. */
async function pdfConAccionesAdicionales(): Promise<Buffer> {
  const doc = await pdfReal(1);
  const ctx = doc.context;
  const accion = ctx.obj({ S: PDFName.of("JavaScript"), JS: PDFString.of(PAYLOAD) });
  doc.catalog.set(PDFName.of("AA"), ctx.obj({ WP: ctx.register(accion) }));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Un PDF con un archivo adjunto. */
async function pdfConAdjunto(): Promise<Buffer> {
  const doc = await pdfReal(1);
  const ctx = doc.context;
  const flujo = ctx.flateStream("SAA-ADJUNTO-SECRETO");
  const spec = ctx.obj({
    Type: PDFName.of("Filespec"),
    F: PDFString.of("adjunto.txt"),
    EF: ctx.obj({ F: ctx.register(flujo) }),
  });
  doc.catalog.set(
    PDFName.of("Names"),
    ctx.obj({ EmbeddedFiles: ctx.obj({ Names: ctx.obj([PDFHexString.fromText("a"), ctx.register(spec)]) }) }),
  );
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

describe("saneo de PDF", () => {
  describe("las vías de ejecución no sobreviven", () => {
    it("un PDF con /OpenAction y JavaScript sale sin ninguno de los dos", async () => {
      const original = await pdfConJavaScript();

      // Control sobre la fixture: si el original no trae el payload, lo de
      // abajo no prueba nada.
      expect(texto(original), "la fixture no trae la carga útil").toContain(PAYLOAD);
      expect(texto(original)).toContain("/OpenAction");

      const r = await sanearPdf(original);
      expect(r.ok, r.ok ? "" : r.error).toBe(true);
      if (!r.ok) return;

      const salida = texto(r.pdf.bytes);
      // Lo que de verdad importa: la carga útil no está en los bytes. Borrar
      // sólo la referencia del catálogo dejaba el objeto huérfano escrito, y
      // esta línea es la que falla si se vuelve a eso.
      expect(salida, "el JavaScript sigue dentro del archivo saneado").not.toContain(PAYLOAD);
      expect(salida).not.toContain("/OpenAction");
      expect(salida).not.toContain("/JavaScript");
    });

    it("lo quitado se informa, para poder afirmarlo y no suponerlo", async () => {
      const r = await sanearPdf(await pdfConJavaScript());
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.pdf.quitado).toContain("catálogo/OpenAction");
      expect(r.pdf.quitado).toContain("catálogo/Names");
    });

    it("una anotación que lanza un programa no llega a la salida", async () => {
      const original = await pdfConAnotacionLaunch();
      expect(texto(original), "la fixture no trae la anotación").toContain("SAA-LAUNCH-TARGET");

      const r = await sanearPdf(original);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const salida = texto(r.pdf.bytes);
      expect(salida, "quedó la acción /Launch").not.toContain("SAA-LAUNCH-TARGET");
      expect(salida).not.toContain("/Launch");
      expect(r.pdf.quitado).toContain("página 1/Annots");
    });

    it("las acciones adicionales del documento (/AA) tampoco", async () => {
      const original = await pdfConAccionesAdicionales();
      expect(texto(original)).toContain(PAYLOAD);

      const r = await sanearPdf(original);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(texto(r.pdf.bytes), "quedó el JavaScript de /AA").not.toContain(PAYLOAD);
      expect(r.pdf.quitado).toContain("catálogo/AA");
    });

    it("un archivo adjunto no viaja dentro del PDF publicado", async () => {
      const original = await pdfConAdjunto();

      const r = await sanearPdf(original);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const salida = texto(r.pdf.bytes);
      expect(salida).not.toContain("/EmbeddedFiles");
      expect(salida).not.toContain("/Filespec");
      expect(r.pdf.quitado).toContain("catálogo/Names");
    });

    it("el resultado saneado sigue siendo un PDF que otra biblioteca abre", async () => {
      const r = await sanearPdf(await pdfConJavaScript(2));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // Sanear no puede significar romper: el documento tiene que abrirse.
      const releido = await PDFDocument.load(r.pdf.bytes);
      expect(releido.getPageCount()).toBe(2);
      expect(releido.catalog.get(PDFName.of("OpenAction"))).toBeUndefined();
    });

    it("sanear dos veces da un archivo igual de limpio (es idempotente)", async () => {
      const una = await sanearPdf(await pdfConJavaScript());
      expect(una.ok).toBe(true);
      if (!una.ok) return;

      const dos = await sanearPdf(una.pdf.bytes);
      expect(dos.ok).toBe(true);
      if (!dos.ok) return;

      // Nada que quitar la segunda vez: si aparece algo, la primera pasada no
      // había limpiado lo que decía haber limpiado.
      expect(dos.pdf.quitado, "la segunda pasada encontró más cosas que quitar").toEqual([]);
      expect(texto(dos.pdf.bytes)).not.toContain(PAYLOAD);
    });
  });

  describe("el contenido se conserva", () => {
    it("un documento de tres páginas sale con tres páginas", async () => {
      const original = Buffer.from(await (await pdfReal(3)).save());
      const r = await sanearPdf(original);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.pdf.paginas).toBe(3);
      expect((await PDFDocument.load(r.pdf.bytes)).getPageCount()).toBe(3);
    });

    it("el texto de las páginas viaja al documento saneado", async () => {
      const doc = await PDFDocument.create();
      doc.addPage([300, 300]).drawText("Protocolo de biopsias");
      const r = await sanearPdf(Buffer.from(await doc.save({ useObjectStreams: false })));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // El contenido de página viaja comprimido, así que se comprueba por lo
      // que sí es observable: el tamaño de página y que haya flujo de
      // contenido. Perder el contenido dejaría una página vacía.
      const releido = await PDFDocument.load(r.pdf.bytes);
      const [pagina] = releido.getPages();
      expect([pagina.getWidth(), pagina.getHeight()]).toEqual([300, 300]);
      expect(pagina.node.get(PDFName.of("Contents")), "la página quedó sin contenido").toBeDefined();
      expect(pagina.node.get(PDFName.of("Resources")), "la página perdió sus recursos").toBeDefined();
    });

    it("un PDF limpio pasa sin que se le quite nada", async () => {
      const r = await sanearPdf(Buffer.from(await (await pdfReal(1)).save()));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.pdf.quitado, "se quitó algo de un PDF que no traía nada").toEqual([]);
    });
  });

  describe("lo que no es un PDF se rechaza, y el motivo no cuenta nada", () => {
    const basura: [string, () => Buffer | Promise<Buffer>][] = [
      ["texto detrás del prefijo %PDF-", () => Buffer.from("%PDF-1.4\ntexto suelto\n", "latin1")],
      ["sólo la firma", () => Buffer.from("%PDF-", "latin1")],
      ["el fixture escrito a mano", () => Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1")],
      ["bytes de PNG", () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      ["vacío", () => Buffer.alloc(0)],
      [
        "un PDF real truncado a la mitad",
        async () => Buffer.from(await (await pdfReal(2)).save()).subarray(0, 300),
      ],
    ];

    it.each(basura)("%s se rechaza", async (_q, hacer) => {
      const r = await sanearPdf(await hacer());
      expect(r.ok, "se aceptó algo que no es un PDF").toBe(false);
    });

    it("el error no lleva posiciones, contenido ni rutas del archivo", async () => {
      const r = await sanearPdf(Buffer.from("%PDF-1.4\nSANATORIO-DATO-INTERNO-12345\n", "latin1"));
      expect(r.ok).toBe(false);
      if (r.ok) return;

      expect(r.error).not.toContain("SANATORIO-DATO-INTERNO");
      // pdf-lib pone línea, columna y desplazamiento en su mensaje.
      expect(r.error).not.toMatch(/offset|line:\s*\d|col:\s*\d|\bpos\b/i);
      expect(r.error.length, "el error es demasiado largo para no estar contando algo").toBeLessThan(80);
    });
  });

  describe("lo que este saneo NO afirma", () => {
    /**
     * El módulo dice explícitamente que no inspecciona los flujos de contenido
     * de cada página. Esta prueba fija esa frontera: no es un fallo, es el
     * alcance declarado. Si alguna vez se amplía, esta prueba es el lugar donde
     * se nota.
     */
    it("no promete revisar el interior de los flujos de contenido", async () => {
      const fuente = await import("node:fs").then((fs) =>
        fs.promises.readFile("api/src/pdf.ts", "utf8"),
      );

      expect(fuente, "se perdió la advertencia de alcance").toMatch(/no es una desinfección demostrable/i);
      expect(fuente).toMatch(/no inspecciona los flujos de contenido/i);
    });
  });
});
