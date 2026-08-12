import type { Knex } from "knex";

/**
 * Minuta de ajustes del sitio (25 puntos acordados con el cliente).
 *
 *  1. "Especialidades" pasa a ser "Servicios" en el menú (con las
 *     especialidades médicas adentro).
 *  2. Odontología dentro de Servicios.
 *  3. En Turnos, WhatsApp primero.
 *  4. "Conocé a nuestros médicos" en Turnos.
 *  5. Se elimina "Campañas y promociones".
 *  6. Mapa de ubicación / cómo llegar.
 *  7. Se elimina la sección Noticias.
 *  8. "Conócenos en nuestras redes".
 *  9. Más iconos e infografías (stats con icono, cards con icono).
 * 10. Iconos propios por especialidad / servicio / estudio (sin repetidos).
 * 11. Sección de Servicios reordenada y compacta.
 * 12. Filtros por especialidad y por médico.
 * 13. "Más información" debajo de cada médico.
 * 14. Estudios por imágenes.
 * 15. Botón "Reservar turno" en cyan; el rojo queda solo para Emergencias.
 * 16. Estudios y Laboratorio sin rojo.
 * 17. Estudios cardiológicos.
 * 18. Horarios de atención en una página propia (valores a confirmar).
 * 19. Biopsias desarrollada (alcance a confirmar).
 * 20. Pacientes ordenado: Información → Portal del paciente → Atención al paciente.
 * 21. "Pacientes" abre su propia página con toda la información.
 * 22. "Preparación para estudios" pasa a Servicios / Estudios.
 * 23. Portal del paciente unificado en una sola página.
 * 24. Convenios simple.
 * 25. Contacto con WhatsApp diferenciados por tipo de atención, correo de GTH
 *     y número de Emergencias identificado.
 *
 * Los datos que quedaron pendientes de definición (números de WhatsApp por
 * tipo de atención, correo de GTH, número de Emergencias y los horarios
 * definitivos) se dejan vacíos: la UI los muestra como "a confirmar" y se
 * cargan desde el admin sin tocar código.
 *
 * Idempotente. `down()` restaura los bloques previos desde el backup que deja
 * en `settings`.
 */

const BACKUP_KEY = "minuta_blocks_backup_20260812000000";

const MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=Sanatorio+Adventista+Asunci%C3%B3n+Paraguay";

// ---------------------------------------------------------------- servicios

const SERVICES: { slug: string; name: string; icon: string; description: string; order: number }[] = [
  { slug: "emergencias", name: "Emergencias 24hs", icon: "siren", description: "Guardia médica activa las 24 horas, los 365 días del año.", order: 0 },
  { slug: "internacion", name: "Internación", icon: "bed", description: "Internación de adultos y niños con acompañamiento permanente.", order: 1 },
  { slug: "uti", name: "Terapia Intensiva", icon: "heart-pulse", description: "Cuidados críticos con monitoreo continuo, adultos y pediátrica.", order: 2 },
  { slug: "cirugia", name: "Cirugía", icon: "scissors", description: "Quirófanos equipados para cirugías programadas y de urgencia.", order: 3 },
  { slug: "maternidad", name: "Maternidad", icon: "baby", description: "Atención integral a la madre y al recién nacido.", order: 4 },
  { slug: "consultorios", name: "Consultorios externos", icon: "clipboard-list", description: "Atención ambulatoria en más de 30 especialidades médicas.", order: 5 },
  { slug: "odontologia", name: "Odontología", icon: "smile", description: "Odontología general, preventiva y especializada.", order: 6 },
  { slug: "diagnostico-por-imagenes", name: "Estudios por imágenes", icon: "scan", description: "Tomografía, resonancia, ecografías, mamografía y rayos X.", order: 7 },
  { slug: "estudios-cardiologicos", name: "Estudios cardiológicos", icon: "activity", description: "Ecocardiogramas, ergometrías, Holter y MAPA.", order: 8 },
  { slug: "laboratorio", name: "Laboratorio", icon: "flask-conical", description: "Análisis clínicos, bioquímicos y bacteriológicos.", order: 9 },
  { slug: "biopsias", name: "Biopsias", icon: "microscope", description: "Anatomía patológica e informes histopatológicos.", order: 10 },
  { slug: "banco-de-sangre", name: "Banco de sangre", icon: "droplet", description: "Donación, hemoterapia y procesamiento de hemocomponentes.", order: 11 },
  { slug: "fisioterapia", name: "Fisioterapia", icon: "dumbbell", description: "Rehabilitación física, kinesiología y terapia ocupacional.", order: 12 },
  { slug: "comedor-ovo-lacto-vegetariano", name: "Comedor ovo lacto vegetariano", icon: "salad", description: "Alimentación saludable abierta a pacientes, familiares y comunidad.", order: 13 },
  { slug: "seguro-medico-samap", name: "Seguro médico SAMAP", icon: "shield-check", description: "Sistema de medicina prepaga propio del Sanatorio Adventista.", order: 14 },
];

/** Nombres viejos que sí podemos renombrar (si el cliente ya lo cambió, se respeta). */
const RENAMED_SERVICES: Record<string, string> = {
  "diagnostico-por-imagenes": "Diagnóstico por imágenes",
};

