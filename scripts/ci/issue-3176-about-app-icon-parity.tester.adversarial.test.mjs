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
const CHROME = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => fs.existsSync(candidate))

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
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
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

function assertIconParity(evidence, width) {
  assert.equal(evidence.bridge.length, 2, `${width}px bridge must render two app icons`)
  assert.equal(evidence.products.length, 2, `${width}px product section must render two app icons`)
  assert.deepEqual(evidence.bridge.map((icon) => icon.src), [
    '/brand/mingla-logo-white-on-orange.png',
    '/brand/mingla-logo-white-on-orange.png',
  ], `${width}px bridge icons must use the same orange app artwork`)
  assert.deepEqual(evidence.products.map((icon) => icon.src), [
    '/brand/mingla-logo-white-on-orange.png',
    '/brand/mingla-logo-white-on-orange.png',
  ], `${width}px product icons must use the same orange app artwork`)
  for (const [group, icons] of [['bridge', evidence.bridge], ['products', evidence.products]]) {
    assert.equal(icons[0].width, icons[1].width, `${width}px ${group} icon widths must match`)
    assert.equal(icons[0].height, icons[1].height, `${width}px ${group} icon heights must match`)
    for (const icon of icons) {
      assert(icon.width >= 56 && icon.height >= 56, `${width}px ${group} app icon is too small`)
      assert.equal(icon.radius, '16px', `${width}px ${group} app icon lost its curved box`)
      assert.equal(icon.objectFit, 'cover', `${width}px ${group} app icon artwork must fill the box`)
    }
  }
  assert.equal(evidence.overflow, 0, `${width}px About page has horizontal overflow`)
}

async function run() {
  assert(CHROME, 'Chrome/Chromium is required for the About app-icon parity test')
  assert(fs.existsSync(path.join(MARKETING, '.next/BUILD_ID')), 'run the current production build before this test')
  const appPort = await freePort()
  const debugPort = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-3176-about-icons-'))
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
    await waitFor(async () => (await fetch(`http://127.0.0.1:${appPort}/about`)).status === 200, 'Next server did not start')
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
    await page.send('Page.navigate', { url: `http://127.0.0.1:${appPort}/about` })
    await waitFor(() => page.evaluate("document.readyState === 'complete' && document.querySelectorAll('.core-platform-graphic .core-app-icon').length === 2"), 'About page did not settle')
    for (const width of [320, 768, 1440]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
      await page.evaluate('(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()')
      const evidence = await page.evaluate(`(()=>{
        const inspect=(icon)=>{const rect=icon.getBoundingClientRect(),style=getComputedStyle(icon);return {src:new URL(icon.src).pathname,width:rect.width,height:rect.height,radius:style.borderRadius,objectFit:style.objectFit}}
        return {
          bridge:[...document.querySelectorAll('.core-platform-graphic .core-app-icon')].map(inspect),
          products:[...document.querySelectorAll('#products .core-app-icon')].map(inspect),
          overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        }
      })()`)
      assertIconParity(evidence, width)
      process.stdout.write(`EVIDENCE #3176 ${width}px About app icons ${JSON.stringify(evidence)}\n`)
    }
  } finally {
    page?.close()
    await stopOwned(chrome)
    await stopOwned(server)
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

if (process.argv.includes('--self-test')) {
  assert.throws(
    () => assertIconParity({
      bridge: [
        { src: '/brand/mingla-logo-white-on-orange.png', width: 56, height: 56, radius: '16px', objectFit: 'cover' },
        { src: '/brand/mingla-business-logo.png', width: 56, height: 56, radius: '0px', objectFit: 'cover' },
      ],
      products: [
        { src: '/brand/mingla-logo-white-on-orange.png', width: 64, height: 64, radius: '16px', objectFit: 'cover' },
        { src: '/brand/mingla-business-logo.png', width: 64, height: 64, radius: '0px', objectFit: 'cover' },
      ],
      overflow: 0,
    }, 1440),
    /same orange app artwork|lost its curved box/,
    'the former unboxed Host mark must prove RED',
  )
  process.stdout.write('RED proof: the former unboxed Host mark was rejected by rendered parity checks\n')
}

await run()
process.stdout.write('PASS #3176 independent About app-icon runtime parity\n')
