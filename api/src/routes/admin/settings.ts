import { Router } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { sanitizeMapEmbed } from "../../html.js";

export const settingsRouter = Router();

settingsRouter.get("/", async (_req, res) => {
  const rows = await db("settings").select("key", "value");
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

const putSchema = z.record(z.string(), z.unknown());
settingsRouter.put("/", async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido" });
  for (const [key, value] of Object.entries(parsed.data)) {
    if (RETIRED_SETTING_KEYS.includes(key)) continue;
    const cleanValue = sanitizeSettingValue(key, value);
    await db("settings")
      .insert({ key, value: JSON.stringify(cleanValue) })
      .onConflict("key")
      .merge({ value: JSON.stringify(cleanValue), updated_at: db.fn.now() });
  }
  res.json({ ok: true });
});

settingsRouter.put("/:key", async (req, res) => {
  const key = req.params.key;
  if (RETIRED_SETTING_KEYS.includes(key)) {
    return res.status(410).json({
      error: `"${key}" ya no se administra desde Ajustes: se carga en Canales de contacto`,
    });
  }
  const cleanValue = sanitizeSettingValue(key, req.body);
  await db("settings")
    .insert({ key, value: JSON.stringify(cleanValue) })
    .onConflict("key")
    .merge({ value: JSON.stringify(cleanValue), updated_at: db.fn.now() });
  res.json({ ok: true });
});

/**
 * Campos que dejaron de vivir en `settings` (migración 20260816000000).
 *
 * Teléfonos, WhatsApp, correos, Emergencias y GTH se administran en
 * `contact_channels`; los horarios, en `schedules`; las redes, también como
 * canales. Estaban duplicados y el panel dejaba editar los dos lados, así que
 * un dato podía quedar distinto según dónde se mirara.
 *
 * Se descartan acá y no sólo en el formulario: un cliente viejo, un script o
 * un panel desactualizado no pueden volver a crearlos.
 */
const RETIRED_CONTACT_FIELDS = [
  "phones",
  "email",
  "whatsapp",
  "hours",
  "emergencyPhone",
  "gthEmail",
];

/** Claves de settings que ya no existen como tales. */
export const RETIRED_SETTING_KEYS = ["social"];

function sanitizeSettingValue(key: string, value: unknown): unknown {
  if (key === "scripts") return { head: "", bodyEnd: "" };
  if (key === "contact" && value && typeof value === "object" && !Array.isArray(value)) {
    const contact = { ...(value as Record<string, unknown>) };
    for (const field of RETIRED_CONTACT_FIELDS) delete contact[field];
    if (typeof contact.mapEmbed === "string") contact.mapEmbed = sanitizeMapEmbed(contact.mapEmbed);
    return contact;
  }
  return value;
}
