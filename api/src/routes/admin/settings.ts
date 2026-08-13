import { Router } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { sanitizeMapEmbed } from "../../html.js";
import {
  THEME_COLOR_KEYS,
  THEME_COLOR_MESSAGE,
  THEME_PALETTE,
  isApprovedThemeColor,
} from "../../institutional-red.js";

export const settingsRouter = Router();

settingsRouter.get("/", async (_req, res) => {
  const rows = await db("settings").select("key", "value");
  const out: Record<string, unknown> = {};
  // Las claves retiradas tampoco se devuelven: el panel guarda de vuelta lo
  // que recibe, y devolverlas hacía que cada guardado reenviara una clave que
  // la API rechaza.
  for (const r of rows) {
    if (RETIRED_SETTING_KEYS.includes(r.key)) continue;
    out[r.key] = r.value;
  }
  res.json(out);
});

const putSchema = z.record(z.string(), z.unknown());
settingsRouter.put("/", async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido" });
  // Una clave retirada no se descarta en silencio: el panel recibía
  // `{ok:true}` y mostraba "Guardado" sobre algo que nunca se guardó.
  const retired = Object.keys(parsed.data).filter((key) => RETIRED_SETTING_KEYS.includes(key));
  if (retired.length > 0) {
    return res.status(410).json({
      error: retired.map((key) => RETIRED_SETTING_MESSAGE[key] ?? `"${key}" ya no se administra`).join(" · "),
      retired,
    });
  }
  const themeErrors = "theme" in parsed.data ? assertThemeColors(parsed.data.theme) : [];
  if (themeErrors.length > 0) {
    return res.status(400).json({ error: "payload invalido", issues: themeErrors });
  }
  for (const [key, value] of Object.entries(parsed.data)) {
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
    return res.status(410).json({ error: RETIRED_SETTING_MESSAGE[key] ?? `"${key}" ya no se administra` });
  }
  if (key === "theme") {
    const errors = assertThemeColors(req.body);
    if (errors.length > 0) return res.status(400).json({ error: "payload invalido", issues: errors });
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

/**
 * Claves de settings retiradas.
 *
 * `scripts` era un campo de "JavaScript personalizado" que el panel ofrecía y
 * la API vaciaba siempre: se guardaba, decía "Guardado" y no conservaba nada.
 * Meta Pixel, Google Ads y Analytics van a entrar por módulos propios, no por
 * un textarea de JS arbitrario.
 */
export const RETIRED_SETTING_KEYS = ["social", "scripts"];

const RETIRED_SETTING_MESSAGE: Record<string, string> = {
  social: '"social" ya no se administra desde Ajustes: las redes se cargan en Canales de contacto',
  scripts:
    '"scripts" se retiró: no se inyecta JavaScript arbitrario en el sitio. Las integraciones de medición van a entrar por módulos propios.',
};

/**
 * El tema sólo acepta colores de la paleta institucional.
 *
 * Con un campo de color libre alcanzaba con pintar `primary` de rojo para
 * romper la regla de que el rojo es exclusivo de Emergencias, sin tocar
 * ningún bloque. Una allowlist evita además tener que reconocer todas las
 * sintaxis de color que existen o van a existir.
 */
function assertThemeColors(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const theme = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const slot of THEME_COLOR_KEYS) {
    if (!(slot in theme)) continue;
    if (!isApprovedThemeColor(slot, theme[slot])) {
      errors.push(`theme.${slot}: ${THEME_COLOR_MESSAGE} (${(THEME_PALETTE[slot] ?? []).join(", ")})`);
    }
  }
  return errors;
}

function sanitizeSettingValue(key: string, value: unknown): unknown {
  if (key === "contact" && value && typeof value === "object" && !Array.isArray(value)) {
    const contact = { ...(value as Record<string, unknown>) };
    for (const field of RETIRED_CONTACT_FIELDS) delete contact[field];
    if (typeof contact.mapEmbed === "string") contact.mapEmbed = sanitizeMapEmbed(contact.mapEmbed);
    return contact;
  }
  return value;
}
