import { Router } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { badRequest, notFound } from "../../http.js";
import { requireRole } from "../../auth.js";

/**
 * Confirmaciones escritas del sanatorio sobre contenido que el código no puede
 * deducir.
 *
 * El caso que la motiva es Biopsias. La pantalla de "Datos pendientes" lo
 * marca `review` **siempre**, y la razón está escrita en `data_readiness.ts`:
 * que el texto de la página sea largo, o que ya no traiga la nota de "a
 * confirmar", no significa que el sanatorio haya confirmado el alcance, los
 * requisitos y los plazos. Una heurística sobre el texto convertiría "alguien
 * editó la página" en "el alcance está confirmado", que es exactamente la
 * afirmación que no se puede hacer sin autorización.
 *
 * Lo que faltaba no era la heurística: era **el lugar donde el sanatorio dice
 * que sí**. Esto es ese lugar.
 *
 * ## Qué es y qué no es
 *
 * Es un registro de que una persona con autoridad afirmó algo, con su nombre,
 * la fecha y el alcance que afirmó. No valida el contenido de la página, no lo
 * corrige y no lo publica: sólo deja constancia de la decisión, que es lo que
 * hasta ahora no tenía dónde vivir.
 *
 * **El contenido lo carga el sanatorio.** Este endpoint no inventa qué
 * biopsias se hacen ni con qué plazos; recibe lo que le dicen y lo guarda.
 *
 * ## Por qué `superadmin`
 *
 * Confirmar es una afirmación institucional: pasa un ítem de "no se puede
 * afirmar" a "el sanatorio lo afirma". Un editor puede escribir el texto de la
 * página; declarar que ese texto está confirmado es otra cosa.
 *
 * ## Dónde se guarda
 *
 * En `settings`, con una clave por ítem. No hace falta una tabla: son cuatro
 * campos, uno por ítem confirmable, y `settings` ya tiene el rollback y las
 * garantías del resto de la configuración. La clave **no** está en
 * `ADMIN_SETTING_KEYS`, así que el editor genérico de Configuración no la
 * puede tocar: se cambia por acá o no se cambia.
 */

export const dataConfirmationsRouter = Router();

/** Ítems que admiten una confirmación escrita. Hoy uno; la forma admite más. */
export const CONFIRMABLES = ["biopsias"] as const;
export type Confirmable = (typeof CONFIRMABLES)[number];

/** La clave en `settings` de cada ítem. */
export const claveDeConfirmacion = (item: Confirmable) => `confirmacion_${item}`;

const esConfirmable = (v: string): v is Confirmable => (CONFIRMABLES as readonly string[]).includes(v);

/**
 * Qué se guarda de una confirmación.
 *
 * `scope` es lo que efectivamente se está confirmando —qué estudios, con qué
 * requisitos, en qué plazos— escrito por quien confirma. Sin él la
 * confirmación diría "está bien" sin decir qué está bien, que no sirve de
 * constancia ni para el sanatorio ni para quien tenga que revisarlo después.
 */
const cuerpoSchema = z.object({
  scope: z.string().trim().min(10).max(2000),
  note: z.string().trim().max(2000).optional(),
});

export interface Confirmacion {
  confirmedAt: string;
  confirmedBy: { id: number | null; name: string | null };
  scope: string;
  note: string | null;
}

/** MariaDB devuelve las columnas JSON como string; MySQL 8 ya parseadas. */
function comoJson<T>(valor: unknown): T | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "string") return valor as T;
  try {
    return JSON.parse(valor) as T;
  } catch {
    return null;
  }
}

/** MariaDB quiere string al escribir en una columna JSON. */
const textoJson = (v: unknown) => JSON.stringify(v);

/**
 * La confirmación de un ítem, o `null` si nadie la registró.
 *
 * La usa `data_readiness.ts`, que es quien decide qué estado mostrar. Devuelve
 * `null` también cuando la fila está pero es ilegible: una confirmación que no
 * se puede leer no es una confirmación, y darla por buena sería justamente el
 * error que este módulo existe para no cometer.
 */
export async function confirmacionDe(item: Confirmable): Promise<Confirmacion | null> {
  const fila = await db("settings").where({ key: claveDeConfirmacion(item) }).first();
  if (!fila) return null;

  const valor = comoJson<Partial<Confirmacion>>(fila.value);
  if (!valor || typeof valor.confirmedAt !== "string" || typeof valor.scope !== "string") return null;

  return {
    confirmedAt: valor.confirmedAt,
    confirmedBy: {
      id: typeof valor.confirmedBy?.id === "number" ? valor.confirmedBy.id : null,
      name: typeof valor.confirmedBy?.name === "string" ? valor.confirmedBy.name : null,
    },
    scope: valor.scope,
    note: typeof valor.note === "string" ? valor.note : null,
  };
}

// Confirmar y desconfirmar son afirmaciones institucionales; leer, no. Sólo
// las dos primeras exigen superadmin.
dataConfirmationsRouter.get("/:item", async (req, res) => {
  const item = String(req.params.item);
  if (!esConfirmable(item)) throw notFound("ítem no confirmable");
  res.json({ item, confirmation: await confirmacionDe(item) });
});

dataConfirmationsRouter.put("/:item", requireRole("superadmin"), async (req, res) => {
  const item = String(req.params.item);
  if (!esConfirmable(item)) throw notFound("ítem no confirmable");

  const parsed = cuerpoSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("payload invalido", parsed.error.flatten().fieldErrors);

  const confirmacion: Confirmacion = {
    // Del servidor, no del cliente: una fecha que manda quien confirma podría
    // fechar la confirmación en cualquier momento.
    confirmedAt: new Date().toISOString(),
    confirmedBy: { id: req.user?.id ?? null, name: req.user?.name ?? null },
    scope: parsed.data.scope,
    note: parsed.data.note && parsed.data.note.length > 0 ? parsed.data.note : null,
  };

  const clave = claveDeConfirmacion(item);
  const existe = await db("settings").where({ key: clave }).first("key");
  if (existe) {
    await db("settings").where({ key: clave }).update({ value: textoJson(confirmacion) });
  } else {
    await db("settings").insert({ key: clave, value: textoJson(confirmacion) });
  }

  res.json({ item, confirmation: confirmacion });
});

/**
 * Retirar la confirmación.
 *
 * Existe porque una confirmación puede dejar de ser cierta: cambian los
 * plazos, se deja de hacer un estudio. Sin forma de retirarla, la única salida
 * sería editar la base a mano, y el ítem seguiría diciendo "confirmado" sobre
 * algo que ya no lo está.
 */
dataConfirmationsRouter.delete("/:item", requireRole("superadmin"), async (req, res) => {
  const item = String(req.params.item);
  if (!esConfirmable(item)) throw notFound("ítem no confirmable");
  await db("settings").where({ key: claveDeConfirmacion(item) }).del();
  res.status(204).end();
});