// ------------------------------------------------------------ especialidades

/** Un icono propio por especialidad (item 10: nada de iconos repetidos). */
const SPECIALTY_ICONS: Record<string, string> = {
  cardiologia: "heart-pulse",
  "rehabilitacion-cardiaca": "activity",
  pediatria: "baby",
  neonatologia: "baby",
  "ginecologia-y-obstetricia": "flower",
  mastologia: "ribbon",
  traumatologia: "bone",
  neurologia: "brain",
  neurocirugia: "brain-cog",
  psiquiatria: "brain-circuit",
  psicologia: "speech",
  oftalmologia: "eye",
  otorrinolaringologia: "ear",
  urologia: "droplet",
  nefrologia: "droplets",
  dermatologia: "scan-face",
  endocrinologia: "atom",
  diabetologia: "candy",
  gastroenterologia: "utensils",
  coloproctologia: "git-branch",
  neumologia: "wind",
  oncologia: "shield-plus",
  hematologia: "test-tube",
  infectologia: "biohazard",
  reumatologia: "hand",
  flebologia: "waves",
  geriatria: "hourglass",
  fisioterapia: "dumbbell",
  nutricion: "salad",
  odontologia: "smile",
  "cirugia-general": "scissors",
  "medicina-interna": "stethoscope",
  "clinica-medica": "clipboard-list",
  "medicina-familiar": "users",
  anestesiologia: "syringe",
  "ayuda-espiritual": "book-heart",
};

// ----------------------------------------------------------------- estudios

const STUDIES: { slug: string; name: string; category: string; icon: string; description: string; order: number }[] = [
  // Laboratorio
  { slug: "laboratorio", name: "Análisis clínicos generales", category: "laboratorio", icon: "flask-conical", description: "Hemogramas, bioquímica, perfiles hormonales y más.", order: 0 },
  { slug: "bacteriologia", name: "Análisis bacteriológicos", category: "laboratorio", icon: "bug", description: "Cultivos, antibiogramas e identificación de microorganismos.", order: 1 },
  // Imágenes
  { slug: "tomografia", name: "Tomografía computada (TAC)", category: "imagenes", icon: "scan", description: "Tomografía multicorte para diagnósticos de alta precisión.", order: 10 },
  { slug: "resonancia", name: "Resonancia magnética", category: "imagenes", icon: "magnet", description: "Imágenes detalladas de tejidos blandos, sin radiación ionizante.", order: 11 },
  { slug: "ecografias", name: "Ecografías", category: "imagenes", icon: "waves", description: "Ecografías abdominales, ginecológicas, de tiroides y partes blandas.", order: 12 },
  { slug: "ecografia-3d-4d", name: "Ecografía 3D y 4D", category: "imagenes", icon: "baby", description: "Ecografías obstétricas 3D y 4D para el seguimiento del embarazo.", order: 13 },
  { slug: "mamografia", name: "Mamografía", category: "imagenes", icon: "ribbon", description: "Mamografía digital para el diagnóstico precoz de cáncer de mama.", order: 14 },
  { slug: "rayos-x", name: "Rayos X (Radiología)", category: "imagenes", icon: "bone", description: "Radiografías digitales generales y especializadas.", order: 15 },
  { slug: "densitometria", name: "Densitometría ósea", category: "imagenes", icon: "ruler", description: "Medición de densidad ósea para el diagnóstico de osteoporosis.", order: 16 },
  { slug: "endoscopia", name: "Endoscopía digestiva", category: "imagenes", icon: "search", description: "Estudios endoscópicos del aparato digestivo.", order: 17 },
  // Cardiológicos
  { slug: "electrocardiograma", name: "Electrocardiograma", category: "cardiologicos", icon: "activity", description: "Registro de la actividad eléctrica del corazón.", order: 30 },
  { slug: "ecocardiograma-doppler", name: "Ecocardiograma Doppler color", category: "cardiologicos", icon: "heart-pulse", description: "Estudio ecográfico del corazón con Doppler color.", order: 31 },
  { slug: "ecocardiografia-transesofagica", name: "Ecocardiografía transesofágica", category: "cardiologicos", icon: "heart", description: "Estudio cardíaco de alta definición por vía esofágica.", order: 32 },
  { slug: "eco-doppler-periferico", name: "Eco Doppler arterial y venoso", category: "cardiologicos", icon: "waves", description: "Estudio del flujo sanguíneo en miembros y vasos periféricos.", order: 33 },
  { slug: "ergometria", name: "Ergometría", category: "cardiologicos", icon: "dumbbell", description: "Prueba de esfuerzo en cinta o bicicleta.", order: 34 },
  { slug: "eco-estres-ejercicio", name: "Eco estrés con ejercicio", category: "cardiologicos", icon: "trending-up", description: "Ecocardiograma realizado durante el esfuerzo físico.", order: 35 },
  { slug: "eco-estres-farmacologico", name: "Eco estrés farmacológico", category: "cardiologicos", icon: "syringe", description: "Ecocardiograma de estrés con estímulo farmacológico.", order: 36 },
  { slug: "mapa", name: "MAPA (presión arterial 24hs)", category: "cardiologicos", icon: "gauge", description: "Monitoreo ambulatorio de presión arterial de 24 horas.", order: 37 },
  { slug: "holter", name: "Holter 24hs", category: "cardiologicos", icon: "watch", description: "Monitoreo electrocardiográfico continuo de 24 horas.", order: 38 },
  // Biopsias
  { slug: "biopsias", name: "Biopsias (anatomía patológica)", category: "biopsias", icon: "microscope", description: "Estudio histopatológico de muestras con informe profesional.", order: 50 },
  { slug: "citologia-papanicolaou", name: "Citología y Papanicolaou", category: "biopsias", icon: "microscope", description: "Estudios citológicos, incluido PAP.", order: 51 },
  { slug: "puncion-aspirativa", name: "Punción aspirativa (PAAF)", category: "biopsias", icon: "pipette", description: "Toma de muestras por punción con aguja fina.", order: 52 },
];

