import type { Knex } from "knex";

/**
 * Retira del sitio toda afirmación institucional que el sanatorio todavía no
 * confirmó por escrito, y deja el mecanismo para publicarla desde el panel
 * cuando llegue el dato.
 *
 * Qué se retira (auditoría de la fase 2):
 *  - horarios concretos en /pacientes y en las páginas de info;
 *  - "24 horas / 24/7" como afirmación de cobertura;
 *  - estadísticas 50+ / 90+ / 30+;
 *  - "equipamiento de última generación", "alta definición", "multicorte";
 *  - catálogos de estudios (imágenes, cardiológicos, laboratorio, biopsias):
 *    pasan a `published = false` y se publican desde el panel;
 *  - afirmaciones de Odontología ("todas las edades") y de Biopsias
 *    ("contamos con anatomía patológica").
 *
 * Cómo se hace, a diferencia de la migración anterior:
 *  - **No destruye ediciones del cliente**: guarda un snapshot completo la
 *    primera vez y, si ya corrió, no vuelve a tocar los bloques. Una segunda
 *    ejecución de `up()` conserva lo que se haya editado desde el panel.
 *  - **`down()` restaura el estado exacto** desde ese snapshot: bloques,
 *    estado de páginas, iconos, estudios, settings y menús.
 */

const SNAPSHOT_KEY = "snapshot_contenido_no_confirmado_20260814000000";

/** Texto neutral reutilizable cuando falta confirmación del sanatorio. */
const PENDING = "Información a confirmar con el sanatorio.";

interface BlockRow {
  id: number;
  page_id: number;
  type: string;
  order: number;
  props: unknown;
}

interface Snapshot {
  createdAt: string;
  /** Bloques completos de las páginas tocadas, con su slug. */
  blocks: { pageSlug: string; type: string; order: number; props: unknown }[];
  /** Estado (published/draft) de las páginas tocadas. */
  pageStatus: { slug: string; status: string }[];
  /** Filas de estudios afectadas. */
  studies: { slug: string; published?: number | null; description: string | null; name: string }[];
  /** Iconos de especialidades afectados. */
  specialties: { slug: string; icon: string | null }[];
  /** Descripciones de servicios afectadas. */
  services: { slug: string; description: string | null }[];
  /** Valores previos de settings. */
  settings: { key: string; value: unknown }[];
  /** Menús previos. */
  menus: { location: string; items: unknown }[];
}

