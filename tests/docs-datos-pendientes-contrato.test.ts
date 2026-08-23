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
const ENDPOINT = leer("api/src/routes/admin/data_readiness.ts");
const CATALOGO_HORARIOS = leer("api/src/institutional-schedules.ts");
const CARGA = leer("docs/CARGA-DE-DATOS.md");
const PANTALLA = leer("apps/admin/src/pages/DataReadinessPage.tsx");

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

  it("deja Biopsias en revisión mientras no haya confirmación registrada", () => {
    const seccion = PROSA.slice(PROSA.indexOf("Alcance de Biopsias"));

    // Lo que ya no se exige: que diga "siempre `review`". Dejó de ser cierto
    // cuando apareció el mecanismo de confirmación, y un contrato que describe
    // un comportamiento que el código no tiene es peor que uno incompleto.
    expect(seccion).toMatch(/`review`/);
    expect(seccion).toMatch(/mientras no exista una confirmación/i);

    // Lo que sí se sigue exigiendo, que es el invariante de verdad: el estado
    // **nunca** sale del contenido de la página.
    expect(seccion, "el contrato dejó de prohibir la heurística sobre el texto").toMatch(
      /nunca se deduce del contenido/i,
    );
  });

  /**
   * El mecanismo tiene que estar documentado con sus tres garantías, no sólo
   * mencionado: quién puede usarlo, que el alcance es obligatorio y que la
   * fecha no la pone el cliente. Un contrato que dice "hay una confirmación"
   * sin decir quién la puede firmar no describe nada comprobable.
   */
  it("documenta el mecanismo de confirmación con sus garantías", () => {
    const seccion = PROSA.slice(PROSA.indexOf("Alcance de Biopsias"));

    expect(seccion).toContain("/api/admin/data-confirmations");
    expect(seccion, "no dice qué rol puede confirmar").toMatch(/superadmin/);
    expect(seccion, "no dice que el alcance es obligatorio").toMatch(/`scope` es obligatorio/i);
    expect(seccion, "no dice quién pone la fecha").toMatch(/los pone el servidor/i);
    expect(seccion, "no dice que se puede retirar").toMatch(/se puede retirar/i);
    expect(seccion, "no dice qué pasa con una fila ilegible").toMatch(/ilegible/i);
    expect(seccion, "no dice que queda fuera del editor de Configuración").toMatch(
      /ADMIN_SETTING_KEYS/,
    );
  });

  it("dice que es de sólo lectura", () => {
    expect(PROSA).toMatch(/s[óo]lo lectura/i);
    expect(PROSA).toMatch(/ni escribe, ni migra, ni repara/i);
  });
});