// -------------------------------------------------------------------- menús

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
      { label: "Emergencias 24hs", href: "/emergencias" },
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

// ------------------------------------------------------------------ helpers

type BlockSpec = { type: string; props: Record<string, unknown> };

const ESTUDIOS_CARDS: BlockSpec = {
  type: "cards",
  props: {
    heading: "Estudios y diagnóstico",
    columns: 4,
    items: [
      { title: "Estudios por imágenes", text: "Tomografía, resonancia, ecografías, mamografía y rayos X.", icon: "scan", href: "/estudios-diagnostico-imagenes" },
      { title: "Estudios cardiológicos", text: "Ecocardiogramas, ergometrías, Holter y MAPA.", icon: "heart-pulse", href: "/estudios-cardiologicos" },
      { title: "Laboratorio clínico", text: "Análisis clínicos, bioquímicos y bacteriológicos.", icon: "flask-conical", href: "/estudios-laboratorio" },
      { title: "Biopsias", text: "Anatomía patológica e informes histopatológicos.", icon: "microscope", href: "/estudios-biopsias" },
    ],
  },
};

const PREPARACION_CARD = {
  title: "Preparación para estudios",
  text: "Indicaciones previas según el tipo de estudio.",
  icon: "clipboard-check",
  href: "/info-preparacion-estudios",
};

/** Canales de atención. Los valores vacíos se muestran como "a confirmar". */
const CONTACT_CHANNELS: BlockSpec = {
  type: "contactChannels",
  props: {
    heading: "Canales de atención",
    text: "Escribinos por WhatsApp según el tipo de atención que necesites.",
    columns: 3,
    items: [
      { kind: "emergency", label: "Emergencias 24hs", value: "", note: "Guardia activa todos los días del año. Número a confirmar." },
      { kind: "whatsapp", label: "Turnos y consultas", value: "", message: "Hola, quisiera solicitar un turno.", note: "Consultorios externos y especialidades." },
      { kind: "whatsapp", label: "Estudios y laboratorio", value: "", message: "Hola, quisiera consultar por un estudio.", note: "Imágenes, cardiológicos, laboratorio y biopsias." },
      { kind: "whatsapp", label: "SAMAP y convenios", value: "", message: "Hola, quisiera consultar por SAMAP.", note: "Planes, coberturas y facturación." },
      { kind: "phone", label: "Recepción", value: "", note: "Atención administrativa." },
      { kind: "email", label: "Trabajá con nosotros (GTH)", value: "", note: "Envianos tu currículum. Correo de GTH a confirmar." },
    ],
  },
};

const TURNOS_CHANNELS: BlockSpec = {
  type: "contactChannels",
  props: {
    heading: "Reservá por WhatsApp",
    text: "La vía más rápida para coordinar tu turno con la recepción.",
    columns: 3,
    items: [
      { kind: "whatsapp", label: "Turnos y consultas", value: "", message: "Hola, quisiera solicitar un turno.", note: "Consultorios externos y especialidades." },
      { kind: "whatsapp", label: "Estudios y laboratorio", value: "", message: "Hola, quisiera coordinar un estudio.", note: "Imágenes, cardiológicos, laboratorio y biopsias." },
      { kind: "emergency", label: "Emergencias 24hs", value: "", note: "Si es una urgencia, no esperes turno: vení o llamanos." },
    ],
  },
};

