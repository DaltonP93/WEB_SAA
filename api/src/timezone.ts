/**
 * Zona horaria institucional del sanatorio.
 *
 * ## El problema que resuelve
 *
 * El `<input type="datetime-local">` manda una fecha **sin offset**:
 * `"2027-03-15T10:30"`. `new Date(ese_valor)` la interpreta en la zona del
 * proceso, así que la hora que se guarda depende de cómo esté configurado el
 * VPS. Un servidor en UTC guarda las 10:30 UTC —las 07:30 de Asunción— para un
 * paciente que eligió las 10:30 de la mañana. Nadie se entera: la fila tiene
 * una hora perfectamente plausible y equivocada, y lo mismo pasa con los
 * límites de los filtros por fecha.
 *
 * Acá la zona es **explícita y única**. La hora preferida de un turno es la
 * hora local del sanatorio, no la zona accidental de la máquina que corre la
 * API.
 *
 * ## Por qué la zona IANA y no un offset fijo
 *
 * Paraguay dejó de cambiar la hora en 2024, así que hoy `-03:00` daría el
 * mismo resultado. Pero un offset escrito a mano es una afirmación sobre el
 * futuro y sobre el pasado: no sabe de los años en que sí hubo horario de
 * verano ni de un cambio que se decida más adelante. `America/Asuncion` deja
 * que esas reglas las resuelva la base de datos de zonas del sistema, que se
 * actualiza sola.
 *
 * ## Cómo se calcula sin dependencias
 *
 * `Intl.DateTimeFormat` sabe traducir un instante a la hora de pared de una
 * zona. Con eso se obtiene el desfase de ese instante, y de ahí se despeja el
 * camino inverso —de hora de pared a instante— con una segunda pasada que
 * corrige los saltos de horario de verano.
 */

export const ZONA_INSTITUCIONAL = "America/Asuncion";

const partesEnZona = (instante: Date, zona: string): Record<string, number> => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of dtf.formatToParts(instante)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  // `hour12: false` puede devolver 24 para la medianoche según el motor.
  if (out.hour === 24) out.hour = 0;
  return out;
};

/** Desfase de la zona respecto de UTC, en milisegundos, para ese instante. */
function desfase(instante: Date, zona: string): number {
  const p = partesEnZona(instante, zona);
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return comoUtc - instante.getTime();
}

/**
 * Instante correspondiente a una hora de pared de la zona institucional.
 *
 * La segunda pasada no es decorativa: en un salto de horario de verano el
 * desfase de la primera estimación puede no ser el del instante real, y sin
 * corregirlo la conversión se va una hora justo los dos días del año en que
 * más se nota.
 */
function instanteDesdePared(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  s = 0,
  zona = ZONA_INSTITUCIONAL,
): Date {
  const comoSiFueraUtc = Date.UTC(y, m - 1, d, h, min, s);
  const primera = comoSiFueraUtc - desfase(new Date(comoSiFueraUtc), zona);
  const segunda = comoSiFueraUtc - desfase(new Date(primera), zona);
  return new Date(segunda);
}

const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * ¿El instante calculado corresponde a la fecha que se pidió?
 *
 * `Date.UTC` normaliza en silencio: el mes 13 pasa a enero del año siguiente y
 * el 30 de febrero al 1 o 2 de marzo. Sin esta comprobación, `"2020-13-40"`
 * devolvía un límite perfectamente válido para una fecha que no existe, y el
 * filtro traía las solicitudes de otro mes sin que nada avisara.
 */
function correspondeA(instante: Date, y: number, m: number, d: number): boolean {
  const p = partesEnZona(instante, ZONA_INSTITUCIONAL);
  // Se compara el día del calendario y no la hora: en el salto de horario de
  // verano hay horas que no existen, y ahí la conversión cae en la siguiente a
  // propósito. Que la hora se corra una unidad es correcto; que se corra el
  // día es un valor inventado.
  return p.year === y && p.month === m && p.day === d;
}

/**
 * Interpreta lo que manda un `<input type="datetime-local">`.
 *
 * Devuelve `null` para vacío y `undefined` para algo que no es una fecha, para
 * que quien llama pueda distinguir "no cargó nada" de "cargó cualquier cosa".
 * Un valor que sí trae offset (`…Z`, `…-03:00`) se respeta tal cual: ya dice
 * a qué instante se refiere y no hay nada que suponer.
 */
export function instanteDesdeHoraLocal(valor: string | undefined | null): Date | null | undefined {
  if (valor === undefined || valor === null || valor.trim() === "") return null;
  const texto = valor.trim();

  const m = NAIVE.exec(texto);
  if (m) {
    const [, y, mes, d, h, min, s] = m;
    if (+mes < 1 || +mes > 12 || +d < 1 || +d > 31 || +h > 23 || +min > 59) return undefined;
    const fecha = instanteDesdePared(+y, +mes, +d, +h, +min, s ? +s : 0);
    if (!Number.isFinite(fecha.getTime())) return undefined;
    return correspondeA(fecha, +y, +mes, +d) ? fecha : undefined;
  }

  const conOffset = new Date(texto);
  return Number.isFinite(conOffset.getTime()) ? conOffset : undefined;
}

/** Medianoche de esa fecha en la zona institucional. */
export function inicioDelDia(fecha: string): Date | undefined {
  const m = SOLO_FECHA.exec(fecha.trim());
  if (!m) return undefined;
  const [, y, mes, d] = m;
  if (+mes < 1 || +mes > 12 || +d < 1 || +d > 31) return undefined;
  const inicio = instanteDesdePared(+y, +mes, +d, 0, 0, 0);
  if (!Number.isFinite(inicio.getTime())) return undefined;
  return correspondeA(inicio, +y, +mes, +d) ? inicio : undefined;
}

/**
 * Medianoche del día siguiente, para usar con `<` en vez de `<= 23:59:59.999`.
 *
 * El milisegundo 999 deja fuera lo que caiga en el último milisegundo del día
 * —una columna `DATETIME(3)` puede guardarlo— y además obliga a razonar sobre
 * la precisión de la columna. Un límite abierto por arriba no depende de eso.
 */
export function inicioDelDiaSiguiente(fecha: string): Date | undefined {
  const inicio = inicioDelDia(fecha);
  if (!inicio) return undefined;
  const p = partesEnZona(inicio, ZONA_INSTITUCIONAL);
  // Se suma un día **al calendario**, no 24 h al instante: en un cambio de
  // horario el día dura 23 o 25 horas y sumar milisegundos cae en la hora
  // equivocada. `Date.UTC` normaliza el desborde de mes y de año, así que el
  // 31 de diciembre + 1 es el 1 de enero sin ningún caso especial.
  return instanteDesdePared(p.year, p.month, p.day + 1, 0, 0, 0);
}

const dosDigitos = (n: number) => String(n).padStart(2, "0");

/** `15/03/2027 10:30` en hora de Asunción. Vacío si no hay fecha. */
export function formatearEnZona(valor: Date | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const instante = valor instanceof Date ? valor : new Date(valor);
  if (!Number.isFinite(instante.getTime())) return "";
  const p = partesEnZona(instante, ZONA_INSTITUCIONAL);
  return `${dosDigitos(p.day)}/${dosDigitos(p.month)}/${p.year} ${dosDigitos(p.hour)}:${dosDigitos(p.minute)}`;
}
