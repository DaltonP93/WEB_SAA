import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  DB_TESTS_ENABLED,
  createTestDatabase,
  dropTestDatabase,
  migrateDown,
  migrateLatest as migrateLatestFor,
  migrateUpOne,
  migrationSource,
  pendingMigrations,
  jsonColumn,
} from "./helpers/db";

/**
 * Migraciones sobre una base real.
 *
 * Sólo corren con TEST_DATABASE=1 y una base descartable configurada
 * (TEST_DB_NAME). Sin eso quedan marcadas como skipped: preferimos verlas
 * omitidas antes que dar por buena una prueba que no se ejecutó.
 *
 *   TEST_DATABASE=1 TEST_DB_NAME=sanatorio_test pnpm test tests/migrations.test.ts
 *
 * Hay dos bloques:
 *  - "base limpia": qué queda publicado en una instalación nueva;
 *  - "ediciones del cliente": que aplicar, repetir y revertir las migraciones
 *    correctivas no destruya contenido cargado desde el panel.
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_mig`;
const EDIT_DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_edit`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

/** Migraciones correctivas de esta ronda: se aplican y revierten aparte. */
const CORRECTIVE = [
  "20260814000000_contenido_no_confirmado.ts",
  "20260815000000_rojo_solo_emergencias.ts",
  "20260816000000_fuente_unica_contacto.ts",
  "20260817000000_rojo_y_horarios_sin_confirmar.ts",
];

describeDb("migraciones", () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
  }, 60_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("corren sobre una base limpia", async () => {
    await migrateLatestFor(db);
    const tables = ["pages", "blocks", "contact_channels", "schedules", "studies", "services"];
    for (const t of tables) {
      expect(await db.schema.hasTable(t), `falta la tabla ${t}`).toBe(true);
    }
  }, 120_000);

  it("no publican datos de contacto inventados", async () => {
    const channels = await db("contact_channels").select("key", "value");
    expect(channels.length).toBeGreaterThan(0);
    // Todos los canales arrancan sin valor: los carga el sanatorio.
    expect(channels.every((c) => !c.value)).toBe(true);
  });

  it("no publican horarios inventados", async () => {
    const active = await db("schedules").where({ active: true });
    expect(active).toEqual([]);
    const withHours = await db("schedules").whereNotNull("hours");
    expect(withHours).toEqual([]);
  });

  it("dejan Noticias fuera del sitio", async () => {
    expect(await db("pages").where({ slug: "noticias" }).first()).toBeUndefined();
    expect(await db("blocks").where({ type: "newsGrid" })).toEqual([]);
  });

  it("dejan una sola página de portal publicada", async () => {
    const published = await db("pages")
      .where({ status: "published" })
      .andWhere("slug", "like", "portal%")
      .select("slug");
    expect(published.map((p) => p.slug)).toEqual(["portal-paciente"]);
  });

  it("no repiten iconos dentro de la grilla de estudios", async () => {
    const rows = await db("studies").whereNotNull("icon").select("slug", "icon");
    const icons = rows.map((r) => r.icon);
    expect(new Set(icons).size, `iconos repetidos: ${icons.join(", ")}`).toBe(icons.length);
  });

  it("no dejan estudios publicados sin confirmación del sanatorio", async () => {
    const published = await db("studies").where({ published: true });
    expect(published).toEqual([]);
  });

  it("el backup del rollback no se pisa al repetir la migración", async () => {
    const row = await db("settings").where({ key: "minuta_blocks_backup_20260812000000" }).first();
    expect(row).toBeTruthy();
    const value = jsonColumn(row.value);
    // El backup guarda el estado ANTERIOR: bloques de páginas que la migración
    // reemplazó. Si se hubiera pisado en la segunda corrida, estaría vacío.
    expect(Array.isArray(value.blocks)).toBe(true);
  });
});

/**
 * Foto completa del contenido administrable. Se usa para comparar el estado
 * anterior a las migraciones correctivas con el que queda tras revertirlas.
 */
