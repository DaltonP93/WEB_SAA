import "dotenv/config";
import { createApp, PORT } from "./app.js";
import { db } from "./db.js";

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`✓ API en http://localhost:${PORT}`);
});

// Red de seguridad: si algo se escapa del wrapper, se loguea y el proceso
// sigue vivo. Un error puntual de la base no debe tumbar toda la API.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

// Apagado controlado: dejamos de aceptar conexiones, cerramos el pool y
// salimos. Si algo queda colgado, forzamos la salida a los 10s.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n→ ${signal} recibido, cerrando…`);
  const forceExit = setTimeout(() => {
    console.error("→ cierre forzado tras 10s");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    try {
      await db.destroy();
      console.log("→ conexiones cerradas");
      process.exit(0);
    } catch (err) {
      console.error("→ error cerrando el pool:", err);
      process.exit(1);
    }
  });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

