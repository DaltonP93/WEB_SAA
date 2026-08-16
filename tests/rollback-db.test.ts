import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  baseConnection,
  createTestDatabase,
  dropTestDatabase,
  migrateUpOne,
  migrationSource,
  pendingMigrations,
} from "./helpers/db";

/**
 * Cuánto revertir, y qué pasa cuando algo falla en el medio.
 *
 * `rollback-vps.sh` contaba archivos del repo:
 *
 *     git diff --name-only --diff-filter=A "$ROLLBACK_TO" HEAD -- api/migrations
 *
 * Eso es "lo que el código agregó", no "lo que la base aplicó". Cuando un
 * deploy queda a medias —dos migraciones nuevas, una sola aplicada— los dos
 * números difieren, y el rollback revierte una de más: justamente una que el
 * SHA destino sí tiene.
 *
 * Y si un `down()` intermedio fallaba, el mensaje decía "la base quedó como
 * estaba". No: quedaba a mitad de camino.
 *
 * Acá se corre la lógica real —`migrations-to-revert.mjs` y `rollback-db.sh`—
 * contra una base MySQL de verdad, con dos árboles temporales que representan
 * la versión nueva y la anterior.
 *
 *   TEST_DATABASE=1 pnpm test tests/rollback-db.test.ts
 */

const ROOT = resolve(__dirname, "..");
const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_rbdb`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const dbEnv = {
  DB_HOST: baseConnection.host,
  DB_PORT: String(baseConnection.port),
  DB_USER: baseConnection.user,
  DB_PASS: baseConnection.password,
  DB_NAME,
};

interface Resultado {
  code: number;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], env: Record<string, string> = {}): Resultado {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...dbEnv, ...env },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

/**
 * Un "árbol destino": un directorio con los archivos de migración que tenía la
 * versión anterior. Es lo que el deploy obtiene con `git ls-tree <sha>`.
 */
function arbolDestino(nombres: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "arbol-"));
  mkdirSync(join(dir, "migrations"), { recursive: true });
  for (const nombre of nombres) writeFileSync(join(dir, "migrations", nombre), "// copia del árbol destino\n");
  return join(dir, "migrations");
}

describeDb("qué revertir sale de knex_migrations", () => {
  let db: Knex;
  let todas: string[] = [];
  const temporales: string[] = [];

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    todas = await migrationSource.getMigrations();
  }, 120_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
    for (const dir of temporales) rmSync(dir, { recursive: true, force: true });
  });

  const destino = (nombres: string[]) => {
    const dir = arbolDestino(nombres);
    temporales.push(dir);
    return dir;
  };

  it("con la base al día devuelve exactamente las que faltan en el destino", async () => {
    await db.migrate.latest({ migrationSource });
    // La versión anterior no tenía las dos últimas.
    const dir = destino(todas.slice(0, -2));

    const res = run("node", ["scripts/deploy/migrations-to-revert.mjs"], { DEST_MIGRATIONS_DIR: dir });

    expect(res.code, res.stderr).toBe(0);
    // De la más nueva a la más vieja: las migraciones dependen de las previas.
    expect(res.stdout.trim().split("\n")).toEqual([todas[todas.length - 1], todas[todas.length - 2]]);
  }, 180_000);

  it("un deploy interrumpido revierte sólo lo que llegó a aplicarse", async () => {
    // El escenario del enunciado: la versión nueva agrega dos migraciones y
    // sólo la primera alcanzó a correr.
    await db.migrate.down({ migrationSource });
    const aplicadas = (await db("knex_migrations").pluck("name")) as string[];
    expect(aplicadas).toContain(todas[todas.length - 2]);
    expect(aplicadas).not.toContain(todas[todas.length - 1]);

    const dir = destino(todas.slice(0, -2));
    const res = run("node", ["scripts/deploy/migrations-to-revert.mjs"], { DEST_MIGRATIONS_DIR: dir });

    // Exactamente un `down()`. Contando archivos habrían salido dos, y la de
    // más habría bajado una migración que el SHA destino sí tiene.
    expect(res.stdout.trim().split("\n").filter(Boolean)).toEqual([todas[todas.length - 2]]);
  }, 180_000);

  it("nunca lista una migración que el destino también tiene", async () => {
    const dir = destino(todas); // el destino tiene todo
    const res = run("node", ["scripts/deploy/migrations-to-revert.mjs"], { DEST_MIGRATIONS_DIR: dir });
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe("");
  }, 120_000);

  it("una lista de destino vacía no autoriza a revertir todo", async () => {
    // `git ls-tree <sha> -- api/migrations/` sale 0 y vacío si esa ruta no
    // existe en el commit destino. Tomarlo como "el destino no tiene ninguna"
    // haría que se revirtiera la base entera.
    const vacio = destino([]);
    const res = run("node", ["scripts/deploy/migrations-to-revert.mjs"], { DEST_MIGRATIONS_DIR: vacio });
    expect(res.code).toBe(3);
    expect(res.stdout.trim()).toBe("");
    expect(res.stderr).toMatch(/vino vacía/i);
  }, 120_000);

  it("sobre una base sin migrar no propone nada", async () => {
    const otra = `${DB_NAME}_vacia`;
    const vacia = await createTestDatabase(otra);
    try {
      const res = run("node", ["scripts/deploy/migrations-to-revert.mjs"], {
        DB_NAME: otra,
        DEST_MIGRATIONS_DIR: destino(todas.slice(0, -2)),
      });
      expect(res.code).toBe(0);
      expect(res.stdout.trim()).toBe("");
    } finally {
      await vacia.destroy();
      await dropTestDatabase(otra);
    }
  }, 120_000);
});

/**
 * Fallos reales: reversión parcial, restauración del dump y códigos de salida.
 *
 * `DOWN_CMD` es el comando que revierte una migración. En el deploy es el
 * script del paquete; acá se inyecta uno que revierte de verdad las primeras
 * veces y falla cuando se le pide, que es la única forma de provocar el fallo
 * intermedio sin romper knex a propósito.
 */
describeDb("rollback-db.sh frente a un down() que falla", () => {
  const FALLO_DB = `${DB_NAME}_fallo`;
  let db: Knex;
  let todas: string[] = [];
  let tmp: string;
  let backup: string;

  /** Un `DOWN_CMD` falso: revierte con knex hasta que le toca fallar. */
  function downCmd(fallaEnLlamada: number): string {
    const contador = join(tmp, "contador");
    writeFileSync(contador, "0");
    const script = join(tmp, "down.sh");
    writeFileSync(
      script,
      `#!/usr/bin/env bash
