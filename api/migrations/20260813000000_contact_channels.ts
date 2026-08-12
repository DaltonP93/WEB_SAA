import type { Knex } from "knex";

/**
 * Canales de contacto administrables — fuente única de verdad.
 *
 * Antes cada número/correo vivía duplicado: en `settings.contact`, en los props
 * del bloque `contactChannels` de cada página y en el header/footer. Cambiar un
 * WhatsApp implicaba tocar varios lugares (o una migración). Ahora hay una
 * tabla que el panel administra y de la que leen todos los consumidores.
 *
 * No se carga ningún dato de contacto real: las filas quedan con `value`
 * vacío y la UI las muestra como "A confirmar", sin generar enlaces inválidos.
 * El sanatorio completa los valores desde el panel.
 */

export interface ContactChannelSeed {
  key: string;
  label: string;
  kind: "whatsapp" | "phone" | "email" | "url";
  note: string;
  order: number;
}

/** Definiciones que pidió la minuta (item 25). Sin valores: los carga el cliente. */
const CHANNELS: ContactChannelSeed[] = [
  {
    key: "emergencias",
    label: "Emergencias 24hs",
    kind: "phone",
    note: "Guardia activa todos los días del año.",
    order: 0,
  },
  {
    key: "whatsapp-turnos",
    label: "Turnos y consultas",
    kind: "whatsapp",
    note: "Consultorios externos y especialidades.",
    order: 1,
  },
  {
    key: "whatsapp-estudios",
    label: "Estudios y laboratorio",
    kind: "whatsapp",
    note: "Imágenes, cardiológicos, laboratorio y biopsias.",
    order: 2,
  },
  {
    key: "whatsapp-general",
    label: "WhatsApp general",
    kind: "whatsapp",
    note: "Consultas administrativas.",
    order: 3,
  },
  {
    key: "whatsapp-samap",
    label: "SAMAP y convenios",
    kind: "whatsapp",
    note: "Planes, coberturas y facturación.",
    order: 4,
  },
  {
    key: "recepcion",
    label: "Recepción",
    kind: "phone",
    note: "Atención administrativa.",
    order: 5,
  },
  {
    key: "email-general",
    label: "Correo general",
    kind: "email",
    note: "Consultas generales.",
    order: 6,
  },
  {
    key: "gth",
    label: "Trabajá con nosotros (GTH)",
    kind: "email",
    note: "Envianos tu currículum.",
    order: 7,
  },
];

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("contact_channels");
  if (!exists) {
    await knex.schema.createTable("contact_channels", (t) => {
      t.increments("id").primary();
      // Clave estable para referenciar el canal desde bloques y layout.
      t.string("key", 64).notNullable().unique();
      t.string("label", 191).notNullable();
      t.enu("kind", ["whatsapp", "phone", "email", "url"]).notNullable().defaultTo("phone");
      // Vacío = "a confirmar". Nunca se inventa un número.
      t.string("value", 191).nullable();
      t.string("note", 255).nullable();
      /** Mensaje pre-cargado para los links de WhatsApp. */
      t.string("message", 500).nullable();
      /** Override del href cuando el canal no se arma con value (kind=url). */
      t.string("href", 500).nullable();
      t.string("icon", 64).nullable();
      t.boolean("active").notNullable().defaultTo(true);
      t.integer("order").notNullable().defaultTo(0);
      t.timestamp("created_at").defaultTo(knex.fn.now());
      t.timestamp("updated_at").defaultTo(knex.fn.now());
    });
  }

  for (const c of CHANNELS) {
    await knex("contact_channels")
      .insert({
        key: c.key,
        label: c.label,
        kind: c.kind,
        value: null,
        note: c.note,
        active: true,
        order: c.order,
      })
      .onConflict("key")
      .ignore();
  }

  // Migrar lo que ya estuviera cargado en settings.contact para no perderlo.
  const contactRow = await knex("settings").where({ key: "contact" }).first();
  if (contactRow) {
    let contact: Record<string, unknown> = {};
    try {
      contact = typeof contactRow.value === "string" ? JSON.parse(contactRow.value) : contactRow.value ?? {};
    } catch {
      contact = {};
    }

    // Valores de ejemplo que arrastraba el seed original: si siguen ahí, no
    // se adoptan como si fueran datos reales del sanatorio.
    const PLACEHOLDERS = new Set([
      "+595 21 000 000",
      "+59521000000",
      "+595981000000",
      "+595 981 000 000",
      "contacto@sanatorioadventista.com.py",
    ]);

    const adopt = async (channelKey: string, raw: unknown) => {
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value || PLACEHOLDERS.has(value)) return;
      await knex("contact_channels")
        .where({ key: channelKey })
        .whereNull("value")
        .update({ value, updated_at: knex.fn.now() });
    };

    await adopt("whatsapp-turnos", contact.whatsapp);
    await adopt("emergencias", contact.emergencyPhone);
    await adopt("gth", contact.gthEmail);
    await adopt("email-general", contact.email);
    const phones = Array.isArray(contact.phones) ? contact.phones : [];
    await adopt("recepcion", phones[0]);
  }

  // Los bloques contactChannels dejan de llevar los datos embebidos: ahora
  // referencian las claves de la tabla.
  const blocks = await knex("blocks").where({ type: "contactChannels" });
  for (const b of blocks) {
    let props: Record<string, unknown> = {};
    try {
      props = typeof b.props === "string" ? JSON.parse(b.props) : b.props ?? {};
    } catch {
      props = {};
    }
    const items = Array.isArray(props.items) ? props.items : [];
    // Mapeo best-effort de los items viejos a claves de canal.
    const keys: string[] = [];
    for (const item of items as { kind?: string; label?: string }[]) {
      const label = (item.label ?? "").toLowerCase();
      if (item.kind === "emergency" || label.includes("emergencia")) keys.push("emergencias");
      else if (label.includes("estudio")) keys.push("whatsapp-estudios");
      else if (label.includes("samap") || label.includes("convenio")) keys.push("whatsapp-samap");
      else if (label.includes("gth") || label.includes("trabaj")) keys.push("gth");
      else if (label.includes("recep")) keys.push("recepcion");
      else if (item.kind === "whatsapp") keys.push("whatsapp-turnos");
      else if (item.kind === "email") keys.push("email-general");
    }
    const next = {
      heading: props.heading ?? "",
      text: props.text ?? "",
      columns: props.columns ?? 3,
      keys: Array.from(new Set(keys)),
    };
    await knex("blocks").where({ id: b.id }).update({ props: JSON.stringify(next) });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("contact_channels");
}
