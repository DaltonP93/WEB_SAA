import { describe, expect, it } from "vitest";
import { filterByDoctor, summarizeDoctors } from "../apps/web/src/lib/doctor-filters";
import type { Doctor } from "../shared/types/index";

const doctor = (slug: string, name: string): Doctor => ({
  id: slug.length,
  slug,
  name,
  specialties: [],
});

const list = [doctor("a", "Dra. A"), doctor("b", "Dr. B"), doctor("c", "Dra. C")];

describe("filterByDoctor", () => {
  it("sin médico elegido devuelve todos", () => {
    expect(filterByDoctor(list, "")).toHaveLength(3);
  });

  it("filtra por slug de médico", () => {
    expect(filterByDoctor(list, "b").map((d) => d.name)).toEqual(["Dr. B"]);
  });

  it("un slug inexistente no devuelve nada", () => {
    expect(filterByDoctor(list, "zzz")).toEqual([]);
  });
});

describe("summarizeDoctors", () => {
  it("distingue total encontrado de total mostrado cuando hay límite", () => {
    const s = summarizeDoctors(list, { limit: 2 });
    expect(s).toMatchObject({ total: 3, shown: 2, hiddenByLimit: 1 });
    expect(s.label).toBe("Mostrando 2 de 3 profesionales");
  });

  it("sin límite muestra el total", () => {
    expect(summarizeDoctors(list).label).toBe("3 profesionales");
  });

  it("singulariza con un solo resultado", () => {
    expect(summarizeDoctors([list[0]]).label).toBe("1 profesional");
  });

  it("informa cuando no hay resultados", () => {
    const s = summarizeDoctors([]);
    expect(s).toMatchObject({ total: 0, shown: 0, hiddenByLimit: 0 });
    expect(s.label).toBe("Sin resultados");
  });

  it("mientras carga no miente con un total", () => {
    expect(summarizeDoctors([], { isLoading: true }).label).toBe("Buscando…");
  });

  it("ignora límites inválidos en vez de vaciar la lista", () => {
    expect(summarizeDoctors(list, { limit: 0 }).shown).toBe(3);
    expect(summarizeDoctors(list, { limit: -5 }).shown).toBe(3);
    expect(summarizeDoctors(list, { limit: Number.NaN }).shown).toBe(3);
  });

  it("un límite mayor al total no oculta nada", () => {
    expect(summarizeDoctors(list, { limit: 99 })).toMatchObject({ shown: 3, hiddenByLimit: 0 });
  });
});
