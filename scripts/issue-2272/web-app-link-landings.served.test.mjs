/**
 * issue #2272 — `/orders/*`, `/chat/*`, `/board/*`, `/invite/*` returned HTTP 404
 * in the browser for everyone without the Explorer app.
 *
 * ─── THIS IS THE TEST THAT MATTERS, AND WHY IT IS SHAPED THIS WAY ───────────
 *
 * #2240 shipped a dead link because a test asserted the URL string was PRESENT
 * and never that it RESOLVED. The obvious over-correction is a test that asserts
 * a route FILE exists — which is the same mistake one layer down: a file can
 * exist and still not be served (a middleware guard, a rewrite, a route group, a
 * bad segment name), and `mingla-marketing/app/careers/**` is a live example
 * inside this very app.
 *
 * So this suite asserts THE RESPONSE. It starts the REAL production build of the
 * marketing app (`next build` output, the same artefact Vercel serves) and issues
 * REAL HTTP requests with REAL iPhone, Android and desktop User-Agents, then
 * reads the status code that comes back.
 *
 * Its companion `web-app-link-landings.model.test.mjs` is the cheap layer and
 * runs the shared route model. If the two ever disagree, the model is wrong.
 *
 * ─── FALSIFIABILITY ─────────────────────────────────────────────────────────
 *
 * Every positive here is paired with a negative served by the SAME server in the
 * SAME run:
 *   - `/nothing-serves-this-2272/...` must 404, so a green run can never be "the
 *     apex answers 200 to everything".
 *   - `/careers` must 404 (the middleware apex guard), so a green run can never
 *     be "middleware stopped running".
 *   - `/download` must still 307 to the App Store under an iPhone UA and to
 *     Google Play under an Android UA, so "reuse /download" is proven live on
 *     this build rather than assumed from the source.
 *
 * Delete any one of the four `page.tsx` files and the matching family goes 404
 * here. That is the fails-on-revert proof, and it is structural, not a string.
 *
 * ─── PREREQUISITE ───────────────────────────────────────────────────────────
 *
 *   cd mingla-marketing && npm ci --ignore-scripts && npm run build
 *
 * A missing build is a LOUD failure with that command in the message — never a
 * skip. A suite that skips itself when its subject is absent is the
 * cannot-fail check class this repository has been burned by.
 *
 * Run:  node --test scripts/issue-2272/web-app-link-landings.served.test.mjs
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MARKETING = join(REPO_ROOT, 'mingla-marketing')
const NEXT_BIN = join(MARKETING, 'node_modules', '.bin', 'next')

/**
 * The three probe agents. Byte-identical to the strings #2240's live lane uses,
 * so both lanes ask production the same question in the same words.
 */
const UA = {
  iPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  Android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  desktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
}

/**
 * The four families, each probed at the BARE segment and at a realistic deep
 * path. The `/orders` row uses the exact URL from the issue — the one every
 * confirmation email delivered before #2240 still carries.
 */
const FAMILIES = [
  {
    kind: 'order',
    headline: 'Your ticket is in the Mingla app',
    paths: ['/orders', '/orders/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat'],
  },
  {
    kind: 'chat',
    headline: 'Event chat is in the Mingla app',
    paths: ['/chat', '/chat/0a0870b0-c117-4707-bdf4-21fc64bebcab'],
  },
  {
    kind: 'board',
    headline: 'This plan is in the Mingla app',
    paths: ['/board', '/board/9F3KQ2'],
  },
  {
    kind: 'invite',
    headline: 'This invite opens in the Mingla app',
    paths: ['/invite', '/invite/ADA2026'],
  },
]

/** Paths that MUST 404 on the same server, or nothing above carries information. */
const MUST_404 = [
  // Nothing serves this. If it 200s, the app is answering everything.
  '/nothing-serves-this-2272',
  '/nothing-serves-this-2272/deeper/still',
  // Singular / plural neighbours of the four families: proves the routes were
  // scoped to the DECLARED path families and did not become a catch-all.
  '/order/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat',
  '/chats/abc',
  '/boards/abc',
  '/invites/abc',
  // The middleware apex guard. If this 200s, middleware is not running and the
  // model this suite's companion builds is reasoning about a layer that is off.
  '/careers',
]

let server = null
let baseUrl = ''

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

const get = (path, ua) =>
  fetch(`${baseUrl}${path}`, { headers: { 'user-agent': ua }, redirect: 'manual' })

