import { useEffect, useRef, useState } from 'react'

interface Crumb {
  name: string
  path: string
}

export type SearchScope = 'both' | 'name' | 'dir'

const FONTS: { v: number; label: string }[] = [
  { v: 0.9, label: '小' },
  { v: 1, label: '标准' },
  { v: 1.12, label: '大' },
  { v: 1.25, label: '很大' },
  { v: 1.4, label: '特大' },
]

const SCOPE_LABEL: Record<SearchScope, string> = {
  both: '全部',
  name: '名称',
  dir: '目录',
}

interface Props {
  stack: Crumb[]
  canBack: boolean
  canForward: boolean
  canUp: boolean
  onBack: () => void
  onForward: () => void
  onUp: () => void
  onCrumb: (index: number) => void
  query: string
  onQuery: (v: string) => void
  scope: SearchScope
  onScope: (s: SearchScope) => void
  onOpenFolder: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  recursive: boolean
  onToggleRecursive: () => void
  fontScale: number
  onSetFont: (v: number) => void
  bookmarked: boolean
  onToggleBookmark: () => void
  onOpenSettings: () => void
  dateFrom: string
  dateTo: string
  onDateRange: (from: string, to: string) => void
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Toolbar({
  stack,
  canBack,
  canForward,
  canUp,
  onBack,
  onForward,
  onUp,
  onCrumb,
  query,
  onQuery,
  scope,
  onScope,
  onOpenFolder,
  sidebarOpen,
  onToggleSidebar,
  recursive,
  onToggleRecursive,
  fontScale,
  onSetFont,
  bookmarked,
  onToggleBookmark,
  onOpenSettings,
  dateFrom,
  dateTo,
  onDateRange,
}: Props) {
  const [fontOpen, setFontOpen] = useState(false)
  const fontRef = useRef<HTMLDivElement | null>(null)
  const [dateOpen, setDateOpen] = useState(false)
  const dateRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!fontOpen) return
    const close = (e: MouseEvent) => {
      if (fontRef.current && !fontRef.current.contains(e.target as Node)) setFontOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFontOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [fontOpen])

