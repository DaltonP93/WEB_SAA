#!/usr/bin/env node
/**
 * Verifica que el prerender de SEO realmente genere lo que dice generar.
 *
 * El build de web corre `apps/web/scripts/prerender.mjs`, que necesita la API
 * arriba. En CI la API no estaba corriendo, así que el paso se saltaba con un
 * aviso y el build seguía en verde: "prerender OK" no significaba nada.
 *
 * Este script levanta la API contra una base migrada y sembrada, publica un
 * estudio (en una instalación limpia no hay ninguno publicado a propósito),
 * corre el build y comprueba el archivo generado. Después verifica el caso
 * contrario: sin estudios publicados no se escribe una página vacía.
 *
 *   node scripts/ci/verify-prerender.mjs
 *
 * Variables: DB_HOST, DB_PORT, DB_USER, DB_PASS y PRERENDER_DB_NAME.
 */

import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// knex y mysql2 son dependencias de api/, no de la raíz del workspace.
const requireFromApi = createRequire(resolve(ROOT, "api/package.json"));
const knexFactory = requireFromApi("knex");
const DIST_ESTUDIOS = resolve(ROOT, "apps/web/dist/estudios/index.html");

const DB = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASS ?? "root",
  charset: "utf8mb4",
};
const DB_NAME = process.env.PRERENDER_DB_NAME ?? "sanatorio_prerender";
const API_PORT = Number(process.env.PRERENDER_API_PORT ?? 4310);
const API_BASE = `http://127.0.0.1:${API_PORT}`;

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};

function run(cmd, args, extraEnv = {}) {
  execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
}

const dbEnv = {
  DB_HOST: DB.host,
  DB_PORT: String(DB.port),
  DB_USER: DB.user,
  DB_PASS: DB.password,
  DB_NAME,
};

async function waitForApi(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* todavía no levantó */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function buildWeb() {
  rmSync(resolve(ROOT, "apps/web/dist/estudios"), { recursive: true, force: true });
  run("pnpm", ["--filter", "@sa/web", "build"], {
    PRERENDER_API_BASE: API_BASE,
    PUBLIC_SITE_URL: "https://ejemplo.test",
  });
}

async function main() {
  console.log(`→ preparando base ${DB_NAME}`);
  const admin = knexFactory({ client: "mysql2", connection: DB });
  await admin.raw(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  await admin.raw(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.destroy();

  run("pnpm", ["db:migrate"], { ...dbEnv, NODE_ENV: "production" });
  run("pnpm", ["db:seed"], { ...dbEnv, SEED_DEMO_DATA: "0", SEED_ADMIN_PASSWORD: `ci-${Date.now()}` });

  const db = knexFactory({ client: "mysql2", connection: { ...DB, database: DB_NAME } });

  console.log(`→ levantando la API en ${API_BASE}`);
  const api = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: resolve(ROOT, "api"),
    env: { ...process.env, ...dbEnv, PORT: String(API_PORT), JWT_SECRET: `ci-${Date.now()}` },
    stdio: "inherit",
  });

  try {
    if (!(await waitForApi())) throw new Error(`la API no respondió en ${API_BASE}`);

    // --- caso 1: hay un estudio publicado → la página se genera ------------
    const study = await db("studies").first("id", "name");
    if (!study) throw new Error("la base sembrada no tiene estudios en el catálogo");
    await db("studies").where({ id: study.id }).update({ published: true });
    console.log(`→ estudio publicado para la prueba: ${study.name}`);

    await buildWeb();

    if (!existsSync(DIST_ESTUDIOS)) {
      fail("no se generó apps/web/dist/estudios/index.html con un estudio publicado");
    } else {
      const html = readFileSync(DIST_ESTUDIOS, "utf8");
      const checks = [
        [html.includes(study.name), `el HTML no contiene el estudio publicado (${study.name})`],
        [html.includes('rel="canonical"'), "falta el canonical"],
        [html.includes("https://ejemplo.test/estudios/"), "el canonical no usa PUBLIC_SITE_URL"],
        [html.includes("application/ld+json"), "falta el JSON-LD"],
      ];
      for (const [ok, msg] of checks) if (!ok) fail(msg);
      if (checks.every(([ok]) => ok)) console.log("✓ prerender genera /estudios con el contenido esperado");
    }

    // --- caso 2: sin estudios publicados → no se escribe página vacía ------
    await db("studies").update({ published: false });
    await buildWeb();
    if (existsSync(DIST_ESTUDIOS)) {
      fail("se generó una página de estudios vacía: sin estudios publicados no debe escribirse");
    } else {
      console.log("✓ sin estudios publicados el prerender se omite (no publica una página vacía)");
    }
  } finally {
    api.kill("SIGTERM");
    await db.destroy();
    const cleanup = knexFactory({ client: "mysql2", connection: DB });
    await cleanup.raw(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    await cleanup.destroy();
  }

  if (process.exitCode) {
    console.error("✗ verificación del prerender FALLÓ");
  } else {
    console.log("✓ verificación del prerender OK");
  }
}

main().catch((err) => {
  console.error(`✗ verificación del prerender FALLÓ: ${err.message}`);
  process.exit(1);
});
