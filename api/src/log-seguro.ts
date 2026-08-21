/**
 * Cómo se escribe una ruta y un error en los logs sin arrastrar datos de nadie.
 *
 * Los logs del servidor no son un lugar privado: los lee quien opera el VPS,
 * quedan en disco, rotan a archivos que alguien copia para diagnosticar y
 * sobreviven al registro que sí está protegido. La regla del proyecto es que
 * la información personal aparezca **sólo dentro del panel autenticado**, y un
 * log es exactamente lo contrario de eso.
 *
 * Había tres filtraciones, todas del mismo tipo: registrar un objeto entero y
 * confiar en que no traiga nada adentro.
 *
 * 1. **`req.originalUrl` completo.** El operador busca en la bandeja de Turnos
 *    escribiendo un apellido, un teléfono o un correo. Eso viaja como
 *    `?q=<dato>` y terminaba escrito tal cual en cada línea de acceso.
 *
 * 2. **El objeto de error entero.** `console.error(..., err)` imprime el
 *    `message` y todas las propiedades enumerables.
 *
 * 3. **`sql`, `sqlMessage` y los valores ya sustituidos.** Es la peor de las
 *    tres y la menos evidente. Cuando una consulta falla, mysql2 adjunta al
 *    error la sentencia **con los bindings ya reemplazados**: un `SELECT`
 *    fallido sobre la bandeja escribía en el log el `like '%<apellido>%'`, y un
 *    `INSERT` fallido sobre `appointments` escribía el nombre, el teléfono, el
 *    correo y el mensaje del paciente. Nadie lo pidió y nadie lo veía.
 *
 * Este módulo no importa nada del proyecto a propósito: lo usa `http.ts` (que
 * define `HttpError`) y también `app.ts`, y un import cruzado crearía un ciclo.
 * Por eso `HttpError` se reconoce por su `name`, que su constructor fija.
 */

/**
 * Caracteres de control.
 *
 * Un salto de línea dentro de una URL forjaría una línea de log entera: quien
 * después lea el archivo vería un evento que nunca ocurrió.
 */
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

const MAX_RUTA = 200;
const MAX_CLAVE = 40;
const MAX_NOMBRE = 48;
const MAX_MENSAJE = 160;

/** Un código de error de los que sí se pueden registrar: `ER_DUP_ENTRY`, `ECONNREFUSED`. */
const CODIGO_SEGURO = /^[A-Za-z0-9_.-]{1,48}$/;

const limpio = (valor: string, tope: number) => valor.replace(CONTROL, "").slice(0, tope);

/**
 * La ruta sin ningún valor de query, conservando los nombres de los parámetros.
 *
 * Saber que llegó un `?q=&status=&limit=` es lo que sirve para diagnosticar
 * —qué filtros se usan, cuáles nunca— y es justo la mitad que no identifica a
 * nadie. Los valores se reemplazan por un solo `…` para que quede explícito
 * que se omitieron y no que no había.
 *
 *     /api/admin/appointments?q=Rosalinda&status=pendiente
 *     → /api/admin/appointments?q,status=…
 */
export function rutaSinValores(url: unknown): string {
  const texto = typeof url === "string" ? url : "";
  const corte = texto.indexOf("?");
  const ruta = limpio(corte === -1 ? texto : texto.slice(0, corte), MAX_RUTA);
  if (corte === -1) return ruta;

  const claves = [
    ...new Set(
      texto
        .slice(corte + 1)
        .split("&")
        .map((par) => limpio(par.split("=")[0], MAX_CLAVE))
        .filter(Boolean),
    ),
  ];
  return claves.length ? `${ruta}?${claves.join(",")}=…` : ruta;
}

interface PeticionLoggeable {
  method?: unknown;
  originalUrl?: unknown;
  url?: unknown;
}

/** `GET /api/admin/appointments?q,limit=…`: método y ruta, ningún valor. */
export function rutaSegura(req: PeticionLoggeable | null | undefined): string {
  const metodo = typeof req?.method === "string" ? limpio(req.method, 10) : "?";
  const url = typeof req?.originalUrl === "string" ? req.originalUrl : req?.url;
  return `${metodo} ${rutaSinValores(url)}`;
}

