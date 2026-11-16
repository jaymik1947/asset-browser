const { chromium } = require('playwright-core')

;(async () => {
  const ver = await (await fetch('http://127.0.0.1:9223/json/version')).json()
  const browser = await chromium.connectOverCDP(ver.webSocketDebuggerUrl)
  const contexts = browser.contexts()
  const pages = contexts.flatMap((c) => c.pages())
  if (!pages.length) {
    console.log('NO PAGES')
    process.exit(1)
  }
  const page = pages[0]
  await page.waitForTimeout(1500)

  const info = await page.evaluate(() => ({
    cells: document.querySelectorAll('.cell').length,
    imgs: document.querySelectorAll('.cell-img').length,
    badges: document.querySelectorAll('.cell-badge').length,
    status: document.querySelector('.statusbar')?.textContent ?? '',
    chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent).join(' '),
    isTauri: '__TAURI_INTERNALS__' in window,
  }))
  console.log('TAURI UI:', JSON.stringify(info, null, 1))

  await page.screenshot({ path: 'shot-tauri.png' })

  const psd = page.locator('.cell', { hasText: '海报主图_竖版.psd' }).first()
  await psd.click()
  await page.waitForTimeout(500)
  await page.keyboard.press(' ')
  await page.waitForTimeout(1200)
  const meta = await page.locator('.preview-meta').textContent().catch(() => null)
  console.log('PREVIEW:', meta)
  await page.screenshot({ path: 'shot-tauri-preview.png' })

  await browser.close()
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