function pageBlocks(): Record<string, BlockSpec[]> {
  const mapBlock: BlockSpec = {
    type: "mapEmbed",
    props: {
      heading: "Cómo llegar",
      embedHtml: "",
      height: 420,
      directionsUrl: MAPS_URL,
    },
  };

  return {
    // ------------------------------------------------------------------ home
    home: [
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
      {
        type: "stats",
        props: {
          items: [
            { value: "50+", label: "Años de servicio", icon: "hourglass" },
            { value: "90+", label: "Profesionales", icon: "users" },
            { value: "30+", label: "Especialidades", icon: "stethoscope" },
            { value: "24/7", label: "Emergencias", icon: "siren" },
          ],
        },
      },
      { type: "serviceGrid", props: { heading: "Nuestros servicios", columns: 4, showCount: 8, compact: true } },
      { type: "specialtyGrid", props: { heading: "Especialidades médicas", columns: 4, showCount: 8 } },
      { ...ESTUDIOS_CARDS },
      {
        type: "cta",
        props: {
          title: "Emergencias 24hs",
          text: "Guardia activa las 24 horas, los 365 días del año.",
          ctaLabel: "Ver Emergencias",
          ctaHref: "/emergencias",
          variant: "accent",
        },
      },
      { ...mapBlock },
      { type: "socialLinks", props: { heading: "Conócenos en nuestras redes", muted: true } },
    ],

    // -------------------------------------------------------------- servicios
    servicios: [
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
      { ...ESTUDIOS_CARDS },
      { type: "specialtyGrid", props: { heading: "Especialidades médicas", columns: 4, compact: true } },
      {
        type: "doctorList",
        props: {
          heading: "Encontrá tu médico",
          intro: "Elegí una especialidad para ver los profesionales que la atienden, o buscá directamente por nombre.",
          showSearch: true,
          limit: 12,
        },
      },
    ],

    // --------------------------------------------------------- especialidades
    especialidades: [
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
          intro: "Al elegir una especialidad se despliegan los médicos que la atienden. Cada ficha tiene el detalle del profesional y la reserva de turno.",
          showSearch: true,
        },
      },
    ],

    // ---------------------------------------------------------------- estudios
    estudios: [
      {
        type: "hero",
        props: {
          title: "Estudios y laboratorio",
          subtitle: "Diagnóstico por imágenes, cardiológicos, laboratorio clínico y biopsias",
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
            PREPARACION_CARD,
            { title: "Retiro de resultados", text: "Horarios y requisitos para retirar tus estudios.", icon: "clock", href: "/info-horarios-estudios" },
            { title: "Portal del paciente", text: "Resultados y facturación en línea (próximamente).", icon: "monitor", href: "/portal-paciente" },
          ],
        },
      },
    ],

    // ------------------------------------------------------- estudios (detalle)
    "estudios-diagnostico-imagenes": [
      {
        type: "hero",
        props: {
          title: "Estudios por imágenes",
          subtitle: "Tomografía, resonancia, ecografías, mamografía, rayos X y densitometría",
          variant: "centered",
          ctaLabel: "Reservar turno",
          ctaHref: "/turnos",
        },
      },
      {
        type: "richText",
        props: {
          html: "<p>Realizamos estudios de imagen con equipamiento de última generación y lectura a cargo de nuestros especialistas.</p>",
        },
      },
      { type: "studyGrid", props: { columns: 3, category: "imagenes" } },
      {
        type: "cards",
        props: {
          heading: "Antes de tu estudio",
          columns: 2,
          items: [
            PREPARACION_CARD,
            { title: "Retiro de resultados", text: "Horarios y requisitos para retirar tus estudios.", icon: "clock", href: "/info-horarios-estudios" },
          ],
        },
      },
    ],

    "estudios-cardiologicos": [
      {
        type: "hero",
        props: {
          title: "Estudios cardiológicos",
          subtitle: "Diagnóstico y seguimiento de la salud cardiovascular",
          variant: "centered",
          ctaLabel: "Reservar turno",
          ctaHref: "/turnos",
        },
      },
      {
        type: "richText",
        props: {
          html: "<p>Estudios no invasivos para evaluar el corazón y la circulación, realizados e informados por nuestro equipo de cardiología.</p>",
        },
      },
      { type: "studyGrid", props: { columns: 3, category: "cardiologicos" } },
      {
        type: "cards",
        props: {
          heading: "Relacionado",
          columns: 3,
          items: [
            PREPARACION_CARD,
            { title: "Cardiología", text: "Conocé a los profesionales de la especialidad.", icon: "heart-pulse", href: "/especialidades/cardiologia" },
            { title: "Rehabilitación cardíaca", text: "Programa integral de recuperación cardiovascular.", icon: "activity", href: "/especialidades/rehabilitacion-cardiaca" },
          ],
        },
      },
    ],

    "estudios-laboratorio": [
      {
        type: "hero",
        props: {
          title: "Laboratorio de análisis clínicos y bacteriológicos",
          subtitle: "Resultados confiables en tiempos óptimos",
          variant: "centered",
          ctaLabel: "Reservar turno",
          ctaHref: "/turnos",
        },
      },
      {
        type: "richText",
        props: {
          html: "<p>Nuestro laboratorio realiza estudios clínicos generales, bioquímicos, hematológicos y bacteriológicos con procesos controlados de punta a punta.</p>",
        },
      },
      { type: "studyGrid", props: { columns: 2, category: "laboratorio" } },
      {
        type: "accordion",
        props: {
          heading: "Preguntas frecuentes",
          items: [
            {
              title: "¿Necesito ayuno?",
              body: "<p>Depende del análisis solicitado. Las indicaciones de ayuno, hidratación o suspensión de medicación las define el médico solicitante; ante la duda, consultanos antes de venir.</p>",
            },
            {
              title: "¿Cómo retiro mis resultados?",
              body: "<p>Los resultados se retiran en recepción presentando el comprobante de la orden. Consultá los horarios en <a href=\"/info-horarios-estudios\">Retiro de estudios</a>.</p>",
            },
            {
              title: "¿Atienden con seguro médico o convenio?",
              body: "<p>Trabajamos con SAMAP y con distintas aseguradoras y empresas. Consultá la sección <a href=\"/convenios\">Convenios</a>.</p>",
            },
          ],
        },
      },
      {
        type: "cards",
        props: {
          heading: "Relacionado",
          columns: 2,
          items: [
            PREPARACION_CARD,
            { title: "Biopsias", text: "Anatomía patológica e informes histopatológicos.", icon: "microscope", href: "/estudios-biopsias" },
          ],
        },
      },
    ],

    "estudios-biopsias": [
      {
        type: "hero",
        props: {
          title: "Biopsias y anatomía patológica",
          subtitle: "Estudio histopatológico de muestras con informe profesional",
          variant: "centered",
          ctaLabel: "Reservar turno",
          ctaHref: "/turnos",
        },
      },
      {
        type: "richText",
        props: {
          html:
            "<p>El servicio de anatomía patológica procesa las muestras obtenidas en consultorio, quirófano o durante un estudio, y emite el informe que necesita tu médico para definir el diagnóstico y el tratamiento.</p>" +
            "<p><strong>Cómo es el circuito:</strong></p>" +
            "<ol><li>El médico indica la biopsia y toma la muestra.</li><li>La muestra se rotula y se envía al laboratorio de anatomía patológica.</li><li>Se procesa, se realizan los cortes y la lectura microscópica.</li><li>Se emite el informe y se retira en recepción o lo recibe tu médico tratante.</li></ol>" +
            "<p><em>Pendiente de definición con el cliente: alcance exacto del servicio (tipos de biopsia que se realizan en el sanatorio y cuáles se derivan), plazos de entrega y aranceles.</em></p>",
        },
      },
      { type: "studyGrid", props: { columns: 3, category: "biopsias" } },
      {
        type: "accordion",
        props: {
          heading: "Preguntas frecuentes",
          items: [
            {
              title: "¿Necesito una orden médica?",
              body: "<p>Sí. La biopsia siempre se realiza con indicación de un profesional, que define el tipo de muestra a tomar.</p>",
            },
            {
              title: "¿Cuánto demora el resultado?",
              body: "<p>El plazo depende del tipo de estudio y de si requiere técnicas complementarias. <em>Plazos definitivos a confirmar.</em></p>",
            },
            {
              title: "¿Cómo retiro el informe?",
              body: "<p>En recepción, presentando el comprobante. Consultá los horarios en <a href=\"/info-horarios-estudios\">Retiro de estudios</a>.</p>",
            },
          ],
        },
      },
    ],

    // ----------------------------------------------------------------- turnos
    turnos: [
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
      { ...TURNOS_CHANNELS },
      {
        type: "cards",
        props: {
          heading: "Antes de reservar",
          columns: 3,
          items: [
            { title: "Conocé a nuestros médicos", text: "Filtrá por especialidad y mirá la ficha de cada profesional.", icon: "users", href: "/profesionales" },
            { title: "Especialidades médicas", text: "Mirá todas las especialidades disponibles.", icon: "stethoscope", href: "/especialidades" },
            PREPARACION_CARD,
          ],
        },
      },
      { type: "appointmentForm", props: { heading: "Formulario de solicitud" } },
    ],

    // ---------------------------------------------------------------- contacto
    contacto: [
      { type: "hero", props: { title: "Contacto", subtitle: "Estamos para ayudarte", variant: "centered" } },
      { ...CONTACT_CHANNELS },
      { ...mapBlock },
      { type: "contactForm", props: { heading: "Escribinos", showPhone: true } },
      { type: "socialLinks", props: { heading: "Conócenos en nuestras redes", muted: true } },
    ],

    // --------------------------------------------------------------- pacientes
    pacientes: [
      {
        type: "hero",
        props: {
          title: "Pacientes",
          subtitle: "Toda la información para tu visita, tu internación y tus estudios",
          variant: "centered",
        },
      },
      {
        type: "cards",
        props: {
          heading: "",
          columns: 3,
          items: [
            { title: "Información", text: "Horarios, visitas, reglamento y retiro de estudios.", icon: "info", href: "/horarios" },
            { title: "Portal del paciente", text: "Resultados, presupuestos y facturación en línea.", icon: "monitor", href: "/portal-paciente" },
            { title: "Atención al paciente", text: "Consultas, sugerencias y reclamos.", icon: "hand-heart", href: "/atencion-al-paciente" },
          ],
        },
      },
      {
        type: "accordion",
        props: {
          heading: "Información útil",
          items: [
            {
              title: "Horarios de atención",
              body: "<p>Consultorios externos: lunes a viernes de 7:00 a 19:00 · sábados de 8:00 a 12:00.</p><p>Emergencias: las 24 horas, todos los días del año.</p><p><em>Horarios sujetos a confirmación definitiva.</em> Ver el detalle en <a href=\"/horarios\">Horarios de atención</a>.</p>",
            },
            {
              title: "Horario de visitas",
              body: "<p>Horario general de visitas: 14:00 a 19:00 hs. Las áreas críticas (UTI/UCO) tienen horarios especiales. Ver <a href=\"/info-horario-visitas\">Horario de visitas</a>.</p>",
            },
            {
              title: "Reglamento para visitas",
              body: "<p>Máximo 2 visitas por paciente a la vez, tono de voz bajo y sin alimentos sin autorización médica. Ver el <a href=\"/info-reglamento-visitas\">reglamento completo</a>.</p>",
            },
            {
              title: "Retiro de estudios",
              body: "<p>Los resultados se retiran en recepción con el comprobante de la orden. Ver <a href=\"/info-horarios-estudios\">horarios de retiro</a>.</p>",
            },
            {
              title: "Preparación para estudios",
              body: "<p>Las indicaciones previas dependen del estudio. Ver <a href=\"/info-preparacion-estudios\">Preparación para estudios</a>.</p>",
            },
          ],
        },
      },
      {
        type: "cards",
        props: {
          heading: "Enlaces directos",
          columns: 4,
          items: [
            { title: "Horarios de atención", text: "Consultorios, recepción y emergencias.", icon: "clock", href: "/horarios" },
            { title: "Horario de visitas", text: "Cuándo podés visitar a un paciente internado.", icon: "calendar-check", href: "/info-horario-visitas" },
            { title: "Reglamento para visitas", text: "Normas para el bienestar de todos.", icon: "list-checks", href: "/info-reglamento-visitas" },
            { title: "Retiro de estudios", text: "Horarios y requisitos.", icon: "file-text", href: "/info-horarios-estudios" },
          ],
        },
      },
    ],

    // --------------------------------------------------------- portal paciente
    "portal-paciente": [
      {
        type: "hero",
        props: {
          title: "Portal del paciente",
          subtitle: "Tus resultados, presupuestos y facturación en un solo lugar",
          variant: "centered",
        },
      },
      {
        type: "richText",
        props: {
          html:
            "<p>Estamos desarrollando un portal donde vas a poder consultar y descargar tus resultados, presupuestos y facturas de forma segura, las 24 horas.</p>" +
            "<p><em>Las secciones se habilitan de forma progresiva. Mientras tanto, los resultados se retiran en recepción.</em></p>",
        },
      },
      {
        type: "cards",
        props: {
          heading: "Qué vas a poder hacer",
          columns: 4,
          items: [
            { title: "Resultados de estudios diagnósticos", text: "Imágenes, electrocardiogramas y más.", icon: "scan", href: "/portal-resultados-diagnostico" },
            { title: "Resultados de laboratorio", text: "Tus análisis clínicos en línea.", icon: "flask-conical", href: "/portal-resultados-laboratorio" },
            { title: "Presupuestos de cirugía", text: "Consultá el detalle antes de tu internación.", icon: "receipt", href: "/portal-presupuestos-cirugia" },
            { title: "Facturación electrónica", text: "Descargá tus facturas en PDF/XML.", icon: "file-text", href: "/portal-facturacion-electronica" },
          ],
        },
      },
    ],

    // ---------------------------------------------------------------- horarios
    horarios: [
      {
        type: "hero",
        props: {
          title: "Horarios de atención",
          subtitle: "Consultorios, recepción, estudios y emergencias",
          variant: "centered",
        },
      },
      {
        type: "richText",
        props: {
          html:
            "<table><thead><tr><th>Área</th><th>Días</th><th>Horario</th></tr></thead><tbody>" +
            "<tr><td>Emergencias</td><td>Todos los días</td><td>24 horas</td></tr>" +
            "<tr><td>Consultorios externos</td><td>Lunes a viernes</td><td>7:00 a 19:00</td></tr>" +
            "<tr><td>Consultorios externos</td><td>Sábados</td><td>8:00 a 12:00</td></tr>" +
            "<tr><td>Recepción / admisión</td><td>Lunes a viernes</td><td>7:00 a 19:00</td></tr>" +
            "<tr><td>Laboratorio (extracciones)</td><td>Lunes a sábado</td><td>A confirmar</td></tr>" +
            "<tr><td>Retiro de estudios</td><td>Lunes a viernes</td><td>8:00 a 18:00</td></tr>" +
            "<tr><td>Retiro de estudios</td><td>Sábados</td><td>8:00 a 12:00</td></tr>" +
            "<tr><td>Visitas a internados</td><td>Todos los días</td><td>14:00 a 19:00</td></tr>" +
            "</tbody></table>" +
            "<p><em>Horarios sujetos a revisión: los definitivos los confirma la administración del sanatorio y se cargan desde el panel.</em></p>",
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
    ],

    // ------------------------------------------------------------- odontología
    odontologia: [
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
            "<p>El servicio de Odontología atiende a pacientes de todas las edades, con foco en la prevención y en el tratamiento oportuno.</p>" +
            "<p><em>Contenido a completar por el cliente: prestaciones exactas, profesionales del servicio, días y horarios de atención y aranceles.</em></p>",
        },
      },
      {
        type: "doctorList",
        props: {
          heading: "Profesionales de Odontología",
          intro: "Elegí Odontología en el filtro para ver el equipo del servicio.",
          showSearch: true,
          limit: 12,
        },
      },
    ],

    // ------------------------------------------------------ preparación estudios
    "info-preparacion-estudios": [
      {
        type: "hero",
        props: {
          title: "Preparación para estudios",
          subtitle: "Indicaciones previas según el estudio",
          variant: "centered",
        },
      },
      {
        type: "richText",
        props: {
          html:
            "<p>Una preparación correcta es clave para que el resultado sea confiable. Las indicaciones cambian según el estudio: ayuno, hidratación, suspensión de medicación o preparación específica.</p>" +
            "<p><strong>Siempre seguí las indicaciones del médico que solicitó el estudio.</strong> Ante cualquier duda, consultanos antes de venir.</p>",
        },
      },
      {
        type: "accordion",
        props: {
          heading: "Por tipo de estudio",
          items: [
            {
              title: "Laboratorio clínico",
              body: "<p>La mayoría de los análisis requiere ayuno; el tiempo lo define el estudio solicitado. Traé la orden médica y, si tomás medicación, consultá antes si debés suspenderla. <em>Indicaciones detalladas a confirmar.</em></p>",
            },
            {
              title: "Estudios por imágenes",
              body: "<p>Algunos estudios requieren ayuno, vejiga llena o contraste. Traé estudios previos si los tenés. <em>Indicaciones detalladas a confirmar.</em></p>",
            },
            {
              title: "Estudios cardiológicos",
              body: "<p>Para ergometrías y eco estrés, vení con ropa y calzado cómodos. Consultá si debés suspender alguna medicación. <em>Indicaciones detalladas a confirmar.</em></p>",
            },
            {
              title: "Biopsias",
              body: "<p>La preparación la define el profesional que realiza la toma de muestra. Ver <a href=\"/estudios-biopsias\">Biopsias</a>.</p>",
            },
          ],
        },
      },
      {
        type: "cards",
        props: {
          heading: "Relacionado",
          columns: 3,
          items: [
            { title: "Estudios y laboratorio", text: "Lista completa de estudios.", icon: "clipboard-check", href: "/estudios" },
            { title: "Retiro de resultados", text: "Horarios y requisitos.", icon: "clock", href: "/info-horarios-estudios" },
            { title: "Reservar turno", text: "Coordiná tu estudio por WhatsApp.", icon: "calendar-check", href: "/turnos" },
          ],
        },
      },
    ],

    // --------------------------------------------------------------- convenios
    convenios: [
      {
        type: "hero",
        props: {
          title: "Convenios",
          subtitle: "Trabajamos con las principales aseguradoras y empresas del país",
          variant: "centered",
        },
      },
      {
        type: "richText",
        props: {
          html:
            "<p>El Sanatorio Adventista de Asunción atiende a afiliados de distintas aseguradoras, seguros médicos y empresas.</p>" +
            "<p>Para confirmar si tu cobertura tiene convenio vigente y qué prestaciones incluye, escribinos o consultá en recepción.</p>" +
            "<p><em>Listado de convenios a cargar por el cliente.</em></p>",
        },
      },
      { type: "logos", props: { heading: "Aseguradoras y empresas con convenio", logos: [] } },
    ],

    // -------------------------------------------------------------- privacidad
    privacidad: [
      { type: "hero", props: { title: "Política de privacidad", variant: "centered" } },
      {
        type: "richText",
        props: {
          html:
            "<p>Esta página va a contener la política de privacidad y el tratamiento de datos personales del Sanatorio Adventista de Asunción.</p>" +
            "<p><em>Texto legal a definir y cargar por el cliente.</em></p>",
        },
      },
    ],
  };
}

