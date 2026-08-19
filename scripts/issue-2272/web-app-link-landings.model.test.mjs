/**
 * issue #2272 — the cheap layer, and the class-level guard.
 *
 * `web-app-link-landings.served.test.mjs` is the test that matters: it starts the
 * real production build and reads the status code that comes back. This file is
 * its companion and does three things that a served probe cannot:
 *
 *   M1/M2  runs the SHARED apex route model (#2240's resolver, extracted to
 *          `scripts/apex-route-model/apex-route-resolver.mjs` so both issues
 *          reason with one piece of code) over the four families and over their
 *          near-miss neighbours. Cheap enough to run on every PR that touches a
 *          routing layer, with no build.
 *
 *   M3     THE CLASS, not the four instances: every path family the LIVE iOS
 *          AASA claims must be served on the apex. Add a new claim and forget
 *          the web page, and this goes red — which is the defect #2272 fixed,
 *          generalised.
 *
 *   M4/M5  the two things #2272 promised NOT to change: no `.well-known` file
 *          (that is #2245 and a founder decision, with OS + CDN propagation
 *          consequences), and no change to what a phone WITH the app does
 *          (#2219 lands those four families on home via `+native-intent`).
 *
 *   M6     the honesty + single-owner invariants at source level, so a future
 *          edit that adds a store URL or a User-Agent branch to the landing is
 *          caught even by someone who only runs the offline lane.
 *
 * Run:  node --test scripts/issue-2272/web-app-link-landings.model.test.mjs
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildApexRouteResolver } from '../apex-route-model/apex-route-resolver.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8')

const MODEL = buildApexRouteResolver(REPO_ROOT)
const resolve = (p) => MODEL.resolve(p)

/** The four families #2272 serves, and the route file that must answer each. */
const FAMILIES = [
  { segment: 'orders', route: 'mingla-marketing/app/orders/', probes: ['/orders', '/orders/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat'] },
  { segment: 'chat', route: 'mingla-marketing/app/chat/', probes: ['/chat', '/chat/0a0870b0-c117-4707-bdf4-21fc64bebcab'] },
  { segment: 'board', route: 'mingla-marketing/app/board/', probes: ['/board', '/board/9F3KQ2'] },
  { segment: 'invite', route: 'mingla-marketing/app/invite/', probes: ['/invite', '/invite/ADA2026'] },
]

// ─── M1 — the four families resolve, and the model is reading real files ────

test('M1 every #2272 family resolves on the apex, via its own landing route', () => {
  for (const family of FAMILIES) {
    for (const path of family.probes) {
      const r = resolve(path)
      assert.ok(
        r.resolved,
        `${path} does not resolve (${r.via}). That is the #2272 defect: a browser gets 404.`,
      )
      assert.ok(
        r.via.startsWith(family.route),
        `${path} resolves via "${r.via}", not the ${family.segment} landing. Something else is claiming it.`,
      )
    }
  }
})

test('M1 the model really read the app, and is not answering yes to everything', () => {
  assert.ok(
    MODEL.routes.patterns.length >= 30,
    `only ${MODEL.routes.patterns.length} routes discovered — the walk is not reading mingla-marketing/app`,
  )
  assert.ok(
    MODEL.redirectSources.length >= 5,
    `only ${MODEL.redirectSources.length} redirect sources parsed from next.config.ts`,
  )
  assert.ok(MODEL.vercelRewriteCount >= 1, 'no vercel.json rewrites parsed — the apex guard read nothing')
  assert.ok(!resolve('/careers').resolved, 'the apex must 404 /careers (middleware apex guard)')
})

// ─── M2 — falsifiable: the near misses must NOT resolve ─────────────────────

test('M2 near-miss neighbours of the four families still resolve to nothing', () => {
  // If any of these pass, the fix became a catch-all and M1 carries no
  // information. Each is one character away from a family that IS served.
  const unserved = [
    '/nothing-serves-this-2272',
    '/nothing-serves-this-2272/deeper/still',
    '/order/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat',
    '/chats/abc',
    '/boards/abc',
    '/invites/abc',
    '/receipts/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat',
  ]
  for (const path of unserved) {
    const r = resolve(path)
    assert.ok(!r.resolved, `${path} must NOT resolve, but the model says it does (${r.via})`)
  }
})

// ─── M3 — the class: every LIVE AASA claim is served on the apex ────────────

