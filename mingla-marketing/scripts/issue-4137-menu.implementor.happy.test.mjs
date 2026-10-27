#!/usr/bin/env node
// #4137 wave 2 — implementor happy path: the grouped side menu.
//
// --source-only (before `next build`): the three literal lists in order, the
//   hidden blog seam, the two bottom CTAs byte-equal to the pre-wave-2 menu,
//   48px rows, 44px chips and the sticky CTA strip.
// --built-only (release build, real Chrome against `next start`):
//   AC-M1  nine Primary links in order, EXPLORE / HOST / COMPANY visible
//   AC-M2  exactly one lit item per route
//   AC-M4  rows, chips and close >= 44px; the CTAs keep wave 1's 42px (Seth's
//          home layout check), at 360/375/390/402/1440
//   AC-M5  row icons at the left padding in one column; CTAs centred; no
//          horizontal overflow
//   AC-M6  at 375x667 both CTAs stay inside the viewport while the groups
//          scroll; the page behind stays locked
//   AC-M7  Tab visits close, rows, chips and CTAs in DOM order and wraps;
//          the Explorer CTA on a computer opens the QR dialog and Escape closes
//          only the QR, then the menu, returning focus to the menu button
// Fails on revert: the flat six-row menu has no COMPANY chips, no Help /
// Support / Careers, 56px rows and non-sticky CTAs.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
assert(SOURCE_ONLY !== BUILT_ONLY, 'choose --source-only or --built-only')
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const EXPECTED_LINKS = [
  ['Explorer', '/'], ['Cities', '/cities'], ['Going out', '/going-out'],
  ['Host', '/host'], ['Free tools', '/tools'],
  ['About', '/about'], ['Help', '/help'], ['Support', '/support'], ['Careers', 'https://career.usemingla.com'],
]

// The pre-wave-2 CTA block, verbatim (spec §4.1: byte-identical).
const CTA_BLOCK = `        <DeviceCta
          surface="explorer"
          location="side_menu_explorer"
          label="Explore Your City"
          variant="primary"
          size="lg"
          className="w-full justify-center !text-[var(--cut-ink)]"
          onExternalActivate={onDismiss}
          onDialogOpenChange={onChildDialogOpenChange}
        />
        <DeviceCta
          surface="host"
          location="side_menu_host"
          label="Host Your City"
          variant="ink"
          size="lg"
          className="w-full justify-center"
          onExternalActivate={onDismiss}
        />`

