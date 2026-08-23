/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly ELECTRON_RENDERER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