async function contentSnapshot(db: Knex) {
  const pages = await db("pages").orderBy("slug").select("slug", "title", "status");
  const blocks = await db("blocks")
    .join("pages", "pages.id", "blocks.page_id")
    .orderBy(["pages.slug", "blocks.order"])
    .select("pages.slug as pageSlug", "blocks.type as type", "blocks.order as order", "blocks.props as props");
  // `published` la agrega una de las correctivas: antes de aplicarlas no existe.
  const studyColumns = ["slug", "name", "description", "icon"];
  if (await db.schema.hasColumn("studies", "published")) studyColumns.push("published");
  const studies = await db("studies").orderBy("slug").select(studyColumns);
  const services = await db("services").orderBy("slug").select("slug", "name", "description", "body", "icon", "order");
  const specialties = await db("specialties").orderBy("slug").select("slug", "name", "description", "icon", "order");
  // Todas las columnas administrables: un rollback que devuelve `value` pero
  // deja `href` cambiado no es un rollback.
  const channels = await db("contact_channels")
    .orderBy("key")
    .select("key", "label", "kind", "value", "href", "note", "message", "icon", "active", "order");
  const schedules = await db("schedules")
    .orderBy("key")
    .select("key", "area", "service_slug", "days", "hours", "note", "active", "order");
  const settings = await db("settings").orderBy("key").select("key", "value");
  const menus = await db("menus").orderBy("location").select("location", "items");

  return {
    pages,
    blocks: blocks.map((b) => ({ ...b, props: jsonColumn(b.props) })),
    studies,
    services,
    specialties,
    channels,
    schedules,
    // La clave del snapshot de cada migración correctiva sólo existe mientras
    // la migración está aplicada; no forma parte del contenido a comparar.
    settings: settings
      .filter((s) => !String(s.key).startsWith("snapshot_"))
      .map((s) => ({ ...s, value: jsonColumn(s.value) })),
    menus: menus.map((m) => ({ ...m, items: jsonColumn(m.items) })),
  };
}