  useEffect(() => {
    if (!dateOpen) return
    const close = (e: MouseEvent) => {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDateOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDateOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [dateOpen])

  const cycleScope = () => {
    const order: SearchScope[] = ['both', 'name', 'dir']
    const i = order.indexOf(scope)
    onScope(order[(i + 1) % order.length])
  }

  const customPct = Math.round(fontScale * 100)

  return (
    <div className="toolbar">
      <button
        className="nav-btn"
        onClick={onToggleSidebar}
        title="显示/隐藏侧栏 (Ctrl+B)"
        style={{ opacity: sidebarOpen ? 1 : 0.5 }}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2.2" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>

      <button className="nav-btn" onClick={onBack} disabled={!canBack} title="后退 (Alt+← / 侧键)">
        <Icon d="M10 3.5L5.5 8L10 12.5" />
      </button>

      <button className="nav-btn" onClick={onForward} disabled={!canForward} title="前进 (Alt+→ / 侧键)">
        <Icon d="M6 3.5L10.5 8L6 12.5" />
      </button>

      <button className="nav-btn" onClick={onUp} disabled={!canUp} title="上级目录 (Backspace)">
        <Icon d="M8 12.5V4M8 4L4.5 7.5M8 4l3.5 3.5" />
      </button>

      <div className="crumbs">
        {stack.map((n, i) => {
          const last = i === stack.length - 1
          return (
            <span key={n.path + i} className="crumb-wrap">
              {i > 0 && <span className="crumb-sep">/</span>}
              <button
                className={`crumb${last ? ' last' : ''}`}
                onClick={() => !last && onCrumb(i)}
                title={n.path}
                disabled={last}
              >
                {n.name}
              </button>
            </span>
          )
        })}
      </div>

      <div className="spacer" />

      <label className="check" title="显示当前目录及其所有子目录下的文件">
        <input type="checkbox" checked={recursive} onChange={onToggleRecursive} />
        <span>含子目录</span>
      </label>

      <div className="font-wrap" ref={dateRef}>
        <button
          className={`nav-btn${dateOpen ? ' active' : ''}`}
          onClick={() => setDateOpen((v) => !v)}
          title="按修改时间筛选"
          style={{ position: 'relative' }}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3.2" width="12" height="10.8" rx="1.8" stroke="currentColor" strokeWidth="1.3" />
            <path d="M2 6.4h12M5.4 1.8v2.6M10.6 1.8v2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          {(dateFrom || dateTo) && (
            <span
              style={{
                position: 'absolute',
                top: 5,
                right: 5,
                width: 4,
                height: 4,
                borderRadius: 2,
                background: 'var(--accent)',
              }}
            />
          )}
        </button>

        {dateOpen && (
          <div className="popover date-pop">
            <div className="date-row">
              <span>开始</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => onDateRange(e.target.value, dateTo)}
              />
            </div>
            <div className="date-row">
              <span>截至</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => onDateRange(dateFrom, e.target.value)}
              />
            </div>
            <div className="date-foot">
              <span className="date-hint">留空表示不限</span>
              {(dateFrom || dateTo) && (
                <button className="ghost-btn sm" onClick={() => onDateRange('', '')}>
                  清除
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="search">
        <button
          className={`scope-btn${scope !== 'both' ? ' on' : ''}`}
          onClick={cycleScope}
          title={`搜索范围：${SCOPE_LABEL[scope]}（点击切换 全部 / 名称 / 目录）`}
        >
          {SCOPE_LABEL[scope]}
        </button>
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={scope === 'dir' ? '筛选文件夹名' : '筛选文件名'}
          spellCheck={false}
        />
        {query ? (
          <button
            onClick={() => onQuery('')}
            style={{ color: 'var(--text-3)', fontSize: 13, lineHeight: 1, padding: '0 2px' }}
          >
            ×
          </button>
        ) : (
          <span className="kbd">Ctrl F</span>
        )}
      </div>

      <div className="font-wrap" ref={fontRef}>
        <button
          className={`nav-btn${fontOpen ? ' active' : ''}`}
          onClick={() => setFontOpen((v) => !v)}
          title={`字号 ${customPct}%`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 13L6.6 3h1.6L11.8 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4.4 9.6h6.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>

        {fontOpen && (
          <div className="popover font-pop">
            {FONTS.map((f) => (
              <button
                key={f.v}
                className={`font-item${Math.abs(fontScale - f.v) < 0.005 ? ' on' : ''}`}
                onClick={() => {
                  onSetFont(f.v)
                  setFontOpen(false)
                }}
              >
                <span>{f.label}</span>
                <span className="font-pct">{Math.round(f.v * 100)}%</span>
              </button>
            ))}
            <div className="font-sep" />
            <div className="font-custom">
              <span>自定义</span>
              <input
                type="range"
                min={70}
                max={160}
                step={2}
                value={customPct}
                onChange={(e) => onSetFont(Number(e.target.value) / 100)}
              />
              <span className="font-pct">{customPct}%</span>
            </div>
          </div>
        )}
      </div>

      <button
        className="nav-btn"
        onClick={onToggleBookmark}
        title={bookmarked ? '取消收藏当前文件夹' : '收藏当前文件夹'}
        style={{ color: bookmarked ? '#f0b429' : undefined }}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill={bookmarked ? 'currentColor' : 'none'}>
          <path
            d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <button className="nav-btn" onClick={onOpenSettings} title="设置">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path
            d="M10.6 2a3.1 3.1 0 0 0-2.9 4.2l-5 5a1.45 1.45 0 0 0 2 2l5-5A3.1 3.1 0 0 0 14 5.3l-1.85 1.85-1.3-.3-.3-1.3L12.4 3.6A3.1 3.1 0 0 0 10.6 2z"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <button className="ghost-btn" onClick={onOpenFolder}>
        打开文件夹
      </button>
    </div>
  )
}
