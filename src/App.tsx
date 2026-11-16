import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './styles.css'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { FilterBar } from './components/FilterBar'
import { Grid } from './components/Grid'
import { Preview } from './components/Preview'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { Settings } from './components/Settings'
import type { SearchScope } from './components/Toolbar'
import { formatSize, formatDate, naturalCompare } from './lib/fs'
import {
  listDir,
  listRecursive,
  openPath,
  pickRoot,
  revealInExplorer,
  openInPhotoshop,
  findPhotoshop,
  setCloseToTray,
  pathIsDir,
  pickFolderPath,
  resolveShortcut,
  IS_NATIVE,
  IS_TAURI,
} from './lib/backend'
import { buildDemoEntries } from './lib/demo'
import {
  addBookmark,
  isBookmarked,
  loadBookmarks,
  removeBookmark,
  type Bookmark,
} from './lib/bookmarks'
import type { Entry, SortDir, SortKey } from './lib/types'

interface NavNode {
  name: string
  path: string
}

const FONT_SCALES = [0.9, 1, 1.12, 1.25]
const FONT_KEY = 'asset-browser.fontScale'
const LAST_FOLDER_KEY = 'asset-browser.lastFolder'
const PS_EXTS = new Set(['psd', 'psb', 'tif', 'tiff', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'])

const HIDDEN_EXT_KEY = 'asset-browser.hiddenExts'
const PS_PATH_KEY = 'asset-browser.psPath'
const TRAY_KEY = 'asset-browser.closeToTray'

function loadHiddenExts(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_EXT_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.map((x) => String(x).toLowerCase()) : []
  } catch {
    return []
  }
}

const RECURSIVE_LIMIT = 50000

const folderParam = (() => {
  if (typeof location === 'undefined') return null
  return new URLSearchParams(location.search).get('folder')
})()

function isUnder(parent: string, child: string): boolean {
  const p = parent.toLowerCase().replace(/[\\/]+$/, '')
  const c = child.toLowerCase()
  if (!c.startsWith(p) || c.length <= p.length) return false
  const sep = c[p.length]
  return sep === '\\' || sep === '/'
}

export default function App() {
  const [roots, setRoots] = useState<NavNode[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [stack, setStack] = useState<NavNode[]>([])
  const [back, setBack] = useState<{ node: NavNode; stack: NavNode[] }[]>([])
  const [fwd, setFwd] = useState<{ node: NavNode; stack: NavNode[] }[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [recursive, setRecursive] = useState(false)
  const [fontScale, setFontScale] = useState<number>(() => {
    const v = Number(localStorage.getItem(FONT_KEY))
    return FONT_SCALES.includes(v) ? v : 1
  })
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadBookmarks())

  const [query, setQuery] = useState('')
  const [filterExts, setFilterExts] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [cellSize, setCellSize] = useState(200)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [scope, setScope] = useState<SearchScope>('both')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [hiddenExts, setHiddenExts] = useState<string[]>(loadHiddenExts)
  const [psPath, setPsPath] = useState<string>(() => localStorage.getItem(PS_PATH_KEY) ?? '')
  const [closeToTray, setCloseToTrayState] = useState<boolean>(
    () => localStorage.getItem(TRAY_KEY) === '1'
  )

  const searchRef = useRef<HTMLInputElement | null>(null)
  const current = stack[stack.length - 1] ?? null

  useEffect(() => {
    localStorage.setItem(HIDDEN_EXT_KEY, JSON.stringify(hiddenExts))
  }, [hiddenExts])

  useEffect(() => {
    localStorage.setItem(TRAY_KEY, closeToTray ? '1' : '0')
    void setCloseToTray(closeToTray)
  }, [closeToTray])

  useEffect(() => {
    if (psPath) localStorage.setItem(PS_PATH_KEY, psPath)
    else localStorage.removeItem(PS_PATH_KEY)
  }, [psPath])

  // 启动时如果没设过 PS 路径，自动探测一次，省得用户还要点
  useEffect(() => {
    if (!IS_TAURI || psPath) return
    let alive = true
    findPhotoshop().then((p) => {
      if (alive && p) setPsPath(p)
    })
    return () => {
      alive = false
    }
  }, [psPath])

  useEffect(() => {
    document.documentElement.style.setProperty('--fs', String(fontScale))
    localStorage.setItem(FONT_KEY, String(fontScale))
  }, [fontScale])

  const loadDir = useCallback(
    async (node: NavNode, nextStack: NavNode[], rec: boolean) => {
      setLoading(true)
      setError(null)
      setNotice(null)
      setSelectedId(null)
      setPreviewOpen(false)
      setStack(nextStack)
      try {
        if (rec) {
          const r = await listRecursive(node.path, RECURSIVE_LIMIT, [])
          setEntries(r.entries)
          if (r.error) setError(r.error)
          if (r.truncated) {
            setNotice(
              `已扫描 ${r.scanned.toLocaleString()} 项，达到 ${RECURSIVE_LIMIT.toLocaleString()} 个文件上限，结果不完整。用后缀筛选可缩小范围。`
            )
          }
        } else {
          const listing = await listDir(node.path)
          setEntries(listing.entries)
          if (listing.error) setError(listing.error)
        }
      } catch (e: any) {
        setEntries([])
        setError(e?.message ?? '无法读取该文件夹')
      }
      setLoading(false)
    },
    []
  )

  const buildStackFor = useCallback(
    (node: NavNode): NavNode[] => {
      const i = stack.findIndex((s) => s.path === node.path)
      if (i >= 0) return stack.slice(0, i + 1)
      let best = -1
      for (let k = 0; k < stack.length; k++) {
        if (isUnder(stack[k].path, node.path)) best = k
      }
      if (best >= 0) return [...stack.slice(0, best + 1), node]
      return [node]
    },
    [stack]
  )

  const applyNode = useCallback(
    (node: NavNode) => {
      const next = buildStackFor(node)
      loadDir(node, next, recursive)
    },
    [buildStackFor, loadDir, recursive]
  )

  const goTo = useCallback(
    (node: NavNode, record = true) => {
      if (current?.path === node.path) return
      if (record && current) {
        setBack((b) => [...b.slice(-49), { node: current, stack }])
        setFwd([])
      }
      applyNode(node)
    },
    [current, applyNode]
  )

  const goBack = useCallback(() => {
    if (back.length > 0) {
      const h = back[back.length - 1]
      setBack((b) => b.slice(0, -1))
      if (current) setFwd((f) => [...f, { node: current, stack }])
      loadDir(h.node, h.stack, recursive)
      return
    }
    if (stack.length > 1) {
      const next = stack.slice(0, -1)
      loadDir(next[next.length - 1], next, recursive)
    }
  }, [back, current, stack, loadDir, recursive])

  const goForward = useCallback(() => {
    if (fwd.length === 0) return
    const h = fwd[fwd.length - 1]
    setFwd((f) => f.slice(0, -1))
    if (current) setBack((b) => [...b, { node: current, stack }])
    loadDir(h.node, h.stack, recursive)
  }, [fwd, current, stack, loadDir, recursive])

  const goUp = useCallback(() => {
    if (stack.length < 2) return
    const next = stack.slice(0, -1)
    const node = next[next.length - 1]
    if (current) {
      setBack((b) => [...b.slice(-49), { node: current, stack }])
      setFwd([])
    }
    loadDir(node, next, recursive)
  }, [stack, current, recursive, loadDir])

  const onCrumb = useCallback(
    (i: number) => {
      const node = stack[i]
      if (!node || i === stack.length - 1) return
      goTo(node, true)
    },
    [stack, goTo]
  )

  const openFolder = useCallback(async () => {
    try {
      const listing = await pickRoot()
      if (!listing) return
      const node: NavNode = { name: listing.name, path: listing.path }
      setRoots([node])
      setEntries(listing.entries)
      setStack([node])
      setBack([])
      setFwd([])
      setFilterExts(new Set())
      setQuery('')
      setSelectedId(null)
      setError(null)
      setNotice(null)
      if (listing.error) setError(listing.error)
    } catch (e: any) {
      setError(e?.message ?? '打开失败')
    }
  }, [])

  const openByPath = useCallback(
    async (folder: string, keepRoots = false) => {
      setLoading(true)
      try {
        const listing = await listDir(folder)
        const node: NavNode = { name: listing.name, path: listing.path }
        setRoots((prev) => {
          if (keepRoots) {
            const dup = prev.some((r) => r.path.toLowerCase() === listing.path.toLowerCase())
            return dup ? prev : [...prev, node]
          }
          return [node]
        })
        setStack([node])
        setBack([])
        setFwd([])
        setEntries(listing.entries)
        setFilterExts(new Set())
        setSelectedId(null)
        if (listing.error) setError(listing.error)
        else localStorage.setItem(LAST_FOLDER_KEY, folder)
      } catch (e: any) {
        setError(e?.message ?? '打开失败')
      }
      setLoading(false)
    },
    []
  )

  const toggleRecursive = useCallback(() => {
    const next = !recursive
    setRecursive(next)
    setFilterExts(new Set())
    setSelectedId(null)
    if (current) loadDir(current, stack, next)
  }, [recursive, current, stack, loadDir])

  const cycleFont = useCallback(() => {
    setFontScale((s) => {
      const i = FONT_SCALES.indexOf(s)
      return FONT_SCALES[(i + 1) % FONT_SCALES.length]
    })
  }, [])

  const bookmarked = useMemo(
    () => (current ? isBookmarked(bookmarks, current.path) : false),
    [bookmarks, current]
  )

  const addFolder = useCallback(async () => {
    const dir = await pickFolderPath()
    if (!dir) return
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir
    setRoots((prev) =>
      prev.some((r) => r.path.toLowerCase() === dir.toLowerCase())
        ? prev
        : [...prev, { name, path: dir }]
    )
  }, [])

  const toggleBookmark = useCallback(() => {
    if (!current) return
    setBookmarks((prev) =>
      isBookmarked(prev, current.path)
        ? removeBookmark(prev, current.path)
        : addBookmark(prev, { name: current.name, path: current.path })
    )
  }, [current])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.has('demo')) {
      let alive = true
      ;(async () => {
        setLoading(true)
        const list = await buildDemoEntries()
        if (!alive) return
        const node: NavNode = { name: '演示素材库', path: '演示素材库' }
        setRoots([node])
        setStack([node])
        setEntries(list)
        setLoading(false)
      })()
      return () => {
        alive = false
      }
    }
    if (folderParam && IS_NATIVE) {
      openByPath(folderParam)
    }
  }, [openByPath])

  useEffect(() => {
    if (!IS_TAURI) return
    let unlisten: (() => void) | undefined
    let alive = true
    ;(async () => {
      const { listen } = await import('@tauri-apps/api/event')
      const un = await listen<string>('open-folder', (e) => {
        if (alive && e.payload) openByPath(e.payload, true)
      })
      unlisten = un
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [openByPath])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const extOn = filterExts.size > 0
    const hide = new Set(hiddenExts)
    // 日期区间按本地时间算，含当天
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null
    const list = entries.filter((e) => {
      if (hide.size && e.kind === 'file' && hide.has(e.ext)) return false
      // 时间范围只筛文件：目录一律保留，否则没法往下点
      if (e.kind === 'file') {
        if (fromMs !== null && e.mtime < fromMs) return false
        if (toMs !== null && e.mtime > toMs) return false
      }
      if (q) {
        const nameHit = e.name.toLowerCase().includes(q)
        const relDir = e.rel ? e.rel.replace(/[\\/][^\\/]*$/, '') : ''
        const dirHit = relDir.toLowerCase().includes(q)
        if (scope === 'name' && !nameHit) return false
        if (scope === 'dir' && !dirHit) return false
        if (scope === 'both' && !nameHit && !dirHit) return false
      }
      if (extOn && e.kind === 'file' && !filterExts.has(e.ext)) return false
      return true
    })
    const dirs = list.filter((e) => e.kind === 'dir')
    const files = list.filter((e) => e.kind === 'file')
    const cmp = (a: Entry, b: Entry) => {
      let r = 0
      if (sortKey === 'name') r = naturalCompare(a.name, b.name)
      else if (sortKey === 'mtime') r = a.mtime - b.mtime
      else if (sortKey === 'size') r = a.size - b.size
      else if (sortKey === 'ext') r = naturalCompare(a.ext, b.ext) || naturalCompare(a.name, b.name)
      return sortDir === 'asc' ? r : -r
    }
    dirs.sort(cmp)
    files.sort(cmp)
    return [...dirs, ...files]
  }, [entries, query, scope, filterExts, sortKey, sortDir, hiddenExts, dateFrom, dateTo])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    const hide = new Set(hiddenExts)
    // 后缀计数必须跟时间筛选一致，否则筛完之后「共有多少张」是错的
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null
    for (const e of entries) {
      if (e.kind !== 'file' || !e.ext) continue
      if (hide.has(e.ext)) continue
      if (fromMs !== null && e.mtime < fromMs) continue
      if (toMs !== null && e.mtime > toMs) continue
      m.set(e.ext, (m.get(e.ext) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24) as [string, number][]
  }, [entries, hiddenExts, dateFrom, dateTo])

  const fileCount = useMemo(() => entries.filter((e) => e.kind === 'file').length, [entries])
  const selected = useMemo(
    () => filtered.find((e) => e.id === selectedId) ?? null,
    [filtered, selectedId]
  )

  const toggleExt = (ext: string) => {
    setFilterExts((prev) => {
      const next = new Set(prev)
      if (next.has(ext)) next.delete(ext)
      else next.add(ext)
      return next
    })
  }

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir(k === 'mtime' ? 'desc' : 'asc')
    }
  }

  const stepPreview = (delta: number) => {
    if (!selected) return
    const i = filtered.findIndex((e) => e.id === selected.id)
    const next = filtered[i + delta]
    if (next && next.kind === 'file') setSelectedId(next.id)
  }

  const onOpenEntry = useCallback(
    (e: Entry) => {
      if (e.kind === 'dir') {
        goTo({ name: e.name, path: e.id }, true)
      } else {
        if (IS_NATIVE) openPath(e.id)
        else setPreviewOpen(true)
      }
    },
    [goTo]
  )

  const handleSelect = useCallback((e: Entry) => setSelectedId(e.id), [])

  const handleContextMenu = useCallback((entry: Entry, x: number, y: number) => {
    setSelectedId(entry.id)
    setMenu({ x, y, entry })
  }, [])

  const copyPath = useCallback(async (p: string) => {
    try {
      await navigator.clipboard.writeText(p)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = p
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* ignore */
      }
      ta.remove()
    }
  }, [])

  const menuItems: MenuItem[] = useMemo(() => {
    if (!menu) return []
    const e = menu.entry
    const items: MenuItem[] = [
      {
        label: '在资源管理器中显示',
        onClick: () => revealInExplorer(e.id),
      },
    ]
    if (e.kind === 'file') {
      items.push({
        label: '用默认程序打开',
        onClick: () => {
          if (IS_NATIVE) openPath(e.id)
          else setPreviewOpen(true)
        },
      })
      if (PS_EXTS.has(e.ext)) {
        items.push({
          label: '在 Photoshop 中打开',
          onClick: async () => {
            const r = await openInPhotoshop(e.id, psPath)
            if (!r.ok) {
              setNotice(r.error ?? '打开失败')
              setSettingsOpen(true)
            }
          },
        })
      }
    } else {
      items.push({
        label: '进入此文件夹',
        onClick: () => goTo({ name: e.name, path: e.id }, true),
      })
    }
    items.push({ label: '复制路径', onClick: () => copyPath(e.id) })
    return items
  }, [menu, goTo, copyPath, psPath])

  useEffect(() => {
    if (!IS_TAURI) return
    let alive = true
    let unlisten: (() => void) | undefined
    ;(async () => {
      let getCurrentWebview: typeof import('@tauri-apps/api/webview').getCurrentWebview
      try {
        const mod = await import('@tauri-apps/api/webview')
        getCurrentWebview = mod.getCurrentWebview
      } catch (e: any) {
        console.warn('拖放模块加载失败:', e)
        return
      }
      try {
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (!alive) return
          const p = event.payload

          if (p.type === 'drop') {
            setDragOver(false)
            const paths = 'paths' in p ? p.paths : []
            void (async () => {
              const dirs: NavNode[] = []
              for (const raw of paths) {
                let target = raw
                if (!(await pathIsDir(raw))) {
                  // 拖进来的是快捷方式(.lnk)时，解析它指向的真实路径
                  const resolved = await resolveShortcut(raw)
                  if (!resolved) continue
                  // 快捷方式可能指向 .exe / 文件，那种不算素材文件夹，跳过
                  if (!(await pathIsDir(resolved))) continue
                  target = resolved
                }
                const name = target.split(/[\\/]/).filter(Boolean).pop() ?? target
                dirs.push({ name, path: target })
              }
              if (!dirs.length) return
              setRoots((prev) => {
                const seen = new Set(prev.map((r) => r.path.toLowerCase()))
                const add = dirs.filter((d) => !seen.has(d.path.toLowerCase()))
                return add.length ? [...prev, ...add] : prev
              })
            })()
          } else if (p.type === 'over' || p.type === 'enter') {
            setDragOver(true)
          } else {
            setDragOver(false)
          }
        })
      } catch (e: any) {
        console.warn('拖放监听注册失败:', e)
      }
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const inInput = document.activeElement instanceof HTMLInputElement
      if (ev.ctrlKey && ev.key.toLowerCase() === 'f') {
        ev.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (ev.ctrlKey && ev.key.toLowerCase() === 'b') {
        ev.preventDefault()
        setSidebarOpen((v) => !v)
        return
      }
      if (previewOpen) {
        if (ev.key === 'Escape' || ev.key === ' ') {
          ev.preventDefault()
          setPreviewOpen(false)
        } else if (ev.key === 'ArrowRight') {
          ev.preventDefault()
          stepPreview(1)
        } else if (ev.key === 'ArrowLeft') {
          ev.preventDefault()
          stepPreview(-1)
        }
        return
      }
      if (inInput) {
        if (ev.key === 'Escape') {
          setQuery('')
          ;(document.activeElement as HTMLElement)?.blur()
        }
        return
      }
      if (ev.altKey && ev.key === 'ArrowLeft') {
        ev.preventDefault()
        goBack()
        return
      }
      if (ev.altKey && ev.key === 'ArrowRight') {
        ev.preventDefault()
        goForward()
        return
      }
      if (ev.key === ' ') {
        ev.preventDefault()
        if (selected && selected.kind === 'file') setPreviewOpen(true)
      } else if (ev.key === 'Escape') {
        setQuery('')
        setFilterExts(new Set())
      } else if (ev.key === 'Backspace') {
        ev.preventDefault()
        goUp()
      } else if (ev.key === 'Enter' && selected) {
        onOpenEntry(selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (ev.button === 3) {
        ev.preventDefault()
        goBack()
      } else if (ev.button === 4) {
        ev.preventDefault()
        goForward()
      }
    }
    const onAux = (ev: MouseEvent) => {
      if (ev.button === 3 || ev.button === 4) ev.preventDefault()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('auxclick', onAux)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('auxclick', onAux)
    }
  }, [goBack, goForward])

  useEffect(() => {
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return
      ev.preventDefault()
      setCellSize((s) => {
        const steps = [148, 200, 268]
        const i = steps.indexOf(s)
        const ni = ev.deltaY > 0 ? Math.max(0, i - 1) : Math.min(steps.length - 1, i + 1)
        return steps[ni]
      })
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div className="app">
      <Toolbar
        stack={stack}
        canBack={back.length > 0 || stack.length > 1}
        canForward={fwd.length > 0}
        canUp={stack.length > 1}
        onBack={goBack}
        onForward={goForward}
        onUp={goUp}
        onCrumb={onCrumb}
        query={query}
        onQuery={setQuery}
        onOpenFolder={openFolder}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        recursive={recursive}
        onToggleRecursive={toggleRecursive}
        fontScale={fontScale}
        onSetFont={setFontScale}
        bookmarked={bookmarked}
        onToggleBookmark={toggleBookmark}
        scope={scope}
        onScope={setScope}
        onOpenSettings={() => setSettingsOpen(true)}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateRange={(f, t) => {
          setDateFrom(f)
          setDateTo(t)
        }}
      />

      {loading && <div className="loading-bar" style={{ width: '45%' }} />}

      <div className="body">
        {sidebarOpen && (
          <Sidebar
            roots={roots}
            currentPath={current?.path ?? ''}
            onNavigate={(n) => goTo(n, true)}
            bookmarks={bookmarks}
            onRemoveBookmark={(p) => setBookmarks((prev) => removeBookmark(prev, p))}
            onAddFolder={addFolder}
          />
        )}

        <div className="content">
          {!current ? (
            bookmarks.length > 0 ? (
              <div className="home">
                <div className="home-head">
                  <div className="home-title">收藏</div>
                  <button className="ghost-btn" onClick={openFolder}>
                    打开文件夹
                  </button>
                </div>
                <div className="home-grid">
                  {bookmarks.map((b) => (
                    <div key={b.path} className="home-card" onClick={() => openByPath(b.path)} title={b.path}>
                      <div className="home-card-star">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8z" />
                        </svg>
                      </div>
                      <div className="home-card-name">{b.name}</div>
                      <div className="home-card-path">{b.path}</div>
                      <button
                        className="home-card-del"
                        title="移除收藏"
                        onClick={(e) => {
                          e.stopPropagation()
                          setBookmarks((prev) => removeBookmark(prev, b.path))
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                {error && <div className="banner danger">{error}</div>}
              </div>
            ) : (
              <div className="empty">
                <div className="empty-card">
                  <div className="empty-title">选择一个素材文件夹</div>
                  <div className="empty-desc">
                    只读浏览，不会修改你的任何文件。
                    <br />
                    打开后在工具栏点星标即可加入收藏，下次从首页直接进入。
                    <br />
                    也可以把文件夹直接拖进窗口，或拖到程序图标上。
                  </div>
                  <button className="primary-btn" onClick={openFolder}>
                    打开文件夹
                  </button>
                  {error && (
                    <div style={{ marginTop: 16, fontSize: 12, color: 'var(--danger)' }}>
                      {error}
                    </div>
                  )}
                </div>
              </div>
            )
          ) : (
            <>
              <FilterBar
                counts={counts}
                filterExts={filterExts}
                onToggleExt={toggleExt}
                onClearFilter={() => setFilterExts(new Set())}
                total={filtered.length}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />

              {notice && <div className="banner warn">{notice}</div>}
              {error && <div className="banner danger">{error}</div>}

              {filtered.length === 0 ? (
                <div className="empty">
                  <div className="empty-card">
                    <div className="empty-title">没有匹配的项目</div>
                    <div className="empty-desc">
                      {entries.length > 0 ? '试试清除筛选或搜索关键词' : '这个文件夹是空的'}
                    </div>
                  </div>
                </div>
              ) : (
                <Grid
                  key={`${current?.path ?? 'root'}|${recursive ? 'r' : 'f'}`}
                  items={filtered}
                  cellSize={cellSize}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  onOpen={onOpenEntry}
                  onContextMenu={handleContextMenu}
                />
              )}

              <div className="statusbar">
                <span>
                  <span className="val">{filtered.length}</span> 项
                </span>
                <span className="sep" />
                {recursive ? (
                  <span style={{ color: 'var(--accent)' }}>
                    含子目录 · {fileCount} 个文件
                  </span>
                ) : (
                  <>
                    <span>
                      文件 <span className="val">{fileCount}</span>
                    </span>
                    <span className="sep" />
                    <span>
                      文件夹 <span className="val">{entries.length - fileCount}</span>
                    </span>
                  </>
                )}
                {selected && (
                  <>
                    <span className="sep" />
                    <span className="ellipsis" style={{ color: 'var(--text-2)', maxWidth: 240 }}>
                      {selected.name}
                    </span>
                    {selected.kind === 'file' && (
                      <>
                        <span className="sep" />
                        <span>{formatSize(selected.size)}</span>
                      </>
                    )}
                    {selected.mtime > 0 && (
                      <>
                        <span className="sep" />
                        <span>{formatDate(selected.mtime)}</span>
                      </>
                    )}
                  </>
                )}
                <span className="status-hint">空格预览 · ← → 切换 · 侧键返回 · Ctrl+滚轮 缩放</span>
              </div>
            </>
          )}
        </div>
      </div>

      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-card">松开鼠标，把文件夹加到左侧</div>
        </div>
      )}

      {previewOpen && <Preview entry={selected} onClose={() => setPreviewOpen(false)} />}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          bookmarks={bookmarks}
          hiddenExts={hiddenExts}
          onHiddenExts={setHiddenExts}
          psPath={psPath}
          onPsPath={setPsPath}
          closeToTray={closeToTray}
          onCloseToTray={setCloseToTrayState}
        />
      )}
    </div>
  )
}
