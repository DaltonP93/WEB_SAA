import type { Knex } from "knex";

/**
 * Contenido base del sitio para una instalación limpia.
 *
 * Este seed **no ejecuta migraciones**: crea directamente la estructura final
 * (las mismas páginas, menús y bloques que tiene producción tras aplicarlas).
 * Invocar `up()` de una migración desde acá volvía a pisar contenido y rompía
 * la reversibilidad del rollback.
 *
 * Reglas de contenido:
 *  - No se publica ningún dato institucional sin confirmar: horarios,
 *    teléfonos, prestaciones ni estadísticas. Todo eso se carga desde el panel
 *    (Canales de contacto, Horarios, Estudios).
 *  - Donde falta el dato, el texto lo dice explícitamente.
 */

const PENDING = "Información a confirmar con el sanatorio.";

/** Embed del mapa: el único iframe permitido, validado por sanitizeMapEmbed. */
const SANATORIO_MAP_EMBED =
  '<iframe src="https://www.google.com/maps?q=Sanatorio+Adventista+Asunci%C3%B3n,Silvio+Pettirossi+380,Asunci%C3%B3n,Paraguay&hl=es&z=17&output=embed" width="100%" height="450" style="border:0;" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>';

const MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=Sanatorio+Adventista+Asunci%C3%B3n+Paraguay";

type BlockSpec = { type: string; props: Record<string, unknown> };

/** Servicios del sanatorio. Descripciones sin afirmaciones no confirmadas. */
const SERVICES = [
  { slug: "emergencias", name: "Emergencias", icon: "siren", description: "Servicio de urgencias y emergencias.", order: 0 },
  { slug: "internacion", name: "Internación", icon: "bed", description: "Internación de adultos y niños.", order: 1 },
  { slug: "uti", name: "Terapia Intensiva", icon: "heart-pulse", description: "Unidad de cuidados intensivos.", order: 2 },
  { slug: "cirugia", name: "Cirugía", icon: "scissors", description: "Servicio de cirugía.", order: 3 },
  { slug: "maternidad", name: "Maternidad", icon: "baby", description: "Atención de la madre y el recién nacido.", order: 4 },
  { slug: "consultorios", name: "Consultorios externos", icon: "clipboard-list", description: "Atención ambulatoria por especialidades.", order: 5 },
  { slug: "odontologia", name: "Odontología", icon: "smile", description: "Servicio de odontología.", order: 6 },
  { slug: "diagnostico-por-imagenes", name: "Estudios por imágenes", icon: "scan", description: "Servicio de estudios por imágenes.", order: 7 },
  { slug: "estudios-cardiologicos", name: "Estudios cardiológicos", icon: "activity", description: "Servicio de estudios cardiológicos.", order: 8 },
  { slug: "laboratorio", name: "Laboratorio", icon: "flask-conical", description: "Laboratorio de análisis clínicos.", order: 9 },
  { slug: "biopsias", name: "Biopsias", icon: "microscope", description: "Anatomía patológica.", order: 10 },
  { slug: "banco-de-sangre", name: "Banco de sangre", icon: "droplet", description: "Banco de sangre.", order: 11 },
  { slug: "fisioterapia", name: "Fisioterapia", icon: "dumbbell", description: "Servicio de fisioterapia y rehabilitación.", order: 12 },
  { slug: "comedor-ovo-lacto-vegetariano", name: "Comedor ovo lacto vegetariano", icon: "salad", description: "Comedor ovo lacto vegetariano.", order: 13 },
  { slug: "seguro-medico-samap", name: "Seguro médico SAMAP", icon: "shield-check", description: "Seguro médico SAMAP.", order: 14 },
];

/**
 * Catálogo de estudios. Se carga **despublicado** (`published = false`): el
 * sitio no afirma que la prestación exista hasta que el sanatorio la confirme
 * y la publique desde el panel.
 */
