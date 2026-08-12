import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import {
  isInstitutionalRed,
  mentionsEmergency,
} from "@sa/shared/institutional-red";
import { validateBlockProps as validateShared } from "@sa/shared/block-schemas";
import { validateBlockProps as validateApi } from "../api/src/block-validation";
import {
  DB_TESTS_ENABLED,
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
    expect(mentionsEmergency("urgencias")).toBe(true);
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

  it("rechaza un rojo arbitrario cargado por background", () => {
    for (const background of ["#f5543f", "red", "rgb(255,0,0)", "linear-gradient(90deg,#fff,#f00)"]) {
      const result = validate("cta", { ...NORMAL_CTA, background });
      expect(result.success, background).toBe(false);
    }
  });

  it("rechaza el rojo por background incluso en un bloque de Emergencias", () => {
    // Ahí el color lo pone la variante, no un valor cargado a mano.
    const result = validate("cta", { ...EMERGENCY_CTA, background: "#f5543f" });
    expect(result.success).toBe(false);
  });

  it("acepta un background que no es rojo", () => {
    expect(validate("cta", { ...NORMAL_CTA, background: "#005587" }).success).toBe(true);
  });
});

describe("copias del guard", () => {
  it("shared y api son idénticas byte a byte", () => {
    const shared = readFileSync(resolve(ROOT, "shared/types/institutional-red.ts"), "utf8");
    const api = readFileSync(resolve(ROOT, "api/src/institutional-red.ts"), "utf8");
    expect(api).toBe(shared);
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
});
