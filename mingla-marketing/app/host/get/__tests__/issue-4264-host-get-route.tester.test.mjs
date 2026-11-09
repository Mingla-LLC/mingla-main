// #4264 — tester adversarial test for usemingla.com/host/get.
//
// The implementor test proves the happy path (one UA per platform). This file
// attacks the edges: tricky and hostile User-Agents, request parts the route
// must IGNORE (method, query string, host, referer, cookies), the closed set of
// allowed destinations, exact headers with a null body, campaign separation
// from /host/download, and that the sibling download pages were not touched.
//
// It runs the REAL route handler with no install (types stripped by node, the
// `@/lib` imports pointed at the stripped copies). Every expected URL is read
// from lib/store-links.ts and lib/links-src.ts, never written here.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test app/host/get/__tests__/issue-4264-host-get-route.tester.test.mjs

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const ROUTE = path.join(MARKETING, 'app/host/get/route.ts')
const LIB_IMPORT = /from\s+'(@\/lib\/|\.\/)([\w-]+)'/g

function strip(sourcePath, outName, dir, seen) {
  if (seen.has(outName)) return
  seen.add(outName)
  const deps = []
  const js = stripTypeScriptTypes(fs.readFileSync(sourcePath, 'utf8')).replace(
    LIB_IMPORT,
    (_m, _p, name) => {
      deps.push(name)
      return `from './${name}.mjs'`
    },
  )
  fs.writeFileSync(path.join(dir, `${outName}.mjs`), js)
  for (const dep of deps) strip(path.join(MARKETING, 'lib', `${dep}.ts`), dep, dir, seen)
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4264-tester-'))
strip(ROUTE, 'route', dir, new Set())
after(() => fs.rmSync(dir, { recursive: true, force: true }))
const load = (name) => import(pathToFileURL(path.join(dir, `${name}.mjs`)).href)
const route = await load('route')
const links = await load('store-links')
const attribution = await load('links-src')

const EXPECTED_INSTALL = `${links.BUSINESS_ONELINK_URL}?${new URLSearchParams({
  pid: attribution.SITE_PID,
  c: 'business_get',
})}`
const EXPECTED_WEB = links.BUSINESS_WEB_URL

function call(ua, { method = 'GET', url = 'https://usemingla.com/host/get', extra = {} } = {}) {
  const headers = { ...extra }
  if (ua !== undefined) headers['user-agent'] = ua
  return route.GET(new Request(url, { method, headers }))
}

// UAs the resolver (lib/device-platform.ts resolvePlatformFromUa) maps to a
// phone: an iPad/iPhone/iPod token (any case) or an "android" token (any case).
const INSTALL_UAS = {
  'iPod touch':
    'Mozilla/5.0 (iPod touch; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Android tablet (no Mobile token)':
    'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Instagram in-app on iPhone':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.22.109 (iPhone15,3; iOS 17_5; en_US; en; scale=3.00; 1290x2796; 624372178)',
  'Facebook in-app on iPhone':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.98;FBBV/612345;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5]',
  'Instagram in-app on Android':
    'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36 Instagram 340.0.0.22.109 Android (34/14; 480dpi; 1080x2340; samsung; SM-S918B; dm3q; qcom; en_US; 624372178)',
  'WhatsApp in-app webview on Android':
    'Mozilla/5.0 (Linux; Android 12; TECNO KG5k Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36',
  'Opera Mini on Android':
    'Opera/9.80 (Android; Opera Mini/36.2.2254/119.132; U; id) Presto/2.12.423 Version/12.16',
  'upper-case IPHONE': 'MOZILLA/5.0 (IPHONE; CPU IPHONE OS 18_0 LIKE MAC OS X)',
  'lower-case android': 'mozilla/5.0 (linux; android 14; pixel 8) mobile',
  'iPhone token at the end of a 64 KB UA': `${'x'.repeat(64 * 1024)} iPhone`,
}

