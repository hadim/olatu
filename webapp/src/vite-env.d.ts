/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the data tiers (must end in `/`). Defaults to the HF dataset. */
  readonly VITE_DATA_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Deployed commit short hash, inlined at build time (vite.config.js). `"dev"` locally. */
declare const __COMMIT_HASH__: string;
/** Deployed commit ISO date, inlined at build time. Empty when git is unavailable. */
declare const __COMMIT_DATE__: string;
