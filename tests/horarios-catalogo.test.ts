import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import { RESERVED_SCHEDULES, isReservedSchedule } from "../api/src/institutional-schedules";
import {
  DB_TESTS_ENABLED,
  createTestDatabase,
  dropTestDatabase,
  migrateLatest,
} from "./helpers/db";

/**
 * El catálogo de runtime de horarios tiene que decir lo mismo que la base.
 *
 * `RESERVED_SCHEDULES` existe porque enumerar `schedules` no alcanza para saber
 * que **falta** una fila: recorrer la tabla sólo dice qué hay, y una fila
 * perdida desaparece del informe en vez de aparecer como problema.
 *
 * Pero un catálogo escrito a mano es una segunda fuente de verdad, y este
 * proyecto ya tuvo el problema con las ocho claves de canales: dos listas se
 * desincronizan solas y el síntoma es silencioso. Acá la garantía es esta
 * prueba, que compara el catálogo contra las filas que deja la cadena
 * **completa** de migraciones —no lo que declara la migración que las creó, que
 * podría haber cambiado después— y exige igualdad exacta en los dos sentidos.
 *
 *   TEST_DATABASE=1 pnpm test tests/horarios-catalogo.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_horarios`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describe("forma del catálogo", () => {
  it("declara siete áreas con nombre no vacío", () => {
    const claves = Object.keys(RESERVED_SCHEDULES);
    expect(claves).toHaveLength(7);
    for (const clave of claves) {
      expect(clave, `clave con formato inesperado: ${clave}`).toMatch(/^[a-z0-9-]+$/);
      expect(RESERVED_SCHEDULES[clave].trim().length, `${clave} sin nombre`).toBeGreaterThan(0);
    }
  });

  it("isReservedSchedule no se deja engañar por el prototipo", () => {
    expect(isReservedSchedule("emergencias")).toBe(true);
    expect(isReservedSchedule("inventada")).toBe(false);
    // `key in obj` habría dado `true` acá y una fila fantasma en el informe.
    expect(isReservedSchedule("toString")).toBe(false);
    expect(isReservedSchedule("constructor")).toBe(false);
    expect(isReservedSchedule(undefined)).toBe(false);
  });

  it("no trae ningún horario ni día: son sólo claves y nombres", () => {
    const texto = JSON.stringify(RESERVED_SCHEDULES);
    expect(texto).not.toMatch(/\d{1,2}[:.]\d{2}/);
    expect(texto).not.toMatch(/24\s*horas/i);
  });
});

describeDb("el catálogo y la base dicen lo mismo", () => {
  let db: Knex;
  let clavesEnBase: string[] = [];

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    clavesEnBase = (await db("schedules").orderBy("order").select("key")).map((r) => r.key);
  }, 240_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("las claves coinciden exactamente, sin sobras ni faltantes", () => {
    // Comparación en los dos sentidos: una inclusión sola dejaría pasar el caso
    // en que la base trae una fila institucional que el catálogo no conoce, y
    // esa fila quedaría fuera del informe sin que nada lo delate.
    expect([...clavesEnBase].sort()).toEqual(Object.keys(RESERVED_SCHEDULES).sort());
  });

  it("una instalación nueva trae exactamente siete filas", () => {
    expect(clavesEnBase).toHaveLength(7);
  });

  it("el nombre por defecto del catálogo es el que la cadena deja en la base", async () => {
    // Se lee después de correr TODA la cadena: una migración posterior podría
    // haber renombrado un área, y el catálogo tiene que seguirla.
    for (const fila of await db("schedules").select("key", "area")) {
      expect(fila.area, `el nombre de ${fila.key} no coincide con el catálogo`).toBe(
        RESERVED_SCHEDULES[fila.key],
      );
    }
  });

  it("ninguna fila nace publicada ni con horario cargado", async () => {
    const filas = await db("schedules").select("active", "hours", "days");
    expect(filas.every((f) => !f.active)).toBe(true);
    expect(filas.every((f) => !f.hours)).toBe(true);
    expect(filas.every((f) => !f.days)).toBe(true);
  });
});