function parseJson(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Páginas cuyo contenido revisa esta migración. */
const AFFECTED_PAGES = [
  "home",
  "institucional",
  "servicios",
  "pacientes",
  "odontologia",
  "emergencias",
  "estudios",
  "estudios-diagnostico-imagenes",
  "estudios-cardiologicos",
  "estudios-laboratorio",
  "estudios-biopsias",
  "info-horario-recepcion",
  "info-horario-visitas",
  "info-horarios-estudios",
  "portal-resultados-diagnostico",
];

export async function up(knex: Knex): Promise<void> {
  // ------------------------------------------------------------- schema
  // `published` permite tener el catálogo cargado sin afirmar públicamente
  // que la prestación existe, igual que `active` en `schedules`.
  const hasPublished = await knex.schema.hasColumn("studies", "published");
  if (!hasPublished) {
    await knex.schema.alterTable("studies", (t) => {
      t.boolean("published").notNullable().defaultTo(false);
    });
  }

  // Si ya corrió, no volvemos a tocar contenido: las ediciones que el cliente
  // haya hecho desde el panel se conservan.
  const alreadyRan = await knex("settings").where({ key: SNAPSHOT_KEY }).first();
  if (alreadyRan) return;

  // ------------------------------------------------------------ snapshot
  const snapshot: Snapshot = {
    createdAt: new Date().toISOString(),
    blocks: [],
    pageStatus: [],
    studies: [],
    specialties: [],
    services: [],
    settings: [],
    menus: [],
  };

  const pages = await knex("pages").whereIn("slug", AFFECTED_PAGES).select("id", "slug", "status");
  const pageBySlug = new Map(pages.map((p) => [p.slug as string, p]));
  for (const page of pages) {
    snapshot.pageStatus.push({ slug: page.slug, status: page.status });
    const blocks = await knex("blocks").where({ page_id: page.id }).orderBy("order");
    for (const b of blocks as BlockRow[]) {
      snapshot.blocks.push({
        pageSlug: page.slug,
        type: b.type,
        order: b.order,
        props: parseJson(b.props),
      });
    }
  }

  const studies = await knex("studies").select("slug", "name", "description", "published");
  snapshot.studies = studies.map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description ?? null,
    published: s.published ?? null,
  }));

  const specialties = await knex("specialties").select("slug", "icon");
  snapshot.specialties = specialties.map((s) => ({ slug: s.slug, icon: s.icon ?? null }));

  const servicesRows = await knex("services").select("slug", "description");
  snapshot.services = servicesRows.map((s) => ({ slug: s.slug, description: s.description ?? null }));

  const settingsRows = await knex("settings").whereIn("key", ["contact", "seo", "brand"]);
  snapshot.settings = settingsRows.map((r) => ({ key: r.key, value: parseJson(r.value) }));

  const menuRows = await knex("menus").select("location", "items");
  snapshot.menus = menuRows.map((m) => ({ location: m.location, items: parseJson(m.items) }));

  await knex("settings").insert({
    key: SNAPSHOT_KEY,
    value: JSON.stringify(snapshot),
    updated_at: knex.fn.now(),
  });

  // ------------------------------------------- 1. catálogos sin confirmar
  // Nada de esto se publica hasta que el sanatorio confirme la prestación.
  await knex("studies").update({ published: false });

  // Las descripciones que afirmaban características del equipamiento se
  // reemplazan por el texto neutral; el nombre del estudio se conserva para
  // que el panel pueda revisarlo y publicarlo.
  await knex("studies")
    .where("description", "like", "%última generación%")
    .orWhere("description", "like", "%alta definición%")
    .orWhere("description", "like", "%multicorte%")
    .orWhere("description", "like", "%24 horas%")
    .update({ description: PENDING });

  // ------------------------------------------------- 2. bloques de páginas
  const setBlocks = async (slug: string, blocks: { type: string; props: unknown }[]) => {
    const page = pageBySlug.get(slug);
    if (!page) return;
    await knex("blocks").where({ page_id: page.id }).del();
    if (blocks.length === 0) return;
    await knex("blocks").insert(
      blocks.map((b, i) => ({
        page_id: page.id,
        type: b.type,
        order: i,
        props: JSON.stringify(b.props),
      })),
    );
  };

  /** Reescribe sólo los bloques que matchean un predicado, conservando el resto. */
  const rewriteBlocks = async (
    slug: string,
    rewrite: (block: { type: string; props: any }) => { type: string; props: any } | null,
  ) => {
    const page = pageBySlug.get(slug);
    if (!page) return;
    const current = await knex("blocks").where({ page_id: page.id }).orderBy("order");
    const next: { type: string; props: any }[] = [];
    for (const b of current as BlockRow[]) {
      const result = rewrite({ type: b.type, props: parseJson(b.props) });
      if (result) next.push(result);
    }
    await setBlocks(slug, next);
  };

  // home / institucional: fuera las estadísticas sin respaldo.
  for (const slug of ["home", "institucional"]) {
    await rewriteBlocks(slug, (block) => (block.type === "stats" ? null : block));
  }

  // home / servicios: las tarjetas de estudios pierden el detalle de
  // prestaciones y quedan como navegación.
  const neutralStudyCards = (block: { type: string; props: any }) => {
    if (block.type !== "cards" || block.props?.heading !== "Estudios y diagnóstico") return block;
    return {
      type: block.type,
      props: {
        ...block.props,
        items: (block.props.items ?? []).map((item: any) => ({
          title: item.title,
          icon: item.icon,
          href: item.href,
        })),
      },
    };
  };
  await rewriteBlocks("home", neutralStudyCards);
  await rewriteBlocks("servicios", neutralStudyCards);

  // home: el CTA de Emergencias no afirma cobertura horaria.
  await rewriteBlocks("home", (block) => {
    if (block.type !== "cta") return block;
    return {
      type: block.type,
      props: {
        ...block.props,
        title: "Emergencias",
        text: "Consultá los datos de contacto de Emergencias.",
        ctaLabel: "Ver Emergencias",
      },
    };
  });

  // pacientes: el acordeón publicaba horarios concretos.
  await rewriteBlocks("pacientes", (block) => {
    if (block.type !== "accordion") return block;
    return {
      type: block.type,
      props: {
        heading: "Información útil",
        items: [
          {
            title: "Horarios de atención",
            body:
              `<p>${PENDING} Los horarios se publican en ` +
              '<a href="/horarios">Horarios de atención</a> a medida que se confirman.</p>',
          },
          {
            title: "Horario de visitas",
            body:
              `<p>${PENDING} Ver <a href="/info-horario-visitas">Horario de visitas</a>.</p>`,
          },
          {
            title: "Reglamento para visitas",
            body:
              '<p>Consultá el <a href="/info-reglamento-visitas">reglamento para visitas</a>.</p>',
          },
          {
            title: "Retiro de estudios",
            body:
              '<p>Los resultados se retiran en recepción con el comprobante de la orden. ' +
              'Ver <a href="/info-horarios-estudios">Retiro de estudios</a>.</p>',
          },
          {
            title: "Preparación para estudios",
            body:
              '<p>Las indicaciones dependen del estudio y las define el profesional que lo solicita. ' +
              'Ver <a href="/info-preparacion-estudios">Preparación para estudios</a>.</p>',
          },
        ],
      },
    };
  });

  // Textos que afirmaban prestaciones o cobertura sin confirmación.
  const NEUTRAL_HTML: Record<string, string> = {
    odontologia:
      "<p>El sanatorio cuenta con servicio de Odontología.</p>" +
      `<p><em>${PENDING} Prestaciones, profesionales y días de atención se publican una vez confirmados.</em></p>`,
    emergencias:
      "<p>El sanatorio cuenta con servicio de urgencias y emergencias.</p>" +
      `<p><em>${PENDING} Cobertura horaria y teléfono directo se publican una vez confirmados.</em></p>`,
    "estudios-diagnostico-imagenes":
      "<p>Servicio de estudios por imágenes.</p>" +
      `<p><em>${PENDING} El listado de estudios disponibles se publica una vez confirmado.</em></p>`,
    "estudios-cardiologicos":
      "<p>Servicio de estudios cardiológicos.</p>" +
      `<p><em>${PENDING} El listado de estudios disponibles se publica una vez confirmado.</em></p>`,
    "estudios-laboratorio":
      "<p>Servicio de laboratorio de análisis clínicos.</p>" +
      `<p><em>${PENDING} El listado de análisis y los tiempos de entrega se publican una vez confirmados.</em></p>`,
    "estudios-biopsias":
      "<p>Sección de biopsias.</p>" +
      `<p><em>${PENDING} Alcance del servicio, requisitos, preparación y plazos se publican una vez confirmados.</em></p>`,
    "info-horario-recepcion":
      "<p>Recepción y admisión atienden de forma presencial para turnos, admisión e información general.</p>" +
      `<p><em>${PENDING} Ver <a href="/horarios">Horarios de atención</a>.</em></p>`,
    "info-horario-visitas":
      "<p>Las visitas a pacientes internados se realizan en horarios pautados que respetan el descanso y la recuperación.</p>" +
      `<p><em>${PENDING} Ver <a href="/horarios">Horarios de atención</a>.</em></p>`,
    "info-horarios-estudios":
      "<p>Los resultados de estudios se retiran en recepción presentando el comprobante de la orden.</p>" +
      `<p><em>${PENDING} Ver <a href="/horarios">Horarios de atención</a>.</em></p>`,
    "portal-resultados-diagnostico":
      "<p>Sección del portal del paciente para resultados de estudios diagnósticos.</p>" +
      `<p><em>${PENDING} En desarrollo.</em></p>`,
  };

  for (const [slug, html] of Object.entries(NEUTRAL_HTML)) {
    let replaced = false;
    await rewriteBlocks(slug, (block) => {
      if (block.type !== "richText" || replaced) return block;
      replaced = true;
      return { type: block.type, props: { html } };
    });
  }

  // Los acordeones de FAQ de estudios afirmaban circuitos y plazos.
  for (const slug of ["estudios-laboratorio", "estudios-biopsias"]) {
    await rewriteBlocks(slug, (block) => (block.type === "accordion" ? null : block));
  }

  // -------------------------------------- 3. descripciones de servicios
  const SERVICE_TEXT: Record<string, string> = {
    emergencias: "Servicio de urgencias y emergencias.",
    internacion: "Internación de adultos y niños.",
    uti: "Unidad de cuidados intensivos.",
    cirugia: "Servicio de cirugía.",
    maternidad: "Atención de la madre y el recién nacido.",
    consultorios: "Atención ambulatoria por especialidades.",
    odontologia: "Servicio de odontología.",
    "diagnostico-por-imagenes": "Servicio de estudios por imágenes.",
    "estudios-cardiologicos": "Servicio de estudios cardiológicos.",
    laboratorio: "Laboratorio de análisis clínicos.",
    biopsias: "Anatomía patológica.",
    "banco-de-sangre": "Banco de sangre.",
    fisioterapia: "Servicio de fisioterapia y rehabilitación.",
    "comedor-ovo-lacto-vegetariano": "Comedor ovo lacto vegetariano.",
    "seguro-medico-samap": "Seguro médico SAMAP.",
  };
  for (const [slug, description] of Object.entries(SERVICE_TEXT)) {
    await knex("services").where({ slug }).update({ description });
  }

  // --------------------------------------------------- 4. settings/SEO
  const contactRow = await knex("settings").where({ key: "contact" }).first();
  if (contactRow) {
    const contact = parseJson(contactRow.value) ?? {};
    contact.hours = "";
    await knex("settings")
      .where({ key: "contact" })
      .update({ value: JSON.stringify(contact), updated_at: knex.fn.now() });
  }
}

