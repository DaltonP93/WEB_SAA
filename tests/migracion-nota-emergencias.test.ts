import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  createTestDatabase,
  dropTestDatabase,
  jsonColumn,
  migrationSource,
} from "./helpers/db";

/**
 * La nota no confirmada de la guardia sale del producto, sin pisar al cliente.
 *
 * `schedules.emergencias` quedó con la nota "Guardia activa todos los días del
 * año.", que es una afirmación sobre la cobertura de la guardia que el
 * sanatorio nunca confirmó. Hoy no llega al público —el endpoint filtra por
 * `active` y por `hours` cargado— pero está a un clic de publicarse: alcanza
 * con marcar la fila activa y cargarle un horario.
 *
 * La migración correctiva tiene que caminar por una línea fina: limpiar el caso
 * que nadie tocó y **no** tocar el que alguien editó. Una correctiva que pisa
 * contenido del cliente es peor que la nota que viene a corregir.
 *
 *   TEST_DATABASE=1 pnpm test tests/migracion-nota-emergencias.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_notaemerg`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const MIGRACION = "20260820000000_nota_emergencias_no_confirmada.ts";
const SNAPSHOT_KEY = "snapshot_nota_emergencias_20260820000000";
const NOTA_LEGACY = "Guardia activa todos los días del año.";

describeDb("migración correctiva de la nota de Emergencias", () => {
  let db: Knex;
  /** Todas las migraciones menos la correctiva: el estado "antes". */
  let fuenteAnterior: any;

  const filaEmergencias = () => db("schedules").where({ key: "emergencias" }).first();
  const snapshot = async () => {
    const row = await db("settings").where({ key: SNAPSHOT_KEY }).first();
    return row ? (jsonColumn(row.value) as any) : null;
  };

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    const todas = await migrationSource.getMigrations();
    expect(todas, "la correctiva tiene que ser la última").toContain(MIGRACION);
    const previas = todas.filter((n) => n !== MIGRACION);
    fuenteAnterior = {
      getMigrations: async () => previas,
      getMigrationName: (n: string) => n,
      getMigration: (n: string) => migrationSource.getMigration(n),
    };
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  /** Deja la base con toda la cadena aplicada MENOS la correctiva. */
  beforeEach(async () => {
    await db.raw("SET FOREIGN_KEY_CHECKS = 0");
    const tablas = await db.raw("SHOW TABLES");
    for (const fila of tablas[0]) {
      await db.raw(`DROP TABLE IF EXISTS \`${Object.values(fila)[0]}\``);
    }
    await db.raw("SET FOREIGN_KEY_CHECKS = 1");
    await db.migrate.latest({ migrationSource: fuenteAnterior } as never);
  }, 240_000);

  it("el estado previo tiene la nota legacy, inactiva y sin horario", async () => {
    // Se comprueba ejecutando la cadena entera, no leyendo la migración que la
    // creó: alguna posterior podría haberla cambiado.
    const fila = await filaEmergencias();
    expect(fila.note).toBe(NOTA_LEGACY);
    expect(Boolean(fila.active)).toBe(false);
    expect(fila.days ?? "").toBe("");
    expect(fila.hours ?? "").toBe("");
  }, 120_000);

  it("la nota legacy no es publicable en ese estado", async () => {
    // El filtro del endpoint público exige active y hours cargado.
    const publicables = await db("schedules").where({ active: true }).whereNotNull("hours");
    expect(publicables).toEqual([]);
  }, 120_000);

  describe("caso limpio: nadie tocó la fila", () => {
    it("borra la nota y deja el snapshot", async () => {
      await db.migrate.latest({ migrationSource });

      expect((await filaEmergencias()).note ?? "").toBe("");
      const snap = await snapshot();
      expect(snap.motivo).toBe("limpiada");
      expect(snap.notaAnterior).toBe(NOTA_LEGACY);
    }, 240_000);

    it("es idempotente: volver a correrla no cambia nada", async () => {
      await db.migrate.latest({ migrationSource });
      const snapPrimero = await snapshot();
      // Se simula una segunda corrida del `up()` con el snapshot ya presente.
      const mod = await migrationSource.getMigration(MIGRACION);
      await mod.up(db);

      expect((await filaEmergencias()).note ?? "").toBe("");
      expect(await snapshot()).toEqual(snapPrimero);
    }, 240_000);

    it("el down() restaura la nota exacta", async () => {
      await db.migrate.latest({ migrationSource });
      await db.migrate.down({ migrationSource } as never);

      expect((await filaEmergencias()).note).toBe(NOTA_LEGACY);
      expect(await snapshot()).toBeNull();
    }, 240_000);
  });

  describe("hubo carga posterior: no se toca", () => {
    it("con una nota propia del cliente, la deja intacta", async () => {
      const propia = "Nota que cargó el sanatorio.";
      await db("schedules").where({ key: "emergencias" }).update({ note: propia });

      await db.migrate.latest({ migrationSource });

      expect((await filaEmergencias()).note).toBe(propia);
      const snap = await snapshot();
      expect(snap.motivo, "queda identificable para revisión manual").toBe("editada");
      expect(snap.notaAnterior).toBe(propia);
    }, 240_000);

    it("con la nota legacy pero la fila ya activa, no la toca", async () => {
      await db("schedules").where({ key: "emergencias" }).update({ active: true });

      await db.migrate.latest({ migrationSource });

      expect((await filaEmergencias()).note).toBe(NOTA_LEGACY);
      expect((await snapshot()).motivo).toBe("editada");
    }, 240_000);

    it("con la nota legacy pero un horario cargado, no la toca", async () => {
      await db("schedules").where({ key: "emergencias" }).update({ hours: "24 horas" });

      await db.migrate.latest({ migrationSource });

      expect((await filaEmergencias()).note).toBe(NOTA_LEGACY);
      expect((await snapshot()).motivo).toBe("editada");
    }, 240_000);

    it("el down() de un caso 'editada' no escribe nada", async () => {
      const propia = "Otra nota del sanatorio.";
      await db("schedules").where({ key: "emergencias" }).update({ note: propia });
      await db.migrate.latest({ migrationSource });
      await db.migrate.down({ migrationSource } as never);

      expect((await filaEmergencias()).note).toBe(propia);
    }, 240_000);
  });

  describe("el down() no pisa lo que el cliente cargó después", () => {
    it("si el sanatorio escribió su nota tras la limpieza, revertir la respeta", async () => {
      await db.migrate.latest({ migrationSource });
      expect((await filaEmergencias()).note ?? "").toBe("");

      const posterior = "Guardia confirmada por el sanatorio.";
      await db("schedules").where({ key: "emergencias" }).update({ note: posterior });

      await db.migrate.down({ migrationSource } as never);

      // Revertir devuelve el estado anterior; no sobrescribe lo nuevo.
      expect((await filaEmergencias()).note).toBe(posterior);
      expect(await snapshot()).toBeNull();
    }, 240_000);
  });
});
