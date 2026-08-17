import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El contrato de `GET /api/admin/data-readiness` describe código que todavía no
 * existe, y esa es exactamente la razón para atarlo.
 *
 * Un contrato escrito antes de implementar envejece en la dirección peligrosa:
 * el código avanza, el documento se queda, y la ronda siguiente implementa
 * contra una especificación que ya no corresponde. Peor todavía si lo que
 * envejece son las reglas que el contrato prohíbe romper —no publicar
 * teléfonos, no exponer el snapshot de la nota de Emergencias—, porque nadie va
 * a releerlo entero antes de escribir el endpoint.
 *
 * Estas pruebas verifican tres cosas: que los símbolos que el contrato manda
 * reutilizar sigan existiendo con ese nombre, que las condiciones que declara
 * sean las que el código aplica de verdad, y que el propio documento no traiga
 * ningún dato del sanatorio.
 */

const ROOT = resolve(__dirname, "..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const CONTRATO = leer("docs/DATOS-PENDIENTES-CONTRATO.md");
/**
 * El markdown va a 80 columnas: una frase puede cortarse en cualquier espacio.
 * Anclar en el texto sin normalizar haría que reacomodar un párrafo rompiera
 * una prueba que no tiene nada que ver con el reacomodo.
 */
const PROSA = CONTRATO.replace(/\s+/g, " ");
const CANALES_API = leer("api/src/routes/admin/contact_channels.ts");
const VALORES = leer("api/src/contact-values.ts");
const PUBLICO = leer("api/src/routes/public.ts");
const BLINDAJE = leer("api/migrations/20260821000000_blindar_rollback_nota_emergencias.ts");
const VIEJA = leer("api/migrations/20260820000000_nota_emergencias_no_confirmada.ts");
const HORARIOS = leer("api/migrations/20260813000001_schedules.ts");

describe("el contrato reutiliza lo que ya existe", () => {
  it("nombra el catálogo institucional de la API, no uno nuevo", () => {
    expect(CANALES_API).toContain("RESERVED_CHANNELS");
    expect(CANALES_API).toContain("isReservedChannel");
    expect(CONTRATO).toContain("RESERVED_CHANNELS");
    expect(PROSA).toMatch(/no se crea una tercera lista/i);
  });

  it("nombra la función de validación que usa el resto del proyecto", () => {
    expect(VALORES).toContain("export function isValidChannelValue");
    expect(CONTRATO).toContain("isValidChannelValue()");
  });

  it("los metadatos que el panel ya recibe son los que el contrato asume", () => {
    expect(CANALES_API).toContain("reserved:");
    expect(CANALES_API).toContain("expectedKind:");
    expect(CONTRATO).toContain("expectedKind");
  });

  it("la ruta cuelga del router administrativo, que exige autenticación", () => {
    expect(leer("api/src/routes/admin/index.ts")).toContain("adminRouter.use(requireAuth)");
    expect(CONTRATO).toContain("GET /api/admin/data-readiness");
    expect(CONTRATO).toMatch(/requireAuth/);
  });
});

describe("las condiciones que declara son las que aplica el código", () => {
  it("un horario es publicable con active y hours, igual que el endpoint público", () => {
    const bloque = PUBLICO.slice(PUBLICO.indexOf('publicRouter.get("/schedules"'));
    expect(bloque).toContain("where({ active: true })");
    expect(bloque).toMatch(/filter\(\(r\) => r\.hours\?\.trim\(\)\)/);
    expect(PROSA).toMatch(/`active = 1` y `hours` no vac[íi]o/);
  });

  it("los seis estados por canal están todos documentados", () => {
    for (const estado of ["missing", "wrong_kind", "inactive", "empty", "invalid", "complete"]) {
      expect(CONTRATO, `falta el estado ${estado}`).toContain(`\`${estado}\``);
    }
  });

  it("los tres estados de sección están separados", () => {
    for (const estado of ["complete", "pending", "review"]) {
      expect(CONTRATO).toContain(`\`${estado}\``);
    }
    expect(PROSA).toMatch(/se separan a prop[óo]sito/i);
  });

  it("las siete áreas de horarios son las que crea la migración", () => {
    const areas = [...HORARIOS.matchAll(/key: "([a-z-]+)", area:/g)].map((m) => m[1]);
    expect(areas.length).toBe(7);
    expect(PROSA).toMatch(/total"?: 7|siete [áa]reas/);
  });

  it("la clave del snapshot que se consulta existe con ese nombre", () => {
    const clave = "snapshot_nota_emergencias_20260820000000";
    expect(VIEJA).toContain(clave);
    expect(BLINDAJE).toContain(clave);
    expect(CONTRATO).toContain(clave);
  });

  it("los dos orígenes del motivo 'editada' existen de verdad", () => {
    // Uno lo escribe el `up()` de la migración vieja cuando encuentra la fila
    // ya editada; el otro, el `down()` del blindaje al desarmar la restauración.
    expect(VIEJA).toContain('motivo: "editada"');
    expect(BLINDAJE).toContain('motivo: "editada"');
    expect(BLINDAJE).toContain("neutralizadoPor");
    expect(CONTRATO).toContain("neutralizadoPor");
  });
});

describe("el contrato prohíbe explícitamente publicar datos", () => {
  it("declara que no viajan valores, horarios ni notas", () => {
    expect(PROSA).toMatch(/Nunca\*{0,2} viajan en la respuesta/i);
    for (const campo of ["`contact_channels.value`", "`schedules.hours`", "`schedules.note`"]) {
      expect(CONTRATO, `no prohíbe ${campo}`).toContain(campo);
    }
  });

  it("prohíbe exponer el contenido del snapshot", () => {
    expect(PROSA).toMatch(/no\s*\*{0,2}\s*se expone jam[áa]s/i);
    expect(CONTRATO).toContain("notaAnterior");
  });

  it("no repite la nota legacy que se retiró del sitio", () => {
    // Un documento que cita el texto lo devuelve a circulación, que es lo que
    // `20260820000000` vino a evitar.
    expect(CONTRATO).not.toContain("Guardia activa todos los días");
  });
});

describe("el contrato no inventa datos del cliente", () => {
  it("no trae ningún teléfono", () => {
    const internacional = CONTRATO.match(/\+\d[\d\s().-]{7,}/g) ?? [];
    const conPrefijo = CONTRATO.match(/\(0\d{2,3}\)\s*[\d\s.-]{6,}/g) ?? [];
    expect([...internacional, ...conPrefijo]).toEqual([]);
  });

  it("no trae ninguna dirección de correo", () => {
    const correos = (CONTRATO.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi) ?? []).filter(
      (c) => !/@(ejemplo|example)\.(test|com)$/i.test(c),
    );
    expect(correos).toEqual([]);
  });

  it("deja Biopsias en revisión manual mientras no haya confirmación", () => {
    const seccion = PROSA.slice(PROSA.indexOf("Alcance de Biopsias"));
    expect(seccion).toMatch(/siempre `review`/i);
    expect(seccion).toMatch(/no se deduce del contenido/i);
  });

  it("dice que es de sólo lectura", () => {
    expect(PROSA).toMatch(/s[óo]lo lectura/i);
    expect(PROSA).toMatch(/ni escribe, ni migra, ni repara/i);
  });
});
