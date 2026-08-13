import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  baseConnection,
  createTestDatabase,
  dropTestDatabase,
  jsonColumn,
  migrateUpOne,
  migrationSource,
  pendingMigrations,
  runSeeds,
} from "./helpers/db";

/**
 * El rollback, entre dos versiones del árbol.
 *
 * `docs/DEPLOY.md` decía: bajá el código con `ROLLBACK_TO` y después revertí
 * las migraciones. Ese orden no puede funcionar. knex decide qué revertir
 * leyendo `knex_migrations` y buscando el ARCHIVO en disco; después del
 * checkout al SHA anterior, las migraciones nuevas están registradas en la
 * base y sus archivos ya no existen. Además el `down()` que hace falta es el
 * del código nuevo, que es el único que sabe deshacer su propio `up()`.
 *
 * Acá se modelan las dos versiones del árbol con dos `migrationSource`: el
 * "nuevo" tiene todas las migraciones y el "viejo" no tiene las últimas. No
 * alcanza con probar `up()` y `down()` dentro del mismo checkout: el problema
 * aparece justamente cuando el árbol cambia.
 *
 *   TEST_DATABASE=1 pnpm test tests/rollback-flow.test.ts
 */

const ROOT = resolve(__dirname, "..");
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

/** Cuántas migraciones "agrega la versión nueva" en este escenario. */
const NUEVAS = 2;

/** Migraciones correctivas: guardan snapshot y se revierten con `down()`. */
const CORRECTIVE = [
  "20260814000000_contenido_no_confirmado.ts",
  "20260815000000_rojo_solo_emergencias.ts",
  "20260816000000_fuente_unica_contacto.ts",
  "20260817000000_rojo_y_horarios_sin_confirmar.ts",
  "20260818000000_restaurar_href_social.ts",
  "20260819000000_retirar_scripts.ts",
];

/** Un `migrationSource` con las últimas `drop` migraciones quitadas. */
async function olderTree(drop: number) {
  const all = await migrationSource.getMigrations();
  const kept = all.slice(0, all.length - drop);
  return {
    getMigrations: async () => kept,
    getMigrationName: (name: string) => name,
    getMigration: (name: string) => migrationSource.getMigration(name),
  };
}

