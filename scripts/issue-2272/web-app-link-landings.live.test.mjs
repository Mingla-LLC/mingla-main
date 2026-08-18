/**
 * issue #2272 — THE ACCEPTANCE CRITERION, executed against production.
 *
 * `web-app-link-landings.served.test.mjs` proves the built app answers. This one
 * proves `usemingla.com` answers, which is the only claim a buyer experiences.
 *
 * ─── IT IS NOT WIRED TO PULL REQUESTS, ON PURPOSE ───────────────────────────
 *
 * `mingla-marketing` deploys through Vercel on merge, so this cannot be green
 * before the change is live, and running it on a PR would produce a red that
 * means "not deployed yet" rather than "broken". It also cannot ride the
 * push-to-main run: that fires at merge, racing the deploy it is meant to check.
 *
 * So it runs on `workflow_dispatch` only. Deploy, then dispatch
 * `issue-2272-web-app-link-landings` and read this job. There is NO skip
 * condition in this file — it either asks production and gets the right answer,
 * or it fails.
 *
 * Run:  node --test scripts/issue-2272/web-app-link-landings.live.test.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

const ORIGIN = process.env.ISSUE_2272_ORIGIN ?? 'https://usemingla.com'

const UA = {
  iPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  Android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  desktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
}

/**
 * The real order from the issue, plus one probe per remaining family. These are
 * the URLs already sitting in delivered confirmation emails.
 */
const MUST_NOT_404 = [
  '/orders',
  '/orders/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat',
  '/chat',
  '/chat/0a0870b0-c117-4707-bdf4-21fc64bebcab',
  '/board',
  '/board/9F3KQ2',
  '/invite',
  '/invite/ADA2026',
]

/** Negative control: production must still 404 something. */
const MUST_404 = ['/nothing-serves-this-2272', '/receipts/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat']

/**
 * Three attempts per case: a transient network fault must not be reported as a
 * dead path, and a dead path must not be excused as flake. (#2240's rule.)
 */
async function probe(path, ua) {
  let last = 'never attempted'
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${ORIGIN}${path}`, {
        headers: { 'user-agent': ua },
        redirect: 'manual',
      })
      await res.arrayBuffer()
      return { status: res.status, location: res.headers.get('location') }
    } catch (err) {
      last = `network error: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  throw new Error(`${path}: ${last}`)
}

test('LIVE the four app-link families do not 404 on iPhone, Android or desktop', async () => {
  const failures = []
  for (const path of MUST_NOT_404) {
    for (const [device, ua] of Object.entries(UA)) {
      const { status } = await probe(path, ua)
      if (status === 404) failures.push(`${ORIGIN}${path} [${device}] → 404`)
      else if (status !== 200) failures.push(`${ORIGIN}${path} [${device}] → ${status}, expected 200`)
    }
  }
  assert.deepEqual(failures, [], `\n  ${failures.join('\n  ')}\n`)
})

test('LIVE the landing tells the truth and hands off to /download', async () => {
  const res = await fetch(`${ORIGIN}/orders/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat`, {
    headers: { 'user-agent': UA.desktop },
  })
  const html = await res.text()
  assert.ok(html.includes('Your ticket is in the Mingla app'), 'the honest headline is not being served')
  assert.ok(html.includes('href="/download"'), 'the /download call to action is not being served')
  assert.ok(
    !/apps\.apple\.com|play\.google\.com/.test(html),
    'the landing is naming a store directly; /download owns that decision',
  )
})

test('LIVE /download still performs the per-device split', async () => {
  const ios = await probe('/download', UA.iPhone)
  assert.ok(ios.status >= 300 && ios.status < 400, `iPhone /download → ${ios.status}`)
  assert.match(ios.location ?? '', /apps\.apple\.com/)

  const android = await probe('/download', UA.Android)
  assert.ok(android.status >= 300 && android.status < 400, `Android /download → ${android.status}`)
  assert.match(android.location ?? '', /play\.google\.com/)

  const desktop = await probe('/download', UA.desktop)
  assert.equal(desktop.status, 200)
})

test('LIVE production still 404s a path nothing serves', async () => {
  for (const path of MUST_404) {
    const { status } = await probe(path, UA.desktop)
    assert.equal(
      status,
      404,
      `${ORIGIN}${path} → ${status}. If the apex answers 200 to anything, the first test carries no information.`,
    )
  }
})