/**
 * One concrete probe path per AASA pattern. The map must COVER the file: an
 * unmapped pattern is a hard failure, never a skip, because an unmapped pattern
 * is exactly the case #2272 was filed for — a claim nobody checked.
 *
 * The `/s/` and `/p/` shapes are load-bearing: they are served by a middleware
 * rewrite whose regex pins the token format (16 alphanumerics, 36 hex), so a
 * lazy probe like `/p/abc` would report a false 404 for a route that works.
 */
const AASA_PROBE = {
  '/invite/*': '/invite/ADA2026',
  '/s/*': `/s/${'a1B2c3D4e5F6g7H8'}`,
  '/p/*': `/p/${'a'.repeat(36)}`,
  '/board/*': '/board/9F3KQ2',
  '/orders/*': '/orders/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat',
  '/chat/*': '/chat/0a0870b0-c117-4707-bdf4-21fc64bebcab',
}

test('M3 every path the live AASA claims is actually served on the apex', () => {
  const aasa = JSON.parse(read('mingla-marketing/public/.well-known/apple-app-site-association'))
  const details = aasa?.applinks?.details ?? []
  assert.ok(details.length >= 1, 'the AASA declares no app details — this test read the wrong file')

  const claimed = details.flatMap((d) => d.paths ?? [])
  assert.ok(claimed.length >= 6, `only ${claimed.length} AASA paths parsed — expected the full claim list`)

  for (const pattern of claimed) {
    const probe = AASA_PROBE[pattern]
    assert.ok(
      probe !== undefined,
      `the AASA claims "${pattern}" and this test has no probe for it. Add one AND make sure the apex serves it — an unchecked claim is the #2272 defect.`,
    )
    const r = resolve(probe)
    assert.ok(
      r.resolved,
      `the AASA claims "${pattern}" but the apex serves nothing at ${probe} (${r.via}). Anyone without the app who opens one gets a 404.`,
    )
  }
})

// ─── M4 — no `.well-known` file was touched (that is #2245) ─────────────────

/**
 * Measured 2026-08-18 on `origin/main` at 506e2975f, before any #2272 edit:
 *   shasum -a 256 mingla-marketing/public/.well-known/apple-app-site-association
 *   shasum -a 256 mingla-marketing/public/.well-known/assetlinks.json
 *
 * These are pinned, not asserted structurally, because the requirement is that
 * the BYTES did not move: adding or withdrawing a deep-link claim is issue
 * #2245, a founder decision, and both files are cached by the OS and by Apple's
 * CDN, so a wrong publish is slow to take back.
 *
 * If you are here because this went red: that is the guard working. Do not
 * update the hash to make it green unless #2245 is the issue you are on.
 */
const WELL_KNOWN_SHA256 = {
  'mingla-marketing/public/.well-known/apple-app-site-association':
    'f9a4f7fdaada8be1f83808f7810b0c48ca1b492e9474d07a4545c51c877bc6c0',
  'mingla-marketing/public/.well-known/assetlinks.json':
    '0d06749397a049f621089c0c377d4dbaf4c9803703b265d44b9828a029312a4d',
}

test('M4 #2272 changed no deep-link declaration file', () => {
  for (const [rel, expected] of Object.entries(WELL_KNOWN_SHA256)) {
    const actual = createHash('sha256').update(readFileSync(join(REPO_ROOT, rel))).digest('hex')
    assert.equal(
      actual,
      expected,
      `${rel} changed. Withdrawing or adding a deep-link claim is #2245, not #2272, and it propagates through the OS and Apple's CDN. If this is deliberate, it belongs in that issue.`,
    )
  }
})

// ─── M5 — a phone WITH the app is unaffected ───────────────────────────────

test('M5 the app still lands these four families on home, exactly as #2219 left it', () => {
  const nativeIntent = read('app-mobile/app/+native-intent.tsx')
  const block = /const SERVED_ROUTE_SEGMENTS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/.exec(
    nativeIntent,
  )
  assert.ok(
    block !== null,
    'could not parse SERVED_ROUTE_SEGMENTS out of app-mobile/app/+native-intent.tsx — this test must not guess what the app does with these links',
  )
  const served = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  assert.ok(served.length >= 5, `only ${served.length} app route segments parsed — the parse is wrong`)

  for (const { segment } of FAMILIES) {
    assert.ok(
      !served.includes(segment),
      `app-mobile now claims to serve "${segment}". #2272 fixed the BROWSER case only; if the app grew a real screen for it, #2245 is the issue and this expectation must move there deliberately.`,
    )
  }
  // The consequence, spelled out: anything unserved goes to HOME (#2219).
  assert.match(
    nativeIntent,
    /if \(!SERVED_ROUTE_SEGMENTS\.has\(segment\)\) return HOME;/,
    'the #2219 fallback that sends these four families to home is gone',
  )
})

