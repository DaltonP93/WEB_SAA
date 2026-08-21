import fs from "node:fs";
import sharp from "sharp";
import type { Metadata, Sharp } from "sharp";

/**
 * Qué se acepta subir, qué se le hace y qué se garantiza al guardarlo.
 *
 * El pipeline anterior daba por buenos el `originalname` y el `mimetype` que
 * mandaba el navegador —los dos los elige quien sube— y después convertía a
 * JPEG todo lo que no fuera un PNG con alpha, **sin cambiar la extensión ni el
 * MIME**. El resultado eran filas y archivos que se contradecían entre sí:
 *
 * - un `.webp` con bytes JPEG y `mime: image/webp` en la base;
 * - un `.gif` animado reducido a su primer cuadro, todavía llamado `.gif`;
 * - un PNG con transparencia que sobrevivía y un WebP con transparencia que no,
 *   sin ninguna razón visible;
 * - logos horizontales rechazados por un mínimo de 200 px en **ambos** ejes,
 *   que es una regla pensada para fotos de perfil aplicada a todo.
 *
 * Nada de eso fallaba: producía archivos plausibles y equivocados, que es la
 * clase de error que sobrevive a una revisión.
 *
 * ## Las tres reglas
 *
 * 1. **El formato lo dicen los bytes.** Primero la firma del archivo, después
 *    libvips. Si los dos no coinciden, se rechaza.
 * 2. **Bytes, extensión y MIME cambian juntos o no cambia ninguno.** No puede
 *    existir un `.gif` con contenido JPEG.
 * 3. **Lo que entra animado o transparente sale animado o transparente.**
 *    Verificado sobre el archivo resultante, no sobre la intención.
 */

export type Formato = "jpeg" | "png" | "webp" | "gif" | "pdf";

interface Perfil {
  mime: string;
  ext: string;
}

export const FORMATOS: Record<Formato, Perfil> = {
  jpeg: { mime: "image/jpeg", ext: ".jpg" },
  png: { mime: "image/png", ext: ".png" },
  webp: { mime: "image/webp", ext: ".webp" },
  gif: { mime: "image/gif", ext: ".gif" },
  pdf: { mime: "application/pdf", ext: ".pdf" },
};

/** Lado mayor al que se reduce. No se agranda nunca lo que ya es más chico. */
export const MAX_LADO = 1600;

/**
 * Techo de píxeles **decodificados**, sumando todos los cuadros.
 *
 * El límite de peso no alcanza: un PNG de un color plano de 20 000 × 20 000 px
 * ocupa unos pocos KB comprimido y 1,6 GB en memoria al abrirlo. libvips lo
 * rechaza antes de decodificar cuando se le pasa `limitInputPixels`, así que
 * el tope se aplica ahí y no después de haber reservado la memoria.
 *
 * 30 MP deja pasar cualquier cámara actual (6000 × 5000) y acota el pico a
 * ~120 MB por petición.
 */
export const MAX_PIXELES = 30_000_000;

/**
 * Mínimos de la imagen, pensados para que un logo horizontal entre.
 *
 * El mínimo anterior era 200 px en ancho **y** alto, con lo que un logo de
 * 400 × 80 —la forma normal de un logo— se rechazaba con un mensaje sobre
 * calidad. Lo que hay que descartar son las imágenes degeneradas: un píxel
 * suelto, un espaciador de 3 × 1. Se pide un lado mínimo chico y un área
 * mínima, y eso deja pasar tanto un logo apaisado como un banner finito.
 */
export const MIN_LADO = 16;
export const MIN_PIXELES = 1024;

/**
 * Cuántos píxeles decodificados por byte de archivo se consideran normales.
 *
 * Sólo se aplica por encima de `PISO_BOMBA`: un logo plano y chico comprime
 * muchísimo y es legítimo. Lo que no lo es: 40 MP que pesan 30 KB.
 */
const MAX_PIXELES_POR_BYTE = 200;
const PISO_BOMBA = 8_000_000;

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * El formato según los primeros bytes del archivo.
 *
 * Es la primera de las dos comprobaciones: descarta lo que ni siquiera dice
 * ser una imagen y separa el PDF, que no puede pasar por libvips.
 */
