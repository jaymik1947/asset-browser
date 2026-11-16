import type { Entry } from './types'

export interface DirListing {
  path: string
  name: string
  entries: Entry[]
  error?: string
}

export interface SubDir {
  name: string
  path: string
}

export interface RecursiveListing {
  path: string
  name: string
  entries: Entry[]
  truncated: boolean
  scanned: number
  error?: string | null
}

const api = typeof window !== 'undefined' ? (window as any).api : undefined

export const IS_ELECTRON = !!api

export const IS_TAURI =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as any)

export const IS_NATIVE = IS_ELECTRON || IS_TAURI

const dirHandles = new Map<string, FileSystemDirectoryHandle>()
const fileHandles = new Map<string, FileSystemFileHandle>()

let coreMod: any = null

export async function invokeCmd<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!coreMod) coreMod = await import('@tauri-apps/api/core')
  return (await coreMod.invoke(cmd, args)) as T
}

function joinPath(base: string, name: string): string {
  if (!base) return name
  return base.endsWith('\\') || base.endsWith('/') ? base + name : base + '\\' + name
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return ''
  return name.slice(i + 1).toLowerCase()
}

export function splitPath(p: string): string[] {
  return p.split(/[\\/]/).filter(Boolean)
}

export async function pickRoot(): Promise<DirListing | null> {
  if (IS_ELECTRON) {
    const p = await api.pickFolder()
    if (!p) return null
    return listDir(p)
  }
  if (IS_TAURI) {
    const path = await invokeCmd<string | null>('pick_folder')
    if (!path) return null
    return listDir(path)
  }

  if (!window.showDirectoryPicker) {
    throw new Error('当前浏览器不支持读取本地文件夹，请使用桌面版或用 Chrome / Edge 打开')
  }
  const handle = await window.showDirectoryPicker({ mode: 'read' })
  const path = handle.name
  dirHandles.set(path, handle)
  return listDir(path)
}

export async function listDir(path: string): Promise<DirListing> {
  if (IS_ELECTRON) {
    return api.listDir(path)
  }
  if (IS_TAURI) {
    return invokeCmd<DirListing>('list_dir', { path, showHidden: false })
  }

  const handle = dirHandles.get(path)
  if (!handle) {
    return {
      path,
      name: splitPath(path).pop() ?? path,
      entries: [],
      error: '目录句柄已失效，请重新打开',
    }
  }

  const dirs: Entry[] = []
  const files: { entry: Entry; h: FileSystemFileHandle }[] = []

  try {
    for await (const [name, h] of (handle as any).entries()) {
      if (name.startsWith('.') || name === '$RECYCLE.BIN') continue
      const full = joinPath(path, name)
      if (h.kind === 'directory') {
        dirHandles.set(full, h)
        dirs.push({ id: full, name, kind: 'dir', ext: '', size: 0, mtime: 0, handle: h })
      } else {
        fileHandles.set(full, h)
        files.push({
          entry: { id: full, name, kind: 'file', ext: extOf(name), size: 0, mtime: 0, handle: h },
          h,
        })
      }
    }
  } catch (e: any) {
    return {
      path,
      name: splitPath(path).pop() ?? path,
      entries: [...dirs],
      error: e?.message ?? '读取失败',
    }
  }

  const BATCH = 128
  for (let i = 0; i < files.length; i += BATCH) {
    const slice = files.slice(i, i + BATCH)
    await Promise.all(
      slice.map(async ({ entry, h }) => {
        try {
          const f = await (h as any).getFile()
          entry.size = f.size
          entry.mtime = f.lastModified
        } catch {
          entry.size = -1
        }
      })
    )
    await new Promise((r) => setTimeout(r, 0))
  }

  return {
    path,
    name: splitPath(path).pop() ?? path,
    entries: [...dirs, ...files.map((f) => f.entry)],
  }
}

export async function listRecursive(
  path: string,
  limit: number,
  exts: string[]
): Promise<RecursiveListing> {
  if (IS_TAURI) {
    return invokeCmd<RecursiveListing>('list_recursive', {
      path,
      limit,
      showHidden: false,
      exts,
    })
  }
  if (IS_ELECTRON) return api.listRecursive(path, limit, exts)
  return {
    path,
    name: path,
    entries: [],
    truncated: false,
    scanned: 0,
    error: '当前模式不支持递归浏览，请使用桌面版',
  }
}

