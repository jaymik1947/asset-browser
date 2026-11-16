const { chromium } = require('playwright-core')

function log(k, v) {
  console.log(`${k}:`, typeof v === 'object' ? JSON.stringify(v) : v)
}

;(async () => {
  const ver = await (await fetch('http://127.0.0.1:9223/json/version')).json()
  const browser = await chromium.connectOverCDP(ver.webSocketDebuggerUrl)
  const page = browser.contexts().flatMap((c) => c.pages())[0]
  await page.waitForTimeout(2000)

  await page.evaluate(() => localStorage.removeItem('asset-browser.bookmarks.v1'))
  await page.reload()
  await page.waitForTimeout(2500)

  await page.locator('.cell', { hasText: '客户A' }).first().dblclick()
  await page.waitForTimeout(700)
  await page.locator('.nav-btn[title*="收藏"]').click()
  await page.waitForTimeout(400)

  log('bookmark_saved', await page.evaluate(() => ({
    rows: document.querySelectorAll('.tree-row.bm').length,
    label: document.querySelector('.tree-row.bm .tree-label')?.textContent,
  })))

  await page.locator('.crumb').first().click()
  await page.waitForTimeout(700)
  log('back_at_root', await page.evaluate(() => document.querySelectorAll('.cell').length))

  await page.locator('.tree-row.bm').first().click()
  await page.waitForTimeout(800)
  log('bookmark_click', await page.evaluate(() => ({
    crumbs: [...document.querySelectorAll('.crumb')].map((c) => c.textContent),
    cells: document.querySelectorAll('.cell').length,
  })))

  await page.locator('.crumb').first().click()
  await page.waitForTimeout(600)
  await page.locator('.check input').check()
  await page.waitForTimeout(1600)

  log('recursive_rel', await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.cell')]
    const withRel = cells.filter((c) => c.querySelector('.cell-rel'))
    return {
      total: cells.length,
      withRel: withRel.length,
      sample: withRel.slice(0, 4).map((c) => ({
        name: c.querySelector('.cell-name')?.textContent,
        rel: c.querySelector('.cell-rel')?.textContent,
      })),
    }
  }))
  await page.screenshot({ path: 'v3-1-recursive.png' })

  const psdChip = page.locator('.chip', { hasText: 'psd' }).first()
  await psdChip.click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'v3-2-psd.png' })
  log('psd_only', await page.evaluate(() => document.querySelectorAll('.cell').length))

  await page.locator('.chip', { hasText: '全部' }).first().click()
  await page.waitForTimeout(400)

  await page.locator('.check input').uncheck()
  await page.waitForTimeout(900)

  const firstFile = page.locator('.cell', { hasText: '海报主图_竖版.psd' }).first()
  await firstFile.dblclick()
  await page.waitForTimeout(1200)
  log('double_click_ok', await page.evaluate(() => document.querySelectorAll('.cell').length))

  await page.locator('.nav-btn[title*="字号"]').click()
  await page.locator('.nav-btn[title*="字号"]').click()
  await page.waitForTimeout(500)
  log('font_biggest', await page.evaluate(() => ({
    fs: getComputedStyle(document.documentElement).getPropertyValue('--fs').trim(),
    labelH: document.querySelector('.cell-label')?.getBoundingClientRect().height,
    overflow: document.querySelector('.cell-label')?.scrollHeight > document.querySelector('.cell-label')?.clientHeight,
  })))
  await page.screenshot({ path: 'v3-3-font-large.png' })

  await browser.close()
  console.log('DONE')
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
