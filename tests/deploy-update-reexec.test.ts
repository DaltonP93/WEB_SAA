import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * La reejecución de `update-vps.sh` cuando el propio script cambia en el pull.
 *
 * El deploy hace `git reset --hard origin/main` en el paso 1, y ese reset puede
 * reescribir el mismo archivo que se está ejecutando. Había dos problemas
 * encadenados:
 *
 * 1. **La detección no detectaba nada.** Comparaba `sha256sum "$0"` contra
 *    `sha256sum "$SELF"` DESPUÉS del reset. En un deploy normal el script se
 *    invoca por su ruta en el repo, así que `$0` y `$SELF` son el MISMO archivo
 *    —ya actualizado por el reset—: los hashes daban iguales siempre y la
 *    reejecución no ocurría nunca. El deploy corría la versión vieja y el
 *    arreglo del script se aplicaba recién en el deploy siguiente. Es
 *    exactamente lo que `AGENTS.md` documentaba como "hay que deployar dos
 *    veces".
 *
 * 2. **bash lee el script por offset**, no lo carga entero. Con el archivo
 *    reescrito debajo, el intérprete seguía leyendo el contenido nuevo desde la
 *    posición vieja: lo que se ejecutaba a partir de ahí era una mezcla de las
 *    dos versiones.
 *
 * Acá se montan dos commits de verdad —el desplegado y el que trae el script
 * nuevo— y se ejecuta el script real contra un repo git real, con binarios
 * falsos para todo lo que toca el sistema.
 */

const ROOT = resolve(__dirname, "..");
const SCRIPT_REAL = readFileSync(resolve(ROOT, "scripts/deploy/update-vps.sh"), "utf8");

/** El marcador que sólo imprime la versión "nueva" del script. */
const MARCADOR = "MARCADOR_VERSION_NUEVA";
const ANCLA = 'log "2/6  pnpm install (congelado)"';

/**
 * La versión 2 del script: la real, más una línea que imprime el marcador
 * justo después del bloque de reejecución. Si el marcador aparece, es porque el
 * código que corrió después del pull es el del commit nuevo.
 */
function conMarcador(fuente: string): string {
  expect(fuente).toContain(ANCLA);
  return fuente.replace(ANCLA, `echo "${MARCADOR}"\n${ANCLA}`);
}

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t.test", "-c", "user.name=Test", ...args], {
    encoding: "utf8",
  }).trim();

function ejecutable(path: string, contenido: string) {
  writeFileSync(path, contenido);
  chmodSync(path, 0o755);
}

const creados: string[] = [];

interface Escenario {
  dir: string;
  bin: string;
  raiz: string;
}

/**
 * Monta `APP_DIR` como repo git con remoto.
 *
 * El commit 1 queda en el working tree (es "lo desplegado"); el commit 2 se
 * empuja al remoto, así que el `git reset --hard origin/main` del script lo
 * trae. `scriptV2` decide si el segundo commit cambia o no el propio script.
 */
function montar(scriptV2: string): Escenario {
  const raiz = mkdtempSync(join(tmpdir(), "reexec-"));
  creados.push(raiz);
  const dir = join(raiz, "app");
  const bin = join(raiz, "bin");
  mkdirSync(join(dir, "scripts", "deploy"), { recursive: true });
  mkdirSync(join(dir, "api"), { recursive: true });
  mkdirSync(bin, { recursive: true });

  git(dir, "init", "-q", "-b", "main");

  // Commit 1 — la versión desplegada: el script real, tal cual.
  writeFileSync(join(dir, "scripts", "deploy", "update-vps.sh"), SCRIPT_REAL);
  writeFileSync(join(dir, "api", ".gitkeep"), "");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "versión desplegada");

  const origen = join(raiz, "origen.git");
  execFileSync("git", ["init", "-q", "--bare", origen]);
  git(dir, "remote", "add", "origin", origen);
  git(dir, "push", "-q", "-u", "origin", "main");

  // Commit 2 — la versión que trae el pull. Se empuja al remoto y se deja el
  // working tree en el commit 1, que es el estado real de un servidor antes de
  // actualizar. El archivo suelto garantiza que el commit exista incluso cuando
  // `scriptV2` es idéntico al desplegado (el caso "el pull trae otra cosa").
  writeFileSync(join(dir, "scripts", "deploy", "update-vps.sh"), scriptV2);
  writeFileSync(join(dir, "otro-cambio.txt"), "cambio ajeno al script\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "versión nueva del script");
  git(dir, "push", "-q", "origin", "main");
  git(dir, "reset", "-q", "--hard", "HEAD~1");

  // api/.env no se versiona: el paso de backup lo lee del working tree.
  writeFileSync(
    join(dir, "api", ".env"),
    ["DB_NAME=sanatorio", "DB_USER=sanatorio", "DB_PASS=irrelevante-para-el-stub", "PUBLIC_SITE_URL=https://sanatorio.test", ""].join("\n"),
  );

  montarStubs(raiz, bin);
  return { dir, bin, raiz };
}

/** Binarios falsos para todo lo que el script toca fuera de git. */
function montarStubs(raiz: string, bin: string) {
  const log = JSON.stringify(join(raiz, "comandos.log"));
  for (const cmd of ["pnpm", "nginx", "systemctl", "pm2"]) {
    ejecutable(join(bin, cmd), `#!/usr/bin/env bash\necho "${cmd} $*" >> ${log}\nexit 0\n`);
  }
  ejecutable(join(bin, "mysqldump"), `#!/usr/bin/env bash\necho "-- dump falso"\nexit 0\n`);
  ejecutable(join(bin, "curl"), `#!/usr/bin/env bash\nprintf '%s' "200"\nexit 0\n`);
}

