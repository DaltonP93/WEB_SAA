import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";

/**
 * Saneo de PDF: qué se le quita y por qué no alcanzaba con validarlo.
 *
 * La ronda anterior reemplazó la detección por cinco bytes por una validación
 * estructural real, y documentó honestamente que **validar no es sanear**: los
 * bytes se guardaban como llegaban. Un PDF válido puede traer:
 *
 * | Qué | Qué hace |
 * |---|---|
 * | `/OpenAction` | se ejecuta **al abrir**, sin que nadie haga clic |
 * | `/AA` (additional actions) | se ejecuta al pasar de página, al imprimir, al cerrar |
 * | `/Names /JavaScript` | JavaScript a nivel documento |
 * | `/EmbeddedFiles` | archivos adjuntos dentro del PDF |
 * | `/Launch`, `/SubmitForm`, `/ImportData` | abren programas, mandan datos a un servidor |
 * | `/AcroForm` con acciones | lo mismo, disparado por un campo |
 *
 * Un lector de PDF razonable pregunta antes de ejecutar. "Razonable" no es una
 * garantía que podamos dar sobre el visor de un paciente, y el archivo lo sirve
 * el sanatorio desde su propio dominio: si hace algo, lo hizo el sanatorio.
 *
 * ## Qué se conserva
 *
 * Las páginas y su contenido: texto, imágenes, vectores, tipografías. Un
 * protocolo o un formulario impreso sigue siendo legible e imprimible. Lo que
 * se pierde son comportamientos, no contenido.
 *
 * ## Qué **no** hace esto
 *
 * No inspecciona los flujos de contenido de cada página en busca de un
 * `/JavaScript` incrustado a mano en un objeto suelto, ni reescribe el archivo
 * desde cero. Es una limpieza de las vías conocidas de ejecución sobre un
 * documento que además ya pasó una validación estructural. Es sustancialmente
 * más que antes y no es una desinfección demostrable: si algún día se publican
 * PDFs de origen no confiable, corresponde revisarlo de nuevo.
 */

/** Entradas del catálogo que sólo existen para que algo pase al abrir. */
const DEL_CATALOGO = ["OpenAction", "AA", "AcroForm", "Names", "JavaScript", "EmbeddedFiles"] as const;

/** Entradas de cada página que disparan acciones. */
const DE_LA_PAGINA = ["AA", "Annots"] as const;

export interface PdfSaneado {
  bytes: Buffer;
  paginas: number;
  /** Qué se le quitó, para poder afirmarlo en una prueba y en el log. */
  quitado: string[];
}

export type ResultadoPdf = { ok: true; pdf: PdfSaneado } | { ok: false; error: string };

/**
 * Valida estructuralmente y sanea.
 *
 * `throwOnInvalidObject` endurece el parseo **y lo silencia**: sin esa opción
 * pdf-lib escribe por consola avisos con posiciones y fragmentos del archivo,
 * que es justo lo que los logs no pueden llevar.
 */
