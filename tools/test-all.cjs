const { chromium } = require('playwright-core')

function log(k, v) {
  console.log(`${k}:`, typeof v === 'object' ? JSON.stringify(v) : v)
}

;(async () => {
  const ver = await (await fetch('http://127.0.0.1:9223/json/version')).json()
  const browser = await chromium.connectOverCDP(ver.webSocketDebuggerUrl)
  const page = browser.contexts().flatMap((c) => c.pages())[0]
  await page.waitForTimeout(2000)

  log('1_initial', await page.evaluate(() => ({
    cells: document.querySelectorAll('.cell').length,
    crumbs: [...document.querySelectorAll('.crumb')].map((c) => c.textContent),
    recursiveChecked: document.querySelector('.check input')?.checked,
    fontScale: getComputedStyle(document.documentElement).getPropertyValue('--fs').trim(),
  })))

  await page.locator('.cell', { hasText: '客户A' }).first().dblclick()
  await page.waitForTimeout(600)
  await page.locator('.cell', { hasText: '2024' }).first().dblclick()
  await page.waitForTimeout(800)
  log('2_after_nav', await page.evaluate(() => ({
    crumbs: [...document.querySelectorAll('.crumb')].map((c) => c.textContent),
    cells: document.querySelectorAll('.cell').length,
  })))

  await page.screenshot({ path: 'v2-1-nested.png' })

  const crumb0 = page.locator('.crumb').first()
  await crumb0.click()
  await page.waitForTimeout(800)
  log('3_crumb_jump', await page.evaluate(() => ({
    crumbs: [...document.querySelectorAll('.crumb')].map((c) => c.textContent),
    cells: document.querySelectorAll('.cell').length,
  })))

  await page.locator('.cell', { hasText: '客户A' }).first().dblclick()
  await page.waitForTimeout(500)
  await page.locator('.cell', { hasText: '2024' }).first().dblclick()
  await page.waitForTimeout(700)

  const fwdDisabled = await page.locator('.nav-btn').nth(2).isDisabled()
  log('4_forward_disabled_after_new_nav', fwdDisabled)

  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mousedown', { button: 3, bubbles: true }))
  })
  await page.waitForTimeout(700)
  log('5_after_mouse_back', await page.evaluate(() => ({
    crumbs: [...document.querySelectorAll('.crumb')].map((c) => c.textContent),
  })))

  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mousedown', { button: 4, bubbles: true }))
  })
  await page.waitForTimeout(700)
  log('6_after_mouse_forward', await page.evaluate(() => ({
    crumbs: [...document.querySelectorAll('.crumb')].map((c) => c.textContent),
  })))

  await page.locator('.crumb').first().click()
  await page.waitForTimeout(600)

  await page.locator('.check input').check()
  await page.waitForTimeout(1500)
  log('7_recursive', await page.evaluate(() => ({
    cells: document.querySelectorAll('.cell').length,
    withRel: document.querySelectorAll('.cell-rel').length,
    status: document.querySelector('.statusbar')?.textContent?.slice(0, 60),
    chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent).join(' '),
  })))
  await page.screenshot({ path: 'v2-2-recursive.png' })

  const psdChip = page.locator('.chip', { hasText: 'psd' }).first()
  const hasPsdChip = await psdChip.count()
  if (hasPsdChip) {
    await psdChip.click()
    await page.waitForTimeout(600)
    log('8_recursive_psd_filter', await page.evaluate(() => ({
      cells: document.querySelectorAll('.cell').length,
      rels: [...document.querySelectorAll('.cell-rel')].slice(0, 5).map((e) => e.textContent),
    })))
    await page.screenshot({ path: 'v2-3-recursive-psd.png' })
    await page.locator('.chip', { hasText: '全部' }).first().click()
    await page.waitForTimeout(400)
  }

  await page.locator('.nav-btn[title*="字号"]').click()
  await page.waitForTimeout(400)
  log('9_font', await page.evaluate(() => ({
    fs: getComputedStyle(document.documentElement).getPropertyValue('--fs').trim(),
    stored: localStorage.getItem('asset-browser.fontScale'),
    cellLabelSize: getComputedStyle(document.querySelector('.cell-label') || document.body).fontSize,
  })))

  await page.locator('.nav-btn[title*="收藏"]').click()
  await page.waitForTimeout(500)
  log('10_bookmark', await page.evaluate(() => ({
    bmRows: document.querySelectorAll('.tree-row.bm').length,
    bmLabel: document.querySelector('.tree-row.bm .tree-label')?.textContent,
    stored: localStorage.getItem('asset-browser.bookmarks.v1'),
  })))
  await page.screenshot({ path: 'v2-4-font-bookmark.png' })

  log('11_final_size', await page.evaluate(() => {
    const t = document.querySelector('.toolbar')
    const last = document.querySelector('.ghost-btn')
    return {
      toolbarScroll: t.scrollWidth,
      toolbarClient: t.clientWidth,
      ghostRight: last.getBoundingClientRect().right,
      winInner: window.innerWidth,
    }
  }))

  await browser.close()
  console.log('DONE')
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
