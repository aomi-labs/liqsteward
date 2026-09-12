import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: {
      // Keep the browser's Host header: the API's Agent relay verifies that
      // the embedding origin matches the host it was called on.
      "/api": { target: process.env.API_PROXY ?? "http://127.0.0.1:4310", changeOrigin: false },
    },
  },
});
