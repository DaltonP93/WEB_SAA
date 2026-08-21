/**
 * Fechas en la zona del sanatorio, no en la del navegador.
 *
 * `toLocaleString()` sin zona usa la del equipo que abre el panel. Una
 * recepcionista viajando, un navegador mal configurado o un servidor de
 * escritorio remoto en otra zona alcanzan para que la misma solicitud se lea
 * con una hora distinta según quién mire — y para que el operador coordine un
 * turno equivocado.
 *
 * La zona es la misma que aplica la API en `api/src/timezone.ts`, y
 * `tests/turnos-zona-horaria.test.ts` comprueba que las dos digan lo mismo:
 * si una cambia y la otra no, la bandeja mostraría una hora que la base no
 * guardó.
 */
export const ZONA_INSTITUCIONAL = "America/Asuncion";

const dosDigitos = (n: number) => String(n).padStart(2, "0");

/** `15/03/2027 10:30` en hora de Asunción. Vacío si no hay fecha. */
export function formatearEnZona(valor: string | Date | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const instante = valor instanceof Date ? valor : new Date(valor);
  if (!Number.isFinite(instante.getTime())) return "";

  const partes: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_INSTITUCIONAL,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instante)) {
    if (p.type !== "literal") partes[p.type] = p.value;
  }
  const hora = partes.hour === "24" ? "00" : partes.hour;
  return `${partes.day}/${partes.month}/${partes.year} ${dosDigitos(Number(hora))}:${partes.minute}`;
}
