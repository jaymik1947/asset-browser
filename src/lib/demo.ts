import type { Entry } from './types'
import { extOf } from './fs'
import { registerDemoFile, registerDemoDir } from './backend'

const ROOT = '演示素材库'

const PALETTE = [
  '#3d5a80', '#64809a', '#a3b8cc', '#c9a227', '#8a5a44',
  '#7a8b6f', '#9c6b8e', '#4f6d7a', '#b56576', '#6d597a',
  '#355070', '#b07d62',
]

function be16(v: number): [number, number] {
  return [(v >>> 8) & 0xff, v & 0xff]
}
function be32(v: number): [number, number, number, number] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
}

async function canvasJpeg(w: number, h: number, color: string, label: string): Promise<Uint8Array> {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  ctx.fillRect(w * 0.12, h * 0.16, w * 0.34, h * 0.34)
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(w * 0.55, h * 0.5, w * 0.3, h * 0.32)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = `600 ${Math.round(h * 0.1)}px "Segoe UI", sans-serif`
  ctx.fillText(label, w * 0.12, h * 0.86)
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.88))
  return new Uint8Array(await blob.arrayBuffer())
}

export async function buildDemoPsd(name: string, w: number, h: number, color: string, label: string): Promise<File> {
  const thumbW = 160
  const thumbH = Math.round((160 * h) / w)
  const jpeg = await canvasJpeg(thumbW, Math.max(40, thumbH), color, label)

  const header = new Uint8Array(26)
  header.set([0x38, 0x42, 0x50, 0x53], 0)
  const hv = new DataView(header.buffer)
  hv.setUint16(4, 1)
  hv.setUint16(12, 3)
  hv.setUint32(14, h)
  hv.setUint32(18, w)
  hv.setUint16(22, 8)
  hv.setUint16(24, 3)

  const colorMode = new Uint8Array(4)

  const blockHead: number[] = [0x38, 0x42, 0x49, 0x4d, 0x04, 0x0c, 0, 0]
  const size = jpeg.length
  blockHead.push(...be32(size))
  const padded = size % 2 === 1 ? size + 1 : size
  const irBody = new Uint8Array(padded)
  irBody.set(jpeg, 0)

  const irTotal = 4 + blockHead.length + padded
  const irLen = new Uint8Array(4)
  new DataView(irLen.buffer).setUint32(0, irTotal - 4)

  const blockHeadBytes = new Uint8Array(blockHead)

  const layerLen = new Uint8Array(4)
  const composite = new Uint8Array(4)

  return new File(
    [header, colorMode, irLen, blockHeadBytes, irBody, layerLen, composite],
    name,
    { type: 'image/vnd.adobe.photoshop' }
  )
}

export async function buildDemoImage(name: string, w: number, h: number, color: string): Promise<File> {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  for (let i = 0; i < 7; i++) {
    ctx.beginPath()
    ctx.arc(w * (0.2 + i * 0.1), h * (0.35 + Math.sin(i) * 0.18), h * 0.12, 0, Math.PI * 2)
    ctx.fill()
  }
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.88))
  return new File([blob], name, { type: 'image/jpeg' })
}

function fakeDirHandle(name: string): any {
  return {
    kind: 'directory',
    name,
    async *entries() {},
  }
}

function fakeFileHandle(file: File): any {
  return {
    kind: 'file',
    name: file.name,
    getFile: async () => file,
  }
}

export async function buildDemoEntries(): Promise<Entry[]> {
  const folders = ['01_客户A', '02_客户B', '03_品牌规范', '04_产品渲染', '99_废弃']
  const out: Entry[] = folders.map((name) => {
    const id = `${ROOT}\\${name}`
    const handle = fakeDirHandle(name)
    registerDemoDir(id, handle)
    return {
      id,
      name,
      kind: 'dir' as const,
      ext: '',
      size: 0,
      mtime: Date.now(),
      handle,
    }
  })

  const psdSpecs: [string, number, number, string][] = [
    ['海报主图_竖版.psd', 2480, 3508, '2019-06-01'],
    ['详情页_首屏.psd', 1920, 1080, '2024-03-12'],
    ['包装刀版_展开.psd', 3000, 2200, '2020-09-08'],
    ['Banner_双十一.psd', 1920, 600, '2021-11-02'],
  ]

  const addFile = (name: string, ext: string, size: number, file?: File) => {
    const id = `${ROOT}\\${name}`
    const handle = fakeFileHandle(file ?? new File([], name))
    registerDemoFile(id, handle)
    out.push({
      id,
      name,
      kind: 'file',
      ext,
      size,
      mtime: Date.now() - Math.random() * 9e10,
      handle,
    })
  }

  for (const [name, w, h, label] of psdSpecs) {
    const f = await buildDemoPsd(name, w, h, PALETTE[Math.floor(Math.random() * PALETTE.length)], label)
    addFile(name, 'psd', 48 * 1024 * 1024 + Math.random() * 40 * 1024 * 1024, f)
  }

  for (let i = 0; i < 14; i++) {
    const name = `渲染图_${String(i + 1).padStart(2, '0')}.jpg`
    const f = await buildDemoImage(name, 1200, 900, PALETTE[i % PALETTE.length])
    addFile(name, 'jpg', 2_400_000 + Math.random() * 4e6, f)
  }

  const others: [string, string][] = [
    ['品牌手册.ai', 'ai'],
    ['Logo_标准制图.ai', 'ai'],
    ['画册内页.indd', 'indd'],
    ['产品演示.mp4', 'mp4'],
    ['主KV.c4d', 'c4d'],
    ['场景.max', 'max'],
    ['提案.pdf', 'pdf'],
    ['图标组.svg', 'svg'],
  ]
  for (const [name, ext] of others) {
    addFile(name, ext, 8_000_000 + Math.random() * 9e7)
  }

  return out
}
