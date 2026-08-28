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
 * Historial realmente recuperable, con guardado atómico completo.
 *
 * El contrato corregido: `PUT /pages/:id/content` archiva el estado ANTERIOR
 * antes de reemplazar, así la primera edición de una página existente ya deja
 * recuperable su contenido original. Restaurar archiva primero el estado actual,
 * de modo que restaurar se pueda deshacer. La foto es completa (título, estado,
 * SEO, publish_at, bloques) y consistente, y nada queda a medias si algo falla.
 *
 *   TEST_DATABASE=1 pnpm test tests/page-revisions.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_rev`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("paginas: historial realmente recuperable", () => {
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
  /** Guardado atómico completo (metadatos + bloques). */
  function guardar(id: number, body: any) {
    return fetch(`${baseUrl}/api/admin/pages/${id}/content`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify(body),
    });
  }
  const listar = async (id: number) =>
    (await (await fetch(`${baseUrl}/api/admin/pages/${id}/revisions`, { headers: auth() })).json()) as any[];
  const verPagina = async (id: number) =>
    (await (await fetch(`${baseUrl}/api/admin/pages/${id}`, { headers: auth() })).json()) as any;

  const contenidoA = {
    title: "Versión A",
    status: "draft" as const,
    seo: { title: "seg A", description: "desc A" },
    blocks: [{ type: "spacer", props: { height: 11 } }],
  };
  const contenidoB = {
    title: "Versión B",
    status: "published" as const,
    seo: { title: "seg B", description: "desc B" },
    blocks: [
      { type: "spacer", props: { height: 21 } },
      { type: "spacer", props: { height: 22 } },
    ],
  };

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-rev";
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

  it("página preexistente con contenido A → primer guardado B → restaurar A vuelve a A", async () => {
    const id = await crearPagina("recuperable-demo");
    // La página YA tiene contenido A, puesto **sin pasar por el archivado**
    // (simula contenido preexistente: de antes de esta feature, o de una vía
    // que no archiva). No hay ninguna revisión todavía.
    await db("pages")
      .where({ id })
      .update({ title: "Versión A", status: "draft", seo: JSON.stringify({ title: "seg A", description: "desc A" }) });
    await db("blocks").insert({ page_id: id, type: "spacer", props: JSON.stringify({ height: 11 }), order: 0 });
    expect((await db("page_revisions").where({ page_id: id })).length).toBe(0);

    // Primera edición de la página existente vía el endpoint: pasa a B. Con
    // "archivar después" el contenido A se perdería acá; con "archivar antes"
    // queda archivado.
    expect((await guardar(id, contenidoB)).status).toBe(200);

    // El contenido original A quedó archivado y es recuperable.
    const revs = await listar(id);
    const revA = revs.find((r) => r.title === "Versión A");
    expect(revA, "la versión A tiene que estar en el historial").toBeTruthy();
    expect(revA.blockCount).toBe(1);

    const restaurar = await fetch(`${baseUrl}/api/admin/pages/${id}/revisions/${revA.id}/restore`, {
      method: "POST",
      headers: auth(),
    });
    expect(restaurar.status, await restaurar.clone().text()).toBe(200);

    const page = await verPagina(id);
    expect(page.title).toBe("Versión A");
    expect(page.status).toBe("draft");
    expect(jsonColumn<any>(page.seo).title).toBe("seg A");
    expect(page.blocks.length).toBe(1);
    expect(jsonColumn<any>(page.blocks[0].props).height).toBe(11);
  });

  it("restaurar A y luego restaurar B otra vez (restaurar es reversible)", async () => {
    const id = await crearPagina("reversible-demo");
    await guardar(id, contenidoA);
    await guardar(id, contenidoB); // current = B

    const revs1 = await listar(id);
    const revA = revs1.find((r) => r.title === "Versión A");
    // Restaurar A: archiva primero el estado actual (B), así B queda recuperable.
    await fetch(`${baseUrl}/api/admin/pages/${id}/revisions/${revA.id}/restore`, { method: "POST", headers: auth() });
    expect((await verPagina(id)).title).toBe("Versión A");

    const revs2 = await listar(id);
    const revB = revs2.find((r) => r.title === "Versión B");
    expect(revB, "restaurar A tuvo que archivar B").toBeTruthy();
    await fetch(`${baseUrl}/api/admin/pages/${id}/revisions/${revB.id}/restore`, { method: "POST", headers: auth() });
    const page = await verPagina(id);
    expect(page.title).toBe("Versión B");
    expect(page.status).toBe("published");
    expect(page.blocks.length).toBe(2);
  });

  it("un bloque inválido no deja los metadatos actualizados a medias", async () => {
    const id = await crearPagina("atomico-demo");
    await guardar(id, contenidoA); // title = "Versión A"
    const antes = await verPagina(id);

    const res = await guardar(id, {
      title: "NO DEBE QUEDAR",
      status: "published",
      blocks: [{ type: "tipo-inexistente", props: {} }],
    });
    expect(res.status).toBe(400);

    const despues = await verPagina(id);
    expect(despues.title).toBe(antes.title); // el título no cambió
    expect(despues.status).toBe(antes.status);
    expect(despues.blocks.length).toBe(1); // los bloques tampoco
  });

  it("el snapshot conserva título, estado, SEO y propiedades anidadas de los bloques", async () => {
    const id = await crearPagina("snapshot-demo");
    await guardar(id, {
      title: "Con anidados",
      status: "published",
      seo: { title: "seo-t", description: "seo-d", ogImage: "/uploads/o.png" },
      blocks: [{ type: "spacer", props: { height: 42 } }],
    });
    // Segundo guardado para que el primero quede archivado.
    await guardar(id, { title: "Otro", blocks: [] });

    const rev = (await listar(id)).find((r) => r.title === "Con anidados");
    expect(rev).toBeTruthy();
    const fila = await db("page_revisions").where({ id: rev.id }).first();
    const snap = jsonColumn<any>(fila.snapshot);
    expect(snap.title).toBe("Con anidados");
    expect(snap.status).toBe("published");
    expect(snap.seo).toEqual({ title: "seo-t", description: "seo-d", ogImage: "/uploads/o.png" });
    expect(snap.blocks[0].props.height).toBe(42);
  });

  it("el historial se poda al máximo de 30", async () => {
    const id = await crearPagina("poda-demo");
    for (let i = 0; i < 33; i++) {
      await guardar(id, { title: `v${i}`, blocks: [{ type: "spacer", props: { height: (i % 200) + 1 } }] });
    }
    const total = await db("page_revisions").where({ page_id: id }).count<{ c: number }[]>({ c: "*" });
    expect(Number(total[0].c)).toBe(30);
  });

  it("guardar en una página inexistente o en la papelera es 404 y no la modifica", async () => {
    // Inexistente.
    expect((await guardar(999999, contenidoA)).status).toBe(404);

    // En la papelera: no se toca.
    const id = await crearPagina("papelera-content-demo");
    await guardar(id, contenidoA);
    const antes = await verPagina(id);
    await fetch(`${baseUrl}/api/admin/pages/${id}`, { method: "DELETE", headers: auth() }); // a la papelera
    const res = await guardar(id, { title: "NO", blocks: [] });
    expect(res.status).toBe(404);
    // El contenido guardado sigue intacto (title de A, 1 bloque).
    const fila = await db("pages").where({ id }).first();
    expect(fila.title).toBe(antes.title);
    expect((await db("blocks").where({ page_id: id })).length).toBe(1);
  });

  it("restaurar una versión que no existe es 404; el borrado definitivo se lleva el historial", async () => {
    const id = await crearPagina("rev404-cascade-demo");
    await guardar(id, contenidoA);
    await guardar(id, contenidoB);
    expect(await db("page_revisions").where({ page_id: id }).first()).toBeTruthy();

    const noExiste = await fetch(`${baseUrl}/api/admin/pages/${id}/revisions/999999/restore`, {
      method: "POST",
      headers: auth(),
    });
    expect(noExiste.status).toBe(404);

    await fetch(`${baseUrl}/api/admin/pages/${id}`, { method: "DELETE", headers: auth() });
    await fetch(`${baseUrl}/api/admin/pages/${id}/definitivo`, { method: "DELETE", headers: auth() });
    expect(await db("page_revisions").where({ page_id: id }).first()).toBeFalsy();
  });
});