const STUDIES = [
  { slug: "laboratorio", name: "Análisis clínicos", category: "laboratorio", icon: "flask-conical", order: 0 },
  { slug: "bacteriologia", name: "Análisis bacteriológicos", category: "laboratorio", icon: "bug", order: 1 },
  { slug: "tomografia", name: "Tomografía computada", category: "imagenes", icon: "scan", order: 10 },
  { slug: "resonancia", name: "Resonancia magnética", category: "imagenes", icon: "magnet", order: 11 },
  { slug: "ecografias", name: "Ecografías", category: "imagenes", icon: "waves", order: 12 },
  { slug: "ecografia-3d-4d", name: "Ecografía 3D y 4D", category: "imagenes", icon: "baby", order: 13 },
  { slug: "mamografia", name: "Mamografía", category: "imagenes", icon: "ribbon", order: 14 },
  { slug: "rayos-x", name: "Rayos X", category: "imagenes", icon: "bone", order: 15 },
  { slug: "densitometria", name: "Densitometría ósea", category: "imagenes", icon: "ruler", order: 16 },
  { slug: "endoscopia", name: "Endoscopía digestiva", category: "imagenes", icon: "search", order: 17 },
  { slug: "electrocardiograma", name: "Electrocardiograma", category: "cardiologicos", icon: "activity", order: 30 },
  { slug: "ecocardiograma-doppler", name: "Ecocardiograma Doppler", category: "cardiologicos", icon: "heart-pulse", order: 31 },
  { slug: "ecocardiografia-transesofagica", name: "Ecocardiografía transesofágica", category: "cardiologicos", icon: "heart", order: 32 },
  { slug: "eco-doppler-periferico", name: "Eco Doppler arterial y venoso", category: "cardiologicos", icon: "route", order: 33 },
  { slug: "ergometria", name: "Ergometría", category: "cardiologicos", icon: "dumbbell", order: 34 },
  { slug: "eco-estres-ejercicio", name: "Eco estrés con ejercicio", category: "cardiologicos", icon: "trending-up", order: 35 },
  { slug: "eco-estres-farmacologico", name: "Eco estrés farmacológico", category: "cardiologicos", icon: "syringe", order: 36 },
  { slug: "mapa", name: "MAPA (presión arterial)", category: "cardiologicos", icon: "gauge", order: 37 },
  { slug: "holter", name: "Holter", category: "cardiologicos", icon: "watch", order: 38 },
  { slug: "biopsias", name: "Biopsias (anatomía patológica)", category: "biopsias", icon: "microscope", order: 50 },
];

const HEADER_MENU = [
  { label: "Inicio", href: "/" },
  { label: "Institucional", href: "/institucional" },
  {
    label: "Servicios",
    href: "/servicios",
    children: [
      { label: "Todos los servicios", href: "/servicios" },
      { label: "Especialidades médicas", href: "/especialidades" },
      { label: "Odontología", href: "/odontologia" },
      { label: "Emergencias", href: "/emergencias" },
      { label: "Internación", href: "/internacion" },
      { label: "Terapia Intensiva", href: "/uti" },
      { label: "Banco de sangre", href: "/banco-de-sangre" },
      { label: "Estudios y laboratorio", href: "/estudios" },
      { label: "Estudios por imágenes", href: "/estudios-diagnostico-imagenes" },
      { label: "Estudios cardiológicos", href: "/estudios-cardiologicos" },
      { label: "Laboratorio clínico", href: "/estudios-laboratorio" },
      { label: "Biopsias", href: "/estudios-biopsias" },
      { label: "Preparación para estudios", href: "/info-preparacion-estudios" },
    ],
  },
  { label: "Médicos", href: "/profesionales" },
  {
    label: "Pacientes",
    href: "/pacientes",
    children: [
      {
        label: "Información",
        href: "/pacientes",
        children: [
          { label: "Horarios de atención", href: "/horarios" },
          { label: "Horario de visitas", href: "/info-horario-visitas" },
          { label: "Reglamento para visitas", href: "/info-reglamento-visitas" },
          { label: "Retiro de estudios", href: "/info-horarios-estudios" },
        ],
      },
      { label: "Portal del paciente", href: "/portal-paciente" },
      { label: "Atención al paciente", href: "/atencion-al-paciente" },
    ],
  },
  { label: "Convenios", href: "/convenios" },
  { label: "Contacto", href: "/contacto" },
];

const FOOTER_MENU = [
  { label: "Servicios", href: "/servicios" },
  { label: "Estudios y laboratorio", href: "/estudios" },
  { label: "Reservar turno", href: "/turnos" },
  { label: "Horarios de atención", href: "/horarios" },
  { label: "Pacientes", href: "/pacientes" },
  { label: "Convenios", href: "/convenios" },
  { label: "Trabajá con nosotros", href: "/contacto" },
  { label: "Política de privacidad", href: "/privacidad" },
];

