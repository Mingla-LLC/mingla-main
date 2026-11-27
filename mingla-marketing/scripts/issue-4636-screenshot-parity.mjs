#!/usr/bin/env node
// #4636 R4 — the zero-difference gate for the block extraction.
//
// Captures full-page screenshots of every page the extraction touched, at
// desktop 1440, tablet 820 and phone 390, from a PRODUCTION build of the
// marketing site, and compares two captures pixel for pixel. Run it on the
// BEFORE commit's build and on the AFTER commit's build; any non-zero diff is
// either fixed or proven to be timing noise (capture BEFORE twice).
//
// No install: `next start` from the build directory, headless Chrome over the
// DevTools protocol (node 22's WebSocket, as lib/__tests__/issue-4339-browser-harness.mjs
// does), and a small PNG decoder on node:zlib for the pixel compare.
//
// Frozen for the capture:
//   - prefers-reduced-motion: reduce (posters instead of clips, no carousel
//     drift, no rotating phrase, every lit word lit; LandingRoot, ReelStage,
//     RotatingPhrase and LandingMedia all honour it);
//   - every CSS animation and transition off, the caret hidden;
//   - every `.reveal` shown (`.in`) after a slow scroll to the bottom and back,
//     so lazy posters load; videos paused at 0;
//   - live data: the build and the server run with no Supabase origin, so every
//     live reader takes its coded fallback (the same fixture on both sides),
//     and any browser call to a supabase/posthog/google origin is answered with
//     an empty 200 JSON body.
//
// Usage (from mingla-marketing/, or anywhere with --dir):
//   node --experimental-websocket scripts/issue-4636-screenshot-parity.mjs capture --dir <built marketing dir> --out /tmp/issue-4636/shots/<label> [--only /,/host]
//   node scripts/issue-4636-screenshot-parity.mjs compare <before-a>[,<before-b>] <after> [--diff-out <dir>]
//
// Screenshots stay out of git (/tmp/issue-4636/shots/).
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'

export const PAGES = [
  '/',
  '/host',
  '/host/events',
  '/host/trips',
  '/host/experiences',
  '/host/restaurants',
  '/host/hotels',
  '/host/art',
  '/host/play',
  '/creators',
  '/locals',
  '/about',
  '/going-out',
  '/cities',
  '/cities/lagos',
  '/cities/durham-nc',
  '/download',
  '/support',
  '/help',
  '/careers',
  '/tools',
  '/schedule',
  '/blog',
]
export const WIDTHS = [1440, 820, 390]
const HEIGHT = 900

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((c) => fs.existsSync(c))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}

export function shotName(page, width) {
  const slug = page === '/' ? 'home' : page.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_')
  return `${slug}@${width}.png`
}

// ---------------------------------------------------------------- capture

