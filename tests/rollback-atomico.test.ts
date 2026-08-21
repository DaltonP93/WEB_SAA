import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import { DB_TESTS_ENABLED, baseConnection, createTestDatabase, dropTestDatabase } from "./helpers/db";

/**
 * Revertir la base es el punto sin retorno del rollback.
 *
 * Después de `rollback-db.sh` (o de `RESTORE_DUMP`) la base ya es la vieja y la
 * aplicación que está corriendo sigue siendo la nueva. Si a partir de ahí
 * fallaba el checkout, el `pnpm install --frozen-lockfile`, alguno de los tres
 * builds, `nginx -t` o el restart de PM2, el script salía con un error genérico
 * y dejaba el servidor exactamente en ese estado mezclado: base vieja,
 * aplicación nueva, nadie avisado.
 *
 * Las dos defensas se prueban acá ejecutando `rollback-vps.sh` de verdad:
 *
 *   · la PREVALIDACIÓN en un `git worktree` aparte, que mueve casi todos esos
 *     fallos a antes de tocar la base;
 *   · y la RECUPERACIÓN, que restaura el backup, vuelve a CURRENT_SHA,
 *     reconstruye y reinicia cuando algo falla igual.
 *
 * Y de paso el camino del dump: `gzip -t` antes de abrir la base.
 *
 * El montaje es un `APP_DIR` real —repo git con dos commits y su propio
 * remoto— más binarios falsos en el PATH (`pnpm`, `nginx`, `systemctl`, `pm2`,
 * `curl`) que se pueden hacer fallar donde se quiera. La base es una MySQL de
 * verdad: cada caso comprueba las tres cosas a la vez —árbol, base y proceso
 * final—, que es justamente lo que no se puede ver buscando strings.
 *
 *   TEST_DATABASE=1 pnpm test tests/rollback-atomico.test.ts
 */

const ROOT = resolve(__dirname, "..");
const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_atomico`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;
const SCRIPT = resolve(ROOT, "scripts/deploy/rollback-vps.sh");

interface Resultado {
  code: number;
  stdout: string;
  stderr: string;
}

interface Escenario {
  /** El APP_DIR: repo git con la versión "desplegada" en HEAD. */
  dir: string;
  /** SHA de la versión anterior (a la que se vuelve). */
  anterior: string;
  /** SHA de la versión desplegada (la actual). */
  actual: string;
  /** Directorio de los binarios falsos. */
  bin: string;
  /** Raíz temporal del escenario. */
  raiz: string;
}

/**
 * `git` del escenario, con el stderr adentro del error.
 *
 * Antes esto era `execFileSync`, que al fallar lanza `Command failed: git -C
 * /tmp/… commit -qm …` y **descarta el stderr**. Una corrida completa de la
 * suite dio exactamente ese mensaje y no había forma de saber por qué: si el
 * repo estaba mal, si faltaba disco, o si el contenedor no pudo crear otro
 * proceso. Diagnosticar un fallo que sólo aparece bajo carga con el motivo
 * borrado es imposible, y "es intermitente" no es un diagnóstico.
 */
const git = (dir: string, ...args: string[]) => {
  const todos = ["-C", dir, "-c", "user.email=t@t.test", "-c", "user.name=Test", ...args];
  const r = spawnSync("git", todos, { encoding: "utf8" });
  if (r.error) throw new Error(`git ${args.join(" ")} no se pudo ejecutar: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} salió ${r.status}\nstderr: ${r.stderr}\nstdout: ${r.stdout}`);
  }
  return r.stdout.trim();
};

function ejecutable(path: string, contenido: string) {
  writeFileSync(path, contenido);
  chmodSync(path, 0o755);
}

const creados: string[] = [];

/**
 * Monta el escenario completo.
 *
 * Dos commits: el anterior deja `marca.txt = anterior`; el desplegado lo
 * cambia a `desplegada` y agrega `solo-nuevo.txt`. Así el árbol dice por sí
 * mismo en qué versión quedó, y el stub de PM2 puede registrar con qué versión
 * arrancó la aplicación.
 */
function montar(): Escenario {
  const raiz = mkdtempSync(join(tmpdir(), "rbatomico-"));
  creados.push(raiz);
  const dir = join(raiz, "app");
  const bin = join(raiz, "bin");
  mkdirSync(dir, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(dir, "scripts", "deploy"), { recursive: true });
  mkdirSync(join(dir, "api"), { recursive: true });

  git(dir, "init", "-q", "-b", "main");

  // El stub de rollback-db.sh: revierte "la base" borrando las filas que la
  // versión nueva agregó, y deja constancia de que corrió.
  ejecutable(
    join(dir, "scripts", "deploy", "rollback-db.sh"),
    `#!/usr/bin/env bash
