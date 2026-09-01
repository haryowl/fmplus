import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleAnalyzeRequest } from "./server/analyze.mjs";

function analyzePlugin(): Plugin {
  return {
    name: "vehicle-analyze",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleAnalyzeRequest(req, res).then((handled) => {
          if (!handled) next();
        }, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleAnalyzeRequest(req, res).then((handled) => {
          if (!handled) next();
        }, next);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const auth = env.ARMADA_AUTH_HEADER || "";

  const armadaProxy = {
    "/lt": {
      target: "https://armada.id",
      changeOrigin: true,
      secure: true,
      headers: {
        Authorization: auth,
        accept: "application/json",
      },
    },
  };

  return {
    plugins: [react(), analyzePlugin()],
    optimizeDeps: {
      include: ["jspdf", "jspdf-autotable", "leaflet"],
    },
    server: {
      port: 5173,
      proxy: armadaProxy,
    },
    preview: {
      port: 4173,
      proxy: armadaProxy,
    },
  };
});