// image-rendering: pixelated makes image scaling deterministic (Chrome otherwise
// picks a low or high resampling quality per paint); it is the same on both sides.
const FREEZE_CSS = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important;image-rendering:pixelated!important}`

async function capture() {
  const dir = path.resolve(arg('--dir', process.cwd()))
  const out = path.resolve(arg('--out'))
  const only = arg('--only')
  const pages = only ? only.split(',') : PAGES
  if (!CHROME) throw new Error('issue-4636 parity: Google Chrome is not installed')
  if (!fs.existsSync(path.join(dir, '.next', 'BUILD_ID'))) throw new Error(`issue-4636 parity: no production build in ${dir} (run next build first)`)
  fs.mkdirSync(out, { recursive: true })

  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
  for (const key of Object.keys(env)) if (/SUPABASE|POSTHOG|GA4|PIXEL/.test(key)) delete env[key]
  const port = await freePort()
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: dir,
    stdio: 'ignore',
    env,
  })
  const debug = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4636-shots-'))
  const chrome = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${debug}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--disable-gpu', '--disable-partial-raster', 'about:blank'],
    { stdio: 'ignore' },
  )
  let socket
  const results = []
  try {
    for (let i = 0; i < 300; i += 1) {
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
    if (!target) throw new Error('Chrome did not open a page')
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
          reject(new Error(`DevTools ${method} did not answer in 120 s`))
        }, 120_000)
        pending.set(n, (message) => {
          clearTimeout(timer)
          if (message.error) reject(new Error(`${method}: ${message.error.message}`))
          else resolve(message.result)
        })
        socket.send(JSON.stringify({ id: n, method, params }))
      })
    const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn])
    const evaluate = async (expression) => {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (res.exceptionDetails) throw new Error(`page threw: ${JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails)}`)
      return res.result?.value
    }

    // Any third-party call (live data, analytics) gets an empty 200 JSON body.
    on('Fetch.requestPaused', async (params) => {
      try {
        await send('Fetch.fulfillRequest', {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Access-Control-Allow-Origin', value: '*' },
          ],
          body: Buffer.from('[]').toString('base64'),
        })
      } catch {}
    })
    await send('Fetch.enable', {
      patterns: ['*supabase*', '*posthog*', '*google*', '*googletagmanager*', '*facebook*', '*tiktok*', '*snapchat*', '*reddit*'].map((urlPattern) => ({ urlPattern })),
    })
    await send('Page.enable')
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }] })
    await send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' })
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const s = document.createElement('style'); s.setAttribute('data-issue-4636-freeze',''); s.textContent = ${JSON.stringify(FREEZE_CSS)}; document.documentElement.appendChild(s) })()`,
    })

    for (const page of pages) {
      for (const width of WIDTHS) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
        const loaded = new Promise((resolve) => {
          const done = () => resolve()
          on('Page.loadEventFired', done)
          setTimeout(done, 30_000)
        })
        await send('Page.navigate', { url: `http://127.0.0.1:${port}${page}` })
        await loaded
        await evaluate(`new Promise(r => { if (document.readyState === 'complete') r(); else addEventListener('load', () => r(), { once: true }) })`)
        // Slow scroll down and back so lazy posters and reveal observers run.
        await evaluate(`(async () => {
          const step = Math.max(200, Math.floor(innerHeight * 0.8));
          for (let y = 0; y < document.documentElement.scrollHeight; y += step) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)) }
          scrollTo(0, document.documentElement.scrollHeight); await new Promise(r => setTimeout(r, 150));
          scrollTo(0, 0); await new Promise(r => setTimeout(r, 150));
          return true })()`)
        await evaluate(`(async () => {
          document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
          document.querySelectorAll('[data-lit] .w').forEach(el => el.classList.add('lit'));
          document.querySelectorAll('video').forEach(v => { try { v.pause(); v.currentTime = 0 } catch {} });
          await document.fonts.ready;
          // A <video poster> has no load event: fetch and decode every poster
          // first, so the capture never catches one half painted.
          await Promise.all(Array.from(document.querySelectorAll('video[poster]')).map(v => new Promise(r => { const i = new Image(); i.onload = () => i.decode().then(r, r); i.onerror = r; i.src = v.poster; setTimeout(r, 8000) })));
          await Promise.all(Array.from(document.images).map(img => img.complete ? null : new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); setTimeout(r, 8000) })));
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          return true })()`)
        await sleep(1200)
        // The full page as viewport tiles (scroll, shoot), never by resizing the
        // viewport: a resize re-runs the carousel and every vh-based height, so
        // a resized capture is not stable. Tiles overlap by 200px so nothing
        // hides under the fixed nav or the privacy strip in every tile.
        const fullHeight = await evaluate('document.documentElement.scrollHeight')
        const step = HEIGHT - 200
        const offsets = []
        for (let y = 0; y + HEIGHT < fullHeight; y += step) offsets.push(y)
        offsets.push(Math.max(0, fullHeight - HEIGHT))
        const take = async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
        let unsettled = 0
        for (const [k, y] of offsets.entries()) {
          await evaluate(`(async () => { scrollTo(0, ${y}); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true })()`)
          await sleep(350)
          // A large poster may paint at a lower decode quality first: shoot
          // until two consecutive pictures are byte-identical, at most 6.
          let png = await take()
          let settled = false
          for (let i = 0; i < 5 && !settled; i += 1) {
            await sleep(300)
            const next = await take()
            settled = next.equals(png)
            png = next
          }
          if (!settled) unsettled += 1
          fs.writeFileSync(path.join(out, shotName(page, width).replace('.png', `#${String(k).padStart(2, '0')}.png`)), png)
        }
        if (unsettled) console.log(`  (warning: ${page} @${width}: ${unsettled} tile(s) never settled)`)
        const finalUrl = await evaluate('location.pathname')
        results.push({ page, width, height: fullHeight, tiles: offsets.length, finalUrl })
        console.log(`captured ${page} @${width} (${fullHeight}px tall, ${offsets.length} tiles)${finalUrl !== page ? ` [landed on ${finalUrl}]` : ''}`)
      }
    }
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
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(results, null, 2))
}

