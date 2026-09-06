// La estación de trabajo (y el servidor) corren en una zona **distinta** de
// Asunción: así se prueba que la interpretación de la hora de pared NO depende de
// la zona del proceso. Se fija antes de cualquier import para que el driver de
// MySQL la tome.
process.env.TZ = "America/New_York";

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
 * Programación por endpoint del backend (zona Asunción) y contrato editorial de
 * la programación (Bloqueante D).
 *
 * - `POST /admin/pages/:id/schedule` interpreta la hora de pared en
 *   `America/Asuncion` y rechaza el pasado, sin importar la zona del proceso.
 * - Programar es una operación de **publicación**: sólo se puede desde los estados
 *   permitidos (`in_review`/`approved`/`published`); desde `draft` da 409.
 * - Restaurar una revisión es **sólo contenido**: NO repone `publish_at`. Una
 *   página conserva su fecha de publicación vigente aunque se restaure una versión
 *   vieja que tenía otra —la fecha se cambia con `schedule`/`publish`, no por la
 *   ventana trasera del historial—.
 *
 *   TEST_DATABASE=1 pnpm test tests/pages-schedule-zona.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_sched`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("paginas: programacion por backend y contrato de publicacion", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  async function crearPagina(slug: string, status: "draft" | "published" = "draft") {
    const res = await fetch(`${baseUrl}/api/admin/pages`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ slug, title: `T ${slug}`, status }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()).id as number;
  }
  const schedule = (id: number, publish_at: string) =>
    fetch(`${baseUrl}/api/admin/pages/${id}/schedule`, { method: "POST", headers: auth(), body: JSON.stringify({ publish_at }) });
  const guardarContent = (id: number, body: any) =>
    fetch(`${baseUrl}/api/admin/pages/${id}/content`, { method: "PUT", headers: auth(), body: JSON.stringify(body) });
  const verPagina = async (id: number) =>
    (await (await fetch(`${baseUrl}/api/admin/pages/${id}`, { headers: auth() })).json()) as any;
  const listar = async (id: number) =>
    (await (await fetch(`${baseUrl}/api/admin/pages/${id}/revisions`, { headers: auth() })).json()) as any[];
  const publicList = async () => (await (await fetch(`${baseUrl}/api/public/pages`)).json()) as { slug: string }[];

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-sched";
    process.env.PUBLIC_SITE_URL = "https://ejemplo.test";
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
    expect(token).toBeTruthy();
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("programar con fecha futura oculta hasta la fecha (zona Asunción, no la del proceso)", async () => {
    // Publicada (visible), y se reprograma al futuro: deja de verse hasta la fecha.
    const id = await crearPagina("sched-futuro", "published");
    expect((await publicList()).some((p) => p.slug === "sched-futuro")).toBe(true);
    const res = await schedule(id, "2099-01-01T10:00");
    expect(res.status, await res.clone().text()).toBe(200);
    const fila = await verPagina(id);
    expect(fila.status).toBe("published");
    expect(fila.publish_at).toBeTruthy();
    // Publicada pero agendada al futuro: no aparece en el sitio todavía.
    expect((await publicList()).some((p) => p.slug === "sched-futuro")).toBe(false);
  });

  it("una fecha pasada se rechaza con 400 y aviso de 'futura', antes de mirar el estado", async () => {
    const id = await crearPagina("sched-pasado", "published");
    const res = await schedule(id, "2000-01-01T10:00");
    expect(res.status).toBe(400);
    expect(String((await res.json()).error)).toMatch(/futura/i);
  });

  it("una fecha inválida es 400 y una página en la papelera es 404", async () => {
    const id = await crearPagina("sched-invalida", "published");
    expect((await schedule(id, "no-es-fecha")).status).toBe(400);
    await fetch(`${baseUrl}/api/admin/pages/${id}`, { method: "DELETE", headers: auth() });
    expect((await schedule(id, "2099-01-01T10:00")).status).toBe(404);
  });

  it("no se puede programar desde borrador: 409 y la página no se toca", async () => {
    const id = await crearPagina("sched-desde-draft"); // draft
    const res = await schedule(id, "2099-01-01T10:00"); // fecha válida futura
    expect(res.status).toBe(409);
    expect(String((await res.json()).error)).toMatch(/estado/i);
    const fila = await verPagina(id);
    expect(fila.status).toBe("draft");
    expect(fila.publish_at).toBeNull();
  });

  it("restaurar es sólo contenido: conserva el publish_at vigente, no el de la foto", async () => {
    const id = await crearPagina("sched-restore", "published");

    // Agendar a D1 (futuro) y dejar una revisión cuya foto guarda publish_at=D1.
    expect((await schedule(id, "2099-06-15T14:30")).status).toBe(200);
    const d1 = new Date((await verPagina(id)).publish_at).getTime();
    expect((await guardarContent(id, { title: "conD1", blocks: [] })).status).toBe(200);
    expect((await guardarContent(id, { title: "otro", blocks: [] })).status).toBe(200); // archiva "conD1" con publish_at=D1

    // Reprogramar a D2 (otro futuro distinto).
    expect((await schedule(id, "2099-09-20T09:15")).status).toBe(200);
    const d2 = new Date((await verPagina(id)).publish_at).getTime();
    expect(d2).not.toBe(d1);

    // Restaurar la versión "conD1": vuelve el CONTENIDO, pero publish_at sigue en D2.
    const revD1 = (await listar(id)).find((r) => r.title === "conD1");
    expect(revD1).toBeTruthy();
    expect((await fetch(`${baseUrl}/api/admin/pages/${id}/revisions/${revD1.id}/restore`, { method: "POST", headers: auth() })).status).toBe(200);

    const page = await verPagina(id);
    expect(page.title).toBe("conD1"); // contenido restaurado
    expect(new Date(page.publish_at).getTime()).toBe(d2); // ...pero la fecha vigente NO cambió
  });
});
