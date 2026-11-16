import { useEffect, useState } from 'react'
import type { Entry } from '../lib/types'
import { getCachedThumb, loadThumb, type Thumb } from '../lib/thumb'
import { formatDate, formatSize } from '../lib/fs'
import { COLOR_MODES } from '../lib/psd'

interface Props {
  entry: Entry | null
  onClose: () => void
}

export function Preview({ entry, onClose }: Props) {
  const [thumb, setThumb] = useState<Thumb | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    setNatural(null)
    if (!entry || entry.kind === 'dir') {
      setThumb(null)
      return
    }
    const cached = getCachedThumb(entry.id)
    if (cached) {
      setThumb(cached)
      return
    }
    setThumb(null)
    let alive = true
    loadThumb(entry).then((r) => {
      if (alive) setThumb(r)
    })
    return () => {
      alive = false
    }
  }, [entry])

  if (!entry) return null

  const psd = thumb?.psd
  const hasImg = thumb?.status === 'ok'
  const tiny = natural !== null && natural.w > 0 && natural.w < 480
  const isEmbedded = !!(psd && natural && natural.w > 0 && natural.w < psd.width * 0.4)

  return (
    <div className="preview-layer" onMouseDown={onClose}>
      <div className="preview-inner" onMouseDown={(e) => e.stopPropagation()}>
        {hasImg ? (
          <img
            className={`preview-img${tiny ? ' tiny' : ''}`}
            src={(thumb as any).url}
            alt={entry.name}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget
              setNatural({ w: img.naturalWidth, h: img.naturalHeight })
            }}
          />
        ) : (
          <div className="preview-fallback">
            {entry.kind === 'dir'
              ? '这是一个文件夹，双击进入查看内容'
              : thumb
              ? `无法生成预览\n${
                  thumb.reason === 'unsupported'
                    ? '该格式需要 Windows 缩略图支持，将在后续版本接入'
                    : thumb.reason
                }`
              : '正在读取…'}
          </div>
        )}

        <div className="preview-meta">
          <span className="name">{entry.name}</span>
          {psd && (
            <>
              <span>
                {psd.width} × {psd.height}
              </span>
              <span>{COLOR_MODES[psd.colorMode] ?? `模式 ${psd.colorMode}`}</span>
              <span>{psd.depth} bit</span>
            </>
          )}
          {!psd && natural && (
            <span>
              {natural.w} × {natural.h}
            </span>
          )}
          {!psd && !natural && entry.size > 0 && <span>{formatSize(entry.size)}</span>}
          {entry.mtime > 0 && <span>{formatDate(entry.mtime)}</span>}
          {isEmbedded && (
            <span style={{ opacity: 0.55 }} title="当前显示的是 PSD 内嵌的低分辨率缩略图">
              内嵌缩略图
            </span>
          )}
        </div>
      </div>

      <div className="preview-hint">
        <span>空格 / Esc 关闭</span>
        <span>← → 切换</span>
      </div>
    </div>
  )
}
