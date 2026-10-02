/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARMADA_API_BASE?: string;
  readonly VITE_EMBED_ORIGINS?: string;
  readonly VITE_OFFLINE_FIELD?: string;
  readonly VITE_FIELD_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
