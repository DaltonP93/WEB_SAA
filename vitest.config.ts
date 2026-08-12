import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@sa/shared": path.resolve(__dirname, "shared/types/index.ts"),
      "@sa/shared/blocks": path.resolve(__dirname, "shared/types/blocks.ts"),
      "@sa/shared/block-schemas": path.resolve(__dirname, "shared/types/block-schemas.ts"),
      // knex y mysql2 son dependencias de api/, no de la raíz.
      knex: path.resolve(__dirname, "api/node_modules/knex/knex.js"),
      mysql2: path.resolve(__dirname, "api/node_modules/mysql2/index.js"),
      // lucide-react es dependencia de apps/web, no de la raíz.
      "lucide-react/dynamicIconImports": path.resolve(
        __dirname,
        "apps/web/node_modules/lucide-react/dynamicIconImports.js",
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // La suite de base de datos sólo corre si hay MySQL/MariaDB accesible.
    testTimeout: 30_000,
  },
});