/** Páginas que se crean si no existen (título + SEO). */
const NEW_PAGES: { slug: string; title: string; description: string; order: number }[] = [
  { slug: "pacientes", title: "Pacientes", description: "Horarios, visitas, portal del paciente y atención al paciente del Sanatorio Adventista de Asunción.", order: 20 },
  { slug: "portal-paciente", title: "Portal del paciente", description: "Resultados de estudios y laboratorio, presupuestos y facturación electrónica.", order: 21 },
  { slug: "horarios", title: "Horarios de atención", description: "Horarios de consultorios, recepción, estudios, visitas y emergencias.", order: 22 },
  { slug: "odontologia", title: "Odontología", description: "Servicio de odontología general, preventiva y especializada.", order: 23 },
  { slug: "privacidad", title: "Política de privacidad", description: "Política de privacidad y tratamiento de datos personales.", order: 24 },
];

function parseJson(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function up(knex: Knex): Promise<void> {
  // ---------------------------------------------------------------- 0. schema
  const hasStudyIcon = await knex.schema.hasColumn("studies", "icon");
  if (!hasStudyIcon) {
    await knex.schema.alterTable("studies", (t) => {
      t.string("icon", 64).nullable();
    });
  }

  // -------------------------------------------------------------- 1. servicios
  for (const s of SERVICES) {
    const existing = await knex("services").where({ slug: s.slug }).first();
    if (!existing) {
      await knex("services").insert({
        slug: s.slug,
        name: s.name,
        icon: s.icon,
        description: s.description,
        order: s.order,
      });
      continue;
    }
    const patch: Record<string, unknown> = { icon: s.icon, order: s.order };
    // Solo renombramos si el nombre sigue siendo el original del seed.
    if (RENAMED_SERVICES[s.slug] && existing.name === RENAMED_SERVICES[s.slug]) patch.name = s.name;
    if (!existing.description) patch.description = s.description;
    await knex("services").where({ id: existing.id }).update(patch);
  }

  // --------------------------------------------------------- 2. especialidades
  for (const [slug, icon] of Object.entries(SPECIALTY_ICONS)) {
    await knex("specialties").where({ slug }).whereNull("icon").update({ icon });
  }

  // ---------------------------------------------------------------- 3. estudios
  for (const st of STUDIES) {
    const existing = await knex("studies").where({ slug: st.slug }).first();
    if (!existing) {
      await knex("studies").insert({
        slug: st.slug,
        name: st.name,
        category: st.category,
        icon: st.icon,
        description: st.description,
        order: st.order,
      });
      continue;
    }
    const patch: Record<string, unknown> = { category: st.category, order: st.order };
    if (!existing.icon) patch.icon = st.icon;
    if (!existing.description) patch.description = st.description;
    await knex("studies").where({ id: existing.id }).update(patch);
  }

  // ------------------------------------------------------------- 4. páginas
  for (const p of NEW_PAGES) {
    await knex("pages")
      .insert({
        slug: p.slug,
        title: p.title,
        status: "published",
        seo: JSON.stringify({ title: p.title, description: p.description }),
        order: p.order,
      })
      .onConflict("slug")
      .ignore();
  }

  const blocksBySlug = pageBlocks();
  const backup: { pageSlug: string; type: string; order: number; props: unknown }[] = [];

  for (const [slug, blocks] of Object.entries(blocksBySlug)) {
    const page = await knex("pages").where({ slug }).first("id");
    if (!page) continue;

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

  // Guardamos el estado previo para poder revertir.
  await knex("settings").where({ key: BACKUP_KEY }).del();
  await knex("settings").insert({
    key: BACKUP_KEY,
    value: JSON.stringify({ createdAt: new Date().toISOString(), blocks: backup }),
    updated_at: knex.fn.now(),
  });

  // ------------------------------------------------- 5. eliminar Noticias (item 7)
  await knex("pages").where({ slug: "noticias" }).del(); // los bloques caen por FK
  const newsBlocks = await knex("blocks").where({ type: "newsGrid" });
  if (newsBlocks.length) {
    await knex("blocks").whereIn("id", newsBlocks.map((b) => b.id)).del();
  }

  // -------------------------------------------------------------- 6. menús
  await knex("menus")
    .insert({ location: "header", items: JSON.stringify(HEADER_MENU) })
    .onConflict("location")
    .merge({ items: JSON.stringify(HEADER_MENU), updated_at: knex.fn.now() });
  await knex("menus")
    .insert({ location: "footer", items: JSON.stringify(FOOTER_MENU) })
    .onConflict("location")
    .merge({ items: JSON.stringify(FOOTER_MENU), updated_at: knex.fn.now() });

  // ------------------------------------------------------------ 7. settings
  const contactRow = await knex("settings").where({ key: "contact" }).first();
  const contact = contactRow ? parseJson(contactRow.value) ?? {} : {};
  const nextContact = {
    ...contact,
    hours:
      "Consultorios externos: lunes a viernes 7:00 - 19:00 | sábados 8:00 - 12:00\nEmergencias: 24 horas, todos los días",
    // Pendientes de definición: quedan vacíos y la UI los muestra como "a confirmar".
    emergencyPhone: contact?.emergencyPhone ?? "",
    gthEmail: contact?.gthEmail ?? "",
    mapsUrl: contact?.mapsUrl || MAPS_URL,
  };
  if (contactRow) {
    await knex("settings").where({ key: "contact" }).update({
      value: JSON.stringify(nextContact),
      updated_at: knex.fn.now(),
    });
  } else {
    await knex("settings").insert({ key: "contact", value: JSON.stringify(nextContact) });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Restaurar los bloques previos de las páginas que tocamos.
  const backupRow = await knex("settings").where({ key: BACKUP_KEY }).first("value");
  if (backupRow) {
    const backup = parseJson(backupRow.value) as { blocks?: { pageSlug: string; type: string; order: number; props: unknown }[] };
    const blocks = Array.isArray(backup?.blocks) ? backup.blocks : [];
    const slugs = Array.from(new Set(blocks.map((b) => b.pageSlug)));
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

  // Páginas creadas por esta migración.
  await knex("pages").whereIn("slug", NEW_PAGES.map((p) => p.slug)).del();

  // Estudios y servicios agregados por esta migración.
  await knex("studies")
    .whereIn("category", ["cardiologicos", "biopsias"])
    .orWhereIn("slug", ["bacteriologia", "ecografia-3d-4d", "mamografia", "densitometria"])
    .del();
  await knex("services").whereIn("slug", ["odontologia", "estudios-cardiologicos", "biopsias"]).del();

  const hasStudyIcon = await knex.schema.hasColumn("studies", "icon");
  if (hasStudyIcon) {
    await knex.schema.alterTable("studies", (t) => {
      t.dropColumn("icon");
    });
  }
}
