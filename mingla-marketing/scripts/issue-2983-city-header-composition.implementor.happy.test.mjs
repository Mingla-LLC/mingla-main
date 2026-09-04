#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const SELF = path.basename(fileURLToPath(import.meta.url))
const HOST_TEST = 'scripts/issue-2983-host-trip-bento-overlap.tester.adversarial.test.mjs'
const SELECTOR = ".page-system-root.city-hub-root[data-host-acquisition='true'] .ps-nav"
const SHELL_SELECTOR = '.city-hub-root > [data-cutout] > .cut-shell'
const WIDTHS = [320, 390, 639, 640, 760, 767, 768, 1024, 1440]
const SLUGS = ['lagos', 'durham-nc', 'cary-nc', 'raleigh-nc', 'new-york-city', 'brussels', 'paris', 'london', 'fort-lauderdale', 'washington-dc']
const CHROME = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find((candidate) => fs.existsSync(candidate))
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function sourceContract() {
  const css = read('components/cities/city-hubs.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const nav = css.slice(css.indexOf(SELECTOR)).match(/\{([^}]+)\}/)?.[1] ?? ''
  assert.match(nav, /position:\s*absolute\s*;/, 'public-city navigation must scroll away naturally')
  assert.match(nav, /inset:\s*auto 0 auto\s*;/, 'navigation must keep its original viewport-aligned inline insets')
  assert.match(nav, /top:\s*calc\(var\(--city-host-bar-height\) \+ 12px\)\s*;/)
  assert.match(nav, /z-index:\s*80\s*;/)
  assert.match(nav, /padding:\s*0 20px\s*;/)
  assert.match(css, /\.city-hub-root\s*\{[^}]*position:\s*relative\s*;/, 'the city root must own navigation positioning')
  assert.match(css, /\.city-hub-root > \[data-cutout\] > \.cut-shell\s*\{\s*position:\s*static\s*;\s*\}/, 'only the direct city shell must release positioning ownership')
  assert.doesNotMatch(css, /--city-shell-inset/, 'rejected shell compensation must not return')
  assert.doesNotMatch(nav, /margin|transform|translate/, 'no offset workaround may replace correct positioning ownership')

  const scripts = JSON.parse(read('package.json')).scripts
  assert(scripts.build.includes(`node --experimental-websocket ${HOST_TEST} --built-only`), 'build must enable Node20 WebSocket only on the Host tester command')
  assert(scripts['test:host-trip-bento'].includes(`node --experimental-websocket ${HOST_TEST}`), 'named Host test must use the same compatible Node invocation')
  assert(scripts.build.includes(`node --experimental-websocket scripts/${SELF} --source-only`), 'source guard must execute in the marketing build lane')
  assert(scripts.build.includes(`node --experimental-websocket scripts/${SELF} --built-only`), 'built/browser guard must execute in the marketing build lane')
  assert(scripts.build.includes('node scripts/issue-2990-audience-navigation.implementor.happy.test.mjs && next build'), 'existing audience guard/build adjacency must remain intact')
  assert(!scripts.build.includes('NODE_OPTIONS'), 'WebSocket compatibility must not change every Node invocation')
  console.log('PASS #2983 city header source: root-owned scrolling nav and command-scoped Node20 compatibility')
}

function artifactContract() {
  assert(fs.existsSync(path.join(ROOT, '.next/BUILD_ID')), 'build the production artifact first')
  for (const slug of SLUGS) {
    const html = read(`.next/server/app/cities/${slug}.html`)
    assert.match(html, /name="robots" content="noindex, follow"/, `${slug}: release must remain noindex`)
    assert.match(html, /class="ps-nav"/, `${slug}: original navigation must remain server-rendered`)
    assert.match(html, /class="city-hero"/, `${slug}: original hero must remain server-rendered`)
    assert.doesNotMatch(html, /rel="canonical"/, `${slug}: noindex review must not gain a canonical`)
  }
  const cssDirectory = path.join(ROOT, '.next/static/css')
  const builtCss = fs.readdirSync(cssDirectory).filter((name) => name.endsWith('.css'))
    .map((name) => fs.readFileSync(path.join(cssDirectory, name), 'utf8')).join('\n')
  const nav = builtCss.match(/\.page-system-root\.city-hub-root\[data-host-acquisition=(?:"true"|'true'|true)\] \.ps-nav\{([^}]+)\}/)?.[1] ?? ''
  assert.match(nav, /position:absolute(?:;|$)/, 'compiled city CSS must contain the scrolling navigation fix')
  assert.match(builtCss, /\.city-hub-root\{[^}]*position:relative(?:;|})/, 'compiled CSS must retain the root positioning owner')
  assert.match(builtCss, /\.city-hub-root\s*>\s*\[data-cutout\]\s*>\s*\.cut-shell\{position:static(?:;|})/, 'compiled CSS must release the direct shell positioning owner')
  console.log(`PASS #2983 city header artifact: ten SSR/noindex pages and compiled root-owned navigation (${process.version})`)
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitFor(check, label) {
  const deadline = Date.now() + 30_000
  let lastError
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) { lastError = error }
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  throw new Error(`${label}${lastError ? `: ${lastError.message}` : ''}`)
}

