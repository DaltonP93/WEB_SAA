import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import { LEGACY_PORTAL_PATHS, PORTAL_CANONICAL } from "../api/src/legacy-redirects";
import {
  DB_TESTS_ENABLED,
  applyDbEnv,
  createTestDatabase,
  dropTestDatabase,
  closeAppDb,
  closeServer,
  migrateLatest,
  runSeeds,
} from "./helpers/db";

/**
 * Sitemap y redirects con la base sana.
 *
 * El caso de la base caída está en `tests/api.test.ts`, que levanta la API
 * apuntando a un puerto cerrado. Acá interesa lo contrario: que con todo
 * funcionando el sitemap salga completo y que las rutas viejas del portal
 * respondan un 301 real, no una redirección por JavaScript.
 *
 *   TEST_DATABASE=1 pnpm test tests/sitemap.test.ts
 */

const ROOT = resolve(__dirname, "..");
const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_sitemap`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describe("las tres capas comparten la misma lista de rutas viejas", () => {
  it("el front redirige exactamente las mismas rutas que la API", () => {
    const app = readFileSync(resolve(ROOT, "apps/web/src/App.tsx"), "utf8");
    const block = /const PORTAL_REDIRECTS = \[([\s\S]*?)\]/.exec(app);
    expect(block, "no se encontró PORTAL_REDIRECTS en App.tsx").toBeTruthy();
    const inApp = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(inApp).toEqual([...LEGACY_PORTAL_PATHS].sort());
  });

  it("el nginx de producción redirige las mismas rutas", () => {
    // Nginx responde antes que Node, así que si falta una acá el 301 no ocurre
    // en producción por más que la API lo tenga.
    const nginx = readFileSync(resolve(ROOT, "scripts/deploy/setup-vps.sh"), "utf8");
    for (const from of LEGACY_PORTAL_PATHS) {
      expect(nginx, `falta el return 301 de ${from}`).toContain(
        `location = ${from}`,
      );
    }
    expect(nginx).toContain(`return 301 ${PORTAL_CANONICAL};`);
  });
});

describeDb("sitemap con la base sana", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.PUBLIC_SITE_URL = "https://ejemplo.test";
    const { createApp } = await import("../api/src/app.js");
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 180_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("responde 200 con XML válido y las páginas publicadas", async () => {
    const res = await fetch(`${baseUrl}/sitemap.xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("xml");
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain("<loc>https://ejemplo.test/</loc>");
    expect(xml).toContain("<loc>https://ejemplo.test/profesionales</loc>");

    const published = await db("pages").where({ status: "published" }).select("slug");
    for (const page of published) {
      const loc = page.slug === "home" ? "/" : `/${page.slug}`;
      expect(xml, `falta ${loc}`).toContain(`<loc>https://ejemplo.test${loc}</loc>`);
    }
  });

  it("no indexa páginas en borrador ni la sección retirada de Noticias", async () => {
    const xml = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
    const drafts = await db("pages").whereNot({ status: "published" }).select("slug");
    for (const page of drafts) {
      expect(xml, `no debería indexar ${page.slug}`).not.toContain(
        `<loc>https://ejemplo.test/${page.slug}</loc>`,
      );
    }
    expect(xml).not.toContain("/noticias");
  });

  it("las rutas viejas del portal devuelven 301 hacia la canónica", async () => {
    for (const from of LEGACY_PORTAL_PATHS) {
      const res = await fetch(`${baseUrl}${from}`, { redirect: "manual" });
      expect(res.status, from).toBe(301);
      expect(res.headers.get("location"), from).toBe(PORTAL_CANONICAL);
    }
  });

  it("el sitemap indexa la canónica del portal y no las viejas", async () => {
    const xml = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
    expect(xml).toContain(`<loc>https://ejemplo.test${PORTAL_CANONICAL}</loc>`);
    for (const from of LEGACY_PORTAL_PATHS) {
      expect(xml, `no debería indexar ${from}`).not.toContain(
        `<loc>https://ejemplo.test${from}</loc>`,
      );
    }
  });
});