set -e
echo "corrio" >> ${JSON.stringify(join(raiz, "rollback-db.log"))}
cd "$(dirname "$0")/../.."
V() { sed -n "s/^\$1=//p" api/.env | head -n1; }
MYSQL_PWD="$(V DB_PASS)" mysql -h"$(V DB_HOST)" -P"$(V DB_PORT)" -u"$(V DB_USER)" "$(V DB_NAME)" \\
  -e "DELETE FROM marcador WHERE etapa = 'nueva'"
`,
  );
  writeFileSync(join(dir, "api", ".gitkeep"), "");
  writeFileSync(join(dir, "marca.txt"), "anterior\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "versión anterior");
  const anterior = git(dir, "rev-parse", "HEAD");

  writeFileSync(join(dir, "marca.txt"), "desplegada\n");
  writeFileSync(join(dir, "solo-nuevo.txt"), "esto sólo existe en la versión nueva\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "versión desplegada");
  const actual = git(dir, "rev-parse", "HEAD");

  // `git fetch origin --tags` necesita un remoto real.
  const origen = join(raiz, "origen.git");
  execFileSync("git", ["init", "-q", "--bare", origen]);
  git(dir, "remote", "add", "origin", origen);
  git(dir, "push", "-q", "-u", "origin", "main");

  // api/.env no se versiona: queda en el working tree y sobrevive al reset.
  writeFileSync(
    join(dir, "api", ".env"),
    [
      `DB_HOST=${baseConnection.host}`,
      `DB_PORT=${baseConnection.port}`,
      `DB_USER=${baseConnection.user}`,
      `DB_PASS=${baseConnection.password}`,
      `DB_NAME=${DB_NAME}`,
      "PUBLIC_SITE_URL=https://sanatorio.test",
      "",
    ].join("\n"),
  );

  montarStubs(raiz, dir, bin);
  return { dir, anterior, actual, bin, raiz };
}

/**
 * Binarios falsos.
 *
 * `pnpm` falla cuando coincide el patrón `FALLAR_CMD`, en el ámbito
 * `FALLAR_AMBITO` (`app` = APP_DIR, `worktree` = el de prevalidación) y en la
 * enésima coincidencia `FALLAR_NRO` (0 = todas). Contar coincidencias es lo que
 * permite hacer fallar el build del paso 5 dejando pasar el de la recuperación.
 */
function montarStubs(raiz: string, appDir: string, bin: string) {
  const log = (n: string) => JSON.stringify(join(raiz, n));

  ejecutable(
    join(bin, "pnpm"),
    `#!/usr/bin/env bash
