const { chromium } = require('playwright-core')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

;(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))

  await page.goto('http://localhost:5273/', { waitUntil: 'networkidle' })

  const prep = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('素材库', { create: true })
    const inner = await dir.getDirectoryHandle('子文件夹A', { create: true })

    const demo = await import('/src/lib/demo.ts')
    const psd = await demo.buildDemoPsd('封面.psd', 2480, 3508, '#3d5a80', 'COVER')
    const jpg = await demo.buildDemoImage('照片.jpg', 1600, 1200, '#8a5a44')

    async function write(d, name, file) {
      const fh = await d.getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(file)
      await w.close()
    }
    await write(dir, '封面.psd', psd)
    await write(dir, '照片.jpg', jpg)
    await write(inner, '内页.png', jpg)

    window.showDirectoryPicker = async () => dir
    return { ok: true }
  })
  console.log('PREP:', JSON.stringify(prep))

  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    window.showDirectoryPicker = async () => root.getDirectoryHandle('素材库')
  })
  await page.waitForTimeout(400)

  await page.getByText('打开文件夹', { exact: true }).first().click()
  await page.waitForTimeout(1400)

  const state = await page.evaluate(() => ({
    cells: [...document.querySelectorAll('.cell')].map((c) => ({
      label: c.querySelector('.cell-label')?.textContent,
      hasImg: !!c.querySelector('.cell-img'),
      badge: c.querySelector('.cell-badge')?.textContent ?? null,
    })),
    status: document.querySelector('.statusbar')?.textContent ?? '',
    tree: [...document.querySelectorAll('.tree-row .tree-label')].map((e) => e.textContent),
  }))
  console.log('STATE:', JSON.stringify(state, null, 1))

  await page.screenshot({ path: 'shot-real.png' })

  const target = page.locator('.cell', { hasText: '封面.psd' }).first()
  await target.click()
  await page.keyboard.press(' ')
  await page.waitForTimeout(500)
  const meta = await page.locator('.preview-meta').textContent().catch(() => null)
  console.log('PSD_META:', meta)
  await page.screenshot({ path: 'shot-real-preview.png' })

  if (errs.length) console.log('ERRORS:\n' + errs.join('\n'))
  else console.log('NO PAGE ERRORS')

  await browser.close()
})().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
