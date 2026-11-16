import { useState } from 'react'
import { listSubdirs } from '../lib/backend'
import type { Bookmark } from '../lib/bookmarks'

interface Props {
  roots: { name: string; path: string }[]
  currentPath: string
  onNavigate: (node: { name: string; path: string }) => void
  bookmarks: Bookmark[]
  onRemoveBookmark: (path: string) => void
  onAddFolder: () => void
}

const CARET = (
  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
    <path d="M2.5 1.5L5.5 4L2.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const STAR = (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8z" />
  </svg>
)

function Node({
  name,
  path,
  depth,
  currentPath,
  onNavigate,
  defaultOpen,
}: {
  name: string
  path: string
  depth: number
  currentPath: string
  onNavigate: (n: { name: string; path: string }) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const [children, setChildren] = useState<{ name: string; path: string }[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open && children === null) {
      setLoading(true)
      try {
        setChildren(await listSubdirs(path))
      } catch {
        setChildren([])
      }
      setLoading(false)
    }
    setOpen((v) => !v)
  }

  return (
    <>
      <div
        className={`tree-row${currentPath === path ? ' active' : ''}`}
        style={{ paddingLeft: 4 + depth * 13 }}
        onClick={() => onNavigate({ name, path })}
        title={path}
      >
        <span onClick={toggle} style={{ display: 'flex', flex: '0 0 auto' }}>
          <span className={`tree-caret${open ? ' open' : ''}`}>{CARET}</span>
        </span>
        <span className="tree-label">{name}</span>
        {loading && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>…</span>}
      </div>
      {open &&
        children?.map((c) => (
          <Node
            key={c.path}
            name={c.name}
            path={c.path}
            depth={depth + 1}
            currentPath={currentPath}
            onNavigate={onNavigate}
          />
        ))}
      {open && children && children.length === 0 && (
        <div className="tree-empty" style={{ paddingLeft: 18 + depth * 13 }}>
          无子文件夹
        </div>
      )}
    </>
  )
}

export function Sidebar({
  roots,
  currentPath,
  onNavigate,
  bookmarks,
  onRemoveBookmark,
  onAddFolder,
}: Props) {
  return (
    <div className="sidebar">
      {bookmarks.length > 0 && (
        <>
          <div className="side-title">收藏</div>
          {bookmarks.map((b) => (
            <div
              key={b.path}
              className={`tree-row bm${currentPath === b.path ? ' active' : ''}`}
              style={{ paddingLeft: 6 }}
              onClick={() => onNavigate(b)}
              title={b.path}
            >
              <span className="bm-star">{STAR}</span>
              <span className="tree-label">{b.name}</span>
              <button
                className="bm-del"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemoveBookmark(b.path)
                }}
                title="移除收藏"
              >
                ×
              </button>
            </div>
          ))}
        </>
      )}

      <div className="side-title-row">
        <div className="side-title">文件夹</div>
        <button className="side-add" onClick={onAddFolder} title="添加文件夹">
          +
        </button>
      </div>
      {roots.length === 0 ? (
        <div className="tree-empty">
          尚未打开文件夹
          <br />
          也可以直接把文件夹拖进来
        </div>
      ) : (
        roots.map((r) => (
          <Node
            key={r.path}
            name={r.name}
            path={r.path}
            depth={0}
            currentPath={currentPath}
            onNavigate={onNavigate}
            defaultOpen
          />
        ))
      )}
    </div>
  )
}