export async function listSubdirs(path: string): Promise<SubDir[]> {  if (IS_ELECTRON) return api.listSubdirs(path)
  if (IS_TAURI) return invokeCmd<SubDir[]>('list_subdirs', { path })

  const handle = dirHandles.get(path)
  if (!handle) return []
  const out: SubDir[] = []
  try {
    for await (const [name, h] of (handle as any).entries()) {
      if (h.kind !== 'directory') continue
      if (name.startsWith('.') || name === 'node_modules' || name === '$RECYCLE.BIN') continue
      const full = joinPath(path, name)
      dirHandles.set(full, h)
      out.push({ name, path: full })
    }
  } catch {
    return out
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return out
}

export async function getFileHandle(path: string): Promise<FileSystemFileHandle | null> {
  if (IS_NATIVE) return null
  const cached = fileHandles.get(path)
  if (cached) return cached
  const parts = splitPath(path)
  const name = parts.pop()
  const dirPath = parts.join('\\')
  const dir = dirHandles.get(dirPath)
  if (!dir || !name) return null
  try {
    const h = await (dir as any).getFileHandle(name)
    fileHandles.set(path, h)
    return h
  } catch {
    return null
  }
}

export async function nativeThumb(
  path: string,
  size: number
): Promise<{
  ok: boolean
  dataUrl: string | null
  w: number | null
  h: number | null
  colorMode: number | null
  depth: number | null
  err: string | null
} | null> {
  if (IS_ELECTRON) return api.getThumb(path, size)
  if (IS_TAURI) return invokeCmd('get_thumb', { path, size })
  return null
}

export async function openPath(path: string): Promise<boolean> {
  if (IS_ELECTRON) return api.openPath(path)
  if (!IS_TAURI) return false
  try {
    await invokeCmd('open_path', { path })
    return true
  } catch {
    return false
  }
}

export async function revealInExplorer(path: string): Promise<void> {
  if (IS_ELECTRON) {
    await api.reveal(path)
    return
  }
  if (!IS_TAURI) return
  await invokeCmd('reveal_in_explorer', { path })
}

export function resetHandles() {
  dirHandles.clear()
  fileHandles.clear()
}

export function registerDemoFile(path: string, handle: FileSystemFileHandle) {
  fileHandles.set(path, handle)
}

export function registerDemoDir(path: string, handle: FileSystemDirectoryHandle) {
  dirHandles.set(path, handle)
}

export interface CacheStats {
  count: number
  bytes: number
  limit: number
  dir: string
  defaultDir: string
}

export async function cacheStats(): Promise<CacheStats | null> {
  if (IS_TAURI) return invokeCmd<CacheStats>('cache_stats')
  if (IS_ELECTRON) return null
  return null
}

export async function cacheSetLimit(mb: number): Promise<CacheStats | null> {
  if (IS_TAURI) return invokeCmd<CacheStats>('cache_set_limit', { mb })
  return null
}

export async function cacheClear(): Promise<CacheStats | null> {
  if (IS_TAURI) return invokeCmd<CacheStats>('cache_clear')
  return null
}

export async function pickFolderPath(): Promise<string | null> {
  if (IS_TAURI) return invokeCmd<string | null>('pick_folder')
  return null
}

export async function cacheSetDir(
  dir: string
): Promise<{ ok: boolean; stats?: CacheStats; error?: string }> {
  if (!IS_TAURI) return { ok: false, error: '仅桌面版支持' }
  try {
    const stats = await invokeCmd<CacheStats>('cache_set_dir', { dir })
    return { ok: true, stats }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

export interface PrewarmStatus {
  running: boolean
  paused: boolean
  total: number
  done: number
  skipped: number
  failed: number
  path: string
  roots: string[]
  workers: number
}

export async function prewarmStart(
  paths: string[],
  workers = 4,
  limit = 0
): Promise<PrewarmStatus | null> {
  if (!IS_TAURI) return null
  return invokeCmd<PrewarmStatus>('prewarm_start', { paths, workers, limit })
}

export async function prewarmPause(): Promise<PrewarmStatus | null> {
  if (!IS_TAURI) return null
  return invokeCmd<PrewarmStatus>('prewarm_pause')
}

export async function prewarmResume(): Promise<PrewarmStatus | null> {
  if (!IS_TAURI) return null
  return invokeCmd<PrewarmStatus>('prewarm_resume')
}

export async function prewarmStop(): Promise<PrewarmStatus | null> {
  if (!IS_TAURI) return null
  return invokeCmd<PrewarmStatus>('prewarm_stop')
}

export async function prewarmStatus(): Promise<PrewarmStatus | null> {
  if (!IS_TAURI) return null
  return invokeCmd<PrewarmStatus>('prewarm_status')
}

export async function pathIsDir(path: string): Promise<boolean> {
  if (IS_TAURI) return invokeCmd<boolean>('path_is_dir', { path })
  return false
}

export interface AutoStatus {
  enabled: boolean
  intervalMin: number
  paths: string[]
  lastRun: number
  nextRun: number
}

export async function autoWatchSet(
  enabled: boolean,
  intervalMin: number,
  paths: string[]
): Promise<AutoStatus | null> {
  if (!IS_TAURI) return null
  return invokeCmd<AutoStatus>('auto_watch_set', { enabled, intervalMin, paths })
}

export async function autoWatchGet(): Promise<AutoStatus | null> {
  if (!IS_TAURI) return null
  return invokeCmd<AutoStatus>('auto_watch_get')
}

export async function resolveShortcut(path: string): Promise<string | null> {
  if (IS_TAURI) return invokeCmd<string | null>('resolve_shortcut', { path })
  return null
}

export async function setCloseToTray(enabled: boolean): Promise<void> {
  if (!IS_TAURI) return
  try {
    await invokeCmd('set_close_to_tray', { enabled })
  } catch {
    /* 忽略：Web 模式下没有托盘 */
  }
}

export async function findPhotoshop(): Promise<string | null> {
  if (!IS_TAURI) return null
  try {
    const p = await invokeCmd<string | null>('find_photoshop')
    // 统一成反斜杠，避免界面上出现 C:/Program Files/Adobe\... 这种混排
    return p ? p.replace(/\//g, '\\') : null
  } catch {
    return null
  }
}

export async function openInPhotoshop(
  path: string,
  psPath?: string | null
): Promise<{ ok: boolean; error?: string }> {
  if (!IS_TAURI) return { ok: false, error: '仅桌面版支持' }
  try {
    await invokeCmd('open_in_photoshop', { path, psPath: psPath || null })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

export async function pickExe(): Promise<string | null> {
  if (!IS_TAURI) return null
  try {
    return await invokeCmd<string | null>('pick_exe')
  } catch {
    return null
  }
}