export async function down(knex: Knex): Promise<void> {
  const row = await knex("settings").where({ key: SNAPSHOT_KEY }).first("value");
  if (!row) return;
  const snapshot = parseJson(row.value) as Snapshot;

  // Bloques: se restauran exactamente como estaban, página por página.
  const slugs = Array.from(new Set((snapshot.blocks ?? []).map((b) => b.pageSlug)));
  for (const slug of slugs) {
    const page = await knex("pages").where({ slug }).first("id");
    if (!page) continue;
    await knex("blocks").where({ page_id: page.id }).del();
    const rows = snapshot.blocks
      .filter((b) => b.pageSlug === slug)
      .map((b) => ({
        page_id: page.id,
        type: b.type,
        order: b.order,
        props: JSON.stringify(b.props ?? {}),
      }));
    if (rows.length) await knex("blocks").insert(rows);
  }

  for (const p of snapshot.pageStatus ?? []) {
    await knex("pages").where({ slug: p.slug }).update({ status: p.status });
  }

  for (const s of snapshot.studies ?? []) {
    await knex("studies")
      .where({ slug: s.slug })
      .update({ name: s.name, description: s.description });
  }

  for (const s of snapshot.specialties ?? []) {
    await knex("specialties").where({ slug: s.slug }).update({ icon: s.icon });
  }

  for (const s of snapshot.services ?? []) {
    await knex("services").where({ slug: s.slug }).update({ description: s.description });
  }

  for (const s of snapshot.settings ?? []) {
    await knex("settings")
      .where({ key: s.key })
      .update({ value: JSON.stringify(s.value), updated_at: knex.fn.now() });
  }

  for (const m of snapshot.menus ?? []) {
    await knex("menus")
      .where({ location: m.location })
      .update({ items: JSON.stringify(m.items), updated_at: knex.fn.now() });
  }

  await knex("settings").where({ key: SNAPSHOT_KEY }).del();

  const hasPublished = await knex.schema.hasColumn("studies", "published");
  if (hasPublished) {
    await knex.schema.alterTable("studies", (t) => {
      t.dropColumn("published");
    });
  }
}