const STUDY_LINK_CARDS: BlockSpec = {
  type: "cards",
  props: {
    heading: "Estudios y diagnóstico",
    columns: 4,
    items: [
      { title: "Estudios por imágenes", icon: "scan", href: "/estudios-diagnostico-imagenes" },
      { title: "Estudios cardiológicos", icon: "heart-pulse", href: "/estudios-cardiologicos" },
      { title: "Laboratorio clínico", icon: "flask-conical", href: "/estudios-laboratorio" },
      { title: "Biopsias", icon: "microscope", href: "/estudios-biopsias" },
    ],
  },
};

const MAP_BLOCK: BlockSpec = {
  type: "mapEmbed",
  props: { heading: "Cómo llegar", embedHtml: "", height: 420, directionsUrl: MAPS_URL },
};

/** Página de servicio/estudio con texto neutral mientras falta confirmación. */
function servicePage(title: string, subtitle: string, intro: string, extra: BlockSpec[] = []): BlockSpec[] {
  return [
    {
      type: "hero",
      props: { title, subtitle, variant: "centered", ctaLabel: "Reservar turno", ctaHref: "/turnos" },
    },
    { type: "richText", props: { html: `<p>${intro}</p><p><em>${PENDING}</em></p>` } },
    ...extra,
  ];
}

