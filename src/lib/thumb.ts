import type { Entry } from './types'
import { readPsd, type PsdInfo } from './psd'
import { IMAGE_EXTS } from './types'
import { IS_NATIVE, getFileHandle, nativeThumb } from './backend'

export interface ThumbOk {
  status: 'ok'
  url: string
  psd?: PsdInfo
}

export interface ThumbNone {
  status: 'none'
  reason: string
  psd?: PsdInfo
}

export type Thumb = ThumbOk | ThumbNone

interface NativeThumb {
  ok: boolean
  dataUrl: string | null
  w: number | null
  h: number | null
  colorMode: number | null
  depth: number | null
  err: string | null
}

const MAX_CACHE = 2500
const MAX_CONCURRENT = 8

const cache = new Map<string, Thumb>()
const order: string[] = []

interface PendingRec {
  promise: Promise<Thumb>
  prio: number
  cancelled: boolean
  /** 已经拿到并发额度、正在解码。这类不参与剪枝（剪了也是白剪，马上就出结果） */
  started: boolean
}

let active = 0
const waiters: { grant: (ok: boolean) => void; prio: number; rec: PendingRec }[] = []
const pending = new Map<string, PendingRec>()

/** 拿到执行权返回 true；排队期间被作废返回 false（不占并发额度） */
async function acquire(prio: number, rec: PendingRec): Promise<boolean> {
  if (rec.cancelled) return false
  if (active < MAX_CONCURRENT) {
    active++
    rec.started = true
    return true
  }
  return new Promise<boolean>((grant) => waiters.push({ grant, prio, rec }))
}

function release() {
  active--
  // 一次性清掉队首所有作废的等待者：它们不消耗并发额度，
  // 否则快速拖动时队列会被「已经滚过去、没人要」的请求堵死
  while (waiters.length) {
    waiters.sort((a, b) => a.prio - b.prio)
    const w = waiters.shift()!
    if (w.rec.cancelled) {
      w.grant(false)
      continue
    }
    active++
    w.rec.started = true
    w.grant(true)
    return
  }
}

/**
 * 按当前视口范围剪枝：不在 keep 里的排队请求立刻作废。
 * 这是快速拖动到底部的关键——掠过的行发起的请求必须马上丢掉，
 * 否则它们会排在底部请求前面，让底部一直转圈。
 */
export function pruneThumbQueue(keep: Set<string>) {
  for (const [id, rec] of pending) {
    if (keep.has(id) || rec.started) continue
    rec.cancelled = true
    pending.delete(id)
  }
}

export function thumbQueueStats() {
  return { active, waiting: waiters.length, pending: pending.size }
}

function touch(key: string) {
  const i = order.indexOf(key)
  if (i >= 0) order.splice(i, 1)
  order.push(key)
  while (order.length > MAX_CACHE) {
    const dead = order.shift()
    if (!dead) break
    const v = cache.get(dead)
    if (v && v.status === 'ok' && v.url.startsWith('blob:')) URL.revokeObjectURL(v.url)
    cache.delete(dead)
  }
}

export function getCachedThumb(id: string): Thumb | undefined {
  const v = cache.get(id)
  if (v) touch(id)
  return v
}

function put(id: string, v: Thumb): Thumb {
  cache.set(id, v)
  touch(id)
  return v
}

async function nativeThumbOf(entry: Entry): Promise<Thumb> {
  const r = (await nativeThumb(entry.id, 400)) as NativeThumb | null
  if (!r) return { status: 'none', reason: 'no-backend' }
  const psd: PsdInfo | undefined =
    r.w && r.h
      ? {
          width: r.w,
          height: r.h,
          depth: r.depth ?? 8,
          colorMode: r.colorMode ?? 3,
          channels: 0,
          thumb: null,
          thumbSize: 0,
          hasComposite: false,
        }
      : undefined

  if (r.ok && r.dataUrl) {
    return { status: 'ok', url: r.dataUrl, psd }
  }
  return { status: 'none', reason: r.err ?? 'no-preview', psd }
}

async function browserThumb(entry: Entry): Promise<Thumb> {
  const fh = await getFileHandle(entry.id)
  if (!fh) return { status: 'none', reason: 'file-missing' }
  const file = await fh.getFile()

  if (entry.ext === 'psd' || entry.ext === 'psb') {
    const info = await readPsd(file)
    if (info?.thumb) {
      return { status: 'ok', url: URL.createObjectURL(info.thumb), psd: info }
    }
    return { status: 'none', reason: info ? 'no-thumb' : 'not-psd', psd: info ?? undefined }
  }

  if (IMAGE_EXTS.has(entry.ext)) {
    return { status: 'ok', url: URL.createObjectURL(file) }
  }

  return { status: 'none', reason: 'unsupported' }
}

export function loadThumb(entry: Entry, prio = 0): Promise<Thumb> {
  const hit = cache.get(entry.id)
  if (hit) {
    touch(entry.id)
    return Promise.resolve(hit)
  }
  const inflight = pending.get(entry.id)
  if (inflight) {
    // 同一个文件已经在排队：如果新的优先级更高（视口内），给它插队
    if (prio < inflight.prio) inflight.prio = prio
    return inflight.promise
  }

  const rec: PendingRec = {
    promise: undefined as unknown as Promise<Thumb>,
    prio,
    cancelled: false,
    started: false,
  }

  const p = (async (): Promise<Thumb> => {
    const ok = await acquire(prio, rec)
    if (!ok) {
      // 排队期间被剪枝，不占额度，直接返回作废标记
      pending.delete(entry.id)
      return { status: 'none', reason: 'cancelled' }
    }
    try {
      const r = IS_NATIVE ? await nativeThumbOf(entry) : await browserThumb(entry)
      return put(entry.id, r)
    } catch (e: any) {
      return put(entry.id, { status: 'none', reason: e?.message ?? 'read-failed' })
    } finally {
      pending.delete(entry.id)
      release()
    }
  })()

  rec.promise = p
  pending.set(entry.id, rec)
  return p
}

export function clearThumbCache() {
  for (const v of cache.values()) {
    if (v.status === 'ok' && v.url.startsWith('blob:')) URL.revokeObjectURL(v.url)
  }
  cache.clear()
  order.length = 0
}