// ─── M6 — the honesty and single-owner invariants, at source ───────────────

test('M6 the landing owns no device decision and no store URL', () => {
  const files = [
    'mingla-marketing/components/marketing/app-link-landing.tsx',
    'mingla-marketing/lib/app-link-landing.ts',
    ...FAMILIES.map((f) => `mingla-marketing/app/${f.segment}/[[...rest]]/page.tsx`),
  ]
  // Comments explain WHY there is no detector here and name /download's
  // behaviour, so they must come out before asserting absence.
  //
  // LINE-BASED, NOT A BLOCK-COMMENT REGEX, AND THAT IS THE WHOLE POINT. The
  // obvious `.replace(/\/\*[\s\S]*?\*\//g, '')` is a trap here: these files
  // document the paths they serve, so a header comment contains the literal
  // `/orders/*`. That `/*` opens a "block comment" which the regex then closes
  // at the next `*/` — the end of an unrelated JSDoc near the bottom — silently
  // deleting almost the entire file and leaving every assertion below asserting
  // absence in an empty string. Measured while proving fails-on-revert: with
  // that regex, planting `apps.apple.com` in the landing left this test GREEN.
  const strip = (s) =>
    s
      .split('\n')
      .filter((line) => {
        const t = line.trim()
        return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*/') || t.startsWith('*'))
      })
      .join('\n')

  for (const rel of files) {
    const src = strip(read(rel))
    // The guard the regex version did not have: an absence assertion over an
    // empty string is a check that carries no information.
    assert.ok(
      src.length > 120 && /export/.test(src),
      `stripping comments out of ${rel} left ${src.length} chars of code. Every absence assertion below would be vacuous.`,
    )
    for (const banned of [
      'apps.apple.com',
      'play.google.com',
      'APP_STORE_URL',
      'PLAY_STORE_URL',
      'resolvePlatformFromUa',
      'detectClientPlatform',
      'navigator',
      'userAgent',
      "headers()",
    ]) {
      assert.ok(
        !src.includes(banned),
        `${rel} references "${banned}". /download is the single owner of the device decision (#2272); a second copy is a second thing to keep correct, and #2217 showed how quietly that arm rots.`,
      )
    }
    assert.ok(!src.includes("'use client'"), `${rel} became a client component`)
  }
})

test('M6 the page copy cannot be widened to carry buyer input', () => {
  const lib = read('mingla-marketing/lib/app-link-landing.ts')
  // Every copy field is a union of string literals. `readonly title: string`
  // would let an order id, a brand name or anything else a buyer supplied be
  // interpolated into this page — the #2240 closed-union pattern, kept.
  for (const field of ['title', 'lede', 'detail', 'cta']) {
    assert.ok(
      new RegExp(`readonly ${field}:\\s*\\n?\\s*\\|?\\s*'`).test(lib),
      `AppLinkLandingCopy.${field} is no longer a union of string literals`,
    )
    assert.ok(
      !new RegExp(`readonly ${field}:\\s*string`).test(lib),
      `AppLinkLandingCopy.${field} was widened to \`string\`, so buyer input can now reach this page`,
    )
  }
  assert.ok(
    !/\$\{/.test(lib.split('const COPY')[1] ?? ''),
    'the copy table now interpolates. Every string on this page must be a literal.',
  )
})

test('M6 /board is not redirected to the brand surface', () => {
  // #2272 asked whether `/board/{id}` is a misspelt `/b/{brandSlug}`. It is not:
  // boardInviteService mints `mingla://board/{invite_code}` from
  // collaboration_sessions.invite_code, and deepLinkService parses `board` as
  // `board-invite`. A redirect would hand a collaboration code to a brand lookup
  // that can never match, so there must not be one.
  const nextConfig = read('mingla-marketing/next.config.ts')
  assert.ok(
    !/source:\s*'\/board/.test(nextConfig),
    "a /board redirect appeared in next.config.ts. /board/{code} is a COLLABORATION-SESSION invite code (app-mobile/src/services/boardInviteService.ts), not a brand slug — redirecting it to /b/ sends every one of them to a lookup that cannot match.",
  )
  const svc = read('app-mobile/src/services/boardInviteService.ts')
  assert.match(
    svc,
    /mingla:\/\/board\/\$\{session\.invite_code\}/,
    'the evidence this conclusion rests on moved. Re-derive what /board/{id} means before changing how the web serves it.',
  )
})
