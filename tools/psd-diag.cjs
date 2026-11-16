const fs = require('fs')

const COLOR_MODES = { 0:'Bitmap',1:'Grayscale',2:'Indexed',3:'RGB',4:'CMYK',7:'Multichannel',8:'Duotone',9:'Lab' }
const COMPRESSION = { 0:'raw', 1:'RLE(PackBits)', 2:'ZIP', 3:'ZIP+prediction' }
const KNOWN = {
  1005:'ResolutionInfo', 1024:'IPTC', 1032:'GridGuides', 1033:'Thumbnail(PS4,raw)',
  1036:'Thumbnail(PS5+,JPEG)', 1037:'GlobalAngle', 1039:'ICCProfile', 1041:'ICCUntagged',
  1044:'IDsSeed', 1045:'UnicodeAlpha', 1049:'GlobalAltitude', 1050:'Slices',
  1054:'LayerComps', 1057:'VersionInfo', 1060:'EXIF1', 1061:'EXIF3', 1062:'XMP',
  1064:'PrintScale', 1082:'PrintInfo', 1083:'PrintFlags'
}

function readAt(fd, len, pos) {
  const b = Buffer.alloc(len)
  const n = fs.readSync(fd, b, 0, len, pos)
  return n === len ? b : b.subarray(0, n)
}

function diag(file) {
  const st = fs.statSync(file)
  const fd = fs.openSync(file, 'r')
  try {
    const head = readAt(fd, 26, 0)
    const sig = head.readUInt32BE(0)
    if (sig !== 0x38425053) return { file, error: 'not PSD (sig=' + sig.toString(16) + ')' }
    const version = head.readUInt16BE(4)
    const channels = head.readUInt16BE(12)
    const height = head.readUInt32BE(14)
    const width = head.readUInt32BE(18)
    const depth = head.readUInt16BE(22)
    const colorMode = head.readUInt16BE(24)

    const cmLen = readAt(fd, 4, 26).readUInt32BE(0)
    let off = 30 + cmLen
    const irLen = readAt(fd, 4, off).readUInt32BE(0)
    off += 4

    const readLen = Math.min(irLen, 16 * 1024 * 1024)
    const ir = readAt(fd, readLen, off)

    const blocks = []
    let p = 0
    while (p + 12 <= ir.length) {
      if (ir.readUInt32BE(p) !== 0x3842494d) break
      const id = ir.readUInt16BE(p + 4)
      const nameLen = ir.readUInt8(p + 6)
      let nameTotal = 1 + nameLen
      if (nameTotal % 2) nameTotal++
      const sizePos = p + 6 + nameTotal
      if (sizePos + 4 > ir.length) break
      const size = ir.readUInt32BE(sizePos)
      blocks.push({ id, name: KNOWN[id] || '', size })
      p = sizePos + 4 + size + (size % 2)
    }

    let pos = off + irLen
    let layerLen = -1, compression = -1, hasImageData = false
    try {
      layerLen = readAt(fd, 4, pos).readUInt32BE(0)
      pos += 4 + layerLen
      if (pos + 2 <= st.size) {
        compression = readAt(fd, 2, pos).readUInt16BE(0)
        hasImageData = true
      }
    } catch (e) { /* ignore */ }

    return {
      file: file.split(/[\\/]/).pop(),
      sizeMB: +(st.size / 1048576).toFixed(1),
      version,
      width, height, depth,
      colorMode: COLOR_MODES[colorMode] || colorMode,
      channels,
      cmLen,
      irLen,
      blockCount: blocks.length,
      has1036: blocks.some(b => b.id === 1036),
      has1033: blocks.some(b => b.id === 1033),
      hasComposite: compression >= 0,
      compression: COMPRESSION[compression] || compression,
      compositeOffset: pos,
      blocks: blocks.map(b => `#${b.id}${b.name ? ' ' + b.name : ''} (${b.size}B)`)
    }
  } finally { fs.closeSync(fd) }
}

const files = process.argv.slice(2)
for (const f of files) {
  console.log('='.repeat(78))
  try { console.log(JSON.stringify(diag(f), null, 1)) }
  catch (e) { console.log('ERROR', f, e.message) }
}
