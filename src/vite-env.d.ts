/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARMADA_API_BASE?: string;
  readonly VITE_EMBED_ORIGINS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
