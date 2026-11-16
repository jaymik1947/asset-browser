const { chromium } = require('playwright-core')
const log = (k, v) => console.log(`${k}:`, typeof v === 'object' ? JSON.stringify(v) : v)

;(async () => {
  const ver = await (await fetch('http://127.0.0.1:9223/json/version')).json()
  const browser = await chromium.connectOverCDP(ver.webSocketDebuggerUrl)
  const page = browser.contexts().flatMap((c) => c.pages())[0]
  await page.waitForTimeout(2500)

  log('0_landing', await page.evaluate(() => ({
    hasHome: !!document.querySelector('.home'),
    homeCards: document.querySelectorAll('.home-card').length,
    cells: document.querySelectorAll('.cell').length,
    emptyState: !!document.querySelector('.empty'),
  })))
  await page.screenshot({ path: 'p-0-home.png' })

  const t0 = Date.now()
  await page.locator('.check input').check()
  await page.waitForFunction(() => document.querySelectorAll('.cell').length > 30, null, { timeout: 60000 })
  log('1_recursive_load_ms', Date.now() - t0)

  await page.waitForTimeout(1200)
  log('2_loaded', await page.evaluate(() => ({
    cells: document.querySelectorAll('.cell').length,
    status: document.querySelector('.statusbar')?.textContent?.slice(0, 50),
  })))
  await page.screenshot({ path: 'p-1-recursive-7000.png' })

  const perf1 = await page.evaluate(async () => {
    const el = document.querySelector('.grid-scroll')
    el.scrollTop = 0
    await new Promise((r) => setTimeout(r, 300))
    let frames = 0, running = true
    const loop = () => { if (running) { frames++; requestAnimationFrame(loop) } }
    requestAnimationFrame(loop)
    const t0 = performance.now()
    for (let i = 0; i < 90; i++) {
      el.scrollTop += 140
      await new Promise((r) => setTimeout(r, 16))
    }
    running = false
    const dt = performance.now() - t0
    return { fps: Math.round(frames / (dt / 1000)), frames, ms: Math.round(dt), scrolledTo: Math.round(el.scrollTop), rendered: document.querySelectorAll('.cell').length }
  })
  log('3_scroll_perf', perf1)

  const perf2 = await page.evaluate(async () => {
    const el = document.querySelector('.grid-scroll')
    let frames = 0, running = true
    const loop = () => { if (running) { frames++; requestAnimationFrame(loop) } }
    requestAnimationFrame(loop)
    const t0 = performance.now()
    for (let i = 0; i < 120; i++) {
      el.scrollTop += 240
      await new Promise((r) => setTimeout(r, 8))
    }
    running = false
    const dt = performance.now() - t0
    return { fps: Math.round(frames / (dt / 1000)), frames, ms: Math.round(dt) }
  })
  log('4_fast_scroll_perf', perf2)

  await page.waitForTimeout(800)
  await page.screenshot({ path: 'p-2-scrolled.png' })

  await page.evaluate(() => { document.querySelector('.grid-scroll').scrollTop = 0 })
  await page.waitForTimeout(500)

  const cell = page.locator('.cell').nth(2)
  const box = await cell.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + 40, { button: 'right' })
  await page.waitForTimeout(400)
  log('5_context_menu', await page.evaluate(() => ({
    visible: !!document.querySelector('.ctx-menu'),
    items: [...document.querySelectorAll('.ctx-item')].map((b) => b.textContent),
  })))
  await page.screenshot({ path: 'p-3-contextmenu.png' })

  await page.keyboard.press('Escape')
  await browser.close()
  console.log('DONE')
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
