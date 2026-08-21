import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
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
 * La bandeja con más solicitudes de las que entran en una respuesta.
 *
 * La versión anterior pedía las primeras 200 filas y hacía todo lo demás en el
 * navegador: buscar, ordenar, paginar y contar. Con 250 solicitudes, buscar a
 * quien estuviera en la posición 300 devolvía "sin resultados" y el operador no
 * tenía manera de saber que el dato existía. Tampoco había cómo llegar a esa
 * fila para confirmarla o eliminarla: no estaba en ninguna página.
 *
 * Estas pruebas cargan **más de 200** solicitudes de verdad. Con menos de eso,
 * cualquier implementación pasa y el defecto queda intacto.
 *
 *   TEST_DATABASE=1 pnpm test tests/turnos-paginacion.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_pag`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;
const ADMIN = "/api/admin/appointments";

/** Más que el viejo tope de 200, para que el problema tenga dónde aparecer. */
const CUANTAS = 250;
/** Su posición hace que caiga fuera de las primeras 200 en el orden por defecto. */
const BUSCADA = "Zulema Delfina Prueba";

describeDb("bandeja con más de 200 solicitudes", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";
  let idBuscada = 0;

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  const listar = async (qs = "") => {
    const res = await fetch(`${baseUrl}${ADMIN}${qs}`, { headers: auth() });
    expect(res.status, await res.clone().text()).toBe(200);
    return res.json() as Promise<{ items: any[]; total: number; limit: number; offset: number }>;
  };

  const exportar = async (qs = "") => {
    const res = await fetch(`${baseUrl}${ADMIN}/export${qs}`, { headers: auth() });
    expect(res.status, await res.clone().text()).toBe(200);
    return { res, csv: await res.text() };
  };

  /** Filas del CSV sin el encabezado. */
  const filasCsv = (csv: string) => csv.replace(/^﻿/, "").split("\r\n").slice(1).filter(Boolean);

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-pag";
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

    // Se insertan directo: son 250 y pasar por el endpoint público con su rate
    // limit y su CAPTCHA no agrega nada a lo que se quiere probar acá.
    const base = Date.UTC(2027, 0, 1, 12, 0, 0);
    const filas = Array.from({ length: CUANTAS }, (_, i) => ({
      name: `Paciente ${String(i).padStart(3, "0")} Prueba`,
      phone: `+595 981 000 ${String(i).padStart(3, "0")}`,
      email: `paciente${i}@ejemplo.test`,
      message: i % 3 === 0 ? "Prefiero por la mañana." : null,
      status: i % 5 === 0 ? "confirmado" : "pendiente",
      submission_key: `carga-${i}`,
      consent_at: new Date(base + i * 60_000),
      // Más viejas primero: en el orden por defecto (lo último primero) la
      // número 0 queda al final de todo.
      created_at: new Date(base + i * 60_000),
    }));
    await db.batchInsert("appointments", filas, 50);

    // La que se va a buscar queda con la fecha más vieja de todas: en el orden
    // por defecto es la última, muy lejos de las primeras 200.
    await db("appointments")
      .where({ submission_key: "carga-000" })
      .orWhere({ submission_key: "carga-0" })
      .update({ name: BUSCADA, created_at: new Date(base - 60_000) });
    idBuscada = (await db("appointments").where({ name: BUSCADA }).first("id")).id;
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("el total es el de la base, no el de la página", async () => {
    const body = await listar("?limit=20&offset=0");
    expect(body.total).toBe(CUANTAS);
    expect(body.items).toHaveLength(20);
  });

  describe("buscar algo que está más allá de la fila 200", () => {
    it("la encuentra, aunque el viejo tope la dejaba fuera", async () => {
      // Control: sin filtro, esa fila no está en las primeras 200.
      const primeras = await listar("?limit=200&offset=0");
      expect(
        primeras.items.some((t) => t.name === BUSCADA),
        "si estuviera acá, la prueba no probaría nada",
      ).toBe(false);

      const encontrada = await listar(`?q=${encodeURIComponent("Zulema")}`);
      expect(encontrada.total).toBe(1);
      expect(encontrada.items[0].name).toBe(BUSCADA);
    });

    it("se puede confirmar desde el panel", async () => {
      const res = await fetch(`${baseUrl}${ADMIN}/${idBuscada}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ status: "confirmado" }),
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await res.json()).status).toBe("confirmado");
    });

    it("y se puede eliminar", async () => {
      const res = await fetch(`${baseUrl}${ADMIN}/${idBuscada}`, { method: "DELETE", headers: auth() });
      expect(res.status).toBe(204);
      expect(await db("appointments").where({ id: idBuscada }).first()).toBeUndefined();

      // Se repone para que el resto del archivo siga viendo el mismo conjunto.
      await db("appointments").insert({
        id: idBuscada,
        name: BUSCADA,
        phone: "+595 981 000 000",
        email: "paciente0@ejemplo.test",
        status: "pendiente",
        submission_key: "carga-0",
        created_at: new Date(Date.UTC(2027, 0, 1, 11, 59, 0)),
      });
    });
  });

  describe("navegación hasta la última página", () => {
    it("la última página trae el resto y no repite filas", async () => {
      const porPagina = 20;
      const paginas = Math.ceil(CUANTAS / porPagina);
      const ultima = await listar(`?limit=${porPagina}&offset=${(paginas - 1) * porPagina}`);

      expect(ultima.total).toBe(CUANTAS);
      expect(ultima.items).toHaveLength(CUANTAS - (paginas - 1) * porPagina);

      // Recorrido completo: ninguna fila aparece dos veces ni se pierde.
      const vistos = new Set<number>();
      for (let p = 0; p < paginas; p++) {
        const pagina = await listar(`?limit=${porPagina}&offset=${p * porPagina}`);
        for (const t of pagina.items) vistos.add(t.id);
      }
      expect(vistos.size, "hay filas repetidas o perdidas entre páginas").toBe(CUANTAS);
    }, 120_000);

    it("un offset más allá del total devuelve vacío, no un error", async () => {
      const body = await listar(`?limit=20&offset=${CUANTAS + 100}`);
      expect(body.items).toEqual([]);
      expect(body.total).toBe(CUANTAS);
    });
  });

  describe("orden por servidor", () => {
    it("ordena sobre el conjunto entero, no sobre la página", async () => {
      const asc = await listar("?sort=name&dir=asc&limit=1");
      const desc = await listar("?sort=name&dir=desc&limit=1");
      expect(asc.items[0].name).not.toBe(desc.items[0].name);
      // El primero alfabético del conjunto completo, no del recorte.
      expect(asc.items[0].name).toBe("Paciente 001 Prueba");
      expect(desc.items[0].name).toBe(BUSCADA);
    });

    it("una columna fuera de la allowlist se rechaza con 400", async () => {
      // El valor entra en el ORDER BY: aceptar cualquier string sería dejar
      // decidir al cliente qué se ejecuta.
      for (const columna of ["password_hash", "a.id; drop table appointments", "(select 1)"]) {
        const res = await fetch(`${baseUrl}${ADMIN}?sort=${encodeURIComponent(columna)}`, { headers: auth() });
        expect(res.status, `se aceptó ordenar por ${columna}`).toBe(400);
      }
    });

    it("una dirección inventada se rechaza", async () => {
      const res = await fetch(`${baseUrl}${ADMIN}?sort=name&dir=arriba`, { headers: auth() });
      expect(res.status).toBe(400);
    });

    it("el orden es estable entre páginas", async () => {
      // Todas comparten estado en muchos casos: sin desempate por id, dos
      // páginas consecutivas pueden devolver la misma fila.
      const a = await listar("?sort=status&dir=asc&limit=25&offset=0");
      const b = await listar("?sort=status&dir=asc&limit=25&offset=25");
      const repetidas = a.items.filter((x) => b.items.some((y) => y.id === x.id));
      expect(repetidas).toEqual([]);
    });
  });

  describe("exportación CSV", () => {
    it("incluye todas las filas que coinciden, no las 200 de la página", async () => {
      const { csv } = await exportar();
      expect(filasCsv(csv)).toHaveLength(CUANTAS);
      expect(csv).toContain(BUSCADA);
    }, 120_000);

    it("respeta los filtros", async () => {
      const confirmadas = await listar("?status=confirmado&limit=1");
      const { csv } = await exportar("?status=confirmado");
      expect(filasCsv(csv)).toHaveLength(confirmadas.total);
      expect(confirmadas.total).toBeGreaterThan(0);
    });

    it("respeta la búsqueda", async () => {
      const { csv } = await exportar(`?q=${encodeURIComponent("Zulema")}`);
      expect(filasCsv(csv)).toHaveLength(1);
      expect(csv).toContain(BUSCADA);
    });

    it("no se puede descargar sin autenticación", async () => {
      const res = await fetch(`${baseUrl}${ADMIN}/export`);
      expect(res.status).toBe(401);
    });

    it("no se guarda en ninguna caché", async () => {
      // Lleva nombres, teléfonos y correos de pacientes.
      const { res } = await exportar("?status=confirmado");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    });

    it("un filtro inválido da 400 y no exporta nada", async () => {
      const res = await fetch(`${baseUrl}${ADMIN}/export?status=inventado`, { headers: auth() });
      expect(res.status).toBe(400);
    });

    describe("las celdas no pueden ejecutarse en una planilla", () => {
      const PELIGROSOS = ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "=HYPERLINK(\"http://ejemplo.test\")"];

      it.each(PELIGROSOS)("%s sale como texto", async (peligroso) => {
        // Lo escribe cualquiera que complete el formulario público.
        await db("appointments")
          .where({ submission_key: "carga-7" })
          .update({ message: peligroso });
        const { csv } = await exportar(`?q=${encodeURIComponent("Paciente 007")}`);

        expect(csv, "la planilla lo evaluaría como fórmula").not.toMatch(
          new RegExp(`(^|,|")${peligroso.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`, "m"),
        );
        expect(csv).toContain("'");
      });
    });
  });

  describe("una búsqueda sin coincidencias no muestra lo anterior", () => {
    it("devuelve total 0 y ninguna fila", async () => {
      const body = await listar(`?q=${encodeURIComponent("no-existe-este-paciente")}`);
      expect(body.total).toBe(0);
      expect(body.items).toEqual([]);
    });
  });
});