function correr(esc: Escenario, env: Record<string, string> = {}) {
  const res = spawnSync("bash", [join(esc.dir, "scripts", "deploy", "update-vps.sh")], {
    cwd: esc.dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    env: { ...process.env, PATH: `${esc.bin}:${process.env.PATH}`, APP_DIR: esc.dir, ...env },
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    timedOut: res.error?.message?.includes("ETIMEDOUT") ?? false,
  };
}

const contar = (texto: string, aguja: string) => texto.split(aguja).length - 1;

afterEach(() => {
  for (const dir of creados.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("el script nuevo se usa en el mismo deploy que lo trae", () => {
  it("reejecuta la versión nueva y corre su código, no el viejo", () => {
    const esc = montar(conMarcador(SCRIPT_REAL));

    const res = correr(esc);

    expect(res.code, `stderr: ${res.stderr}`).toBe(0);
    // Esto es lo que antes no pasaba: el arreglo del script se aplicaba recién
    // en el deploy siguiente.
    expect(res.stdout).toContain("el script cambió en este pull");
    expect(res.stdout, "el código de la versión nueva tiene que haber corrido").toContain(MARCADOR);
  }, 180_000);

  it("el árbol quedó en el commit nuevo y el deploy terminó", () => {
    const esc = montar(conMarcador(SCRIPT_REAL));

    const res = correr(esc);

    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Update OK");
    // El script del árbol es el del commit 2.
    expect(readFileSync(join(esc.dir, "scripts", "deploy", "update-vps.sh"), "utf8")).toContain(MARCADOR);
  }, 180_000);
});

describe("la reejecución es una sola: no hay bucle", () => {
  it("reejecuta exactamente una vez", () => {
    const esc = montar(conMarcador(SCRIPT_REAL));

    const res = correr(esc);

    expect(res.timedOut, "un bucle habría agotado el timeout").toBe(false);
    expect(res.code).toBe(0);
    expect(contar(res.stdout, "el script cambió en este pull")).toBe(1);
    // El marcador lo imprime sólo la versión nueva, y esa corre una vez.
    expect(contar(res.stdout, MARCADOR)).toBe(1);
  }, 180_000);

  it("la guarda viaja al proceso reejecutado", () => {
    // Aunque el proceso nuevo vuelva a comparar, `DEPLOY_REEXEC=1` le impide
    // reejecutar de nuevo. Sin esa guarda, dos versiones que siguieran
    // difiriendo se llamarían entre sí para siempre.
    expect(SCRIPT_REAL).toMatch(/DEPLOY_REEXEC=1 DEPLOY_SELF_COPY= exec bash "\$SELF"/);
    expect(SCRIPT_REAL).toMatch(/\[ "\$\{DEPLOY_REEXEC:-0\}" != "1" \]/);
  });

  it("si el script no cambió, no reejecuta", () => {
    // El commit 2 toca otra cosa, no el script. Reejecutar acá sería duplicar
    // el deploy entero sin motivo.
    const esc = montar(SCRIPT_REAL);

    const res = correr(esc);

    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).not.toContain("el script cambió en este pull");
    expect(res.stdout).toContain("Update OK");
  }, 180_000);
});

describe("el script corre desde una copia, no desde el archivo que el reset reescribe", () => {
  it("se ejecuta desde la copia y la limpia al terminar", () => {
    const esc = montar(SCRIPT_REAL);
    const antes = readdirSync(tmpdir()).filter((f) => f.startsWith("update-vps-"));

    const res = correr(esc);

    expect(res.code, res.stderr).toBe(0);
    const despues = readdirSync(tmpdir()).filter((f) => f.startsWith("update-vps-"));
    expect(despues, "la copia temporal no puede quedar colgada").toEqual(antes);
  }, 180_000);

  it("la copia se toma antes del reset, que es lo que hace útil la comparación", () => {
    // El orden importa: si la copia se sacara después del `git reset`, volvería
    // a compararse el archivo nuevo contra sí mismo.
    const copia = SCRIPT_REAL.indexOf('cat "$0" > "$DEPLOY_SELF_COPY"');
    const reset = SCRIPT_REAL.indexOf('git reset --hard "origin/${BRANCH}"');
    const comparacion = SCRIPT_REAL.indexOf('HASH_EN_USO="$(sha256sum "$DEPLOY_SELF_COPY"');
    expect(copia).toBeGreaterThan(-1);
    expect(copia).toBeLessThan(reset);
    expect(reset).toBeLessThan(comparacion);
    // Y ya no se compara `$0` contra `$SELF`, que era la comparación vacía.
    // Se miran sólo las líneas de código: el comentario que explica el bug
    // viejo sí nombra esa comparación, a propósito.
    const codigo = SCRIPT_REAL.split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(codigo).not.toMatch(/sha256sum "\$0"/);
  });
});

describe("el rechazo de ROLLBACK_TO sigue antes de todo", () => {
  it("no llega a sacar copia ni a tocar el repo", () => {
    // La copia se hace después del rechazo: pedir un rollback no puede dejar
    // archivos temporales ni mover el árbol.
    const esc = montar(SCRIPT_REAL);
    const antes = git(esc.dir, "rev-parse", "HEAD");

    const res = correr(esc, { ROLLBACK_TO: antes });

    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/no hace rollback/i);
    expect(git(esc.dir, "rev-parse", "HEAD")).toBe(antes);
    expect(existsSync(join(esc.raiz, "comandos.log"))).toBe(false);
  }, 180_000);
});
