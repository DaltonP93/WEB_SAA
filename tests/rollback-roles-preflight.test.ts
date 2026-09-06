import { describe, expect, it } from "vitest";
import {
  ROLES_MIGRACION,
  ROLES_HISTORICOS,
  evaluarPreflightRoles,
  mensajeBloqueoRoles,
} from "../scripts/deploy/roles-rollback-preflight.mjs";

/**
 * Bloqueante B — núcleo del preflight de rollback de roles, sin base ni bash.
 *
 * Decide si un rollback debe abortarse ANTES del primer `migrate:down`: si cruza
 * la migración de roles granulares y existe algún usuario con un rol fuera de
 * {superadmin, editor}, angostar el enum lo degradaría a `editor` (elevación de
 * privilegio). Es un módulo nuevo (no existía antes de este cambio).
 *
 *   pnpm test tests/rollback-roles-preflight.test.ts
 */

const OTRA = "20260903000000_admin_audit_log.ts";
const NUEVOS = ["admin", "autor", "revisor", "analista_marketing", "operador_leads", "auditor"];

describe("preflight de rollback de roles", () => {
  it("no bloquea si el rollback NO cruza la migración de roles", async () => {
    const r = await evaluarPreflightRoles({
      pendientes: [OTRA],
      contarRestringidos: async () => [{ role: "auditor", n: 5 }], // aunque hubiera
    });
    expect(r.bloquear).toBe(false);
    expect(r.cruza).toBe(false);
  });

  it("no bloquea si sólo quedan roles históricos (cero restringidos)", async () => {
    const r = await evaluarPreflightRoles({
      pendientes: [ROLES_MIGRACION, OTRA],
      contarRestringidos: async () => [],
    });
    expect(r.bloquear).toBe(false);
    expect(r.cruza).toBe(true);
  });

  it.each(NUEVOS)("bloquea si existe al menos un usuario con rol %s", async (rol) => {
    const r = await evaluarPreflightRoles({
      pendientes: [ROLES_MIGRACION],
      contarRestringidos: async () => [{ role: rol, n: 1 }],
    });
    expect(r.bloquear).toBe(true);
    expect(r.cruza).toBe(true);
  });

  it("bloquea con una mezcla de roles restringidos", async () => {
    const r = await evaluarPreflightRoles({
      pendientes: [ROLES_MIGRACION],
      contarRestringidos: async () => [
        { role: "auditor", n: 2 },
        { role: "autor", n: 3 },
      ],
    });
    expect(r.bloquear).toBe(true);
    expect(r.conteos).toHaveLength(2);
  });

  it("el mensaje de bloqueo lleva sólo conteos por rol, nunca nombres ni correos", () => {
    const msg = mensajeBloqueoRoles([
      { role: "auditor", n: 2 },
      { role: "operador_leads", n: 1 },
    ]);
    expect(msg).toMatch(/auditor=2/);
    expect(msg).toMatch(/operador_leads=1/);
    expect(msg).toMatch(/ELEVACIÓN de privilegio/i);
    expect(msg).toMatch(/backup verificado ANTERIOR/i);
    expect(msg).toMatch(/mapeo manual/i);
    expect(msg).not.toMatch(/@/); // ningún correo
  });

  it("los roles históricos son exactamente superadmin y editor", () => {
    expect([...ROLES_HISTORICOS].sort()).toEqual(["editor", "superadmin"]);
  });
});
