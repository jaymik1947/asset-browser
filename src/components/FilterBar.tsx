import type { SortDir, SortKey } from '../lib/types'

interface Props {
  counts: [string, number][]
  filterExts: Set<string>
  onToggleExt: (ext: string) => void
  onClearFilter: () => void
  total: number
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: '名称' },
  { key: 'mtime', label: '时间' },
  { key: 'size', label: '大小' },
  { key: 'ext', label: '类型' },
]

export function FilterBar({
  counts,
  filterExts,
  onToggleExt,
  onClearFilter,
  total,
  sortKey,
  sortDir,
  onSort,
}: Props) {
  const active = filterExts.size > 0

  return (
    <div className="filterbar">
      <div className="chips-scroll">
        <button className={`chip${!active ? ' on' : ''}`} onClick={onClearFilter}>
          全部
          <span className="count">{total}</span>
        </button>

        {counts.map(([ext, n]) => (
          <button
            key={ext}
            className={`chip${filterExts.has(ext) ? ' on' : ''}`}
            onClick={() => onToggleExt(ext)}
          >
            {ext}
            <span className="count">{n}</span>
          </button>
        ))}
      </div>

      <div className="sortsel">
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={`sort-item${sortKey === s.key ? ' on' : ''}`}
            onClick={() => onSort(s.key)}
          >
            {s.label}
            {sortKey === s.key && (
              <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
