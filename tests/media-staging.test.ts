import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfiguracionInsegura, borrarTemporal, estaDentro, prepararDirectorios } from "../api/src/staging.js";

/**
 * La configuración de staging se comprueba al arrancar, no al primer fallo.
 *
 * Todo el contrato de subidas —el archivo no toca el directorio público hasta
 * estar validado, y se mueve con un `rename` atómico— descansa sobre dos
 * supuestos que se configuran con variables de entorno en el VPS:
 *
 * 1. staging no está debajo de `UPLOAD_DIR`, o `express.static` lo serviría y
 *    todo lo subido quedaría publicado **antes** de validarse;
 * 2. staging y destino comparten sistema de archivos, o el `rename` falla con
 *    `EXDEV` y habría que copiar, que no es atómico.
 *
 * Un `.env` equivocado no rompe nada visible: la API arranca, las subidas
 * funcionan, y la garantía simplemente no existe. Eso es peor que no tenerla,
 * porque el código dice que sí.
 */

const temporales: string[] = [];

function dir(...partes: string[]): string {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "staging-test-"));
  temporales.push(raiz);
  const ruta = path.join(raiz, ...partes);
  fs.mkdirSync(ruta, { recursive: true });
  return ruta;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (temporales.length) fs.rmSync(temporales.pop()!, { recursive: true, force: true });
});

describe("estaDentro", () => {
  it("reconoce un descendiente y el propio directorio", () => {
    expect(estaDentro("/srv/uploads/tmp", "/srv/uploads")).toBe(true);
    expect(estaDentro("/srv/uploads", "/srv/uploads")).toBe(true);
    expect(estaDentro("/srv/uploads/a/b/c", "/srv/uploads")).toBe(true);
  });

  it("no se deja engañar por un prefijo de texto", () => {
    // Comparar strings con `startsWith` diría que sí, y son dos directorios
    // distintos y hermanos.
    expect(estaDentro("/srv/uploads-viejo", "/srv/uploads")).toBe(false);
    expect(estaDentro("/srv/uploadsmas", "/srv/uploads")).toBe(false);
  });

  it("un hermano y un ancestro no están dentro", () => {
    expect(estaDentro("/srv/.staging", "/srv/uploads")).toBe(false);
    expect(estaDentro("/srv", "/srv/uploads")).toBe(false);
  });
});

