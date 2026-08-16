import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  baseConnection,
  createTestDatabase,
  dropTestDatabase,
  migrationSource,
} from "./helpers/db";

/**
 * Qué pasa cuando la verificación no puede responder, y qué pasa con un nombre
 * que no es un nombre.
 *
 * 1. `sigue_aplicada()` preguntaba `SELECT COUNT(*) … 2>/dev/null || echo ""` y
 *    después trataba la respuesta vacía como "la migración ya no está". Una
 *    conexión caída, un permiso denegado o un `knex_migrations` que no existe
 *    daban exactamente el mismo resultado que un rollback exitoso: el script
 *    contaba la migración como revertida, seguía con la siguiente y terminaba
 *    diciendo "Listo". `rollback-vps.sh` entonces bajaba el árbol sobre una
 *    base cuyo estado real nunca se comprobó.
 *
 * 2. El nombre de la migración salía de `knex_migrations` —una tabla
 *    escribible— y entraba a `eval "$DOWN_CMD '$nombre'"`. Una comilla en ese
 *    valor cierra el argumento y lo que sigue es otro comando.
 *
 * Las dos cosas se prueban ejecutando los scripts reales contra una base real.
 *
 *   TEST_DATABASE=1 pnpm test tests/rollback-db-failclosed.test.ts
 */

