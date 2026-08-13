import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  THEME_COLOR_KEYS,
  THEME_PALETTE,
  isApprovedThemeColor,
  isEmergencyCta,
  isInstitutionalRed,
  mentionsEmergency,
} from "@sa/shared/institutional-red";
import { validateBlockProps as validateShared } from "@sa/shared/block-schemas";
import { validateBlockProps as validateApi } from "../api/src/block-validation";
import { sanitizeHtml } from "../api/src/html";
import {
  DB_TESTS_ENABLED,
  TEST_ADMIN_PASSWORD,
  applyDbEnv,
  closeAppDb,
  closeServer,
  createTestDatabase,
  dropTestDatabase,
  migrateLatest,
  runSeeds,
} from "./helpers/db";

/**
 * El rojo institucional es exclusivo de Emergencias (minuta, punto 12).
 *
 * Se verifica en tres capas:
 *  1. el detector de rojo y el de contenido de Emergencias;
 *  2. el schema del bloque, en sus dos copias (shared y API);
 *  3. el contenido real de una base migrada + sembrada.
 */

const ROOT = resolve(__dirname, "..");

const EMERGENCY_CTA = {
  title: "Emergencias",
  text: "Consultá los datos de contacto de Emergencias.",
  ctaLabel: "Ver Emergencias",
  ctaHref: "/emergencias",
  variant: "emergency",
};

const NORMAL_CTA = {
  title: "Reservá tu turno",
  text: "Coordiná tu consulta con nuestros profesionales.",
  ctaLabel: "Reservar turno",
  ctaHref: "/turnos",
};

describe("detector de rojo institucional", () => {
  const RED_VALUES = [
    "#f5543f", // el accent del tema
    "#F5543F",
    "#f00",
    "#ff0000",
    "red",
    "  RED  ",
    "crimson",
    "firebrick",
    "rgb(245, 84, 63)",
    "rgba(255, 0, 0, 0.9)",
    "rgb(100% 0% 0%)",
    "linear-gradient(90deg, #005587 0%, #f5543f 100%)", // parada roja escondida
    "#e03131",
  ];

  const SAFE_VALUES = [
    "",
    undefined,
    null,
    "#005587", // primary navy
    "#0f8a6d",
    "rgb(0, 85, 135)",
    "white",
    "#ffffff",
    "#000000",
    "#7a7a7a",
    "#f5c518", // amarillo
    "#8b4513", // marrón: fuera del rango del rojo
    "linear-gradient(90deg, #005587 0%, #0f8a6d 100%)",
  ];

  for (const value of RED_VALUES) {
    it(`rechaza ${JSON.stringify(value)}`, () => {
      expect(isInstitutionalRed(value)).toBe(true);
    });
  }

  for (const value of SAFE_VALUES) {
    it(`acepta ${JSON.stringify(value)}`, () => {
      expect(isInstitutionalRed(value)).toBe(false);
    });
  }
});

describe("detector de contenido de Emergencias", () => {
  it("reconoce el término con y sin tildes, en cualquier caja", () => {
    expect(mentionsEmergency("Emergencias 24hs")).toBe(true);
    expect(mentionsEmergency("EMERGENCIA")).toBe(true);
    // "urgencia" ya no alcanza: aparece en descripciones de cualquier servicio
    // ("cirugías de urgencia") y servía para pedir el rojo desde otro bloque.
    expect(mentionsEmergency("urgencias")).toBe(false);
    expect(mentionsEmergency(undefined, "", "/emergencias")).toBe(true);
  });

  it("no reconoce contenido común", () => {
    expect(mentionsEmergency("Reservá tu turno", "/turnos")).toBe(false);
    expect(mentionsEmergency()).toBe(false);
  });
});

/**
 * Las dos copias del schema tienen que comportarse igual: la API no puede
 * importar valores de `shared/` y la duplicación se controla con pruebas.
 */
const validators: [string, typeof validateShared][] = [
  ["shared", validateShared],
  ["api", validateApi as typeof validateShared],
];

