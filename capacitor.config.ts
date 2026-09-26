import type { CapacitorConfig } from "@capacitor/cli";
import { fieldAppOrigin } from "./src/lib/fieldAppUrl.ts";

const origin = fieldAppOrigin(process.env.FIELD_APP_URL);
const originUrl = new URL(origin);

const config: CapacitorConfig = {
  appId: "id.armada.field",
  appName: "ARMADA Field",
  webDir: "dist",
  server: {
    url: `${origin}/m`,
    androidScheme: originUrl.protocol === "http:" ? "http" : "https",
    cleartext: originUrl.protocol === "http:" || originUrl.hostname === "81.17.100.7",
    allowNavigation: [origin, `${origin}/*`],
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
