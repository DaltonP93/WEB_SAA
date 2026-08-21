import { Router, type Request } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../../db.js";
import { badRequest } from "../../http.js";
import { errorSeguro } from "../../log-seguro.js";
import { MAX_LADO, procesarSubida } from "../../imagenes.js";

/**
 * Biblioteca multimedia.
 *
 * ## El archivo no toca el directorio público hasta que se sabe qué es
 *
 * Antes multer escribía directamente en `UPLOAD_DIR`, que es lo que sirve
 * `/uploads`. Entre que el archivo se escribía y que se validaba había una
 * ventana —corta, pero real— en la que cualquier cosa subida por el panel
 * estaba publicada en una URL adivinable. Si la validación fallaba se borraba
 * después; si el proceso moría en el medio, quedaba ahí para siempre.
 *
 * Ahora el archivo aterriza en un directorio de staging que **no** está debajo
 * de `UPLOAD_DIR`, y sólo se mueve al público cuando ya se validó su
 * contenido, se procesó, se verificó el resultado y se eligió el nombre final.
 * El movimiento es un `rename` dentro del mismo sistema de archivos: o el
 * archivo está entero o no está.
 *
 * ## Nada queda a medias
 *
 * - staging se limpia siempre, incluso si la petición se corta antes de que
 *   el handler llegue a correr (`res.once("close")`);
 * - si el INSERT falla, el archivo público se borra;
 * - si no se puede escribir o mover el archivo, no se inserta la fila.
 *
 * El orden es: escribir el archivo primero, insertar después. Al revés —fila
 * primero— un fallo del disco dejaría en la biblioteca una entrada que apunta
 * a un 404, y eso no se nota hasta que alguien la usa en una página.
 */

export const mediaRouter = Router();

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");

/**
 * Staging: hermano de `UPLOAD_DIR`, no hijo.
 *
 * Hermano y no dentro, para que `express.static(UPLOAD_DIR)` no pueda
 * servirlo por ningún camino. En el mismo sistema de archivos, para que el
 * `rename` final sea atómico: entre volúmenes distintos `rename` falla con
 * `EXDEV` y habría que copiar, que ya no es atómico.
 */
const STAGING_DIR = path.resolve(
  process.env.UPLOAD_STAGING_DIR ?? path.join(path.dirname(UPLOAD_DIR), ".uploads-staging"),
);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(STAGING_DIR, { recursive: true });

const maxMB = Number(process.env.MAX_UPLOAD_MB ?? 10);

/** Cuánto puede sobrevivir un temporal huérfano antes de que lo barran. */
const VIDA_STAGING_MS = 60 * 60 * 1000;

/**
 * Se arma una vez, al arrancar, a partir de la configuración.
 *
 * Los mensajes de `HttpError` se registran en los logs porque son literales
 * nuestros y no traen nada de la petición (ver `api/src/log-seguro.ts`). Para
 * que eso siga siendo cierto y comprobable, la interpolación vive acá y no
 * dentro de la llamada a `badRequest`.
 */
const EXCEDE_PESO = `el archivo supera el máximo de ${maxMB} MB`;

const olvidar = (ruta: string) => fs.promises.rm(ruta, { force: true }).catch(() => {});

/**
 * Barrido de huérfanos al arrancar.
 *
 * `res.once("close")` cubre la petición que se corta; no cubre que el proceso
 * muera entre que multer escribe y el handler limpia. Sin esto, staging crece
 * en silencio hasta llenar el disco.
 */
export async function limpiarStagingViejo(ahora = Date.now()): Promise<number> {
  let borrados = 0;
  let entradas: string[];
  try {
    entradas = await fs.promises.readdir(STAGING_DIR);
  } catch {
    return 0;
  }
  for (const nombre of entradas) {
    const ruta = path.join(STAGING_DIR, nombre);
    try {
      const stat = await fs.promises.stat(ruta);
      if (ahora - stat.mtimeMs < VIDA_STAGING_MS) continue;
      await fs.promises.rm(ruta, { force: true, recursive: true });
      borrados++;
    } catch {
      // Otro proceso lo borró en el medio: no hay nada que hacer.
    }
  }
  return borrados;
}

/** Los temporales que esta petición creó, para poder limpiarlos pase lo que pase. */
interface ConStaging extends Request {
  temporales?: string[];
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STAGING_DIR),
  filename: (req, _file, cb) => {
    // El nombre original no entra ni acá. Sanearlo no alcanza: dos personas
    // suben `logo.png` el mismo milisegundo y `Date.now()-logo.png` colisiona,
    // con lo que la segunda pisa a la primera. Un UUID no colisiona y además
    // no filtra cómo se llamaba el archivo en la computadora de nadie.
    const nombre = `${randomUUID()}.part`;
    (req as ConStaging).temporales?.push(path.join(STAGING_DIR, nombre));
    cb(null, nombre);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: maxMB * 1024 * 1024, files: 1 },
});

