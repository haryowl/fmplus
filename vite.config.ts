import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleAnalyzeRequest } from "./server/analyze.mjs";
import { handleEmbedContextRequest } from "./server/embed-context.mjs";
import { handleLtProxyRequest } from "./server/proxy-lt.mjs";
import { handleTracksBatchRequest } from "./server/tracks-batch.mjs";
import { handleUserDayTracksRequest } from "./server/user-day-tracks.mjs";
import { handleNearbyFuelRequest } from "./server/nearby-fuel.mjs";

function apiPlugin(): Plugin {
  return {
    name: "vehicle-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          if (await handleEmbedContextRequest(req, res)) return;
          if (await handleTracksBatchRequest(req, res)) return;
          if (await handleUserDayTracksRequest(req, res)) return;
          if (await handleNearbyFuelRequest(req, res)) return;
          if (await handleAnalyzeRequest(req, res)) return;
          if (await handleLtProxyRequest(req, res)) return;
          next();
        })().catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          if (await handleEmbedContextRequest(req, res)) return;
          if (await handleTracksBatchRequest(req, res)) return;
          if (await handleUserDayTracksRequest(req, res)) return;
          if (await handleNearbyFuelRequest(req, res)) return;
          if (await handleAnalyzeRequest(req, res)) return;
          if (await handleLtProxyRequest(req, res)) return;
          next();
        })().catch(next);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    plugins: [react(), apiPlugin()],
    optimizeDeps: {
      include: ["jspdf", "jspdf-autotable", "leaflet"],
    },
    server: {
      port: 5173,
    },
    preview: {
      port: 4173,
    },
  };
});
