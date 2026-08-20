/**
 * Las siete áreas de horarios que el producto define.
 *
 * Igual que los ocho canales de `RESERVED_CHANNELS`, no son "datos cargados":
 * el sitio arma la página de Horarios con estas filas y el sanatorio completa
 * sus días y su horario desde el panel.
 *
 * ## Por qué existe este archivo
 *
 * Para saber que **falta** una fila hay que saber cuáles tendrían que estar.
 * Enumerar `schedules` sólo dice qué hay: si la fila de Laboratorio se perdió
 * —un dump restaurado a medias, un `DELETE` directo— recorrer la tabla la
 * declara inexistente y nadie se entera. El catálogo es lo que convierte esa
 * ausencia en un estado reportable.
 *
 * La lista vive acá y no se lee de `20260813000001_schedules.ts`. Una migración
 * es un archivo histórico: describe lo que se aplicó una vez, no lo que el
 * producto necesita hoy, y ninguna la puede importar desde código productivo
 * sin quedar atada a un momento del pasado. `tests/horarios-catalogo.test.ts`
 * compara este catálogo contra las filas que deja la cadena completa de
 * migraciones y falla si divergen, que es la garantía que hace falta.
 *
 * El `area` de acá es sólo el nombre por defecto: la fila guardada manda, y el
 * sanatorio puede renombrarla. Se usa para poder nombrar una fila que **no
 * existe** en la base.
 */
export const RESERVED_SCHEDULES: Record<string, string> = {
  emergencias: "Emergencias",
  consultorios: "Consultorios externos",
  recepcion: "Recepción / admisión",
  laboratorio: "Laboratorio (extracciones)",
  imagenes: "Estudios por imágenes",
  "retiro-estudios": "Retiro de resultados",
  visitas: "Visitas a internados",
};

export const isReservedSchedule = (key: unknown): key is string =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(RESERVED_SCHEDULES, key);
