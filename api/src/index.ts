import "dotenv/config";
import { createApp, PORT } from "./app.js";
import { db } from "./db.js";
import { installProcessHandlers } from "./lifecycle.js";
import { limpiarStagingViejo } from "./routes/admin/media.js";

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`✓ API en http://localhost:${PORT}`);
});

/**
 * Barre los temporales de subidas que quedaron de una caída anterior.
 *
 * Va acá y no en `createApp()` a propósito: las pruebas montan la aplicación
 * decenas de veces y no tienen por qué pagar un `readdir` cada vez. Si falla,
 * no es motivo para no arrancar.
 */
limpiarStagingViejo()
  .then((borrados) => {
    if (borrados > 0) console.log(`✓ ${borrados} temporal(es) de subida barridos`);
  })
  .catch(() => {});

installProcessHandlers({ server, closeDb: () => db.destroy() });