before(async () => {
  assert.ok(
    existsSync(join(MARKETING, '.next')),
    'mingla-marketing/.next is missing, so there is no production build to ask. This suite asserts RESPONSES, not files, and refuses to pass without one.\n' +
      '  Run:  cd mingla-marketing && npm ci --ignore-scripts && npm run build',
  )
  assert.ok(
    existsSync(NEXT_BIN),
    `${NEXT_BIN} is missing — run \`npm ci --ignore-scripts\` in mingla-marketing/`,
  )

  const port = await freePort()
  baseUrl = `http://127.0.0.1:${port}`
  server = spawn(NEXT_BIN, ['start', '-p', String(port)], {
    cwd: MARKETING,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) },
  })
  let log = ''
  server.stdout.on('data', (d) => {
    log += d
  })
  server.stderr.on('data', (d) => {
    log += d
  })

  // Bounded wait. A server that never comes up is a failure, not a skip.
  const deadline = Date.now() + 90_000
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`next start never became ready within 90s. Server output:\n${log}`)
    }
    try {
      const res = await fetch(`${baseUrl}/`, { redirect: 'manual' })
      if (res.status > 0) {
        await res.arrayBuffer()
        break
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
})

after(() => {
  if (server) server.kill('SIGTERM')
})

// ─── R1 — the four families do not 404, on any of the three devices ─────────

test('R1 every declared app-link path answers a real page on iPhone, Android and desktop', async () => {
  const failures = []
  for (const family of FAMILIES) {
    for (const path of family.paths) {
      for (const [device, ua] of Object.entries(UA)) {
        const res = await get(path, ua)
        await res.arrayBuffer()
        if (res.status === 404) {
          failures.push(`${path} [${device}] → 404 (this is the #2272 defect)`)
        } else if (res.status !== 200) {
          failures.push(`${path} [${device}] → ${res.status}, expected 200`)
        }
      }
    }
  }
  assert.deepEqual(failures, [], `\n  ${failures.join('\n  ')}\n`)
})

// ─── R2 — what it says is true, and it says the same thing to every device ──

test('R2 each family serves its own honest page, byte-identical across devices', async () => {
  for (const family of FAMILIES) {
    for (const path of family.paths) {
      const bodies = {}
      for (const [device, ua] of Object.entries(UA)) {
        const res = await get(path, ua)
        bodies[device] = await res.text()
      }

      for (const [device, html] of Object.entries(bodies)) {
        assert.ok(
          html.includes(family.headline),
          `${path} [${device}] did not render its headline "${family.headline}"`,
        )
        assert.ok(
          html.includes('href="/download"'),
          `${path} [${device}] has no /download call to action — the one destination #2272 is required to reuse`,
        )
        // The page must not imply the browser can show a ticket it cannot show.
        assert.ok(
          !/qr-?code|<canvas|Scan this with your phone/i.test(html),
          `${path} [${device}] renders something ticket-shaped. The browser cannot show a ticket and the page must not pretend otherwise.`,
        )
        // Device detection belongs to /download and nowhere else.
        assert.ok(
          !/apps\.apple\.com|play\.google\.com/.test(html),
          `${path} [${device}] names a store directly. /download owns that decision (#2272 R1); a second copy is a second thing to keep correct.`,
        )
        // Per-order URLs must never enter a search index.
        assert.ok(
          /<meta name="robots" content="noindex/.test(html),
          `${path} [${device}] is missing noindex`,
        )
      }

      assert.equal(
        bodies.iPhone,
        bodies.Android,
        `${path} served different HTML to iPhone and Android — this page has no device branch`,
      )
      assert.equal(
        bodies.iPhone,
        bodies.desktop,
        `${path} served different HTML to iPhone and desktop — this page has no device branch`,
      )
    }
  }
})

// ─── R3 — the reused mechanism, executed on this build ──────────────────────

test('R3 /download still performs the per-device split this fix delegates to', async () => {
  const ios = await get('/download', UA.iPhone)
  await ios.arrayBuffer()
  assert.ok(ios.status >= 300 && ios.status < 400, `iPhone /download → ${ios.status}, expected a redirect`)
  assert.match(
    ios.headers.get('location') ?? '',
    /apps\.apple\.com/,
    'iPhone /download must land on the App Store',
  )

  const android = await get('/download', UA.Android)
  await android.arrayBuffer()
  assert.ok(
    android.status >= 300 && android.status < 400,
    `Android /download → ${android.status}, expected a redirect`,
  )
  assert.match(
    android.headers.get('location') ?? '',
    /play\.google\.com/,
    'Android /download must land on Google Play',
  )

  const desktop = await get('/download', UA.desktop)
  await desktop.arrayBuffer()
  assert.equal(desktop.status, 200, 'desktop /download must render the QR page')
})

// ─── R4 — the negative controls ─────────────────────────────────────────────

test('R4 paths nothing serves really do 404 on the same server', async () => {
  const wrong = []
  for (const path of MUST_404) {
    for (const [device, ua] of Object.entries(UA)) {
      const res = await get(path, ua)
      await res.arrayBuffer()
      if (res.status !== 404) wrong.push(`${path} [${device}] → ${res.status}, expected 404`)
    }
  }
  assert.deepEqual(
    wrong,
    [],
    `\n  ${wrong.join('\n  ')}\n\nIf these do not 404, R1 carries no information: the server would be answering 200 to everything.\n`,
  )
})
