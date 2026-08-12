import type { Knex } from "knex";

/**
 * Correcciones sobre la minuta, a partir de la auditoría del PR #1.
 *
 *  2. Odontología: la página listaba médicos de cualquier especialidad.
 *  7. Noticias: se elimina cualquier bloque que pudiera volver a publicarla.
 *  9. Infografía real de pasos en Turnos y en el home.
 * 10. Iconos repetidos dentro de una misma grilla (estudios y especialidades).
 * 18. Horarios: se retiran los horarios de ejemplo; pasan a `schedules`.
 * 19. Biopsias: se quitan las afirmaciones médicas no confirmadas.
 * 23. Portal del Paciente: una sola ruta canónica, sin páginas duplicadas.
 * 24. Convenios: sin grilla de logos vacía.
 *
 * Idempotente y con `down()` que restaura el estado previo desde un backup
 * propio (no pisa el backup de la migración anterior).
 */

const BACKUP_KEY = "minuta_correcciones_backup_20260813000002";

/** Iconos que quedaban repetidos dentro de la misma grilla. */
const STUDY_ICON_FIXES: Record<string, string> = {
  densitometria: "ruler",
  "eco-doppler-periferico": "route",
  "citologia-papanicolaou": "test-tubes",
  "eco-estres-farmacologico": "syringe",
};

const SPECIALTY_ICON_FIXES: Record<string, string> = {
  neonatologia: "hand-heart",
};

/** Páginas del portal que se unifican bajo /portal-paciente. */
const PORTAL_DUPLICATES = [
  "portal-resultados-diagnostico",
  "portal-resultados-laboratorio",
  "portal-presupuestos-cirugia",
  "portal-facturacion-electronica",
];

const TURNOS_STEPS = {
  type: "steps",
  props: {
    heading: "Cómo sacar tu turno",
    text: "Cuatro pasos para coordinar tu consulta o estudio.",
    muted: true,
    items: [
      {
        title: "Elegí el servicio o profesional",
        text: "Buscá por especialidad o por médico en la guía médica.",
        icon: "search",
      },
      {
        title: "Escribinos por WhatsApp",
        text: "Usá el canal según el tipo de atención que necesitás.",
        icon: "message-circle",
      },
      {
        title: "Confirmá el turno",
        text: "Recepción te confirma día y hora disponibles.",
        icon: "calendar-check",
      },
      {
        title: "Vení con tu documentación",
        text: "Documento, credencial del seguro y la orden médica si corresponde.",
        icon: "clipboard-list",
      },
    ],
  },
};

type BlockSpec = { type: string; props: Record<string, unknown> };

