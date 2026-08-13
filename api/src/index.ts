import "dotenv/config";
import { createApp, PORT } from "./app.js";
import { db } from "./db.js";
import { installProcessHandlers } from "./lifecycle.js";

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`✓ API en http://localhost:${PORT}`);
});

installProcessHandlers({ server, closeDb: () => db.destroy() });
