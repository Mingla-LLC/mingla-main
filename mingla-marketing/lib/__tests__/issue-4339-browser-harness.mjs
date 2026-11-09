// #4339 — a small shared harness for the built-mode browser checks of the
// phase 3 and phase 4a tests: `next start` on a free port, headless Chrome over
// the DevTools protocol (node 22's WebSocket, no install), and helpers to
// evaluate, wait, and stub network requests with the Fetch domain.
//
// Used only when ISSUE_4339_BUILT=1 and Chrome is installed; the tests skip
// otherwise.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((c) => fs.existsSync(c))

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

/**
 * Starts `next start` and Chrome, runs `body(page)`, then stops both.
 * `page` has: origin, send(method, params), evaluate(expr), until(expr, label),
 * on(method, handler), stub(urlPattern, respond) where respond(request) returns
 * { status, body } (JSON-encoded) for every matching request.
 */
export async function withBrowser(marketingDir, body, { env = {} } = {}) {
  const port = await freePort()
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: marketingDir,
    stdio: 'ignore',
    env: { ...process.env, ...env },
  })
  const debug = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-browser-'))
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${debug}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], {
    stdio: 'ignore',
  })
  let socket
  try {
    for (let i = 0; i < 150; i += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/robots.txt`)).ok) break
      } catch {}
      await sleep(200)
    }
    let target
    for (let i = 0; i < 100 && !target; i += 1) {
      try {
        target = (await (await fetch(`http://127.0.0.1:${debug}/json`)).json()).find((t) => t.type === 'page')
      } catch {}
      if (!target) await sleep(100)
    }
    assert.ok(target, 'Chrome did not open a page')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
    let id = 0
    const pending = new Map()
    const listeners = new Map()
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data))
      if (message.id !== undefined) {
        pending.get(message.id)?.(message)
        pending.delete(message.id)
      } else if (message.method) {
        for (const fn of listeners.get(message.method) ?? []) fn(message.params)
      }
    })
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id
        const timer = setTimeout(() => {
          pending.delete(n)
          reject(new Error(`DevTools ${method} did not answer in 60 s`))
        }, 60_000)
        pending.set(n, (message) => {
          clearTimeout(timer)
          resolve(message)
        })
        socket.send(JSON.stringify({ id: n, method, params }))
      })
    const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn])
    const evaluate = async (expression) => {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (res.result?.exceptionDetails) throw new Error(`page threw: ${JSON.stringify(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails)}`)
      return res.result?.result?.value
    }
    const until = async (expression, label, tries = 150) => {
      for (let i = 0; i < tries; i += 1) {
        if (await evaluate(expression)) return
        await sleep(100)
      }
      assert.fail(label)
    }
    const stubs = []
    let fetchEnabled = false
    const stub = async (pattern, respond) => {
      stubs.push({ pattern, respond })
      if (fetchEnabled) {
        await send('Fetch.enable', { patterns: stubs.map((s) => ({ urlPattern: s.pattern })) })
        return
      }
      fetchEnabled = true
      on('Fetch.requestPaused', async (params) => {
        const hit = stubs.find((s) => new RegExp(s.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')).test(params.request.url))
        if (!hit) {
          await send('Fetch.continueRequest', { requestId: params.requestId })
          return
        }
        if (params.request.method === 'OPTIONS') {
          await send('Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Access-Control-Allow-Origin', value: '*' },
              { name: 'Access-Control-Allow-Headers', value: '*' },
              { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
            ],
            body: Buffer.from('ok').toString('base64'),
          })
          return
        }
        const { status, body: payload } = await hit.respond(params.request)
        await send('Fetch.fulfillRequest', {
          requestId: params.requestId,
          responseCode: status,
          responseHeaders: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Access-Control-Allow-Origin', value: '*' },
          ],
          body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        })
      })
      await send('Fetch.enable', { patterns: stubs.map((s) => ({ urlPattern: s.pattern })) })
    }
    await send('Page.enable')
    await body({ origin: `http://127.0.0.1:${port}`, send, evaluate, until, on, stub })
  } finally {
    socket?.close()
    const exited = (child) =>
      new Promise((resolve) => {
        if (child.exitCode !== null) resolve()
        else {
          child.once('exit', resolve)
          setTimeout(resolve, 5000)
        }
      })
    chrome.kill()
    server.kill()
    await Promise.all([exited(chrome), exited(server)])
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

/** A React-hydrated element: React's props key is on it. */
export const hydratedExpr = (selector) =>
  `(()=>{const b=document.querySelector(${JSON.stringify(selector)});return !!b&&Object.keys(b).some(k=>k.startsWith('__reactProps'))})()`

/** Type into an input the way React sees it (native setter + input event). */
export const typeExpr = (selector, value) =>
  `(()=>{const el=document.querySelector(${JSON.stringify(selector)});const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));el.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));return true})()`
