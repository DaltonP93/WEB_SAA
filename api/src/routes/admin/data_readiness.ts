import { Router } from "express";
import { db } from "../../db.js";
import { isValidChannelValue, type ContactChannelKind } from "../../contact-values.js";
import { RESERVED_CHANNELS } from "./contact_channels.js";
import { RESERVED_SCHEDULES } from "../../institutional-schedules.js";

/**
 * `GET /api/admin/data-readiness` — qué falta para que el sitio deje de decir
 * "a confirmar".
 *
 * Contrato completo en `docs/DATOS-PENDIENTES-CONTRATO.md`. Lo que importa acá:
 *
 * - **Es de sólo lectura por diseño.** No escribe, no migra, no repara y no
 *   toca marcas de tiempo. Un diagnóstico que además "arregla lo que puede"
 *   convierte una consulta en una escritura que nadie pidió, y sobre datos
 *   institucionales eso es exactamente lo que este proyecto viene evitando.
 * - **No devuelve datos, devuelve estados.** Ni teléfonos, ni correos, ni
 *   horarios, ni días, ni notas, ni el contenido de ningún snapshot. Una
 *   pantalla que sirve para saber qué falta no necesita mostrar lo que ya está:
 *   repetirlo acá lo copia a la caché del navegador, a los logs y a las
 *   capturas de pantalla de soporte sin ninguna necesidad.
 * - **Los catálogos no se duplican.** Los canales salen de `RESERVED_CHANNELS`
 *   —el mismo que aplica el 403 en el CRUD— y los horarios de
 *   `RESERVED_SCHEDULES`. Agregar una clave allá la incorpora acá sin tocar
 *   este archivo.
 * - **El estado se calcula en el servidor.** `overall` y `summary` viajan
 *   resueltos: si el panel los recalculara, dos lugares tendrían que estar de
 *   acuerdo sobre qué cuenta como resuelto, y no lo estarían por mucho tiempo.
 */

export const dataReadinessRouter = Router();

type EstadoSeccion = "complete" | "pending" | "review";
type EstadoCanal = "missing" | "wrong_kind" | "inactive" | "empty" | "invalid" | "complete";
type EstadoHorario = "missing" | "empty" | "inactive" | "complete";

/** Rutas **internas** del panel: React Router ya corre con `basename=/admin`. */
const RUTA_CANALES = "/contact-channels";
const RUTA_HORARIOS = "/schedules";
const RUTA_PAGINAS = "/pages";

const PAGINA_BIOPSIAS = "estudios-biopsias";
const SNAPSHOT_NOTA = "snapshot_nota_emergencias_20260820000000";

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/**
 * Estado de un canal institucional. El primero que aplica gana, y el orden es
 * el del contrato: la fila antes que su tipo, el tipo antes que la publicación,
 * y "lo que hay está mal" al final, cuando ya se sabe que hay algo.
 */
function estadoCanal(esperado: ContactChannelKind, fila: any | undefined): EstadoCanal {
  if (!fila) return "missing";
  if (fila.kind !== esperado) return "wrong_kind";
  if (!fila.active) return "inactive";
  const valor = texto(fila.value);
  if (!valor) return "empty";
  if (!isValidChannelValue(esperado, valor)) return "invalid";
  return "complete";
}

/**
 * Estado de un horario.
 *
 * `inactive` no se comporta como en canales, y la asimetría es deliberada: un
 * horario con horas cargadas y desactivado es una decisión —el sanatorio cargó
 * el dato y eligió no publicarlo—, mientras que los canales institucionales
 * vienen activos de fábrica y uno apagado es un accidente silencioso.
 */
function estadoHorario(fila: any | undefined): EstadoHorario {
  if (!fila) return "missing";
  if (!texto(fila.hours)) return "empty";
  return fila.active ? "complete" : "inactive";
}

/** Un ítem cuenta una sola vez, y siempre en una de las tres columnas. */
const CANAL_REVIEW: ReadonlySet<string> = new Set(["missing", "wrong_kind", "invalid"]);
const CANAL_PENDIENTE: ReadonlySet<string> = new Set(["inactive", "empty"]);

const peor = (estados: EstadoSeccion[]): EstadoSeccion =>
  estados.includes("review") ? "review" : estados.includes("pending") ? "pending" : "complete";

