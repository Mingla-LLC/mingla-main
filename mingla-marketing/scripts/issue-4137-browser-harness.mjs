import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean)

export const CHROME = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate))

export async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  return port
}

export async function waitFor(check, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await check()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`)
}

function requestStatus(port, pathname = '/') {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: pathname }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? 0))
    })
    request.once('error', reject)
  })
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  const done = await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 2500))])
  if (!done && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await exited
  }
}

class CdpPage {
  constructor(url) {
    this.id = 1
    this.pending = new Map()
    this.listeners = new Map()
    this.socket = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
        return
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params)
    })
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? []
    listeners.push(listener)
    this.listeners.set(method, listeners)
  }

  async send(method, params = {}) {
    await this.ready
    const id = this.id++
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.socket.send(JSON.stringify({ id, method, params }))
    return result
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'browser evaluation failed')
    return result.result.value
  }

  close() { this.socket.close() }
}

async function launchPage(debugPort) {
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json())
  const page = new CdpPage(target.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Network.enable')
  return page
}

async function waitForChrome(debugPort, chrome, output) {
  await waitFor(async () => {
    if (chrome.exitCode !== null || chrome.signalCode !== null) throw new Error(`Chrome exited (${chrome.exitCode ?? chrome.signalCode})\n${output()}`)
    return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok
  }, 'Chrome CDP did not start')
}

export async function open(page, baseUrl, pathname, {
  width = 1440,
  height = 900,
  userAgent,
  platform,
  touchPoints = 0,
  reducedMotion = false,
  scriptDisabled = false,
  waitForPlatform = true,
} = {}) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 })
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: touchPoints > 0, maxTouchPoints: touchPoints || 1 })
  await page.send('Emulation.setScriptExecutionDisabled', { value: scriptDisabled })
  await page.send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }],
  })
  if (userAgent) await page.send('Network.setUserAgentOverride', { userAgent, ...(platform ? { platform } : {}) })
  await page.send('Page.navigate', { url: `${baseUrl}${pathname}` })
  await waitFor(() => page.evaluate("document.readyState === 'complete'"), `${pathname} did not finish loading`)
  if (!scriptDisabled && waitForPlatform) await waitFor(() => page.evaluate("document.documentElement.hasAttribute('data-platform')"), `${pathname} did not hydrate`)
  return page
}

export async function press(page, key, modifiers = 0) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Tab' ? 9 : key === 'Enter' ? 13 : key === 'Escape' ? 27 : 0, modifiers })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Tab' ? 9 : key === 'Enter' ? 13 : key === 'Escape' ? 27 : 0, modifiers })
}

export async function withNextBrowser(root, callback, { env = {} } = {}) {
  if (!CHROME) throw new Error(`Chrome executable not found; checked ${CHROME_CANDIDATES.join(', ')}`)
  if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) throw new Error('run next build before the #4137 browser testers')
  const serverPort = await freePort()
  const debugPort = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-4137-browser-'))
  let serverOutput = ''
  let chromeOutput = ''
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(serverPort)], {
    cwd: root,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (chunk) => { serverOutput += String(chunk) })
  server.stderr.on('data', (chunk) => { serverOutput += String(chunk) })
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-extensions', 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  chrome.stdout.on('data', (chunk) => { chromeOutput += String(chunk) })
  chrome.stderr.on('data', (chunk) => { chromeOutput += String(chunk) })
  let page
  try {
    await waitFor(async () => (await requestStatus(serverPort, '/robots.txt')) === 200, `Next server did not start\n${serverOutput}`)
    await waitForChrome(debugPort, chrome, () => chromeOutput)
    page = await launchPage(debugPort)
    const consoleErrors = []
    page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => consoleErrors.push(exceptionDetails.exception?.description ?? exceptionDetails.text))
    page.on('Log.entryAdded', ({ entry }) => { if (entry.level === 'error') consoleErrors.push(entry.text) })
    await page.send('Log.enable')
    await callback({ page, baseUrl: `http://127.0.0.1:${serverPort}`, consoleErrors })
  } finally {
    page?.close()
    await stop(chrome)
    await stop(server)
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
}
