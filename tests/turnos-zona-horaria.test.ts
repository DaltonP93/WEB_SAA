import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  ZONA_INSTITUCIONAL,
  formatearEnZona,
  inicioDelDia,
  inicioDelDiaSiguiente,
  instanteDesdeHoraLocal,
} from "../api/src/timezone";
import {
  DB_TESTS_ENABLED,
  TEST_ADMIN_PASSWORD,
  applyDbEnv,
  closeAppDb,
  closeServer,
  createTestDatabase,
  dropTestDatabase,
  migrateLatest,
  runSeeds,
} from "./helpers/db";

/**
 * La hora de un turno es la hora del sanatorio, no la del servidor.
 *
 * `<input type="datetime-local">` manda `"2027-03-15T10:30"` sin offset.
 * `new Date(ese_valor)` lo resolvía con la zona del proceso: un VPS en UTC
 * guardaba las 10:30 UTC —las 07:30 de Asunción— para alguien que eligió las
 * 10:30 de la mañana. La fila quedaba con una hora perfectamente plausible y
 * equivocada, y no fallaba en ningún lado.
 *
 * Lo mismo con los límites de los filtros por fecha: "del 1 al 15" significaba
 * cosas distintas según cómo estuviera configurada la máquina.
 *
 * Estas pruebas ejecutan la conversión en **procesos con otra zona** —no
 * simulan la diferencia, la provocan— y comprueban que el instante guardado sea
 * el mismo.
 *
 *   TEST_DATABASE=1 pnpm test tests/turnos-zona-horaria.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_zona`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;
const ROOT = resolve(__dirname, "..");

describe("la zona institucional es una sola y está declarada", () => {
  it("es la zona IANA de Paraguay, no un offset a mano", () => {
    expect(ZONA_INSTITUCIONAL).toBe("America/Asuncion");
    // Sin comentarios: ahí el offset se nombra justamente para explicar por
    // qué no se usa.
    const fuente = readFileSync(resolve(ROOT, "api/src/timezone.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // Un offset fijo es una afirmación sobre el pasado y el futuro que nadie
    // va a revisar el día que cambien las reglas.
    expect(fuente).not.toMatch(/-0?3:00/);
  });

  it("el panel usa exactamente la misma zona que la API", () => {
    // Si una cambia y la otra no, la bandeja muestra una hora que la base no
    // guardó, y nadie tiene cómo notarlo.
    const panel = readFileSync(resolve(ROOT, "apps/admin/src/lib/fecha.ts"), "utf8");
    expect(panel).toContain(`"${ZONA_INSTITUCIONAL}"`);
  });
});

describe("conversión de hora de pared a instante", () => {
  it("interpreta la hora elegida como hora de Asunción", () => {
    // Enero: Paraguay estaba en UTC-3 (horario de verano, vigente hasta 2024).
    expect(instanteDesdeHoraLocal("2020-01-15T10:30")?.toISOString()).toBe("2020-01-15T13:30:00.000Z");
    // Julio de un año con horario de invierno: UTC-4.
    expect(instanteDesdeHoraLocal("2020-07-15T10:30")?.toISOString()).toBe("2020-07-15T14:30:00.000Z");
  });

  it("vacío es vacío y basura es basura, y se distinguen", () => {
    expect(instanteDesdeHoraLocal("")).toBeNull();
    expect(instanteDesdeHoraLocal(undefined)).toBeNull();
    expect(instanteDesdeHoraLocal("no-es-una-fecha")).toBeUndefined();
  });

  it("un valor que ya trae offset se respeta tal cual", () => {
    expect(instanteDesdeHoraLocal("2020-01-15T13:30:00Z")?.toISOString()).toBe("2020-01-15T13:30:00.000Z");
  });

  it("ida y vuelta: lo que se elige es lo que se muestra", () => {
    for (const elegido of ["2027-03-15T10:30", "2027-07-01T00:00", "2027-12-31T23:59"]) {
      const instante = instanteDesdeHoraLocal(elegido) as Date;
      const [fecha, hora] = elegido.split("T");
      const [y, m, d] = fecha.split("-");
      expect(formatearEnZona(instante)).toBe(`${d}/${m}/${y} ${hora}`);
    }
  });
});

describe("límites del día", () => {
  it("el 'hasta' es el inicio del día siguiente, no las 23:59:59.999", () => {
    const inicio = inicioDelDia("2020-01-15") as Date;
    const fin = inicioDelDiaSiguiente("2020-01-15") as Date;
    expect(inicio.toISOString()).toBe("2020-01-15T03:00:00.000Z");
    expect(fin.toISOString()).toBe("2020-01-16T03:00:00.000Z");
  });

  it("cruza el fin de mes y el fin de año sin casos especiales", () => {
    expect(inicioDelDiaSiguiente("2020-12-31")?.toISOString()).toBe("2021-01-01T03:00:00.000Z");
    expect(inicioDelDiaSiguiente("2024-02-28")?.toISOString()).toBe("2024-02-29T03:00:00.000Z");
  });

  it("un día de cambio de horario dura 23 o 25 horas, no 24", () => {
    // Sumar 24 h al instante caería una hora antes o después de la medianoche.
    const inicioDST = inicioDelDia("2019-10-05") as Date;
    const finDST = inicioDelDiaSiguiente("2019-10-05") as Date;
    expect((finDST.getTime() - inicioDST.getTime()) / 3_600_000).toBe(23);

    const inicioFin = inicioDelDia("2019-03-23") as Date;
    const finFin = inicioDelDiaSiguiente("2019-03-23") as Date;
    expect((finFin.getTime() - inicioFin.getTime()) / 3_600_000).toBe(25);
  });

  it("una fecha mal formada no devuelve un límite inventado", () => {
    expect(inicioDelDia("15-01-2020")).toBeUndefined();
    expect(inicioDelDiaSiguiente("2020-13-40")).toBeUndefined();
  });
});

describe("el resultado no depende de la zona del proceso", () => {
  /** Corre las conversiones en un proceso con la zona `tz` y devuelve el JSON. */
  const enZona = (tz: string) => {
    const guion = `
      import { instanteDesdeHoraLocal, inicioDelDia, inicioDelDiaSiguiente, formatearEnZona } from ${JSON.stringify(
        resolve(ROOT, "api/src/timezone.ts"),
      )};
      const elegido = instanteDesdeHoraLocal("2027-03-15T10:30");
      process.stdout.write(JSON.stringify({
        tz: process.env.TZ,
        offsetDelProceso: new Date().getTimezoneOffset(),
        elegido: elegido.toISOString(),
        mostrado: formatearEnZona(elegido),
        desde: inicioDelDia("2027-03-15").toISOString(),
        hasta: inicioDelDiaSiguiente("2027-03-15").toISOString(),
      }));
    `;
    const salida = execFileSync("npx", ["tsx", "-e", guion], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, TZ: tz },
      timeout: 120_000,
    });
    return JSON.parse(salida.slice(salida.indexOf("{")));
  };

  it("UTC y America/New_York guardan y muestran exactamente lo mismo", () => {
    const utc = enZona("UTC");
    const ny = enZona("America/New_York");

    // Control de la propia prueba: si los dos procesos tuvieran la misma zona,
    // no estaría comprobando nada.
    expect(utc.offsetDelProceso).not.toBe(ny.offsetDelProceso);

    expect(utc.elegido, "el instante guardado cambia según el servidor").toBe(ny.elegido);
    expect(utc.mostrado).toBe(ny.mostrado);
    expect(utc.mostrado, "se muestra la hora que la persona eligió").toBe("15/03/2027 10:30");
    expect(utc.desde).toBe(ny.desde);
    expect(utc.hasta, "los límites diarios cambian según el servidor").toBe(ny.hasta);
  }, 240_000);
});

