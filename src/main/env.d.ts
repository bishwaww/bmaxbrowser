declare module '*?modulePath' {
  const path: string
  export default path
}

declare module '*?nodeWorker' {
  import type { Worker, WorkerOptions } from 'node:worker_threads'
  export default function createWorker(options?: WorkerOptions): Worker
}

declare module '*?raw' {
  const source: string
  export default source
}