const PAGES: { slug: string; title: string; seoTitle?: string; description: string; status?: string; order: number; blocks: BlockSpec[] }[] = [
  {
    slug: "home",
    title: "Inicio",
    seoTitle: "Sanatorio Adventista de Asunción",
    description: "Sanatorio Adventista de Asunción — atención médica integral.",
    order: 0,
    blocks: [
      {
        type: "hero",
        props: {
          title: "Sanatorio Adventista de Asunción",
          subtitle: "Atención médica integral con vocación de servicio",
          variant: "centered",
          ctaLabel: "Reservar turno",
          ctaHref: "/turnos",
          secondaryCtaLabel: "Conocé a nuestros médicos",
          secondaryCtaHref: "/profesionales",
        },
      },
      { type: "serviceGrid", props: { heading: "Nuestros servicios", columns: 4, showCount: 8, compact: true } },
      { type: "specialtyGrid", props: { heading: "Especialidades médicas", columns: 4, showCount: 8 } },
      { ...STUDY_LINK_CARDS },
      {
        type: "cta",
        props: {
          title: "Emergencias",
          text: "Consultá los datos de contacto de Emergencias.",
          ctaLabel: "Ver Emergencias",
          ctaHref: "/emergencias",
          variant: "emergency",
        },
      },
      { ...MAP_BLOCK },
      { type: "socialLinks", props: { heading: "Conócenos en nuestras redes", muted: true } },
    ],
  },
  {
    slug: "institucional",
    title: "Institucional",
    description: "Quiénes somos.",
    order: 1,
    blocks: [
      { type: "hero", props: { title: "Nosotros", subtitle: "Una institución al servicio de la salud", variant: "left" } },
      {
        type: "richText",
        props: {
          html:
            "<p>El Sanatorio Adventista de Asunción brinda atención médica con valores cristianos.</p>" +
            `<p><em>${PENDING} Historia, trayectoria y cifras institucionales se publican una vez confirmadas.</em></p>`,
        },
      },
    ],
  },
  {
    slug: "especialidades",
    title: "Especialidades médicas",
    description: "Especialidades y profesionales del Sanatorio Adventista de Asunción.",
    order: 2,
    blocks: [
      {
        type: "hero",
        props: {
          title: "Especialidades médicas",
          subtitle: "Elegí una especialidad y conocé a sus profesionales",
          variant: "centered",
          ctaLabel: "Reservar turno",
          ctaHref: "/turnos",
        },
      },
      { type: "specialtyGrid", props: { heading: "", columns: 4 } },
      {
        type: "doctorList",
        props: {
          heading: "Buscá por especialidad y médico",
          intro: "Al elegir una especialidad se despliegan los médicos que la atienden.",
          showSearch: true,
        },
      },
    ],
  },
  {
    slug: "profesionales",
    title: "Guía médica",
    description: "Guía médica con filtros por especialidad y por médico.",
    order: 3,
    blocks: [
      { type: "hero", props: { title: "Conocé a nuestros médicos", variant: "centered" } },
      { type: "doctorList", props: { showSearch: true } },
    ],
  },
  {
    slug: "servicios",
    title: "Servicios",
    description: "Servicios del Sanatorio Adventista de Asunción.",
    order: 4,
    blocks: [
      {
        type: "hero",
        props: {
          title: "Servicios",
          subtitle: "Todo lo que ofrecemos, en un solo lugar",
          variant: "centered",
          ctaLabel: "Reservar turno",
          ctaHref: "/turnos",
        },
      },
      { type: "serviceGrid", props: { heading: "Servicios asistenciales", columns: 4, compact: true } },
      { ...STUDY_LINK_CARDS },
      { type: "specialtyGrid", props: { heading: "Especialidades médicas", columns: 4, compact: true } },
      {
        type: "doctorList",
        props: {
          heading: "Encontrá tu médico",
          intro: "Elegí una especialidad para ver los profesionales que la atienden.",
          showSearch: true,
          limit: 12,
        },
      },
    ],
  },
  {
    slug: "estudios",
    title: "Estudios y laboratorio",
    description: "Estudios por imágenes, cardiológicos, laboratorio y biopsias.",
    order: 5,
    blocks: [
      {
        type: "hero",
        props: {
          title: "Estudios y laboratorio",
          subtitle: "Diagnóstico por imágenes, cardiológicos, laboratorio y biopsias",
          variant: "centered",
          ctaLabel: "Reservar turno",
          ctaHref: "/turnos",
        },
      },
      { type: "studyGrid", props: { columns: 3, grouped: true } },
      {
        type: "cards",
        props: {
          heading: "Antes y después de tu estudio",
          columns: 3,
          items: [
            { title: "Preparación para estudios", icon: "clipboard-check", href: "/info-preparacion-estudios" },
            { title: "Retiro de resultados", icon: "clock", href: "/info-horarios-estudios" },
            { title: "Portal del paciente", icon: "monitor", href: "/portal-paciente" },
          ],
        },
      },
    ],
  },
  {
    slug: "contacto",
    title: "Contacto",
    description: "Canales de contacto del Sanatorio Adventista de Asunción.",
    order: 7,
    blocks: [
      { type: "hero", props: { title: "Contacto", subtitle: "Estamos para ayudarte", variant: "centered" } },
      {
        type: "contactChannels",
        props: {
          heading: "Canales de atención",
          text: "Escribinos por el canal que corresponda al tipo de atención que necesitás.",
          columns: 3,
          keys: [],
        },
      },
      { ...MAP_BLOCK },
      { type: "contactForm", props: { heading: "Escribinos", showPhone: true } },
      { type: "socialLinks", props: { heading: "Conócenos en nuestras redes", muted: true } },
    ],
  },
  {
    slug: "turnos",
    title: "Reservar turno",
    description: "Reservá tu turno por WhatsApp.",
    order: 8,
    blocks: [
      {
        type: "hero",
        props: {
          title: "Reservar turno",
          subtitle: "Coordiná tu consulta o estudio por WhatsApp",
          variant: "centered",
          ctaLabel: "Conocé a nuestros médicos",
          ctaHref: "/profesionales",
        },
      },
      {
        type: "contactChannels",
        props: {
          heading: "Reservá por WhatsApp",
          text: "La vía más rápida para coordinar tu turno con la recepción.",
          columns: 3,
          keys: ["whatsapp-turnos", "whatsapp-estudios", "emergencias"],
        },
      },
      {
        type: "steps",
        props: {
          heading: "Cómo sacar tu turno",
          text: "Cuatro pasos para coordinar tu consulta o estudio.",
          muted: true,
          items: [
            { title: "Elegí el servicio o profesional", text: "Buscá por especialidad o por médico en la guía médica.", icon: "search" },
            { title: "Escribinos por WhatsApp", text: "Usá el canal según el tipo de atención que necesitás.", icon: "message-circle" },
            { title: "Confirmá el turno", text: "Recepción te confirma día y hora disponibles.", icon: "calendar-check" },
            { title: "Vení con tu documentación", text: "Documento, credencial del seguro y la orden médica si corresponde.", icon: "clipboard-list" },
          ],
        },
      },
      {
        type: "cards",
        props: {
          heading: "Antes de reservar",
          columns: 3,
          items: [
            { title: "Conocé a nuestros médicos", icon: "users", href: "/profesionales" },
            { title: "Especialidades médicas", icon: "stethoscope", href: "/especialidades" },
            { title: "Preparación para estudios", icon: "clipboard-check", href: "/info-preparacion-estudios" },
          ],
        },
      },
      { type: "appointmentForm", props: { heading: "Formulario de solicitud" } },
    ],
  },
  {
    slug: "pacientes",
    title: "Pacientes",
    description: "Información para pacientes, portal y atención al paciente.",
    order: 20,
    blocks: [
      {
        type: "hero",
        props: { title: "Pacientes", subtitle: "Toda la información para tu visita y tus estudios", variant: "centered" },
      },
      {
        type: "cards",
        props: {
          heading: "",
          columns: 3,
          items: [
            { title: "Información", text: "Horarios, visitas y retiro de estudios.", icon: "info", href: "/horarios" },
            { title: "Portal del paciente", text: "Resultados y facturación en línea.", icon: "monitor", href: "/portal-paciente" },
            { title: "Atención al paciente", text: "Consultas, sugerencias y reclamos.", icon: "hand-heart", href: "/atencion-al-paciente" },
          ],
        },
      },
      {
        type: "accordion",
        props: {
          heading: "Información útil",
          items: [
            { title: "Horarios de atención", body: `<p>${PENDING} Se publican en <a href="/horarios">Horarios de atención</a>.</p>` },
            { title: "Horario de visitas", body: `<p>${PENDING} Ver <a href="/info-horario-visitas">Horario de visitas</a>.</p>` },
            { title: "Reglamento para visitas", body: '<p>Consultá el <a href="/info-reglamento-visitas">reglamento para visitas</a>.</p>' },
            { title: "Retiro de estudios", body: '<p>Los resultados se retiran en recepción con el comprobante. Ver <a href="/info-horarios-estudios">Retiro de estudios</a>.</p>' },
          ],
        },
      },
    ],
  },
  {
    slug: "portal-paciente",
    title: "Portal del paciente",
    description: "Resultados, presupuestos y facturación en un solo lugar.",
    order: 21,
    blocks: [
      { type: "hero", props: { title: "Portal del paciente", subtitle: "Resultados, presupuestos y facturación", variant: "centered" } },
      {
        type: "richText",
        props: {
          html:
            "<p>Estamos desarrollando un portal para consultar y descargar resultados, presupuestos y facturas.</p>" +
            "<p><em>Las funciones se habilitan de forma progresiva. Mientras tanto, los resultados se retiran en recepción.</em></p>",
        },
      },
      {
        type: "accordion",
        props: {
          heading: "Qué vas a poder hacer",
          items: [
            { title: "Resultados de estudios diagnósticos", body: "<p>En desarrollo.</p>" },
            { title: "Resultados de laboratorio", body: "<p>En desarrollo.</p>" },
            { title: "Presupuestos de cirugía", body: "<p>En desarrollo.</p>" },
            { title: "Facturación electrónica", body: "<p>En desarrollo.</p>" },
          ],
        },
      },
    ],
  },
  {
    slug: "horarios",
    title: "Horarios de atención",
    description: "Horarios de atención por área.",
    order: 22,
    blocks: [
      { type: "hero", props: { title: "Horarios de atención", variant: "centered" } },
      { type: "scheduleTable", props: { heading: "", text: "" } },
      {
        type: "cards",
        props: {
          heading: "Información relacionada",
          columns: 3,
          items: [
            { title: "Horario de visitas", icon: "calendar-check", href: "/info-horario-visitas" },
            { title: "Reglamento para visitas", icon: "list-checks", href: "/info-reglamento-visitas" },
            { title: "Retiro de estudios", icon: "file-text", href: "/info-horarios-estudios" },
          ],
        },
      },
    ],
  },
  {
    slug: "odontologia",
    title: "Odontología",
    description: "Servicio de odontología.",
    order: 23,
    blocks: [
      {
        type: "hero",
        props: { title: "Odontología", variant: "centered", ctaLabel: "Reservar turno", ctaHref: "/turnos" },
      },
      {
        type: "richText",
        props: {
          html:
            "<p>El sanatorio cuenta con servicio de Odontología.</p>" +
            `<p><em>${PENDING} Prestaciones, profesionales y días de atención se publican una vez confirmados.</em></p>`,
        },
      },
      {
        type: "doctorList",
        props: {
          heading: "Profesionales de Odontología",
          specialtySlug: "odontologia",
          lockSpecialty: true,
          showSearch: true,
          emptyText: "Todavía no hay profesionales de Odontología cargados en la guía médica.",
        },
      },
    ],
  },
  {
    slug: "privacidad",
    title: "Política de privacidad",
    description: "Política de privacidad y tratamiento de datos.",
    order: 24,
    blocks: [
      { type: "hero", props: { title: "Política de privacidad", variant: "centered" } },
      { type: "richText", props: { html: `<p><em>${PENDING} Texto legal a definir y cargar por el sanatorio.</em></p>` } },
    ],
  },
  {
    slug: "convenios",
    title: "Convenios",
    description: "Convenios con aseguradoras y empresas.",
    order: 25,
    blocks: [
      { type: "hero", props: { title: "Convenios", variant: "centered" } },
      {
        type: "richText",
        props: {
          html:
            "<p>El sanatorio atiende a afiliados de distintas aseguradoras, seguros médicos y empresas.</p>" +
            `<p><em>${PENDING} Para confirmar si tu cobertura tiene convenio vigente, escribinos o consultá en recepción.</em></p>`,
        },
      },
      { type: "contactChannels", props: { heading: "Consultá por tu cobertura", columns: 2, keys: ["whatsapp-samap", "recepcion"] } },
    ],
  },
  {
    slug: "atencion-al-paciente",
    title: "Atención al paciente",
    description: "Consultas, sugerencias y reclamos.",
    order: 26,
    blocks: [
      { type: "hero", props: { title: "Atención al paciente", variant: "centered" } },
      {
        type: "richText",
        props: {
          html: "<p>El equipo de Atención al Paciente está para escucharte y orientarte durante tu atención.</p>",
        },
      },
      { type: "contactForm", props: { heading: "Contactanos", showPhone: true } },
    ],
  },
];

