import type { Entry } from './types'

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return ''
  return name.slice(i + 1).toLowerCase()
}

export function formatSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

export function formatDate(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b)
}

export async function listSubdirs(
  handle: FileSystemDirectoryHandle,
  path: string
): Promise<{ name: string; path: string; handle: FileSystemDirectoryHandle }[]> {
  const out: { name: string; path: string; handle: FileSystemDirectoryHandle }[] = []
  for await (const [name, h] of (handle as any).entries()) {
    if (h.kind !== 'directory') continue
    if (name.startsWith('.') || name === 'node_modules' || name === '$RECYCLE.BIN') continue
    out.push({ name, path: `${path}\\${name}`, handle: h })
  }
  out.sort((a, b) => naturalCompare(a.name, b.name))
  return out
}

const META_BATCH = 96

export async function readDir(
  handle: FileSystemDirectoryHandle,
  path: string,
  onProgress?: (done: number, total: number) => void
): Promise<Entry[]> {
  const dirs: Entry[] = []
  const files: { entry: Entry; h: FileSystemFileHandle }[] = []
  let seen = 0

  for await (const [name, h] of (handle as any).entries()) {
    if (name.startsWith('.') || name === '$RECYCLE.BIN') continue
    seen++
    const full = path ? `${path}\\${name}` : name
    if (h.kind === 'directory') {
      dirs.push({ id: full, name, kind: 'dir', ext: '', size: 0, mtime: 0, handle: h })
    } else {
      files.push({
        entry: { id: full, name, kind: 'file', ext: extOf(name), size: 0, mtime: 0, handle: h },
        h,
      })
    }
  }

  for (let i = 0; i < files.length; i += META_BATCH) {
    const slice = files.slice(i, i + META_BATCH)
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
    onProgress?.(Math.min(i + META_BATCH, files.length), files.length)
    await new Promise((r) => setTimeout(r, 0))
  }

  return [...dirs, ...files.map((f) => f.entry)]
}
