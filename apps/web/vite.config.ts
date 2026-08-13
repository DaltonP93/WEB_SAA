import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Las subrutas van antes del alias raíz: el matcher es por prefijo.
      "@sa/shared/institutional-red": path.resolve(__dirname, "../../shared/types/institutional-red.ts"),
      "@sa/shared/contact-values": path.resolve(__dirname, "../../shared/types/contact-values.ts"),
      "@sa/shared/block-schemas": path.resolve(__dirname, "../../shared/types/block-schemas.ts"),
      "@sa/shared/blocks": path.resolve(__dirname, "../../shared/types/blocks.ts"),
      "@sa/shared": path.resolve(__dirname, "../../shared/types/index.ts"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:4000",
      "/uploads": "http://localhost:4000",
    },
  },
});
