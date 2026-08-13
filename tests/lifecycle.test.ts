import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Qué hace el proceso cuando algo se rompe fuera de todo handler.
 *
 * Antes `uncaughtException` sólo logueaba y el proceso seguía en pie con el
 * estado ya corrupto: PM2 no reiniciaba nada, el health check contestaba y el
 * problema quedaba escondido. Ahora cierra de forma controlada y sale con
 * código distinto de cero. Un rechazo sin dueño, en cambio, no debe tumbar la
 * API: se loguea y sigue.
 *
 * Se ejecuta como proceso hijo real porque es la única forma de observar el
 * código de salida de verdad.
 */

const ROOT = resolve(__dirname, "..");
const FIXTURE = resolve(ROOT, "tests/fixtures/crash-on-uncaught.ts");
const TSX = resolve(ROOT, "api/node_modules/.bin/tsx");

function run(mode: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [FIXTURE, mode],
      { cwd: ROOT, timeout: 30_000 },
      (err, stdout, stderr) => {
        const code = (err as { code?: number } | null)?.code ?? 0;
        resolvePromise({ code, stdout, stderr });
      },
    );
  });
}

describe("red de seguridad del proceso", () => {
  it("una excepción no capturada cierra y sale con código != 0", async () => {
    const { code, stdout, stderr } = await run("uncaught");
    expect(stderr).toContain("[uncaughtException]");
    // Cierre controlado: el pool se cerró antes de salir.
    expect(stdout).toContain("poolCerrado=true");
    expect(stdout).toContain("exit(1)");
    // Distinto de cero: PM2 lo interpreta como caída y reinicia.
    expect(code).toBe(1);
  }, 40_000);

  it("un rechazo sin dueño se loguea pero no tumba el proceso", async () => {
    const { code, stdout, stderr } = await run("rejection");
    expect(stderr).toContain("[unhandledRejection]");
    expect(stdout).toContain("sigo vivo tras el rechazo");
    // 7 es el código que sale del propio fixture, no de una caída.
    expect(code).toBe(7);
  }, 40_000);

  it("SIGTERM cierra limpio y sale con 0", async () => {
    const { code, stdout } = await run("sigterm");
    expect(stdout).toContain("poolCerrado=true");
    expect(stdout).toContain("exit(0)");
    expect(code).toBe(0);
  }, 40_000);
});
