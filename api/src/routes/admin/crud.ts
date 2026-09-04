import { Router } from "express";
import type { Request, Response } from "express";
import { z, ZodSchema, ZodObject } from "zod";
import { db } from "../../db.js";
import { isLucideIconName } from "../../lucide-icons.js";
import { registrarAccion, actorDe } from "../../audit.js";

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
  /**
   * Columnas por las que se permite buscar con `?q=&searchField=`. **Allowlist**:
   * un `searchField` fuera de esta lista se rechaza con 400 en vez de usarse como
   * identificador de columna. Sin esto, el query decidía qué columna filtrar sin
   * restricción —knex escapa el identificador, así que no hay inyección SQL, pero
   * dejaba enumerar por cualquier columna—. El panel busca del lado del cliente
   * (no manda `searchField`), así que por defecto no hay campo permitido y el
   * parámetro queda inerte salvo que un mount lo habilite explícitamente.
   */
  searchableColumns?: string[];
  /** ordering por defecto */
  defaultOrderBy?: string;
  /** transformación de payload antes de insert/update (JSON.stringify de campos json) */
  prepare?: (input: any) => Record<string, unknown>;
  /**
   * Escribe `updated_at` en cada PUT.
   *
   * El CRUD guardaba sólo las columnas del payload, así que la marca quedaba
   * congelada en el valor que le puso la migración que creó la fila: una
   * edición real desde el panel no la movía. Cualquier mecanismo que use esa
   * marca para saber si alguien tocó la fila —el blindaje del rollback de la
   * guardia lo hacía— quedaba mirando un dato que no cambia nunca.
   *
   * Es opt-in porque no todas las tablas del CRUD tienen la columna.
   */
  touchUpdatedAt?: boolean;
  /** transformación de fila al leer */
  serialize?: (row: any) => any;
  /**
   * Filas que el producto define y el panel no puede destruir.
   *
   * Devuelven el motivo (string) cuando la operación no se permite, o `null`
   * cuando sí. Se resuelve contra la fila **guardada**, no contra el payload:
   * quien quiera saltearse la protección no puede hacerlo mandando otra cosa.
   */
  guard?: {
    canDelete?: (row: any) => string | null;
    canUpdate?: (row: any, payload: any) => string | null;
    /** Se resuelve contra el payload: todavía no hay fila. */
    canCreate?: (payload: any) => string | null;
  };
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
    const searchField = req.query.searchField as string | undefined;
    if (q && searchField) {
      // Allowlist: el campo tiene que estar declarado como buscable. Si no, 400 —
      // no se usa un valor arbitrario del query como nombre de columna.
      if (!opts.searchableColumns?.includes(searchField)) {
        return res.status(400).json({ error: "campo de búsqueda no permitido" });
      }
      qb = qb.where(searchField, "like", `%${q}%`);
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
    const bloqueoAlta = opts.guard?.canCreate?.(parsed.data);
    if (bloqueoAlta) return res.status(403).json({ error: bloqueoAlta });
    const taken = await iconTakenBy((parsed.data as any).icon);
    if (taken) {
      return res.status(409).json({ error: `el icono ya lo usa "${taken}": elegí otro` });
    }
    const [id] = await db(opts.table).insert(prepare(parsed.data));
    const row = await db(opts.table).where({ id }).first();
    await registrarAccion({ ...actorDe(req), action: "create", resourceType: opts.table, resourceId: id });
    res.status(201).json(serialize(row));
  });

  r.put("/:id", async (req, res) => {
    // `.partial()` no existe en un schema con superRefine: se toma el objeto
    // de adentro y se le vuelve a colgar la validación que necesita la fila.
    const base = (opts.schema as { _def?: { schema?: ZodObject<any> } })._def?.schema ?? opts.schema;
    const current = await db(opts.table).where({ id: req.params.id }).first();
    if (!current) return res.status(404).json({ error: "no encontrado" });

    // El orden importa y no es el evidente.
    //
    // 1. **Forma** del payload parcial. Sin validación semántica todavía.
    // 2. **Guard** institucional, contra la fila guardada.
    // 3. **Semántica** de la fila resultante (payload + lo que ya estaba).
    //
    // Antes 1 y 3 iban juntos, así que un cambio prohibido de `kind` podía
    // responder 400 en vez de 403: la validación semántica se quejaba primero
    // de que el valor guardado no correspondía al tipo pedido. El operador
    // recibía "payload inválido" por un cambio que no es inválido sino
    // prohibido, y el mensaje no decía nada de la restricción real. Ahora el
    // guard decide antes de que la semántica pueda opinar.
    const partialBase = (base as ZodObject<any>).partial();

    const forma = partialBase.safeParse(req.body);
    if (!forma.success) return res.status(400).json({ error: "payload invalido", issues: forma.error.issues });

    const bloqueo = opts.guard?.canUpdate?.(current, forma.data);
    if (bloqueo) return res.status(403).json({ error: bloqueo });

    const parsed = partialBase
      .superRefine((data: any, ctx: z.RefinementCtx) => opts.refineUpdate?.(data, current, ctx))
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "payload invalido", issues: parsed.error.issues });
    const taken = await iconTakenBy((parsed.data as any).icon, req.params.id);
    if (taken) {
      return res.status(409).json({ error: `el icono ya lo usa "${taken}": elegí otro` });
    }
    const cambios = prepare(parsed.data);
    await db(opts.table)
      .where({ id: req.params.id })
      .update(opts.touchUpdatedAt ? { ...cambios, updated_at: db.fn.now() } : cambios);
    const row = await db(opts.table).where({ id: req.params.id }).first();
    await registrarAccion({ ...actorDe(req), action: "update", resourceType: opts.table, resourceId: req.params.id });
    res.json(serialize(row));
  });

  r.delete("/:id", async (req, res) => {
    const current = await db(opts.table).where({ id: req.params.id }).first();
    if (!current) return res.status(404).json({ error: "no encontrado" });
    const bloqueo = opts.guard?.canDelete?.(current);
    if (bloqueo) return res.status(403).json({ error: bloqueo });
    await db(opts.table).where({ id: req.params.id }).del();
    await registrarAccion({ ...actorDe(req), action: "delete", resourceType: opts.table, resourceId: req.params.id });
    res.status(204).end();
  });

  return r;
}

export { z };