function list(menu, name) {
  const start = menu.indexOf(`const ${name} = [`)
  assert(start >= 0, `#4137: ${name} must be one literal list`)
  return [...menu.slice(start, menu.indexOf('\n  ]', start)).matchAll(/\{ href: '([^']+)', label: '([^']+)'/g)].map((match) => [match[2], match[1]])
}

function sourceContract() {
  const menu = code(read('components/cutout/audience-menu-content.tsx'))
  assert.deepEqual(
    [...list(menu, 'exploreDestinations'), ...list(menu, 'hostDestinations'), ...list(menu, 'companyDestinations')],
    EXPECTED_LINKS,
    '#4137: EXPLORE, HOST and COMPANY lists in order',
  )
  assert.match(menu, /\{ href: '\/cities', label: 'Cities', Icon: MapPinned \}/, '#4137: the Cities literal is kept verbatim')
  assert.match(menu, /const \{ blogVisible, showNewBadge, latest \} = BLOG_MENU_ENTRY/, '#4137: Blog and story read the one seam')
  // #4137 wave 3: the seam is generated at build time; the committed value is hidden.
  assert.match(read('lib/blog/menu-entry.ts'), /BLOG_MENU_ENTRY: BlogMenuEntry = parseBlogMenuEntry\(generated\)/, '#4137: the seam reads the build-time value')
  assert.deepEqual(JSON.parse(read('lib/blog/menu-entry.generated.json')), { blogVisible: false, showNewBadge: false, latest: null }, '#4137: committed blog seam is hidden')
  assert.match(menu, /\{blogVisible && latest \? \(/, '#4137: the story card needs the blog AND a story')
  assert(read('components/cutout/audience-menu-content.tsx').includes(`<div className="cut-menu-ctas mt-auto flex flex-col gap-2.5 pt-6">\n${CTA_BLOCK}\n      </div>`), '#4137: the bottom CTAs are byte-identical and sit in the sticky strip')
  assert.match(menu, /const menuButtonClass = 'cut-btn flex min-h-12 /, '#4137: 48px rows')
  assert.match(menu, /<span className="sr-only">, opens in a new tab<\/span>/, '#4137: Careers announces the new tab')
  const css = read('components/cutout/cutout.css').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /\.cut-menu-ctas \{[^}]*position: sticky;[^}]*bottom: 0;[^}]*background: var\(--cut-card\);/, '#4137 AC-M6: the CTA strip is sticky on the panel colour')
  assert.match(css, /\.cut-btn\.cut-menu-chip \{[^}]*min-height: 44px;/, '#4137 AC-M4: 44px chips')
  assert.match(css, /\.cut-menu-new \{[^}]*background: #a8450e;[^}]*color: #fff;/, '#4137 AC-M8: badge on --cut-accent-ink')
  assert.match(css, /\.cut-btn\.cut-menu-item \{ justify-content: flex-start; \}/, '#3371 row rule kept')
  const pkg = JSON.parse(read('package.json'))
  assert.match(pkg.scripts.build, /issue-4137-menu\.implementor\.happy\.test\.mjs --source-only/, '#4137: the menu source contract runs before next build')
  assert.match(pkg.scripts.build, /issue-4137-menu\.implementor\.happy\.test\.mjs --built-only/, '#4137: the menu runtime contract runs on the release build')
  process.stdout.write('PASS #4137 menu source: grouped literal lists, hidden blog seam, byte-identical sticky CTAs, 48px rows, 44px chips\n')
}

// ------------------------------------------------------------------ runtime
const CHROME = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find((candidate) => fs.existsSync(candidate))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(check, message, timeout = 30_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) { last = error }
    await sleep(80)
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ''}`)
}
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}
class Page {
  constructor(url) {
    this.next = 0
    this.pending = new Map()
    this.socket = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }) })
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data))
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result)
    })
  }
  async send(method, params = {}) {
    await this.ready
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`CDP timeout: ${method}`)) }, 25_000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text)
    return result.result.value
  }
  async key(name, modifiers = 0) {
    const keys = { Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' } }
    const spec = keys[name]
    await this.send('Input.dispatchKeyEvent', { type: spec.text ? 'keyDown' : 'rawKeyDown', modifiers, ...spec })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...spec })
  }
  close() { this.socket.close() }
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 2_000) })
  child.kill('SIGTERM')
  await exited
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

const MENU_STATE = `(()=>{
  const dialog=document.querySelector('[role="dialog"][aria-labelledby]')
  const card=dialog.firstElementChild
  const box=(el)=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}
  const label=(a)=>{const c=a.cloneNode(true);c.querySelectorAll('.sr-only').forEach((n)=>n.remove());return c.textContent.trim()}
  const links=[...dialog.querySelectorAll('nav[aria-label="Primary"] a')].map((a)=>({label:label(a),href:a.getAttribute('href'),current:a.getAttribute('aria-current'),box:box(a),row:a.classList.contains('cut-menu-item'),chip:a.classList.contains('cut-menu-chip')}))
  const rows=[...dialog.querySelectorAll('nav[aria-label="Primary"] a.cut-menu-item')].map((a)=>{const s=getComputedStyle(a);return {label:label(a),left:a.getBoundingClientRect().left,paddingLeft:parseFloat(s.paddingLeft),iconLeft:a.querySelector('svg').getBoundingClientRect().left}})
  const ctas=[...dialog.querySelectorAll('.cut-menu-ctas .cut-btn')].map((b)=>{
    const texts=[];const walker=document.createTreeWalker(b,NodeFilter.SHOW_TEXT);for(let node=walker.nextNode();node;node=walker.nextNode()){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects()){if(rect.width>0&&rect.height>0)texts.push(rect)}}
    const parts=[...texts,...[...b.querySelectorAll('svg')].map((svg)=>svg.getBoundingClientRect()).filter((r)=>r.width>0)]
    const r=b.getBoundingClientRect(),left=Math.min(...parts.map((p)=>p.left)),right=Math.max(...parts.map((p)=>p.right))
    return {label:b.innerText.trim(),box:box(b),centreOffset:(left+right)/2-(r.left+r.right)/2}
  })
  const groups=[...dialog.querySelectorAll('.cut-menu-group')].map((g)=>g.innerText.trim())
  return {links,rows,ctas,groups,close:box(dialog.querySelector('button[aria-label="Close menu"]')),innerWidth,innerHeight,scrollWidth:document.documentElement.scrollWidth,cardScrollHeight:card.scrollHeight,cardClientHeight:card.clientHeight,bodyOverflow:document.body.style.overflow}
})()`
const MENU_OPEN = `(()=>{const d=document.querySelector('[role="dialog"][aria-labelledby]');if(!d||d.querySelectorAll('nav[aria-label="Primary"] a').length!==9)return false;const t=getComputedStyle(d).transform;return t==='none'||t==='matrix(1, 0, 0, 1, 0, 0)'})()`

async function openMenu(page, base, route, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 })
  await page.send('Page.navigate', { url: `${base}${route}` })
  await waitFor(() => page.evaluate(`document.readyState==='complete'&&(()=>{const b=document.querySelector('button[aria-label="Open menu"]');return !!b&&Object.keys(b).some((k)=>k.startsWith('__reactProps'))})()`), `${route} ${width}x${height}: page did not hydrate`, 45_000)
  await page.evaluate(`(async()=>{await document.fonts.ready;const b=document.querySelector('button[aria-label="Open menu"]');b.focus();b.click();return true})()`)
  await waitFor(() => page.evaluate(MENU_OPEN), `${route} ${width}x${height}: menu did not open`)
  await sleep(150)
  return page.evaluate(MENU_STATE)
}

async function runtimeContract() {
  assert(fs.existsSync(path.join(ROOT, '.next/BUILD_ID')), '#4137: run next build first')
  if (process.env.VERCEL === '1') {
    process.stdout.write('SKIP #4137 menu browser checks on Vercel; the source contract ran before the build\n')
    return
  }
  assert(CHROME, '#4137: Chrome is required for the menu runtime proof')
  assert.equal(typeof WebSocket, 'function', 'run with node --experimental-websocket')
  const serverPort = await freePort()
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(serverPort)], { cwd: ROOT, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', MINGLA_HISTORICAL_2983_BUILD: '' }, stdio: 'ignore' })
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-4137-menu-'))
  let chrome
  let page
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${serverPort}/robots.txt`)).ok, 'next start did not come up', 90_000)
    const chromePort = await freePort()
    chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${chromePort}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', 'about:blank'], { stdio: 'ignore' })
    await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).ok, 'Chrome did not start', 90_000)
    const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json())
    page = new Page(target.webSocketDebuggerUrl)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('mingla_consent_v1',JSON.stringify({value:'denied',ts:Date.now()}))` })
    const base = `http://127.0.0.1:${serverPort}`

    // AC-M1, M4, M5 across viewports on /.
    for (const [width, height] of [[1440, 900], [390, 844], [402, 874], [375, 667], [360, 780]]) {
      const label = `/ ${width}x${height}`
      const state = await openMenu(page, base, '/', width, height)
      assert.deepEqual(state.links.map((link) => [link.label, link.href]), EXPECTED_LINKS, `#4137 AC-M1: ${label} links`)
      assert.deepEqual(state.links.map((link) => link.current), ['page', null, null, null, null, null, null, null, null], `#4137 AC-M1: ${label} lights Explorer`)
      assert.deepEqual(state.groups, ['EXPLORE', 'HOST', 'COMPANY'], `#4137 AC-M1: ${label} group labels`)
      for (const link of state.links) {
        assert(link.box.height >= 44 - 0.5 && link.box.width >= 44 - 0.5, `#4137 AC-M4: ${label} "${link.label}" is ${link.box.width.toFixed(1)}x${link.box.height.toFixed(1)}`)
      }
      assert(state.links.filter((link) => link.row).every((link) => link.box.height >= 48 - 0.5), `#4137: ${label} rows are 48px`)
      assert(state.close.width >= 44 - 0.5 && state.close.height >= 44 - 0.5, `#4137 AC-M4: ${label} close button`)
      assert.equal(state.ctas.length, 2, `#4137: ${label} two CTAs`)
      for (const cta of state.ctas) {
        assert(cta.box.height >= 42 - 0.5, `#4137 AC-M4: ${label} CTA "${cta.label}" keeps wave 1's 42px`)
        assert(Math.abs(cta.centreOffset) <= 1.5, `#4137 AC-M5: ${label} CTA "${cta.label}" is ${cta.centreOffset.toFixed(1)}px off centre`)
      }
      assert.equal(state.rows.length, 5, `#4137 AC-M5: ${label} five rows`)
      for (const row of state.rows) assert(Math.abs(row.iconLeft - row.left - row.paddingLeft) <= 1, `#4137 AC-M5: ${label} "${row.label}" icon off the row padding`)
      const icons = state.rows.map((row) => row.iconLeft)
      assert(Math.max(...icons) - Math.min(...icons) <= 1, `#4137 AC-M5: ${label} row icons share one column`)
      assert.equal(state.scrollWidth, state.innerWidth, `#4137 AC-M5: ${label} no horizontal overflow`)
      process.stdout.write(`EVIDENCE #4137 menu ${label} links=9 rowsH=${Math.min(...state.links.filter((l) => l.row).map((l) => l.box.height))} chipH=${Math.min(...state.links.filter((l) => l.chip).map((l) => l.box.height))} ctaH=${state.ctas.map((c) => c.box.height).join('/')} drawerOverflowY=${state.cardScrollHeight - state.cardClientHeight}\n`)
    }

    // AC-M6 — 375x667: CTAs in view with the groups scrolled to the top, page locked.
    {
      const state = await openMenu(page, base, '/cities/raleigh-nc', 375, 667)
      await page.evaluate(`document.querySelector('[role="dialog"][aria-labelledby]').firstElementChild.scrollTop=0`)
      const again = await page.evaluate(MENU_STATE)
      for (const cta of again.ctas) assert(cta.box.top >= 0 && cta.box.bottom <= again.innerHeight + 0.5, `#4137 AC-M6: CTA "${cta.label}" is outside the 375x667 viewport (${cta.box.top.toFixed(1)}..${cta.box.bottom.toFixed(1)})`)
      assert.equal(again.bodyOverflow, 'hidden', '#4137 AC-M6: the page behind stays locked')
      process.stdout.write(`EVIDENCE #4137 menu 375x667 sticky CTAs at ${again.ctas.map((c) => `${c.box.top.toFixed(0)}-${c.box.bottom.toFixed(0)}`).join(', ')} of ${again.innerHeight}; drawer content ${state.cardScrollHeight}px in ${state.cardClientHeight}px\n`)
    }

    // AC-M2 — one lit item per route.
    for (const [route, lit] of [['/going-out', 'Going out'], ['/cities/raleigh-nc', 'Cities'], ['/cities', 'Cities'], ['/host', 'Host'], ['/help', 'Help'], ['/about', 'About']]) { // /support renders its own layout with no side menu; its chip is proven in issue-4137-menu-blog-seam
      const state = await openMenu(page, base, route, 1440, 900)
      assert.deepEqual(state.links.filter((link) => link.current === 'page').map((link) => link.label), [lit], `#4137 AC-M2: ${route} lights ${lit} only`)
    }

    // AC-M7 — keyboard order, wrap, QR suspension and focus return (desktop).
    await openMenu(page, base, '/help', 1440, 900)
    await page.evaluate(`document.querySelector('button[aria-label="Close menu"]').focus()`)
    const describe = `(()=>{const el=document.activeElement;const c=el.cloneNode(true);c.querySelectorAll?.('.sr-only').forEach((n)=>n.remove());return (el.getAttribute('aria-label')||c.textContent||'').trim()})()`
    const order = [await page.evaluate(describe)]
    for (let index = 0; index < 12; index += 1) { await page.key('Tab'); order.push(await page.evaluate(describe)) }
    const visible = (labels) => labels.map((value) => value.replace(/\s+/g, ' '))
    assert.deepEqual(visible(order).slice(0, 10), ['Close menu', ...EXPECTED_LINKS.map(([text]) => text)], `#4137 AC-M7: Tab order (got ${JSON.stringify(order)})`)
    assert.match(order[10], /Explore Your City/, '#4137 AC-M7: Tab reaches the Explorer CTA')
    assert.match(order[11], /Host Your City/, '#4137 AC-M7: then the Host CTA')
    assert.equal(order[12], 'Close menu', '#4137 AC-M7: Tab wraps to close')
    await page.key('Tab', 8) // Shift+Tab back to Host, then Explorer
    await page.key('Tab', 8)
    assert.match(await page.evaluate(describe), /Explore Your City/, '#4137 AC-M7: Shift+Tab returns to the Explorer CTA')
    await page.key('Enter')
    await waitFor(() => page.evaluate(`[...document.querySelectorAll('[role="dialog"]')].some((d)=>/Scan to get Mingla/.test(d.textContent))`), '#4137 AC-M7: the Explorer CTA on a computer must open the QR dialog')
    await sleep(300)
    await page.key('Escape')
    await waitFor(() => page.evaluate(`![...document.querySelectorAll('[role="dialog"]')].some((d)=>/Scan to get Mingla/.test(d.textContent))`), '#4137 AC-M7: Escape must close the QR')
    await sleep(300)
    assert(await page.evaluate(MENU_OPEN), '#4137 AC-M7: the first Escape closes only the QR')
    await page.key('Escape')
    await waitFor(() => page.evaluate(`!document.querySelector('[role="dialog"]')`), '#4137 AC-M7: the second Escape closes the menu')
    await waitFor(() => page.evaluate(`document.activeElement?.getAttribute('aria-label')==='Open menu'`), '#4137 AC-M7: focus returns to the menu button')
    process.stdout.write('PASS #4137 menu runtime: nine grouped links (AC-M1), one lit item per route (AC-M2), 44px targets and 42px CTAs (AC-M4), aligned rows and centred CTAs with no overflow (AC-M5), sticky CTAs at 375x667 (AC-M6), keyboard order, QR suspension and focus return (AC-M7)\n')
  } finally {
    page?.close()
    await stop(chrome)
    await stop(server)
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

if (SOURCE_ONLY) sourceContract()
else await runtimeContract()
