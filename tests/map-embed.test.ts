import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import { mapEmbedUrl } from "../api/src/html";
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
 * El mapa no puede ser una vía de XSS almacenado.
 *
 * El saneo al guardar cubría lo que entraba por el panel, pero la salida
 * pública devolvía `contact.mapEmbed` tal como estuviera en la base y el front
 * lo insertaba con `dangerouslySetInnerHTML`. Una fila vieja —o escrita
 * directo con SQL— llegaba cruda hasta ese `innerHTML`.
 *
 * Ahora no viaja HTML: la API publica sólo la URL validada y el front arma el
 * iframe. Estas pruebas escriben los payloads **directo en la base**, salteando
 * toda la validación de escritura, que es justo el caso que fallaba.
 *
 *   TEST_DATABASE=1 pnpm test tests/map-embed.test.ts
 */

const ROOT = resolve(__dirname, "..");
const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_map`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

/** Payloads que antes llegaban intactos al navegador. */
const PAYLOADS: [string, string][] = [
  ["srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ["onload", '<iframe src="https://www.google.com/maps/embed?pb=1" onload="alert(1)"></iframe>'],
  ["javascript:", '<iframe src="javascript:alert(document.cookie)"></iframe>'],
  ["host falso", '<iframe src="https://google.com.evil.test/maps/embed?pb=1"></iframe>'],
  ["subdominio falso", '<iframe src="https://evil.test/maps/embed?pb=1"></iframe>'],
  ["HTML mal formado", '<iframe src=https://www.google.com/maps/embed onerror=alert(1) <script>alert(2)</script>'],
  ["script suelto", '<script>alert(1)</script>'],
  ["img onerror", '<img src=x onerror="alert(1)">'],
  ["data:", '<iframe src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></iframe>'],
  ["entidad ofuscada", '<iframe src="java&#115;cript:alert(1)"></iframe>'],
  ["http sin TLS", '<iframe src="http://www.google.com/maps/embed?pb=1"></iframe>'],
];

/** Marcas que no pueden aparecer en la respuesta pública, pase lo que pase. */
const FORBIDDEN = ["srcdoc", "onload", "onerror", "javascript:", "<script", "evil.test", "data:text/html"];

describe("mapEmbedUrl", () => {
  it.each(PAYLOADS)("descarta %s", (_label, payload) => {
    expect(mapEmbedUrl(payload)).toBe("");
  });

  it("acepta el mapa legítimo y devuelve sólo la URL", () => {
    const out = mapEmbedUrl('<iframe src="https://www.google.com/maps/embed?pb=!1m18"></iframe>');
    expect(out).toBe("https://www.google.com/maps/embed?pb=!1m18");
    expect(out).not.toContain("<");
  });
});

describe("el front no inserta HTML del mapa", () => {
  it("MapEmbed arma el iframe en vez de usar dangerouslySetInnerHTML", () => {
    const source = readFileSync(resolve(ROOT, "apps/web/src/blocks/MapEmbed.tsx"), "utf8");
    // Se busca el uso, no la palabra: el comentario del archivo explica por qué
    // se retiró.
    expect(source).not.toMatch(/dangerouslySetInnerHTML\s*=/);
    expect(source).toContain("<iframe");
    // Y vuelve a validar la URL antes de ponerla en el src.
    expect(source).toContain("isMapEmbedUrl");
  });
});

describeDb("la salida pública no publica el HTML del mapa", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-mapa";
    const { createApp } = await import("../api/src/app.js");
    const app = createApp();
    await new Promise<void>((resolvePromise) => {
      server = app.listen(0, () => resolvePromise());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@sanatorio.local", password: TEST_ADMIN_PASSWORD }),
    });
    token = (await login.json()).token;
  }, 180_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  /** Escribe el valor saltándose la API: el caso que antes no estaba cubierto. */
  async function writeContactDirectly(patch: Record<string, unknown>) {
    const row = await db("settings").where({ key: "contact" }).first("value");
    const contact = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    await db("settings")
      .where({ key: "contact" })
      .update({ value: JSON.stringify({ ...contact, ...patch }) });
  }

  it.each(PAYLOADS)("un %s insertado con SQL no llega a la respuesta", async (_label, payload) => {
    await writeContactDirectly({ mapEmbed: payload });
    const res = await fetch(`${baseUrl}/api/public/settings`);
    const body = await res.text();

    expect(body).not.toContain("mapEmbed\"");
    for (const marker of FORBIDDEN) {
      expect(body.toLowerCase(), `${marker} llegó a la respuesta`).not.toContain(marker.toLowerCase());
    }
    const parsed = JSON.parse(body);
    expect(parsed.contact.mapEmbedUrl).toBe("");
  });

  it("un mapa legítimo sí se publica, como URL", async () => {
    await writeContactDirectly({
      mapEmbed: '<iframe src="https://www.google.com/maps/embed?pb=!1m18"></iframe>',
    });
    const body = await (await fetch(`${baseUrl}/api/public/settings`)).json();
    expect(body.contact.mapEmbedUrl).toBe("https://www.google.com/maps/embed?pb=!1m18");
    expect(body.contact.mapEmbed).toBeUndefined();
  });

  it("un mapsUrl peligroso escrito con SQL tampoco se publica", async () => {
    for (const bad of ["javascript:alert(1)", "//evil.test/maps", "data:text/html,<script>alert(1)</script>"]) {
      await writeContactDirectly({ mapsUrl: bad });
      const body = await (await fetch(`${baseUrl}/api/public/settings`)).json();
      expect(body.contact.mapsUrl, bad).toBe("");
    }
  });

  it("el bloque de mapa publica embedUrl y no embedHtml", async () => {
    const page = await db("pages").where({ slug: "home" }).first("id");
    const block = await db("blocks").where({ page_id: page.id, type: "mapEmbed" }).first("id");
    expect(block, "la home tiene que traer un bloque de mapa").toBeTruthy();
    await db("blocks")
      .where({ id: block.id })
      .update({
        props: JSON.stringify({
          embedHtml: '<iframe srcdoc="<script>alert(1)</script>" onload="alert(2)"></iframe>',
          height: 400,
        }),
      });

    const body = await (await fetch(`${baseUrl}/api/public/pages/home`)).text();
    for (const marker of FORBIDDEN) {
      expect(body.toLowerCase(), `${marker} llegó al bloque`).not.toContain(marker.toLowerCase());
    }
    const parsed = JSON.parse(body);
    const mapBlock = parsed.blocks.find((b: { type: string }) => b.type === "mapEmbed");
    expect(mapBlock.props.embedUrl).toBe("");
    expect(mapBlock.props.embedHtml).toBeUndefined();
  });

  it("un embedUrl guardado nunca pisa al calculado", async () => {
    // El bloque podía traer un `embedHtml` inocente y un `embedUrl` con
    // `javascript:`. La salida calculaba el bueno y después lo sobrescribía
    // con el guardado. Ahora `embedUrl` es de sólo salida.
    const page = await db("pages").where({ slug: "home" }).first("id");
    const block = await db("blocks").where({ page_id: page.id, type: "mapEmbed" }).first("id");
    await db("blocks")
      .where({ id: block.id })
      .update({
        props: JSON.stringify({
          embedHtml: "https://www.google.com/maps/embed?pb=1",
          embedUrl: "javascript:alert(1)",
          height: 400,
        }),
      });

    const body = await (await fetch(`${baseUrl}/api/public/pages/home`)).text();
    expect(body.toLowerCase()).not.toContain("javascript:");
    const parsed = JSON.parse(body);
    const mapBlock = parsed.blocks.find((b: { type: string }) => b.type === "mapEmbed");
    expect(mapBlock.props.embedUrl).toBe("https://www.google.com/maps/embed?pb=1");
  });

  it("sin embedHtml válido el embedUrl sale vacío, no el guardado", async () => {
    const page = await db("pages").where({ slug: "home" }).first("id");
    const block = await db("blocks").where({ page_id: page.id, type: "mapEmbed" }).first("id");
    await db("blocks")
      .where({ id: block.id })
      .update({
        props: JSON.stringify({
          embedHtml: "https://evil.test/maps/embed?pb=1",
          embedUrl: "https://www.google.com/maps/embed?pb=1",
        }),
      });

    const body = await (await fetch(`${baseUrl}/api/public/pages/home`)).json();
    const mapBlock = body.blocks.find((b: { type: string }) => b.type === "mapEmbed");
    expect(mapBlock.props.embedUrl).toBe("");
  });

  it("el schema descarta embedUrl del payload administrativo", async () => {
    const page = await db("pages").where({ slug: "home" }).first("id");
    const res = await fetch(`${baseUrl}/api/admin/pages/${page.id}/blocks`, {
      method: "PUT",
      headers: auth(),
      body: JSON.stringify({
        blocks: [
          {
            type: "mapEmbed",
            props: {
              embedHtml: '<iframe src="https://www.google.com/maps/embed?pb=1"></iframe>',
              embedUrl: "javascript:alert(1)",
              height: 400,
            },
          },
        ],
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const row = await db("blocks").where({ page_id: page.id, type: "mapEmbed" }).first("props");
    const props = typeof row.props === "string" ? JSON.parse(row.props) : row.props;
    expect(props.embedUrl).toBeUndefined();
    expect(props.embedHtml).toBe("https://www.google.com/maps/embed?pb=1");
  });

  it("y la salida pública lo vuelve a calcular", async () => {
    const body = await (await fetch(`${baseUrl}/api/public/pages/home`)).json();
    const mapBlock = body.blocks.find((b: { type: string }) => b.type === "mapEmbed");
    expect(mapBlock.props.embedUrl).toBe("https://www.google.com/maps/embed?pb=1");
  });
});