/**
 * Los cuadros de la pila reducidos a `archivo:línea`.
 *
 * Es lo único de un error que sirve para arreglarlo y no depende de qué había
 * en la petición. Se descarta el directorio para no publicar la disposición
 * del servidor.
 *
 * La cabecera del stack es `Nombre: mensaje`, así que se saltan tantas líneas
 * como ocupe el mensaje. Un mensaje de **varias** líneas que incluyera algo
 * con forma de cuadro —`at loquesea:9:9`— colaría si no, hasta 40 caracteres
 * elegidos por quien escribió el mensaje. Después queda el filtro por `at`
 * como segunda defensa.
 */
function origen(err: unknown, cuantos = 3): string {
  const stack = (err as { stack?: unknown } | null)?.stack;
  if (typeof stack !== "string") return "";

  const mensaje = (err as { message?: unknown } | null)?.message;
  const cabecera = typeof mensaje === "string" && mensaje ? mensaje.split("\n").length : 1;

  const cuadros: string[] = [];
  for (const linea of stack.split("\n").slice(cabecera)) {
    const texto = linea.trim();
    if (!texto.startsWith("at ")) continue;
    const posicion = /([^()\s/\\]+):(\d+):\d+\)?$/.exec(texto);
    if (!posicion) continue;
    cuadros.push(`${limpio(posicion[1], MAX_CLAVE)}:${posicion[2]}`);
    if (cuadros.length >= cuantos) break;
  }
  return cuadros.join(" ← ");
}

/**
 * Un error reducido a lo que se puede registrar.
 *
 * Se conservan el nombre, el código y dónde ocurrió. **No** se conservan
 * `message`, `sql`, `sqlMessage`, `sqlState` ni los bindings, porque en un
 * error de base los cuatro primeros llevan la consulta con los valores dentro.
 *
 * La única excepción es `HttpError`: sus mensajes son literales escritos en
 * este repositorio —están para mostrárselos al cliente— y no interpolan nada
 * de la petición. Verificado en `tests/logs-sin-datos-personales.test.ts`, que
 * falla si alguien empieza a construirlos con una plantilla.
 */
export function errorSeguro(err: unknown): string {
  if (err === null || err === undefined) return "error desconocido";
  if (typeof err !== "object") return `no-error tipo=${typeof err}`;

  const e = err as {
    name?: unknown;
    code?: unknown;
    errno?: unknown;
    status?: unknown;
    message?: unknown;
    cause?: unknown;
  };

  const nombre = typeof e.name === "string" && e.name ? limpio(e.name, MAX_NOMBRE) : "Error";
  const partes = [nombre];

  const codigo = (valor: unknown): string | null => {
    if (typeof valor === "string" && CODIGO_SEGURO.test(valor)) return valor;
    if (typeof valor === "number") return String(valor);
    return null;
  };

  const propio = codigo(e.code);
  if (propio) partes.push(`code=${propio}`);
  if (typeof e.errno === "number") partes.push(`errno=${e.errno}`);

  // `fetch` envuelve todo en `TypeError: fetch failed` y deja el motivo real
  // —`ECONNREFUSED`, `ENOTFOUND`— en `cause`. Sin esto, un proveedor de
  // CAPTCHA caído y uno mal configurado se ven idénticos en el log.
  const causa = codigo((e.cause as { code?: unknown } | null | undefined)?.code);
  if (causa && causa !== propio) partes.push(`causa=${causa}`);

  if (nombre === "HttpError") {
    if (typeof e.status === "number") partes.push(`status=${e.status}`);
    if (typeof e.message === "string") partes.push(`«${limpio(e.message, MAX_MENSAJE)}»`);
  }

  const donde = origen(err);
  if (donde) partes.push(`en ${donde}`);

  return partes.join(" ");
}

/** Una línea de log de error: `[GET /ruta?claves=…] Nombre code=… en archivo:línea`. */
export function lineaDeError(req: PeticionLoggeable | null | undefined, err: unknown): string {
  return `[${rutaSegura(req)}] ${errorSeguro(err)}`;
}
