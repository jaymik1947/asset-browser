const { _electron: electron } = require('playwright-core')

const FOLDER = 'F:\\test-assets'

;(async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.VITE_DEV_SERVER_URL = 'http://localhost:5273/?folder=' + encodeURIComponent(FOLDER)

  const app = await electron.launch({
    args: ['.', '--dev', '--no-sandbox', '--disable-gpu'],
    cwd: process.cwd(),
    env,
    timeout: 60000,
  })

  app.process().stderr.on('data', (d) => {
    const s = d.toString()
    if (s.includes('ERROR') || s.includes('Error')) process.stdout.write('[e] ' + s.slice(0, 200))
  })

  const win = await app.firstWindow({ timeout: 60000 })
  await win.waitForTimeout(3500)

  const stats = await win.evaluate(() => ({
    cells: document.querySelectorAll('.cell').length,
    imgs: document.querySelectorAll('.cell-img').length,
    badges: document.querySelectorAll('.cell-badge').length,
    status: document.querySelector('.statusbar')?.textContent ?? '',
    chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent).join(' '),
  }))
  console.log('STATS:', JSON.stringify(stats, null, 1))

  console.log('--- direct api check ---')
  const apiCheck = await win.evaluate(async (folder) => {
    const list = await window.api.listDir(folder)
    const psd = list.entries.find((e) => e.ext === 'psd')
    const thumb = psd ? await window.api.getThumb(psd.id, 400) : null
    return {
      total: list.entries.length,
      dirs: list.entries.filter((e) => e.kind === 'dir').length,
      firstPsd: psd ? psd.name : null,
      thumbOk: thumb ? thumb.ok : null,
      thumbLen: thumb && thumb.dataUrl ? thumb.dataUrl.length : 0,
      thumbW: thumb ? thumb.w : null,
      thumbH: thumb ? thumb.h : null,
      thumbErr: thumb ? thumb.err : null,
    }
  }, FOLDER)
  console.log('API:', JSON.stringify(apiCheck, null, 1))

  await win.screenshot({ path: 'shot-app-grid.png' })

  const psdCell = win.locator('.cell', { hasText: '海报主图_竖版.psd' }).first()
  await psdCell.click()
  await win.waitForTimeout(400)
  await win.keyboard.press(' ')
  await win.waitForTimeout(900)
  await win.screenshot({ path: 'shot-app-preview.png' })
  const meta = await win.locator('.preview-meta').textContent().catch(() => null)
  console.log('PREVIEW_META:', meta)

  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)

  const t0 = Date.now()
  await win.locator('.chip', { hasText: 'psd' }).first().click()
  await win.waitForTimeout(300)
  const psdCount = await win.locator('.cell').count()
  console.log('FILTER psd -> cells:', psdCount, 'ms:', Date.now() - t0)
  await win.screenshot({ path: 'shot-app-filtered.png' })

  await app.close()
  console.log('DONE')
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
