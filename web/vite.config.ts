import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Node server owns /api. In development the Vite server proxies to it, so the old
// vanilla UI in public/ keeps working on the Node port until the cutover commit.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3850",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
