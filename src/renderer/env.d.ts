/// <reference types="vite/client" />
import type { BmaxApi } from '@shared/api'

declare global {
  interface Window {
    bmax: BmaxApi
  }
}