describeDb("la API guarda y filtra en hora de Asunción", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";
  let contador = 0;

  const json = { "Content-Type": "application/json" };
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const solicitar = (extra: Record<string, unknown> = {}) =>
    fetch(`${baseUrl}/api/public/appointments`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        name: "Paciente De Prueba",
        phone: "+595 981 000 222",
        email: "paciente.de.prueba@ejemplo.test",
        consent: true,
        submissionKey: `zona-${Date.now()}-${contador++}`,
        ...extra,
      }),
    });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-zona";
    process.env.PUBLIC_FORMS_RATE_MAX = "500";
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "admin@sanatorio.local", password: TEST_ADMIN_PASSWORD }),
    });
    token = (await login.json()).token;
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  beforeEach(async () => {
    await db("appointments").del();
  });

  it("la hora preferida se guarda como el instante de Asunción", async () => {
    const res = await solicitar({ preferredAt: "2027-03-15T10:30" });
    expect(res.status, await res.clone().text()).toBe(201);

    const fila = await db("appointments").first();
    expect(new Date(fila.preferred_at).toISOString()).toBe("2027-03-15T13:30:00.000Z");
  });

  it("la bandeja la devuelve y el CSV la muestra en hora local", async () => {
    await solicitar({ preferredAt: "2027-03-15T10:30" });

    const csv = await (await fetch(`${baseUrl}/api/admin/appointments/export`, { headers: auth() })).text();
    expect(csv, "el CSV tiene que mostrar la hora elegida, no la del servidor").toContain("15/03/2027 10:30");
  });

  describe("una solicitud en el borde del día no cae en la fecha equivocada", () => {
    /**
     * 2027-03-16T02:30Z son las 23:30 del **15** en Asunción. Con los límites
     * calculados en UTC —o en la zona del proceso— esta fila se iría al 16 y
     * el operador que filtra por el 15 no la vería.
     */
    const BORDE = new Date("2027-03-16T02:30:00.000Z");

    beforeEach(async () => {
      await solicitar({ preferredAt: "2027-03-15T10:30" });
      await db("appointments").update({ created_at: BORDE });
    });

    const totalEntre = async (from: string, to: string) => {
      const res = await fetch(`${baseUrl}/api/admin/appointments?from=${from}&to=${to}`, { headers: auth() });
      expect(res.status, await res.clone().text()).toBe(200);
      return (await res.json()).total;
    };

    it("filtrando por el 15 aparece", async () => {
      expect(await totalEntre("2027-03-15", "2027-03-15")).toBe(1);
    });

    it("filtrando por el 16 no aparece", async () => {
      expect(await totalEntre("2027-03-16", "2027-03-16")).toBe(0);
    });

    it("el último instante del día entra en el 'hasta'", async () => {
      // 23:59:59.999 del 15 en Asunción. Con `<= 23:59:59.999` calculado en
      // otra zona, o con una columna de más precisión, esto se caía afuera.
      await db("appointments").update({ created_at: new Date("2027-03-16T02:59:59.000Z") });
      expect(await totalEntre("2027-03-15", "2027-03-15")).toBe(1);
    });

    it("el primer instante del día siguiente ya no entra", async () => {
      await db("appointments").update({ created_at: new Date("2027-03-16T03:00:00.000Z") });
      expect(await totalEntre("2027-03-15", "2027-03-15")).toBe(0);
      expect(await totalEntre("2027-03-16", "2027-03-16")).toBe(1);
    });
  });
});
