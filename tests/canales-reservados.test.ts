import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
 * Los ocho canales institucionales no se pueden romper desde el panel.
 *
 * No son "datos cargados": son parte del producto. El encabezado busca
 * `emergencias` por su clave, el pie arma la lista excluyendo `emergencias` y
 * `gth` por las suyas, y varios bloques declaran `keys: ["whatsapp-estudios", …]`.
 *
 * Borrar una de esas filas o cambiarle la clave **no deja un hueco visible**:
 * deja el sitio buscando algo que ya no existe y mostrando "A confirmar" para
 * siempre, sin un solo error que lo delate. El `kind` va en el mismo paquete
 * porque decide qué formato se valida y qué enlace se genera: pasar
 * `emergencias` a `email` convierte el botón de urgencias en un `mailto:` roto.
 *
 * Lo demás se edita con normalidad, y los canales que el sanatorio cree después
 * conservan CRUD completo.
 *
 *   TEST_DATABASE=1 pnpm test tests/canales-reservados.test.ts
 */

const DB_NAME = `${process.env.TEST_DB_NAME ?? "sanatorio_test"}_reservados`;
const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

const RESERVADOS: Record<string, string> = {
  emergencias: "phone",
  "whatsapp-turnos": "whatsapp",
  "whatsapp-estudios": "whatsapp",
  "whatsapp-general": "whatsapp",
  "whatsapp-samap": "whatsapp",
  recepcion: "phone",
  "email-general": "email",
  gth: "email",
};

/**
 * El catálogo se define una sola vez.
 *
 * Estaba escrito dos veces: en `api/src/routes/admin/contact_channels.ts` y en
 * `apps/admin/src/pages/ContactChannelsPage.tsx`. Dos listas de las mismas ocho
 * claves se desincronizan solas —alcanza con agregar un canal institucional en
 * la API y olvidarlo en el panel— y el síntoma es silencioso: el panel ofrece
 * un botón "Eliminar" que la API contesta con 403.
 *
 * La copia del panel se eliminó. Ahora cada fila viaja con `reserved` y
 * `expectedKind` desde la API, así que no hay una segunda lista que mantener
 * —ni hay que agregar una tercera para la pantalla A-2—.
 */