describeDb("migraciones correctivas frente a ediciones del cliente", () => {
  let db: Knex;
  /** Estado justo antes de aplicar las correctivas. */
  let before: Awaited<ReturnType<typeof contentSnapshot>>;

  beforeAll(async () => {
    db = await createTestDatabase(EDIT_DB_NAME);

    // 1. Base "de producción": todo lo anterior a esta ronda correctiva.
    let guard = 0;
    while (guard++ < 100) {
      const pending = await pendingMigrations(db);
      const next = pending[0];
      if (!next || CORRECTIVE.includes(next)) break;
      await migrateUpOne(db);
    }

    // 2. Contenido representativo ya cargado por el cliente desde el panel.
    const [pageId] = await db("pages").insert({
      slug: "pagina-del-cliente",
      title: "Página cargada por el cliente",
      status: "published",
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db("blocks").insert([
      {
        page_id: pageId,
        type: "richText",
        order: 0,
        props: JSON.stringify({ html: "<p>Texto propio del sanatorio.</p>" }),
      },
      {
        page_id: pageId,
        // CTA rojo cargado a mano: la migración correctiva tiene que sacarle
        // el rojo sin borrar el bloque.
        type: "cta",
        order: 1,
        props: JSON.stringify({
          title: "Convenios corporativos",
          ctaLabel: "Ver convenios",
          ctaHref: "/convenios",
          variant: "accent",
          background: "#f5543f",
        }),
      },
    ]);
    const home = await db("pages").where({ slug: "home" }).first("id");
    if (home) {
      const maxOrder = (await db("blocks").where({ page_id: home.id }).max("order as m"))[0].m ?? 0;
      await db("blocks").insert({
        page_id: home.id,
        type: "richText",
        order: Number(maxOrder) + 1,
        props: JSON.stringify({ html: "<p>Bloque agregado por el cliente en el home.</p>" }),
      });
    }
    await db("contact_channels")
      .where({ key: "whatsapp-general" })
      .update({ value: "+000000000", active: true });

    before = await contentSnapshot(db);
  }, 180_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(EDIT_DB_NAME);
  });

  it("aplican las correctivas sin borrar el contenido del cliente", async () => {
    await migrateLatestFor(db);

    const page = await db("pages").where({ slug: "pagina-del-cliente" }).first("id");
    expect(page).toBeTruthy();
    const blocks = await db("blocks").where({ page_id: page.id }).orderBy("order");
    expect(blocks).toHaveLength(2);
    const rich = jsonColumn(blocks[0].props);
    expect(rich.html).toContain("Texto propio del sanatorio");

    // El CTA sigue estando, pero ya sin rojo: no habla de Emergencias.
    const cta = jsonColumn(blocks[1].props);
    expect(cta.variant).toBe("primary");
    expect(cta.background).toBeUndefined();
    expect(cta.title).toBe("Convenios corporativos");

    // El canal que cargó el cliente conserva su valor.
    const channel = await db("contact_channels").where({ key: "whatsapp-general" }).first();
    expect(channel.value).toBe("+000000000");
  }, 120_000);

  it("repetir up() no pisa una edición posterior del cliente", async () => {
    // El cliente edita desde el panel DESPUÉS de la migración.
    const page = await db("pages").where({ slug: "pacientes" }).first("id");
    expect(page).toBeTruthy();
    await db("blocks")
      .where({ page_id: page.id })
      .andWhere({ order: 0 })
      .update({ props: JSON.stringify({ title: "Pacientes", variant: "centered", subtitle: "Editado desde el panel" }) });
    const [newBlockId] = await db("blocks").insert({
      page_id: page.id,
      type: "richText",
      order: 999,
      props: JSON.stringify({ html: "<p>Aviso cargado después de migrar.</p>" }),
    });

    // Se vuelve a ejecutar up() de las dos correctivas (lo que pasaría si
    // alguien reaplicara la migración a mano o en otro entorno).
    for (const name of CORRECTIVE) {
      const mig = await migrationSource.getMigration(name);
      await mig.up(db);
    }

    const hero = jsonColumn((await db("blocks").where({ page_id: page.id, order: 0 }).first()).props);
    expect(hero.subtitle).toBe("Editado desde el panel");
    const added = await db("blocks").where({ id: newBlockId }).first();
    expect(added).toBeTruthy();
    expect(jsonColumn(added.props).html).toContain("Aviso cargado después de migrar");

    // Se deshace la edición para que el rollback pueda compararse con `before`.
    await db("blocks").where({ id: newBlockId }).del();
  }, 120_000);

  it("el rollback devuelve exactamente el estado anterior", async () => {
    // Se restaura el hero editado en la prueba anterior antes de comparar.
    const pacientes = await db("pages").where({ slug: "pacientes" }).first("id");
    const original = before.blocks.find((b) => b.pageSlug === "pacientes" && b.order === 0);
    if (pacientes && original) {
      await db("blocks")
        .where({ page_id: pacientes.id, order: 0 })
        .update({ props: JSON.stringify(original.props) });
    }

    // Una por una y en orden inverso: rollback() volvería el batch entero.
    for (let i = 0; i < CORRECTIVE.length; i++) await migrateDown(db);

    const after = await contentSnapshot(db);
    // El diff de vitest sobre dos snapshots completos es ilegible; con
    // DUMP_SNAPSHOTS=<dir> quedan los dos JSON en disco para compararlos.
    if (process.env.DUMP_SNAPSHOTS) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(`${process.env.DUMP_SNAPSHOTS}/before.json`, JSON.stringify(before, null, 1));
      writeFileSync(`${process.env.DUMP_SNAPSHOTS}/after.json`, JSON.stringify(after, null, 1));
    }
    expect(after).toEqual(before);
  }, 180_000);

  it("se pueden volver a aplicar después del rollback", async () => {
    await migrateLatestFor(db);
    const pending = await pendingMigrations(db);
    expect(pending).toEqual([]);

    // El contenido del cliente sigue ahí tras el ciclo completo.
    const page = await db("pages").where({ slug: "pagina-del-cliente" }).first("id");
    expect(page).toBeTruthy();
    expect(await db("blocks").where({ page_id: page.id })).toHaveLength(2);
  }, 120_000);
});

/**
 * Rollback de la fuente única sobre un canal social que **ya existía**.
 *
 * Es el caso que el snapshot no cubría: si `settings.social` traía una URL y
 * el canal de esa red ya estaba creado pero vacío, `up()` le escribía `href` y
 * `value`. El snapshot guardaba sólo `value`, así que `down()` devolvía el
 * valor y dejaba el `href` modificado: el sitio seguía enlazando a un perfil
 * que el sanatorio no había cargado ahí.
 *
 * La prueba arranca de una fila con TODAS las columnas distintas de lo que la
 * migración escribiría, corre `up()`, corre `down()` y compara la fila entera.
 */