describe.each(validators)("schema del CTA (%s)", (_name, validate) => {
  it("acepta la variante emergency en un bloque de Emergencias", () => {
    const result = validate("cta", EMERGENCY_CTA);
    expect(result.success).toBe(true);
  });

  it("rechaza la variante emergency en un bloque común", () => {
    const result = validate("cta", { ...NORMAL_CTA, variant: "emergency" });
    expect(result.success).toBe(false);
  });

  it("ya no acepta la variante histórica accent", () => {
    const result = validate("cta", { ...NORMAL_CTA, variant: "accent" });
    expect(result.success).toBe(false);
  });

  it("acepta las variantes no rojas", () => {
    for (const variant of ["primary", "secondary", "muted"]) {
      expect(validate("cta", { ...NORMAL_CTA, variant }).success, variant).toBe(true);
    }
  });

  it("descarta cualquier background: el color lo define la variante", () => {
    // El override libre se retiró. Perseguir "todos los rojos" en CSS es una
    // carrera perdida (hsl, oklch, color-mix…); no aceptar color arbitrario, no.
    for (const background of ["#f5543f", "red", "rgb(255,0,0)", "#005587", "hsl(0 90% 60%)"]) {
      const result = validate("cta", { ...NORMAL_CTA, background });
      expect(result.success, background).toBe(true);
      expect(result.success && (result.data as Record<string, unknown>).background, background).toBeUndefined();
    }
  });

  it("la variante emergency exige destino /emergencias", () => {
    // Con sólo mencionar la palabra alcanzaba para pedir el rojo.
    const result = validate("cta", {
      title: "Emergencias odontológicas",
      ctaLabel: "Ver más",
      ctaHref: "/odontologia",
      variant: "emergency",
    });
    expect(result.success).toBe(false);
  });
});

describe("copias del guard", () => {
  it("shared y api son idénticas byte a byte", () => {
    const shared = readFileSync(resolve(ROOT, "shared/types/institutional-red.ts"), "utf8");
    const api = readFileSync(resolve(ROOT, "api/src/institutional-red.ts"), "utf8");
    expect(api).toBe(shared);
  });
});

/**
 * Paleta del tema: allowlist, no detección.
 *
 * Perseguir "todos los rojos" en CSS no se puede ganar —`hsl()`, `oklch()`,
 * `color-mix()`, y mañana otra sintaxis—. Con una lista de colores aprobados
 * el problema se invierte: lo que no está listado no entra, sin importar cómo
 * esté escrito.
 */
describe("paleta institucional del tema", () => {
  it("acepta los colores aprobados de cada campo", () => {
    for (const slot of THEME_COLOR_KEYS) {
      for (const color of THEME_PALETTE[slot]) {
        expect(isApprovedThemeColor(slot, color), `${slot}=${color}`).toBe(true);
        // Y no importa la caja con que se escriba.
        expect(isApprovedThemeColor(slot, color.toUpperCase()), `${slot}=${color}`).toBe(true);
      }
    }
  });

  it("rechaza cualquier rojo en los campos que no son el accent", () => {
    const reds = [
      "#f5543f",
      "red",
      "#f00",
      "rgb(255,0,0)",
      "hsl(0 90% 50%)",
      "hsla(355, 90%, 55%, 0.9)",
      "oklch(0.63 0.24 29)",
      "color-mix(in srgb, red 60%, white)",
      "lab(54% 81 70)",
      "linear-gradient(90deg, #005587, #f5543f)",
    ];
    for (const slot of ["primary", "secondary", "bg", "text"]) {
      for (const color of reds) {
        expect(isApprovedThemeColor(slot, color), `${slot}=${color}`).toBe(false);
      }
    }
  });

  it("rechaza también colores que no son rojos pero están fuera de la paleta", () => {
    // La regla no es sólo "nada de rojo": es identidad de marca.
    expect(isApprovedThemeColor("primary", "#123456")).toBe(false);
    expect(isApprovedThemeColor("bg", "#eeeeee")).toBe(false);
    expect(isApprovedThemeColor("text", "purple")).toBe(false);
    expect(isApprovedThemeColor("primary", 12345)).toBe(false);
    expect(isApprovedThemeColor("primary", null)).toBe(false);
  });

  it("el accent no es configurable: sólo admite el rojo de Emergencias", () => {
    expect(THEME_PALETTE.accent).toEqual(["#f5543f"]);
    expect(isApprovedThemeColor("accent", "#005587")).toBe(false);
  });

  it("los campos que no son colores no se tocan", () => {
    expect(isApprovedThemeColor("fontHeading", "Open Sans")).toBe(true);
    expect(isApprovedThemeColor("radius", "0.5rem")).toBe(true);
  });
});

