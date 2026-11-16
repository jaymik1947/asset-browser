const zlib = require('zlib')
const fs = require('fs')

const W = 512
const H = 512

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crcBuf])
}

const px = Buffer.alloc(W * H * 4)

function put(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = (y * W + x) * 4
  const ia = a / 255
  px[i] = Math.round(px[i] * (1 - ia) + r * ia)
  px[i + 1] = Math.round(px[i + 1] * (1 - ia) + g * ia)
  px[i + 2] = Math.round(px[i + 2] * (1 - ia) + b * ia)
  px[i + 3] = Math.max(px[i + 3], a)
}

function roundRect(x0, y0, w, h, r, colorFn) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = Math.min(x - x0, x0 + w - 1 - x)
      const dy = Math.min(y - y0, y0 + h - 1 - y)
      let inside = true
      if (dx < r && dy < r) {
        const d = Math.hypot(r - dx, r - dy)
        inside = d <= r
      }
      if (inside) {
        const c = colorFn(x - x0, y - y0)
        if (c) put(x, y, c[0], c[1], c[2], c[3])
      }
    }
  }
}

const BG = [16, 16, 19, 255]
roundRect(0, 0, W, H, 110, () => BG)

const ACCENT = [10, 132, 255, 255]
const LIGHT = [232, 236, 244, 255]
const DIM = [120, 126, 138, 255]

roundRect(96, 108, 200, 152, 14, () => LIGHT)
roundRect(96, 108, 200, 40, 14, (x, y) => (y < 14 ? ACCENT : [0, 0, 0, 0]))

roundRect(96, 284, 92, 120, 12, () => DIM)
roundRect(204, 284, 92, 120, 12, () => DIM)
roundRect(312, 284, 104, 120, 12, () => ACCENT)

roundRect(320, 128, 96, 96, 12, () => [40, 44, 52, 255])
roundRect(320, 128, 96, 96, 12, (x, y) => {
  const cx = 48
  const cy = 48
  const d = Math.hypot(x - cx, y - cy)
  return d < 30 && d > 24 ? [10, 132, 255, 255] : null
})

const raw = Buffer.alloc((W * 4 + 1) * H)
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8
ihdr[9] = 6
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

fs.writeFileSync('app-icon.png', png)
console.log('wrote app-icon.png', png.length, 'bytes')
