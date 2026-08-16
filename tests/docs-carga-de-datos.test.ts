import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La guía de carga dice la verdad sobre el código.
 *
 * `docs/CARGA-DE-DATOS.md` le indica al sanatorio dónde cargar cada dato, con
 * qué formato y cómo verificarlo. Una guía operativa que se desincroniza del
 * código es peor que no tenerla: manda a alguien a una pantalla que no existe o
 * le promete un formato que la API rechaza, y el error aparece recién cuando la
 * persona está intentando publicar un teléfono de Emergencias.
 *
 * Estas pruebas atan la guía a sus fuentes: el catálogo de canales, las reglas
 * de validación, los textos de estado vacío, las rutas del panel y los
 * endpoints públicos. Si alguna cambia, la guía falla acá y no en producción.
 */

const ROOT = resolve(__dirname, "..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const GUIA = leer("docs/CARGA-DE-DATOS.md");
const CATALOGO = leer("api/migrations/20260813000000_contact_channels.ts");
const VALORES = leer("shared/types/contact-values.ts");
const LAYOUT_ADMIN = leer("apps/admin/src/components/AdminLayout.tsx");
const PUBLICO = leer("api/src/routes/public.ts");
const AJUSTES = leer("api/src/routes/admin/settings.ts");

/** Las claves y tipos que el catálogo define de verdad. */
function catalogo(): { key: string; kind: string }[] {
  const bloque = CATALOGO.slice(CATALOGO.indexOf("const CHANNELS"), CATALOGO.indexOf("];", CATALOGO.indexOf("const CHANNELS")));
  const out: { key: string; kind: string }[] = [];
  for (const m of bloque.matchAll(/key:\s*"([^"]+)"[\s\S]*?kind:\s*"([^"]+)"/g)) {
    out.push({ key: m[1], kind: m[2] });
  }
  return out;
}

describe("la guía cubre exactamente el catálogo de canales", () => {
  const canales = catalogo();

  it("el catálogo se pudo leer", () => {
    expect(canales.length).toBe(8);
  });

  it.each(canales)("documenta $key con su tipo $kind", ({ key, kind }) => {
    expect(GUIA, `falta la clave ${key} en la guía`).toContain(`\`${key}\``);
    // La fila del dato tiene que declarar el tipo correcto.
    const seccion = GUIA.slice(GUIA.indexOf(`\`${key}\``));
    const hasta = seccion.slice(0, seccion.indexOf("###") === -1 ? 900 : seccion.indexOf("###"));
    expect(hasta, `${key} no declara el tipo ${kind}`).toContain(`\`${kind}\``);
  });

  it("no documenta claves que no existen", () => {
    const claves = new Set(canales.map((c) => c.key));
    // Toda clave con pinta de canal citada en la lista de control existe.
    const citadas = [...GUIA.matchAll(/^- \[ \] `([a-z-]+)`/gm)].map((m) => m[1]);
    expect(citadas.length).toBeGreaterThan(0);
    for (const c of citadas) expect(claves.has(c), `${c} no está en el catálogo`).toBe(true);
  });

  it("la lista de control cubre los ocho canales", () => {
    const citadas = new Set([...GUIA.matchAll(/^- \[ \] `([a-z-]+)`/gm)].map((m) => m[1]));
    for (const { key } of canales) expect(citadas.has(key), `${key} falta en la lista de control`).toBe(true);
  });
});

describe("los formatos que promete la guía son los que valida el código", () => {
  it("whatsapp: 8 a 15 dígitos", () => {
    expect(VALORES).toMatch(/digits\.length >= 8 && digits\.length <= 15/);
    expect(GUIA).toMatch(/\*\*8 a 15 dígitos\*\*/);
  });

  it("phone: 6 a 15 dígitos", () => {
    expect(VALORES).toMatch(/digits\.length >= 6 && digits\.length <= 15/);
    expect(GUIA).toMatch(/\*\*6 a 15 dígitos\*\*/);
  });

  it("los tres tipos documentados existen como kind", () => {
    for (const kind of ["whatsapp", "phone", "email"]) {
      expect(VALORES).toContain(`case "${kind}":`);
      expect(GUIA).toContain(`\`${kind}\``);
    }
  });
});

describe("los textos de estado vacío son los reales", () => {
  it('los canales sin cargar dicen "A confirmar"', () => {
    expect(leer("apps/web/src/lib/contact-channels.ts")).toContain('PENDING_LABEL = "A confirmar"');
    expect(GUIA).toContain("A confirmar");
  });

  it("los horarios sin filas activas avisan que están en confirmación", () => {
    const real = "Horarios en proceso de confirmación";
    expect(leer("apps/web/src/blocks/ScheduleTable.tsx")).toContain(real);
    expect(GUIA).toContain(real);
  });
});

describe("las pantallas y endpoints que cita la guía existen", () => {
  it("las rutas del panel están en el menú", () => {
    for (const ruta of ["/contact-channels", "/schedules", "/pages"]) {
      expect(LAYOUT_ADMIN, `${ruta} no está en el menú del panel`).toContain(`to: "${ruta}"`);
      expect(GUIA).toContain(`/admin${ruta}`);
    }
  });

  it("los endpoints públicos existen", () => {
    for (const ep of ["/contact-channels", "/schedules"]) {
      expect(PUBLICO).toContain(`publicRouter.get("${ep}"`);
      expect(GUIA).toContain(`/api/public${ep}`);
    }
  });
});

describe("la advertencia sobre los campos retirados es exacta", () => {
  it("emergencyPhone y gthEmail se descartan en silencio, no dan 410", () => {
    // Están en RETIRED_CONTACT_FIELDS, que `sanitizeSettingValue` borra del
    // objeto: la respuesta sigue siendo 200 {ok:true}.
    const retirados = AJUSTES.slice(AJUSTES.indexOf("RETIRED_CONTACT_FIELDS = ["), AJUSTES.indexOf("];", AJUSTES.indexOf("RETIRED_CONTACT_FIELDS = [")));
    for (const campo of ["emergencyPhone", "gthEmail"]) expect(retirados).toContain(`"${campo}"`);
    expect(AJUSTES).toContain("for (const field of RETIRED_CONTACT_FIELDS) delete contact[field]");
    // Y NO están en las claves que responden 410.
    const retiradasConGone = AJUSTES.slice(AJUSTES.indexOf("RETIRED_SETTING_KEYS = ["));
    expect(retiradasConGone.slice(0, 80)).not.toContain("emergencyPhone");

    // La guía tiene que decir exactamente eso, no lo contrario.
    expect(GUIA).toMatch(/200 \{ok:true\}/);
    expect(GUIA).toMatch(/descarta el campo sin guardarlo/i);
  });

  it("social y scripts sí responden 410, y la guía los distingue", () => {
    expect(AJUSTES).toMatch(/RETIRED_SETTING_KEYS = \["social", "scripts"\]/);
    expect(AJUSTES).toContain("status: 410");
    expect(GUIA).toMatch(/`social` y\s*`scripts`/);
    expect(GUIA).toContain("410");
  });

  it("PUBLIC_SITE_URL queda fuera del panel y A-3 bloqueada", () => {
    expect(GUIA).toContain("PUBLIC_SITE_URL");
    expect(GUIA).toMatch(/no se toca desde el panel/i);
    expect(GUIA).toMatch(/A-3/);
    expect(GUIA).toMatch(/dominio/i);
    expect(GUIA).toMatch(/DNS/);
    expect(GUIA).toMatch(/HTTPS/);
  });
});

describe("la guía no inventa datos del cliente", () => {
  // El punto entero de esta ronda es no publicar nada sin confirmar. Una guía
  // con un teléfono "de ejemplo" es la forma más fácil de que ese número
  // termine copiado al panel.
  it("no trae ningún teléfono", () => {
    const internacional = GUIA.match(/\+\d[\d\s().-]{7,}/g) ?? [];
    const conPrefijo = GUIA.match(/\(0\d{2,3}\)\s*[\d\s.-]{6,}/g) ?? [];
    expect([...internacional, ...conPrefijo]).toEqual([]);
  });

  it("no trae ninguna dirección de correo", () => {
    const correos = (GUIA.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi) ?? []).filter(
      (c) => !/@(ejemplo|example)\.(test|com)$/i.test(c),
    );
    expect(correos).toEqual([]);
  });

  it("dice explícitamente que no se inventa nada", () => {
    expect(GUIA).toMatch(/no se inventa ning[úu]n dato/i);
    expect(GUIA).toMatch(/se deja vac[íi]o/i);
  });

  it("marca Emergencias como el dato más sensible", () => {
    const seccion = GUIA.slice(GUIA.indexOf("Teléfono de Emergencias"), GUIA.indexOf("Correo de GTH"));
    expect(seccion).toMatch(/sin confirmación escrita/i);
  });
});
