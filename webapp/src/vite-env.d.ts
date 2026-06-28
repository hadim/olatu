/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the data tiers (must end in `/`). Defaults to the HF dataset. */
  readonly VITE_DATA_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
