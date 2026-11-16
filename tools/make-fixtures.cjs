const fs = require('fs')
const path = require('path')

const SRC = 'C:\\Windows\\Web\\Wallpaper\\ThemeA'
const OUT = 'F:\\test-assets'

fs.mkdirSync(path.join(OUT, '客户A', '2024'), { recursive: true })
fs.mkdirSync(path.join(OUT, '参考图'), { recursive: true })
fs.mkdirSync(path.join(OUT, '产品渲染'), { recursive: true })

const srcFiles = fs
  .readdirSync(SRC)
  .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
  .map((f) => path.join(SRC, f))

const names = [
  '主视觉_01.jpg', '主视觉_02.jpg', '主视觉_03.jpg', '主视觉_04.jpg',
  '主视觉_05.jpg', '主视觉_06.jpg', '主视觉_07.jpg', '主视觉_08.jpg',
]

srcFiles.forEach((src, i) => {
  if (i < names.length) fs.copyFileSync(src, path.join(OUT, names[i]))
  if (i < 3) fs.copyFileSync(src, path.join(OUT, '客户A', '2024', `提案图_0${i + 1}.jpg`))
  if (i >= 3 && i < 6) fs.copyFileSync(src, path.join(OUT, '参考图', `参考_0${i - 2}.jpg`))
})

function buildPsd(jpeg, width, height) {
  const header = Buffer.alloc(26)
  header.writeUInt32BE(0x38425053, 0)
  header.writeUInt16BE(1, 4)
  header.writeUInt16BE(3, 12)
  header.writeUInt32BE(height, 14)
  header.writeUInt32BE(width, 18)
  header.writeUInt16BE(8, 22)
  header.writeUInt16BE(3, 24)

  const cm = Buffer.alloc(4)

  const blockHead = Buffer.alloc(12)
  blockHead.writeUInt32BE(0x3842494d, 0)
  blockHead.writeUInt16BE(1036, 4)
  blockHead.writeUInt8(0, 6)
  blockHead.writeUInt8(0, 7)
  blockHead.writeUInt32BE(jpeg.length, 8)

  const pad = jpeg.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0)
  const block = Buffer.concat([blockHead, jpeg, pad])

  const irLen = Buffer.alloc(4)
  irLen.writeUInt32BE(block.length, 0)

  const layerLen = Buffer.alloc(4)
  const imageData = Buffer.alloc(8)

  return Buffer.concat([header, cm, irLen, block, layerLen, imageData])
}

const thumbSrc = srcFiles[0]
const jpeg = fs.readFileSync(thumbSrc)

const specs = [
  ['海报主图_竖版.psd', 2480, 3508],
  ['详情页_首屏.psd', 1920, 1080],
  ['包装刀版.psd', 3000, 2200],
  ['Banner_双十一.psd', 1920, 600],
]
specs.forEach(([name, w, h]) => {
  fs.writeFileSync(path.join(OUT, name), buildPsd(jpeg, w, h))
})

fs.writeFileSync(path.join(OUT, '客户A', 'Logo制图.psd'), buildPsd(jpeg, 1200, 1200))
fs.writeFileSync(path.join(OUT, '产品渲染', '场景_01.psd'), buildPsd(jpeg, 2000, 1500))

const extras = [
  ['品牌手册.ai', 4_200_000],
  ['画册内页.indd', 9_800_000],
  ['提案.pdf', 2_400_000],
  ['主KV.c4d', 62_000_000],
  ['场景.max', 48_000_000],
  ['产品演示.mp4', 28_000_000],
]
extras.forEach(([name, size]) => {
  const f = path.join(OUT, name)
  const fd = fs.openSync(f, 'w')
  fs.writeSync(fd, Buffer.from('placeholder'))
  fs.ftruncateSync(fd, size)
  fs.closeSync(fd)
})

const all = []
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else all.push([p.replace(OUT + '\\', ''), Math.round(fs.statSync(p).size / 1024)])
  }
}
walk(OUT)
console.log('total files:', all.length)
all.forEach(([n, s]) => console.log(`  ${n}  ${s} KB`))