/** Páginas de servicio/estudio con estructura común. */
const SERVICE_PAGES: { slug: string; title: string; subtitle: string; intro: string; extra?: BlockSpec[] }[] = [
  { slug: "emergencias", title: "Emergencias", subtitle: "Servicio de urgencias y emergencias", intro: "El sanatorio cuenta con servicio de urgencias y emergencias." },
  { slug: "internacion", title: "Internación", subtitle: "Internación de adultos y niños", intro: "Área destinada a la internación de pacientes adultos y pediátricos." },
  { slug: "uti", title: "Unidad de Terapia Intensiva", subtitle: "Cuidados críticos", intro: "Unidad para la atención de pacientes que requieren cuidados intensivos." },
  { slug: "banco-de-sangre", title: "Banco de sangre", subtitle: "Donación y hemoterapia", intro: "Servicio de banco de sangre y hemoterapia." },
  {
    slug: "estudios-diagnostico-imagenes",
    title: "Estudios por imágenes",
    subtitle: "Diagnóstico por imágenes",
    intro: "Servicio de estudios por imágenes.",
    extra: [{ type: "studyGrid", props: { columns: 3, category: "imagenes" } }],
  },
  {
    slug: "estudios-cardiologicos",
    title: "Estudios cardiológicos",
    subtitle: "Salud cardiovascular",
    intro: "Servicio de estudios cardiológicos.",
    extra: [{ type: "studyGrid", props: { columns: 3, category: "cardiologicos" } }],
  },
  {
    slug: "estudios-laboratorio",
    title: "Laboratorio de análisis clínicos",
    subtitle: "Análisis clínicos y bacteriológicos",
    intro: "Servicio de laboratorio de análisis clínicos.",
    extra: [{ type: "studyGrid", props: { columns: 2, category: "laboratorio" } }],
  },
  {
    slug: "estudios-biopsias",
    title: "Biopsias y anatomía patológica",
    subtitle: "Información en validación",
    intro: "Sección de biopsias.",
    extra: [
      {
        type: "contactChannels",
        props: { heading: "Consultanos", columns: 3, keys: ["whatsapp-estudios", "recepcion", "email-general"] },
      },
    ],
  },
  { slug: "info-preparacion-estudios", title: "Preparación para estudios", subtitle: "Indicaciones previas", intro: "Las indicaciones previas dependen del estudio y las define el profesional que lo solicita." },
  { slug: "info-horario-visitas", title: "Horario de visitas", subtitle: "Horarios y normas de visita", intro: "Las visitas se realizan en horarios pautados que respetan el descanso de los pacientes." },
  { slug: "info-horario-recepcion", title: "Horario de recepción", subtitle: "Atención administrativa", intro: "Recepción y admisión atienden de forma presencial." },
  { slug: "info-horarios-estudios", title: "Retiro de estudios", subtitle: "Cómo retirar tus resultados", intro: "Los resultados se retiran en recepción presentando el comprobante de la orden." },
  { slug: "info-reglamento-visitas", title: "Reglamento para visitas", subtitle: "Normas para el bienestar de todos", intro: "El reglamento de visitas busca preservar el descanso y la recuperación de los pacientes." },
  { slug: "samap", title: "SAMAP", subtitle: "Seguro médico del sanatorio", intro: "SAMAP es el sistema de medicina prepaga del sanatorio." },
];

