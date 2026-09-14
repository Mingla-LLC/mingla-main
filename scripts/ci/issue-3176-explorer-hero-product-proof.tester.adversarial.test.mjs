#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MARKETING = path.join(ROOT, 'mingla-marketing')
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const CHROME = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => fs.existsSync(candidate))

function sourceContract(overrides = {}) {
  const source = (relative) => overrides[relative] ?? read(relative)
  const explorer = source('mingla-marketing/app/(core)/explorer/page.tsx')
  const packageJson = JSON.parse(source('mingla-marketing/package.json'))

  assert.equal((explorer.match(/className="core-explorer-hero-proof"/g) ?? []).length, 1, 'Explorer hero must render exactly one product-proof frame')
  assert.equal((explorer.match(/explorer-saved-details\.png/g) ?? []).length, 1, 'Explorer hero must render one approved saved-details capture')
  assert.match(packageJson.scripts.prebuild, /issue-3176-explorer-hero-product-proof\.tester\.adversarial\.test\.mjs --source-only/, 'the independent Explorer hero guard must run before production builds')
  assert.match(packageJson.scripts.build, /issue-3176-explorer-hero-product-proof\.tester\.adversarial\.test\.mjs --built-only/, 'the independent Explorer hero runtime guard must run against the production build')
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function waitFor(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error(`${label}${lastError ? `: ${lastError.message}` : ''}`)
}

class CdpPage {
  constructor(webSocketUrl) {
    this.id = 0
    this.pending = new Map()
    this.socket = new WebSocket(webSocketUrl)
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data))
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
    })
  }

  async send(method, params = {}) {
    await this.ready
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 25_000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text)
    return result.result.value
  }

  close() {
    this.socket.close()
  }
}

async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ])
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))
  }
}

function assertHero(evidence, width) {
  assert.equal(evidence.count, 1, `${width}px Explorer hero must render one product proof`)
  assert.equal(evidence.src, '/product-proof/explorer-saved-details.png', `${width}px Explorer hero must use the approved real capture`)
  assert.equal(evidence.alt, 'Mingla Explorer showing the saved Sample sunset gallery plan open in its details sheet.', `${width}px Explorer hero must retain the approved alt text`)
  assert(evidence.width > 0 && evidence.height > 0, `${width}px Explorer proof must remain visible`)
  assert(Math.abs(evidence.width / evidence.height - 1206 / 2050) < 0.02, `${width}px Explorer proof must retain its intentional crop ratio`)
  assert(['28px', '32px'].includes(evidence.radius), `${width}px Explorer proof lost its rounded card treatment`)
  assert.equal(evidence.objectFit, 'cover', `${width}px Explorer proof must fill its frame`)
  assert.equal(evidence.objectPosition, '50% 0%', `${width}px Explorer proof must keep the useful product state in view`)
  assert.equal(evidence.overflow, 0, `${width}px Explorer page has horizontal overflow`)
  assert(evidence.left >= 0 && evidence.right <= width + 1, `${width}px Explorer proof escapes the viewport`)
}

async function runtimeContract() {
  assert(CHROME, 'Chrome/Chromium is required for the Explorer hero runtime guard')
  assert(fs.existsSync(path.join(MARKETING, '.next/BUILD_ID')), 'run the current production build before this test')
  const appPort = await freePort()
  const debugPort = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-3176-explorer-hero-'))
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(appPort)], {
    cwd: MARKETING,
    env: { ...process.env, MINGLA_HISTORICAL_2983_BUILD: '' },
    stdio: 'ignore',
  })
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' })
  let page
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${appPort}/explorer`)).status === 200, 'Next server did not start')
    let target
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`)
      const targets = await response.json()
      target = targets.find((candidate) => candidate.type === 'page')
      return Boolean(target?.webSocketDebuggerUrl)
    }, 'Chrome debugger did not start')
    page = new CdpPage(target.webSocketDebuggerUrl)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.navigate', { url: `http://127.0.0.1:${appPort}/explorer` })
    await waitFor(() => page.evaluate("document.readyState === 'complete' && document.querySelectorAll('.core-explorer-hero-proof img').length === 1"), 'Explorer hero did not settle')
    for (const width of [320, 390, 768, 1440]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
      await page.evaluate('(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()')
      const evidence = await page.evaluate(`(()=>{
        const frame=document.querySelector('.core-explorer-hero-proof'),image=frame.querySelector('img'),rect=frame.getBoundingClientRect(),style=getComputedStyle(frame),imageStyle=getComputedStyle(image),imageUrl=new URL(image.currentSrc||image.src),src=imageUrl.pathname==='/_next/image'?imageUrl.searchParams.get('url'):imageUrl.pathname
        return {count:document.querySelectorAll('.core-explorer-hero-proof').length,src,alt:image.alt,width:rect.width,height:rect.height,left:rect.left,right:rect.right,radius:style.borderRadius,objectFit:imageStyle.objectFit,objectPosition:imageStyle.objectPosition,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}
      })()`)
      assertHero(evidence, width)
      process.stdout.write(`EVIDENCE #3176 ${width}px Explorer hero ${JSON.stringify(evidence)}\n`)
    }
  } finally {
    page?.close()
    await stopOwned(chrome)
    await stopOwned(server)
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

if (!BUILT_ONLY) sourceContract()

if (process.argv.includes('--self-test')) {
  const relative = 'mingla-marketing/app/(core)/explorer/page.tsx'
  const reverted = read(relative).replace('className="core-explorer-hero-proof"', 'className="core-proof-mark"')
  assert.throws(() => sourceContract({ [relative]: reverted }), /exactly one product-proof frame/, 'removing the rounded proof owner must prove RED')
  assert.throws(() => assertHero({ count: 1, src: '/brand/mingla-logo-white-on-orange.png', alt: 'Mingla Explorer app icon', width: 330, height: 330, left: 100, right: 430, radius: '0px', objectFit: 'fill', objectPosition: '50% 50%', overflow: 0 }, 1440), /approved real capture|intentional crop ratio|rounded card treatment/, 'the former flat logo tile must prove RED at runtime')
  process.stdout.write('RED proof: the former flat logo tile failed the independent runtime contract\n')
}

if (!SOURCE_ONLY) await runtimeContract()
process.stdout.write('PASS #3176 independent Explorer hero product-proof runtime\n')
