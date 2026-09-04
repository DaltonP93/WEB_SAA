import { Router } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { hashPassword, requireRole } from "../../auth.js";
import { badRequest, conflict, notFound } from "../../http.js";
import { registrarAccion, actorDe } from "../../audit.js";
import { ROLES } from "../../permisos.js";

/**
 * Usuarios del panel.
 *
 * ## Dos formas de quedarse afuera del panel para siempre
 *
 * 1. **Borrar al último superadmin.** El rol `editor` no puede administrar
 *    usuarios: si no queda ningún superadmin, nadie puede crear uno. La única
 *    salida es entrar a MySQL a mano en el VPS, que es exactamente el tipo de
 *    intervención que este panel existe para no necesitar.
 * 2. **Bajarle el rol al último superadmin.** El mismo agujero por otra
 *    puerta: bajar el rol produce el mismo resultado que borrarlo. El guard
 *    tiene que cubrir *cualquier* rol destino que no sea `superadmin`, no una
 *    sola forma: cuando el sistema era binario alcanzaba con vigilar el paso a
 *    `editor`, pero RBAC agregó `admin`, `autor`, `revisor`, etc., y un `PUT`
 *    con `role: "admin"` sobre el último superadmin lo degradaba igual.
 *
 * Las dos se cierran contando cuántos superadmin quedarían **después** de la
 * operación, no antes.
 *
 * ## `safeParse` y no `parse`
 *
 * `schema.parse()` lanza un `ZodError`, y el manejador global convierte en
 * **500 "error interno"** todo lo que no sea `HttpError`. Un email mal escrito
 * no es un error del servidor: quien lo escribió no tenía forma de saber qué
 * corregir, porque el 500 no dice nada.
 */

export const usersRouter = Router();
usersRouter.use(requireRole("superadmin"));

/** Lo que se devuelve. Nunca `password_hash`, ni siquiera al propio superadmin. */
const CAMPOS = ["id", "email", "name", "role", "created_at"];

const schema = z.object({
  email: z.string().trim().email().max(191),
  name: z.string().trim().min(1).max(191),
  password: z.string().min(6).max(200).optional(),
  role: z.enum(ROLES).optional(),
});

/** Cuántos superadmin hay, sin contar a `exceptoId`. */
async function otrosSuperadmin(exceptoId: number): Promise<number> {
  const [{ n }] = await db("users")
    .where({ role: "superadmin" })
    .whereNot({ id: exceptoId })
    .count({ n: "id" });
  return Number(n);
}

usersRouter.get("/", async (_req, res) => {
  res.json(await db("users").select(CAMPOS).orderBy("id"));
});

usersRouter.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw badRequest("payload invalido", parsed.error.flatten().fieldErrors);

  const p = parsed.data;
  if (!p.password) throw badRequest("la contraseña es obligatoria al crear un usuario");

  // El email es único en el esquema: sin esto, el choque contra el índice sale
  // como 500 y quien lo intenta no sabe que ya existe.
  const repetido = await db("users").where({ email: p.email }).first("id");
  if (repetido) throw conflict("ya existe un usuario con ese email");

  const [id] = await db("users").insert({
    email: p.email,
    name: p.name,
    password_hash: await hashPassword(p.password),
    role: p.role ?? "editor",
  });

  await registrarAccion({ ...actorDe(req), action: "create", resourceType: "users", resourceId: id, meta: { role: p.role ?? "editor" } });
  res.status(201).json(await db("users").where({ id }).first(CAMPOS));
});

usersRouter.put("/:id", async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) throw badRequest("payload invalido", parsed.error.flatten().fieldErrors);

  const id = Number(req.params.id);
  const actual = await db("users").where({ id }).first("id", "role");
  // Antes un id inexistente actualizaba cero filas y devolvía `{ ok: true }`:
  // el panel no podía distinguir "se guardó" de "no existe".
  if (!actual) throw notFound("usuario no encontrado");

  const p = parsed.data;

  // Cualquier rol distinto de `superadmin` lo saca del panel de usuarios: no
  // alcanza con vigilar el paso a `editor`. Desde que RBAC agregó `admin`,
  // `autor`, `revisor`, etc., un `PUT` con `role: "admin"` sobre el último
  // superadmin lo degradaba y dejaba el panel sin nadie que pueda administrar
  // usuarios. Se bloquea toda degradación del último, no una sola de sus formas.
  if (
    p.role !== undefined &&
    p.role !== "superadmin" &&
    actual.role === "superadmin" &&
    (await otrosSuperadmin(id)) === 0
  ) {
    throw conflict(
      "no se puede quitar el rol de superadmin al último que queda: nadie podría volver a administrar usuarios",
    );
  }

  if (p.email !== undefined) {
    const repetido = await db("users").where({ email: p.email }).whereNot({ id }).first("id");
    if (repetido) throw conflict("ya existe un usuario con ese email");
  }

  const patch: Record<string, unknown> = {};
  if (p.email !== undefined) patch.email = p.email;
  if (p.name !== undefined) patch.name = p.name;
  if (p.role !== undefined) patch.role = p.role;
  if (p.password) patch.password_hash = await hashPassword(p.password);

  // Un `update({})` en knex genera SQL inválido. Sin cambios, no hay nada que
  // escribir y la respuesta es la fila tal como está.
  if (Object.keys(patch).length > 0) await db("users").where({ id }).update(patch);

  const cambioRol = p.role !== undefined && p.role !== actual.role;
  await registrarAccion({
    ...actorDe(req),
    action: cambioRol ? "role_change" : "update",
    resourceType: "users",
    resourceId: id,
    meta: cambioRol ? { from: actual.role, to: p.role } : undefined,
  });
  res.json(await db("users").where({ id }).first(CAMPOS));
});

usersRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw badRequest("id invalido");

  if (id === req.user?.id) throw badRequest("no podés borrarte a vos mismo");

  const actual = await db("users").where({ id }).first("id", "role");
  // Ya no existe: el resultado deseado se cumple igual.
  if (!actual) return res.status(204).end();

  if (actual.role === "superadmin" && (await otrosSuperadmin(id)) === 0) {
    throw conflict(
      "no se puede borrar al último superadmin: nadie podría volver a administrar usuarios",
    );
  }

  await db("users").where({ id }).del();
  await registrarAccion({ ...actorDe(req), action: "delete", resourceType: "users", resourceId: id, meta: { role: actual.role } });
  res.status(204).end();
});
