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
  const cleanValue = sanitizeSettingValue(key, req.body);
  await db("settings")
    .insert({ key, value: JSON.stringify(cleanValue) })
    .onConflict("key")
    .merge({ value: JSON.stringify(cleanValue), updated_at: db.fn.now() });
  res.json({ ok: true });
});

function sanitizeSettingValue(key: string, value: unknown): unknown {
  if (key === "scripts") return { head: "", bodyEnd: "" };
  if (key === "contact" && value && typeof value === "object" && !Array.isArray(value)) {
    const contact = { ...(value as Record<string, unknown>) };
    if (typeof contact.mapEmbed === "string") contact.mapEmbed = sanitizeMapEmbed(contact.mapEmbed);
    return contact;
  }
  return value;
}
