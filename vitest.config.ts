import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Mismo runtime de JSX que usan las apps (`react-jsx`): las pruebas de
  // componente no necesitan importar React.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      // Las subrutas van antes del alias raíz: gana la primera que matchea y
      // el matcher es por prefijo.
      "@sa/shared/blocks": path.resolve(__dirname, "shared/types/blocks.ts"),
      "@sa/shared/block-schemas": path.resolve(__dirname, "shared/types/block-schemas.ts"),
      "@sa/shared/embed-hosts": path.resolve(__dirname, "shared/types/embed-hosts.ts"),
      "@sa/shared/institutional-red": path.resolve(__dirname, "shared/types/institutional-red.ts"),
      "@sa/shared/contact-values": path.resolve(__dirname, "shared/types/contact-values.ts"),
      "@sa/shared": path.resolve(__dirname, "shared/types/index.ts"),
      // knex y mysql2 son dependencias de api/, no de la raíz.
      knex: path.resolve(__dirname, "api/node_modules/knex/knex.js"),
      mysql2: path.resolve(__dirname, "api/node_modules/mysql2/index.js"),
      bcryptjs: path.resolve(__dirname, "api/node_modules/bcryptjs/index.js"),
      // Dependencias de apps/web que las pruebas de componente importan
      // directamente (los componentes las resuelven solos, un archivo de
      // prueba en la raíz no).
      "react-router-dom": path.resolve(__dirname, "apps/web/node_modules/react-router-dom"),
      // lucide-react es dependencia de apps/web, no de la raíz. La subruta va
      // antes que el paquete: el matcher es por prefijo y gana la primera.
      "lucide-react/dynamicIconImports": path.resolve(
        __dirname,
        "apps/web/node_modules/lucide-react/dynamicIconImports.js",
      ),
      "lucide-react": path.resolve(__dirname, "apps/web/node_modules/lucide-react"),
    },
  },
  test: {
    // Los `.test.tsx` son las pruebas de componente: piden su entorno con
    // `// @vitest-environment jsdom` en la primera línea del archivo.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    // La suite de base de datos sólo corre si hay MySQL/MariaDB accesible.
    testTimeout: 30_000,
  },
});
