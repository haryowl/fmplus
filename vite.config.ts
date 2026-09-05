import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleAnalyzeRequest } from "./server/analyze.mjs";
import { handleEmbedContextRequest } from "./server/embed-context.mjs";
import { handleLtProxyRequest } from "./server/proxy-lt.mjs";
import { handleTracksBatchRequest } from "./server/tracks-batch.mjs";
import { handleUserDayTracksRequest } from "./server/user-day-tracks.mjs";
import { handleNearbyFuelRequest } from "./server/nearby-fuel.mjs";
import { handleHealthRequest } from "./server/health.mjs";
import { handleAdminRequest, maybeBootstrapAdmin } from "./server/admin-api.mjs";
import { handleFieldRequest } from "./server/field-api.mjs";
import { handleArmadaNotifyRequest } from "./server/armada-notify.mjs";
import { handleExceptionsRequest } from "./server/exceptions-api.mjs";
import { initTenantVault } from "./server/tenants.mjs";
import { runMigrations } from "./server/db/migrate.mjs";

function apiPlugin(): Plugin {
  return {
    name: "vehicle-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          if (await handleHealthRequest(req, res)) return;
          if (await handleArmadaNotifyRequest(req, res)) return;
          if (await handleExceptionsRequest(req, res)) return;
          if (await handleAdminRequest(req, res)) return;
          if (await handleFieldRequest(req, res)) return;
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
          if (await handleHealthRequest(req, res)) return;
          if (await handleArmadaNotifyRequest(req, res)) return;
          if (await handleExceptionsRequest(req, res)) return;
          if (await handleAdminRequest(req, res)) return;
          if (await handleFieldRequest(req, res)) return;
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
    plugins: [
      react(),
      apiPlugin(),
      {
        name: "fmplus-boot-vault",
        async configureServer() {
          if (process.env.VITEST) return;
          try {
            await runMigrations();
            await initTenantVault();
            await maybeBootstrapAdmin();
          } catch (err) {
            console.warn("[boot] vault/db:", err instanceof Error ? err.message : err);
          }
        },
      },
    ],
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