/**
 * Prepara la limpieza **antes** que multer.
 *
 * Se registra sobre `res` y no sobre el final del handler porque una petición
 * abortada a mitad de la subida no llega nunca al handler: multer aborta el
 * stream y el temporal queda escrito.
 */
function conStaging(req: ConStaging, res: import("express").Response, next: import("express").NextFunction) {
  req.temporales = [];
  res.once("close", () => {
    for (const ruta of req.temporales ?? []) void olvidar(ruta);
  });
  next();
}

const altSchema = z.string().trim().max(255).optional();

mediaRouter.get("/", async (_req, res) => {
  res.json(await db("media").orderBy("created_at", "desc"));
});

mediaRouter.post("/", conStaging, upload.single("file"), async (req: ConStaging, res) => {
  if (!req.file) throw badRequest("archivo requerido");

  const alt = altSchema.safeParse(req.body?.alt);
  if (!alt.success) throw badRequest("texto alternativo invalido");

  let fila: unknown;
  try {
    const resultado = await procesarSubida(req.file.path);
    if (!resultado.ok) throw badRequest(resultado.error);

    const { archivo } = resultado;
    const nombre = `${randomUUID()}${archivo.ext}`;
    const enStaging = path.join(STAGING_DIR, nombre);
    const publico = path.join(UPLOAD_DIR, nombre);
    req.temporales?.push(enStaging);

    // Se escribe primero en staging y recién ahí se mueve: `writeFile` sobre
    // el directorio público publicaría un archivo a medio escribir mientras
    // dura la escritura, y una petición a esa URL en ese instante recibiría
    // bytes truncados con `Cache-Control: immutable` encima.
    await fs.promises.writeFile(enStaging, archivo.bytes);
    await fs.promises.rename(enStaging, publico);

    const url = `/uploads/${nombre}`;
    try {
      const [id] = await db("media").insert({
        url,
        mime: archivo.mime,
        size: archivo.bytes.length,
        width: archivo.width,
        height: archivo.height,
        frames: archivo.frames,
        alt: alt.data && alt.data.length > 0 ? alt.data : null,
        uploaded_by: req.user?.id ?? null,
      });
      fila = await db("media").where({ id }).first();
    } catch (err) {
      // La fila no existe: el archivo público tampoco puede quedar. Sin esto,
      // cada INSERT fallido dejaba un archivo servible que nadie iba a borrar
      // porque nadie sabía que estaba.
      await olvidar(publico);
      console.error(`[media] no se pudo registrar el archivo: ${errorSeguro(err)}`);
      throw err;
    }
  } finally {
    // `res.once("close")` también limpia, pero corre después de responder.
    // Limpiar acá, y **antes** de contestar, hace que el 201 signifique que ya
    // no queda nada en staging: si se respondiera primero, quien recibe el 201
    // podría mirar el disco y todavía ver el temporal.
    for (const ruta of req.temporales ?? []) await olvidar(ruta);
  }

  res.status(201).json(fila);
});

/**
 * Los errores de multer son de forma, no del servidor.
 *
 * Sin esto, subir un archivo de 20 MB con el tope en 10 devolvía **500 "error
 * interno"**: el manejador global convierte en 500 todo lo que no sea
 * `HttpError`, y quien subía no tenía forma de saber que el problema era el
 * peso. Va antes del manejador global porque es específico de este router.
 */
mediaRouter.use((
  err: unknown,
  _req: import("express").Request,
  _res: import("express").Response,
  next: import("express").NextFunction,
) => {
  const codigo = (err as { code?: string } | null)?.code;
  if (codigo === "LIMIT_FILE_SIZE") {
    return next(badRequest(EXCEDE_PESO));
  }
  if (codigo === "LIMIT_FILE_COUNT" || codigo === "LIMIT_UNEXPECTED_FILE") {
    return next(badRequest("subí un solo archivo en el campo «file»"));
  }
  next(err);
});

mediaRouter.delete("/:id", async (req, res) => {
  const row = await db("media").where({ id: req.params.id }).first();
  if (row) {
    // `basename` y no la URL entera: un `url` con `../` apuntaría fuera de
    // `UPLOAD_DIR`.
    const fp = path.join(UPLOAD_DIR, path.basename(row.url));
    await olvidar(fp);
    await db("media").where({ id: row.id }).del();
  }
  res.status(204).end();
});

/** Lo que el panel muestra como límites, para no tener dos versiones del contrato. */
export const LIMITES = {
  maxMB,
  maxLado: MAX_LADO,
  formatos: ["JPG", "PNG", "WebP", "GIF", "PDF"],
};
