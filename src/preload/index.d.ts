import type { YorkApi } from './index'

declare global {
  interface Window {
    york: YorkApi
  }
}

export {}
