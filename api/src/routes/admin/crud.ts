import { Router } from "express";
import type { Request, Response } from "express";
import { z, ZodSchema, ZodObject } from "zod";
import { db } from "../../db.js";
import { isLucideIconName } from "../../lucide-icons.js";

/**
 * Icono administrable: o vacío, o un nombre que existe de verdad en la versión
 * instalada de lucide. Un nombre inventado no rompe nada visible —el
 * componente simplemente no dibuja— y así el error aparecía recién en el sitio
 * publicado. Acá se rechaza al guardar.
 */
export const iconSchema = z
  .string()
  .trim()
  .max(64)
  .refine((v) => v === "" || isLucideIconName(v), {
    message: "icono inexistente en lucide: elegí uno del selector del panel",
  })
  .nullable()
  .optional();

export interface CrudOpts {
  table: string;
  schema: ZodSchema<any>;
  /**
   * Validación extra en el PUT parcial, cuando hace falta la fila guardada
   * para saber contra qué validar (por ejemplo el `kind` de un canal, que
   * puede no venir en el payload).
   */
  refineUpdate?: (data: any, current: any, ctx: z.RefinementCtx) => void;
  /**
   * Impide repetir el mismo icono dentro de la tabla: las grillas de
   * servicios, estudios y especialidades se ven juntas y dos filas con el
   * mismo icono se leen como un error de carga.
   */
  uniqueIcon?: boolean;
  /** columnas a devolver en list */
  listColumns?: string[];
  /** ordering por defecto */
  defaultOrderBy?: string;
  /** transformación de payload antes de insert/update (JSON.stringify de campos json) */
  prepare?: (input: any) => Record<string, unknown>;
  /** transformación de fila al leer */
  serialize?: (row: any) => any;
}

export function crudRouter(opts: CrudOpts): Router {
  const r = Router();
  const prepare = opts.prepare ?? ((x) => x);
  const serialize = opts.serialize ?? ((x) => x);

  r.get("/", async (req: Request, res: Response) => {
    const q = req.query.q as string | undefined;
    let qb = db(opts.table);
    if (opts.listColumns) qb = qb.select(opts.listColumns);
    if (opts.defaultOrderBy) qb = qb.orderBy(opts.defaultOrderBy);
    if (q && (req.query.searchField as string)) {
      qb = qb.where(req.query.searchField as string, "like", `%${q}%`);
    }
    const rows = await qb;
    res.json(rows.map(serialize));
  });

  r.get("/:id", async (req, res) => {
    const row = await db(opts.table).where({ id: req.params.id }).first();
    if (!row) return res.status(404).json({ error: "no encontrado" });
    res.json(serialize(row));
  });

  /** Devuelve el slug/nombre de la fila que ya usa ese icono, si la hay. */
  async function iconTakenBy(icon: unknown, excludeId?: string): Promise<string | null> {
    if (!opts.uniqueIcon || typeof icon !== "string" || !icon) return null;
    let qb = db(opts.table).where({ icon });
    if (excludeId) qb = qb.whereNot({ id: excludeId });
    const row = await qb.first();
    if (!row) return null;
    return (row.slug as string) ?? (row.name as string) ?? String(row.id);
  }

  r.post("/", async (req, res) => {
    const parsed = opts.schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "payload invalido", issues: parsed.error.issues });
    const taken = await iconTakenBy((parsed.data as any).icon);
    if (taken) {
      return res.status(409).json({ error: `el icono ya lo usa "${taken}": elegí otro` });
    }
    const [id] = await db(opts.table).insert(prepare(parsed.data));
    const row = await db(opts.table).where({ id }).first();
    res.status(201).json(serialize(row));
  });

  r.put("/:id", async (req, res) => {
    // `.partial()` no existe en un schema con superRefine: se toma el objeto
    // de adentro y se le vuelve a colgar la validación que necesita la fila.
    const base = (opts.schema as { _def?: { schema?: ZodObject<any> } })._def?.schema ?? opts.schema;
    const current = await db(opts.table).where({ id: req.params.id }).first();
    if (!current) return res.status(404).json({ error: "no encontrado" });

    const partialSchema = (base as ZodObject<any>)
      .partial()
      .superRefine((data: any, ctx: z.RefinementCtx) => opts.refineUpdate?.(data, current, ctx));
    const parsed = partialSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "payload invalido", issues: parsed.error.issues });
    const taken = await iconTakenBy((parsed.data as any).icon, req.params.id);
    if (taken) {
      return res.status(409).json({ error: `el icono ya lo usa "${taken}": elegí otro` });
    }
    await db(opts.table).where({ id: req.params.id }).update(prepare(parsed.data));
    const row = await db(opts.table).where({ id: req.params.id }).first();
    res.json(serialize(row));
  });

  r.delete("/:id", async (req, res) => {
    await db(opts.table).where({ id: req.params.id }).del();
    res.status(204).end();
  });

  return r;
}

export { z };