set -e
n=$(cat "${contador}")
n=$((n + 1))
echo "$n" > "${contador}"
if [ "$n" -ge ${fallaEnLlamada} ]; then
  echo "down() simulado: fallo en la llamada $n" >&2
  exit 1
fi
node "${join(tmp, "down.mjs")}"
`,
    );
    chmodSync(script, 0o755);
    return `bash ${script}`;
  }

  beforeAll(async () => {
    db = await createTestDatabase(FALLO_DB);
    todas = await migrationSource.getMigrations();
    tmp = mkdtempSync(join(tmpdir(), "rbfail-"));

    // Un `down()` real, invocable como proceso: usa la misma migración que el
    // deploy revertiría, sobre esta base de prueba.
    writeFileSync(
      join(tmp, "down.mjs"),
      `import knexFactory from ${JSON.stringify(resolve(ROOT, "api/node_modules/knex/knex.js"))};
const db = knexFactory({
  client: "mysql2",
  connection: {
    host: ${JSON.stringify(baseConnection.host)},
    port: ${baseConnection.port},
    user: ${JSON.stringify(baseConnection.user)},
    password: ${JSON.stringify(baseConnection.password)},
    database: ${JSON.stringify(FALLO_DB)},
  },
  migrations: { directory: ${JSON.stringify(resolve(ROOT, "api/migrations"))}, loadExtensions: [".ts"] },
});
try {
  // Sin ejecutar el archivo .ts: alcanza con desregistrar la última aplicada,
  // que es lo que el test necesita observar (la base avanza de estado).
  const [ultima] = await db("knex_migrations").orderBy("id", "desc").limit(1);
  if (ultima) await db("knex_migrations").where({ id: ultima.id }).del();
} finally {
  await db.destroy();
}
`,
    );
  }, 180_000);

  beforeEach(async () => {
    // Base al día en cada caso, y un dump con ese estado.
    await db.migrate.latest({ migrationSource });
    backup = join(tmp, "backup.sql.gz");
    execFileSync("bash", [
      "-c",
      `MYSQL_PWD='${baseConnection.password}' mysqldump -h${baseConnection.host} -P${baseConnection.port} -u${baseConnection.user} ${FALLO_DB} | gzip > ${backup}`,
    ]);
  }, 180_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(FALLO_DB);
    rmSync(tmp, { recursive: true, force: true });
  });

  const destinoSinUltimas = (n: number) => {
    const dir = arbolDestino(todas.slice(0, todas.length - n));
    return dir;
  };

  it("revierte todo y sale 0 cuando no hay fallos", async () => {
    const res = run("bash", ["scripts/deploy/rollback-db.sh"], {
      DB_NAME: FALLO_DB,
      DEST_MIGRATIONS_DIR: destinoSinUltimas(2),
      BACKUP_FILE: backup,
      DOWN_CMD: downCmd(99),
    });

    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain("2 migración(es) revertida(s)");
    const aplicadas = (await db("knex_migrations").pluck("name")) as string[];
    expect(aplicadas).not.toContain(todas[todas.length - 1]);
    expect(aplicadas).not.toContain(todas[todas.length - 2]);
  }, 180_000);

  it("si falla el segundo down(), restaura el backup y sale 4", async () => {
    const res = run("bash", ["scripts/deploy/rollback-db.sh"], {
      DB_NAME: FALLO_DB,
      DEST_MIGRATIONS_DIR: destinoSinUltimas(2),
      BACKUP_FILE: backup,
      DOWN_CMD: downCmd(2),
    });

    expect(res.code).toBe(4);
    expect(res.stderr).toContain("BASE RESTAURADA");
    // No dice "quedó como estaba" sin haberlo hecho: lo hizo y lo dice.
    expect(res.stderr).toContain("El código NO se bajó");

    // Y la base volvió al estado del dump: las dos migraciones siguen aplicadas.
    const aplicadas = (await db("knex_migrations").pluck("name")) as string[];
    expect(aplicadas).toContain(todas[todas.length - 1]);
    expect(aplicadas).toContain(todas[todas.length - 2]);
  }, 180_000);

  it("sin backup, avisa de la reversión parcial y sale 5", async () => {
    const res = run("bash", ["scripts/deploy/rollback-db.sh"], {
      DB_NAME: FALLO_DB,
      DEST_MIGRATIONS_DIR: destinoSinUltimas(2),
      BACKUP_FILE: "",
      DOWN_CMD: downCmd(2),
    });

    expect(res.code).toBe(5);
    expect(res.stderr).toContain("REVERSIÓN PARCIAL");
    expect(res.stderr).toMatch(/estado intermedio/i);

    // El daño es real y se informa como tal: una se revirtió, la otra no.
    const aplicadas = (await db("knex_migrations").pluck("name")) as string[];
    expect(aplicadas).not.toContain(todas[todas.length - 1]);
    expect(aplicadas).toContain(todas[todas.length - 2]);
  }, 180_000);

  it("si el dump tampoco se puede restaurar, sale 5 y lo dice", async () => {
    const roto = join(tmp, "roto.sql.gz");
    writeFileSync(roto, "esto no es un gzip");
    const res = run("bash", ["scripts/deploy/rollback-db.sh"], {
      DB_NAME: FALLO_DB,
      DEST_MIGRATIONS_DIR: destinoSinUltimas(2),
      BACKUP_FILE: roto,
      DOWN_CMD: downCmd(2),
    });

    expect(res.code).toBe(5);
    expect(res.stderr).toContain("LA RESTAURACIÓN TAMBIÉN FALLÓ");
    expect(res.stderr).toMatch(/No levantes la aplicación/i);
  }, 180_000);

  it("si el primer down() falla, no restaura ni inventa una reversión parcial", async () => {
    // Es lo que hace `rollback-guard.mjs` cuando bloquea la vuelta atrás:
    // nada se revirtió, así que restaurar el dump encima sería destruir por
    // las dudas.
    const antes = (await db("knex_migrations").pluck("name")) as string[];
    const res = run("bash", ["scripts/deploy/rollback-db.sh"], {
      DB_NAME: FALLO_DB,
      DEST_MIGRATIONS_DIR: destinoSinUltimas(2),
      BACKUP_FILE: backup,
      DOWN_CMD: downCmd(1),
    });

    expect(res.code).toBe(4);
    expect(res.stderr).toContain("ROLLBACK NO INICIADO");
    expect(res.stderr).toContain("RESTORE_DUMP");
    expect(res.stderr).not.toContain("REVERSIÓN PARCIAL");
    expect((await db("knex_migrations").pluck("name")) as string[]).toEqual(antes);
  }, 180_000);

  it("le pasa al down() el nombre de la migración, no 'la última'", () => {
    // knex `migrate:down [<name>]` revierte esa. Sin el nombre, con timestamps
    // fuera de orden (dos ramas fusionadas) bajaría otra distinta.
    const script = readFileSync(resolve(ROOT, "scripts/deploy/rollback-db.sh"), "utf8");
    // El nombre viaja como argumento del arreglo, no concatenado en una cadena
    // que `eval` vuelve a parsear (ver tests/rollback-db-failclosed.test.ts).
    expect(script).toMatch(/"\$\{DOWN_ARGV\[@\]\}" "\$nombre"/);
    // Y después comprueba que efectivamente se haya ido.
    expect(script).toContain("estado_migracion");
  });

  it("exporta la conexión al comando de reversión", () => {
    // Si no, knex la toma de api/.env y podría revertir en otra base.
    const script = readFileSync(resolve(ROOT, "scripts/deploy/rollback-db.sh"), "utf8");
    // El bucle de reversión, no el de validación de nombres que va antes.
    const inicio = script.indexOf("REVERTIDAS=0");
    expect(inicio).toBeGreaterThan(-1);
    const loop = script.slice(inicio, script.indexOf("done <<<", inicio));
    for (const v of ["DB_HOST=", "DB_PORT=", "DB_USER=", "DB_PASS=", "DB_NAME="]) {
      expect(loop, v).toContain(v);
    }
  });

  it("sin nada que revertir sale 0 sin tocar la base", async () => {
    const res = run("bash", ["scripts/deploy/rollback-db.sh"], {
      DB_NAME: FALLO_DB,
      DEST_MIGRATIONS_DIR: destinoSinUltimas(0),
      BACKUP_FILE: backup,
      DOWN_CMD: downCmd(1), // fallaría si se llamara: no debe llamarse
    });
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/nada que revertir/i);
  }, 180_000);
});

describe("rollback-vps.sh usa la lista real y falla fuerte", () => {
  const script = readFileSync(resolve(ROOT, "scripts/deploy/rollback-vps.sh"), "utf8");

  it("ya no cuenta archivos con git diff", () => {
    expect(script).not.toContain("--diff-filter=A");
    expect(script).toContain("rollback-db.sh");
    expect(script).toContain("git ls-tree --name-only");
  });

  it("valida que el destino sea un ancestro", () => {
    expect(script).toContain("git merge-base --is-ancestor");
  });

  it("propaga los códigos del rollback de la base", () => {
    const bloque = script.slice(script.indexOf("RB_CODE"), script.indexOf("4/6"));
    expect(bloque).toContain("4)");
    expect(bloque).toContain("5)");
    expect(bloque).toMatch(/REVERSIÓN PARCIAL/);
  });

  it("un health check en rojo termina con código distinto de cero", () => {
    const bloque = script.slice(script.indexOf('if [ "$HEALTH" = "200" ]'));
    expect(bloque).toContain("exit 6");
  });

  it("documenta los códigos de salida", () => {
    expect(script).toMatch(/Códigos de salida:/);
    expect(script).toMatch(/6\s+el rollback se aplicó pero el health check/);
  });
});