/** Lee un snapshot sin confiar en su forma: puede venir de una versión vieja. */
function leerSnapshot(row: { value: unknown } | undefined): Record<string, unknown> | null {
  if (!row) return null;
  let valor: unknown = row.value;
  if (typeof valor === "string") {
    try {
      valor = JSON.parse(valor);
    } catch {
      return null;
    }
  }
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

dataReadinessRouter.get("/", async (_req, res) => {
  // ------------------------------------------------------------- canales
  const canales = await db("contact_channels").select("key", "label", "kind", "value", "active");
  const canalPorClave = new Map(canales.map((c) => [c.key, c]));

  const itemsCanales = Object.entries(RESERVED_CHANNELS).map(([key, esperado]) => {
    const fila = canalPorClave.get(key);
    return {
      key,
      // El nombre de la fila, no su dato. Si la fila falta no hay label que
      // mostrar y la clave es lo único honesto que se puede decir.
      label: fila ? texto(fila.label) || key : key,
      expectedKind: esperado,
      status: estadoCanal(esperado, fila),
    };
  });

  const canalesReview = itemsCanales.filter((i) => CANAL_REVIEW.has(i.status)).length;
  const canalesPendientes = itemsCanales.filter((i) => CANAL_PENDIENTE.has(i.status)).length;
  const canalesCompletos = itemsCanales.filter((i) => i.status === "complete").length;

  const estadoCanales: EstadoSeccion =
    canalesReview > 0 ? "review" : canalesPendientes > 0 ? "pending" : "complete";

  // ------------------------------------------------------------ horarios
  const horarios = await db("schedules").select("key", "area", "hours", "active").orderBy("order");
  const horarioPorClave = new Map(horarios.map((h) => [h.key, h]));

  const itemsHorarios = Object.entries(RESERVED_SCHEDULES).map(([key, areaPorDefecto]) => {
    const fila = horarioPorClave.get(key);
    return {
      key,
      label: fila ? texto(fila.area) || areaPorDefecto : areaPorDefecto,
      status: estadoHorario(fila),
    };
  });

  const horariosPublicables = itemsHorarios.filter((i) => i.status === "complete").length;
  const horariosFaltantes = itemsHorarios.filter((i) => i.status === "missing").length;
  const horariosVacios = itemsHorarios.filter((i) => i.status === "empty").length;

  // El conjunto no se da por completo porque exista una fila publicable: un
  // único horario cargado con seis áreas vacías sigue siendo `pending`.
  const estadoHorarios: EstadoSeccion =
    horariosFaltantes > 0 ? "review" : horariosVacios > 0 ? "pending" : "complete";

  // ------------------------------------------------------------ biopsias
  //
  // Siempre `review` mientras no exista una confirmación explícita. No se
  // deduce del contenido: que el texto sea largo, o que ya no traiga la nota de
  // "a confirmar", no significa que el sanatorio haya confirmado el alcance,
  // los requisitos y los plazos. Una heurística sobre el texto convertiría
  // "alguien editó la página" en "el alcance está confirmado", que es
  // exactamente la afirmación que no se puede hacer sin autorización.
  const paginaBiopsias = await db("pages").where({ slug: PAGINA_BIOPSIAS }).select("id").first();

  const seccionBiopsias = {
    id: "biopsias",
    label: "Alcance de Biopsias",
    status: "review" as const,
    // Al Page Builder de la página cuando existe; si no, al listado, donde se
    // ve que falta. Mandar a `/pages/undefined` sería una pantalla rota.
    route: paginaBiopsias ? `${RUTA_PAGINAS}/${paginaBiopsias.id}` : RUTA_PAGINAS,
    pageSlug: PAGINA_BIOPSIAS,
    reason: paginaBiopsias
      ? "Requiere confirmación escrita del sanatorio sobre alcance, requisitos y plazos."
      : "No existe la página de Biopsias en el sitio. Revisá el listado de Páginas.",
  };

  // ------------------------------------------------------------- avisos
  const avisos: { code: string; severity: "warning" | "info"; route: string; message: string }[] = [];

  const snapshot = leerSnapshot(await db("settings").where({ key: SNAPSHOT_NOTA }).first());
  if (snapshot && snapshot.motivo === "editada") {
    // El contenido del snapshot no se expone jamás: es justamente el texto no
    // confirmado que se retiró del sitio, y publicarlo en una respuesta de la
    // API lo devolvería a circulación por la puerta de atrás. El aviso dice
    // dónde mirar, nunca qué decía.
    if (snapshot.notaAnterior !== null && snapshot.notaAnterior !== undefined) {
      avisos.push({
        code: "emergencias_nota_sin_revisar",
        severity: "warning",
        route: RUTA_HORARIOS,
        message:
          "La fila de Emergencias tiene una nota anterior que nadie revisó. " +
          "Abrí Horarios y verificá su contenido antes de publicarla.",
      });
    } else if (snapshot.neutralizadoPor) {
      avisos.push({
        code: "emergencias_restauracion_neutralizada",
        severity: "info",
        route: RUTA_HORARIOS,
        message:
          "Un rollback desarmó la restauración automática de la nota de Emergencias. " +
          "La fila está limpia y no hay nada que revisar.",
      });
    }
  }

  for (const item of itemsCanales) {
    if (item.status !== "wrong_kind") continue;
    avisos.push({
      code: "canal_tipo_incorrecto",
      severity: "warning",
      route: RUTA_CANALES,
      message:
        `El canal "${item.label}" quedó con un tipo distinto del que espera el sitio. ` +
        "Abrí Canales de contacto y devolvelo a su tipo correcto.",
    });
  }

  // ------------------------------------------------------------ resumen
  //
  // El panel no recalcula nada. Cada ítem cae en una sola columna y las tres
  // suman el total: ocho canales, siete horarios y la revisión de Biopsias.
  //
  // Un horario con horas cargadas e inactivo cuenta como **resuelto**: el dato
  // está, y no publicarlo es una decisión tomada, no una tarea pendiente.
  const horariosResueltos = itemsHorarios.filter(
    (i) => i.status === "complete" || i.status === "inactive",
  ).length;

  const summary = {
    resolved: canalesCompletos + horariosResueltos,
    pending: canalesPendientes + horariosVacios,
    review: canalesReview + horariosFaltantes + 1,
    total: itemsCanales.length + itemsHorarios.length + 1,
  };

  res.json({
    overall: peor([estadoCanales, estadoHorarios, seccionBiopsias.status]),
    summary,
    sections: [
      {
        id: "contact-channels",
        label: "Canales de contacto",
        status: estadoCanales,
        route: RUTA_CANALES,
        complete: canalesCompletos,
        total: itemsCanales.length,
        items: itemsCanales,
      },
      {
        id: "schedules",
        label: "Horarios de atención",
        status: estadoHorarios,
        route: RUTA_HORARIOS,
        publishable: horariosPublicables,
        total: itemsHorarios.length,
        items: itemsHorarios,
      },
      seccionBiopsias,
    ],
    warnings: avisos,
  });
});