function parseJson(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Reemplaza los bloques de una página guardando los anteriores en el backup. */
async function replaceBlocks(
  knex: Knex,
  slug: string,
  blocks: BlockSpec[],
  backup: { pageSlug: string; type: string; order: number; props: unknown }[],
) {
  const page = await knex("pages").where({ slug }).first("id");
  if (!page) return;

  const current = await knex("blocks").where({ page_id: page.id }).orderBy("order");
  for (const b of current) {
    backup.push({ pageSlug: slug, type: b.type, order: b.order, props: parseJson(b.props) });
  }
  await knex("blocks").where({ page_id: page.id }).del();
  await knex("blocks").insert(
    blocks.map((b, i) => ({
      page_id: page.id,
      type: b.type,
      order: i,
      props: JSON.stringify(b.props),
    })),
  );
}

export async function up(knex: Knex): Promise<void> {
  const backup: { pageSlug: string; type: string; order: number; props: unknown }[] = [];

  // ---------------------------------------------------------- 10. iconos
  for (const [slug, icon] of Object.entries(STUDY_ICON_FIXES)) {
    await knex("studies").where({ slug }).update({ icon });
  }
  for (const [slug, icon] of Object.entries(SPECIALTY_ICON_FIXES)) {
    await knex("specialties").where({ slug }).update({ icon });
  }

  // ------------------------------------------------- 7. Noticias fuera del sitio
  // Cualquier bloque newsGrid que hubiera quedado (o que se agregue desde una
  // copia vieja del admin) se elimina: la sección no vuelve por accidente.
  const newsBlocks = await knex("blocks").where({ type: "newsGrid" });
  for (const b of newsBlocks) {
    const page = await knex("pages").where({ id: b.page_id }).first("slug");
    backup.push({
      pageSlug: page?.slug ?? "",
      type: b.type,
      order: b.order,
      props: parseJson(b.props),
    });
  }
  if (newsBlocks.length) {
    await knex("blocks").whereIn("id", newsBlocks.map((b) => b.id)).del();
  }
  await knex("pages").where({ slug: "noticias" }).del();

  // ------------------------------------------------------- 2. Odontología
  await replaceBlocks(knex, "odontologia", [
    {
      type: "hero",
      props: {
        title: "Odontología",
        subtitle: "Atención odontológica general, preventiva y especializada",
        variant: "centered",
        ctaLabel: "Reservar turno",
        ctaHref: "/turnos",
      },
    },
    {
      type: "richText",
      props: {
        html:
          "<p>El servicio de Odontología atiende a pacientes de todas las edades.</p>" +
          "<p><em>Prestaciones, profesionales y días de atención: a confirmar con el sanatorio antes de publicarlos.</em></p>",
      },
    },
    {
      type: "doctorList",
      props: {
        heading: "Profesionales de Odontología",
        // specialtySlug + lockSpecialty: la página nunca lista médicos de otras
        // especialidades, ni siquiera mientras cargan los datos.
        specialtySlug: "odontologia",
        lockSpecialty: true,
        showSearch: true,
        emptyText:
          "Todavía no hay profesionales de Odontología cargados en la guía médica. Escribinos y te orientamos.",
      },
    },
  ], backup);

  // ---------------------------------------------------------- 18. Horarios
  await replaceBlocks(knex, "horarios", [
    {
      type: "hero",
      props: {
        title: "Horarios de atención",
        subtitle: "Consultorios, recepción, estudios y emergencias",
        variant: "centered",
      },
    },
    {
      type: "scheduleTable",
      props: {
        heading: "",
        text: "",
      },
    },
    {
      type: "cards",
      props: {
        heading: "Información relacionada",
        columns: 3,
        items: [
          { title: "Horario de visitas", text: "Normas y horarios por área.", icon: "calendar-check", href: "/info-horario-visitas" },
          { title: "Reglamento para visitas", text: "Para el bienestar de todos los pacientes.", icon: "list-checks", href: "/info-reglamento-visitas" },
          { title: "Retiro de estudios", text: "Cuándo y cómo retirar resultados.", icon: "file-text", href: "/info-horarios-estudios" },
        ],
      },
    },
  ], backup);

  // Las páginas de info con horarios de ejemplo pasan a apuntar a /horarios.
  await replaceBlocks(knex, "info-horario-visitas", [
    {
      type: "hero",
      props: { title: "Horario de visitas", subtitle: "Horarios y normas para visitar pacientes", variant: "centered" },
    },
    {
      type: "richText",
      props: {
        html:
          "<p>Las visitas a pacientes internados se realizan en horarios pautados que respetan el descanso y la recuperación.</p>" +
          "<p>Las áreas críticas (UTI/UCO) tienen horarios especiales.</p>" +
          "<p><em>Los horarios definitivos se publican en <a href=\"/horarios\">Horarios de atención</a> a medida que el sanatorio los confirma. Ante cualquier duda, consultanos.</em></p>",
      },
    },
    { type: "scheduleTable", props: { heading: "Horarios publicados", areaKeys: ["visitas"] } },
  ], backup);

  await replaceBlocks(knex, "info-horario-recepcion", [
    {
      type: "hero",
      props: { title: "Horario de recepción", subtitle: "Atención administrativa y consultas externas", variant: "centered" },
    },
    {
      type: "richText",
      props: {
        html:
          "<p>Recepción y admisión atienden de forma presencial para turnos, admisión e información general.</p>" +
          "<p><em>Los horarios definitivos se publican en <a href=\"/horarios\">Horarios de atención</a>.</em></p>" +
          "<p>Emergencias funciona las 24 horas, todos los días del año.</p>",
      },
    },
    { type: "scheduleTable", props: { heading: "Horarios publicados", areaKeys: ["recepcion", "consultorios"] } },
  ], backup);

  await replaceBlocks(knex, "info-horarios-estudios", [
    {
      type: "hero",
      props: { title: "Retiro de estudios", subtitle: "Cómo retirar tus resultados", variant: "centered" },
    },
    {
      type: "richText",
      props: {
        html:
          "<p>Los resultados de estudios se retiran en recepción presentando el comprobante de la orden.</p>" +
          "<p><em>Los horarios de retiro se publican en <a href=\"/horarios\">Horarios de atención</a> una vez confirmados.</em></p>" +
          "<p>Próximamente vas a poder consultarlos desde el <a href=\"/portal-paciente\">Portal del paciente</a>.</p>",
      },
    },
    { type: "scheduleTable", props: { heading: "Horarios publicados", areaKeys: ["retiro-estudios"] } },
  ], backup);

  // --------------------------------------------------------- 19. Biopsias
  // Sin circuito, plazos ni tipos de estudio: nada de eso está confirmado.
  await replaceBlocks(knex, "estudios-biopsias", [
    {
      type: "hero",
      props: {
        title: "Biopsias y anatomía patológica",
        subtitle: "Información en proceso de validación",
        variant: "centered",
      },
    },
    {
      type: "richText",
      props: {
        html:
          "<p>El sanatorio cuenta con servicio de anatomía patológica para el estudio de las muestras que indica tu médico.</p>" +
          "<p><strong>Estamos validando la información de esta sección</strong> junto al equipo médico: prestaciones incluidas, requisitos, preparación previa, plazos de entrega y aranceles.</p>" +
          "<p>Mientras tanto, consultanos por los canales de contacto y te respondemos según tu caso, o hablá con el profesional que indicó el estudio.</p>",
      },
    },
    {
      type: "contactChannels",
      props: {
        heading: "Consultanos",
        text: "Te respondemos por el canal que prefieras.",
        columns: 3,
        keys: ["whatsapp-estudios", "recepcion", "email-general"],
      },
    },
  ], backup);

  // Los estudios de la categoría biopsias dejan de publicarse como prestación
  // confirmada hasta que el sanatorio valide el alcance.
  await knex("studies").where({ category: "biopsias" }).whereNot({ slug: "biopsias" }).del();
  await knex("studies").where({ slug: "biopsias" }).update({
    name: "Biopsias (anatomía patológica)",
    description: "Estudio de muestras indicado por tu médico. Alcance en validación.",
  });

  // -------------------------------------------- 23. Portal del paciente único
  await replaceBlocks(knex, "portal-paciente", [
    {
      type: "hero",
      props: {
        title: "Portal del paciente",
        subtitle: "Resultados, presupuestos y facturación en un solo lugar",
        variant: "centered",
      },
    },
    {
      type: "richText",
      props: {
        html:
          "<p>Estamos desarrollando un portal para consultar y descargar tus resultados, presupuestos y facturas de forma segura.</p>" +
          "<p><em>Las funciones se habilitan de forma progresiva. Mientras tanto, los resultados se retiran en recepción.</em></p>",
      },
    },
    {
      type: "accordion",
      props: {
        heading: "Qué vas a poder hacer",
        items: [
          {
            title: "Resultados de estudios diagnósticos",
            body: "<p>Consultar y descargar informes de imágenes y estudios diagnósticos. <em>En desarrollo.</em></p>",
          },
          {
            title: "Resultados de laboratorio",
            body: "<p>Ver tus análisis clínicos desde cualquier dispositivo. <em>En desarrollo.</em></p>",
          },
          {
            title: "Presupuestos de cirugía",
            body: "<p>Consultar el detalle del presupuesto antes de la internación. <em>En desarrollo.</em></p>",
          },
          {
            title: "Facturación electrónica",
            body: "<p>Descargar tus facturas electrónicas. <em>En desarrollo.</em></p>",
          },
        ],
      },
    },
    {
      type: "cards",
      props: {
        heading: "Mientras tanto",
        columns: 2,
        items: [
          { title: "Retiro de estudios", text: "Cómo retirar tus resultados en recepción.", icon: "file-text", href: "/info-horarios-estudios" },
          { title: "Atención al paciente", text: "Consultas, sugerencias y reclamos.", icon: "hand-heart", href: "/atencion-al-paciente" },
        ],
      },
    },
  ], backup);

  // Las cuatro páginas duplicadas salen del sitio público (y del sitemap).
  // No se borran: quedan despublicadas por si el cliente quiere recuperarlas.
  await knex("pages").whereIn("slug", PORTAL_DUPLICATES).update({ status: "draft" });

  // --------------------------------------------------------- 24. Convenios
  await replaceBlocks(knex, "convenios", [
    {
      type: "hero",
      props: {
        title: "Convenios",
        subtitle: "Trabajamos con aseguradoras y empresas",
        variant: "centered",
      },
    },
    {
      type: "richText",
      props: {
        html:
          "<p>El Sanatorio Adventista de Asunción atiende a afiliados de distintas aseguradoras, seguros médicos y empresas.</p>" +
          "<p>Para confirmar si tu cobertura tiene convenio vigente y qué prestaciones incluye, escribinos o consultá en recepción.</p>",
      },
    },
    {
      type: "contactChannels",
      props: {
        heading: "Consultá por tu cobertura",
        columns: 2,
        keys: ["whatsapp-samap", "recepcion"],
      },
    },
  ], backup);

  // ------------------------------------------------- 9. Infografía de pasos
  const turnos = await knex("pages").where({ slug: "turnos" }).first("id");
  if (turnos) {
    const existing = await knex("blocks").where({ page_id: turnos.id, type: "steps" }).first();
    if (!existing) {
      const all = await knex("blocks").where({ page_id: turnos.id }).orderBy("order");
      // Después del bloque de canales (WhatsApp sigue primero).
      const channelsIdx = all.findIndex((b) => b.type === "contactChannels");
      const insertAfter = channelsIdx >= 0 ? all[channelsIdx].order : 0;
      await knex("blocks")
        .where({ page_id: turnos.id })
        .andWhere("order", ">", insertAfter)
        .increment("order", 1);
      await knex("blocks").insert({
        page_id: turnos.id,
        type: TURNOS_STEPS.type,
        order: insertAfter + 1,
        props: JSON.stringify(TURNOS_STEPS.props),
      });
    }
  }

  // ------------------- 18/25. settings sin datos no confirmados
  // `contact.hours` publicaba un horario de ejemplo en el pie de página.
  // Los horarios reales viven ahora en `schedules` (administrables) y el pie
  // enlaza a /horarios mientras no haya nada confirmado.
  const contactRow = await knex("settings").where({ key: "contact" }).first();
  if (contactRow) {
    const contact = parseJson(contactRow.value) ?? {};
    const EXAMPLE_HOURS = [
      "Consultorios externos: lunes a viernes 7:00 - 19:00 | sábados 8:00 - 12:00\nEmergencias: 24 horas, todos los días",
      "Lunes a Viernes 7:00 - 19:00 | Sábados 8:00 - 12:00",
    ];
    if (typeof contact.hours === "string" && EXAMPLE_HOURS.includes(contact.hours)) {
      contact.hours = "";
    }
    // Los teléfonos/WhatsApp/correos viven en `contact_channels`; dejar copias
    // acá sería tener dos fuentes de verdad.
    delete contact.whatsapp;
    delete contact.emergencyPhone;
    delete contact.gthEmail;
    // Los de ejemplo del seed original se descartan; los reales ya fueron
    // adoptados como canales por la migración anterior.
    const PLACEHOLDER_CONTACT = new Set([
      "+595 21 000 000",
      "+59521000000",
      "+595981000000",
      "contacto@sanatorioadventista.com.py",
    ]);
    if (Array.isArray(contact.phones)) {
      contact.phones = contact.phones.filter(
        (p: unknown) => typeof p === "string" && !PLACEHOLDER_CONTACT.has(p.trim()),
      );
    }
    if (typeof contact.email === "string" && PLACEHOLDER_CONTACT.has(contact.email.trim())) {
      contact.email = "";
    }
    await knex("settings")
      .where({ key: "contact" })
      .update({ value: JSON.stringify(contact), updated_at: knex.fn.now() });
  }

  // ------------------------------------------------------------ backup
  // Clave propia: no se pisa el backup de la migración de la minuta.
  const existingBackup = await knex("settings").where({ key: BACKUP_KEY }).first();
  if (!existingBackup) {
    await knex("settings").insert({
      key: BACKUP_KEY,
      value: JSON.stringify({ createdAt: new Date().toISOString(), blocks: backup }),
      updated_at: knex.fn.now(),
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const backupRow = await knex("settings").where({ key: BACKUP_KEY }).first("value");
  if (backupRow) {
    const backup = parseJson(backupRow.value) as {
      blocks?: { pageSlug: string; type: string; order: number; props: unknown }[];
    };
    const blocks = Array.isArray(backup?.blocks) ? backup.blocks : [];
    const slugs = Array.from(new Set(blocks.map((b) => b.pageSlug).filter(Boolean)));
    for (const slug of slugs) {
      const page = await knex("pages").where({ slug }).first("id");
      if (!page) continue;
      await knex("blocks").where({ page_id: page.id }).del();
      const rows = blocks
        .filter((b) => b.pageSlug === slug)
        .map((b) => ({
          page_id: page.id,
          type: b.type,
          order: b.order,
          props: JSON.stringify(b.props ?? {}),
        }));
      if (rows.length) await knex("blocks").insert(rows);
    }
    await knex("settings").where({ key: BACKUP_KEY }).del();
  }

  await knex("pages").whereIn("slug", PORTAL_DUPLICATES).update({ status: "published" });
}