echo "cwd=$PWD :: pnpm $*" >> ${log("pnpm.log")}
patron="\${FALLAR_CMD:-}"
if [ -n "$patron" ] && [[ "$*" == *"$patron"* ]]; then
  ambito="\${FALLAR_AMBITO:-app}"
  en_app=no; [ "$PWD" = ${JSON.stringify(appDir)} ] && en_app=si
  coincide=no
  [ "$ambito" = "app" ] && [ "$en_app" = "si" ] && coincide=si
  [ "$ambito" = "worktree" ] && [ "$en_app" = "no" ] && coincide=si
  if [ "$coincide" = "si" ]; then
    n=$(cat ${log("pnpm.contador")} 2>/dev/null || echo 0); n=$((n + 1))
    echo "$n" > ${log("pnpm.contador")}
    if [ "\${FALLAR_NRO:-1}" = "0" ] || [ "$n" = "\${FALLAR_NRO:-1}" ]; then
      echo "pnpm falso: fallo forzado en 'pnpm $*' (cwd=$PWD, coincidencia $n)" >&2
      exit 1
    fi
  fi
fi
exit 0
`,
  );

  ejecutable(
    join(bin, "nginx"),
    `#!/usr/bin/env bash
echo "nginx $*" >> ${log("servicio.log")}
[ "\${FALLAR_NGINX:-0}" = "1" ] && { echo "nginx falso: configuración inválida" >&2; exit 1; }
exit 0
`,
  );
  ejecutable(join(bin, "systemctl"), `#!/usr/bin/env bash\necho "systemctl $*" >> ${log("servicio.log")}\nexit 0\n`);

  // Registra con qué versión del árbol arrancó: es el "proceso final".
  ejecutable(
    join(bin, "pm2"),
    `#!/usr/bin/env bash
if [ "$1" = "start" ]; then
  n=$(cat ${log("pm2.contador")} 2>/dev/null || echo 0); n=$((n + 1))
  echo "$n" > ${log("pm2.contador")}
  if [ -n "\${FALLAR_PM2_NRO:-}" ] && { [ "\${FALLAR_PM2_NRO}" = "0" ] || [ "$n" = "\${FALLAR_PM2_NRO}" ]; }; then
    echo "pm2 falso: fallo forzado en start #$n" >&2
    exit 1
  fi
  echo "start marca=$(cat ${JSON.stringify(join(appDir, "marca.txt"))} 2>/dev/null | tr -d '\\n')" >> ${log("pm2.log")}
else
  echo "pm2 $*" >> ${log("servicio.log")}
fi
exit 0
`,
  );

  ejecutable(
    join(bin, "curl"),
    `#!/usr/bin/env bash\nprintf '%s' "\${HEALTH_FALSO:-200}"\nexit 0\n`,
  );
}

