/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KIRO_ADMIN_BASE_URL?: string
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