// UAs with no phone token: the resolver returns 'other', so the route must send
// them to the web app. Includes the iPad-in-desktop-mode case the resolver
// documents as a deliberate server-side fallback.
const WEB_UAS = {
  'iPad desktop-mode Safari (Mac UA, documented fallback)':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Windows Chrome':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Linux Firefox': 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  ChromeOS:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'KaiOS (Nokia 8110)': 'Mozilla/5.0 (Mobile; Nokia_8110_4G; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5',
  'Facebook link preview': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'X/Twitter link preview': 'Twitterbot/1.0',
  'Slack link preview': 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'WhatsApp link preview fetcher': 'WhatsApp/2.23.20.0 A',
  'LinkedIn link preview': 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  'Discord link preview':
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  'Telegram link preview': 'TelegramBot (like TwitterBot)',
  curl: 'curl/8.7.1',
  'whitespace only': '    ',
  'script injection attempt': '<script>alert(1)</script>"><img src=x>',
  '64 KB of junk': 'z'.repeat(64 * 1024),
}

test('every phone UA (in-app browsers, tablets, odd case, huge UA) gets the exact attributed OneLink', () => {
  for (const [label, ua] of Object.entries(INSTALL_UAS)) {
    const res = call(ua)
    assert.equal(res.status, 307, label)
    assert.equal(res.headers.get('location'), EXPECTED_INSTALL, label)
  }
})

test('every non-phone UA (link-preview bots, desktops, KaiOS, junk) gets the bare web app', () => {
  for (const [label, ua] of Object.entries(WEB_UAS)) {
    const res = call(ua)
    assert.equal(res.status, 307, label)
    assert.equal(res.headers.get('location'), EXPECTED_WEB, label)
  }
})

test('Location is always absolute https and one of exactly two allowed values', () => {
  const store = /apps\.apple\.com|play\.google\.com|market:|itms-apps:/
  for (const ua of [...Object.values(INSTALL_UAS), ...Object.values(WEB_UAS), '', undefined]) {
    const location = call(ua).headers.get('location')
    assert.ok(location, 'Location must never be empty or missing')
    assert.ok(location === EXPECTED_INSTALL || location === EXPECTED_WEB, location)
    const parsed = new URL(location)
    assert.equal(parsed.protocol, 'https:')
    assert.equal(parsed.hash, '')
    assert.doesNotMatch(location, store, 'never a store URL directly; installs go through the OneLink')
    assert.doesNotMatch(location, /go\.usemingla\.com|onelink\.me/, 'never the consumer or raw OneLink')
  }
})

test('attribution is exactly pid + c on the install path and absent on the web path', () => {
  const install = new URL(call(INSTALL_UAS['Instagram in-app on Android']).headers.get('location'))
  assert.equal(install.origin + install.pathname, links.BUSINESS_ONELINK_URL)
  assert.deepEqual([...install.searchParams.keys()].sort(), ['c', 'pid'])
  assert.equal(install.searchParams.get('pid'), attribution.SITE_PID)
  assert.equal(install.searchParams.get('c'), 'business_get')

  const web = new URL(call(WEB_UAS['Facebook link preview']).headers.get('location'))
  assert.equal(web.search, '', 'the web app link carries no attribution or query')
  assert.equal(web.origin, new URL(links.BUSINESS_WEB_URL).origin)
})

test('method, query string, host, referer and cookies never change or leak into the answer', () => {
  const noise = {
    url: 'https://www.usemingla.com/host/get?pid=evil&c=evil&src=evil&utm_source=evil#frag',
    extra: {
      host: 'evil.example',
      'x-forwarded-host': 'evil.example',
      referer: 'https://evil.example/?pid=evil',
      cookie: 'pid=evil; c=evil',
    },
  }
  const cases = [
    [INSTALL_UAS['Facebook in-app on iPhone'], EXPECTED_INSTALL],
    [INSTALL_UAS['Android tablet (no Mobile token)'], EXPECTED_INSTALL],
    [WEB_UAS['Windows Chrome'], EXPECTED_WEB],
    [undefined, EXPECTED_WEB],
  ]
  for (const [ua, expected] of cases) {
    for (const method of ['GET', 'HEAD']) {
      const res = call(ua, { ...noise, method })
      assert.equal(res.status, 307)
      assert.equal(res.headers.get('location'), expected)
      assert.doesNotMatch(res.headers.get('location'), /evil|frag|utm_/)
    }
  }
})