describeDb("orden del rollback entre dos versiones", () => {
  const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_rbflow`;
  let db: Knex;
  let removidas: string[] = [];

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    const all = await migrationSource.getMigrations();
    removidas = all.slice(all.length - NUEVAS);
    // Estado del servidor: deploy de la versión nueva, ya migrado.
    await db.migrate.latest({ migrationSource });
  }, 180_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("con el árbol viejo, knex no puede revertir lo que ya no está en disco", async () => {
    const viejo = await olderTree(NUEVAS);
    // Esto es lo que pasaba haciendo `git reset --hard <sha>` primero.
    await expect(db.migrate.down({ migrationSource: viejo } as never)).rejects.toThrow();

    // Y la base sigue con las migraciones nuevas aplicadas: no se revirtió
    // nada, pero el deploy ya bajó el código. Ese es el estado inconsistente.
    const applied = (await db("knex_migrations").pluck("name")) as string[];
    for (const name of removidas) expect(applied).toContain(name);
  }, 120_000);

  it("el árbol viejo ni siquiera puede listar el estado", async () => {
    const viejo = await olderTree(NUEVAS);
    // knex se planta: hay migraciones registradas cuyo archivo no existe.
    await expect(db.migrate.list({ migrationSource: viejo } as never)).rejects.toThrow(
      /corrupt|missing/i,
    );
    const applied = (await db("knex_migrations").pluck("name")) as string[];
    for (const name of removidas) expect(applied).toContain(name);
  }, 120_000);

  it("revirtiendo primero, con el código nuevo, el árbol viejo queda consistente", async () => {
    // Orden correcto: `down()` con las migraciones nuevas todavía presentes…
    for (let i = 0; i < NUEVAS; i++) await db.migrate.down({ migrationSource });

    const applied = (await db("knex_migrations").pluck("name")) as string[];
    for (const name of removidas) expect(applied).not.toContain(name);

    // …y recién ahí el árbol viejo. Nada pendiente, nada huérfano.
    const viejo = await olderTree(NUEVAS);
    const [, pending] = (await db.migrate.list({ migrationSource: viejo } as never)) as [
      unknown,
      { file?: string }[],
    ];
    expect(pending.map((p) => (typeof p === "string" ? p : (p.file ?? "")))).toEqual([]);
    // Y la versión vieja puede volver a migrar sin errores.
    await db.migrate.latest({ migrationSource: viejo } as never);
  }, 180_000);
});

/**
 * Segundo contrato: después de un seed, el `down()` ya no restaura nada.
 *
 * Los seeds borran páginas y bloques y los reinsertan con ids nuevos. Las
 * migraciones `20260815` y `20260817` guardan su snapshot indexado por id de
 * bloque, así que su `down()` busca ids que no existen, no toca ninguna fila y
 * **termina sin error**: knex la marca como revertida y el contenido queda
 * como estaba. Un rollback que dice "listo" sin restaurar nada es peor que uno
 * que falla, así que se bloquea antes de correr.
 */
describeDb("migrate → seed → rollback", () => {
  const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_seedrb`;
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);

    // Base "de producción": todo lo anterior a las correctivas.
    let guard = 0;
    while (guard++ < 100) {
      const pending = await pendingMigrations(db);
      if (!pending[0] || CORRECTIVE.includes(pending[0])) break;
      await migrateUpOne(db);
    }

    // Contenido del cliente que las correctivas van a tocar: es lo que hace
    // que sus snapshots guarden ids de bloque. En una base recién instalada no
    // hay nada de esto, así que el problema no se ve.
    const page = await db("pages").orderBy("id").first("id");
    expect(page, "las migraciones previas dejan al menos una página").toBeTruthy();
    const maxOrder = Number((await db("blocks").where({ page_id: page.id }).max("order as m"))[0].m ?? 0);
    await db("blocks").insert({
      page_id: page.id,
      type: "cta",
      order: maxOrder + 1,
      props: JSON.stringify({
        title: "Convenios corporativos",
        ctaLabel: "Ver convenios",
        ctaHref: "/convenios",
        variant: "accent",
        background: "#f5543f",
      }),
    });

    await db.migrate.latest({ migrationSource });
    // Y recién después se siembra: el caso que rompe el rollback.
    await runSeeds(db);
  }, 240_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("el seed deja constancia de cuándo corrió", async () => {
    const row = await db("settings").where({ key: "seed_generation" }).first("value");
    expect(row, "el seed tiene que registrar su generación").toBeTruthy();
    expect(Date.parse(jsonColumn(row.value).at)).not.toBeNaN();
  });

  it("los snapshots por id quedan apuntando a bloques que ya no existen", async () => {
    // Esto es el daño, medido: no se arregla debilitando la comparación.
    const rows = await db("settings").where("key", "like", "snapshot_%").select("key", "value");
    const porId = rows
      .map((r) => ({ key: r.key as string, blocks: (jsonColumn(r.value).blocks ?? []) as { id?: number }[] }))
      .filter((s) => Array.isArray(s.blocks) && s.blocks.some((b) => typeof b?.id === "number"));

    expect(porId.length, "al menos una migración guarda su snapshot por id de bloque").toBeGreaterThan(0);
    for (const snapshot of porId) {
      const ids = snapshot.blocks.map((b) => b.id!).filter((id) => typeof id === "number");
      const vivos = (await db("blocks").whereIn("id", ids).pluck("id")) as number[];
      expect(vivos, `${snapshot.key}: sus ids ya no corresponden a los bloques sembrados`).toEqual([]);
    }
  });

  it("el guard bloquea el rollback y manda al dump", () => {
    let code = 0;
    let stderr = "";
    try {
      execFileSync("node", ["scripts/deploy/rollback-guard.mjs"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          DB_HOST: baseConnection.host,
          DB_PORT: String(baseConnection.port),
          DB_USER: baseConnection.user,
          DB_PASS: baseConnection.password,
          DB_NAME,
          ROLLBACK_ALLOW_AFTER_SEED: "",
        },
      });
    } catch (err) {
      const e = err as { status: number; stderr: string };
      code = e.status;
      stderr = e.stderr;
    }
    expect(code).toBe(3);
    expect(stderr).toContain("ROLLBACK BLOQUEADO");
    expect(stderr).toContain("gunzip");
    expect(stderr).toContain("snapshot_");
  });

  it("con la salida explícita sí deja seguir", () => {
    const out = execFileSync("node", ["scripts/deploy/rollback-guard.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DB_HOST: baseConnection.host,
        DB_PORT: String(baseConnection.port),
        DB_USER: baseConnection.user,
        DB_PASS: baseConnection.password,
        DB_NAME,
        ROLLBACK_ALLOW_AFTER_SEED: "1",
      },
    });
    expect(out).toBe("");
  });
});