describe("las rutas del contrato son internas del panel", () => {
  /** El bloque de ejemplo con la forma de la respuesta. */
  const EJEMPLO = CONTRATO.slice(CONTRATO.indexOf("```jsonc"), CONTRATO.indexOf("```", CONTRATO.indexOf("```jsonc") + 8));

  it("el ejemplo de respuesta no devuelve ninguna ruta con prefijo /admin", () => {
    // Bajo `basename="/admin"` React Router antepone el prefijo solo:
    // devolverlo también daría /admin/admin/… y una pantalla en blanco.
    const rutas = [...EJEMPLO.matchAll(/"route":\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(rutas.length).toBeGreaterThan(0);
    for (const ruta of rutas) {
      expect(ruta, `${ruta} se duplicaría bajo basename`).not.toMatch(/^\/admin(\/|$)/);
    }
    expect(rutas).toContain("/contact-channels");
    expect(rutas).toContain("/schedules");
  });

  it("explica por qué, nombrando el basename real del admin", () => {
    expect(PROSA).toMatch(/basename/);
    expect(PROSA).toMatch(/\/admin\/admin/);
    expect(leer("apps/admin/src/main.tsx")).toContain("basename");
  });

  it("el endpoint devuelve esas mismas rutas", () => {
    expect(ENDPOINT).toContain('"/contact-channels"');
    expect(ENDPOINT).toContain('"/schedules"');
    expect(ENDPOINT).toContain('"/pages"');
    // Ninguna constante de ruta con el prefijo puesto.
    expect(ENDPOINT).not.toMatch(/"\/admin\//);
  });

  it("la pantalla existe en el router del panel con la ruta del contrato", () => {
    expect(CONTRATO).toContain("/datos-pendientes");
    expect(leer("apps/admin/src/App.tsx")).toContain('path="datos-pendientes"');
    expect(leer("apps/admin/src/components/AdminLayout.tsx")).toContain('to: "/datos-pendientes"');
  });

  it("la guía operativa conserva sus URLs /admin/…, que son de otra cosa", () => {
    // Allá son direcciones que una persona escribe en el navegador y están
    // bien; corregirlas "por consistencia" rompería la guía.
    expect(CARGA).toMatch(/\/admin\//);
    expect(PROSA).toMatch(/CARGA-DE-DATOS\.md/);
  });
});

describe("el resumen global y la idempotencia", () => {
  it("documenta summary con sus cuatro campos", () => {
    for (const campo of ["resolved", "pending", "review", "total"]) {
      expect(CONTRATO, `summary sin ${campo}`).toContain(`"${campo}"`);
    }
    expect(PROSA).toMatch(/8 canales \+ 7 horarios \+ 1 Biopsias|ocho canales.*siete [áa]reas/i);
  });

  it("el endpoint arma el resumen y el panel no lo recalcula", () => {
    expect(ENDPOINT).toContain("const summary = {");
    expect(ENDPOINT).toContain("resolved:");
    // La pantalla lee summary; si volviera a derivarlo de sections, la tarjeta
    // y la pantalla podrían decir cosas distintas.
    expect(PANTALLA).toMatch(/summary\./);
  });

  it("un horario cargado e inactivo cuenta como resuelto, y está escrito", () => {
    expect(PROSA).toMatch(/inactivo cuenta como resuelto|`hours` cargado e inactivo cuenta/i);
    expect(ENDPOINT).toMatch(/i\.status === "complete" \|\| i\.status === "inactive"/);
  });

  it("no queda ningún generatedAt: ni en el contrato, ni en el endpoint", () => {
    // Un timestamp adentro hacía que "dos llamadas devuelven lo mismo" dejara
    // de ser cierto al pie de la letra. Nadie lo consumía.
    expect(ENDPOINT).not.toContain("generatedAt");
    expect(CONTRATO).toMatch(/No hay `generatedAt`/);
    expect(CONTRATO).not.toMatch(/"generatedAt":/);
  });
});

describe("el catálogo de horarios es de runtime, no de una migración", () => {
  it("el contrato lo nombra y el módulo existe", () => {
    expect(CONTRATO).toContain("RESERVED_SCHEDULES");
    expect(CATALOGO_HORARIOS).toContain("export const RESERVED_SCHEDULES");
    expect(ENDPOINT).toContain("RESERVED_SCHEDULES");
  });

  it("declara las mismas siete claves que crea la migración", () => {
    const enMigracion = [...HORARIOS.matchAll(/key: "([a-z-]+)", area:/g)].map((m) => m[1]);
    const enCatalogo = [...CATALOGO_HORARIOS.matchAll(/^\s+"?([a-z-]+)"?:\s*"/gm)].map((m) => m[1]);
    expect(enMigracion).toHaveLength(7);
    expect(enCatalogo.sort()).toEqual(enMigracion.sort());
  });

  it("ningún código productivo importa una migración", () => {
    const fuentes = import.meta.glob("../api/src/**/*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const culpables = Object.entries(fuentes)
      .filter(([, code]) => /from\s+["'].*migrations\//.test(code))
      .map(([p]) => p);
    expect(culpables).toEqual([]);
  });
});

describe("el endpoint cumple las prohibiciones del contrato", () => {
  it("no selecciona ni menciona los campos que no puede devolver", () => {
    // `value` y `hours` sí se leen para calcular el estado; lo que no puede
    // pasar es que salgan en la respuesta. Se comprueba que el objeto que se
    // serializa no los nombre como clave.
    const salida = ENDPOINT.slice(ENDPOINT.indexOf("res.json({"));
    for (const campo of ["value:", "hours:", "days:", "note:", "href:", "notaAnterior"]) {
      expect(salida, `la respuesta arma ${campo}`).not.toContain(campo);
    }
  });

  it("no escribe: ni update, ni insert, ni delete", () => {
    for (const escritura of [".update(", ".insert(", ".del(", ".delete("]) {
      expect(ENDPOINT, `el endpoint hace ${escritura}`).not.toContain(escritura);
    }
  });

  it("Biopsias no se deduce del contenido de la página", () => {
    // No se lee ningún bloque ni ningún texto: sólo si la página existe.
    expect(ENDPOINT).not.toContain('"blocks"');

    /**
     * Lo que cambió y lo que no.
     *
     * Antes el estado era `review` fijo, y esta prueba lo fijaba. Ahora hay un
     * segundo estado posible —`complete`— pero **no** porque el endpoint mire
     * el contenido: lo decide una confirmación escrita y registrada por un
     * superadmin, con nombre y fecha. Ver `data_confirmations.ts`.
     *
     * La invariante que hay que sostener no es "siempre review": es que el
     * estado no salga nunca de inspeccionar el texto de la página. Eso es lo
     * que se afirma acá.
     */
    expect(ENDPOINT, "el estado de Biopsias dejó de depender de la confirmación").toContain(
      "confirmacionDe(",
    );
    expect(ENDPOINT).toContain('confirmacionBiopsias ? "complete" : "review"');

    // Y sigue sin haber ninguna heurística sobre el contenido.
    for (const olor of ["props", "includes(", "length >", "match(", "test("]) {
      const enBiopsias = ENDPOINT.slice(ENDPOINT.indexOf("------------ biopsias"));
      expect(enBiopsias, `apareció una heurística sobre el contenido: ${olor}`).not.toContain(olor);
    }
  });
});
