// La estación de trabajo (y el servidor) corren en una zona **distinta** de
// Asunción: así se prueba que la interpretación de la hora de pared y la fidelidad
// del instante al restaurar NO dependen de la zona del proceso. Se fija antes de
// cualquier import para que el driver de MySQL la tome.
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
 * Programación por endpoint del backend (zona Asunción) y restauración fiel de
 * `publish_at`.
 *
 * - `POST /admin/pages/:id/schedule` interpreta la hora de pared en
 *   `America/Asuncion` y rechaza el pasado, sin importar la zona del proceso.
 * - Restaurar una revisión conserva el **instante exacto** de `publish_at`: el
 *   paso `Date → snapshot JSON (ISO con Z) → DATETIME` no puede correr la hora.
 *   Con la zona del proceso distinta de UTC, escribir el ISO crudo correría el
 *   instante; por eso se normaliza a `Date` al restaurar.
 *
 *   TEST_DATABASE=1 pnpm test tests/pages-schedule-zona.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_sched`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("paginas: programacion por backend y restauracion fiel de publish_at", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  async function crearPagina(slug: string) {
    const res = await fetch(`${baseUrl}/api/admin/pages`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ slug, title: `T ${slug}`, status: "draft" }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()).id as number;
  }
  const schedule = (id: number, publish_at: string) =>
    fetch(`${baseUrl}/api/admin/pages/${id}/schedule`, { method: "POST", headers: auth(), body: JSON.stringify({ publish_at }) });
  const putMeta = (id: number, body: any) =>
    fetch(`${baseUrl}/api/admin/pages/${id}`, { method: "PUT", headers: auth(), body: JSON.stringify(body) });
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

  it("programar con fecha futura publica y oculta hasta la fecha (zona Asunción, no la del proceso)", async () => {
    const id = await crearPagina("sched-futuro");
    const res = await schedule(id, "2099-01-01T10:00");
    expect(res.status, await res.clone().text()).toBe(200);
    const fila = await verPagina(id);
    expect(fila.status).toBe("published");
    expect(fila.publish_at).toBeTruthy();
    // Publicada pero agendada al futuro: no aparece en el sitio todavía.
    expect((await publicList()).some((p) => p.slug === "sched-futuro")).toBe(false);
  });

  it("una fecha pasada se rechaza con 400 y aviso de 'futura'", async () => {
    const id = await crearPagina("sched-pasado");
    const res = await schedule(id, "2000-01-01T10:00");
    expect(res.status).toBe(400);
    expect(String((await res.json()).error)).toMatch(/futura/i);
    // No tocó la página: sigue en borrador.
    expect((await verPagina(id)).status).toBe("draft");
  });

  it("una fecha inválida es 400 y una página en la papelera es 404", async () => {
    const id = await crearPagina("sched-invalida");
    expect((await schedule(id, "no-es-fecha")).status).toBe(400);
    await fetch(`${baseUrl}/api/admin/pages/${id}`, { method: "DELETE", headers: auth() });
    expect((await schedule(id, "2099-01-01T10:00")).status).toBe(404);
  });

  it("restaurar conserva el instante EXACTO de publish_at y la visibilidad correcta", async () => {
    const id = await crearPagina("sched-restore");

    // Estado F: publicada, agendada a una hora de pared concreta de Asunción (futuro).
    expect((await putMeta(id, { status: "published", title: "F", publish_at: "2099-06-15T14:30" })).status).toBe(200);
    const instanteF = new Date((await verPagina(id)).publish_at).getTime();
    // Archivar F (guardado atómico; sin tocar publish_at, se conserva F en la foto).
    expect((await guardarContent(id, { title: "F", blocks: [] })).status).toBe(200);

    // Estado P: reprogramar al pasado (visible) y archivarlo.
    expect((await putMeta(id, { status: "published", title: "P", publish_at: "2000-01-01T08:00" })).status).toBe(200);
    const instanteP = new Date((await verPagina(id)).publish_at).getTime();
    expect((await guardarContent(id, { title: "P", blocks: [] })).status).toBe(200);
    expect((await publicList()).some((p) => p.slug === "sched-restore")).toBe(true); // P es pasado → visible

    const revs = await listar(id);
    const revF = revs.find((r) => r.title === "F");
    const revP = revs.find((r) => r.title === "P");
    expect(revF && revP).toBeTruthy();

    // Restaurar F: mismo instante exacto, y oculta (fecha futura).
    expect((await fetch(`${baseUrl}/api/admin/pages/${id}/revisions/${revF.id}/restore`, { method: "POST", headers: auth() })).status).toBe(200);
    expect(new Date((await verPagina(id)).publish_at).getTime()).toBe(instanteF);
    expect((await publicList()).some((p) => p.slug === "sched-restore")).toBe(false);

    // Restaurar P: mismo instante exacto, y visible (fecha pasada).
    expect((await fetch(`${baseUrl}/api/admin/pages/${id}/revisions/${revP.id}/restore`, { method: "POST", headers: auth() })).status).toBe(200);
    expect(new Date((await verPagina(id)).publish_at).getTime()).toBe(instanteP);
    expect((await publicList()).some((p) => p.slug === "sched-restore")).toBe(true);
  });
});
