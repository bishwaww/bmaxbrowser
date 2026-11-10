export type UpdateStatus = 'idle' | 'unsupported' | 'checking' | 'none' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** Version of the available/downloaded update. */
  version?: string | undefined
  /** 0..100 while downloading. */
  progress?: number | undefined
  /** Human-readable detail (why unsupported, error text). */
  message?: string | undefined
  /** Unix ms of the last completed check. */
  checkedAt?: number | undefined
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  packaged: boolean
  updates: UpdateState
}
