import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Entry } from '../lib/types'
import { useElementSize } from '../lib/hooks'
import {
  getCachedThumb,
  loadThumb,
  pruneThumbQueue,
  type Thumb,
} from '../lib/thumb'

const GAP = 10
const PAD = 14
const CELL_PAD = 6
const LABEL_H = 40
// 视口上下各预加载 3 行，滚到时图已经在缓存里
const PRELOAD_ROWS = 3

interface Props {
  items: Entry[]
  cellSize: number
  selectedId: string | null
  onSelect: (e: Entry) => void
  onOpen: (e: Entry) => void
  onContextMenu: (e: Entry, x: number, y: number) => void
}

const Cell = memo(function Cell({
  entry,
  size,
  selected,
  zone,
  onSelect,
  onOpen,
  onContextMenu,
}: {
  entry: Entry
  size: number
  selected: boolean
  zone: 'visible' | 'near' | 'far'
  onSelect: (e: Entry) => void
  onOpen: (e: Entry) => void
  onContextMenu: (e: Entry, x: number, y: number) => void
}) {
  const [thumb, setThumb] = useState<Thumb | null>(() => getCachedThumb(entry.id) ?? null)
  const [retry, setRetry] = useState(0)
  // 已经成功取到图就记下来，避免重复请求
  const requestedRef = useRef(!!thumb)
  const retryTimer = useRef(0)

  useEffect(() => {
    if (entry.kind === 'dir' || requestedRef.current || zone === 'far') return
    let alive = true
    // 视口内优先级 0，预加载区优先级 1
    loadThumb(entry, zone === 'visible' ? 0 : 1).then((r) => {
      if (!alive) return
      if (r.status === 'none' && r.reason === 'cancelled') {
        // 请求被作废（滚得太快）。不落状态，稍后自动重试，
        // 否则滚停了之后 zone 不再变化，就再也没有第二次机会了
        requestedRef.current = false
        window.clearTimeout(retryTimer.current)
        retryTimer.current = window.setTimeout(() => {
          if (alive) setRetry((x) => x + 1)
        }, 120)
        return
      }
      requestedRef.current = true
      setThumb(r)
    })
    return () => {
      alive = false
      window.clearTimeout(retryTimer.current)
    }
  }, [entry, zone, retry])

  const isDir = entry.kind === 'dir'
  const relDir =
    entry.rel && /[\\/]/.test(entry.rel) ? entry.rel.replace(/[\\/][^\\/]*$/, '') : ''

  return (
    <div
      className={`cell${selected ? ' selected' : ''}`}
      style={{ width: size }}
      onMouseDown={() => onSelect(entry)}
      onDoubleClick={() => onOpen(entry)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(entry, e.clientX, e.clientY)
      }}
      title={relDir ? `${entry.name}\n${relDir}` : entry.name}
    >
      <div className="cell-frame">
        {isDir ? (
          <div className="folder-glyph" />
        ) : thumb?.status === 'ok' ? (
          <img className="cell-img" src={thumb.url} alt="" draggable={false} decoding="async" />
        ) : thumb ? (
          <div className="cell-badge">
            <div className="cell-glyph" />
            <span>{entry.ext || 'file'}</span>
          </div>
        ) : (
          <div className="cell-spinner" />
        )}
      </div>
      <div className={`cell-label${relDir ? ' has-rel' : ''}`}>
        <div className="cell-name">{entry.name}</div>
        {relDir && <div className="cell-rel">{relDir}</div>}
      </div>
    </div>
  )
})

export function Grid({
  items,
  cellSize,
  selectedId,
  onSelect,
  onOpen,
  onContextMenu,
}: Props) {
  const { ref, size } = useElementSize<HTMLDivElement>()
  const [scrollTop, setScrollTop] = useState(0)
  const rafRef = useRef(0)

  const cols = useMemo(() => {
    if (!size.w) return 1
    return Math.max(1, Math.floor((size.w - PAD * 2 + GAP) / (cellSize + GAP)))
  }, [size.w, cellSize])

  const rowH = cellSize + LABEL_H + CELL_PAD * 2 + GAP
  const rows = Math.ceil(items.length / cols)
  const totalH = rows * rowH

  const firstVisibleRow = Math.floor(scrollTop / rowH)
  const lastVisibleRow = Math.ceil((scrollTop + (size.h || 800)) / rowH)
  const startRow = Math.max(0, firstVisibleRow - PRELOAD_ROWS)
  const endRow = Math.min(rows, lastVisibleRow + PRELOAD_ROWS)

  const onScroll = () => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      setScrollTop(ref.current?.scrollTop ?? 0)
    })
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  useLayoutEffect(() => {
    setScrollTop(ref.current?.scrollTop ?? 0)
  }, [items, cellSize])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onKey = (ev: KeyboardEvent) => {
      if (document.activeElement instanceof HTMLInputElement) return
      if (!items.length) return
      const idx = items.findIndex((x) => x.id === selectedId)
      let next = idx
      if (ev.key === 'ArrowRight') next = Math.min(items.length - 1, idx + 1)
      else if (ev.key === 'ArrowLeft') next = Math.max(0, idx - 1)
      else if (ev.key === 'ArrowDown') next = Math.min(items.length - 1, idx + cols)
      else if (ev.key === 'ArrowUp') next = Math.max(0, idx - cols)
      else if (ev.key === 'Home') next = 0
      else if (ev.key === 'End') next = items.length - 1
      else return
      ev.preventDefault()
      if (next < 0) next = 0
      const target = items[next]
      if (target) {
        onSelect(target)
        const row = Math.floor(next / cols)
        const top = row * rowH
        const view = el.scrollTop
        const bottom = view + el.clientHeight
        if (top < view) el.scrollTop = top
        else if (top + rowH > bottom) el.scrollTop = top + rowH - el.clientHeight
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, selectedId, cols, rowH, onSelect])

  const visible = useMemo(() => {
    const out: { row: number; items: Entry[] }[] = []
    for (let r = startRow; r < endRow; r++) {
      const from = r * cols
      const slice = items.slice(from, from + cols)
      if (slice.length) out.push({ row: r, items: slice })
    }
    return out
  }, [items, startRow, endRow, cols])

  // 视口范围一变就剪枝：把已经滚过去、没人要的排队请求立刻丢掉。
  // 快速拖到底部时全靠这一步让队列腾空，否则底部会一直转圈。
  useEffect(() => {
    const keep = new Set<string>()
    for (const row of visible) {
      for (const e of row.items) keep.add(e.id)
    }
    pruneThumbQueue(keep)
  }, [visible])

  return (
    <div className="grid-scroll" ref={ref} onScroll={onScroll}>
      <div className="grid-sizer" style={{ height: totalH }}>
        {visible.map(({ row, items: rowItems }) => (
          <div
            key={row}
            className="grid-row"
            style={{ transform: `translateY(${row * rowH}px)`, top: 0 }}
          >
            {rowItems.map((entry) => (
              <Cell
                key={entry.id}
                entry={entry}
                size={cellSize}
                selected={entry.id === selectedId}
                zone={
                  row >= firstVisibleRow && row <= lastVisibleRow ? 'visible' : 'near'
                }
                onSelect={onSelect}
                onOpen={onOpen}
                onContextMenu={onContextMenu}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
