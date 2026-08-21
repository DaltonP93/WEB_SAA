import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  TEST_ADMIN_PASSWORD,
  applyDbEnv,
  closeAppDb,
  closeServer,
  createTestDatabase,
  dropTestDatabase,
  jsonColumn,
  migrateLatest,
  runSeeds,
} from "./helpers/db";

/**
 * Biopsias deja de estar en `review` para siempre, y hay que probar **por qué**.
 *
 * La pantalla de "Datos pendientes" marcaba Biopsias como `review` de forma
 * incondicional, y estaba bien: que el texto de la página sea largo, o que ya
 * no traiga la nota de "a confirmar", no significa que el sanatorio haya
 * confirmado el alcance, los requisitos y los plazos. Deducirlo del contenido
 * habría convertido "alguien editó la página" en "el alcance está confirmado".
 *
 * Lo que faltaba no era la heurística: era **el lugar donde el sanatorio dice
 * que sí**. Estas pruebas comprueban que ese lugar existe, que sólo lo puede
 * usar quien tiene autoridad, y —sobre todo— que **el estado sigue sin
 * deducirse del contenido**: editar la página hasta dejarla perfecta no mueve
 * el estado ni un poco.
 *
 *   TEST_DATABASE=1 pnpm test tests/confirmacion-biopsias.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_confbio`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const ALCANCE =
  "Se realizan biopsias de piel y de mucosa oral con derivación externa; el resultado se entrega en 10 días hábiles.";

describeDb("confirmación escrita del alcance de Biopsias", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let tokenSuperadmin = "";
  let tokenEditor = "";
  let idPaginaBiopsias: number | null = null;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const json = (token: string) => ({ ...auth(token), "Content-Type": "application/json" });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-confbio";
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const login = async (email: string, password: string) => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return (await res.json()).token as string;
    };

    tokenSuperadmin = await login("admin@sanatorio.local", TEST_ADMIN_PASSWORD);
    expect(tokenSuperadmin).toBeTruthy();

    // Un editor de verdad, creado por la propia API: hace falta para comprobar
    // que confirmar no es una tarea de edición.
    const creado = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: json(tokenSuperadmin),
      body: JSON.stringify({
        email: "editor.biopsias@sanatorio.local",
        name: "Editora de contenidos",
        password: `${TEST_ADMIN_PASSWORD}-ed`,
        role: "editor",
      }),
    });
    expect(creado.status, await creado.clone().text()).toBe(201);
    tokenEditor = await login("editor.biopsias@sanatorio.local", `${TEST_ADMIN_PASSWORD}-ed`);
    expect(tokenEditor).toBeTruthy();

    const pagina = await db("pages").where({ slug: "estudios-biopsias" }).first("id");
    idPaginaBiopsias = pagina ? Number(pagina.id) : null;
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  afterEach(async () => {
    await db("settings").where({ key: "confirmacion_biopsias" }).del();
  });

  const readiness = async (token = tokenSuperadmin) => {
    const res = await fetch(`${baseUrl}/api/admin/data-readiness`, { headers: auth(token) });
    expect(res.status, await res.clone().text()).toBe(200);
    const cuerpo = await res.json();
    return cuerpo.sections.find((s: any) => s.id === "biopsias");
  };

  const confirmar = (body: unknown, token = tokenSuperadmin) =>
    fetch(`${baseUrl}/api/admin/data-confirmations/biopsias`, {
      method: "PUT",
      headers: json(token),
      body: JSON.stringify(body),
    });

  describe("el estado sigue sin deducirse del contenido", () => {
    it("sin confirmación, Biopsias está en review aunque la página exista", async () => {
      const seccion = await readiness();
      expect(seccion.status).toBe("review");
      expect(seccion.confirmation).toBeNull();
      expect(seccion.reason).toMatch(/confirmación escrita/i);
    });

    /**
     * La prueba que impide que vuelva la heurística.
     *
     * Se edita la página de Biopsias con un texto largo, completo y sin ninguna
     * marca de "a confirmar" —exactamente lo que un detector de contenido
     * tomaría por bueno— y el estado tiene que seguir en `review`. Si alguien
     * reintroduce una regla sobre el texto, esta falla.
     */
    it("editar la página hasta dejarla completa NO la marca confirmada", async () => {
      if (idPaginaBiopsias === null) return expect.unreachable("no existe la página de Biopsias");

      const res = await fetch(`${baseUrl}/api/admin/pages/${idPaginaBiopsias}`, {
        method: "PUT",
        headers: json(tokenSuperadmin),
        body: JSON.stringify({
          blocks: [
            {
              type: "RichText",
              props: {
                html: `<p>${ALCANCE} Los requisitos y los plazos están detallados y no hay nada pendiente de definir.</p>`,
              },
            },
          ],
        }),
      });
      expect(res.status, await res.clone().text()).toBe(200);

      const seccion = await readiness();
      expect(seccion.status, "el estado se dedujo del contenido de la página").toBe("review");
      expect(seccion.confirmation).toBeNull();
    });

    it("con la confirmación registrada, pasa a complete", async () => {
      expect((await confirmar({ scope: ALCANCE })).status).toBe(200);

      const seccion = await readiness();
      expect(seccion.status).toBe("complete");
      expect(seccion.confirmation.scope).toBe(ALCANCE);
      expect(seccion.confirmation.confirmedBy.name).toBeTruthy();
      expect(seccion.reason, "no dice quién confirmó").toMatch(/confirmado por/i);
    });

    it("al retirar la confirmación vuelve a review", async () => {
      await confirmar({ scope: ALCANCE });
      expect((await readiness()).status).toBe("complete");

      const res = await fetch(`${baseUrl}/api/admin/data-confirmations/biopsias`, {
        method: "DELETE",
        headers: auth(tokenSuperadmin),
      });
      expect(res.status).toBe(204);

      // Una confirmación puede dejar de ser cierta: cambian los plazos, se deja
      // de hacer un estudio. Sin esto, el ítem seguiría diciendo "confirmado".
      expect((await readiness()).status).toBe("review");
      expect((await readiness()).confirmation).toBeNull();
    });

    it("una confirmación ilegible en la base no cuenta como confirmación", async () => {
      // Alguien editó `settings` a mano y dejó la fila rota. Darla por buena
      // sería justamente el error que este mecanismo existe para no cometer.
      await db("settings").insert({ key: "confirmacion_biopsias", value: JSON.stringify({ roto: true }) });

      const seccion = await readiness();
      expect(seccion.status, "se dio por confirmada una fila ilegible").toBe("review");
      expect(seccion.confirmation).toBeNull();
    });
  });

  describe("confirmar es una afirmación institucional, no una edición", () => {
    it("un editor no puede confirmar", async () => {
      const res = await confirmar({ scope: ALCANCE }, tokenEditor);
      expect(res.status, "un editor confirmó el alcance institucional").toBe(403);
      expect((await readiness()).status).toBe("review");
    });

    it("un editor tampoco puede retirar una confirmación", async () => {
      await confirmar({ scope: ALCANCE });

      const res = await fetch(`${baseUrl}/api/admin/data-confirmations/biopsias`, {
        method: "DELETE",
        headers: auth(tokenEditor),
      });
      expect(res.status).toBe(403);
      expect((await readiness()).status, "un editor retiró la confirmación").toBe("complete");
    });

    it("un editor sí puede leer el estado: saber qué falta no es afirmarlo", async () => {
      const res = await fetch(`${baseUrl}/api/admin/data-confirmations/biopsias`, {
        headers: auth(tokenEditor),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).confirmation).toBeNull();
    });

    it("sin sesión no se lee ni se escribe", async () => {
      const leer = await fetch(`${baseUrl}/api/admin/data-confirmations/biopsias`);
      expect(leer.status).toBe(401);

      const escribir = await fetch(`${baseUrl}/api/admin/data-confirmations/biopsias`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: ALCANCE }),
      });
      expect(escribir.status).toBe(401);
    });
  });

  describe("qué se guarda, y qué no se acepta del cliente", () => {
    it("la fecha la pone el servidor, no quien confirma", async () => {
      const antes = Date.now();
      const res = await confirmar({
        scope: ALCANCE,
        // Un cliente que pudiera fechar su propia confirmación podría datarla
        // en cualquier momento, incluido antes de que existiera la página.
        confirmedAt: "2001-01-01T00:00:00.000Z",
        confirmedBy: { id: 999, name: "Alguien que no es" },
      });
      expect(res.status).toBe(200);

      const guardada = (await res.json()).confirmation;
      expect(guardada.confirmedAt).not.toContain("2001");
      const cuando = Date.parse(guardada.confirmedAt);
      expect(cuando).toBeGreaterThanOrEqual(antes - 1000);
      expect(cuando).toBeLessThanOrEqual(Date.now() + 1000);
      expect(guardada.confirmedBy.name, "el autor lo puso el cliente").not.toBe("Alguien que no es");
    });

    it("sin alcance no hay confirmación: 400 y nada guardado", async () => {
      for (const cuerpo of [{}, { scope: "" }, { scope: "corto" }, { scope: 42 }]) {
        const res = await confirmar(cuerpo);
        // Una confirmación sin alcance diría "está bien" sin decir qué está
        // bien: no sirve de constancia para nadie.
        expect(res.status, `se aceptó ${JSON.stringify(cuerpo)}`).toBe(400);
      }
      expect(await db("settings").where({ key: "confirmacion_biopsias" }).first()).toBeUndefined();
    });

    it("confirmar dos veces actualiza, no duplica", async () => {
      await confirmar({ scope: ALCANCE });
      const segunda = await confirmar({ scope: `${ALCANCE} Actualizado en la revisión anual.` });
      expect(segunda.status).toBe(200);

      const filas = await db("settings").where({ key: "confirmacion_biopsias" });
      expect(filas).toHaveLength(1);
      expect(jsonColumn<any>(filas[0].value).scope).toMatch(/revisión anual/);
    });

    it("un ítem que no es confirmable da 404, no lo crea", async () => {
      const res = await fetch(`${baseUrl}/api/admin/data-confirmations/turnos`, {
        method: "PUT",
        headers: json(tokenSuperadmin),
        body: JSON.stringify({ scope: ALCANCE }),
      });
      expect(res.status).toBe(404);
      expect(await db("settings").where({ key: "confirmacion_turnos" }).first()).toBeUndefined();
    });
  });

  describe("la clave no queda a mano del editor genérico de Configuración", () => {
    it("`confirmacion_biopsias` no se puede escribir por /settings", async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/confirmacion_biopsias`, {
        method: "PUT",
        headers: json(tokenSuperadmin),
        body: JSON.stringify({ value: { confirmedAt: new Date().toISOString(), scope: "por la puerta de atrás" } }),
      });

      // Confirmar tiene su propio endpoint, con su propio rol y su propia
      // validación. Si además se pudiera escribir como un ajuste cualquiera,
      // todo eso sería decorativo.
      expect(res.status, "se pudo confirmar por la puerta de atrás").not.toBe(200);
      expect((await readiness()).status).toBe("review");
    });

    it("tampoco aparece en la lista de ajustes administrables", async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings`, { headers: auth(tokenSuperadmin) });
      expect(res.status).toBe(200);
      expect(Object.keys(await res.json())).not.toContain("confirmacion_biopsias");
    });
  });
});
