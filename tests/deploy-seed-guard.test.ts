import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  baseConnection,
  createTestDatabase,
  dropTestDatabase,
  migrateLatest,
  runSeeds,
} from "./helpers/db";

/**
 * El reseed no puede depender de un archivo.
 *
 * `setup-vps.sh` decidía sembrar mirando si existía `${APP_DIR}/.seeded`. Los
 * seeds empiezan con `del()` sobre users, settings, doctors, specialties,
 * services, studies, pages y blocks: si ese archivo se perdía —un directorio
 * recreado, un rsync incompleto, un servidor reinstalado contra la misma
 * base—, la siguiente corrida borraba todo lo que el sanatorio hubiera
 * cargado.
 *
 * Ahora la decisión la toma `scripts/deploy/db-state.mjs` mirando la base.
 *
 *   TEST_DATABASE=1 pnpm test tests/deploy-seed-guard.test.ts
 */

const ROOT = resolve(__dirname, "..");
const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_seedguard`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

/** Corre el guard como lo corre el deploy y devuelve token + código. */
function dbState(dbName: string, marker: string) {
  try {
    const stdout = execFileSync("node", ["scripts/deploy/db-state.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DB_HOST: baseConnection.host,
        DB_PORT: String(baseConnection.port),
        DB_USER: baseConnection.user,
        DB_PASS: baseConnection.password,
        DB_NAME: dbName,
        SEED_MARKER: marker,
      },
    });
    return { token: stdout.trim(), code: 0 };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { token: String(e.stdout ?? "").trim(), code: e.status, stderr: String(e.stderr ?? "") };
  }
}

describeDb("estado de la base antes de sembrar", () => {
  let db: Knex;
  let tmp: string;
  let marker: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "seedguard-"));
    marker = join(tmp, ".seeded");
    db = await createTestDatabase(DB_NAME);
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("una base sin tablas es una instalación nueva", () => {
    const { token, code } = dbState(DB_NAME, marker);
    expect(token).toBe("nueva");
    expect(code).toBe(0);
  });

  it("una base que no existe también", () => {
    const { token, code } = dbState(`${DB_NAME}_inexistente`, marker);
    expect(token).toBe("nueva");
    expect(code).toBe(0);
  });

  it("una base ya migrada sin marker es un conflicto, no una instalación nueva", async () => {
    await migrateLatest(db);
    // Instalación cortada por la mitad: migró y no llegó a sembrar. Podría
    // parecer seguro sembrar —el seed todavía no corrió—, pero desde afuera no
    // hay forma de distinguirlo de una base viva a la que se le borró el
    // marker. Se para y se le pregunta al operador; el mensaje dice cómo
    // seguir en cada caso.
    const { token, code } = dbState(DB_NAME, marker);
    expect(token).toBe("conflicto");
    expect(code).toBe(3);
  }, 180_000);

  describe("con contenido del cliente", () => {
    let before: Record<string, number>;

    beforeAll(async () => {
      await runSeeds(db);
      // Y encima, contenido cargado desde el panel después de instalar.
      const [pageId] = await db("pages").insert({
        slug: "pagina-del-cliente",
        title: "Cargada por el sanatorio",
        status: "published",
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      await db("blocks").insert({
        page_id: pageId,
        type: "richText",
        order: 0,
        props: JSON.stringify({ html: "<p>Texto propio.</p>" }),
      });
      await db("contact_channels")
        .where({ key: "whatsapp-general" })
        .update({ value: "+595 21 000 000", active: true });

      before = {
        users: Number((await db("users").count({ n: "*" }))[0].n),
        pages: Number((await db("pages").count({ n: "*" }))[0].n),
        blocks: Number((await db("blocks").count({ n: "*" }))[0].n),
        settings: Number((await db("settings").count({ n: "*" }))[0].n),
        doctors: Number((await db("doctors").count({ n: "*" }))[0].n),
        specialties: Number((await db("specialties").count({ n: "*" }))[0].n),
        services: Number((await db("services").count({ n: "*" }))[0].n),
        studies: Number((await db("studies").count({ n: "*" }))[0].n),
      };
    }, 180_000);

    it("sin el marker: conflicto y salida distinta de cero", () => {
      // El caso que borraba la base entera.
      const { token, code, stderr } = dbState(DB_NAME, marker);
      expect(token).toBe("conflicto");
      expect(code).toBe(3);
      expect(stderr).toContain("YA TIENE CONTENIDO");
      // Y le dice al operador cómo seguir sin perder nada.
      expect(stderr).toContain(marker);
    });

    it("el guard no borra nada al detectar el conflicto", async () => {
      const after = {
        users: Number((await db("users").count({ n: "*" }))[0].n),
        pages: Number((await db("pages").count({ n: "*" }))[0].n),
        blocks: Number((await db("blocks").count({ n: "*" }))[0].n),
        settings: Number((await db("settings").count({ n: "*" }))[0].n),
        doctors: Number((await db("doctors").count({ n: "*" }))[0].n),
        specialties: Number((await db("specialties").count({ n: "*" }))[0].n),
        services: Number((await db("services").count({ n: "*" }))[0].n),
        studies: Number((await db("studies").count({ n: "*" }))[0].n),
      };
      expect(after).toEqual(before);
      const page = await db("pages").where({ slug: "pagina-del-cliente" }).first();
      expect(page, "la página del cliente sigue ahí").toBeTruthy();
    });

    it("con el marker: actualización, tampoco se siembra", () => {
      writeFileSync(marker, "");
      const { token, code } = dbState(DB_NAME, marker);
      expect(token).toBe("actualizacion");
      expect(code).toBe(0);
    });
  });
});

describe("el deploy usa el estado de la base, no el marker", () => {
  const script = readFileSync(resolve(ROOT, "scripts/deploy/setup-vps.sh"), "utf8");

  it("consulta db-state.mjs antes de migrar", () => {
    const guard = script.indexOf("db-state.mjs");
    const migrate = script.indexOf("pnpm db:migrate");
    expect(guard).toBeGreaterThan(-1);
    // Si hay conflicto, la base ni siquiera se migra.
    expect(guard).toBeLessThan(migrate);
  });

  it("sólo siembra cuando el estado es 'nueva'", () => {
    expect(script).toMatch(/if \[ "\$DB_STATE" = "nueva" \]; then\s+log[^\n]*\n\s+pnpm db:seed/);
    // Y ya no alcanza con que falte el archivo.
    expect(script).not.toMatch(/if \[ ! -f "\$SEED_MARKER" \]/);
  });

  it("aborta ante cualquier otro estado", () => {
    const branch = script.slice(script.indexOf('case "$DB_STATE"'), script.indexOf("pnpm db:migrate"));
    expect(branch).toContain("die ");
  });
});

describe("credenciales que no se inventan", () => {
  const script = readFileSync(resolve(ROOT, "scripts/deploy/setup-vps.sh"), "utf8");

  it("reutiliza la contraseña del admin que ya está en api/.env", () => {
    expect(script).toContain('ADMIN_PASS="${ADMIN_PASS:-$(env_value SEED_ADMIN_PASSWORD)}"');
  });

  it("no rota el JWT_SECRET ni la clave de la DB en cada corrida", () => {
    expect(script).toContain('JWT_SECRET="${JWT_SECRET:-$(env_value JWT_SECRET)}"');
    expect(script).toContain('DB_PASS="${DB_PASS:-$(env_value DB_PASS)}"');
  });

  it("sólo escribe el archivo de credenciales si el admin se sembró", () => {
    const write = script.indexOf('cat > "$CREDENTIALS_FILE"');
    const guard = script.lastIndexOf('if [ "$ADMIN_SEEDED" = "1" ]; then', write);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(write);
  });

  it("y avisa cuando la contraseña sigue siendo la anterior", () => {
    expect(script).toContain("el usuario admin no se tocó");
  });
});

describe("la guía manual de PM2 apunta al entry real", () => {
  const deploy = readFileSync(resolve(ROOT, "docs/DEPLOY.md"), "utf8");

  it("usa api/dist/src/index.js y --cwd", () => {
    expect(deploy).toContain("pm2 start api/dist/src/index.js");
    expect(deploy).toContain("--cwd /var/www/sanatorio/api");
    // El entry viejo no existe: `tsc` conserva la carpeta src/.
    expect(deploy).not.toContain("pm2 start api/dist/index.js");
  });

  it("el build realmente emite dist/src/index.js", () => {
    // `rootDir` incluye src/, así que el entry compilado queda un nivel adentro.
    const tsconfig = readFileSync(resolve(ROOT, "api/tsconfig.json"), "utf8");
    expect(tsconfig).toContain('"outDir": "dist"');
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "api/package.json"), "utf8"));
    expect(pkg.scripts.start).toBe("node dist/src/index.js");
  });
});