// ---------------------------------------------------------------- PNG decode

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  const idat = []
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG not supported')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`PNG bit depth ${bitDepth} not supported`)
  const channels = { 2: 3, 6: 4, 0: 1, 4: 2 }[colorType]
  if (!channels) throw new Error(`PNG colour type ${colorType} not supported`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[x] = v & 0xff
    }
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4
      if (channels >= 3) {
        pixels[o] = line[x * channels]
        pixels[o + 1] = line[x * channels + 1]
        pixels[o + 2] = line[x * channels + 2]
        pixels[o + 3] = channels === 4 ? line[x * channels + 3] : 255
      } else {
        pixels[o] = pixels[o + 1] = pixels[o + 2] = line[x * channels]
        pixels[o + 3] = channels === 2 ? line[x * channels + 1] : 255
      }
    }
    prev = line
  }
  return { width, height, pixels }
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

/** RGBA pixels → PNG (for the diff picture). */
export function encodePng(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** The second picture, dimmed, with every differing pixel in red. */
export function diffPicture(aBuf, bBuf) {
  const a = decodePng(aBuf)
  const b = decodePng(bBuf)
  if (a.width !== b.width || a.height !== b.height) return null
  const out = Buffer.alloc(a.pixels.length)
  for (let i = 0; i < a.pixels.length; i += 4) {
    const same = a.pixels[i] === b.pixels[i] && a.pixels[i + 1] === b.pixels[i + 1] && a.pixels[i + 2] === b.pixels[i + 2]
    out[i] = same ? b.pixels[i] >> 2 : 255
    out[i + 1] = same ? b.pixels[i + 1] >> 2 : 0
    out[i + 2] = same ? b.pixels[i + 2] >> 2 : 0
    out[i + 3] = 255
  }
  return encodePng(a.width, a.height, out)
}

/** Number of differing pixels and the first differing row (or null). */
export function diffPng(aBuf, bBuf) {
  if (aBuf.equals(bBuf)) return { identical: true, differing: 0, sizeMatch: true, firstRow: null }
  const a = decodePng(aBuf)
  const b = decodePng(bBuf)
  if (a.width !== b.width || a.height !== b.height) {
    return { identical: false, differing: null, sizeMatch: false, firstRow: null, sizes: [`${a.width}x${a.height}`, `${b.width}x${b.height}`] }
  }
  let differing = 0
  let firstRow = null
  for (let i = 0; i < a.pixels.length; i += 4) {
    if (a.pixels[i] !== b.pixels[i] || a.pixels[i + 1] !== b.pixels[i + 1] || a.pixels[i + 2] !== b.pixels[i + 2] || a.pixels[i + 3] !== b.pixels[i + 3]) {
      differing += 1
      if (firstRow === null) firstRow = Math.floor(i / 4 / a.width)
    }
  }
  return { identical: differing === 0, differing, sizeMatch: true, firstRow, total: a.width * a.height }
}

function compare() {
  // The first argument may list several BEFORE captures (comma-separated):
  // a tile passes when it is identical to ANY of them, so capture noise that
  // shows between two BEFORE runs (the noise floor) is not counted as a change.
  const [, , , aArg, bDir] = process.argv
  const aDirs = aArg.split(',')
  const aDir = aDirs[0]
  const rows = []
  let failed = 0
  const names = fs.readdirSync(aDir).filter((f) => f.endsWith('.png')).sort()
  for (const name of names) {
    const bFile = path.join(bDir, name)
    if (!fs.existsSync(bFile)) {
      rows.push({ name, result: 'MISSING in second capture' })
      failed += 1
      continue
    }
    const bBuf = fs.readFileSync(bFile)
    let best = null
    let bestDir = aDir
    for (const dir of aDirs) {
      const file = path.join(dir, name)
      if (!fs.existsSync(file)) continue
      const d = diffPng(fs.readFileSync(file), bBuf)
      if (best === null || (d.identical && !best.identical) || (d.sizeMatch && best.sizeMatch && (d.differing ?? Infinity) < (best.differing ?? Infinity))) {
        best = d
        bestDir = dir
      }
      if (d.identical) break
    }
    const d = best
    const result = d.identical
      ? 'identical (0 px)'
      : d.sizeMatch
        ? `DIFF ${d.differing} px (first row ${d.firstRow})`
        : `DIFF size ${d.sizes.join(' vs ')}`
    if (!d.identical) {
      failed += 1
      const diffOut = arg('--diff-out')
      if (diffOut && d.sizeMatch) {
        fs.mkdirSync(diffOut, { recursive: true })
        const pic = diffPicture(fs.readFileSync(path.join(bestDir, name)), bBuf)
        if (pic) fs.writeFileSync(path.join(diffOut, name), pic)
      }
    }
    rows.push({ name, result })
  }
  // Page heights must match too (a tile set can match while the page grew).
  const ia = path.join(aDir, 'index.json')
  const ib = path.join(bDir, 'index.json')
  const heights = new Map()
  if (fs.existsSync(ia) && fs.existsSync(ib)) {
    const b = JSON.parse(fs.readFileSync(ib, 'utf8'))
    for (const ra of JSON.parse(fs.readFileSync(ia, 'utf8'))) {
      const rb = b.find((x) => x.page === ra.page && x.width === ra.width)
      const key = shotName(ra.page, ra.width).replace('.png', '')
      heights.set(key, rb ? ra.height === rb.height : false)
      if (!rb || ra.height !== rb.height) {
        failed += 1
        rows.push({ name: `${key} height`, result: `DIFF height ${ra.height} vs ${rb?.height ?? 'missing'}` })
      }
    }
  }
  // One line per page × width (its tiles folded together).
  const byPage = new Map()
  for (const r of rows) {
    const key = r.name.replace(/#\d+\.png$/, '').replace(/ height$/, '')
    const list = byPage.get(key) ?? []
    list.push(r)
    byPage.set(key, list)
  }
  for (const [key, list] of byPage) {
    const bad = list.filter((r) => !r.result.startsWith('identical'))
    console.log(`${key.padEnd(28)} ${bad.length === 0 ? `identical (${list.length} tiles, 0 px)` : bad.map((r) => `${r.name}: ${r.result}`).join('; ')}`)
  }
  console.log(`\n${names.length} tiles compared, ${failed} differing`)
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(rows, null, 2))
  process.exitCode = failed ? 1 : 0
}

// Run as a script (realpath: /tmp is /private/tmp on macOS).
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const cmd = process.argv[2]
  if (cmd === 'capture') await capture()
  else if (cmd === 'compare') compare()
  else {
    console.error('usage: issue-4636-screenshot-parity.mjs capture --dir <built dir> --out <dir> | compare <a> <b>')
    process.exitCode = 2
  }
}
