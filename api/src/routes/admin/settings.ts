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

/**
 * Los únicos ajustes que se administran desde el panel.
 *
 * Es una allowlist, no una lista de exclusiones. La tabla `settings` guarda
 * además claves operativas —los snapshots que dejan las migraciones para poder
 * revertirse, la marca de generación de los seeds, los backups de bloques—, y
 * el panel las recibía en el GET y las reenviaba enteras al guardar. Bastaba
 * con que una de esas idas y vueltas alterara un byte para que el `down()` de
 * una migración se quedara sin con qué restaurar.
 *
 * Esas claves las escriben las migraciones y los seeds. Desde la API no se
 * tocan: ni con rol editor ni con superadmin, porque no es una cuestión de
 * permisos sino de que no son contenido.
 */
export const ADMIN_SETTING_KEYS = ["brand", "theme", "contact", "seo"] as const;

/** ¿La clave es administrable desde el panel? */
function isAdminSettingKey(key: string): boolean {
  return (ADMIN_SETTING_KEYS as readonly string[]).includes(key);
}

/**
 * Las columnas JSON vuelven parseadas en MySQL y como string en MariaDB.
 *
 * Devolver el string tal cual hacía que el panel lo reenviara como string y
 * que la API le aplicara `JSON.stringify` encima: la fila quedaba con el JSON
 * escapado dentro de otro JSON. Se normaliza al leer.
 */
function parseSettingValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

settingsRouter.get("/", async (_req, res) => {
  const rows = await db("settings").whereIn("key", ADMIN_SETTING_KEYS).select("key", "value");
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = parseSettingValue(r.value);
  res.json(out);
});

/** Motivo por el que una clave no se puede escribir, con su código HTTP. */
function rejectionFor(key: string): { status: number; error: string } | null {
  if (isAdminSettingKey(key)) return null;
  if (RETIRED_SETTING_KEYS.includes(key)) {
    return { status: 410, error: RETIRED_SETTING_MESSAGE[key] ?? `"${key}" ya no se administra` };
  }
  return {
    status: 403,
    error:
      `"${key}" no es un ajuste administrable. Desde el panel sólo se editan: ` +
      `${ADMIN_SETTING_KEYS.join(", ")}. Las claves internas (snapshots de migraciones, ` +
      "marcas de los seeds, backups) las escriben las migraciones y los seeds.",
  };
}

const putSchema = z.record(z.string(), z.unknown());
settingsRouter.put("/", async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido" });

  // Nada se descarta en silencio: el panel recibía `{ok:true}` y mostraba
  // "Guardado" sobre claves que la API nunca guardó.
  const rejected = Object.keys(parsed.data)
    .map((key) => ({ key, reason: rejectionFor(key) }))
    .filter((r): r is { key: string; reason: { status: number; error: string } } => r.reason !== null);
  if (rejected.length > 0) {
    // Si hay varias, manda la más específica: 410 (retirada) sobre 403.
    const status = Math.min(...rejected.map((r) => r.reason.status));
    return res.status(status).json({
      error: rejected.map((r) => r.reason.error).join(" · "),
      rejected: rejected.map((r) => r.key),
    });
  }

  const themeErrors = "theme" in parsed.data ? assertThemeColors(parsed.data.theme) : [];
  if (themeErrors.length > 0) {
    return res.status(400).json({ error: "payload invalido", issues: themeErrors });
  }

  // Transaccional: guardar la marca y fallar en el tema dejaba la mitad
  // aplicada, y el panel no tenía forma de saber qué quedó guardado.
  await db.transaction(async (trx) => {
    for (const [key, value] of Object.entries(parsed.data)) {
      const cleanValue = JSON.stringify(sanitizeSettingValue(key, value));
      await trx("settings")
        .insert({ key, value: cleanValue })
        .onConflict("key")
        .merge({ value: cleanValue, updated_at: trx.fn.now() });
    }
  });
  res.json({ ok: true });
});

settingsRouter.put("/:key", async (req, res) => {
  const key = req.params.key;
  const rejection = rejectionFor(key);
  if (rejection) return res.status(rejection.status).json({ error: rejection.error });

  if (key === "theme") {
    const errors = assertThemeColors(req.body);
    if (errors.length > 0) return res.status(400).json({ error: "payload invalido", issues: errors });
  }
  const cleanValue = JSON.stringify(sanitizeSettingValue(key, req.body));
  await db("settings")
    .insert({ key, value: cleanValue })
    .onConflict("key")
    .merge({ value: cleanValue, updated_at: db.fn.now() });
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