test('headers are exact, nothing extra is set, and the body is null (not just empty)', () => {
  for (const ua of [INSTALL_UAS['upper-case IPHONE'], WEB_UAS['Slack link preview'], undefined]) {
    const res = call(ua)
    assert.equal(res.headers.get('cache-control'), 'private, no-store')
    assert.equal(res.headers.get('x-robots-tag'), 'noindex')
    assert.equal(res.headers.get('set-cookie'), null)
    assert.equal(res.headers.get('content-type'), null)
    assert.deepEqual([...res.headers.keys()].sort(), ['cache-control', 'location', 'x-robots-tag'])
    assert.equal(res.body, null)
    assert.equal(res.redirected, false)
  }
})

test('the answer is stateless: alternating phone and desktop calls never bleed into each other', () => {
  const phone = INSTALL_UAS['Instagram in-app on iPhone']
  const desk = WEB_UAS['Linux Firefox']
  for (let i = 0; i < 20; i += 1) {
    assert.equal(call(i % 2 ? phone : desk).headers.get('location'), i % 2 ? EXPECTED_INSTALL : EXPECTED_WEB)
  }
})

test('the module exports only GET and the force-dynamic flag (no other method, no caching knob)', () => {
  assert.deepEqual(Object.keys(route).sort(), ['GET', 'dynamic'])
  assert.equal(route.dynamic, 'force-dynamic')
})

test('/host/get is attributed separately from /host/download, and only /host/get uses business_get', () => {
  assert.deepEqual(attribution.siteAttribution('business_get'), {
    pid: attribution.SITE_PID,
    campaign: 'business_get',
  })
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const download = strip(fs.readFileSync(path.join(MARKETING, 'app/host/download/page.tsx'), 'utf8'))
  assert.match(download, /siteAttribution\('business_download'\)/)
  assert.doesNotMatch(download, /business_get/)
  const union = fs.readFileSync(path.join(MARKETING, 'lib/links-src.ts'), 'utf8')
  assert.match(union, /export type SiteCampaign =[^;]*?\|\s*'business_get'/s)
})

// #4339: this used to diff the files against origin/main, which held only
// while #4264 itself was the open change: any later, approved change to these
// pages (the #4339 redesign rewrote /download and the Host button wording in
// business-app-target.ts, Seth decision on #4339) turned it red. What #4264
// promised is that ITS change left them alone, so this diffs #4264's own merge
// commit against its parent.
const ISSUE_4264_MERGE = 'f61934d1b5'
test('the sibling download pages and the shared resolvers were left byte-identical by #4264', (t) => {
  const repo = path.resolve(MARKETING, '..')
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  try {
    git('cat-file', '-e', `${ISSUE_4264_MERGE}^{commit}`)
    git('cat-file', '-e', `${ISSUE_4264_MERGE}^^{commit}`)
  } catch {
    t.skip(`#4264's merge commit ${ISSUE_4264_MERGE} is not available in this checkout (shallow clone)`)
    return
  }
  const untouched = [
    'mingla-marketing/app/host/download/page.tsx',
    'mingla-marketing/app/download/page.tsx',
    'mingla-marketing/lib/device-platform.ts',
    'mingla-marketing/lib/business-app-target.ts',
    'mingla-marketing/lib/store-links.ts',
  ]
  // The change did touch the route it added, so the diff is real, not empty by accident.
  assert.match(git('diff', '--name-only', `${ISSUE_4264_MERGE}^`, ISSUE_4264_MERGE), /mingla-marketing\/app\/host\/get\//)
  const changed = git('diff', '--name-only', `${ISSUE_4264_MERGE}^`, ISSUE_4264_MERGE, '--', ...untouched)
  assert.equal(changed, '', `#4264 must leave these unchanged:\n${changed}`)
})
