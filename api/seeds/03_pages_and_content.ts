import type { Knex } from "knex";
// Las páginas y la estructura definitiva del sitio viven en las migraciones.
// El seed borra páginas y bloques, así que después de re-crear la base vuelve
// a aplicar esas migraciones (son idempotentes) para que una instalación
// nueva quede igual que producción.
// Se importan dinámicamente (el CLI de knex ejecuta los .ts directamente).
const CONTENT_MIGRATIONS = [
  "20260520000000_add_placeholder_pages",
  "20260521000000_patient_menu_pages",
  "20260523000000_specialties_and_studies_detail",
  "20260523000001_add_service_detail_placeholders",
  "20260812000000_web_minuta_ajustes",
];

async function applyContentMigrations(knex: Knex) {
  for (const name of CONTENT_MIGRATIONS) {
    const mod = await import(new URL(`../migrations/${name}.ts`, import.meta.url).href);
    await mod.up(knex);
  }
}

const SANATORIO_MAP_EMBED =
  '<iframe src="https://www.google.com/maps/embed?output=embed&q=Sanatorio%20Adventista%20de%20Asunci%C3%B3n%2C%20Asunci%C3%B3n%2C%20Paraguay" width="100%" height="400" style="border:0;" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>';

const SERVICE_DETAIL_PAGES = [
  {
    slug: "internacion",
    title: "Internación adultos y niños",
    subtitle: "Habitaciones y acompañamiento durante la estadía",
    html:
      "<p>Área destinada a la internación de pacientes adultos y pediátricos, con atención coordinada por el equipo médico y de enfermería.</p><p><strong>Contenido a completar por el cliente:</strong> fotos reales de habitaciones, amenities disponibles, normas para acompañantes, horarios de visita y recomendaciones para el ingreso.</p>",
    galleryLabel: "Fotos de habitaciones",
  },
  {
    slug: "uti",
    title: "Unidad de Terapia Intensiva",
    subtitle: "Cuidados críticos con monitoreo permanente",
    html:
      "<p>Unidad preparada para la atención de pacientes críticos que requieren monitoreo continuo y cuidados especializados.</p><p><strong>Contenido a completar por el cliente:</strong> staff responsable, horarios de visita para familiares, normas de ingreso, equipamiento disponible y canales de consulta.</p>",
    galleryLabel: "Fotos del área y staff de UTI",
  },
  {
    slug: "banco-de-sangre",
    title: "Banco de sangre",
    subtitle: "Donación, hemoterapia y procesamiento de hemocomponentes",
    html:
      "<p>Servicio orientado a la donación, conservación y uso seguro de sangre y hemocomponentes para pacientes que lo requieran.</p><p><strong>Contenido a completar por el cliente:</strong> staff del servicio, requisitos para donantes, horario de atención, teléfono dedicado y pasos para coordinar donaciones.</p>",
    galleryLabel: "Fotos del Banco de sangre y equipo",
  },
  {
    slug: "emergencias",
    title: "Emergencias 24hs",
    subtitle: "Guardia activa todos los días del año",
    html:
      "<p>Servicio de urgencias y emergencias disponible las 24 horas para la atención inicial de pacientes que requieren respuesta inmediata.</p><p><strong>Contenido a completar por el cliente:</strong> fotos del acceso de emergencias, equipo de guardia, indicaciones de ingreso, teléfono directo y cobertura horaria por especialidad.</p>",
    galleryLabel: "Fotos del acceso y equipo de emergencias",
  },
];

