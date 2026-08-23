import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Knex } from "knex";
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
 * `GET /api/admin/data-readiness`: qué falta cargar, sin decir qué hay.
 *
 * Contrato en `docs/DATOS-PENDIENTES-CONTRATO.md`. Las pruebas de acá son los
 * casos donde una implementación razonable se equivoca:
 *
 * - devolver el dato junto al estado, "total, ya que estamos";
 * - contar las filas que hay en vez del catálogo, con lo cual borrar una fila
 *   mejora el informe;
 * - dar la sección por completa porque **alguna** fila está publicada;
 * - tratar un horario cargado y despublicado como una tarea pendiente eterna;
 * - deducir del texto de la página que Biopsias ya está confirmada;
 * - devolver rutas con el prefijo `/admin`, que bajo `basename` se duplica.
 *
 * Los valores de prueba de este archivo son inventados y viven sólo en la base
 * efímera del test: no son datos del sanatorio.
 *
 *   TEST_DATABASE=1 pnpm test tests/data-readiness.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_readiness`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const RUTA = "/api/admin/data-readiness";
const SNAP_NOTA = "snapshot_nota_emergencias_20260820000000";

/** Datos de prueba: tienen que ser válidos para que el estado dé `complete`. */
const TEL_PRUEBA = "+595 21 000 111";
const WHATSAPP_PRUEBA = "+595 981 000 111";
const CORREO_PRUEBA = "canal.de.prueba@ejemplo.test";
const HORARIO_PRUEBA = "07:00 a 19:00";
const DIAS_PRUEBA = "Lunes a viernes";
const NOTA_PRUEBA = "Nota de prueba sobre el area.";

/**
 * Deja una columna JSON lista para volver a escribirla.
 *
 * MySQL 8 (CI) devuelve las columnas JSON ya parseadas y MariaDB (local) como
 * string. Escribir de vuelta lo que se leyó manda un objeto donde el motor
 * espera un literal JSON, y MySQL lo rechaza con "Invalid JSON text". El
 * helper `jsonColumn()` de `helpers/db` resuelve el mismo problema en la
 * dirección de lectura; éste es su par para la escritura.
 */
const textoJson = (valor: unknown): string =>
  typeof valor === "string" ? valor : JSON.stringify(valor);

interface Item {
  key: string;
  label: string;
  status: string;
  expectedKind?: string;
}
interface Seccion {
  id: string;
  status: string;
  route: string;
  items?: Item[];
  complete?: number;
  publishable?: number;
  total?: number;
  reason?: string;
  pageSlug?: string;
}
interface Respuesta {
  overall: string;
  summary: { resolved: number; pending: number; review: number; total: number };
  sections: Seccion[];
  warnings: { code: string; severity: string; route: string; message: string }[];
}

describeDb("GET /api/admin/data-readiness", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const pedir = async (): Promise<Respuesta> => {
    const res = await fetch(`${baseUrl}${RUTA}`, { headers: auth() });
    expect(res.status, await res.clone().text()).toBe(200);
    return res.json();
  };

  /** El JSON crudo, para buscar literales que no deberían estar. */
  const pedirCrudo = async (): Promise<string> => {
    const res = await fetch(`${baseUrl}${RUTA}`, { headers: auth() });
    return res.text();
  };

  const seccion = (r: Respuesta, id: string) => r.sections.find((s) => s.id === id)!;
  const item = (r: Respuesta, id: string, key: string) =>
    seccion(r, id).items!.find((i) => i.key === key)!;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-readiness";
    const { createApp } = await import("../api/src/app.js");
    await new Promise<void>((r) => {
      server = createApp().listen(0, () => r());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@sanatorio.local", password: TEST_ADMIN_PASSWORD }),
    });
    token = (await login.json()).token;
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  // ------------------------------------------------------------- seguridad

  it("sin token responde 401", async () => {
    const res = await fetch(`${baseUrl}${RUTA}`);
    expect(res.status).toBe(401);
  });

  it("con un token inválido responde 401", async () => {
    const res = await fetch(`${baseUrl}${RUTA}`, { headers: { Authorization: "Bearer no-es-un-token" } });
    expect(res.status).toBe(401);
  });

  // ------------------------------------------------------------ sin efectos

  describe("es estrictamente de sólo lectura", () => {
    const volcar = async () => ({
      canales: await db("contact_channels").orderBy("id"),
      horarios: await db("schedules").orderBy("id"),
      paginas: await db("pages").orderBy("id"),
      ajustes: await db("settings").orderBy("key"),
    });

    it("las tablas quedan idénticas, marcas de tiempo incluidas", async () => {
      const antes = await volcar();
      await pedir();
      await pedir();
      expect(await volcar()).toEqual(antes);
    });

    it("dos llamadas seguidas devuelven exactamente el mismo JSON", async () => {
      // Sin `generatedAt` ni ningún otro campo dinámico: la idempotencia que
      // promete el contrato se puede comprobar comparando el texto.
      expect(await pedirCrudo()).toBe(await pedirCrudo());
    });
  });

  // -------------------------------------------------------- datos sensibles

  describe("no devuelve ningún dato del sanatorio", () => {
    afterEach(async () => {
      await db("contact_channels").update({ value: null });
      await db("schedules").update({ hours: null, days: null, note: null, active: false });
    });

    it("con canales y horarios cargados, ninguno aparece en el JSON", async () => {
      await db("contact_channels").where({ key: "emergencias" }).update({ value: TEL_PRUEBA });
      await db("contact_channels").where({ key: "whatsapp-turnos" }).update({ value: WHATSAPP_PRUEBA });
      await db("contact_channels").where({ key: "email-general" }).update({ value: CORREO_PRUEBA });
      await db("schedules")
        .where({ key: "consultorios" })
        .update({ hours: HORARIO_PRUEBA, days: DIAS_PRUEBA, note: NOTA_PRUEBA, active: true });

      const crudo = await pedirCrudo();

      for (const dato of [TEL_PRUEBA, WHATSAPP_PRUEBA, CORREO_PRUEBA, HORARIO_PRUEBA, DIAS_PRUEBA, NOTA_PRUEBA]) {
        expect(crudo, `se filtró "${dato}"`).not.toContain(dato);
      }
      // Y sin embargo el estado sí llega: no se logra ocultando la sección.
      const r = JSON.parse(crudo) as Respuesta;
      expect(item(r, "contact-channels", "emergencias").status).toBe("complete");
      expect(item(r, "schedules", "consultorios").status).toBe("complete");
    });

    it("ninguna clave de la respuesta se llama value, hours, days ni note", async () => {
      const crudo = await pedirCrudo();
      for (const campo of ['"value"', '"hours"', '"days"', '"note"', '"href"', '"notaAnterior"']) {
        expect(crudo, `la respuesta trae ${campo}`).not.toContain(campo);
      }
    });
  });

  // --------------------------------------------------------------- canales

  describe("estados por canal", () => {
    afterEach(async () => {
      await db("contact_channels").update({ value: null, active: true });
      await db("contact_channels").where({ key: "recepcion" }).update({ kind: "phone" });
    });

    it("un canal vacío y activo da 'empty'", async () => {
      expect(item(await pedir(), "contact-channels", "gth").status).toBe("empty");
    });

    it("un canal desactivado da 'inactive', que no es lo mismo que vacío", async () => {
      await db("contact_channels").where({ key: "gth" }).update({ active: false });
      const r = await pedir();
      expect(item(r, "contact-channels", "gth").status).toBe("inactive");
      // El de al lado sigue distinguiéndose: los dos estados no colapsan.
      expect(item(r, "contact-channels", "recepcion").status).toBe("empty");
    });

    it("un valor inválido guardado directo en la base da 'invalid', no 'complete'", async () => {
      // La salida pública ya lo descarta, así que el visitante ve "A confirmar"
      // mientras el panel muestra un campo lleno. Sin este estado, esa
      // contradicción no aparece en ningún lado.
      await db("contact_channels").where({ key: "recepcion" }).update({ value: "no-es-un-telefono" });
      const r = await pedir();
      expect(item(r, "contact-channels", "recepcion").status).toBe("invalid");
      expect(seccion(r, "contact-channels").status).toBe("review");
    });

    it("un kind cambiado directo en la base da 'wrong_kind' y emite el aviso", async () => {
      await db("contact_channels").where({ key: "recepcion" }).update({ kind: "email" });
      const r = await pedir();
      expect(item(r, "contact-channels", "recepcion").status).toBe("wrong_kind");
      expect(seccion(r, "contact-channels").status).toBe("review");
      const aviso = r.warnings.find((w) => w.code === "canal_tipo_incorrecto");
      expect(aviso).toBeTruthy();
      expect(aviso!.route).toBe("/contact-channels");
    });

    it("un canal borrado directo en la base da 'missing' y lleva la sección a review", async () => {
      const respaldo = await db("contact_channels").where({ key: "whatsapp-samap" }).first();
      await db("contact_channels").where({ key: "whatsapp-samap" }).del();
      try {
        const r = await pedir();
        const i = item(r, "contact-channels", "whatsapp-samap");
        expect(i.status).toBe("missing");
        // El nombre que se muestra es la clave: no hay fila de donde sacar otro.
        expect(i.label).toBe("whatsapp-samap");
        expect(seccion(r, "contact-channels").status).toBe("review");
        // Y el total no baja por haber borrado la fila.
        expect(seccion(r, "contact-channels").total).toBe(8);
      } finally {
        await db("contact_channels").insert(respaldo);
      }
    });

    it("con valor válido y activo da 'complete'", async () => {
      await db("contact_channels").where({ key: "recepcion" }).update({ value: TEL_PRUEBA });
      expect(item(await pedir(), "contact-channels", "recepcion").status).toBe("complete");
    });

    it("los canales sociales no entran en el conteo", async () => {
      const r = await pedir();
      const claves = seccion(r, "contact-channels").items!.map((i) => i.key);
      for (const social of ["facebook", "instagram", "youtube", "linkedin"]) {
        expect(claves, `${social} no debería contarse`).not.toContain(social);
      }
    });
  });

  describe("el catálogo de canales es el de la API", () => {
    it("agregar una clave a RESERVED_CHANNELS la incorpora sin tocar esta pantalla", async () => {
      const { RESERVED_CHANNELS } = await import("../api/src/routes/admin/contact_channels.js");
      const antes = await pedir();
      expect(antes.summary.total).toBe(16);

      (RESERVED_CHANNELS as Record<string, string>)["canal-nuevo-de-prueba"] = "phone";
      try {
        const r = await pedir();
        expect(seccion(r, "contact-channels").total).toBe(9);
        expect(r.summary.total).toBe(17);
        // No existe la fila, así que entra como problema, no como completo.
        expect(item(r, "contact-channels", "canal-nuevo-de-prueba").status).toBe("missing");
      } finally {
        delete (RESERVED_CHANNELS as Record<string, string>)["canal-nuevo-de-prueba"];
      }

      expect((await pedir()).summary.total).toBe(16);
    });
  });

  // -------------------------------------------------------------- horarios

  describe("estados por horario", () => {
    afterEach(async () => {
      await db("schedules").update({ hours: null, days: null, active: false });
    });

    it("sin horario cargado da 'empty'", async () => {
      expect(item(await pedir(), "schedules", "laboratorio").status).toBe("empty");
    });

    it("un único horario publicado NO completa la sección", async () => {
      await db("schedules").where({ key: "consultorios" }).update({ hours: HORARIO_PRUEBA, active: true });
      const r = await pedir();
      const s = seccion(r, "schedules");
      expect(s.publishable).toBe(1);
      expect(s.total).toBe(7);
      expect(s.status, "una fila publicable no alcanza").toBe("pending");
    });

    it("con las siete cargadas y activas, la sección queda completa", async () => {
      await db("schedules").update({ hours: HORARIO_PRUEBA, active: true });
      const r = await pedir();
      expect(seccion(r, "schedules").publishable).toBe(7);
      expect(seccion(r, "schedules").status).toBe("complete");
    });

    it("un horario cargado e inactivo no queda pendiente, y cuenta como resuelto", async () => {
      // Cargar el dato y no publicarlo es una decisión tomada, no una tarea.
      await db("schedules").update({ hours: HORARIO_PRUEBA, active: true });
      await db("schedules").where({ key: "visitas" }).update({ active: false });

      const r = await pedir();
      expect(item(r, "schedules", "visitas").status).toBe("inactive");
      expect(seccion(r, "schedules").status).toBe("complete");
      expect(seccion(r, "schedules").publishable).toBe(6);
      // Las siete siguen contando como resueltas en el resumen.
      expect(r.summary.pending).toBe(8); // los ocho canales, ningún horario
    });

    it("un horario borrado directo en la base da 'missing'", async () => {
      // Es lo que sólo el catálogo de runtime puede detectar: enumerar la tabla
      // no dice nada de una fila que no está.
      const respaldo = await db("schedules").where({ key: "imagenes" }).first();
      await db("schedules").where({ key: "imagenes" }).del();
      try {
        const r = await pedir();
        const i = item(r, "schedules", "imagenes");
        expect(i.status).toBe("missing");
        // El nombre sale del catálogo: la fila no existe.
        expect(i.label).toBe("Estudios por imágenes");
        expect(seccion(r, "schedules").status).toBe("review");
        expect(seccion(r, "schedules").total).toBe(7);
      } finally {
        await db("schedules").insert(respaldo);
      }
    });

    it("el label sale de la fila cuando el sanatorio la renombró", async () => {
      await db("schedules").where({ key: "visitas" }).update({ area: "Visitas (renombrado)" });
      try {
        expect(item(await pedir(), "schedules", "visitas").label).toBe("Visitas (renombrado)");
      } finally {
        await db("schedules").where({ key: "visitas" }).update({ area: "Visitas a internados" });
      }
    });
  });

  // -------------------------------------------------------------- biopsias

  describe("alcance de Biopsias", () => {
    it("es review y enlaza al Page Builder de su página", async () => {
      const pagina = await db("pages").where({ slug: "estudios-biopsias" }).first();
      expect(pagina, "la página tiene que existir en una instalación nueva").toBeTruthy();

      const s = seccion(await pedir(), "biopsias");
      expect(s.status).toBe("review");
      expect(s.pageSlug).toBe("estudios-biopsias");
      expect(s.route).toBe(`/pages/${pagina.id}`);
      // Falta la confirmación, pero **hay algo que confirmar**: la página
      // existe. Es lo que le dice al panel que puede ofrecer el formulario.
      expect(s.confirmable).toBe(true);
      expect(s.confirmation).toBeNull();
    });

    it("sigue en review aunque el texto sea largo y no diga 'a confirmar'", async () => {
      // Que alguien haya editado la página no es que el sanatorio confirmó el
      // alcance, los requisitos y los plazos. Una heurística sobre el texto
      // convertiría una cosa en la otra.
      const pagina = await db("pages").where({ slug: "estudios-biopsias" }).first();
      const bloque = await db("blocks").where({ page_id: pagina.id, type: "richText" }).first();
      // El valor original se guarda **como texto**: MySQL 8 devuelve las
      // columnas JSON ya parseadas y MariaDB como string, así que escribir de
      // vuelta lo que se leyó manda un objeto donde el motor espera un literal
      // JSON y falla con "Invalid JSON text". Es la convención 3 del
      // CLAUDE_CONTEXT, que acá aplica también a la escritura.
      const original = textoJson(bloque?.props);
      const largo = `<p>${"Texto extenso sobre el procedimiento. ".repeat(60)}</p>`;
      if (bloque) {
        await db("blocks").where({ id: bloque.id }).update({ props: JSON.stringify({ html: largo }) });
      }
      try {
        expect(seccion(await pedir(), "biopsias").status).toBe("review");
      } finally {
        if (bloque) await db("blocks").where({ id: bloque.id }).update({ props: original });
      }
    });

    it("si la página no existe, cae al listado y sigue en review", async () => {
      // Se le cambia el slug en vez de borrarla y reinsertarla: para el
      // endpoint es lo mismo —no encuentra la página— y no hay que devolver a
      // la base ninguna columna JSON leída de ella.
      const pagina = await db("pages").where({ slug: "estudios-biopsias" }).first();
      await db("pages").where({ id: pagina.id }).update({ slug: "estudios-biopsias-fuera-de-lugar" });
      try {
        const s = seccion(await pedir(), "biopsias");
        expect(s.route, "/pages/undefined sería una pantalla rota").toBe("/pages");
        expect(s.status).toBe("review");
        /**
         * No es lo mismo "falta la confirmación" que "no hay nada que
         * confirmar".
         *
         * El endpoint de confirmaciones aceptaría el `PUT` igual —no mira
         * páginas, y no debería—, así que sin este campo el panel ofrecería el
         * formulario, guardaría con éxito y el ítem seguiría en `review`. Un
         * éxito que no cambia nada es peor que un botón ausente.
         */
        expect(s.confirmable, "se ofrecería confirmar una página que no existe").toBe(false);
      } finally {
        await db("pages").where({ id: pagina.id }).update({ slug: "estudios-biopsias" });
      }
    });
  });

  // ---------------------------------------------------------------- avisos

  describe("aviso del snapshot de la nota de Emergencias", () => {
    /** El snapshot original, guardado como texto para poder reinsertarlo. */
    let original: string | null = null;

    beforeAll(async () => {
      const row = await db("settings").where({ key: SNAP_NOTA }).first();
      original = row ? textoJson(row.value) : null;
    });

    afterEach(async () => {
      await db("settings").where({ key: SNAP_NOTA }).del();
      if (original !== null) await db("settings").insert({ key: SNAP_NOTA, value: original });
    });

    const escribir = async (valor: Record<string, unknown>) => {
      await db("settings").where({ key: SNAP_NOTA }).del();
      await db("settings").insert({ key: SNAP_NOTA, value: JSON.stringify(valor) });
    };

    it("con motivo 'editada' y nota anterior, avisa sin exponer el texto", async () => {
      const noConfirmada = "Afirmación institucional que nadie revisó.";
      await escribir({ createdAt: new Date().toISOString(), motivo: "editada", notaAnterior: noConfirmada });

      const crudo = await pedirCrudo();
      const r = JSON.parse(crudo) as Respuesta;
      const aviso = r.warnings.find((w) => w.code === "emergencias_nota_sin_revisar");
      expect(aviso, "no se emitió el aviso").toBeTruthy();
      expect(aviso!.severity).toBe("warning");
      expect(aviso!.route).toBe("/schedules");
      // Dice dónde mirar, nunca qué decía.
      expect(crudo).not.toContain(noConfirmada);
      expect(aviso!.message).toMatch(/Horarios/);
    });

    it("con la restauración neutralizada por un rollback, el aviso es informativo", async () => {
      await escribir({
        createdAt: new Date().toISOString(),
        motivo: "editada",
        notaAnterior: null,
        neutralizadoPor: "snapshot_blindaje_campos_guardia_20260822000000",
      });

      const r = await pedir();
      const aviso = r.warnings.find((w) => w.code === "emergencias_restauracion_neutralizada");
      expect(aviso).toBeTruthy();
      expect(aviso!.severity).toBe("info");
      expect(r.warnings.some((w) => w.code === "emergencias_nota_sin_revisar")).toBe(false);
    });

    it("con motivo 'limpiada' no hay aviso", async () => {
      await escribir({ createdAt: new Date().toISOString(), motivo: "limpiada", notaAnterior: "algo" });
      const r = await pedir();
      expect(r.warnings.some((w) => w.code.startsWith("emergencias_"))).toBe(false);
    });

    it("con un snapshot ilegible no rompe ni inventa un aviso", async () => {
      // Puede venir de una versión vieja, o de una escritura a mano.
      await db("settings").where({ key: SNAP_NOTA }).del();
      await db("settings").insert({ key: SNAP_NOTA, value: JSON.stringify("no es un objeto") });

      const r = await pedir();
      expect(r.warnings.some((w) => w.code.startsWith("emergencias_"))).toBe(false);
      expect(r.summary.total).toBe(16);
    });

    it("sin snapshot tampoco hay aviso", async () => {
      await db("settings").where({ key: SNAP_NOTA }).del();
      const r = await pedir();
      expect(r.warnings.some((w) => w.code.startsWith("emergencias_"))).toBe(false);
    });
  });

  // --------------------------------------------------------------- resumen

  describe("resumen global", () => {
    afterEach(async () => {
      await db("contact_channels").update({ value: null, active: true });
      await db("schedules").update({ hours: null, days: null, active: false });
    });

    it("total cubre 8 canales + 7 horarios + 1 revisión de Biopsias", async () => {
      const r = await pedir();
      expect(r.summary.total).toBe(16);
      expect(seccion(r, "contact-channels").total).toBe(8);
      expect(seccion(r, "schedules").total).toBe(7);
    });

    it("las tres columnas suman el total, sin superposiciones", async () => {
      await db("contact_channels").where({ key: "recepcion" }).update({ value: TEL_PRUEBA });
      await db("contact_channels").where({ key: "gth" }).update({ active: false });
      await db("contact_channels").where({ key: "emergencias" }).update({ value: "roto" });
      await db("schedules").where({ key: "consultorios" }).update({ hours: HORARIO_PRUEBA, active: true });
      await db("schedules").where({ key: "visitas" }).update({ hours: HORARIO_PRUEBA, active: false });

      const { summary } = await pedir();
      expect(summary.resolved + summary.pending + summary.review).toBe(summary.total);
      // 1 canal completo + 2 horarios con dato (uno publicado, uno no).
      expect(summary.resolved).toBe(3);
      // Biopsias siempre suma uno a revisión, más el canal con valor inválido.
      expect(summary.review).toBe(2);
    });

    it("en una instalación recién migrada nada está resuelto salvo lo que no aplica", async () => {
      const r = await pedir();
      expect(r.summary.resolved).toBe(0);
      expect(r.summary.pending).toBe(15);
      expect(r.summary.review).toBe(1);
    });

    it("overall es review mientras Biopsias no esté confirmada", async () => {
      // Se carga cada canal con un valor válido **para su propio tipo**: usar
      // el mismo para todos daría `wrong_kind` y la sección no llegaría a
      // completa por un motivo que no es el que se quiere probar.
      const { RESERVED_CHANNELS } = await import("../api/src/routes/admin/contact_channels.js");
      const porTipo: Record<string, string> = {
        phone: TEL_PRUEBA,
        whatsapp: WHATSAPP_PRUEBA,
        email: CORREO_PRUEBA,
        url: "https://ejemplo.test/canal",
      };
      for (const [clave, kind] of Object.entries(RESERVED_CHANNELS)) {
        await db("contact_channels").where({ key: clave }).update({ value: porTipo[kind], active: true });
      }
      await db("schedules").update({ hours: HORARIO_PRUEBA, active: true });

      const r = await pedir();
      expect(seccion(r, "contact-channels").status).toBe("complete");
      expect(seccion(r, "schedules").status).toBe("complete");
      expect(r.overall, "siempre queda algo que una persona tiene que decidir").toBe("review");
      expect(r.summary.resolved).toBe(15);
      expect(r.summary.review).toBe(1);
    });
  });

  // ----------------------------------------------------------------- rutas

  describe("las rutas son internas del panel", () => {
    it("ninguna empieza con /admin", async () => {
      const r = await pedir();
      const rutas = [...r.sections.map((s) => s.route), ...r.warnings.map((w) => w.route)];
      expect(rutas.length).toBeGreaterThan(0);
      for (const ruta of rutas) {
        expect(ruta, `${ruta} se duplicaría a /admin${ruta} bajo basename`).not.toMatch(/^\/admin(\/|$)/);
        expect(ruta.startsWith("/"), `${ruta} no es una ruta absoluta del router`).toBe(true);
      }
    });

    it("cada sección apunta a la pantalla donde se resuelve", async () => {
      const r = await pedir();
      expect(seccion(r, "contact-channels").route).toBe("/contact-channels");
      expect(seccion(r, "schedules").route).toBe("/schedules");
      expect(seccion(r, "biopsias").route).toMatch(/^\/pages(\/\d+)?$/);
    });
  });
});
