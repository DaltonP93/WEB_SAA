import type { Knex } from "knex";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "..", "assets-extracted", "data");

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function tryReadJSON<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(join(DATA_DIR, file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function seed(knex: Knex): Promise<void> {
  await knex("doctor_specialty").del();
  await knex("doctors").del();
  await knex("specialties").del();

  const baseSpecialties = [
    "Cardiología",
    "Pediatría",
    "Ginecología y Obstetricia",
    "Traumatología",
    "Neurología",
    "Oftalmología",
    "Otorrinolaringología",
    "Urología",
    "Dermatología",
    "Endocrinología",
    "Gastroenterología",
    "Nefrología",
    "Neumología",
    "Oncología",
    "Psiquiatría",
    "Reumatología",
    "Cirugía General",
    "Medicina Interna",
    "Medicina Familiar",
    "Anestesiología",
  ].map((name) => ({ name, slug: slugify(name) }));

  const specsFromFile = await tryReadJSON<{ name: string; slug: string }[]>(
    "specialties.json",
    baseSpecialties,
  );

  const specs = specsFromFile.length > 0 ? specsFromFile : baseSpecialties;
  await knex("specialties").insert(
    specs.map((s, i) => ({ slug: s.slug, name: s.name, order: i })),
  );
  const specRows = await knex("specialties").select("id", "slug", "name");
  const specBySlug = new Map(specRows.map((r) => [r.slug, r.id]));

  // Médicos de ejemplo SÓLO para desarrollo: son nombres inventados y no
  // pueden terminar publicados. En producción la guía médica se carga desde
  // el panel o con `pnpm extract:doctors` (datos reales).
  const seedDemoData =
    process.env.SEED_DEMO_DATA === "1" ||
    (process.env.SEED_DEMO_DATA !== "0" && process.env.NODE_ENV !== "production");

  const fallbackDoctors = seedDemoData
    ? [
        { name: "Dr. Juan Pérez", specialties: ["Cardiología"] },
        { name: "Dra. María González", specialties: ["Pediatría"] },
        { name: "Dr. Carlos Martínez", specialties: ["Traumatología"] },
        { name: "Dra. Ana López", specialties: ["Ginecología y Obstetricia"] },
      ].map((d) => ({ ...d, slug: slugify(d.name) }))
    : [];

  const doctorsFromFile = await tryReadJSON<
    { name: string; slug: string; specialties: string[] }[]
  >("doctors.json", fallbackDoctors);
  const doctors = doctorsFromFile.length > 0 ? doctorsFromFile : fallbackDoctors;

  for (let i = 0; i < doctors.length; i++) {
    const d = doctors[i];
    const [id] = await knex("doctors").insert({
      slug: d.slug || slugify(d.name),
      name: d.name,
      order: i,
    });
    for (const sname of d.specialties) {
      const sslug = slugify(sname);
      const sid = specBySlug.get(sslug);
      if (sid) {
        await knex("doctor_specialty").insert({ doctor_id: id, specialty_id: sid }).onConflict().ignore();
      }
    }
  }
}
