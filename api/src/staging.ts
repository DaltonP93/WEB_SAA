import fs from "node:fs";
import path from "node:path";
import { errorSeguro } from "./log-seguro.js";

/**
 * Dónde aterriza un archivo subido antes de ser publicado, y por qué esa
 * configuración se comprueba al arrancar y no la primera vez que alguien sube.
 *
 * El contrato del pipeline —el archivo no toca el directorio público hasta
 * estar validado, y se mueve con un `rename` atómico— descansa entero sobre
 * dos supuestos de configuración:
 *
 * 1. **staging no está debajo de `UPLOAD_DIR`.** Si lo estuviera,
 *    `express.static(UPLOAD_DIR)` lo serviría, y todo lo que subiera cualquiera
 *    quedaría publicado en una URL adivinable **antes** de validarse. Sería
 *    peor que no tener staging, porque el código diría que sí lo tiene.
 * 2. **staging y destino están en el mismo sistema de archivos.** Entre
 *    volúmenes distintos `rename` falla con `EXDEV`; habría que copiar, y una
 *    copia no es atómica: durante los milisegundos que dura, la URL sirve un
 *    archivo truncado con `Cache-Control: immutable` encima.
 *
 * Los dos dependen de `UPLOAD_DIR` y `UPLOAD_STAGING_DIR`, que se configuran en
 * el VPS. Un `.env` con un valor equivocado no rompe nada visible: la API
 * arranca, las subidas funcionan, y la garantía simplemente no existe. Por eso
 * se comprueba al arrancar y se falla fuerte: una API que no puede cumplir su
 * contrato de subidas no debe atender subidas.
 */

export class ConfiguracionInsegura extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfiguracionInsegura";
  }
}

/** ¿`hijo` está dentro de `padre` (o es el mismo)? Sobre rutas ya resueltas. */
export function estaDentro(hijo: string, padre: string): boolean {
  if (hijo === padre) return true;
  const relativa = path.relative(padre, hijo);
  // `path.relative` devuelve algo que empieza con `..` cuando hay que salir de
  // `padre` para llegar a `hijo`. Comparar prefijos de string en vez de esto
  // haría que `/srv/uploads-viejo` pareciera estar dentro de `/srv/uploads`.
  return relativa !== "" && !relativa.startsWith("..") && !path.isAbsolute(relativa);
}

export interface Directorios {
  uploads: string;
  staging: string;
}

/**
 * Crea los dos directorios y comprueba que la configuración pueda cumplir el
 * contrato. Lanza `ConfiguracionInsegura` si no.
 *
 * Las rutas se resuelven con `realpath` **después** de crearlas: sin eso un
 * enlace simbólico de staging apuntando adentro de uploads pasaría las dos
 * comprobaciones mirando rutas que no son las que el sistema usa.
 */
export function prepararDirectorios(uploadDir: string, stagingDir: string): Directorios {
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  const uploads = fs.realpathSync(uploadDir);
  const staging = fs.realpathSync(stagingDir);

  if (staging === uploads) {
    throw new ConfiguracionInsegura(
      "UPLOAD_STAGING_DIR no puede ser el mismo directorio que UPLOAD_DIR: lo que se sube quedaría publicado antes de validarse",
    );
  }
  if (estaDentro(staging, uploads)) {
    throw new ConfiguracionInsegura(
      "UPLOAD_STAGING_DIR no puede estar dentro de UPLOAD_DIR: /uploads lo serviría antes de que el archivo se valide",
    );
  }
  if (estaDentro(uploads, staging)) {
    // Al revés tampoco: el barrido de huérfanos recorre staging y borraría por
    // antigüedad archivos publicados que alguien está usando en una página.
    throw new ConfiguracionInsegura(
      "UPLOAD_DIR no puede estar dentro de UPLOAD_STAGING_DIR: el barrido de temporales borraría archivos publicados",
    );
  }

  const dispositivoDe = (ruta: string) => fs.statSync(ruta).dev;
  if (dispositivoDe(staging) !== dispositivoDe(uploads)) {
    throw new ConfiguracionInsegura(
      "UPLOAD_STAGING_DIR y UPLOAD_DIR están en sistemas de archivos distintos: el movimiento final no sería atómico",
    );
  }

  return { uploads, staging };
}

/**
 * Borra un temporal y **avisa si no pudo**.
 *
 * La versión anterior era `rm(...).catch(() => {})`: un staging que dejó de
 * poder borrarse —permisos cambiados, disco lleno, montaje de sólo lectura— se
 * llenaba en silencio hasta que fallaban las subidas por otro motivo, y el log
 * no tenía una sola línea sobre la causa real.
 *
 * Lo que se registra es sólo el nombre del archivo —un UUID que generamos
 * nosotros— y el código del error. No la ruta absoluta, que publica la
 * disposición del servidor; no el nombre original, que es el que eligió quien
 * subió el archivo.
 */
export async function borrarTemporal(ruta: string): Promise<boolean> {
  try {
    await fs.promises.rm(ruta, { force: true, recursive: true });
    return true;
  } catch (err) {
    console.error(`[media] no se pudo borrar el temporal ${path.basename(ruta)}: ${errorSeguro(err)}`);
    return false;
  }
}
