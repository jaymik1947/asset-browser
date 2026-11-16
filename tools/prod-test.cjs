const { _electron: electron } = require('playwright-core')

const FOLDER = process.argv[2] || 'F:\\test-assets'
const OUT = process.argv[3] || 'shot-prod.png'

;(async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL

  const app = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-gpu', `--folder=${FOLDER}`],
    cwd: process.cwd(),
    env,
    timeout: 60000,
  })

  const t0 = Date.now()
  const win = await app.firstWindow({ timeout: 60000 })
  await win.waitForTimeout(2500)

  const info = await win.evaluate(() => ({
    cells: document.querySelectorAll('.cell').length,
    imgs: document.querySelectorAll('.cell-img').length,
    hasApi: !!window.api,
    isNative: !!document.querySelector('.statusbar'),
    status: document.querySelector('.statusbar')?.textContent ?? '',
    broken: document.querySelectorAll('img').length,
  }))

  console.log('PROD:', JSON.stringify(info))
  console.log('LOAD_MS:', Date.now() - t0)
  await win.screenshot({ path: OUT })
  await app.close()
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
