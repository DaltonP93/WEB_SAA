/**
 * Escapa un término de búsqueda para un `LIKE` y lo envuelve en comodines.
 *
 * En SQL `LIKE`, `%` y `_` son comodines y `\` es el escape. Interpolar el texto
 * del usuario crudo en `%${q}%` no es inyección (knex parametriza el valor), pero
 * sí cambia la semántica: `q = "%"` matchea todo, `q = "a_b"` matchea "aXb". Se
 * escapan `\`, `%` y `_` para que el término se busque **literal**. El `\` va
 * primero para no re-escapar los que agregan los otros reemplazos.
 */
export function likeLiteral(valor: string): string {
  return `%${valor.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
