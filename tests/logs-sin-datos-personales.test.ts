import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import { errorSeguro, rutaSegura, rutaSinValores } from "../api/src/log-seguro.js";
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
 * Los logs del servidor no pueden llevar datos de pacientes.
 *
 * La regla del proyecto es que la información personal viva **sólo dentro del
 * panel autenticado**. Un log no es eso: queda en disco, lo lee quien opera el
 * VPS, rota a archivos que se copian para diagnosticar.
 *
 * Había tres caminos por los que se escapaba, y el tercero es el que no se ve:
 * cuando una consulta falla, mysql2 adjunta al error la sentencia **con los
 * valores ya sustituidos**. Registrar el objeto de error entero escribía en el
 * log el `like '%<apellido>%'` que el operador acababa de tipear en la bandeja
 * de Turnos.
 *
 * La prueba de abajo no simula ese error: rompe la tabla de verdad y hace la
 * búsqueda real.
 *
 *   TEST_DATABASE=1 pnpm test tests/logs-sin-datos-personales.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_logs`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

/** Datos reconocibles: si aparecen en un log, se ven a simple vista. */
const PACIENTE = {
  name: "Rosalinda Melgarejo Ozorio",
  phone: "+595 981 445 667",
  email: "rosalinda.melgarejo@ejemplo.test",
  message: "Consulta por un dolor persistente desde hace tres semanas.",
};

describe("representación segura de rutas y errores", () => {
  it("conserva la ruta y los nombres de parámetros, y borra los valores", () => {
    expect(rutaSinValores("/api/admin/appointments?q=Rosalinda&status=pendiente&limit=20")).toBe(
      "/api/admin/appointments?q,status,limit=…",
    );
    expect(rutaSinValores("/api/admin/appointments")).toBe("/api/admin/appointments");
    expect(rutaSegura({ method: "GET", originalUrl: "/api/x?a=1&a=2&b=3" })).toBe("GET /api/x?a,b=…");
  });

  it("un salto de línea en la URL no puede forjar una línea de log", () => {
    const forjada = rutaSinValores(`/api/x${String.fromCharCode(10)}GET /api/admin/users 200`);
    expect(forjada).not.toContain(String.fromCharCode(10));
  });

  it("de un error de base registra el código y nunca la consulta", () => {
    const err: Record<string, unknown> = new Error(
      `select * from appointments where name like '%${PACIENTE.name}%' - Table doesn't exist`,
    );
    err.code = "ER_NO_SUCH_TABLE";
    err.errno = 1146;
    err.sql = `select * from \`appointments\` where \`name\` like '%${PACIENTE.name}%'`;
    err.sqlMessage = `Table 'x.appointments' doesn't exist`;

    const linea = errorSeguro(err);
    expect(linea).toContain("ER_NO_SUCH_TABLE");
    expect(linea).toContain("errno=1146");
    expect(linea).not.toContain(PACIENTE.name);
    expect(linea).not.toContain("select");
    expect(linea).not.toContain("Table");
  });

  it("de un HttpError sí registra el mensaje, porque lo escribimos nosotros", () => {
    class HttpError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.name = "HttpError";
        this.status = status;
      }
    }
    const linea = errorSeguro(new HttpError(503, "servicio no disponible temporalmente"));
    expect(linea).toContain("status=503");
    expect(linea).toContain("servicio no disponible temporalmente");
  });

  it("un mensaje de varias líneas no puede colar contenido como si fuera la pila", () => {
    const err = new Error(`primera${String.fromCharCode(10)}    at INVENTADO.ts:9:9${String.fromCharCode(10)}tercera`);
    expect(errorSeguro(err)).not.toContain("INVENTADO");
  });

  it("valores raros no rompen nada", () => {
    expect(errorSeguro(null)).toBe("error desconocido");
    expect(errorSeguro(undefined)).toBe("error desconocido");
    expect(errorSeguro("texto suelto")).toContain("no-error");
    expect(rutaSegura(null)).toBe("? ");
  });

  it("un `code` que no parece un código no se registra", () => {
    const err: Record<string, unknown> = new Error("x");
    err.code = `ER_X'; select ${PACIENTE.email}`;
    expect(errorSeguro(err)).not.toContain(PACIENTE.email);
  });

  /**
   * `errorSeguro` registra el `message` de un `HttpError` porque hoy todos son
   * literales del código. Esta prueba es lo que sostiene ese "hoy": si alguien
   * empieza a construirlos interpolando algo de la petición, el permiso deja
   * de ser válido y hay que cambiar `errorSeguro`, no el mensaje.
   *
   * La regla es sobre el **sitio de la llamada**: no puede haber una plantilla
   * dentro del constructor. Un mensaje armado en una constante de módulo a
   * partir de configuración —como el tope de peso, que sale de una variable de
   * entorno— se evalúa una vez al arrancar y nunca ve una petición, así que no
   * es lo que esto persigue.
   */
  it("ningún HttpError se construye interpolando la petición", () => {
    const fuentes = [
      "api/src/http.ts",
      "api/src/routes/public.ts",
      "api/src/routes/admin/appointments.ts",
      "api/src/routes/admin/media.ts",
      "api/src/routes/admin/crud.ts",
    ];
    for (const archivo of fuentes) {
      const codigo = readFileSync(archivo, "utf8")
        // Sin comentarios: los ejemplos de los comentarios no son código.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const interpolados = codigo.match(/\b(badRequest|notFound|conflict|tooManyRequests)\(`[^`]*\$\{/g);
      expect(interpolados, `${archivo} interpola dentro de un HttpError`).toBeNull();
    }
  });
});

