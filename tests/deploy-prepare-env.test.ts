import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
 * Primero se mira la base; después se decide la credencial.
 *
 * `setup-vps.sh` generaba `ADMIN_PASS` y escribía `SEED_ADMIN_PASSWORD` en
 * `api/.env` **antes** de consultar el estado de la base. En una actualización
 * el seed no corre, así que esa contraseña no se aplicaba a ningún usuario:
 * quedaba anotada —en el `.env` y en `.deploy-credentials`— una credencial que
 * no abre nada, encima de la que sí servía.
 *
 * `scripts/deploy/prepare-env.sh` es esa lógica, extraída para poder correrla
 * de verdad: `setup-vps.sh` entero necesita root, apt y un VPS.
 *
 *   TEST_DATABASE=1 pnpm test tests/deploy-prepare-env.test.ts
 */

const ROOT = resolve(__dirname, "..");
const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_prepenv`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

interface Resultado {
  code: number;
  stdout: string;
  stderr: string;
}

function prepareEnv(appDir: string, extra: Record<string, string> = {}): Resultado {
  try {
    const stdout = execFileSync("bash", ["scripts/deploy/prepare-env.sh"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        APP_DIR: appDir,
        REPO_ROOT: ROOT,
        DB_HOST: baseConnection.host,
        DB_PORT: String(baseConnection.port),
        DB_USER: baseConnection.user,
        DB_PASS: baseConnection.password,
        DB_NAME,
        SEED_MARKER: join(appDir, ".seeded"),
        ADMIN_EMAIL: "admin@sanatorio.local",
        ADMIN_NAME: "Administrador",
        SITE_ORIGIN: "https://sanatorio.test",
        ADMIN_PASS: "",
        JWT_SECRET: "",
        ...extra,
      },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

/** Un `${APP_DIR}` de mentira, con la carpeta `api/` que espera el script. */
function nuevoAppDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "prepenv-"));
  mkdirSync(join(dir, "api"), { recursive: true });
  return dir;
}

const envFile = (appDir: string) => join(appDir, "api", ".env");
const envValue = (appDir: string, key: string): string | undefined => {
  if (!existsSync(envFile(appDir))) return undefined;
  const line = readFileSync(envFile(appDir), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1);
};

describeDb("prepare-env.sh sobre una base real", () => {
  let db: Knex;
  const creados: string[] = [];

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
  }, 120_000);

  afterEach(() => {
    for (const dir of creados.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  const appDir = () => {
    const dir = nuevoAppDir();
    creados.push(dir);
    return dir;
  };

  describe("instalación nueva", () => {
    it("genera la contraseña, porque el seed va a crear el usuario", () => {
      const dir = appDir();
      const res = prepareEnv(dir);

      expect(res.code, res.stderr).toBe(0);
      expect(res.stdout).toContain("DB_STATE=nueva");
      expect(res.stdout).toContain("WILL_SEED=1");
      expect(res.stdout).toContain("ADMIN_PASS_GENERATED=1");

      const pass = envValue(dir, "SEED_ADMIN_PASSWORD");
      expect(pass, "el .env tiene que traer la contraseña que va a sembrar").toBeTruthy();
      expect(pass!.length).toBeGreaterThanOrEqual(16);
      // Y la contraseña nunca sale por stdout: quedaría en el log del deploy.
      expect(res.stdout).not.toContain(pass!);
    });
  });

  describe("base con contenido y sin marker", () => {
    beforeAll(async () => {
      await migrateLatest(db);
      await runSeeds(db);
    }, 180_000);

    it("aborta sin escribir .env ni generar contraseña", () => {
      // El caso exacto: base existente, marker ausente, `.env` inexistente.
      const dir = appDir();
      expect(existsSync(envFile(dir))).toBe(false);

      const res = prepareEnv(dir);

      expect(res.code).toBe(3);
      expect(res.stderr).toContain("No se escribió api/.env");
      // Nada escrito: ni el archivo, ni una contraseña inventada.
      expect(existsSync(envFile(dir))).toBe(false);
      expect(existsSync(join(dir, ".deploy-credentials"))).toBe(false);
      expect(res.stdout).not.toContain("ADMIN_PASS_GENERATED=1");
    });

    it("con el marker es una actualización y NO inventa contraseña", () => {
      const dir = appDir();
      writeFileSync(join(dir, ".seeded"), "");

      const res = prepareEnv(dir);

      expect(res.code, res.stderr).toBe(0);
      expect(res.stdout).toContain("DB_STATE=actualizacion");
      expect(res.stdout).toContain("WILL_SEED=0");
      expect(res.stdout).toContain("ADMIN_PASS_GENERATED=0");

      // El .env se escribe —la API lo necesita para conectarse—, pero sin una
      // contraseña que no corresponde a ningún usuario.
      expect(existsSync(envFile(dir))).toBe(true);
      expect(envValue(dir, "SEED_ADMIN_PASSWORD")).toBeUndefined();
      expect(envValue(dir, "DB_NAME")).toBe(DB_NAME);
      // Y queda dicho por qué falta.
      expect(readFileSync(envFile(dir), "utf8")).toMatch(/no se define/i);
    });

    it("en una actualización conserva la contraseña que ya estaba", () => {
      const dir = appDir();
      writeFileSync(join(dir, ".seeded"), "");
      writeFileSync(
        envFile(dir),
        ["DB_PASS=clave-de-la-base", "JWT_SECRET=secreto-viejo", "SEED_ADMIN_PASSWORD=la-que-funciona"].join("\n"),
      );

      const res = prepareEnv(dir);

      expect(res.code, res.stderr).toBe(0);
      expect(res.stdout).toContain("ADMIN_PASS_GENERATED=0");
      // La contraseña del admin y el JWT sobreviven: rotarlos desloguearía a
      // todo el mundo y dejaría el panel inaccesible.
      expect(envValue(dir, "SEED_ADMIN_PASSWORD")).toBe("la-que-funciona");
      expect(envValue(dir, "JWT_SECRET")).toBe("secreto-viejo");
    });

    it("el .env queda sólo para root", () => {
      const dir = appDir();
      writeFileSync(join(dir, ".seeded"), "");
      prepareEnv(dir);
      const mode = execFileSync("stat", ["-c", "%a", envFile(dir)], { encoding: "utf8" }).trim();
      expect(mode).toBe("600");
    });
  });
});

describe("setup-vps.sh delega la decisión", () => {
  const script = readFileSync(resolve(ROOT, "scripts/deploy/setup-vps.sh"), "utf8");

  it("ya no genera la contraseña del admin por su cuenta", () => {
    // La generación vive en prepare-env.sh, después de mirar la base.
    expect(script).not.toMatch(/ADMIN_PASS="\$\{ADMIN_PASS:-\$\(openssl/);
    expect(script).not.toMatch(/^ADMIN_PASS=.*openssl/m);
  });

  it("escribe api/.env recién después de consultar el estado", () => {
    const prepare = script.indexOf("prepare-env.sh");
    expect(prepare).toBeGreaterThan(-1);
    // Y ya no hay un `cat > api/.env` suelto antes del guard.
    expect(script).not.toContain('cat > "${APP_DIR}/api/.env"');
  });

  it("aborta el deploy si prepare-env.sh falla", () => {
    const check = script.slice(script.indexOf("PREPARE_CODE"));
    expect(check).toMatch(/die /);
    expect(check).toContain("No se escribió ninguna credencial");
  });

  it("siembra según lo que respondió prepare-env.sh", () => {
    expect(script).toMatch(/if \[ "\$WILL_SEED" = "1" \]; then/);
  });
});