const ROOT = resolve(__dirname, "..");
const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_failclosed`;
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
      timeout: 180_000,
      env: { ...process.env, ...dbEnv, ...env },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

/** El directorio de migraciones del árbol destino, como lo ve el deploy. */
function arbolDestino(base: string, nombres: string[]): string {
  const dir = join(base, `destino-${nombres.length}`);
  mkdirSync(dir, { recursive: true });
  for (const nombre of nombres) writeFileSync(join(dir, nombre), "// copia del árbol destino\n");
  return dir;
}

function ejecutable(path: string, contenido: string): string {
  writeFileSync(path, contenido);
  chmodSync(path, 0o755);
  return path;
}

describeDb("una verificación que no puede responder aborta el rollback", () => {
  let db: Knex;
  let todas: string[] = [];
  let tmp: string;
  let backup: string;
  let mysqlReal: string;

  /** El `<script>` que revierte de verdad: desregistra la última aplicada. */
  const downReal = () => `bash ${join(tmp, "down-real.sh")}`;
  /** Un `down()` que termina 0 sin tocar nada: la migración sigue aplicada. */
  const downMentiroso = () => `bash ${join(tmp, "down-mentiroso.sh")}`;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    todas = await migrationSource.getMigrations();
    tmp = mkdtempSync(join(tmpdir(), "failclosed-"));
    mysqlReal = execFileSync("bash", ["-c", "command -v mysql"], { encoding: "utf8" }).trim();
    expect(mysqlReal, "hace falta el cliente mysql para esta prueba").toBeTruthy();

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
    database: ${JSON.stringify(DB_NAME)},
  },
});
try {
  const [ultima] = await db("knex_migrations").orderBy("id", "desc").limit(1);
  if (ultima) await db("knex_migrations").where({ id: ultima.id }).del();
} finally {
  await db.destroy();
}
`,
    );
    ejecutable(
      join(tmp, "down-real.sh"),
      `#!/usr/bin/env bash\nset -e\necho "$*" >> ${JSON.stringify(join(tmp, "invocaciones"))}\nnode ${JSON.stringify(join(tmp, "down.mjs"))}\n`,
    );
    ejecutable(
      join(tmp, "down-mentiroso.sh"),
      `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(join(tmp, "invocaciones"))}\nexit 0\n`,
    );

    // Un `mysql` que simula la conexión caída SÓLO en la consulta de
    // verificación (la que lleva `-e`). La restauración del dump no usa `-e`,
    // así que se delega al cliente real: es la única forma de observar que el
    // script, además de abortar, restaura.
    mkdirSync(join(tmp, "bin"), { recursive: true });
    ejecutable(
      join(tmp, "bin", "mysql"),
      `#!/usr/bin/env bash
for a in "$@"; do
  if [ "$a" = "-e" ]; then
    echo "ERROR 2013 (HY000): Lost connection to MySQL server during query" >&2
    exit 1
  fi
done
exec ${JSON.stringify(mysqlReal)} "$@"
`,
    );
  }, 180_000);

  beforeEach(async () => {
    await db.migrate.latest({ migrationSource });
    writeFileSync(join(tmp, "invocaciones"), "");
    backup = join(tmp, "backup.sql.gz");
    execFileSync("bash", [
      "-c",
      `MYSQL_PWD='${baseConnection.password}' mysqldump -h${baseConnection.host} -P${baseConnection.port} -u${baseConnection.user} ${DB_NAME} | gzip > ${backup}`,
    ]);
  }, 180_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
    rmSync(tmp, { recursive: true, force: true });
  });

  const destinoSinUltimas = (n: number) => arbolDestino(tmp, todas.slice(0, todas.length - n));
  const conMysqlCaido = () => ({ PATH: `${join(tmp, "bin")}:${process.env.PATH}` });

  it("si la consulta falla, no lo cuenta como revertido: aborta y restaura", async () => {
    const antes = (await db("knex_migrations").pluck("name")) as string[];

    const res = run("bash", ["scripts/deploy/rollback-db.sh"], {
      ...conMysqlCaido(),
      DEST_MIGRATIONS_DIR: destinoSinUltimas(2),
      BACKUP_FILE: backup,
      DOWN_CMD: downReal(),
    });

    // Antes esto salía 0 con "Listo: 2 migración(es) revertida(s)" sin haber
    // verificado ninguna.
    expect(res.stdout).not.toMatch(/Listo:/);
    expect(res.code).toBe(4);
    expect(res.stderr).toMatch(/no se pudo consultar knex_migrations/i);
    expect(res.stderr).toMatch(/Lost connection/);
    expect(res.stderr).toContain("BASE RESTAURADA");

    // Se cortó en la primera: el down() se llamó una sola vez.
    expect(readFileSync(join(tmp, "invocaciones"), "utf8").trim().split("\n").filter(Boolean)).toHaveLength(1);
    // Y la base volvió al dump: la fila que el down() borró está de nuevo.
    expect((await db("knex_migrations").pluck("name")) as string[]).toEqual(antes);
  }, 180_000);

  it("no dice 'ROLLBACK NO INICIADO' cuando el down() sí corrió", async () => {
    // El contador de revertidas está en 0 —la verificación nunca confirmó
    // ninguna—, pero el `down()` terminó bien: la base pudo haber cambiado.
    // Decir que quedó intacta sería exactamente la afirmación que no se puede
    // sostener.
    const res = run("bash", ["scripts/deploy/rollback-db.sh"], {
      ...conMysqlCaido(),
      DEST_MIGRATIONS_DIR: destinoSinUltimas(2),
      BACKUP_FILE: backup,
      DOWN_CMD: downReal(),
    });

    // El camino correcto es el de restaurar, no el de "acá no pasó nada"…
    expect(res.code).toBe(4);
    expect(res.stderr).toContain("BASE RESTAURADA");
    // …y ninguna de las dos frases que afirman que la base está intacta.
    expect(res.stderr).not.toContain("ROLLBACK NO INICIADO");
    expect(res.stderr).not.toMatch(/la base quedó exactamente como estaba/i);
  }, 180_000);

  it("sin backup, una verificación caída sale 5 y avisa del estado intermedio", () => {
    const res = run("bash", ["scripts/deploy/rollback-db.sh"], {
      ...conMysqlCaido(),
      DEST_MIGRATIONS_DIR: destinoSinUltimas(2),
      BACKUP_FILE: "",
      DOWN_CMD: downReal(),
    });

    expect(res.code).toBe(5);
    expect(res.stderr).toContain("REVERSIÓN PARCIAL Y SIN BACKUP");
    expect(res.stderr).toMatch(/estado intermedio/i);
  }, 180_000);

  it("un down() que miente tampoco pasa por revertido", async () => {
    // Termina 0 y no toca nada. La verificación —esta vez sí responde— dice
    // que la migración sigue aplicada.
    const antes = (await db("knex_migrations").pluck("name")) as string[];

    const res = run("bash", ["scripts/deploy/rollback-db.sh"], {
      DEST_MIGRATIONS_DIR: destinoSinUltimas(2),
      BACKUP_FILE: backup,
      DOWN_CMD: downMentiroso(),
    });

    expect(res.code).toBe(4);
    expect(res.stderr).toMatch(/sigue aplicada/i);
    // Tampoco acá: el down() corrió, así que "no iniciado" no es verdad.
    expect(res.stderr).not.toContain("ROLLBACK NO INICIADO");
    expect((await db("knex_migrations").pluck("name")) as string[]).toEqual(antes);
  }, 180_000);

  it("cuando todo responde bien, sigue revirtiendo y sale 0", async () => {
    // El fail-closed no puede volverse un freno permanente: con la conexión
    // sana el camino normal tiene que seguir funcionando.
    const res = run("bash", ["scripts/deploy/rollback-db.sh"], {
      DEST_MIGRATIONS_DIR: destinoSinUltimas(2),
      BACKUP_FILE: backup,
      DOWN_CMD: downReal(),
    });

    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain("2 migración(es) revertida(s)");
    const aplicadas = (await db("knex_migrations").pluck("name")) as string[];
    expect(aplicadas).not.toContain(todas[todas.length - 1]);
    expect(aplicadas).not.toContain(todas[todas.length - 2]);
  }, 180_000);
});

