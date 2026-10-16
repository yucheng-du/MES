import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pdfAssets } from "./pdf-assets";
export default defineConfig({
  plugins: [react(), pdfAssets()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: { "/api": { target: "http://127.0.0.1:4300", changeOrigin: false } },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
