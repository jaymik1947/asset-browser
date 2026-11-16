const { chromium } = require('playwright-core')

;(async () => {
  const ver = await (await fetch('http://127.0.0.1:9223/json/version')).json()
  const browser = await chromium.connectOverCDP(ver.webSocketDebuggerUrl)
  const page = browser.contexts().flatMap((c) => c.pages())[0]

  const body = await page.evaluate(() => document.body.innerText)
  console.log('BODY:', body.slice(0, 200).replace(/\n/g, ' | '))

  const invokeTest = await page.evaluate(async () => {
    try {
      const r = await window.__TAURI_INTERNALS__.invoke('list_dir', {
        path: 'F:\\test-assets',
        showHidden: false,
      })
      return { ok: true, count: r.entries.length, name: r.name, err: r.error }
    } catch (e) {
      return { ok: false, err: String(e) }
    }
  })
  console.log('INVOKE list_dir:', JSON.stringify(invokeTest))

  const thumbTest = await page.evaluate(async () => {
    try {
      const r = await window.__TAURI_INTERNALS__.invoke('get_thumb', {
        path: 'F:\\test-assets\\海报主图_竖版.psd',
        size: 400,
      })
      return { ok: r.ok, w: r.w, h: r.h, cm: r.colorMode, d: r.depth, len: r.dataUrl ? r.dataUrl.length : 0, err: r.err }
    } catch (e) {
      return { ok: false, err: String(e) }
    }
  })
  console.log('INVOKE get_thumb:', JSON.stringify(thumbTest))

  await page.screenshot({ path: 'shot-tauri-diag.png' })
  await browser.close()
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