export async function seed(knex: Knex): Promise<void> {
  await knex("services").del();
  await knex("services").insert([
    { slug: "internacion", name: "Internación", icon: "bed", description: "Habitaciones individuales con confort hotelero.", order: 0 },
    { slug: "emergencias", name: "Emergencias 24hs", icon: "ambulance", description: "Guardia activa las 24 horas.", order: 1 },
    { slug: "cirugia", name: "Cirugía", icon: "stethoscope", description: "Quirófanos equipados con tecnología de última generación.", order: 2 },
    { slug: "consultorios", name: "Consultorios externos", icon: "clipboard", description: "Atención ambulatoria multidisciplinaria.", order: 3 },
    { slug: "maternidad", name: "Maternidad", icon: "baby", description: "Atención integral a la madre y al recién nacido.", order: 4 },
    { slug: "uti", name: "Terapia Intensiva", icon: "heart-pulse", description: "Unidad de cuidados intensivos adultos y pediátricos.", order: 5 },
  ]);

  // El listado completo de estudios (laboratorio, imágenes, cardiológicos y
  // biopsias, con categoría e icono) lo carga la migración de la minuta.
  await knex("studies").del();

  await knex("blocks").del();
  await knex("pages").del();

  const insertPage = async (
    slug: string,
    title: string,
    blocks: { type: string; props: unknown }[],
    order = 0,
  ) => {
    const [pageId] = await knex("pages").insert({
      slug,
      title,
      status: "published",
      seo: JSON.stringify({ title, description: title }),
      order,
    });
    for (let i = 0; i < blocks.length; i++) {
      await knex("blocks").insert({
        page_id: pageId,
        type: blocks[i].type,
        props: JSON.stringify(blocks[i].props),
        order: i,
      });
    }
  };

  await insertPage("home", "Inicio", [
    {
      type: "hero",
      props: {
        title: "Sanatorio Adventista de Asunción",
        subtitle: "Atención médica integral con vocación de servicio",
        variant: "centered",
        ctaLabel: "Solicitar turno",
        ctaHref: "/turnos",
      },
    },
    { type: "specialtyGrid", props: { columns: 4, showCount: 8 } },
    { type: "serviceGrid", props: { columns: 3, showCount: 6 } },
    {
      type: "cta",
      props: {
        title: "Emergencias 24hs",
        text: "Estamos para vos las 24 horas, los 365 días del año.",
        ctaLabel: "Ver contacto",
        ctaHref: "/contacto",
      },
    },
    { type: "newsGrid", props: { limit: 3, columns: 3 } },
  ], 0);

  await insertPage("institucional", "Institucional", [
    { type: "hero", props: { title: "Nosotros", subtitle: "Una institución al servicio de la salud", variant: "left" } },
    { type: "richText", props: { html: "<p>El Sanatorio Adventista de Asunción brinda atención médica integral con valores cristianos desde hace décadas.</p>" } },
    { type: "stats", props: { items: [{ value: "50+", label: "Años de servicio" }, { value: "90+", label: "Profesionales" }, { value: "24/7", label: "Emergencias" }] } },
  ], 1);

  await insertPage("especialidades", "Especialidades", [
    { type: "hero", props: { title: "Especialidades médicas", variant: "centered" } },
    { type: "specialtyGrid", props: { columns: 4 } },
  ], 2);

  await insertPage("profesionales", "Profesionales", [
    { type: "hero", props: { title: "Guía médica", subtitle: "Encontrá a tu profesional", variant: "centered" } },
    { type: "doctorList", props: { showSearch: true } },
  ], 3);

  await insertPage("servicios", "Servicios", [
    { type: "hero", props: { title: "Servicios", variant: "centered" } },
    { type: "serviceGrid", props: { columns: 3 } },
  ], 4);

  await insertPage("estudios", "Estudios", [
    { type: "hero", props: { title: "Estudios y diagnósticos", variant: "centered" } },
    { type: "studyGrid", props: { columns: 3, grouped: true } },
  ], 5);

  await insertPage("contacto", "Contacto", [
    { type: "hero", props: { title: "Contacto", variant: "centered" } },
    { type: "contactForm", props: { heading: "Escribinos", showPhone: true } },
    { type: "mapEmbed", props: { embedHtml: SANATORIO_MAP_EMBED, height: 400 } },
  ], 7);

  await insertPage("turnos", "Solicitar turno", [
    { type: "hero", props: { title: "Solicitar turno", variant: "centered" } },
    { type: "appointmentForm", props: { heading: "Reservá tu turno" } },
  ], 8);

  for (let i = 0; i < SERVICE_DETAIL_PAGES.length; i++) {
    const page = SERVICE_DETAIL_PAGES[i];
    await insertPage(page.slug, page.title, [
      {
        type: "hero",
        props: {
          title: page.title,
          subtitle: page.subtitle,
          variant: "centered",
          imageUrl: "",
          overlay: 35,
        },
      },
      { type: "richText", props: { html: page.html } },
      { type: "gallery", props: { columns: 3, images: [] } },
      {
        type: "richText",
        props: {
          html: `<p><em>${page.galleryLabel}: cargar imágenes desde /admin/media y agregarlas a esta galería desde el editor de páginas.</em></p>`,
        },
      },
    ], 300 + i);
  }

  // Re-aplicar el contenido que vive en las migraciones (todas idempotentes).
  await applyContentMigrations(knex);
}
