import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  createTestDatabase,
  dropTestDatabase,
  migrateLatest,
  runSeeds,
} from "./helpers/db";

/**
 * Nada que el sanatorio no haya confirmado se publica.
 *
 * La auditoría encontró horarios concretos, coberturas "24 horas",
 * estadísticas sin respaldo y afirmaciones sobre equipamiento y prestaciones
 * que nadie confirmó por escrito. Se retiraron por migración y salieron de los
 * seeds, pero eso se puede volver a colar en cualquier commit: acá se revisa
 * el contenido final de una base migrada y sembrada.
 *
 * Qué se revisa: lo que efectivamente se publica. Un estudio cargado pero sin
 * publicar, o un horario inactivo, no se muestra en el sitio; el catálogo
 * existe para que el sanatorio lo revise y lo publique desde el panel.
 *
 *   TEST_DATABASE=1 pnpm test tests/contenido-confirmado.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_contenido`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

/** Cada patrón con el motivo por el que no puede publicarse. */
const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: "horario concreto (07:00 a 19:00)", re: /\b\d{1,2}[:.]\d{2}\s*(?:a|-|–|hasta)\s*\d{1,2}[:.]\d{2}/i },
  { label: "horario concreto (de 7 a 19)", re: /\bde\s+\d{1,2}\s*(?:hs?)?\s+a\s+\d{1,2}\s*(?:hs?|horas)\b/i },
  { label: "cobertura 24 horas", re: /\b24\s*(?:horas|hs\b|h\b)/i },
  { label: "cobertura 24/7", re: /\b24\s*\/\s*7\b/ },
  { label: "los 365 días", re: /\b365\s*d[ií]as\b/i },
  { label: "equipamiento de última generación", re: /[úu]ltima\s+generaci[óo]n/i },
  { label: "alta definición", re: /alta\s+definici[óo]n/i },
  { label: "tomógrafo multicorte", re: /multicorte/i },
  { label: "estadística sin respaldo (50+/90+/30+)", re: /\b\d{2,}\s*\+/ },
  { label: "más de N especialidades/profesionales", re: /m[áa]s\s+de\s+\d+\s+(?:especialidades|profesionales|m[ée]dicos|a[ñn]os)/i },
  { label: "odontología para todas las edades", re: /para\s+todas\s+las\s+edades/i },
  { label: "afirma contar con anatomía patológica propia", re: /contamos\s+con\s+(?:un\s+)?(?:servicio\s+de\s+)?anatom[íi]a\s+patol[óo]gica/i },
  { label: "guardia activa (afirmación de cobertura)", re: /guardia\s+(?:m[ée]dica\s+)?activa/i },
];

/** Texto plano de cualquier valor, para buscar sin depender de la forma. */
function flatten(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return flatten(parsed);
    } catch {
      /* no era JSON: es texto */
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(flatten).join(" ");
  if (typeof value === "object") return Object.values(value as object).map(flatten).join(" ");
  return String(value);
}

function offendersIn(label: string, text: string): string[] {
  return FORBIDDEN.filter((f) => f.re.test(text)).map((f) => `${label}: ${f.label}`);
}

describeDb("contenido publicado sin afirmaciones sin confirmar", () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    // Como una instalación de producción: sin los médicos de ejemplo que el
    // seed carga en desarrollo (nombres inventados, no pueden publicarse).
    process.env.SEED_DEMO_DATA = "0";
    await runSeeds(db);
  }, 180_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("los bloques de las páginas publicadas no afirman nada sin confirmar", async () => {
    const rows = await db("blocks")
      .join("pages", "pages.id", "blocks.page_id")
      .where("pages.status", "published")
      .select("pages.slug as slug", "blocks.type as type", "blocks.order as order", "blocks.props as props");

    const offenders: string[] = [];
    for (const row of rows) {
      offenders.push(...offendersIn(`${row.slug}#${row.order} (${row.type})`, flatten(row.props)));
    }
    expect(offenders).toEqual([]);
  });

  it("los servicios no afirman prestaciones ni equipamiento sin confirmar", async () => {
    const rows = await db("services").select("slug", "name", "description", "body");
    const offenders: string[] = [];
    for (const row of rows) {
      offenders.push(...offendersIn(`servicio ${row.slug}`, flatten([row.name, row.description, row.body])));
    }
    expect(offenders).toEqual([]);
  });

  it("los estudios publicados tampoco", async () => {
    // El catálogo completo puede estar cargado; lo que no puede es publicarse
    // sin que el sanatorio confirme la prestación.
    const rows = await db("studies").where({ published: true }).select("slug", "name", "description", "body");
    const offenders: string[] = [];
    for (const row of rows) {
      offenders.push(...offendersIn(`estudio ${row.slug}`, flatten([row.name, row.description, row.body])));
    }
    expect(offenders).toEqual([]);
  });

  it("las especialidades tampoco", async () => {
    const rows = await db("specialties").select("slug", "name", "description");
    const offenders: string[] = [];
    for (const row of rows) {
      offenders.push(...offendersIn(`especialidad ${row.slug}`, flatten([row.name, row.description])));
    }
    expect(offenders).toEqual([]);
  });

  it("los ajustes públicos y los menús tampoco", async () => {
    const settings = await db("settings")
      .whereIn("key", ["brand", "theme", "contact", "seo"])
      .select("key", "value");
    const menus = await db("menus").select("location", "items");
    const offenders: string[] = [];
    for (const row of settings) offenders.push(...offendersIn(`settings.${row.key}`, flatten(row.value)));
    for (const row of menus) offenders.push(...offendersIn(`menu ${row.location}`, flatten(row.items)));
    expect(offenders).toEqual([]);
  });

  it("no hay horarios publicados sin que el sanatorio los cargue", async () => {
    const active = await db("schedules").where({ active: true }).select("key", "hours");
    // Ninguno activo en una instalación limpia; si mañana se activa alguno,
    // su horario es el que cargó el sanatorio y por eso no se filtra acá.
    expect(active).toEqual([]);
  });

  it("Odontología existe como especialidad, sin médicos inventados", async () => {
    const odontologia = await db("specialties").where({ slug: "odontologia" }).first();
    expect(odontologia, "falta la especialidad Odontología").toBeTruthy();
    const doctors = await db("doctors").count<{ c: number }[]>("id as c");
    expect(Number(doctors[0].c), "no se siembran profesionales de ejemplo").toBe(0);
    // Y la especialidad queda disponible para que el sanatorio asigne médicos.
    expect(odontologia.name).toBe("Odontología");
  });

  it("los patrones prohibidos detectan de verdad (control de la propia prueba)", () => {
    // Una prueba que no puede fallar no prueba nada.
    const ejemplos = [
      "Atendemos de 07:00 a 19:00",
      "Guardia 24 horas",
      "Abierto 24/7",
      "los 365 días del año",
      "equipamiento de última generación",
      "tomógrafo multicorte",
      "50+ profesionales",
      "más de 30 especialidades",
      "odontología para todas las edades",
      "Contamos con anatomía patológica",
    ];
    for (const texto of ejemplos) {
      expect(offendersIn("control", texto), texto).not.toEqual([]);
    }
    // Y no marcan texto legítimo.
    for (const ok of [
      "Horarios de atención",
      "Información a confirmar con el sanatorio.",
      "Consultá los datos de contacto de Emergencias.",
      "Estudios por imágenes",
    ]) {
      expect(offendersIn("control", ok), ok).toEqual([]);
    }
  });
});
