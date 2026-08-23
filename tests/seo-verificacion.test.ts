import { describe, expect, it } from "vitest";
import {
  VERIFICACION_VACIA,
  normalizarSeo,
  sanearVerificacion,
  validarVerificacion,
} from "../api/src/seo.js";

/**
 * Verificación de propiedad del sitio (Search Console / Bing). Pura, sin base:
 *
 *   pnpm test tests/seo-verificacion.test.ts
 *
 * Importa por dónde termina el valor: el token va al atributo `content` de un
 * `<meta>` en el `<head>`. Un valor con comillas, espacios o `<`/`>` podría
 * romper el atributo o inyectar marcado, así que la validación de forma es la
 * línea de defensa —igual que con los IDs de medición—.
 */

describe("validarVerificacion", () => {
  it("acepta tokens con la forma esperada y los normaliza (recorta)", () => {
    const r = validarVerificacion({ google: "  abc123_DEF-456ghi  ", bing: "A1B2C3D4E5F6a7b8" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ google: "abc123_DEF-456ghi", bing: "A1B2C3D4E5F6a7b8" });
  });

  it("vacío es válido y significa sin verificar", () => {
    for (const entrada of [null, undefined, {}, { google: "", bing: "" }]) {
      const r = validarVerificacion(entrada);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toEqual(VERIFICACION_VACIA);
    }
  });

  it("rechaza un token con caracteres fuera de la allowlist", () => {
    for (const malo of [
      'token"><script>',
      "con espacios",
      "comilla'simple",
      "signo=igual",
      "barra/slash",
      "punto.com",
    ]) {
      const r = validarVerificacion({ google: malo });
      expect(r.ok, `debería rechazar: ${malo}`).toBe(false);
    }
  });

  it("rechaza un token demasiado corto o demasiado largo", () => {
    expect(validarVerificacion({ google: "short" }).ok).toBe(false); // < 8
    expect(validarVerificacion({ bing: "a".repeat(101) }).ok).toBe(false); // > 100
    expect(validarVerificacion({ google: "a".repeat(8) }).ok).toBe(true);
    expect(validarVerificacion({ google: "a".repeat(100) }).ok).toBe(true);
  });

  it("un valor que no es objeto es un error, no un 500", () => {
    expect(validarVerificacion("token-suelto").ok).toBe(false);
    expect(validarVerificacion(["a"]).ok).toBe(false);
    expect(validarVerificacion(123).ok).toBe(false);
  });

  it("un campo que no es texto se rechaza", () => {
    expect(validarVerificacion({ google: 42 }).ok).toBe(false);
  });

  it("el mensaje de error no repite el valor recibido", () => {
    const r = validarVerificacion({ google: "PEGADO-MALICIOSO<script>" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores.join(" ")).not.toContain("PEGADO-MALICIOSO");
  });
});

describe("sanearVerificacion (camino de lectura, no lanza)", () => {
  it("conserva el token válido y descarta el inválido del mismo objeto", () => {
    // Una fila vieja o editada a mano: el token bueno pasa, el roto no puede
    // llegar al content de un meta.
    expect(sanearVerificacion({ google: "token_bueno_1234", bing: "roto<>" })).toEqual({
      google: "token_bueno_1234",
      bing: "",
    });
  });

  it("un valor basura devuelve la forma vacía", () => {
    expect(sanearVerificacion("x")).toEqual(VERIFICACION_VACIA);
    expect(sanearVerificacion(null)).toEqual(VERIFICACION_VACIA);
  });
});

describe("normalizarSeo", () => {
  it("conserva los campos libres y normaliza sólo verification", () => {
    const seo = normalizarSeo({
      title: "Sanatorio",
      description: "Atención integral",
      ogImage: "/uploads/og.png",
      verification: { google: "token_valido_123456", bing: "" },
    });
    expect(seo.title).toBe("Sanatorio");
    expect(seo.description).toBe("Atención integral");
    expect(seo.ogImage).toBe("/uploads/og.png");
    expect(seo.verification).toEqual({ google: "token_valido_123456", bing: "" });
  });

  it("omite verification cuando no queda ningún token", () => {
    const seo = normalizarSeo({ title: "X", verification: { google: "", bing: "" } });
    expect("verification" in seo).toBe(false);
    expect(seo.title).toBe("X");
  });

  it("omite verification si venían tokens inválidos (no se guarda basura)", () => {
    const seo = normalizarSeo({ verification: { google: "roto<>", bing: "con espacio" } });
    expect("verification" in seo).toBe(false);
  });

  it("acepta el valor como string JSON (MariaDB) y como objeto (MySQL)", () => {
    const comoString = normalizarSeo(JSON.stringify({ title: "T", verification: { google: "tok_1234567" } }));
    expect(comoString.title).toBe("T");
    expect(comoString.verification).toEqual({ google: "tok_1234567", bing: "" });
  });

  it("un seo ausente o basura devuelve un objeto vacío", () => {
    expect(normalizarSeo(null)).toEqual({});
    expect(normalizarSeo("no-json")).toEqual({});
    expect(normalizarSeo(["a"])).toEqual({});
  });
});
