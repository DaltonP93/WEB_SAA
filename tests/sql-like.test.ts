import { describe, expect, it } from "vitest";
import { likeLiteral } from "../api/src/sql-like.js";

/**
 * Ronda 2 — escape de comodines en búsquedas `LIKE`.
 *
 * No es inyección (knex parametriza), pero sin escapar `%`/`_`/`\` el término
 * cambia de significado: `%` matchea todo, `a_b` matchea "aXb". Se busca literal.
 *
 *   pnpm test tests/sql-like.test.ts
 */
describe("likeLiteral escapa los comodines de LIKE", () => {
  it("envuelve en % y deja un término normal literal", () => {
    expect(likeLiteral("juan")).toBe("%juan%");
    expect(likeLiteral("a@b.com")).toBe("%a@b.com%");
  });

  it("escapa %, _ y \\", () => {
    expect(likeLiteral("a%b")).toBe("%a\\%b%");
    expect(likeLiteral("a_b")).toBe("%a\\_b%");
    expect(likeLiteral("a\\b")).toBe("%a\\\\b%");
  });

  it("un término de sólo comodines no queda como 'matchea todo'", () => {
    expect(likeLiteral("%")).toBe("%\\%%");
    expect(likeLiteral("_")).toBe("%\\_%");
    expect(likeLiteral("%%%")).toBe("%\\%\\%\\%%");
  });
});