export async function seed(knex: Knex): Promise<void> {
  // ---------------------------------------------------------- servicios
  await knex("services").del();
  await knex("services").insert(SERVICES);

  // ----------------------------------------------------------- estudios
  await knex("studies").del();
  const hasPublished = await knex.schema.hasColumn("studies", "published");
  await knex("studies").insert(
    STUDIES.map((s) => ({
      slug: s.slug,
      name: s.name,
      category: s.category,
      icon: s.icon,
      order: s.order,
      // Catálogo cargado pero NO publicado: el sitio no afirma la prestación
      // hasta que el sanatorio la confirme desde el panel.
      ...(hasPublished ? { published: false } : {}),
    })),
  );

  // ------------------------------------------------------------ páginas
  await knex("blocks").del();
  await knex("pages").del();

  const insertPage = async (
    slug: string,
    title: string,
    description: string,
    blocks: BlockSpec[],
    order: number,
    status = "published",
    seoTitle = title,
  ) => {
    const [pageId] = await knex("pages").insert({
      slug,
      title,
      status,
      seo: JSON.stringify({ title: seoTitle, description }),
      order,
    });
    if (blocks.length === 0) return;
    await knex("blocks").insert(
      blocks.map((b, i) => ({
        page_id: pageId,
        type: b.type,
        order: i,
        props: JSON.stringify(b.props),
      })),
    );
  };

  for (const p of PAGES) {
    await insertPage(p.slug, p.title, p.description, p.blocks, p.order, p.status ?? "published", p.seoTitle);
  }

  for (let i = 0; i < SERVICE_PAGES.length; i++) {
    const p = SERVICE_PAGES[i];
    await insertPage(
      p.slug,
      p.title,
      `${p.title} — Sanatorio Adventista de Asunción`,
      servicePage(p.title, p.subtitle, p.intro, p.extra ?? []),
      100 + i,
    );
  }

  // -------------------------------------------------------------- menús
  await knex("menus")
    .insert({ location: "header", items: JSON.stringify(HEADER_MENU) })
    .onConflict("location")
    .merge({ items: JSON.stringify(HEADER_MENU), updated_at: knex.fn.now() });
  await knex("menus")
    .insert({ location: "footer", items: JSON.stringify(FOOTER_MENU) })
    .onConflict("location")
    .merge({ items: JSON.stringify(FOOTER_MENU), updated_at: knex.fn.now() });

  // ----------------------------------------------------------- settings
  const contactRow = await knex("settings").where({ key: "contact" }).first();
  if (contactRow) {
    let contact: Record<string, unknown> = {};
    try {
      contact = typeof contactRow.value === "string" ? JSON.parse(contactRow.value) : contactRow.value ?? {};
    } catch {
      contact = {};
    }
    contact.mapEmbed = SANATORIO_MAP_EMBED;
    contact.mapsUrl = MAPS_URL;
    await knex("settings")
      .where({ key: "contact" })
      .update({ value: JSON.stringify(contact), updated_at: knex.fn.now() });
  }
}
