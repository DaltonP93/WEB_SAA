import { describe, expect, it } from "vitest";
import { channelHref, waDigits } from "../apps/web/src/lib/contact-channels";
import type { ContactChannel } from "../shared/types/index";

/**
 * Los enlaces de los canales se arman con datos que carga el sanatorio desde
 * el panel. Estas pruebas fijan la regla: con dato válido se genera el enlace
 * correcto; sin dato (o con dato inválido) NO se genera enlace, para que la UI
 * muestre "A confirmar" en vez de un href roto.
 */

const base: Pick<ContactChannel, "kind" | "value" | "message" | "href"> = {
  kind: "phone",
  value: null,
  message: null,
  href: null,
};

describe("channelHref", () => {
  it("arma wa.me con sólo dígitos", () => {
    expect(channelHref({ ...base, kind: "whatsapp", value: "+595 981 123 456" })).toBe(
      "https://wa.me/595981123456",
    );
  });

  it("incluye el mensaje pre-cargado codificado", () => {
    const href = channelHref({
      ...base,
      kind: "whatsapp",
      value: "+595981123456",
      message: "Hola, quisiera un turno",
    });
    expect(href).toBe("https://wa.me/595981123456?text=Hola%2C%20quisiera%20un%20turno");
  });

  it("no genera wa.me con un número demasiado corto", () => {
    expect(channelHref({ ...base, kind: "whatsapp", value: "1234" })).toBeUndefined();
  });

  it("arma tel: conservando el prefijo internacional", () => {
    expect(channelHref({ ...base, kind: "phone", value: "+595 21 000 000" })).toBe("tel:+59521000000");
  });

  it("arma mailto: sólo con un correo válido", () => {
    expect(channelHref({ ...base, kind: "email", value: "gth@sanatorio.test" })).toBe(
      "mailto:gth@sanatorio.test",
    );
    expect(channelHref({ ...base, kind: "email", value: "no-es-correo" })).toBeUndefined();
  });

  it("sin valor cargado no devuelve enlace (queda 'A confirmar')", () => {
    expect(channelHref({ ...base, kind: "whatsapp", value: null })).toBeUndefined();
    expect(channelHref({ ...base, kind: "phone", value: "" })).toBeUndefined();
    expect(channelHref({ ...base, kind: "email", value: "   " })).toBeUndefined();
  });

  it("kind url usa href y no inventa uno", () => {
    expect(channelHref({ ...base, kind: "url", href: "https://ejemplo.test" })).toBe("https://ejemplo.test");
    expect(channelHref({ ...base, kind: "url", href: null })).toBeUndefined();
  });
});

describe("waDigits", () => {
  it("deja sólo dígitos", () => {
    expect(waDigits("+595 (981) 123-456")).toBe("595981123456");
  });
});
