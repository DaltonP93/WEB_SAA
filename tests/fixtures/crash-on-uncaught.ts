/**
 * Fixture de `tests/lifecycle.test.ts`.
 *
 * Levanta un servidor mínimo con la misma red de seguridad que la API y
 * después lanza una excepción no capturada desde un callback (o un rechazo sin
 * dueño, según el argumento). El proceso tiene que cerrar el servidor, cerrar
 * el pool y salir con código distinto de cero para que PM2 lo reinicie.
 *
 *   tsx tests/fixtures/crash-on-uncaught.ts uncaught|rejection|sigterm
 */

import { createServer } from "node:http";
import { installProcessHandlers } from "../../api/src/lifecycle.js";

const mode = process.argv[2] ?? "uncaught";

const server = createServer((_req, res) => res.end("ok"));
server.listen(0, () => {
  let closed = false;
  installProcessHandlers({
    server,
    closeDb: async () => {
      closed = true;
      console.log("[fixture] pool cerrado");
    },
    exit: (code) => {
      console.log(`[fixture] exit(${code}) poolCerrado=${closed}`);
      process.exit(code);
    },
    forceExitMs: 2_000,
  });

  if (mode === "uncaught") {
    setTimeout(() => {
      throw new Error("fallo simulado fuera de todo handler");
    }, 10);
  } else if (mode === "rejection") {
    setTimeout(() => {
      void Promise.reject(new Error("rechazo simulado sin dueño"));
      // El proceso NO debe morir por esto: sale solo tras confirmarlo.
      setTimeout(() => {
        console.log("[fixture] sigo vivo tras el rechazo");
        process.exit(7);
      }, 200);
    }, 10);
  } else if (mode === "sigterm") {
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 10);
  }
});