describeDb("sin seed posterior, el rollback no se bloquea", () => {
  const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_noseed`;
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await db.migrate.latest({ migrationSource });
  }, 180_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("el guard deja pasar", () => {
    const out = execFileSync("node", ["scripts/deploy/rollback-guard.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DB_HOST: baseConnection.host,
        DB_PORT: String(baseConnection.port),
        DB_USER: baseConnection.user,
        DB_PASS: baseConnection.password,
        DB_NAME,
      },
    });
    expect(out).toBe("");
  });
});

describe("el script de rollback hace las cosas en orden", () => {
  const script = readFileSync(resolve(ROOT, "scripts/deploy/rollback-vps.sh"), "utf8");
  const at = (needle: string) => {
    const i = script.indexOf(needle);
    expect(i, `no se encontró ${needle}`).toBeGreaterThan(-1);
    return i;
  };

  it("hace backup antes de tocar nada", () => {
    expect(at("mysqldump")).toBeLessThan(at("migrate:down"));
    expect(at("mysqldump")).toBeLessThan(at("git reset --hard"));
  });

  it("revierte las migraciones ANTES de bajar el árbol", () => {
    expect(at("migrate:down")).toBeLessThan(at("git reset --hard"));
  });

  it("reconstruye después del checkout", () => {
    expect(at("git reset --hard")).toBeLessThan(at("@sa/api build"));
  });

  it("si el backup falla, no sigue", () => {
    const backup = script.slice(at("mysqldump"), at("git reset --hard"));
    expect(backup).toContain("die ");
  });

  it("ofrece el camino del dump para bases sembradas", () => {
    expect(script).toContain("RESTORE_DUMP");
    expect(script).toContain("gunzip");
  });

  it("la documentación explica el orden y el caso del dump", () => {
    const deploy = readFileSync(resolve(ROOT, "docs/DEPLOY.md"), "utf8");
    expect(deploy).toContain("rollback-vps.sh");
    expect(deploy).toMatch(/primero se revierten\s+las\s+migraciones/i);
    expect(deploy).toContain("rollback-guard.mjs");
    // Y ya no dice que se baje el código primero.
    expect(deploy).not.toMatch(/ROLLBACK_TO=<sha-anterior> bash [^\n]*update-vps\.sh/);
  });

  it("migrate:rollback pasa por el guard", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "api/package.json"), "utf8"));
    expect(pkg.scripts["migrate:rollback"]).toContain("rollback-guard.mjs");
    expect(pkg.scripts["migrate:down"]).toContain("rollback-guard.mjs");
    // db:reset descarta el contenido a propósito: ahí la barrera se levanta.
    expect(pkg.scripts["db:reset"]).toContain("ROLLBACK_ALLOW_AFTER_SEED=1");
  });
});
