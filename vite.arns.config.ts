import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import { turboBrowserPolyfills } from "./build/turbo-browser-polyfills";

export default defineConfig({
  root: "arns",
  base: "./",
  publicDir: "../public",
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
  },
  plugins: [react(), turboBrowserPolyfills()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  build: {
    outDir: "../arns-dist",
    emptyOutDir: true,
  },
});