describe("prepararDirectorios", () => {
  describe("configuración segura", () => {
    it("acepta hermanos en el mismo filesystem y devuelve las rutas resueltas", () => {
      const raiz = dir("raiz");
      const uploads = path.join(raiz, "uploads");
      const staging = path.join(raiz, ".staging");

      const r = prepararDirectorios(uploads, staging);

      expect(r.uploads).toBe(fs.realpathSync(uploads));
      expect(r.staging).toBe(fs.realpathSync(staging));
      expect(fs.existsSync(r.uploads)).toBe(true);
      expect(fs.existsSync(r.staging)).toBe(true);
    });

    it("crea los directorios si no existen", () => {
      const raiz = dir("raiz");
      const uploads = path.join(raiz, "no-existe-aun", "uploads");
      const staging = path.join(raiz, "no-existe-aun", ".staging");

      expect(fs.existsSync(uploads)).toBe(false);
      prepararDirectorios(uploads, staging);
      expect(fs.existsSync(uploads)).toBe(true);
      expect(fs.existsSync(staging)).toBe(true);
    });

    it("es idempotente: correrlo dos veces no falla", () => {
      const raiz = dir("raiz");
      const a = path.join(raiz, "uploads");
      const b = path.join(raiz, ".staging");
      prepararDirectorios(a, b);
      expect(() => prepararDirectorios(a, b)).not.toThrow();
    });
  });

  describe("configuración insegura: falla al arrancar", () => {
    it("staging igual a uploads", () => {
      const uploads = dir("uploads");

      expect(() => prepararDirectorios(uploads, uploads)).toThrow(ConfiguracionInsegura);
      expect(() => prepararDirectorios(uploads, uploads)).toThrow(/mismo directorio/i);
    });

    it("staging dentro de uploads", () => {
      const raiz = dir("raiz");
      const uploads = path.join(raiz, "uploads");
      const staging = path.join(uploads, ".tmp");

      expect(() => prepararDirectorios(uploads, staging)).toThrow(ConfiguracionInsegura);
      // El motivo tiene que estar en el mensaje: quien lo lea a las 3 de la
      // mañana necesita saber por qué, no sólo que no arranca.
      expect(() => prepararDirectorios(uploads, staging)).toThrow(/servir/i);
    });

    it("staging dentro de uploads por un enlace simbólico", () => {
      const raiz = dir("raiz");
      const uploads = path.join(raiz, "uploads");
      const adentro = path.join(uploads, ".tmp");
      fs.mkdirSync(adentro, { recursive: true });
      const enlace = path.join(raiz, "staging-link");
      fs.symlinkSync(adentro, enlace);

      // Comparando las rutas tal como vienen, este caso pasaría: son dos rutas
      // que no se parecen en nada. Resolver con `realpath` es lo que lo atrapa.
      expect(() => prepararDirectorios(uploads, enlace)).toThrow(ConfiguracionInsegura);
    });

    it("uploads dentro de staging", () => {
      const raiz = dir("raiz");
      const staging = path.join(raiz, "staging");
      const uploads = path.join(staging, "publicos");

      // Al revés también es un problema: el barrido de huérfanos recorre
      // staging y borraría por antigüedad archivos publicados que alguna
      // página está usando.
      expect(() => prepararDirectorios(uploads, staging)).toThrow(ConfiguracionInsegura);
      expect(() => prepararDirectorios(uploads, staging)).toThrow(/barrido|publicados/i);
    });

    it("en sistemas de archivos distintos", () => {
      const raiz = dir("raiz");
      const uploads = path.join(raiz, "uploads");
      const staging = path.join(raiz, ".staging");
      fs.mkdirSync(uploads, { recursive: true });
      fs.mkdirSync(staging, { recursive: true });

      // No se puede montar un volumen en una prueba, así que se simula lo que
      // el sistema reportaría: `dev` distinto para cada uno.
      const realStat = fs.statSync;
      vi.spyOn(fs, "statSync").mockImplementation(((ruta: fs.PathLike, ...resto: never[]) => {
        const s = realStat(ruta, ...resto) as fs.Stats;
        if (String(ruta) === fs.realpathSync(staging)) {
          return { ...s, dev: s.dev + 1 } as fs.Stats;
        }
        return s;
      }) as never);

      expect(() => prepararDirectorios(uploads, staging)).toThrow(ConfiguracionInsegura);
      expect(() => prepararDirectorios(uploads, staging)).toThrow(/atómic/i);
    });

    it("el error es del tipo que se puede reconocer, no un Error suelto", () => {
      const uploads = dir("uploads");
      try {
        prepararDirectorios(uploads, uploads);
        expect.unreachable("tenía que lanzar");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfiguracionInsegura);
        expect((err as Error).name).toBe("ConfiguracionInsegura");
      }
    });
  });
});

describe("borrarTemporal", () => {
  it("borra y devuelve true", async () => {
    const raiz = dir("raiz");
    const archivo = path.join(raiz, "algo.part");
    fs.writeFileSync(archivo, "x");

    expect(await borrarTemporal(archivo)).toBe(true);
    expect(fs.existsSync(archivo)).toBe(false);
  });

  it("un archivo que ya no está no es un fallo", async () => {
    const raiz = dir("raiz");
    expect(await borrarTemporal(path.join(raiz, "nunca-existio.part"))).toBe(true);
  });

  it("cuando no puede borrar lo registra y devuelve false", async () => {
    const escrito: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      escrito.push(a.map(String).join(" "));
    });
    const fallo = Object.assign(new Error("read-only file system"), { code: "EROFS" });
    vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(fallo);

    const raiz = dir("raiz");
    const archivo = path.join(raiz, "abcdef01-2345-4678-9abc-def012345678.part");

    // Un fallo silencioso llenaría staging hasta que las subidas empiecen a
    // fallar por otro motivo, sin una línea en el log sobre la causa real.
    expect(await borrarTemporal(archivo)).toBe(false);
    expect(escrito.join("\n")).toContain("EROFS");
  });

  it("lo que registra no lleva la ruta absoluta ni el nombre original", async () => {
    const escrito: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      escrito.push(a.map(String).join(" "));
    });
    vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(
      Object.assign(new Error("denegado"), { code: "EACCES" }),
    );

    const raiz = dir("historia-clinica-de-rosalinda");
    const archivo = path.join(raiz, "abcdef01-2345-4678-9abc-def012345678.part");
    await borrarTemporal(archivo);

    const todo = escrito.join("\n");
    expect(todo, "publicó la disposición del servidor").not.toContain(raiz);
    expect(todo).not.toContain("historia-clinica");
    expect(todo).not.toContain("denegado");
    // Sí el nombre del temporal, que es un UUID que generamos nosotros.
    expect(todo).toContain("abcdef01-2345-4678-9abc-def012345678.part");
    expect(todo).toContain("EACCES");
  });
});
