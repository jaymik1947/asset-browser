const PSD_SIG = 0x38425053
const IR_SIG = 0x3842494d
const MAX_HEAD = 512 * 1024

export const COLOR_MODES: Record<number, string> = {
  0: 'Bitmap',
  1: 'Grayscale',
  2: 'Indexed',
  3: 'RGB',
  4: 'CMYK',
  7: 'Multichannel',
  8: 'Duotone',
  9: 'Lab',
}

export interface PsdInfo {
  width: number
  height: number
  depth: number
  colorMode: number
  channels: number
  thumb: Blob | null
  thumbSize: number
  hasComposite: boolean
}

export function isPsd(name: string): boolean {
  const e = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return e === 'psd'
}

function findJpegEnd(b: Uint8Array, start: number, end: number): number {
  for (let i = end - 2; i > start; i--) {
    if (b[i] === 0xff && b[i + 1] === 0xd9) return i + 2
  }
  return end
}

function extractJpeg(buf: ArrayBuffer, start: number, end: number): Blob | null {
  const b = new Uint8Array(buf)
  let s = start
  if (!(b[s] === 0xff && b[s + 1] === 0xd8)) s += 28
  if (!(b[s] === 0xff && b[s + 1] === 0xd8)) return null
  const e = findJpegEnd(b, s, end)
  if (e - s < 128) return null
  return new Blob([b.slice(s, e)], { type: 'image/jpeg' })
}

async function decodeBgr(
  buf: ArrayBuffer,
  start: number,
  end: number
): Promise<Blob | null> {
  const v = new DataView(buf)
  if (start + 28 > end) return null
  const format = v.getUint32(start)
  const w = v.getUint32(start + 4)
  const h = v.getUint32(start + 8)
  if (format !== 0) return null
  if (!w || !h || w > 1024 || h > 1024) return null
  const px = w * h
  const srcStart = start + 28
  if (srcStart + px * 3 > end) return null
  const src = new Uint8Array(buf, srcStart, px * 3)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const img = ctx.createImageData(w, h)
  const d = img.data
  for (let i = 0, j = 0; i < px; i++, j += 3) {
    d[i * 4] = src[j + 2]
    d[i * 4 + 1] = src[j + 1]
    d[i * 4 + 2] = src[j]
    d[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'))
}

export async function readPsd(file: File): Promise<PsdInfo | null> {
  const slice = file.slice(0, Math.min(file.size, MAX_HEAD))
  const buf = await slice.arrayBuffer()
  if (buf.byteLength < 30) return null
  const v = new DataView(buf)
  if (v.getUint32(0) !== PSD_SIG) return null

  const channels = v.getUint16(12)
  const height = v.getUint32(14)
  const width = v.getUint32(18)
  const depth = v.getUint16(22)
  const colorMode = v.getUint16(24)

  const base: PsdInfo = {
    width,
    height,
    depth,
    colorMode,
    channels,
    thumb: null,
    thumbSize: 0,
    hasComposite: false,
  }

  let off = 26
  if (off + 4 > buf.byteLength) return base
  const cmLen = v.getUint32(off)
  off += 4 + cmLen
  if (off + 4 > buf.byteLength) return base
  const irLen = v.getUint32(off)
  off += 4
  const irEnd = Math.min(off + irLen, buf.byteLength)

  let fallback: Blob | null = null
  let fallbackSize = 0

  while (off + 12 <= irEnd) {
    if (v.getUint32(off) !== IR_SIG) break
    const id = v.getUint16(off + 4)
    const nameLen = v.getUint8(off + 6)
    let nameTotal = 1 + nameLen
    if (nameTotal % 2 !== 0) nameTotal++
    const sizePos = off + 6 + nameTotal
    if (sizePos + 4 > irEnd) break
    const size = v.getUint32(sizePos)
    const dataStart = sizePos + 4
    const dataEnd = Math.min(dataStart + size, buf.byteLength)

    if (id === 1036) {
      const blob = extractJpeg(buf, dataStart, dataEnd)
      if (blob) return { ...base, thumb: blob, thumbSize: 1036 }
      const bgr = await decodeBgr(buf, dataStart, dataEnd)
      if (bgr) return { ...base, thumb: bgr, thumbSize: 1036 }
    } else if (id === 1033 && !fallback) {
      const blob = (await decodeBgr(buf, dataStart, dataEnd)) || extractJpeg(buf, dataStart, dataEnd)
      if (blob) {
        fallback = blob
        fallbackSize = 1033
      }
    }
    off = dataStart + size + (size % 2)
  }

  return { ...base, thumb: fallback, thumbSize: fallbackSize }
}