const SOCIAL_DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_social`;
const FUENTE_UNICA = "20260816000000_fuente_unica_contacto.ts";

describeDb("rollback de la fuente única con redes ya cargadas", () => {
  let db: Knex;
  /** La fila completa, tal como la dejó el sanatorio antes de migrar. */
  let before: Record<string, unknown>;
  let beforeContact: unknown;
  let beforeSocial: unknown;

  const CHANNEL_COLUMNS = [
    "key", "label", "kind", "value", "href", "note", "message", "icon", "active", "order",
  ];

  const readChannel = async (key: string) =>
    db("contact_channels").where({ key }).first(...CHANNEL_COLUMNS);

  beforeAll(async () => {
    db = await createTestDatabase(SOCIAL_DB_NAME);

    // Todo lo anterior a la fuente única.
    let guard = 0;
    while (guard++ < 100) {
      const pending = await pendingMigrations(db);
      if (!pending[0] || pending[0] === FUENTE_UNICA) break;
      await migrateUpOne(db);
    }

    // El canal de Facebook ya existe, cargado a mano y con otros valores en
    // cada columna. `value` vacío es la condición que hace que `up()` escriba.
    await db("contact_channels").where({ key: "facebook" }).del();
    await db("contact_channels").insert({
      key: "facebook",
      label: "Facebook del sanatorio",
      kind: "url",
      value: null,
      href: "https://facebook.com/perfil-cargado-a-mano",
      note: "Nota escrita por el sanatorio.",
      message: "Mensaje propio",
      icon: "facebook",
      active: true,
      order: 77,
    });

    // Y `settings.social` trae una URL distinta: es lo que `up()` va a mover.
    const contactRow = await db("settings").where({ key: "contact" }).first("value");
    beforeContact = jsonColumn(contactRow?.value);
    await db("settings")
      .insert({
        key: "social",
        value: JSON.stringify({ facebook: "https://facebook.com/movido-por-la-migracion" }),
        updated_at: db.fn.now(),
      })
      .onConflict("key")
      .merge({ value: JSON.stringify({ facebook: "https://facebook.com/movido-por-la-migracion" }) });
    beforeSocial = jsonColumn((await db("settings").where({ key: "social" }).first("value"))?.value);

    before = (await readChannel("facebook")) as Record<string, unknown>;
  }, 180_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(SOCIAL_DB_NAME);
  });

  it("up() efectivamente modifica la fila que ya existía", async () => {
    const mig = await migrationSource.getMigration(FUENTE_UNICA);
    await mig.up(db);

    const after = await readChannel("facebook");
    // Si esto no cambiara, la prueba del rollback no probaría nada.
    expect(after.href).toBe("https://facebook.com/movido-por-la-migracion");
    expect(after.value).toBe("https://facebook.com/movido-por-la-migracion");
    expect(after.href).not.toBe(before.href);
  }, 120_000);

  it("down() devuelve la fila entera, no sólo el value", async () => {
    const mig = await migrationSource.getMigration(FUENTE_UNICA);
    await mig.down(db);

    const after = await readChannel("facebook");
    // Columna por columna: el diff dice cuál quedó mal.
    for (const column of CHANNEL_COLUMNS) {
      expect(after[column], `columna ${column}`).toEqual(before[column]);
    }
    expect(after).toEqual(before);
  }, 120_000);

  it("down() no borra el canal que ya existía", async () => {
    expect(await readChannel("facebook")).toBeTruthy();
  });

  it("down() restaura también settings.contact y settings.social", async () => {
    const contact = jsonColumn((await db("settings").where({ key: "contact" }).first("value"))?.value);
    expect(contact).toEqual(beforeContact);
    const social = jsonColumn((await db("settings").where({ key: "social" }).first("value"))?.value);
    expect(social).toEqual(beforeSocial);
    // Y el snapshot se va con la migración.
    const snapshot = await db("settings")
      .where({ key: "snapshot_fuente_unica_contacto_20260816000000" })
      .first();
    expect(snapshot).toBeUndefined();
  });

  it("los canales que sí creó la migración se borran al revertir", async () => {
    // `instagram` no existía antes: `up()` lo creó y `down()` lo sacó.
    expect(await readChannel("instagram")).toBeUndefined();
  });
});