describe("el HTML administrable no puede pedir el rojo", () => {
  it("el saneo descarta cualquier class, incluidas las del accent", () => {
    const out = sanitizeHtml(
      '<p class="text-accent-700">Urgente</p><span class="bg-accent">rojo</span>',
    );
    expect(out).not.toContain("class");
    expect(out).not.toContain("accent");
    // El texto sí se conserva: lo que se descarta es el estilo.
    expect(out).toContain("Urgente");
  });

  it("tampoco por style ni por atributos de color", () => {
    const out = sanitizeHtml('<p style="color:#f5543f">Rojo</p><font color="red">Rojo</font>');
    expect(out).not.toContain("style");
    expect(out).not.toContain("#f5543f");
    expect(out).not.toContain("color");
  });
});

describe("el accent sólo se usa en Emergencias", () => {
  const files = import.meta.glob("../apps/web/src/**/*.{tsx,ts}", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  /** Componentes donde el rojo es legítimo, por ser Emergencias. */
  const EMERGENCY_FILES = [
    "Cta.tsx", // la clase la elige la variante `emergency`, ya validada
    "ContactChannels.tsx", // sólo la tarjeta del canal `emergencias`
    "Layout.tsx", // el botón de Emergencias del header y del pie
    "api.ts", // aplica el token del tema, validado contra la paleta
  ];

  it("ningún otro componente usa las clases del accent", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(files)) {
      if (EMERGENCY_FILES.some((name) => path.endsWith(name))) continue;
      if (/\b(?:bg|text|border|ring|from|to|via)-accent\b|-accent-\d/.test(source)) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("donde sí se usa, está atado a Emergencias", () => {
    for (const name of ["Cta.tsx", "ContactChannels.tsx", "Layout.tsx"]) {
      const entry = Object.entries(files).find(([path]) => path.endsWith(name));
      expect(entry, `falta ${name}`).toBeTruthy();
      const source = entry![1];
      expect(source, name).toMatch(/emergency|emergencias/i);
    }
  });

  it("la hoja de estilos nombra la clase por Emergencias, no por el color", () => {
    const css = readFileSync(resolve(ROOT, "apps/web/src/styles.css"), "utf8");
    expect(css).toContain(".btn-emergency");
    expect(css).not.toContain(".btn-accent");
  });

  it("el sitio no afirma cobertura horaria sin confirmar", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(files)) {
      // "24hs"/"24 horas" escrito a mano: es una afirmación de cobertura que
      // el sanatorio todavía no confirmó. Si algún día la confirma, se carga
      // como rótulo del canal desde el panel. Los comentarios se descartan:
      // explican justamente por qué el texto ya no está.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (/\b24\s*(hs|horas)\b/i.test(code)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});

describe("excepción de marca: colores oficiales de redes", () => {
  const socialLinks = readFileSync(
    resolve(ROOT, "apps/web/src/blocks/SocialLinks.tsx"),
    "utf8",
  );

  it("el rojo de YouTube vive sólo en SocialLinks y no es el accent del tema", () => {
    expect(socialLinks).toContain("#FF0000");
    // No usa el token del tema: es el color oficial de un tercero.
    expect(socialLinks).not.toContain("bg-accent");
  });

  it("ningún otro componente web usa colores de marca de redes", () => {
    const offenders: string[] = [];
    const files = import.meta.glob("../apps/web/src/**/*.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    for (const [path, source] of Object.entries(files)) {
      if (path.endsWith("SocialLinks.tsx")) continue;
      if (/#FF0000/i.test(source)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Contenido real: ningún bloque que no sea de Emergencias puede terminar en
 * rojo institucional, venga de las migraciones o de los seeds.
 */
const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_red`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

describeDb("contenido publicado", () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    await runSeeds(db);
  }, 180_000);

  afterAll(async () => {
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  const allBlocks = async () => {
    const rows = await db("blocks")
      .join("pages", "pages.id", "blocks.page_id")
      .select("pages.slug as slug", "blocks.type as type", "blocks.props as props", "blocks.order as order");
    return rows.map((r) => ({
      slug: r.slug as string,
      type: r.type as string,
      order: r.order as number,
      // MariaDB devuelve las columnas JSON como string.
      props: (typeof r.props === "string" ? JSON.parse(r.props) : r.props) ?? {},
    }));
  };

  it("no queda ningún bloque con la variante retirada accent", async () => {
    const offenders = (await allBlocks()).filter((b) => b.props?.variant === "accent");
    expect(offenders.map((o) => `${o.slug}#${o.order}`)).toEqual([]);
  });

  it("la variante emergency sólo aparece en bloques de Emergencias", async () => {
    const offenders = (await allBlocks()).filter(
      (b) =>
        b.props?.variant === "emergency" &&
        !mentionsEmergency(b.props?.title, b.props?.text, b.props?.ctaLabel, b.props?.ctaHref),
    );
    expect(offenders.map((o) => `${o.slug}#${o.order}`)).toEqual([]);
  });

  it("ningún bloque usa el rojo institucional como fondo", async () => {
    const offenders = (await allBlocks()).filter((b) => isInstitutionalRed(b.props?.background));
    expect(offenders.map((o) => `${o.slug}#${o.order}`)).toEqual([]);
  });

  it("ningún HTML cargado pinta el rojo institucional a mano", async () => {
    const offenders: string[] = [];
    for (const block of await allBlocks()) {
      const html = JSON.stringify(block.props ?? {});
      // Sólo interesa el color aplicado como estilo, no un texto cualquiera.
      const styles = html.match(/(?:background|color)\s*:\s*[^;\\"]+/gi) ?? [];
      const classes = html.match(/bg-accent[\w-]*/g) ?? [];
      if (styles.some((s) => isInstitutionalRed(s)) || classes.length > 0) {
        offenders.push(`${block.slug}#${block.order}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("el CTA de Emergencias sí conserva el rojo", async () => {
    const emergency = (await allBlocks()).filter((b) => b.props?.variant === "emergency");
    expect(emergency.length).toBeGreaterThan(0);
  });

  it("el tema guardado usa sólo colores de la paleta", async () => {
    const row = await db("settings").where({ key: "theme" }).first("value");
    const theme = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    for (const slot of THEME_COLOR_KEYS) {
      if (!(slot in theme)) continue;
      expect(isApprovedThemeColor(slot, theme[slot]), `theme.${slot}=${theme[slot]}`).toBe(true);
    }
  });

  it("ningún canal afirma cobertura horaria sin confirmar", async () => {
    const rows = await db("contact_channels").select("key", "label", "note");
    const offenders = rows.filter((r) => /24\s*(hs|horas|h\b)/i.test(`${r.label} ${r.note ?? ""}`));
    expect(offenders.map((r) => r.key)).toEqual([]);
  });
});

/**
 * Escrituras reales por la API: es la puerta que usa el panel y la que un
 * cliente viejo o un script podrían usar directo.
 */
const API_DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_red_api`;

describeDb("lo que la API acepta guardar", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  beforeAll(async () => {
    db = await createTestDatabase(API_DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(API_DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-rojo";
    const { createApp } = await import("../api/src/app.js");
    const app = createApp();
    await new Promise<void>((resolvePromise) => {
      server = app.listen(0, () => resolvePromise());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@sanatorio.local", password: TEST_ADMIN_PASSWORD }),
    });
    token = (await login.json()).token;
  }, 180_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(API_DB_NAME);
  });

  const OUT_OF_PALETTE = [
    "#f5543f",
    "red",
    "rgb(255,0,0)",
    "hsl(0 90% 50%)",
    "oklch(0.63 0.24 29)",
    "color-mix(in srgb, red 60%, white)",
    "#123456",
  ];

  describe("tema", () => {
    it.each(OUT_OF_PALETTE)("rechaza theme.primary = %s", async (color) => {
      const res = await fetch(`${baseUrl}/api/admin/settings`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ theme: { primary: color } }),
      });
      expect(res.status, color).toBe(400);
    });

    it.each(["secondary", "bg", "text", "accent"])("rechaza un rojo en theme.%s", async (slot) => {
      const res = await fetch(`${baseUrl}/api/admin/settings/theme`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ [slot]: "hsl(0 90% 50%)" }),
      });
      expect(res.status, slot).toBe(400);
    });

    it("acepta la paleta institucional", async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/theme`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ primary: "#005587", secondary: "#00b5da", accent: "#f5543f", bg: "#ffffff" }),
      });
      expect(res.status, await res.clone().text()).toBe(200);
    });

    it("un color de fuera de la paleta no queda guardado", async () => {
      await fetch(`${baseUrl}/api/admin/settings/theme`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ primary: "red" }),
      });
      const row = await db("settings").where({ key: "theme" }).first("value");
      const theme = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
      expect(isInstitutionalRed(theme.primary)).toBe(false);
      expect(isApprovedThemeColor("primary", theme.primary)).toBe(true);
    });
  });

  describe("bloques", () => {
    const putBlocks = async (pageId: number, blocks: unknown[]) =>
      fetch(`${baseUrl}/api/admin/pages/${pageId}/blocks`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ blocks }),
      });

    let pageId = 0;
    beforeAll(async () => {
      const page = await db("pages").where({ slug: "home" }).first("id");
      pageId = page.id;
    });

    it("rechaza la variante emergency en un CTA que no es de Emergencias", async () => {
      const res = await putBlocks(pageId, [
        {
          type: "cta",
          props: {
            title: "Reservá tu turno",
            ctaLabel: "Reservar",
            ctaHref: "/turnos",
            variant: "emergency",
          },
        },
      ]);
      expect(res.status).toBe(400);
    });

    it("rechaza pedir el rojo sólo nombrándolo en el texto", async () => {
      // Antes alcanzaba con que el texto dijera "urgencia" o "emergencia".
      const res = await putBlocks(pageId, [
        {
          type: "cta",
          props: {
            title: "Cirugías de urgencia y emergencia",
            ctaLabel: "Ver especialidad",
            ctaHref: "/cirugia-general",
            variant: "emergency",
          },
        },
      ]);
      expect(res.status).toBe(400);
    });

    it("descarta el background libre en vez de guardarlo", async () => {
      const res = await putBlocks(pageId, [
        {
          type: "cta",
          props: {
            title: "Reservá tu turno",
            ctaLabel: "Reservar",
            ctaHref: "/turnos",
            background: "#f5543f",
          },
        },
      ]);
      expect(res.status, await res.clone().text()).toBe(200);
      const row = await db("blocks").where({ page_id: pageId, type: "cta" }).first("props");
      const props = typeof row.props === "string" ? JSON.parse(row.props) : row.props;
      expect(props.background).toBeUndefined();
    });

    it("no deja colar el rojo por una class en el HTML del contenido", async () => {
      const res = await putBlocks(pageId, [
        {
          type: "richText",
          props: { html: '<p class="text-accent-700">Texto en rojo</p>' },
        },
      ]);
      expect(res.status, await res.clone().text()).toBe(200);
      const row = await db("blocks").where({ page_id: pageId, type: "richText" }).first("props");
      const props = typeof row.props === "string" ? JSON.parse(row.props) : row.props;
      expect(props.html).not.toContain("accent");
      expect(props.html).not.toContain("class");
    });

    it("el CTA real de Emergencias sí se acepta", async () => {
      const res = await putBlocks(pageId, [{ type: "cta", props: EMERGENCY_CTA }]);
      expect(res.status, await res.clone().text()).toBe(200);
      expect(isEmergencyCta(EMERGENCY_CTA)).toBe(true);
    });
  });
});
