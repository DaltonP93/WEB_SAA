import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import { DB_TESTS_ENABLED, createTestDatabase, dropTestDatabase, jsonColumn, migrationSource } from "./helpers/db";

/**
 * El rollback no puede republicar la nota de la guardia.
 *
 * `20260820000000` retiró de `schedules.emergencias` la nota "Guardia activa
 * todos los días del año." y dejó un `down()` que sabe restaurarla. Ese `down()`
 * comprueba **una sola** cosa antes de escribir: que `note` esté vacío.
 *
 * El caso peligroso es el más natural de todos: el sanatorio carga el horario
 * real de la guardia y activa la fila, sin escribir ninguna nota porque no hace
 * falta. La fila pasa a ser publicable. Un rollback posterior encuentra `note`
 * vacío, cumple la única condición que ese `down()` mira, y publica la
 * afirmación no confirmada **junto al horario real**.
 *
 * `20260821000000` blinda ese camino. Como es posterior, su `down()` corre
 * antes y desarma la restauración si hay evidencia de intervención.
 *
 * Acá se ejecuta el flujo completo entre versiones: cadena hasta la vieja,
 * edición del cliente, cadena hasta la nueva, rollback de las dos.
 *
 *   TEST_DATABASE=1 pnpm test tests/rollback-nota-emergencias-blindado.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_blindaje`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const VIEJA = "20260820000000_nota_emergencias_no_confirmada.ts";
const NUEVA = "20260821000000_blindar_rollback_nota_emergencias.ts";
const SNAP_VIEJO = "snapshot_nota_emergencias_20260820000000";
const SNAP_NUEVO = "snapshot_blindaje_guardia_20260821000000";
const NOTA_LEGACY = "Guardia activa todos los días del año.";

describeDb("blindaje del rollback de la nota de la guardia", () => {
  let db: Knex;
  let todas: string[] = [];

  const fila = () => db("schedules").where({ key: "emergencias" }).first();
  const snap = async (key: string) => {
    const row = await db("settings").where({ key }).first();
    return row ? (jsonColumn(row.value) as any) : null;
  };

  /** Una fuente de migraciones que corta después de `hasta` (inclusive). */
  const hasta = (nombre: string) => {
    const corte = todas.indexOf(nombre);
    expect(corte, `no se encontró ${nombre}`).toBeGreaterThan(-1);
    const lista = todas.slice(0, corte + 1);
    return {
      getMigrations: async () => lista,
      getMigrationName: (n: string) => n,
      getMigration: (n: string) => migrationSource.getMigration(n),
    } as never;
  };

  /**
   * Revierte hasta deshacer `nombre`, sea cuál sea su posición en la cadena.
   *
   * Contar los `down()` a mano ataba estas pruebas a que el blindaje fuera la
   * última migración del repo. Dejó de serlo en cuanto se sumó
   * `20260822000000`, y entonces un `down()` revertía otra cosa: las
   * aserciones seguían pasando o fallando por motivos que ya no eran los que
   * decían mirar.
   */
  const revertirHasta = async (nombre: string) => {
    for (let i = 0; i < 20; i++) {
      const aplicada = await db("knex_migrations").where({ name: nombre }).first();
      if (!aplicada) return;
      await db.migrate.down({ migrationSource } as never);
    }
    throw new Error(`no se pudo revertir ${nombre} en 20 pasos`);
  };

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    todas = await migrationSource.getMigrations();
    expect(todas, "el blindaje tiene que estar en la cadena").toContain(NUEVA);
    expect(
      todas.indexOf(NUEVA),
      "el blindaje tiene que correr después de la correctiva que blinda",
    ).toBeGreaterThan(todas.indexOf(VIEJA));
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  /** Base limpia con la cadena aplicada hasta la migración vieja inclusive. */
  beforeEach(async () => {
    await db.raw("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of (await db.raw("SHOW TABLES"))[0]) {
      await db.raw(`DROP TABLE IF EXISTS \`${Object.values(t)[0]}\``);
    }
    await db.raw("SET FOREIGN_KEY_CHECKS = 1");
    await db.migrate.latest({ migrationSource: hasta(VIEJA) });
  }, 240_000);

  it("la migración vieja limpió la nota y dejó su snapshot armado", async () => {
    expect((await fila()).note ?? "").toBe("");
    expect((await snap(SNAP_VIEJO)).motivo).toBe("limpiada");
  }, 120_000);

  describe("el cliente cargó el horario y activó la fila", () => {
    beforeEach(async () => {
      // Sin escribir ninguna nota: no hace falta para publicar un horario.
      await db("schedules").where({ key: "emergencias" }).update({ hours: "24 horas", active: true });
      await db.migrate.latest({ migrationSource });
    }, 240_000);

    it("la nota legacy NO reaparece al revertir las dos migraciones", async () => {
      await revertirHasta(VIEJA);

      const f = await fila();
      expect(f.note ?? "", "se republicó una afirmación no confirmada").toBe("");
      // Y la carga del sanatorio sigue intacta.
      expect(f.hours).toBe("24 horas");
      expect(Boolean(f.active)).toBe(true);
    }, 240_000);

    it("el snapshot viejo queda desarmado y con la marca de quién lo hizo", async () => {
      // Se revierten los blindajes y se para justo antes de la correctiva: es
      // el momento en que su restauración automática ya tiene que estar
      // desarmada. Cuál de los blindajes lo hizo es un detalle interno —hoy es
      // el de campos, que corre primero— y anclar la prueba a uno concreto la
      // volvería a romper con el siguiente.
      await revertirHasta(NUEVA);

      const viejo = await snap(SNAP_VIEJO);
      expect(viejo.motivo).toBe("editada");
      expect(viejo.notaAnterior).toBeNull();
      expect(viejo.neutralizadoPor).toMatch(/^snapshot_blindaje/);
    }, 240_000);
  });

  describe("otras formas de intervención posterior", () => {
    const casos: [string, (db: Knex) => Promise<unknown>][] = [
      ["se cargaron los días", (d) => d("schedules").where({ key: "emergencias" }).update({ days: "Todos los días" })],
      ["se cargó el horario", (d) => d("schedules").where({ key: "emergencias" }).update({ hours: "24 horas" })],
      ["se activó la fila", (d) => d("schedules").where({ key: "emergencias" }).update({ active: true })],
      [
        "se cambió el área",
        // `updated_at` explícito: en producción la edición del sanatorio ocurre
        // días después de la migración, no en el mismo segundo. Comprimirlo a
        // milisegundos haría que la prueba dependiera del reloj.
        (d) =>
          d("schedules")
            .where({ key: "emergencias" })
            .update({ area: "Guardia", updated_at: new Date(Date.now() + 60_000) }),
      ],
      [
        "se borró y se recreó la fila",
        async (d) => {
          await d("schedules").where({ key: "emergencias" }).del();
          await d("schedules").insert({
            key: "emergencias",
            area: "Emergencias",
            active: false,
            order: 0,
            created_at: new Date(Date.now() + 60_000),
            updated_at: new Date(Date.now() + 60_000),
          });
        },
      ],
    ];

    it.each(casos)("%s → la nota no vuelve", async (_titulo, intervenir) => {
      await intervenir(db);
      await db.migrate.latest({ migrationSource });

      await revertirHasta(VIEJA);

      expect((await fila())?.note ?? "").toBe("");
    }, 240_000);
  });

  describe("sin intervención, el comportamiento documentado se conserva", () => {
    it("el rollback sí restaura la nota, como estaba escrito", async () => {
      // El blindaje no puede convertirse en un bloqueo permanente: si nadie
      // tocó la fila, revertir tiene que devolver exactamente el estado previo.
      await db.migrate.latest({ migrationSource });

      await revertirHasta(NUEVA); // todos los blindajes, ninguno más
      expect((await snap(SNAP_VIEJO)).motivo, "no había evidencia: no se desarma").toBe("limpiada");

      await revertirHasta(VIEJA);
      expect((await fila()).note).toBe(NOTA_LEGACY);
    }, 240_000);
  });

  describe("la migración nueva es idempotente y no toca datos", () => {
    it("volver a aplicarla no cambia la huella registrada", async () => {
      await db.migrate.latest({ migrationSource });
      const primero = await snap(SNAP_NUEVO);

      const mod = await migrationSource.getMigration(NUEVA);
      await mod.up(db);

      expect(await snap(SNAP_NUEVO)).toEqual(primero);
    }, 240_000);

    it("aplicarla no modifica la fila", async () => {
      const antes = await fila();
      await db.migrate.latest({ migrationSource });
      const despues = await fila();

      expect({ ...despues, updated_at: null }).toEqual({ ...antes, updated_at: null });
    }, 240_000);
  });
});