class Page {
  constructor(url) {
    this.id = 0
    this.pending = new Map()
    this.socket = new WebSocket(url)
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
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
  }

  async send(method, params = {}) {
    await this.ready
    const id = ++this.id
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Chrome timed out: ${method}`))
      }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
    })
    this.socket.send(JSON.stringify({ id, method, params }))
    return result
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text)
    return result.result.value
  }

  close() { this.socket.close() }
}

const settle = `(async () => {
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
})()`

const geometry = `(() => {
  const rect = selector => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x:r.x, y:r.y, width:r.width, height:r.height };
  };
  return {
    nav:rect('.ps-nav'), logo:rect('.ps-logo-link'), menu:rect('.ps-menu-button'), hero:rect('.city-hero'),
    root:rect('.city-hub-root'), wrapper:rect('.city-hub-root > [data-cutout]'), shell:rect('.city-hub-root > [data-cutout] > .cut-shell'),
    notice:rect('.city-lifecycle-notice'), main:rect('main'), catalogue:rect('.ps-catalogue'), footer:rect('footer'),
    overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
    position:getComputedStyle(document.querySelector('.ps-nav')).position,
  };
})()`

function sameGeometry(actual, before, label) {
  for (const part of ['nav', 'logo', 'menu', 'hero', 'root', 'wrapper', 'shell', 'notice', 'main', 'catalogue', 'footer']) {
    if (actual[part] === null || before[part] === null) {
      assert.equal(actual[part], before[part], `${label}: ${part} visibility changed`)
      continue
    }
    for (const property of ['x', 'y', 'width', 'height']) {
      assert(Math.abs(actual[part][property] - before[part][property]) <= 1,
        `${label}: ${part}.${property} shifted from ${before[part][property]} to ${actual[part][property]}`)
    }
  }
  assert.equal(actual.overflow, 0, `${label}: horizontal overflow`)
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 2_000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

async function browserContract() {
  if (process.env.VERCEL === '1') {
    console.log('SKIP #2983 city header browser on Chrome-less Vercel; source/artifact proof runs, GitHub/local browser proof remains mandatory')
    return
  }
  assert(CHROME, 'Chrome is required for local/GitHub city header runtime proof; no silent browser skip')
  assert.equal(typeof WebSocket, 'function', 'invoke this browser guard with node --experimental-websocket on Node20')
  const serverPort = await availablePort()
  const chromePort = await availablePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-2983-city-header-happy-'))
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(serverPort)], { cwd: ROOT, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  server.stdout.on('data', (chunk) => { output += chunk })
  server.stderr.on('data', (chunk) => { output += chunk })
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${chromePort}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', 'about:blank'], { stdio: 'ignore' })
  let page
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${serverPort}/robots.txt`)).ok, 'Next did not start')
    await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).ok, 'Chrome did not start')
    const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())
    page = new Page(target.webSocketDebuggerUrl)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })

    let comparisons = 0
    for (const slug of SLUGS) {
      for (const width of WIDTHS) {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false })
        await page.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/cities/${slug}` })
        await waitFor(() => page.evaluate(`location.pathname === '/cities/${slug}' && document.readyState === 'complete' && Boolean(document.querySelector('.city-hero'))`), `${slug}/${width}: page not ready`)
        await page.evaluate('scrollTo(0,0)')
        await page.evaluate(settle)
        const actual = await page.evaluate(geometry)
        assert.equal(actual.position, 'absolute', `${slug}/${width}: nav must scroll away`)
        // Replay all three original positioning rules, not only fixed nav.
        // The shell's collapsed notice margin must remain in the comparison:
        // stopping its collapse changes framing even when the header looks right.
        await page.evaluate(`(() => {
          const style=document.createElement('style'); style.id='header-baseline';
          style.textContent=${JSON.stringify(`.city-hub-root { position:static; } ${SHELL_SELECTOR} { position:relative; } ${SELECTOR} { position:fixed; inset:auto 0 auto; top:calc(var(--city-host-bar-height) + 12px); z-index:80; padding:0 20px; }`)};
          document.head.append(style);
        })()`)
        await page.evaluate(settle)
        const before = await page.evaluate(geometry)
        assert.equal(before.position, 'fixed', 'the old-rule comparison must actually revert positioning')
        sameGeometry(actual, before, `${slug}/${width}`)
        await page.evaluate("document.querySelector('#header-baseline').remove()")
        await page.evaluate(settle)
        sameGeometry(await page.evaluate(geometry), before, `${slug}/${width}/restore`)
        if (slug === 'lagos' && width === 320) {
          await page.evaluate(`(() => {
            const style=document.createElement('style'); style.id='header-owner-revert';
            style.textContent=${JSON.stringify(`.city-hub-root { position:static; } ${SHELL_SELECTOR} { position:relative; }`)};
            document.head.append(style);
          })()`)
          await page.evaluate(settle)
          const revertedOwner = await page.evaluate(geometry)
          assert.throws(() => sameGeometry(revertedOwner, before, 'reverted owner'),
            /shifted/, 'the initial-layout oracle must reject the original shell owner with absolute nav')
          await page.evaluate("document.querySelector('#header-owner-revert').remove()")
          await page.evaluate(settle)
          sameGeometry(await page.evaluate(geometry), before, 'restored owner')
          console.log(`PASS #2983 owner-revert geometry rejected nav ${JSON.stringify(revertedOwner.nav)}; restored to ${JSON.stringify(before.nav)}`)
        }
        comparisons++
      }
    }
    console.log(`PASS #2983 city header initial before/after geometry ${comparisons}/${SLUGS.length * WIDTHS.length}; header, framing, notice, content and footer within 1px`)

    for (const route of ['/cities/lagos', '/internal/page-system/city-lagos']) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
      await page.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}${route}?type=places` })
      await waitFor(() => page.evaluate(`location.pathname === '${route}' && document.readyState === 'complete' && document.querySelectorAll('.ps-catalogue-card').length === 50`), `${route}: catalogue missing`)
      await page.evaluate(settle)
      await page.evaluate(`(() => {
        const controls=document.querySelector('.ps-catalogue-controls');
        scrollTo(0, scrollY + controls.getBoundingClientRect().top + 80);
      })()`)
      await page.evaluate(settle)
      const sticky = await page.evaluate(`(() => {
        const bar=document.querySelector('.ps-host-acquisition').getBoundingClientRect();
        const controls=document.querySelector('.ps-catalogue-controls').getBoundingClientRect();
        return {top:controls.top, barBottom:bar.bottom, navBottom:document.querySelector('.ps-nav').getBoundingClientRect().bottom};
      })()`)
      assert(Math.abs(sticky.top - sticky.barBottom) <= 1, `${route}: filters must meet the actual Host-bar bottom`)
      assert(sticky.navBottom < 0, `${route}: navigation must leave the viewport before filters stick`)
      console.log(`PASS #2983 ${route} scrolled composition ${JSON.stringify(sticky)}`)
    }
  } catch (error) {
    process.stderr.write(output)
    throw error
  } finally {
    page?.close()
    await Promise.all([stopChild(chrome), stopChild(server)])
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) {
  artifactContract()
  await browserContract()
}
