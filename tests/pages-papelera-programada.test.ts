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
  jsonColumn,
  migrateLatest,
  runSeeds,
} from "./helpers/db";

/**
 * Papelera y publicacion programada de paginas, de punta a punta.
 *
 * Contratos que solo se ven con la API entera:
 * - borrar es recuperable: la pagina va a la papelera, deja de listarse y de
 *   servirse, y se restaura;
 * - el borrado definitivo solo sale de la papelera y si se lleva los bloques;
 * - una pagina publicada con `publish_at` futuro esta oculta del sitio (lista,
 *   detalle y sitemap) y aparece sola cuando la fecha pasa.
 *
 *   TEST_DATABASE=1 pnpm test tests/pages-papelera-programada.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_ppp`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("paginas: papelera y programacion", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  async function crearPagina(slug: string, status: "draft" | "published") {
    const res = await fetch(`${baseUrl}/api/admin/pages`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ slug, title: `T ${slug}`, status }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()).id as number;
  }
  const publicList = async () =>
    (await (await fetch(`${baseUrl}/api/public/pages`)).json()) as { slug: string }[];
  const publicDetail = (slug: string) => fetch(`${baseUrl}/api/public/pages/${slug}`);

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-ppp";
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

  it("borrar mueve a la papelera: sale de la lista y del sitio, y se restaura", async () => {
    const id = await crearPagina("papelera-demo", "published");
    expect((await publicList()).some((p) => p.slug === "papelera-demo")).toBe(true);

    // Borrado recuperable.
    const del = await fetch(`${baseUrl}/api/admin/pages/${id}`, { method: "DELETE", headers: auth() });
    expect(del.status).toBe(204);

    // Ya no está en la lista admin ni en la pública ni se sirve el detalle.
    const admin = await (await fetch(`${baseUrl}/api/admin/pages`, { headers: auth() })).json();
    expect(admin.some((p: any) => p.id === id)).toBe(false);
    expect((await publicList()).some((p) => p.slug === "papelera-demo")).toBe(false);
    expect((await publicDetail("papelera-demo")).status).toBe(404);

    // Sí está en la papelera.
    const pap = await (await fetch(`${baseUrl}/api/admin/pages/papelera`, { headers: auth() })).json();
    expect(pap.some((p: any) => p.id === id)).toBe(true);

    // Restaurar la devuelve.
    const r = await fetch(`${baseUrl}/api/admin/pages/${id}/restore`, { method: "POST", headers: auth() });
    expect(r.status).toBe(200);
    expect((await publicList()).some((p) => p.slug === "papelera-demo")).toBe(true);
  });

  it("el borrado definitivo sólo sale de la papelera y se lleva los bloques", async () => {
    const id = await crearPagina("purgar-demo", "draft");
    // Un bloque directo en la base, para comprobar el cascade sin depender de la
    // validación de props de ningún tipo de bloque.
    await db("blocks").insert({ page_id: id, type: "Hero", props: JSON.stringify({ title: "x" }), order: 0 });
    expect(await db("blocks").where({ page_id: id }).first()).toBeTruthy();

    // No se puede purgar una página viva (no está en la papelera).
    const noPuede = await fetch(`${baseUrl}/api/admin/pages/${id}/definitivo`, { method: "DELETE", headers: auth() });
    expect(noPuede.status).toBe(404);
    expect(await db("pages").where({ id }).first()).toBeTruthy();

    // A la papelera, y ahí sí se purga con sus bloques.
    await fetch(`${baseUrl}/api/admin/pages/${id}`, { method: "DELETE", headers: auth() });
    const purga = await fetch(`${baseUrl}/api/admin/pages/${id}/definitivo`, { method: "DELETE", headers: auth() });
    expect(purga.status).toBe(204);
    expect(await db("pages").where({ id }).first()).toBeFalsy();
    expect(await db("blocks").where({ page_id: id }).first()).toBeFalsy();
  });

  it("una página publicada con publish_at futuro está oculta hasta que la fecha pasa", async () => {
    const id = await crearPagina("agendada-demo", "published");
    // Visible al crearse (sin agenda).
    expect((await publicList()).some((p) => p.slug === "agendada-demo")).toBe(true);

    // Programada al futuro lejano: se oculta de lista, detalle y sitemap.
    const futuro = await fetch(`${baseUrl}/api/admin/pages/${id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ publish_at: "2099-01-01T00:00" }),
    });
    expect(futuro.status).toBe(200);
    expect((await publicList()).some((p) => p.slug === "agendada-demo")).toBe(false);
    expect((await publicDetail("agendada-demo")).status).toBe(404);
    const sitemap = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
    expect(sitemap).not.toContain("/agendada-demo");

    // Programada al pasado: vuelve a estar visible sola, sin tocar el status.
    const pasado = await fetch(`${baseUrl}/api/admin/pages/${id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ publish_at: "2000-01-01T00:00" }),
    });
    expect(pasado.status).toBe(200);
    expect((await publicList()).some((p) => p.slug === "agendada-demo")).toBe(true);

    // Quitar la programación (null) también la deja visible.
    await fetch(`${baseUrl}/api/admin/pages/${id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ publish_at: null }),
    });
    const fila = await db("pages").where({ id }).first();
    expect(fila.publish_at).toBeNull();
    expect((await publicList()).some((p) => p.slug === "agendada-demo")).toBe(true);
  });

  it("publish_at con un texto que no es fecha es 400", async () => {
    const id = await crearPagina("fecha-mala-demo", "draft");
    const res = await fetch(`${baseUrl}/api/admin/pages/${id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ publish_at: "no-es-fecha" }),
    });
    expect(res.status).toBe(400);
  });

  it("editar una página que está en la papelera es 404", async () => {
    const id = await crearPagina("editar-borrada-demo", "draft");
    await fetch(`${baseUrl}/api/admin/pages/${id}`, { method: "DELETE", headers: auth() });
    const res = await fetch(`${baseUrl}/api/admin/pages/${id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ title: "nuevo" }),
    });
    expect(res.status).toBe(404);
  });

  it("con una pestaña abierta: mover a la papelera y luego guardar bloques → 404 y contenido intacto", async () => {
    const id = await crearPagina("pestania-abierta-demo", "draft");
    // Estado inicial guardado (simula la pestaña del Page Builder ya cargada).
    const inicial = await fetch(`${baseUrl}/api/admin/pages/${id}/content`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ blocks: [{ type: "spacer", props: { height: 15 } }] }),
    });
    expect(inicial.status).toBe(200);

    // Desde otra pestaña la mandan a la papelera.
    await fetch(`${baseUrl}/api/admin/pages/${id}`, { method: "DELETE", headers: auth() });

    // La pestaña vieja intenta guardar: tanto /content como /blocks responden 404.
    const guardarContent = await fetch(`${baseUrl}/api/admin/pages/${id}/content`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ blocks: [{ type: "spacer", props: { height: 99 } }] }),
    });
    expect(guardarContent.status).toBe(404);
    const guardarBloques = await fetch(`${baseUrl}/api/admin/pages/${id}/blocks`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ blocks: [{ type: "spacer", props: { height: 99 } }] }),
    });
    expect(guardarBloques.status).toBe(404);

    // El contenido no se tocó: sigue el bloque de height 15.
    const bloques = await db("blocks").where({ page_id: id }).orderBy("order");
    expect(bloques.length).toBe(1);
    expect(jsonColumn<any>(bloques[0].props).height).toBe(15);
  });

  it("programar desde BORRADOR: publicada + fecha futura en una operación, oculta hasta la fecha", async () => {
    const id = await crearPagina("programar-borrador-demo", "draft");
    // Programar en una sola operación: pasa a published con publish_at futuro.
    const prog = await fetch(`${baseUrl}/api/admin/pages/${id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ status: "published", publish_at: "2099-01-01T00:00" }),
    });
    expect(prog.status, await prog.clone().text()).toBe(200);

    // La fila quedó published + agendada, pero el sitio no la muestra todavía.
    const fila = await db("pages").where({ id }).first();
    expect(fila.status).toBe("published");
    expect(fila.publish_at).toBeTruthy();
    expect((await publicList()).some((p) => p.slug === "programar-borrador-demo")).toBe(false);
    expect((await publicDetail("programar-borrador-demo")).status).toBe(404);
    const sitemap = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
    expect(sitemap).not.toContain("/programar-borrador-demo");

    // Cuando la fecha ya pasó, aparece sola (mismo status published).
    await fetch(`${baseUrl}/api/admin/pages/${id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ publish_at: "2000-01-01T00:00" }),
    });
    expect((await publicList()).some((p) => p.slug === "programar-borrador-demo")).toBe(true);

    // Despublicar la mantiene fuera del sitio (vuelve a borrador).
    await fetch(`${baseUrl}/api/admin/pages/${id}`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({ status: "draft" }),
    });
    expect((await publicList()).some((p) => p.slug === "programar-borrador-demo")).toBe(false);
  });
});
