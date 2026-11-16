/// <reference types="vite/client" />

interface Window {
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite'
    startIn?: string
  }) => Promise<FileSystemDirectoryHandle>

  api?: {
    listDir: (path: string) => Promise<{
      path: string
      name: string
      entries: any[]
      error?: string | null
    }>
    listSubdirs: (path: string) => Promise<{ name: string; path: string }[]>
    listRecursive: (
      path: string,
      limit: number,
      exts: string[]
    ) => Promise<{
      path: string
      name: string
      entries: any[]
      truncated: boolean
      scanned: number
      error: string | null
    }>
    pickFolder: () => Promise<string | null>
    getThumb: (path: string, size: number) => Promise<{
      ok: boolean
      dataUrl: string | null
      w: number | null
      h: number | null
      colorMode: number | null
      depth: number | null
      err: string | null
    }>
    openPath: (path: string) => Promise<boolean>
    reveal: (path: string) => Promise<void>
  }
}
