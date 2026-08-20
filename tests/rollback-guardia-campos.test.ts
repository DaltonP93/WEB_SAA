import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import bcrypt from "bcryptjs";
import {
  DB_TESTS_ENABLED,
  TEST_ADMIN_PASSWORD,
  applyDbEnv,
  closeAppDb,
  closeServer,
  createTestDatabase,
  dropTestDatabase,
  jsonColumn,
  migrationSource,
} from "./helpers/db";

/**
 * El blindaje del rollback de la guardia, contra ediciones **reales** del panel.
 *
 * `20260821000000` reconocía la intervención del sanatorio por dos caminos: un
 * predicado sobre el estado publicable (`note`, `days`, `hours`, `active`) y,
 * para lo que ese predicado no ve, una comparación de `created_at`/`updated_at`.
 *
 * El segundo camino no funcionaba. El CRUD del panel escribía sólo las columnas
 * del payload, así que un `PUT /api/admin/schedules/:id` que cambia `area`
 * dejaba `updated_at` en el valor que le había puesto la migración. La fila
 * seguía "limpia" para el predicado y sus marcas de tiempo seguían siendo las
 * de siempre: cero evidencia, y el rollback republicaba la afirmación no
 * confirmada sobre una fila que el sanatorio ya había editado.
 *
 * La prueba que cubría ese caso forzaba `updated_at` a una fecha futura desde
 * SQL. Eso demuestra que el mecanismo reacciona a una marca movida, no que la
 * marca se mueva cuando alguien edita de verdad — que era justamente lo que
 * había que probar.
 *
 * Acá **no se escribe ninguna marca de tiempo para simular una edición**: se
 * autentica contra la API real y se manda el mismo PUT que manda el panel. En
 * un caso se hace lo contrario, restaurar las marcas después de editar, para
 * comprobar que la detección no depende de ellas ni siquiera como ayuda.
 *
 *   TEST_DATABASE=1 pnpm test tests/rollback-guardia-campos.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_campos`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const CORRECTIVA = "20260820000000_nota_emergencias_no_confirmada.ts";
const BLINDAJE_CAMPOS = "20260822000000_blindaje_guardia_por_campos.ts";
const SNAP_CORRECTIVA = "snapshot_nota_emergencias_20260820000000";
const SNAP_CAMPOS = "snapshot_blindaje_campos_guardia_20260822000000";
const NOTA_LEGACY = "Guardia activa todos los días del año.";
const EMAIL = "admin@sanatorio.local";

describeDb("el blindaje de la guardia detecta ediciones reales del panel", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";
  let todas: string[] = [];

  const fila = () => db("schedules").where({ key: "emergencias" }).first();
  const snap = async (key: string) => {
    const row = await db("settings").where({ key }).first();
    return row ? (jsonColumn(row.value) as any) : null;
  };

  /** Fuente de migraciones cortada después de `nombre` (inclusive). */
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

  /** Revierte hasta deshacer `nombre`, sin contar pasos a mano. */
  const revertirHasta = async (nombre: string) => {
    for (let i = 0; i < 25; i++) {
      const aplicada = await db("knex_migrations").where({ name: nombre }).first();
      if (!aplicada) return;
      await db.migrate.down({ migrationSource } as never);
    }
    throw new Error(`no se pudo revertir ${nombre} en 25 pasos`);
  };

  /**
   * La misma llamada que hace el panel: `PUT` con los campos que cambiaron.
   *
   * No manda `updated_at` ni ninguna marca de tiempo — el schema del endpoint
   * ni siquiera la acepta.
   */
  const editar = async (cambios: Record<string, unknown>) => {
    const { id } = await fila();
    const res = await fetch(`${baseUrl}/api/admin/schedules/${id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cambios),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    return res;
  };

  const crearAdmin = async () => {
    await db("users").insert({
      email: EMAIL,
      password_hash: await bcrypt.hash(TEST_ADMIN_PASSWORD, 10),
      name: "Administrador",
      role: "superadmin",
    });
  };

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    todas = await migrationSource.getMigrations();
    expect(todas, "el blindaje por campos tiene que estar en la cadena").toContain(BLINDAJE_CAMPOS);
    expect(
      todas.indexOf(BLINDAJE_CAMPOS),
      "tiene que correr después de la correctiva que blinda",
    ).toBeGreaterThan(todas.indexOf(CORRECTIVA));

    await db.migrate.latest({ migrationSource });
    await crearAdmin();

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-campos";
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    // Se inicia sesión **una sola vez**: el login tiene rate limit por IP y
    // `requireAuth` sólo verifica la firma del token, así que sigue sirviendo
    // después de recrear las tablas entre pruebas.
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: TEST_ADMIN_PASSWORD }),
    });
    expect(login.status, await login.clone().text()).toBe(200);
    token = (await login.json()).token;
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  /** Base con la cadena aplicada hasta la correctiva inclusive, y sesión viva. */
  beforeEach(async () => {
    await db.raw("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of (await db.raw("SHOW TABLES"))[0]) {
      await db.raw(`DROP TABLE IF EXISTS \`${Object.values(t)[0]}\``);
    }
    await db.raw("SET FOREIGN_KEY_CHECKS = 1");
    await db.migrate.latest({ migrationSource: hasta(CORRECTIVA) });
    await crearAdmin();
  }, 240_000);

  describe("una edición real del panel no mueve el estado publicable", () => {
    it("cambiar el área deja la fila igual de 'limpia' para el predicado viejo", async () => {
      await db.migrate.latest({ migrationSource });
      await editar({ area: "Guardia de urgencias" });

      const f = await fila();
      // Exactamente las cuatro condiciones que mira `20260821000000`: si la
      // detección dependiera sólo de ellas, esto sería un falso negativo.
      expect(f.note ?? "").toBe("");
      expect(f.days ?? "").toBe("");
      expect(f.hours ?? "").toBe("");
      expect(Boolean(f.active)).toBe(false);
      expect(f.area).toBe("Guardia de urgencias");
    }, 240_000);
  });

  describe("edición posterior a todos los blindajes", () => {
    const NOTA_PROPIA = "Nota propia del sanatorio.";

    /** Qué campo se cambió y qué nota tiene que quedar después del rollback. */
    const casos: [string, Record<string, unknown>, string][] = [
      ["el área", { area: "Guardia" }, ""],
      ["el servicio relacionado", { service_slug: "emergencias" }, ""],
      ["el orden", { order: 4 }, ""],
      ["los días", { days: "Todos los días" }, ""],
      ["el horario", { hours: "24 horas" }, ""],
      ["la publicación", { active: true }, ""],
      // Acá lo que queda no es vacío sino lo que escribió el sanatorio: el
      // `down()` viejo nunca pisa una nota cargada. Lo que importa en los siete
      // casos es lo mismo — que no vuelva la afirmación no confirmada.
      ["la nota", { note: NOTA_PROPIA }, NOTA_PROPIA],
    ];

    it.each(casos)(
      "se cambió %s desde el panel → la nota legacy no vuelve",
      async (_q, cambios, esperada) => {
        await db.migrate.latest({ migrationSource });
        await editar(cambios);

        await revertirHasta(CORRECTIVA);

        const nota = (await fila())?.note ?? "";
        expect(nota, "se republicó una afirmación no confirmada").not.toBe(NOTA_LEGACY);
        expect(nota).toBe(esperada);
      },
      240_000,
    );

    it("y el snapshot de la correctiva queda desarmado con su marca", async () => {
      await db.migrate.latest({ migrationSource });
      await editar({ area: "Guardia" });

      await revertirHasta(BLINDAJE_CAMPOS);

      const s = await snap(SNAP_CORRECTIVA);
      expect(s.motivo).toBe("editada");
      expect(s.notaAnterior).toBeNull();
      expect(s.neutralizadoPor).toBe(SNAP_CAMPOS);
    }, 240_000);
  });

  describe("edición ocurrida entre la correctiva y los blindajes", () => {
    // La ventana que una huella tomada al instalar no puede ver: cuando el
    // blindaje corre, la edición ya está incorporada y comparar contra ella
    // daría "sin cambios". La cubre la comparación contra el estado de fábrica.
    const casos: [string, Record<string, unknown>][] = [
      ["el área", { area: "Guardia" }],
      ["el servicio relacionado", { service_slug: "emergencias" }],
      ["el orden", { order: 6 }],
    ];

    it.each(casos)("se había cambiado %s → la nota legacy no vuelve", async (_q, cambios) => {
      // Los blindajes todavía no están aplicados: la cadena está cortada en la
      // correctiva. La API sí funciona, que es lo que importa.
      await editar(cambios);
      await db.migrate.latest({ migrationSource });

      await revertirHasta(CORRECTIVA);

      expect((await fila())?.note ?? "").toBe("");
    }, 240_000);

    it("el blindaje registra que la fila no estaba de fábrica", async () => {
      await editar({ area: "Guardia" });
      await db.migrate.latest({ migrationSource });

      expect((await snap(SNAP_CAMPOS)).deFabricaAlInstalar).toBe(false);
    }, 240_000);
  });

  describe("la detección no se apoya en las marcas de tiempo", () => {
    it("con las marcas restauradas a mano, el cambio de campo alcanza", async () => {
      await db.migrate.latest({ migrationSource });

      const antes = await fila();
      await editar({ area: "Guardia" });
      // Se deshace **a propósito** el único rastro temporal de la edición, para
      // que la única diferencia que quede sea el campo. Es lo contrario de
      // fabricar una intervención escribiendo una fecha: acá se le quita al
      // mecanismo la pista fácil.
      await db("schedules")
        .where({ key: "emergencias" })
        .update({ created_at: antes.created_at, updated_at: antes.updated_at });

      const f = await fila();
      expect(new Date(f.updated_at).getTime()).toBe(new Date(antes.updated_at).getTime());

      await revertirHasta(CORRECTIVA);

      expect((await fila())?.note ?? "").toBe("");
    }, 240_000);

    it("una edición dentro del mismo segundo también se detecta", async () => {
      await db.migrate.latest({ migrationSource });
      // Sin esperas: el PUT ocurre en el mismo segundo en que corrieron las
      // migraciones, así que las marcas de tiempo —precisión de segundo— no
      // distinguen nada.
      await editar({ area: "Guardia" });

      await revertirHasta(CORRECTIVA);

      expect((await fila())?.note ?? "").toBe("");
    }, 240_000);
  });

  describe("borrado y recreación de la fila", () => {
    it("recreada desde la API con los mismos valores → la nota no vuelve", async () => {
      await db.migrate.latest({ migrationSource });

      const { id } = await fila();
      const baja = await fetch(`${baseUrl}/api/admin/schedules/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(baja.status).toBe(204);

      const alta = await fetch(`${baseUrl}/api/admin/schedules`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ key: "emergencias", area: "Emergencias", active: false, order: 0 }),
      });
      expect(alta.status, await alta.clone().text()).toBe(201);

      await revertirHasta(CORRECTIVA);

      expect((await fila())?.note ?? "").toBe("");
    }, 240_000);

    it("borrada y no recreada → tampoco escribe nada", async () => {
      await db.migrate.latest({ migrationSource });

      const { id } = await fila();
      await fetch(`${baseUrl}/api/admin/schedules/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      await revertirHasta(CORRECTIVA);

      expect(await fila()).toBeUndefined();
    }, 240_000);
  });

  describe("sin intervención, la reversibilidad se conserva", () => {
    it("el rollback restaura la nota exacta si nadie tocó la fila", async () => {
      // El blindaje no puede convertirse en un bloqueo permanente: es una
      // migración reversible y tiene que seguir siéndolo.
      await db.migrate.latest({ migrationSource });
      expect((await snap(SNAP_CAMPOS)).deFabricaAlInstalar).toBe(true);

      await revertirHasta(BLINDAJE_CAMPOS);
      expect((await snap(SNAP_CORRECTIVA)).motivo, "no había evidencia: no se desarma").toBe(
        "limpiada",
      );

      await revertirHasta(CORRECTIVA);
      expect((await fila()).note).toBe(NOTA_LEGACY);
    }, 240_000);

    it("leer la pantalla de Horarios no cuenta como intervención", async () => {
      // Un GET no puede dejar rastro: si lo dejara, abrir el panel una vez
      // bastaría para bloquear el rollback para siempre.
      await db.migrate.latest({ migrationSource });
      const res = await fetch(`${baseUrl}/api/admin/schedules`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);

      await revertirHasta(CORRECTIVA);

      expect((await fila()).note).toBe(NOTA_LEGACY);
    }, 240_000);
  });

  describe("el blindaje es idempotente y no toca datos", () => {
    it("volver a aplicarlo no cambia la huella registrada", async () => {
      await db.migrate.latest({ migrationSource });
      const primero = await snap(SNAP_CAMPOS);

      const mod = await migrationSource.getMigration(BLINDAJE_CAMPOS);
      await mod.up(db);

      expect(await snap(SNAP_CAMPOS)).toEqual(primero);
    }, 240_000);

    it("aplicarlo no modifica la fila", async () => {
      const antes = await fila();
      await db.migrate.latest({ migrationSource });
      expect(await fila()).toEqual(antes);
    }, 240_000);
  });

  describe("el CRUD mantiene updated_at", () => {
    it("un PUT del panel mueve la marca de tiempo", async () => {
      // La corrección de fondo, que el blindaje ya no necesita pero igual
      // corresponde: sin esto la marca quedaba congelada en el valor que le
      // puso la migración que creó la fila.
      await db.migrate.latest({ migrationSource });
      const antes = await fila();
      await db("schedules")
        .where({ key: "emergencias" })
        .update({ updated_at: new Date(Date.now() - 60_000) });

      await editar({ area: "Guardia" });

      const despues = await fila();
      expect(new Date(despues.updated_at).getTime()).toBeGreaterThan(Date.now() - 30_000);
      expect(despues.area).not.toBe(antes.area);
    }, 240_000);
  });
});
