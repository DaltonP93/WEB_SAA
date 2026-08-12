import type { Server } from "node:http";

/**
 * Apagado controlado y red de seguridad ante errores del proceso.
 *
 * Vive aparte de `index.ts` para poder probarlo: `index.ts` sólo levanta el
 * servidor y llama acá.
 */

export interface LifecycleDeps {
  server: Pick<Server, "close">;
  /** Cierra el pool de la base. */
  closeDb: () => Promise<unknown>;
  /** Inyectable para poder verificar el código de salida en las pruebas. */
  exit?: (code: number) => void;
  log?: Pick<Console, "log" | "error">;
  /** Cuánto se espera al cierre antes de forzar la salida. */
  forceExitMs?: number;
}

export function installProcessHandlers(deps: LifecycleDeps) {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const log = deps.log ?? console;
  const forceExitMs = deps.forceExitMs ?? 10_000;

  let shuttingDown = false;

  /**
   * Deja de aceptar conexiones, cierra el pool y sale. Si algo queda colgado,
   * se fuerza la salida. Un apagado que "falla" nunca sale con 0: si no fue un
   * apagado limpio, el supervisor tiene que enterarse.
   */
  async function shutdown(signal: string, code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.log(`\n→ ${signal} recibido, cerrando…`);

    const forceExit = setTimeout(() => {
      log.error(`→ cierre forzado tras ${forceExitMs}ms`);
      exit(code === 0 ? 1 : code);
    }, forceExitMs);
    forceExit.unref?.();

    deps.server.close(async () => {
      clearTimeout(forceExit);
      try {
        await deps.closeDb();
        log.log("→ conexiones cerradas");
        exit(code);
      } catch (err) {
        log.error("→ error cerrando el pool:", err);
        exit(code === 0 ? 1 : code);
      }
    });
  }

  /*
   * Un rechazo sin dueño casi siempre es una consulta que falló fuera del
   * wrapper de handlers async: se loguea y el proceso sigue, porque un error
   * puntual de la base no debería tumbar la API entera.
   */
  process.on("unhandledRejection", (reason) => {
    log.error("[unhandledRejection]", reason);
  });

  /*
   * Una excepción no capturada es otra cosa: a esa altura el estado del proceso
   * ya no es confiable —puede haber quedado un `await` a medias, una conexión
   * tomada o un lock sin liberar—. Seguir en pie es peor que reiniciar, y
   * encima esconde el problema: el health check contesta 200 mientras las
   * requests fallan. Se cierra y se sale con código distinto de cero, que es lo
   * que PM2 necesita para reiniciar.
   */
  process.on("uncaughtException", (err) => {
    log.error("[uncaughtException]", err);
    void shutdown("uncaughtException", 1);
  });

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  return { shutdown };
}
