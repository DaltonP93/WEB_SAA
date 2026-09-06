import "dotenv/config";
import { createApp, PORT } from "./app.js";
import { db } from "./db.js";
import { installProcessHandlers } from "./lifecycle.js";
import { limpiarStagingViejo } from "./routes/admin/media.js";

const app = createApp();

// Bind a loopback por defecto: en producción la API vive detrás de Nginx en el
// mismo host, así que no tiene por qué escuchar en todas las interfaces (evita
// exponer el puerto directo, donde no rige `trust proxy` y se podría falsificar la
// IP de la bitácora). `BIND_HOST=0.0.0.0` lo abre explícitamente si hiciera falta.
const HOST = process.env.BIND_HOST ?? "127.0.0.1";

const server = app.listen(PORT, HOST, () => {
  console.log(`✓ API en http://${HOST}:${PORT}`);
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