describeDb("un nombre manipulado no llega al shell", () => {
  const DB_INJ = `${DB_NAME}_inj`;
  let db: Knex;
  let todas: string[] = [];
  let tmp: string;

  beforeAll(async () => {
    db = await createTestDatabase(DB_INJ);
    todas = await migrationSource.getMigrations();
    await db.migrate.latest({ migrationSource });
    tmp = mkdtempSync(join(tmpdir(), "inject-"));
  }, 240_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_INJ);
    rmSync(tmp, { recursive: true, force: true });
  });

  const centinela = () => join(tmp, "CENTINELA");

  /**
   * Nombres que no describen ninguna migración de este repo. El primero es el
   * que rompía `eval`: la comilla cierra el argumento y `touch` pasa a ser un
   * comando propio.
   */
  const HOSTILES = [
    `x'; touch ${join("__TMP__", "CENTINELA")}; echo '.ts`,
    `x$(touch ${join("__TMP__", "CENTINELA")}).ts`,
    "x`touch __TMP__/CENTINELA`.ts",
    "../../../etc/passwd",
    "20260819000000_ok.ts; rm -rf /",
    "20260819000000_ok.ts\n20260820000000_otra.ts",
    "con espacios.ts",
  ];

  it.each(HOSTILES)("migrations-to-revert.mjs lo rechaza en el origen: %j", async (crudo) => {
    const nombre = crudo.replaceAll("__TMP__", tmp);
    await db("knex_migrations").insert({ name: nombre, batch: 99, migration_time: new Date() });
    try {
      const res = run("node", ["scripts/deploy/migrations-to-revert.mjs"], {
        DB_NAME: DB_INJ,
        DEST_MIGRATIONS_DIR: arbolDestino(tmp, todas),
      });

      expect(res.code).toBe(3);
      // Nada en stdout: lo que salga de acá se ejecuta.
      expect(res.stdout.trim()).toBe("");
      expect(res.stderr).toMatch(/no son nombres de migración/i);
      expect(res.stderr).toMatch(/No se revierte nada/i);
      expect(existsSync(centinela())).toBe(false);
    } finally {
      await db("knex_migrations").where({ name: nombre }).del();
      rmSync(centinela(), { force: true });
    }
  }, 120_000);

  it("un salto de línea se ve entero sólo en el origen", async () => {
    // Por eso la validación no puede vivir únicamente en `rollback-db.sh`: ahí
    // la lista ya llega línea por línea y `a\nb` sería indistinguible de dos
    // migraciones perfectamente válidas.
    const nombre = "20260819000000_a.ts\n20260820000000_b.ts";
    await db("knex_migrations").insert({ name: nombre, batch: 99, migration_time: new Date() });
    try {
      const res = run("node", ["scripts/deploy/migrations-to-revert.mjs"], {
        DB_NAME: DB_INJ,
        DEST_MIGRATIONS_DIR: arbolDestino(tmp, todas),
      });
      expect(res.code).toBe(3);
      expect(res.stdout.trim()).toBe("");
    } finally {
      await db("knex_migrations").where({ name: nombre }).del();
    }
  }, 120_000);

  it("rollback-db.sh valida por su cuenta lo que recibe", () => {
    // La lista podría no venir de `migrations-to-revert.mjs`. Se sustituye por
    // un `node` que devuelve un nombre hostil y se comprueba que el script
    // corta ahí: sin ejecutar el down(), sin efectos en el shell.
    const bin = join(tmp, "bin");
    mkdirSync(bin, { recursive: true });
    ejecutable(
      join(bin, "node"),
      `#!/usr/bin/env bash\ncat <<'FIN'\nx'; touch ${join(tmp, "CENTINELA")}; echo '.ts\nFIN\n`,
    );
    const invocaciones = join(tmp, "invocaciones-inj");
    rmSync(invocaciones, { force: true });
    const down = ejecutable(
      join(tmp, "down-registra.sh"),
      `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(invocaciones)}\nexit 0\n`,
    );

    const res = run("bash", ["scripts/deploy/rollback-db.sh"], {
      PATH: `${bin}:${process.env.PATH}`,
      DB_NAME: DB_INJ,
      DEST_MIGRATIONS_DIR: arbolDestino(tmp, todas),
      BACKUP_FILE: "",
      DOWN_CMD: `bash ${down}`,
    });

    expect(res.code).toBe(3);
    expect(res.stderr).toMatch(/no es un nombre de migración/i);
    expect(res.stderr).toMatch(/No se revirtió nada/i);
    // Ni el comando de reversión llegó a correr…
    expect(existsSync(invocaciones)).toBe(false);
    // …ni el `touch` embebido en el nombre se ejecutó.
    expect(existsSync(centinela())).toBe(false);
  }, 120_000);
});

describe("el script no vuelve a construir comandos con texto", () => {
  const script = readFileSync(resolve(ROOT, "scripts/deploy/rollback-db.sh"), "utf8");

  it("no usa eval en ningún lado", () => {
    const codigo = script
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(codigo).not.toMatch(/\beval\b/);
  });

  it("ejecuta DOWN_CMD como arreglo y el nombre como argumento", () => {
    expect(script).toMatch(/read -r -a DOWN_ARGV/);
    expect(script).toMatch(/"\$\{DOWN_ARGV\[@\]\}" "\$nombre"/);
  });

  it("ya no restaura dentro de un bash -c con rutas interpoladas", () => {
    expect(script).not.toMatch(/bash -c ".*gunzip/);
    expect(script).toMatch(/gzip -t -- "\$dump"/);
  });

  it("distingue los tres resultados de la verificación", () => {
    expect(script).toContain("estado_migracion");
    expect(script).not.toContain("sigue_aplicada()");
    // Y el atajo de "no se revirtió nada, la base está intacta" ya no depende
    // sólo del contador.
    expect(script).toMatch(/\[ "\$REVERTIDAS" -eq 0 \] && \[ "\$FALLO_TIPO" = "down" \]/);
  });
});
