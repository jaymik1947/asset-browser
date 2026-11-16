import { useEffect, useRef, useState } from 'react'
import {
  cacheClear,
  cacheSetDir,
  cacheSetLimit,
  cacheStats,
  pickFolderPath,
  pickExe,
  prewarmPause,
  prewarmResume,
  prewarmStart,
  prewarmStatus,
  prewarmStop,
  autoWatchGet,
  autoWatchSet,
  findPhotoshop,
  type AutoStatus,
  type CacheStats,
  type PrewarmStatus,
} from '../lib/backend'
import { formatSize } from '../lib/fs'
import type { Bookmark } from '../lib/bookmarks'

const SLIDER_MIN_MB = 128
const SLIDER_MAX_MB = 20480 // 20 GB
const CUSTOM_MAX_MB = 1048576 // 1 TB

interface Props {
  onClose: () => void
  bookmarks: Bookmark[]
  hiddenExts: string[]
  onHiddenExts: (v: string[]) => void
  psPath: string
  onPsPath: (v: string) => void
  closeToTray: boolean
  onCloseToTray: (v: boolean) => void
}

export function Settings({
  onClose,
  bookmarks,
  hiddenExts,
  onHiddenExts,
  psPath,
  onPsPath,
  closeToTray,
  onCloseToTray,
}: Props) {
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [limitMb, setLimitMb] = useState(2048)
  const [limitInput, setLimitInput] = useState('2048')
  // 滑条位置单独存一份：直接绑 limitMb 的话拖动时滑块不动（limitMb 只在松手后更新）
  const [sliderMb, setSliderMb] = useState(2048)
  const [customLimit, setCustomLimit] = useState(false)
  // cacheStats 在几万条缓存时要几百毫秒才回来，回来时不能把用户刚调的值覆盖掉
  const limitTouched = useRef(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pw, setPw] = useState<PrewarmStatus | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [workers, setWorkers] = useState(8)
  const rateRef = useRef({ t: 0, n: 0, v: 0 })
  const [auto, setAuto] = useState<AutoStatus | null>(null)
  const [autoOn, setAutoOn] = useState(false)
  const [autoMin, setAutoMin] = useState(5)
  const [extText, setExtText] = useState(hiddenExts.join(', '))

  useEffect(() => {
    let alive = true
    cacheStats().then((s) => {
      if (!alive || !s) return
      setStats(s)
      // 用户已经手动调过，就别再用旧快照回写
      if (limitTouched.current) return
      const mb = Math.max(64, Math.round(s.limit / 1048576))
      setLimitMb(mb)
      setLimitInput(String(mb))
      setSliderMb(Math.min(SLIDER_MAX_MB, Math.max(SLIDER_MIN_MB, mb)))
      // 超过滑条范围的存量值，直接进自定义模式，否则滑条显示会骗人
      if (mb > SLIDER_MAX_MB) setCustomLimit(true)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    let timer = 0
    const tick = async () => {
      const s = await prewarmStatus()
      if (!alive) return
      if (s) {
        const done = s.done + s.skipped + s.failed
        const now = Date.now()
        const r = rateRef.current
        if (r.t === 0) {
          r.t = now
          r.n = done
        } else if (now - r.t >= 800) {
          r.v = (done - r.n) / ((now - r.t) / 1000)
          r.t = now
          r.n = done
        }
        setPw(s)
      }
      const a = await autoWatchGet()
      if (alive && a) {
        setAuto(a)
        setAutoOn(a.enabled)
        setAutoMin(a.intervalMin)
      }
      timer = window.setTimeout(tick, 900)
    }
    tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  const flash = (text: string) => {
    setMsg(text)
    window.setTimeout(() => setMsg(null), 2000)
  }

  const applyLimit = async (mb: number) => {
    limitTouched.current = true
    const clamped = Math.max(64, Math.min(CUSTOM_MAX_MB, Math.round(mb)))
    setLimitMb(clamped)
    setLimitInput(String(clamped))
    setSliderMb(Math.min(SLIDER_MAX_MB, Math.max(SLIDER_MIN_MB, clamped)))
    setBusy(true)
    const s = await cacheSetLimit(clamped)
    if (s) setStats(s)
    setBusy(false)
    flash('已保存')
  }

  const doClear = async () => {
    setBusy(true)
    const s = await cacheClear()
    if (s) setStats(s)
    setBusy(false)
    flash('缓存已清空')
  }

  const changeDir = async () => {
    const dir = await pickFolderPath()
    if (!dir) return
    setBusy(true)
    const r = await cacheSetDir(dir)
    if (r.ok && r.stats) {
      setStats(r.stats)
      flash('已切换，新目录缓存为空')
    } else {
      flash(r.error || '切换失败')
    }
    setBusy(false)
  }

  const resetDir = async () => {
    if (!stats) return
    setBusy(true)
    const r = await cacheSetDir(stats.defaultDir)
    if (r.ok && r.stats) {
      setStats(r.stats)
      flash('已恢复默认位置')
    } else {
      flash(r.error || '操作失败')
    }
    setBusy(false)
  }

  const toggleSel = (path: string) => {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const applyAuto = async (on: boolean, min: number) => {
    const paths = bookmarks.map((b) => b.path)
    const st = await autoWatchSet(on, min, paths)
    if (st) setAuto(st)
  }

  const toggleAuto = async () => {
    const next = !autoOn
    setAutoOn(next)
    await applyAuto(next, autoMin)
  }

  const changeAutoMin = async (m: number) => {
    setAutoMin(m)
    await applyAuto(autoOn, m)
  }

  const doStartPrewarm = async () => {
    const paths = bookmarks.filter((b) => sel.has(b.path)).map((b) => b.path)
    if (paths.length === 0) return
    setBusy(true)
    const s = await prewarmStart(paths, workers, 0)
    if (s) setPw(s)
    setBusy(false)
  }

  const togglePause = async () => {
    const s = pw?.paused ? await prewarmResume() : await prewarmPause()
    if (s) setPw(s)
  }

  const doStopPrewarm = async () => {
    const s = await prewarmStop()
    if (s) setPw(s)
  }

  const choosePs = async () => {
    const p = await pickExe()
    if (p) onPsPath(p)
  }

  const autoDetectPs = async () => {
    const p = await findPhotoshop()
    if (p) onPsPath(p)
    else flash('没找到，请手动指定 Photoshop.exe')
  }

  const commitExts = (text: string) => {
    setExtText(text)
    const list = text
      .split(/[,，\s;]+/)
      .map((x) => x.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean)
    onHiddenExts([...new Set(list)])
  }

  const fmtClock = (ms: number) => {
    const d = new Date(ms)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const fmtRel = (ms: number) => {
    const left = Math.max(0, Math.round((ms - Date.now()) / 60000))
    if (left < 1) return '1 分钟内'
    if (left < 60) return `${left} 分钟后`
    return `${Math.round(left / 60)} 小时后`
  }
  const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
  const used = stats ? stats.bytes : 0
  const limitBytes = limitMb * 1048576
  const pct = limitBytes > 0 ? Math.min(100, (used / limitBytes) * 100) : 0
  const pwProcessed = pw ? pw.done + pw.skipped + pw.failed : 0
  const pwPct = pw && pw.total > 0 ? Math.min(100, Math.round((pwProcessed / pw.total) * 100)) : 0
  const pwRate = rateRef.current.v
  const pwRemain =
    pwRate > 0.2 && pw && pw.total > pwProcessed
      ? Math.round((pw.total - pwProcessed) / pwRate)
      : -1
  const fmtDur = (sec: number) => {
    if (sec < 0) return ''
    if (sec < 60) return `${sec} 秒`
    if (sec < 3600) return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`
    return `${Math.floor(sec / 3600)} 小时 ${Math.floor((sec % 3600) / 60)} 分`
  }

  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">设置</div>

        <div className="modal-section">
          <div className="modal-label">缩略图磁盘缓存</div>
          <div className="modal-desc">缓存解码后的缩略图，第二次打开同一目录秒出。</div>

          <div className="cache-stat">
            <span className="cache-num">{used > 0 ? formatSize(used) : '0 B'}</span>
            <span className="cache-sub">
              {stats ? stats.count.toLocaleString() : 0} 张
              {stats ? ` · 上限 ${formatSize(stats.limit)}` : ''}
            </span>
          </div>

          <div className="cache-bar">
            <div className="cache-bar-fill" style={{ width: `${pct}%` }} />
          </div>

          <div className="cache-limit-row">
            <span>上限</span>
            <label className="custom-limit" title="勾选后滑条不可用，直接输入数值（最大 1 TB）">
              <input
                type="checkbox"
                checked={customLimit}
                onChange={(e) => {
                  limitTouched.current = true
                  const on = e.target.checked
                  setCustomLimit(on)
                  if (!on) {
                    // 回到滑条模式：超出 20 GB 的值拉回上限
                    const mb = Math.min(SLIDER_MAX_MB, Math.max(SLIDER_MIN_MB, Number(limitInput) || limitMb))
                    void applyLimit(mb)
                  }
                }}
              />
              <span>自定义</span>
            </label>
            <input
              type="range"
              min={SLIDER_MIN_MB}
              max={SLIDER_MAX_MB}
              step={128}
              disabled={customLimit}
              value={Math.min(SLIDER_MAX_MB, sliderMb)}
              onChange={(e) => {
                const v = Number(e.target.value)
                setSliderMb(v)
                setLimitInput(String(v))
              }}
              onMouseUp={(e) => applyLimit(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => applyLimit(Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => applyLimit(Number((e.target as HTMLInputElement).value))}
            />
            <input
              className="num-input"
              type="number"
              min={64}
              max={CUSTOM_MAX_MB}
              disabled={!customLimit}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              onBlur={(e) => {
                if (customLimit) applyLimit(Number(e.target.value) || limitMb)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customLimit) {
                  applyLimit(Number((e.target as HTMLInputElement).value) || limitMb)
                }
              }}
            />
            <span className="unit">MB</span>
          </div>
          <div className="limit-hint">
            {customLimit
              ? '自定义模式：输入 64 – 1048576 MB（1 TB）'
              : '滑条范围 128 MB – 20 GB；要更大就勾选「自定义」'}
          </div>

          <div className="cache-dir-row">
            <span className="cache-dir-label">缓存位置</span>
            <span className="cache-dir" title={stats?.dir ?? ''}>
              {stats?.dir ?? '—'}
            </span>
          </div>

          <div className="modal-actions">
            <button className="ghost-btn" onClick={changeDir} disabled={busy}>
              更改位置
            </button>
            <button
              className="ghost-btn"
              onClick={resetDir}
              disabled={busy || !stats || stats.dir === stats.defaultDir}
            >
              恢复默认
            </button>
            <button className="ghost-btn" onClick={doClear} disabled={busy}>
              清空缓存
            </button>
            {msg && <span className="modal-msg">{msg}</span>}
          </div>
        </div>

        <div className="modal-section">
          <div className="modal-label">预生成缓存</div>
          <div className="modal-desc">
            勾选收藏夹里的文件夹，提前生成缩略图（含子目录），之后浏览不用等。已有缓存会自动跳过。
          </div>

          {pw && pw.running ? (
            <>
              <div className="pw-target">
                <span className="pw-target-label">正在生成</span>
                <span className="pw-target-name" title={pw.roots.join('\n')}>
                  {pw.roots.length > 1 ? `${pw.roots.length} 个文件夹` : baseName(pw.path)}
                </span>
              </div>
              <div className="cache-stat">
                <span className="cache-num">{pwPct}%</span>
                <span className="cache-sub">
                  {pwProcessed} / {pw.total} · 跳过 {pw.skipped} · 失败 {pw.failed}
                </span>
              </div>
              <div className="cache-bar">
                <div className="cache-bar-fill" style={{ width: `${pwPct}%` }} />
              </div>
              <div className="pw-speed">
                {pwRate > 0.1 ? `${pwRate.toFixed(1)} 张/秒` : '正在统计速度…'}
                {pwRemain >= 0 ? ` · 预计剩余 ${fmtDur(pwRemain)}` : ''}
              </div>
              <div className="modal-actions">
                <button className="ghost-btn" onClick={togglePause}>
                  {pw.paused ? '继续' : '暂停'}
                </button>
                <button className="ghost-btn" onClick={doStopPrewarm}>
                  停止
                </button>
                <span className="modal-msg" style={{ color: 'var(--text-3)' }}>
                  {pw.paused ? '已暂停' : '后台运行中，可关闭此窗口'}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="pw-toolbar">
                <span className="pw-toolbar-label">并发</span>
                <div className="seg">
                  {[1, 2, 4, 8, 12, 16].map((n) => (
                    <button
                      key={n}
                      className={`seg-btn${workers === n ? ' on' : ''}`}
                      onClick={() => setWorkers(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <span className="pw-hint">越大越快，也越占 CPU</span>
              </div>

              {bookmarks.length === 0 ? (
                <div className="pw-empty">
                  还没有收藏文件夹。先在工具栏点星标收藏一个，再回来生成。
                </div>
              ) : (
                <div className="pw-chips">
                  {bookmarks.map((b) => (
                    <label
                      key={b.path}
                      className={`pw-chip${sel.has(b.path) ? ' sel' : ''}`}
                      title={b.path}
                    >
                      <input
                        type="checkbox"
                        checked={sel.has(b.path)}
                        onChange={() => toggleSel(b.path)}
                      />
                      <span className="pw-star">★</span>
                      <span className="pw-chip-name">{b.name}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="modal-actions">
                <button
                  className="ghost-btn"
                  onClick={doStartPrewarm}
                  disabled={sel.size === 0 || busy}
                >
                  开始生成{sel.size > 0 ? ` (${sel.size})` : ''}
                </button>
                {bookmarks.length > 0 && (
                  <button
                    className="ghost-btn"
                    onClick={() =>
                      setSel(
                        sel.size === bookmarks.length
                          ? new Set()
                          : new Set(bookmarks.map((b) => b.path))
                      )
                    }
                  >
                    {sel.size === bookmarks.length ? '全不选' : '全选'}
                  </button>
                )}
                {msg && <span className="modal-msg">{msg}</span>}
              </div>
            </>
          )}
        </div>

        <div className="modal-section">
          <div className="modal-label">自动更新缓存</div>
          <div className="modal-desc">
            定期检查收藏夹里的文件，有新增或被修改的会自动补上缩略图。已缓存的会跳过，不重复生成。
          </div>

          <div className="pw-toolbar">
            <label className="auto-switch">
              <input type="checkbox" checked={autoOn} onChange={toggleAuto} />
              <span>{autoOn ? '已开启' : '已关闭'}</span>
            </label>
            <span className="pw-toolbar-label">每</span>
            <div className="seg">
              {[1, 5, 15, 30, 60].map((m) => (
                <button
                  key={m}
                  className={`seg-btn${autoMin === m ? ' on' : ''}`}
                  onClick={() => changeAutoMin(m)}
                >
                  {m}分
                </button>
              ))}
            </div>
          </div>

          {autoOn && (
            <div className="pw-last">
              监控 {auto?.paths.length ?? 0} 个收藏夹 ·{' '}
              {auto && auto.lastRun > 0 ? `上次检查 ${fmtClock(auto.lastRun)} · ` : ''}
              下次 {auto ? fmtRel(auto.nextRun) : '—'}
            </div>
          )}
        </div>

        <div className="modal-section">
          <div className="modal-label">窗口行为</div>
          <div className="pw-toolbar">
            <label className="auto-switch">
              <input
                type="checkbox"
                checked={closeToTray}
                onChange={(e) => onCloseToTray(e.target.checked)}
              />
              <span>点关闭按钮时最小化到系统托盘（不退出程序）</span>
            </label>
          </div>
          <div className="modal-desc" style={{ marginBottom: 0 }}>
            开启后，关闭窗口不会退出；从托盘图标左键点开，或右键选「退出」才真正结束。
          </div>
        </div>

        <div className="modal-section">
          <div className="modal-label">Photoshop</div>
          <div className="modal-desc">
            右键菜单的「在 Photoshop 中打开」用这个程序。留空则每次自动在默认安装位置查找。
          </div>
          <div className="cache-dir-row">
            <span className="cache-dir-label">程序路径</span>
            <span className="cache-dir" title={psPath}>
              {psPath || '未设置'}
            </span>
          </div>
          <div className="modal-actions">
            <button className="ghost-btn" onClick={choosePs} disabled={busy}>
              选择程序
            </button>
            <button className="ghost-btn" onClick={autoDetectPs} disabled={busy}>
              自动检测
            </button>
            {psPath && (
              <button className="ghost-btn" onClick={() => onPsPath('')} disabled={busy}>
                清除
              </button>
            )}
          </div>
        </div>

        <div className="modal-section">
          <div className="modal-label">隐藏后缀名</div>
          <div className="modal-desc">
            这里填写的后缀不会出现在列表里（也不参与缓存预生成筛选统计）。英文逗号、中文逗号或空格分隔，不用写点。
          </div>
          <input
            className="text-input"
            value={extText}
            placeholder="例如：xlsx, txt, db, tmp"
            spellCheck={false}
            onChange={(e) => commitExts(e.target.value)}
          />
          <div className="pw-last">
            {hiddenExts.length > 0 ? `当前隐藏 ${hiddenExts.length} 种：${hiddenExts.join('、')}` : '当前没有隐藏任何后缀'}
          </div>
        </div>

        <div className="modal-foot">
          <button className="primary-btn" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
