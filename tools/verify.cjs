const { chromium } = require('playwright-core')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

;(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))

  await page.goto('http://localhost:5273/?demo=1', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2200)

  await page.screenshot({ path: 'shot-1-grid.png' })

  const psdCell = page.locator('.cell', { hasText: '海报主图_竖版.psd' }).first()
  await psdCell.click()
  await page.waitForTimeout(350)
  await page.screenshot({ path: 'shot-2-selected.png' })

  await page.keyboard.press(' ')
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'shot-3-preview.png' })

  const previewMeta = await page.locator('.preview-meta').textContent().catch(() => null)
  console.log('PREVIEW_META:', previewMeta)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  const t0 = Date.now()
  await page.locator('.chip', { hasText: 'psd' }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('.cell').length <= 12, null, { timeout: 3000 })
  console.log('FILTER_MS(incl poll):', Date.now() - t0)
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'shot-4-filtered.png' })

  const count = await page.locator('.cell').count()
  console.log('PSD_CELLS(incl folders):', count)

  const filterMs = await page.evaluate(async () => {
    const chip = [...document.querySelectorAll('.chip')].find((e) => e.textContent.includes('全部'))
    const t = performance.now()
    chip.click()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return Math.round(performance.now() - t)
  })
  console.log('FILTER_BACK_TO_ALL_MS:', filterMs)

  const t1 = Date.now()
  await page.locator('.sort-item', { hasText: '大小' }).first().click()
  await page.waitForTimeout(120)
  console.log('SORT_MS:', Date.now() - t1)

  const firstNames = await page.locator('.cell-label').evaluateAll((els) =>
    els.slice(0, 6).map((e) => e.textContent)
  )
  console.log('AFTER_SORT_SIZE:', JSON.stringify(firstNames))

  if (errs.length) console.log('ERRORS:\n' + errs.join('\n'))
  else console.log('NO PAGE ERRORS')

  await browser.close()
})().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