export function formatoPorFirma(cabecera: Buffer): Formato | null {
  if (cabecera.length >= 3 && cabecera[0] === 0xff && cabecera[1] === 0xd8 && cabecera[2] === 0xff) return "jpeg";
  if (cabecera.subarray(0, 8).equals(FIRMA_PNG)) return "png";
  const seis = cabecera.subarray(0, 6).toString("latin1");
  if (seis === "GIF87a" || seis === "GIF89a") return "gif";
  if (
    cabecera.subarray(0, 4).toString("latin1") === "RIFF" &&
    cabecera.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  if (cabecera.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  return null;
}

export interface ArchivoProcesado {
  bytes: Buffer;
  formato: Formato;
  /** El MIME que corresponde a los bytes, no el que mandó el navegador. */
  mime: string;
  /** La extensión que corresponde a los bytes. */
  ext: string;
  /** Dimensiones de **un** cuadro. `null` para PDF. */
  width: number | null;
  height: number | null;
  /** Cuadros: 1 en una imagen fija, `null` en un PDF. */
  frames: number | null;
  animated: boolean;
}

export type Resultado = { ok: true; archivo: ArchivoProcesado } | { ok: false; error: string };

const rechazo = (error: string): Resultado => ({ ok: false, error });

/**
 * Valida y normaliza un archivo que todavía está en el área de staging.
 *
 * Devuelve los bytes finales en memoria: quien llama decide dónde escribirlos.
 * Así el archivo público se crea recién cuando ya se sabe que es válido, con
 * qué nombre y con qué MIME, y no antes.
 */
export async function procesarSubida(ruta: string): Promise<Resultado> {
  let cabecera: Buffer;
  let tamano: number;
  try {
    const fd = await fs.promises.open(ruta, "r");
    try {
      const buffer = Buffer.alloc(16);
      await fd.read(buffer, 0, 16, 0);
      cabecera = buffer;
      tamano = (await fd.stat()).size;
    } finally {
      await fd.close();
    }
  } catch {
    return rechazo("no se pudo leer el archivo");
  }

  const firma = formatoPorFirma(cabecera);
  if (!firma) return rechazo("formato no permitido: usá JPG, PNG, WebP, GIF o PDF");
  if (firma === "pdf") return procesarPdf(ruta);
  return procesarImagen(ruta, firma, tamano);
}

/**
 * El PDF no pasa por libvips.
 *
 * libvips puede abrir PDFs si se compiló con poppler, y abrir un PDF es
 * ejecutar un intérprete sobre un archivo que subió cualquiera. No hay nada
 * que optimizar en un PDF institucional, así que se valida la firma y se
 * guarda tal cual.
 */
async function procesarPdf(ruta: string): Promise<Resultado> {
  const bytes = await fs.promises.readFile(ruta);
  // Relectura sobre el archivo entero: la firma ya se miró, pero acá se
  // confirma sobre los mismos bytes que se van a guardar.
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return rechazo("pdf invalido");
  return {
    ok: true,
    archivo: {
      bytes,
      formato: "pdf",
      mime: FORMATOS.pdf.mime,
      ext: FORMATOS.pdf.ext,
      width: null,
      height: null,
      frames: null,
      animated: false,
    },
  };
}

/** Abre siempre con todos los cuadros y con el tope de píxeles puesto. */
const abrir = (entrada: string | Buffer) =>
  sharp(entrada, { animated: true, limitInputPixels: MAX_PIXELES, failOn: "error" });

async function procesarImagen(ruta: string, firma: Formato, tamano: number): Promise<Resultado> {
  let meta: Metadata;
  try {
    meta = await abrir(ruta).metadata();
  } catch (err) {
    // `limitInputPixels` corta acá, antes de reservar la memoria.
    if (/pixel limit/i.test((err as Error)?.message ?? "")) {
      return rechazo("la imagen tiene demasiados píxeles para procesarla");
    }
    return rechazo("imagen invalida");
  }

  // La segunda comprobación: lo que dijo la firma tiene que ser lo que
  // libvips efectivamente decodificó. Un archivo con cabecera de PNG y cuerpo
  // de otra cosa se cae acá.
  if (meta.format !== firma) return rechazo("el contenido del archivo no coincide con su formato");
  if (!meta.width || !meta.height) return rechazo("imagen invalida");

  const frames = meta.pages && meta.pages > 0 ? meta.pages : 1;
  // Con `animated: true` la altura es la de **todos** los cuadros apilados;
  // `pageHeight` es la de uno. Medir la imagen con la altura total daría un
  // GIF de 10 cuadros por diez veces más alto de lo que se ve.
  const alto = meta.pageHeight ?? meta.height;
  const ancho = meta.width;
  const animada = frames > 1;

  if (ancho < MIN_LADO || alto < MIN_LADO || ancho * alto < MIN_PIXELES) {
    return rechazo(`imagen demasiado pequeña (${ancho}×${alto} px)`);
  }

  const pixeles = ancho * alto * frames;
  if (pixeles > MAX_PIXELES) return rechazo("la imagen tiene demasiados píxeles para procesarla");
  if (pixeles > PISO_BOMBA && tamano > 0 && pixeles / tamano > MAX_PIXELES_POR_BYTE) {
    return rechazo("la imagen se expande demasiado al descomprimirla");
  }

  const necesitaAchicar = ancho > MAX_LADO || alto > MAX_LADO;

  let bytes: Buffer;
  try {
    let tuberia = abrir(ruta);
    // `rotate()` aplica la orientación del EXIF. En una imagen animada haría
    // girar cada cuadro por una etiqueta que estos formatos no llevan.
    if (!animada) tuberia = tuberia.rotate();
    if (necesitaAchicar) {
      tuberia = tuberia.resize({
        width: MAX_LADO,
        height: MAX_LADO,
        fit: "inside",
        // Agrandar una imagen chica no le agrega información: le agrega peso
        // y un desenfoque que antes no tenía.
        withoutEnlargement: true,
      });
    }
    bytes = await codificar(tuberia, firma).toBuffer();
  } catch {
    return rechazo("no se pudo procesar la imagen");
  }

  return verificar(bytes, firma, frames, animada);
}

/**
 * Cada formato se reescribe **como sí mismo**.
 *
 * No hay conversión: la regla 2 dice que si los bytes cambian de formato
 * tienen que cambiar la extensión y el MIME con ellos, y acá no hace falta
 * cambiar de formato para nada. Un WebP recomprimido sigue siendo un WebP.
 * Ninguno de estos llamados conserva metadatos —sharp los descarta salvo que
 * se le pida lo contrario—, así que el EXIF de una foto no llega al sitio.
 */
function codificar(tuberia: Sharp, formato: Formato): Sharp {
  switch (formato) {
    case "jpeg":
      return tuberia.jpeg({ quality: 85, progressive: true, mozjpeg: true });
    case "png":
      // Sin `palette: true`: cuantizar a 256 colores achica el archivo y
      // cambia la imagen, y en un logo con degradado se nota.
      return tuberia.png({ compressionLevel: 9 });
    case "webp":
      return tuberia.webp({ quality: 85 });
    case "gif":
      return tuberia.gif();
    default:
      return tuberia;
  }
}

/**
 * Se relee el resultado antes de darlo por bueno.
 *
 * Es lo que separa "le pedimos a sharp que conservara los cuadros" de "los
 * cuadros están". Si una versión de libvips dejara de escribir GIF animado, o
 * escribiera otro formato del pedido, esto lo detecta y el archivo se rechaza
 * en vez de guardarse mal.
 */
async function verificar(
  bytes: Buffer,
  esperado: Formato,
  framesOriginales: number,
  animada: boolean,
): Promise<Resultado> {
  let meta: Metadata;
  try {
    meta = await abrir(bytes).metadata();
  } catch {
    return rechazo("el archivo procesado no se pudo verificar");
  }

  if (meta.format !== esperado) return rechazo("el archivo procesado cambió de formato");
  if (!meta.width || !meta.height) return rechazo("el archivo procesado no se pudo verificar");

  const frames = meta.pages && meta.pages > 0 ? meta.pages : 1;
  if (animada && frames !== framesOriginales) {
    // Nunca se guarda un animado aplastado a su primer cuadro con el nombre
    // del original: o están todos los cuadros, o no se guarda.
    return rechazo("no se pudieron conservar todos los cuadros de la animación");
  }

  return {
    ok: true,
    archivo: {
      bytes,
      formato: esperado,
      mime: FORMATOS[esperado].mime,
      ext: FORMATOS[esperado].ext,
      width: meta.width,
      height: meta.pageHeight ?? meta.height,
      frames,
      animated: frames > 1,
    },
  };
}