export async function sanearPdf(bytes: Buffer): Promise<ResultadoPdf> {
  let documento: PDFDocument;
  let paginas: number;
  try {
    documento = await PDFDocument.load(bytes, {
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    // `getPageCount()` va **dentro** del try: un archivo que parsea pero no
    // tiene catálogo revienta acá y no en `load`. Fuera del try, un `%PDF-`
    // seguido de basura salía como 500 "error interno" en vez de un 400 que
    // explica que no es un PDF.
    paginas = documento.getPageCount();
  } catch {
    // El error de pdf-lib trae línea, columna y desplazamiento del archivo.
    // Nada de eso vuelve al cliente ni al log.
    return { ok: false, error: "el archivo no es un PDF válido" };
  }

  // Un archivo que parsea pero no tiene ni una página no es un documento: es
  // un encabezado con algo detrás.
  if (paginas < 1) return { ok: false, error: "el PDF no tiene ninguna página" };

  const quitado: string[] = [];

  /**
   * Quita una entrada y **anota que la quitó**, salvo que estuviera vacía.
   *
   * La excepción no es cosmética. Una página creada por cualquier biblioteca
   * —pdf-lib incluida— trae `/Annots []`: la clave existe y no contiene nada.
   * Contarla haría que un PDF perfectamente limpio informara "se le quitó una
   * anotación", y `quitado` es justamente lo que se usa para afirmar qué traía
   * el archivo. Un informe que dice de más sobre un archivo inocente vale tan
   * poco como uno que calla sobre uno peligroso.
   *
   * La entrada vacía se borra igual: no cuesta nada y deja la salida uniforme.
   */
  const quitarDe = (dict: PDFDict, claves: readonly string[], prefijo: string) => {
    for (const clave of claves) {
      const nombre = PDFName.of(clave);
      const valor = dict.get(nombre);
      if (valor === undefined) continue;
      dict.delete(nombre);
      if (valor instanceof PDFArray && valor.size() === 0) continue;
      quitado.push(`${prefijo}/${clave}`);
    }
  };

  let salida: Uint8Array;
  try {
    /**
     * Todo lo peligroso se corta **del documento de origen y antes de copiar**.
     *
     * El orden no es un detalle de estilo: es la diferencia entre sanear y
     * aparentarlo. `copyPages` copia lo que **alcanza desde la página**, así
     * que una anotación `/Launch` que todavía cuelga de `/Annots` viaja al
     * documento nuevo, y borrarla después deja el objeto registrado y huérfano
     * —que `save()` escribe igual—. Medido con una prueba: cortando después,
     * la ruta del programa a lanzar seguía en los bytes de salida.
     *
     * Es el mismo mecanismo que ya obligaba a reconstruir el documento en vez
     * de editarlo: quitar la referencia no quita el objeto.
     *
     * Cortar antes tiene además una segunda virtud: `quitado` describe lo que
     * traía **el original**. Cortando sobre las copias, pdf-lib ya les había
     * puesto un `/Annots` vacío propio, y el informe decía haber quitado una
     * anotación de un PDF que nunca tuvo ninguna.
     */
    quitarDe(documento.catalog, DEL_CATALOGO, "catálogo");
    for (const [i, pagina] of documento.getPages().entries()) {
      // `/Annots` se quita entero y no sólo las anotaciones con acción: una
      // anotación de enlace puede llevar `/A /Launch`, y distinguir "enlace
      // inofensivo" de "enlace que abre un programa" objeto por objeto es
      // exactamente el análisis parcial que deja pasar el caso raro. Un
      // protocolo institucional no depende de sus anotaciones para leerse.
      quitarDe(pagina.node, DE_LA_PAGINA, `página ${i + 1}`);
    }

    /**
     * El documento se **reconstruye**, no se edita.
     *
     * Borrar `/OpenAction` del catálogo quita la *referencia*, pero el objeto
     * con el JavaScript sigue en el archivo como objeto huérfano: `save()`
     * escribe todos los objetos registrados, los apunte alguien o no. Un lector
     * que siga el catálogo nunca lo ejecutaría, pero el payload seguiría ahí —
     * y llamar "saneado" a un archivo que todavía contiene el código es
     * exactamente la clase de media verdad que este proyecto no publica.
     * Medido: tras borrar la referencia, la cadena `JavaScript` seguía en los
     * bytes.
     *
     * `copyPages` recorre el árbol de páginas y copia **sólo lo que las
     * páginas necesitan**: contenido, tipografías, imágenes, recursos. Lo que
     * cuelga del catálogo y no de una página —acciones, adjuntos, nombres,
     * formularios— no tiene por dónde llegar.
     *
     * Se pierden también el índice, los metadatos y los marcadores. En un
     * protocolo institucional eso no es contenido: es navegación que se puede
     * rehacer, a cambio de una garantía que sí se puede afirmar.
     */
    const limpio = await PDFDocument.create();
    const copiadas = await limpio.copyPages(documento, documento.getPageIndices());
    for (const pagina of copiadas) limpio.addPage(pagina);

    // `useObjectStreams: false` produce un archivo más grande y más simple de
    // inspeccionar. En un PDF institucional de pocas páginas la diferencia de
    // tamaño no importa; poder abrirlo con un editor y ver qué quedó, sí.
    salida = await limpio.save({ useObjectStreams: false });
  } catch {
    return { ok: false, error: "no se pudo sanear el PDF" };
  }

  return { ok: true, pdf: { bytes: Buffer.from(salida), paginas, quitado } };
}