describe("el catálogo institucional no se duplica en el panel", () => {
  const ROOT = resolve(__dirname, "..");
  const leer = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
  /** Sin comentarios: ahí sí se nombra alguna clave para explicar el diseño. */
  const soloCodigo = (fuente: string) => fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  /** La clave como token: `gth:` o `"whatsapp-samap":`, no dentro de una frase. */
  const menciona = (fuente: string, clave: string) =>
    new RegExp(`(^|[^\\w-])"?${clave.replace(/-/g, "\\-")}"?\\s*:`, "m").test(fuente);

  it("la API es la única que enumera las ocho claves", () => {
    const api = soloCodigo(leer("api/src/routes/admin/contact_channels.ts"));
    for (const clave of Object.keys(RESERVADOS)) {
      expect(menciona(api, clave), `la API dejó de declarar ${clave}`).toBe(true);
    }
  });

  it("ningún archivo del panel mantiene una copia", () => {
    const files = import.meta.glob("../apps/admin/src/**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const conCopia: string[] = [];
    for (const [path, source] of Object.entries(files)) {
      const code = soloCodigo(source);
      // Una clave suelta puede ser una referencia legítima; tres o más son una
      // lista, y una lista es la deriva que se quiere impedir.
      const encontradas = Object.keys(RESERVADOS).filter(
        (clave) => code.includes(`"${clave}"`) || menciona(code, clave),
      );
      if (encontradas.length >= 3) conCopia.push(`${path}: ${encontradas.join(", ")}`);
    }
    expect(conCopia).toEqual([]);
  });

  it("el panel decide la protección con los metadatos que manda la API", () => {
    const page = soloCodigo(leer("apps/admin/src/pages/ContactChannelsPage.tsx"));
    expect(page).toMatch(/row\??\.reserved/);
    expect(page).toMatch(/row\??\.expectedKind/);
    // Y no reintroduce el Set de claves que se sacó.
    expect(page).not.toMatch(/new Set\(/);
  });

  it("la API serializa esos metadatos", () => {
    const api = soloCodigo(leer("api/src/routes/admin/contact_channels.ts"));
    expect(api).toContain("reserved:");
    expect(api).toContain("expectedKind:");
  });
});

describeDb("canales institucionales protegidos", () => {
  let db: Knex;
  let server: Server;
  let baseUrl = "";
  let token = "";
  const idPorClave = new Map<string, number>();

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  const idDe = (clave: string) => idPorClave.get(clave)!;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    await migrateLatest(db);
    process.env.SEED_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    await runSeeds(db);

    applyDbEnv(DB_NAME);
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-reservados";
    const { createApp } = await import("../api/src/app.js");
    const app = createApp();
    await new Promise<void>((r) => {
      server = app.listen(0, () => r());
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

    for (const row of await db("contact_channels").select("id", "key")) {
      idPorClave.set(row.key, row.id);
    }
  }, 240_000);

  afterAll(async () => {
    await closeAppDb();
    if (server) await closeServer(server);
    if (db) await db.destroy();
    await dropTestDatabase(DB_NAME);
  });

  it("la cadena de migraciones deja las ocho filas", () => {
    for (const clave of Object.keys(RESERVADOS)) {
      expect(idPorClave.has(clave), `falta el canal ${clave}`).toBe(true);
    }
  });

  it("el label efectivo de emergencias es 'Emergencias'", async () => {
    // Se lee de la base después de correr TODA la cadena: una migración
    // posterior renombró la fila que creó `20260813000000`, así que mirar sólo
    // la migración inicial daría un label que ya no existe.
    const row = await db("contact_channels").where({ key: "emergencias" }).first();
    expect(row.label).toBe("Emergencias");
  });

  describe("no se pueden eliminar", () => {
    it.each(Object.keys(RESERVADOS))("DELETE %s → 403", async (clave) => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe(clave)}`, {
        method: "DELETE",
        headers: auth(),
      });

      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/no se puede eliminar/i);
      // Y la fila sigue ahí: el 403 no es cosmético.
      expect(await db("contact_channels").where({ key: clave }).first()).toBeTruthy();
    });
  });

  describe("no se les puede cambiar la clave", () => {
    it.each(Object.keys(RESERVADOS))("PUT %s con otra key → 403", async (clave) => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe(clave)}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ key: `${clave}-renombrado` }),
      });

      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/no se puede cambiar la clave/i);
      expect(await db("contact_channels").where({ key: clave }).first()).toBeTruthy();
    });
  });

  describe("no se les puede cambiar el tipo", () => {
    it.each(Object.entries(RESERVADOS))("PUT %s con otro kind → 403", async (clave, esperado) => {
      const otro = esperado === "email" ? "phone" : "email";
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe(clave)}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ kind: otro }),
      });

      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/tiene que seguir siendo de tipo/i);
      expect((await db("contact_channels").where({ key: clave }).first()).kind).toBe(esperado);
    });
  });

  describe("el 403 no depende de que el canal esté vacío", () => {
    /**
     * El orden de las validaciones se veía desde afuera.
     *
     * La semántica de la fila resultante corría **antes** que el guard, así que
     * pedir un `kind` prohibido sobre un canal **con valor cargado** respondía
     * 400 "payload invalido": la semántica se quejaba primero de que el valor
     * guardado no correspondía al tipo pedido. El operador leía un error de
     * formato por un cambio que no es inválido sino prohibido, y el mensaje no
     * mencionaba la restricción real. Con el canal vacío, en cambio, la
     * semántica no tenía nada que decir y el 403 salía bien: el mismo intento
     * daba dos códigos distintos según un dato ajeno a la restricción.
     *
     * Estos valores son de prueba y viven sólo en la base efímera del test.
     */
    const conValor: [string, string, string][] = [
      ["emergencias", "phone", "+595 21 000 111"],
      ["whatsapp-turnos", "whatsapp", "+595 981 000 111"],
      ["email-general", "email", "canal.de.prueba@ejemplo.test"],
    ];

    const cargar = async (clave: string, valor: string) => {
      await db("contact_channels").where({ key: clave }).update({ value: valor });
      // Guarda de la propia prueba: si el valor no fuese válido para el tipo,
      // el 400 sería legítimo y la prueba no probaría nada.
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe(clave)}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ value: valor }),
      });
      expect(res.status, `el valor de prueba de ${clave} no es válido: ${await res.text()}`).toBe(200);
    };

    const limpiar = (clave: string) => db("contact_channels").where({ key: clave }).update({ value: "" });

    it.each(conValor)("%s con un valor válido guardado: cambiar el tipo → 403", async (clave, esperado, valor) => {
      await cargar(clave, valor);
      try {
        const otro = esperado === "email" ? "phone" : "email";
        const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe(clave)}`, {
          method: "PUT",
          headers: auth(),
          body: JSON.stringify({ kind: otro }),
        });

        expect(res.status, await res.clone().text()).toBe(403);
        expect((await res.json()).error).toMatch(/tiene que seguir siendo de tipo/i);
        const fila = await db("contact_channels").where({ key: clave }).first();
        expect(fila.kind).toBe(esperado);
        expect(fila.value).toBe(valor);
      } finally {
        await limpiar(clave);
      }
    });

    it.each(conValor)("%s con un valor válido guardado: cambiar la clave → 403", async (clave, _esperado, valor) => {
      await cargar(clave, valor);
      try {
        const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe(clave)}`, {
          method: "PUT",
          headers: auth(),
          body: JSON.stringify({ key: `${clave}-renombrado` }),
        });

        expect(res.status, await res.clone().text()).toBe(403);
        expect((await res.json()).error).toMatch(/no se puede cambiar la clave/i);
        expect(await db("contact_channels").where({ key: clave }).first()).toBeTruthy();
      } finally {
        await limpiar(clave);
      }
    });

    it.each(conValor)("%s con un valor válido guardado: cambiar clave y tipo juntos → 403", async (clave, esperado, valor) => {
      // El caso que más se parece a lo que manda el panel: el objeto entero.
      await cargar(clave, valor);
      try {
        const otro = esperado === "email" ? "phone" : "email";
        const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe(clave)}`, {
          method: "PUT",
          headers: auth(),
          body: JSON.stringify({ key: `${clave}-otro`, kind: otro, value: valor }),
        });

        expect(res.status, await res.clone().text()).toBe(403);
      } finally {
        await limpiar(clave);
      }
    });

    it("un payload realmente mal formado sigue dando 400", async () => {
      // El reordenamiento no puede convertir todo en 403: la forma se valida
      // antes que el guard, y un `kind` que no existe es un error de forma.
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe("emergencias")}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ kind: "telepatia" }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("payload invalido");
    });

    it("y un canal propio con valor cargado sí cambia de tipo", async () => {
      // Control: el 403 es de los canales institucionales, no del reordenamiento.
      const alta = await fetch(`${baseUrl}/api/admin/contact-channels`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ key: "linea-prueba", label: "Línea de prueba", kind: "phone", value: "+595 21 000 222" }),
      });
      const creado = await alta.json();
      expect(alta.status, JSON.stringify(creado)).toBe(201);

      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${creado.id}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ kind: "email", value: "linea@ejemplo.test" }),
      });
      expect(res.status, await res.clone().text()).toBe(200);

      await db("contact_channels").where({ id: creado.id }).del();
    });
  });

  describe("cada fila viaja con su propio catálogo", () => {
    it("las reservadas se serializan con reserved y expectedKind", async () => {
      const filas = await (await fetch(`${baseUrl}/api/admin/contact-channels`, { headers: auth() })).json();
      const porClave = new Map(filas.map((f: any) => [f.key, f]));

      for (const [clave, esperado] of Object.entries(RESERVADOS)) {
        const fila: any = porClave.get(clave);
        expect(fila, `falta ${clave} en la respuesta`).toBeTruthy();
        expect(fila.reserved, `${clave} no viene marcada como reservada`).toBe(true);
        expect(fila.expectedKind).toBe(esperado);
      }
    });

    it("las demás vienen como libres", async () => {
      const filas = await (await fetch(`${baseUrl}/api/admin/contact-channels`, { headers: auth() })).json();
      const facebook = filas.find((f: any) => f.key === "facebook");
      expect(facebook, "las redes tienen que existir como canales").toBeTruthy();
      expect(facebook.reserved).toBe(false);
      expect(facebook.expectedKind).toBeNull();
    });
  });

  describe("una fila institucional que falta se recrea, y sólo con su tipo", () => {
    // La fila puede perderse por fuera del panel: una base restaurada a medias,
    // un DELETE directo. El panel tiene que poder volver a crearla, pero no con
    // cualquier tipo: el sitio la busca por su clave y espera ese enlace.
    let respaldo: any;

    beforeAll(async () => {
      respaldo = await db("contact_channels").where({ key: "whatsapp-samap" }).first();
      await db("contact_channels").where({ key: "whatsapp-samap" }).del();
    });

    afterAll(async () => {
      await db("contact_channels").where({ key: "whatsapp-samap" }).del();
      if (respaldo) {
        await db("contact_channels").insert(respaldo);
        idPorClave.set("whatsapp-samap", respaldo.id);
      }
    });

    it("recrearla con el tipo equivocado → 403", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ key: "whatsapp-samap", label: "SAMAP", kind: "email" }),
      });

      expect(res.status, await res.clone().text()).toBe(403);
      expect((await res.json()).error).toMatch(/tiene que crearse con tipo "whatsapp"/i);
      expect(await db("contact_channels").where({ key: "whatsapp-samap" }).first()).toBeUndefined();
    });

    it("recrearla con el tipo esperado → 201", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ key: "whatsapp-samap", label: "SAMAP", kind: "whatsapp" }),
      });

      const creado = await res.json();
      expect(res.status, JSON.stringify(creado)).toBe(201);
      expect(creado.reserved).toBe(true);
      expect(creado.expectedKind).toBe("whatsapp");
      idPorClave.set("whatsapp-samap", creado.id);
    });
  });

  describe("una fila institucional con el tipo equivocado se puede reparar", () => {
    // El bloqueo no puede ser una trampa: si una fila quedó con el `kind`
    // incorrecto —escrita directo en la base, o por una versión vieja— el mismo
    // formulario que informa el problema tiene que permitir arreglarlo.
    beforeEach(async () => {
      await db("contact_channels").where({ key: "recepcion" }).update({ kind: "email", value: "" });
    });

    afterAll(async () => {
      await db("contact_channels").where({ key: "recepcion" }).update({ kind: "phone", value: "" });
    });

    it("el mensaje del bloqueo dice cuál es la reparación", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe("recepcion")}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ kind: "url" }),
      });

      expect(res.status).toBe(403);
      const error = (await res.json()).error;
      expect(error).toMatch(/hoy está como "email", que es incorrecto/i);
      expect(error).toMatch(/la reparación es dejarla en "phone"/i);
    });

    it("ponerle el tipo esperado se permite", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe("recepcion")}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ kind: "phone" }),
      });

      expect(res.status, await res.clone().text()).toBe(200);
      expect((await db("contact_channels").where({ key: "recepcion" }).first()).kind).toBe("phone");
    });

    it("y si además el valor guardado no corresponde, se pide corregirlo en la misma edición", async () => {
      await db("contact_channels").where({ key: "recepcion" }).update({ value: "recepcion@ejemplo.test" });

      // El guard deja pasar la reparación del tipo; la semántica sí opina sobre
      // la fila resultante, que quedaría como teléfono con un correo dentro.
      const solo = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe("recepcion")}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ kind: "phone" }),
      });
      expect(solo.status).toBe(400);
      expect(JSON.stringify((await solo.json()).issues)).toMatch(/Cambiá el valor en la misma edición/i);

      const juntos = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe("recepcion")}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ kind: "phone", value: "+595 21 000 333" }),
      });
      expect(juntos.status, await juntos.clone().text()).toBe(200);
    });
  });

  describe("lo demás sí se edita", () => {
    it("label, note, active y order se guardan", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe("recepcion")}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ label: "Recepción y admisión", note: "Atención administrativa.", active: false, order: 9 }),
      });

      expect(res.status, await res.text()).toBe(200);
      const row = await db("contact_channels").where({ key: "recepcion" }).first();
      expect(row.label).toBe("Recepción y admisión");
      expect(Boolean(row.active)).toBe(false);
      expect(row.order).toBe(9);
    });

    it("mandar la misma key y el mismo kind no se bloquea", async () => {
      // El panel manda el objeto completo al guardar: rechazar por incluir el
      // campo sin cambiarlo haría imposible editar la fila.
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idDe("gth")}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ key: "gth", kind: "email", label: "Trabajá con nosotros" }),
      });

      expect(res.status, await res.text()).toBe(200);
      expect((await db("contact_channels").where({ key: "gth" }).first()).label).toBe("Trabajá con nosotros");
    });
  });

  describe("los canales propios del sanatorio conservan CRUD completo", () => {
    let idPropio = 0;

    it("se crea", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ key: "consultorio-externo", label: "Consultorio externo", kind: "phone" }),
      });
      const creado = await res.json();
      expect(res.status, JSON.stringify(creado)).toBe(201);
      idPropio = creado.id;
    });

    it("se le puede cambiar la clave y el tipo", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idPropio}`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify({ key: "consultorio-nuevo", kind: "email" }),
      });
      expect(res.status, await res.text()).toBe(200);
      expect((await db("contact_channels").where({ id: idPropio }).first()).key).toBe("consultorio-nuevo");
    });

    it("y se puede eliminar", async () => {
      const res = await fetch(`${baseUrl}/api/admin/contact-channels/${idPropio}`, {
        method: "DELETE",
        headers: auth(),
      });
      expect(res.status).toBe(204);
      expect(await db("contact_channels").where({ id: idPropio }).first()).toBeUndefined();
    });
  });

  it("borrar una fila inexistente sigue dando 404, no 403", async () => {
    const res = await fetch(`${baseUrl}/api/admin/contact-channels/999999`, {
      method: "DELETE",
      headers: auth(),
    });
    expect(res.status).toBe(404);
  });
});