describeDb("los datos que se buscan en la bandeja no llegan a los logs", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);
    await db("appointments").insert({ ...PACIENTE, status: "pendiente", consent_at: new Date() });

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-logs";
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  /**
   * Todo lo que la aplicación escriba durante `accion`, por cualquier vía.
   *
   * Incluye `process.stdout` y no sólo `console`: **morgan escribe directo al
   * stdout**, y morgan es justamente quien registraba la URL completa con el
   * `?q=<apellido>` adentro. Espiar sólo `console` dejaba sin mirar el camino
   * por el que se escapaba el dato más veces —una línea por petición, no una
   * por error.
   */
  async function loguearDurante(accion: () => Promise<void>): Promise<string> {
    const escrito: string[] = [];
    const anotar = (...args: unknown[]) => {
      escrito.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ""}` : String(a))).join(" "));
    };

    const espias = (["log", "warn", "error", "info", "debug"] as const).map((nivel) =>
      vi.spyOn(console, nivel).mockImplementation(anotar),
    );
    for (const flujo of [process.stdout, process.stderr] as const) {
      espias.push(
        vi.spyOn(flujo, "write").mockImplementation(((chunk: unknown) => {
          anotar(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
          return true;
        }) as never) as never,
      );
    }

    try {
      await accion();
      // morgan escribe recién cuando la respuesta termina; sin esta vuelta del
      // event loop la línea puede llegar después de restaurar los espías.
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      espias.forEach((e) => e.mockRestore());
    }
    return escrito.join("\n");
  }

  it("una búsqueda que provoca un error real de consulta no escribe el nombre, el teléfono ni el correo", async () => {
    const buscados = [PACIENTE.name, PACIENTE.phone, PACIENTE.email];

    const todo = await loguearDurante(async () => {
      // Se rompe el JOIN de verdad: la tabla deja de existir y el SELECT falla
      // con la consulta ya formateada dentro del error de mysql2.
      await db.schema.renameTable("specialties", "specialties_fuera");
      try {
        for (const dato of buscados) {
          const res = await fetch(
            `${baseUrl}/api/admin/appointments?q=${encodeURIComponent(dato)}&status=pendiente`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          // El error tiene que haber ocurrido de verdad, o la prueba no prueba nada.
          expect([500, 503], "la consulta no falló: el escenario no se cumplió").toContain(res.status);
        }
      } finally {
        await db.schema.renameTable("specialties_fuera", "specialties");
      }
    });

    expect(todo.length, "no se registró nada: el escenario no se cumplió").toBeGreaterThan(0);
    for (const dato of buscados) {
      expect(todo, `apareció "${dato}" en los logs`).not.toContain(dato);
    }
    // Ni directamente, ni dentro del SQL que el motor adjunta al error.
    for (const rastro of ["select ", "like ", "specialties_fuera", "%Rosalinda", "sqlMessage"]) {
      expect(todo, `apareció "${rastro}" en los logs`).not.toContain(rastro);
    }
    // Y sin embargo tiene que quedar algo con lo que diagnosticar.
    expect(todo).toMatch(/ER_NO_SUCH_TABLE|ER_BAD_FIELD_ERROR|errno=/);
  });

  it("la búsqueda que funciona tampoco escribe lo que se buscó", async () => {
    const todo = await loguearDurante(async () => {
      const res = await fetch(
        `${baseUrl}/api/admin/appointments?q=${encodeURIComponent(PACIENTE.name)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(res.status).toBe(200);
      expect((await res.json()).total, "la búsqueda tenía que encontrar la fila").toBe(1);
    });

    expect(todo).not.toContain(PACIENTE.name);
    // El registro de acceso conserva el nombre del parámetro, no su valor.
    expect(todo).toContain("q=…");
  });

  it("un 404 con datos en la ruta no los escribe como valores de query", async () => {
    const todo = await loguearDurante(async () => {
      await fetch(`${baseUrl}/api/admin/appointments?email=${encodeURIComponent(PACIENTE.email)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    });
    expect(todo).not.toContain(PACIENTE.email);
  });
});
