import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `update-vps.sh` no hace rollback, y ahora lo dice antes de tocar nada.
 *
 * Aceptaba `ROLLBACK_TO` y lo resolvía con un `git reset --hard <sha-viejo>` en
 * el paso 1, **antes** de mirar la base. El resultado era exactamente el estado
 * que `rollback-vps.sh` existe para evitar: el árbol en la versión vieja y la
 * base en la nueva, con migraciones registradas en `knex_migrations` cuyo
 * archivo ya no está en disco. knex no las puede revertir —no encuentra el
 * `down()`— así que esa base ya no vuelve atrás con el procedimiento normal.
 *
 * Y el propio script cerraba el círculo: cuando el health check fallaba,
 * imprimía ese mismo comando como "Rollback:".
 *
 * Esto se prueba corriendo el script de verdad, no leyendo `docs/DEPLOY.md`:
 * la documentación puede decir lo correcto mientras el script sigue aceptando
 * la variable.
 */

const ROOT = resolve(__dirname, "..");
const SCRIPT = resolve(ROOT, "scripts/deploy/update-vps.sh");
const fuente = readFileSync(SCRIPT, "utf8");

interface Resultado {
  code: number;
  stdout: string;
  stderr: string;
}

function correr(appDir: string, env: Record<string, string> = {}): Resultado {
  try {
    const stdout = execFileSync("bash", [SCRIPT], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      env: { ...process.env, APP_DIR: appDir, ...env },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t.test", "-c", "user.name=Test", ...args], {
    encoding: "utf8",
  }).trim();

const creados: string[] = [];

/**
 * Un `${APP_DIR}` real: repo git con dos commits. El segundo agrega
 * `nuevo.txt`, así que si el script llegara a hacer `git reset --hard` al
 * primero, ese archivo desaparecería del árbol.
 */
function appDirConHistoria(): { dir: string; viejo: string; actual: string } {
  const dir = mkdtempSync(join(tmpdir(), "update-vps-"));
  creados.push(dir);
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "viejo.txt"), "versión anterior\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "versión anterior");
  const viejo = git(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, "nuevo.txt"), "versión desplegada\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "versión desplegada");
  return { dir, viejo, actual: git(dir, "rev-parse", "HEAD") };
}

afterEach(() => {
  for (const dir of creados.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("update-vps.sh rechaza ROLLBACK_TO", () => {
  it("aborta con código 2 y manda a rollback-vps.sh", () => {
    const { dir, viejo } = appDirConHistoria();

    const res = correr(dir, { ROLLBACK_TO: viejo });

    expect(res.code, `stderr: ${res.stderr}`).toBe(2);
    expect(res.stderr).toMatch(/no hace rollback/i);
    expect(res.stderr).toContain("rollback-vps.sh");
    // Y el comando que sugiere es ejecutable tal cual, con el SHA que se pidió.
    expect(res.stderr).toContain(`ROLLBACK_TO=${viejo} bash ${dir}/scripts/deploy/rollback-vps.sh`);
  });

  it("no toca el árbol: nada de git reset a esa versión", () => {
    const { dir, viejo, actual } = appDirConHistoria();

    const res = correr(dir, { ROLLBACK_TO: viejo });

    expect(res.code).toBe(2);
    // El HEAD sigue donde estaba…
    expect(git(dir, "rev-parse", "HEAD")).toBe(actual);
    // …y el archivo que sólo existe en la versión desplegada sigue en disco.
    expect(existsSync(join(dir, "nuevo.txt"))).toBe(true);
    // Ni siquiera se movió el índice o el working tree.
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  it("aborta antes de instalar, migrar o buildear", () => {
    const { dir, viejo } = appDirConHistoria();

    const res = correr(dir, { ROLLBACK_TO: viejo });

    // Los pasos se anuncian por stdout. Si alguno llegó a correr, el rechazo
    // no está donde tiene que estar.
    expect(res.stdout).not.toMatch(/1\/6/);
    expect(res.stdout).not.toMatch(/pnpm install/i);
    expect(res.stdout).not.toMatch(/Backup de la DB/i);
    expect(res.stderr).toMatch(/nada se modificó/i);
  });

  it("el rechazo es sólo para ROLLBACK_TO, no un abort permanente", () => {
    // Sin la variable el script sigue de largo y falla más adelante (el repo de
    // prueba no tiene remoto). Lo que importa es que no aborte por el rechazo.
    const { dir } = appDirConHistoria();

    const res = correr(dir);

    expect(res.code).not.toBe(0);
    expect(res.stderr).not.toMatch(/no hace rollback/i);
    // Llegó al paso 1: el rechazo no bloquea una actualización normal.
    expect(res.stdout).toMatch(/1\/6/);
  });

  it("una cadena vacía no cuenta como pedido de rollback", () => {
    const { dir } = appDirConHistoria();
    const res = correr(dir, { ROLLBACK_TO: "" });
    expect(res.stderr).not.toMatch(/no hace rollback/i);
  });
});

describe("el script ya no tiene el camino de rollback", () => {
  it("es bash válido", () => {
    execFileSync("bash", ["-n", SCRIPT], { stdio: "pipe" });
  });

  it("no queda ningún git reset a ROLLBACK_TO", () => {
    expect(fuente).not.toMatch(/git\s+reset\s+--hard\s+"?\$\{?ROLLBACK_TO/);
    // El único reset que queda es al HEAD del remoto: hacia adelante.
    const resets = fuente.match(/git\s+reset\s+--hard\s+\S+/g) ?? [];
    expect(resets).toEqual(['git reset --hard "origin/${BRANCH}"']);
  });

  it("el encabezado no propone usar este script para volver atrás", () => {
    const encabezado = fuente.slice(0, fuente.indexOf("set -euo pipefail"));
    expect(encabezado).not.toMatch(/ROLLBACK_TO=\S*\s+bash[^\n]*update-vps\.sh/);
    expect(encabezado).toContain("rollback-vps.sh");
  });

  it("ningún mensaje del script ofrece update-vps.sh como rollback", () => {
    // Una "oferta" es un comando copiable: `ROLLBACK_TO=… bash …update-vps.sh`,
    // o una etiqueta de rollback seguida de este mismo script. Nombrarlo para
    // decir que NO lo hace es otra cosa. Se mira línea por línea —encabezado,
    // implementación y mensajes de error—: alcanza con que quede una.
    const ofensivas = fuente
      .split("\n")
      .filter(
        (l) =>
          /ROLLBACK_TO=\S*\s+bash[^\n]*update-vps\.sh/.test(l) ||
          /rollback[^\n]*bash[^\n]*update-vps\.sh/i.test(l),
      );
    expect(ofensivas, ofensivas.join("\n")).toEqual([]);
  });

  it("el mensaje del health check en rojo apunta a rollback-vps.sh", () => {
    const bloque = fuente.slice(fuente.indexOf("Healthcheck devolvió"));
    expect(bloque).toContain("rollback-vps.sh");
    expect(bloque).not.toMatch(/Rollback:[^\n]*update-vps\.sh/);
  });

  it("la documentación tampoco lo ofrece", () => {
    const deploy = readFileSync(resolve(ROOT, "docs/DEPLOY.md"), "utf8");
    expect(deploy).not.toMatch(/ROLLBACK_TO=\S*\s+bash[^\n]*update-vps\.sh/);
    expect(deploy).toMatch(/aborta antes de tocar nada/i);
  });
});
