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
 * Flujo editorial de páginas: draft → in_review → approved → published →
 * archived. Comprueba las transiciones válidas, el gateo por capacidad
 * (autor envía pero no aprueba/publica; revisor sí), los 409 desde estados
 * inválidos, y —lo más importante— que **sólo `published` es público**: los
 * estados intermedios y el archivado no se sirven en el sitio.
 *
 *   TEST_DATABASE=1 pnpm test tests/editorial-workflow.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_editorial`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("flujo editorial de páginas", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  const tokens: Record<string, string> = {};

  const login = async (email: string, password: string) =>
    (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })).json()).token as string;

  const admin = (path: string, method = "GET", token = tokens.superadmin, body?: unknown) =>
    fetch(`${baseUrl}/api/admin/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const estado = async (id: number) => (await (await admin(`pages/${id}`)).json()).status as string;

  /** Crea una página en borrador (como superadmin) y devuelve {id, slug}. */
  const crearBorrador = async (slug: string): Promise<{ id: number; slug: string }> => {
    const res = await admin("pages", "POST", tokens.superadmin, { slug, title: `Editorial ${slug}` });
    expect(res.status, await res.clone().text()).toBe(201);
    return { id: (await res.json()).id, slug };
  };

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-editorial";
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    tokens.superadmin = await login("admin@sanatorio.local", TEST_ADMIN_PASSWORD);
    expect(tokens.superadmin).toBeTruthy();
    for (const rol of ["autor", "revisor"] as const) {
      const email = `${rol}.ed@sanatorio.local`;
      const pass = `${TEST_ADMIN_PASSWORD}-${rol}`;
      const creado = await admin("users", "POST", tokens.superadmin, { email, name: `Usuario ${rol}`, password: pass, role: rol });
      expect(creado.status, await creado.clone().text()).toBe(201);
      tokens[rol] = await login(email, pass);
      expect(tokens[rol]).toBeTruthy();
    }
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("camino feliz: autor envía, revisor aprueba y publica", async () => {
    const { id } = await crearBorrador("camino-feliz");
    expect(await estado(id)).toBe("draft");

    expect((await admin(`pages/${id}/submit`, "POST", tokens.autor)).status).toBe(200);
    expect(await estado(id)).toBe("in_review");

    expect((await admin(`pages/${id}/approve`, "POST", tokens.revisor)).status).toBe(200);
    expect(await estado(id)).toBe("approved");

    expect((await admin(`pages/${id}/publish`, "POST", tokens.revisor)).status).toBe(200);
    expect(await estado(id)).toBe("published");
  });

  it("el autor no puede aprobar ni publicar (no tiene content.publish)", async () => {
    const { id } = await crearBorrador("autor-no-publica");
    expect((await admin(`pages/${id}/submit`, "POST", tokens.autor)).status).toBe(200);
    expect((await admin(`pages/${id}/approve`, "POST", tokens.autor)).status).toBe(403);
    // Sigue en revisión (la aprobación no ocurrió).
    expect(await estado(id)).toBe("in_review");
  });

  it("una transición desde un estado inválido da 409", async () => {
    const { id } = await crearBorrador("estado-invalido");
    // approve requiere in_review; desde draft es inválido.
    const res = await admin(`pages/${id}/approve`, "POST", tokens.revisor);
    expect(res.status).toBe(409);
    expect(await estado(id)).toBe("draft");
  });

  it("volver a borrador (return) desde revisión", async () => {
    const { id } = await crearBorrador("volver-borrador");
    await admin(`pages/${id}/submit`, "POST", tokens.autor);
    expect((await admin(`pages/${id}/return`, "POST", tokens.revisor)).status).toBe(200);
    expect(await estado(id)).toBe("draft");
  });

  it("archivar una publicada la retira del público; unarchive la vuelve a borrador", async () => {
    const { id, slug } = await crearBorrador("archivar-flujo");
    // Publicar por el camino directo (superadmin tiene content.publish).
    await admin(`pages/${id}/submit`, "POST", tokens.autor);
    await admin(`pages/${id}/approve`, "POST", tokens.revisor);
    await admin(`pages/${id}/publish`, "POST", tokens.revisor);
    expect(await estado(id)).toBe("published");
    // Pública mientras está published.
    expect((await fetch(`${baseUrl}/api/public/pages/${slug}`)).status).toBe(200);

    expect((await admin(`pages/${id}/archive`, "POST", tokens.revisor)).status).toBe(200);
    expect(await estado(id)).toBe("archived");
    // Ya no es pública.
    expect((await fetch(`${baseUrl}/api/public/pages/${slug}`)).status).toBe(404);

    expect((await admin(`pages/${id}/unarchive`, "POST", tokens.revisor)).status).toBe(200);
    expect(await estado(id)).toBe("draft");
  });

  it("los estados intermedios NO son públicos (sólo published)", async () => {
    const { id, slug } = await crearBorrador("no-publico");
    // draft
    expect((await fetch(`${baseUrl}/api/public/pages/${slug}`)).status).toBe(404);
    await admin(`pages/${id}/submit`, "POST", tokens.autor);
    // in_review
    expect((await fetch(`${baseUrl}/api/public/pages/${slug}`)).status).toBe(404);
    await admin(`pages/${id}/approve`, "POST", tokens.revisor);
    // approved (aprobado no es publicado)
    expect((await fetch(`${baseUrl}/api/public/pages/${slug}`)).status).toBe(404);
  });

  it("una transición sobre una página inexistente da 404", async () => {
    expect((await admin(`pages/999999/submit`, "POST", tokens.superadmin)).status).toBe(404);
  });

  // ---- Guardas de edición vs. publicación (hallazgos Codex #36 F1/F3/F6) ----

  it("F1/F6: el autor guarda contenido reenviando el estado actual (draft y in_review) sin 400/403", async () => {
    const { id } = await crearBorrador("autor-guarda-estado");
    // El Page Builder reenvía el estado actual en cada guardado. Un borrador:
    const g1 = await admin(`pages/${id}/content`, "PUT", tokens.autor, {
      title: "Editado por autor",
      status: "draft",
      blocks: [],
    });
    expect(g1.status, await g1.clone().text()).toBe(200);
    // Mandado a revisión: el schema tiene que aceptar `in_review` (antes daba 400)
    // y el guard, al no cambiar el estado, no exige content.publish.
    expect((await admin(`pages/${id}/submit`, "POST", tokens.autor)).status).toBe(200);
    const g2 = await admin(`pages/${id}/content`, "PUT", tokens.autor, {
      title: "Otra edición en revisión",
      status: "in_review",
      blocks: [],
    });
    expect(g2.status, await g2.clone().text()).toBe(200);
    expect(await estado(id)).toBe("in_review"); // el guardado no cambió el estado
  });

  it("F6: el autor NO puede cambiar el estado por /content (in_review→published da 403)", async () => {
    const { id } = await crearBorrador("autor-no-cambia-estado");
    await admin(`pages/${id}/submit`, "POST", tokens.autor);
    const res = await admin(`pages/${id}/content`, "PUT", tokens.autor, { status: "published", blocks: [] });
    expect(res.status).toBe(403);
    expect(await estado(id)).toBe("in_review"); // no publicó
  });

  it("F3: el autor NO puede cambiar publish_at por PUT sin status (no puede publicar una agendada ni ocultar una viva)", async () => {
    const { id, slug } = await crearBorrador("autor-no-agenda");
    // El revisor la programa a futuro: queda published + publish_at futuro → aún no pública.
    expect((await admin(`pages/${id}/schedule`, "POST", tokens.revisor, { publish_at: "2099-01-01T10:00" })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/public/pages/${slug}`)).status).toBe(404);
    // El autor intenta publicarla ya limpiando la agenda (publish_at:null) sin tocar status → 403.
    const abuso = await admin(`pages/${id}`, "PUT", tokens.autor, { publish_at: null });
    expect(abuso.status, await abuso.clone().text()).toBe(403);
    expect((await fetch(`${baseUrl}/api/public/pages/${slug}`)).status).toBe(404); // sigue oculta
    // El revisor (content.publish) sí puede limpiar la agenda → pública ya.
    expect((await admin(`pages/${id}`, "PUT", tokens.revisor, { publish_at: null })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/public/pages/${slug}`)).status).toBe(200);
  });

  it("F8: la bitácora se puede filtrar por una acción editorial (approve) sin 400", async () => {
    const { id } = await crearBorrador("audit-approve");
    await admin(`pages/${id}/submit`, "POST", tokens.autor);
    expect((await admin(`pages/${id}/approve`, "POST", tokens.revisor)).status).toBe(200);
    const res = await admin(`audit?action=approve&resource_type=pages&limit=100`, "GET", tokens.superadmin);
    expect(res.status).toBe(200); // antes: 400 (acción no permitida en el filtro)
    const body = await res.json();
    expect(body.items.some((r: any) => String(r.resource_id) === String(id) && r.action === "approve")).toBe(true);
  });
});