function correr(esc: Escenario, env: Record<string, string> = {}): Resultado {
  // `spawnSync` y no `execFileSync`: hace falta el stderr también cuando el
  // script termina bien (los avisos van por ahí).
  const res = spawnSync("bash", [SCRIPT], {
    cwd: esc.dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
    env: {
      ...process.env,
      PATH: `${esc.bin}:${process.env.PATH}`,
      APP_DIR: esc.dir,
      ROLLBACK_TO: esc.anterior,
      ...env,
    },
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const leer = (esc: Escenario, n: string) =>
  existsSync(join(esc.raiz, n)) ? readFileSync(join(esc.raiz, n), "utf8") : "";

/** En qué versión quedó el árbol, mirando el archivo y el SHA. */
function arbol(esc: Escenario) {
  return {
    sha: git(esc.dir, "rev-parse", "HEAD"),
    marca: readFileSync(join(esc.dir, "marca.txt"), "utf8").trim(),
    tieneArchivoNuevo: existsSync(join(esc.dir, "solo-nuevo.txt")),
  };
}

describeDb("un fallo posterior a revertir la base no deja el servidor mezclado", () => {
  let db: Knex;

  /** Filas que "agregó la versión nueva": el stub de rollback-db.sh las borra. */
  const reiniciarBase = async () => {
    await db.schema.dropTableIfExists("marcador");
    await db.schema.createTable("marcador", (t) => {
      t.increments("id");
      t.string("etapa");
    });
    await db("marcador").insert([{ etapa: "vieja" }, { etapa: "nueva" }, { etapa: "nueva" }]);
  };

  const etapas = async () => ((await db("marcador").pluck("etapa")) as string[]).sort();

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
  }, 120_000);

  beforeEach(reiniciarBase, 60_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  afterEach(() => {
    for (const dir of creados.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("camino feliz: árbol, base y proceso quedan en la versión anterior", async () => {
    const esc = montar();

    const res = correr(esc);

    expect(res.code, res.stderr).toBe(0);
    expect(arbol(esc)).toEqual({ sha: esc.anterior, marca: "anterior", tieneArchivoNuevo: false });
    expect(await etapas()).toEqual(["vieja"]);
    expect(leer(esc, "pm2.log").trim()).toBe("start marca=anterior");
  }, 180_000);

  it("si falla el install del paso 5, vuelve todo a la versión desplegada", async () => {
    // Coincidencias de `pnpm install` dentro de APP_DIR: la 1 es la del paso 3
    // (antes de revertir la base), la 2 la del paso 5 y la 3 la de la
    // recuperación. Se hace fallar la 2: la base ya está revertida.
    const esc = montar();

    const res = correr(esc, { FALLAR_CMD: "install", FALLAR_AMBITO: "app", FALLAR_NRO: "2" });

    expect(res.code).toBe(7);
    expect(res.stderr).toContain("ESTADO ANTERIOR RECUPERADO");
    // La base se revirtió y volvió.
    expect(leer(esc, "rollback-db.log").trim()).toBe("corrio");
    expect(await etapas()).toEqual(["nueva", "nueva", "vieja"]);
    // El árbol volvió a la versión desplegada, con su archivo propio.
    expect(arbol(esc)).toEqual({ sha: esc.actual, marca: "desplegada", tieneArchivoNuevo: true });
    // Y la aplicación quedó corriendo esa misma versión.
    expect(leer(esc, "pm2.log").trim()).toBe("start marca=desplegada");
  }, 180_000);

  it("si falla un build del paso 5, también", async () => {
    const esc = montar();

    const res = correr(esc, { FALLAR_CMD: "@sa/api build", FALLAR_AMBITO: "app", FALLAR_NRO: "1" });

    expect(res.code).toBe(7);
    expect(res.stderr).toContain("ESTADO ANTERIOR RECUPERADO");
    expect(await etapas()).toEqual(["nueva", "nueva", "vieja"]);
    expect(arbol(esc)).toEqual({ sha: esc.actual, marca: "desplegada", tieneArchivoNuevo: true });
    expect(leer(esc, "pm2.log").trim()).toBe("start marca=desplegada");
  }, 180_000);

  it("si falla el restart de PM2, también", async () => {
    // El primer `pm2 start` es el del paso 6; el segundo, el de la
    // recuperación, tiene que funcionar.
    const esc = montar();

    const res = correr(esc, { FALLAR_PM2_NRO: "1" });

    expect(res.code).toBe(7);
    expect(res.stderr).toContain("ESTADO ANTERIOR RECUPERADO");
    expect(await etapas()).toEqual(["nueva", "nueva", "vieja"]);
    expect(arbol(esc)).toEqual({ sha: esc.actual, marca: "desplegada", tieneArchivoNuevo: true });
    // Arrancó una sola vez y con la versión desplegada.
    expect(leer(esc, "pm2.log").trim()).toBe("start marca=desplegada");
  }, 180_000);

  it("si falla nginx, también", async () => {
    const esc = montar();

    const res = correr(esc, { FALLAR_NGINX: "1" });

    // nginx falla también durante la recuperación: ahí la recuperación queda
    // incompleta y el código lo dice.
    expect(res.code).toBe(8);
    expect(res.stderr).toContain("RECUPERACIÓN INCOMPLETA");
    // Pero lo que sí se pudo recuperar, se recuperó: base y árbol.
    expect(await etapas()).toEqual(["nueva", "nueva", "vieja"]);
    expect(arbol(esc)).toEqual({ sha: esc.actual, marca: "desplegada", tieneArchivoNuevo: true });
    expect(res.stderr).toMatch(/base:\s+restaurada/);
    expect(res.stderr).toMatch(/servicio:\s+NO se pudo reiniciar/);
  }, 180_000);

  it("si la recuperación tampoco puede reconstruir, sale 8 y detalla qué quedó mal", async () => {
    // `FALLAR_NRO=0`: todas las coincidencias fallan, también la del paso de
    // recuperación. No se puede decir que quedó todo bien, y no se dice.
    const esc = montar();

    const res = correr(esc, { FALLAR_CMD: "@sa/api build", FALLAR_AMBITO: "app", FALLAR_NRO: "0" });

    expect(res.code).toBe(8);
    expect(res.stderr).toContain("RECUPERACIÓN INCOMPLETA");
    expect(res.stderr).toMatch(/builds:\s+FALLARON/);
    expect(res.stderr).toMatch(/No levantes la aplicación/i);
    // La base sí volvió, y el árbol también: se informa lo que es cierto.
    expect(await etapas()).toEqual(["nueva", "nueva", "vieja"]);
    expect(arbol(esc)).toEqual({ sha: esc.actual, marca: "desplegada", tieneArchivoNuevo: true });
  }, 180_000);
});

describeDb("la prevalidación mueve los fallos a antes de tocar la base", () => {
  let db: Knex;
  const DB_PREV = `${DB_NAME}_prev`;

  beforeAll(async () => {
    db = await createTestDatabase(DB_PREV);
  }, 120_000);

  beforeEach(async () => {
    await db.schema.dropTableIfExists("marcador");
    await db.schema.createTable("marcador", (t) => {
      t.increments("id");
      t.string("etapa");
    });
    await db("marcador").insert([{ etapa: "vieja" }, { etapa: "nueva" }]);
  }, 60_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_PREV);
  });

  afterEach(() => {
    for (const dir of creados.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const montarPrev = () => {
    const esc = montar();
    // Apuntar el escenario a la base de este bloque.
    const env = join(esc.dir, "api", ".env");
    writeFileSync(env, readFileSync(env, "utf8").replace(`DB_NAME=${DB_NAME}`, `DB_NAME=${DB_PREV}`));
    return esc;
  };

  it("una versión destino que no compila se detecta con todo intacto", async () => {
    const esc = montarPrev();

    const res = correr(esc, { FALLAR_CMD: "@sa/api build", FALLAR_AMBITO: "worktree", FALLAR_NRO: "1" });

    expect(res.code).toBe(2);
    expect(res.stderr).toContain("LA VERSIÓN DESTINO NO PASÓ LA PREVALIDACIÓN");
    expect(res.stderr).toContain("NO se tocó la base ni el árbol");
    // Nada se movió: ni la base, ni el árbol, ni el servicio.
    expect(((await db("marcador").pluck("etapa")) as string[]).sort()).toEqual(["nueva", "vieja"]);
    expect(arbol(esc)).toEqual({ sha: esc.actual, marca: "desplegada", tieneArchivoNuevo: true });
    expect(leer(esc, "rollback-db.log")).toBe("");
    expect(leer(esc, "pm2.log")).toBe("");
  }, 180_000);

  it("un install que no congela tampoco llega a la base", async () => {
    const esc = montarPrev();

    const res = correr(esc, { FALLAR_CMD: "install", FALLAR_AMBITO: "worktree", FALLAR_NRO: "1" });

    expect(res.code).toBe(2);
    expect(leer(esc, "rollback-db.log")).toBe("");
    expect(arbol(esc).sha).toBe(esc.actual);
  }, 180_000);

  it("no deja el worktree de prevalidación colgado", async () => {
    const esc = montarPrev();

    correr(esc, { FALLAR_CMD: "@sa/api build", FALLAR_AMBITO: "worktree", FALLAR_NRO: "1" });

    // `git worktree list` sólo tiene que mostrar el principal.
    const lista = git(esc.dir, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((l) => l.startsWith("worktree "));
    expect(lista).toHaveLength(1);
    expect(lista[0]).toContain(esc.dir);
  }, 180_000);

  it("la prevalidación compila la versión DESTINO, no la actual", async () => {
    const esc = montarPrev();

    correr(esc);

    // El worktree se creó fuera de APP_DIR y ahí corrieron install y los tres
    // builds antes de cualquier mysqldump.
    const lineas = leer(esc, "pnpm.log").trim().split("\n");
    const enWorktree = lineas.filter((l) => !l.startsWith(`cwd=${esc.dir} `));
    expect(enWorktree.some((l) => l.includes("install --frozen-lockfile"))).toBe(true);
    expect(enWorktree.some((l) => l.includes("@sa/api build"))).toBe(true);
    expect(enWorktree.some((l) => l.includes("@sa/web build"))).toBe(true);
    expect(enWorktree.some((l) => l.includes("@sa/admin"))).toBe(true);
    // Y fueron las primeras: antes de tocar la base.
    expect(lineas.indexOf(enWorktree[0])).toBe(0);
  }, 180_000);

  it("con SKIP_PREVALIDACION=1 se avisa y se sigue", async () => {
    const esc = montarPrev();

    const res = correr(esc, { SKIP_PREVALIDACION: "1" });

    expect(res.code, res.stderr).toBe(0);
    expect(res.stderr).toMatch(/no se prevalida/i);
    // Sin prevalidación, todo pnpm corre dentro de APP_DIR: no hubo worktree.
    const lineas = leer(esc, "pnpm.log").trim().split("\n").filter(Boolean);
    expect(lineas.length).toBeGreaterThan(0);
    expect(lineas.every((l) => l.startsWith(`cwd=${esc.dir} `))).toBe(true);
  }, 180_000);
});

describeDb("el dump se verifica antes de abrir la base", () => {
  let db: Knex;
  const DB_DUMP = `${DB_NAME}_dump`;

  beforeAll(async () => {
    db = await createTestDatabase(DB_DUMP);
  }, 120_000);

  beforeEach(async () => {
    await db.schema.dropTableIfExists("marcador");
    await db.schema.createTable("marcador", (t) => {
      t.increments("id");
      t.string("etapa");
    });
    await db("marcador").insert([{ etapa: "vieja" }, { etapa: "nueva" }]);
  }, 60_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_DUMP);
  });

  afterEach(() => {
    for (const dir of creados.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const montarDump = () => {
    const esc = montar();
    const env = join(esc.dir, "api", ".env");
    writeFileSync(env, readFileSync(env, "utf8").replace(`DB_NAME=${DB_NAME}`, `DB_NAME=${DB_DUMP}`));
    return esc;
  };

  /** Un dump real de la base tal como está ahora. */
  const dumpReal = (esc: Escenario) => {
    const destino = join(esc.raiz, "dump.sql.gz");
    execFileSync("bash", [
      "-c",
      `MYSQL_PWD='${baseConnection.password}' mysqldump -h${baseConnection.host} -P${baseConnection.port} ` +
        `-u${baseConnection.user} ${DB_DUMP} | gzip > ${JSON.stringify(destino)}`,
    ]);
    return destino;
  };

  const etapas = async () => ((await db("marcador").pluck("etapa")) as string[]).sort();

  it("un .sql.gz corrupto aborta antes del git reset y deja el deploy en pie", async () => {
    const esc = montarDump();
    const roto = join(esc.raiz, "roto.sql.gz");
    writeFileSync(roto, "esto no es un gzip, es texto plano");

    const res = correr(esc, { RESTORE_DUMP: roto });

    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/corrupto o truncado/i);
    expect(res.stderr).toContain("gzip -t");
    expect(res.stderr).toMatch(/No se tocó nada/i);
    // Base intacta, árbol intacto, servicio sin tocar.
    expect(await etapas()).toEqual(["nueva", "vieja"]);
    expect(arbol(esc)).toEqual({ sha: esc.actual, marca: "desplegada", tieneArchivoNuevo: true });
    expect(leer(esc, "pm2.log")).toBe("");
    expect(leer(esc, "pnpm.log")).toBe("");
  }, 180_000);

  it("un dump truncado a la mitad también", async () => {
    // El caso real: la copia se cortó por disco lleno o por una transferencia
    // interrumpida. El archivo empieza como un gzip válido, así que sólo se
    // detecta descomprimiéndolo entero.
    const esc = montarDump();
    const dump = dumpReal(esc);
    const tamaño = readFileSync(dump).length;
    expect(tamaño).toBeGreaterThan(200);
    truncateSync(dump, Math.floor(tamaño / 2));

    const res = correr(esc, { RESTORE_DUMP: dump });

    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/corrupto o truncado/i);
    expect(await etapas()).toEqual(["nueva", "vieja"]);
    expect(arbol(esc).sha).toBe(esc.actual);
    expect(leer(esc, "pm2.log")).toBe("");
  }, 180_000);

  it("un dump que no existe se rechaza igual", async () => {
    const esc = montarDump();

    const res = correr(esc, { RESTORE_DUMP: join(esc.raiz, "no-existe.sql.gz") });

    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/no existe el dump/i);
    expect(arbol(esc).sha).toBe(esc.actual);
  }, 180_000);

  it("si mysql corta a mitad de la restauración, vuelve el backup del paso 2", async () => {
    // `gzip -t` sólo garantiza que el archivo se puede descomprimir. Un dump
    // que se descomprime bien y contiene SQL inválido pasa esa comprobación y
    // rompe con la base ya abierta: ahí puede quedar parte aplicada. Para eso
    // está el backup que el paso 2 tomó y verificó.
    const esc = montarDump();
    const malo = join(esc.raiz, "sql-invalido.sql.gz");
    execFileSync("bash", [
      "-c",
      `printf '%s\\n' "ESTO NO ES SQL;" | gzip > ${JSON.stringify(malo)}`,
    ]);
    // Se descomprime sin problemas: el problema aparece recién en mysql.
    execFileSync("gzip", ["-t", malo]);

    const res = correr(esc, { RESTORE_DUMP: malo });

    expect(res.code).toBe(4);
    expect(res.stderr).toMatch(/se restauró el backup/i);
    expect(res.stderr).toMatch(/código NO se bajó/);
    // Base como estaba, árbol como estaba, aplicación sin reiniciar.
    expect(await etapas()).toEqual(["nueva", "vieja"]);
    expect(arbol(esc)).toEqual({ sha: esc.actual, marca: "desplegada", tieneArchivoNuevo: true });
    expect(leer(esc, "pm2.log")).toBe("");
  }, 180_000);

  it("un dump válido sí restaura y el rollback termina", async () => {
    // El fail-closed no puede volverse un freno permanente.
    const esc = montarDump();
    const dump = dumpReal(esc);
    // Después del dump la base cambia: la restauración tiene que revertirlo.
    await db("marcador").insert({ etapa: "posterior-al-dump" });

    const res = correr(esc, { RESTORE_DUMP: dump });

    expect(res.code, res.stderr).toBe(0);
    expect(await etapas()).toEqual(["nueva", "vieja"]);
    expect(arbol(esc)).toEqual({ sha: esc.anterior, marca: "anterior", tieneArchivoNuevo: false });
    expect(leer(esc, "pm2.log").trim()).toBe("start marca=anterior");
    // Por el camino del dump no se llama a rollback-db.sh.
    expect(leer(esc, "rollback-db.log")).toBe("");
  }, 180_000);
});
