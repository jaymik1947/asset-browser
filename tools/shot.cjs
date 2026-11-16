const { chromium } = require('playwright-core')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL = process.argv[2] || 'http://localhost:5273/?demo=1'
const OUT = process.argv[3] || 'shot-demo.png'

;(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

  const logs = []
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}`))

  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  const stats = await page.evaluate(() => {
    const cells = document.querySelectorAll('.cell').length
    const rows = document.querySelectorAll('.grid-row').length
    const imgs = document.querySelectorAll('.cell-img').length
    const badges = document.querySelectorAll('.cell-badge').length
    const stat = document.querySelector('.statusbar')?.textContent || ''
    return { cells, rows, imgs, badges, stat, body: document.body.innerText.slice(0, 200) }
  })

  console.log('STATS', JSON.stringify(stats))
  if (logs.length) console.log('LOGS\n' + logs.join('\n'))

  await page.screenshot({ path: OUT, fullPage: false })
  await browser.close()
})().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
