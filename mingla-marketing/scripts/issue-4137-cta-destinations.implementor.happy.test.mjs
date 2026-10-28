#!/usr/bin/env node
// MINGLA-INVARIANT: I-4137-MARKETING-CTA-DEVICE-SEAM | issue #4137 | Every marketing CTA resolves through the shared device-aware destination seam with preserved attribution.
// #4137 — implementor happy path for the device-aware CTA seam (source-only).
//
// I-4137-MARKETING-CTA-DEVICE-SEAM (machine-readable declaration):
// {"invariant":"I-4137-MARKETING-CTA-DEVICE-SEAM","issue":4137,"status":"ACTIVE",
//  "rule":"Every marketing CTA resolves through lib/cta-destination.ts. Phones get the attributed OneLink for their app; computers get /download (Explorer, with the QR panel on top once hydrated, OQ-1) or host.usemingla.com (Host). The server HTML carries the computer href plus data-cta-phone-href.",
//  "enforced_by":["AC-D5 attribution bytes","AC-D8 no URL constants outside the seam","AC-D9 boot-script parity"]}
//
// Covers: the resolveCtaDestinations / ctaHrefFor matrix for both surfaces on
// ios / android / other; hostComputerHref validation; toolAttribution hrefs are
// byte-identical to the old hand-built ones (AC-D5); no OneLink or host-web
// constant outside the seam (AC-D8); the inline boot script resolves exactly
// like resolvePlatform over a 15-agent fixture table (AC-D9), and re-points a
// pre-hydration tap at the phone href (AC-D3 mechanism).

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

// A tiny CommonJS loader for the pure lib/ modules (relative imports only).
const cache = new Map()
function load(relative) {
  const file = relative.endsWith('.ts') ? relative : `${relative}.ts`
  if (cache.has(file)) return cache.get(file).exports
  assert(fs.existsSync(path.join(ROOT, file)), `#4137: missing module ${file}`)
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  cache.set(file, module)
  const dir = path.posix.dirname(file)
  const localRequire = (spec) => {
    assert(spec.startsWith('./'), `#4137: unexpected import ${spec} in ${file}`)
    return load(path.posix.join(dir, spec.slice(2)))
  }
  Function('module', 'exports', 'require', compiled)(module, module.exports, localRequire)
  return module.exports
}

const seam = load('lib/cta-destination')
const links = load('lib/links-src')
const platform = load('lib/device-platform')
const { DEVICE_PLATFORM_BOOT_SCRIPT } = load('lib/device-platform-boot')

const EXPLORER_PHONE = 'https://go.usemingla.com/w36m?pid=mingla_web&c=explorer_nav'
const HOST_NAV_PHONE = 'https://biz.usemingla.com/ZSCW?pid=mingla_web&c=business_nav'
const HOST_HERO_PHONE = 'https://biz.usemingla.com/ZSCW?pid=mingla_web&c=business_hero'

// --- The destination matrix (spec §4.1, Seth OQ-1/OQ-3/OQ-7). -----------------
const explorer = seam.resolveCtaDestinations('explorer', links.siteAttribution('explorer_nav'))
assert.deepEqual(explorer, { computerHref: '/download', phoneHref: EXPLORER_PHONE },
  '#4137: Explorer = OneLink on phones, /download (QR) on computers')
const hostNav = seam.resolveCtaDestinations('host', links.siteAttribution('business_nav'))
assert.deepEqual(hostNav, { computerHref: 'https://host.usemingla.com', phoneHref: HOST_NAV_PHONE })
const hostCreate = seam.resolveCtaDestinations('host', links.siteAttribution('business_hero'), {
  hostComputerHref: 'https://host.usemingla.com/event/create',
})
assert.deepEqual(hostCreate, { computerHref: 'https://host.usemingla.com/event/create', phoneHref: HOST_HERO_PHONE },
  '#4137 OQ-3: create links keep their page on computers and install the app on phones')
for (const [p, want] of [['ios', EXPLORER_PHONE], ['android', EXPLORER_PHONE], ['other', '/download']]) {
  assert.equal(seam.ctaHrefFor(p, explorer), want, `#4137 explorer ${p}`)
}
for (const [p, want] of [['ios', HOST_HERO_PHONE], ['android', HOST_HERO_PHONE], ['other', 'https://host.usemingla.com/event/create']]) {
  assert.equal(seam.ctaHrefFor(p, hostCreate), want, `#4137 host create ${p}`)
}
for (const bad of ['https://evil.com', 'https://host.usemingla.com.evil.com/x', '/download', 'javascript:alert(1)']) {
  assert.throws(() => seam.resolveCtaDestinations('host', links.siteAttribution('business_hero'), { hostComputerHref: bad }),
    /hostComputerHref must be on/, `#4137: ${bad} must be rejected`)
}
// iPadOS-as-Mac (MacIntel + touch) is iOS, so it gets the store (OQ-7).
assert.equal(platform.resolvePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5), 'ios')

// --- AC-D5: tool attribution is byte-identical to the old hand-built hrefs. ---
for (const tool of ['tool_events', 'tool_trips', 'tool_pricing', 'tool_venues']) {
  const d = seam.resolveCtaDestinations('host', links.toolAttribution(tool))
  assert.equal(d.phoneHref, `https://biz.usemingla.com/ZSCW?pid=${tool}&c=${tool}`, `#4137 AC-D5 ${tool}`)
  assert.equal(d.computerHref, 'https://host.usemingla.com', `#4137 AC-D5 ${tool} computer`)
}

// --- AC-D8: no URL constant outside the seam. --------------------------------
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const SEAM = new Set(['lib/store-links.ts', 'lib/explorer-app-target.ts', 'lib/business-app-target.ts', 'lib/cta-destination.ts'])
const EXEMPT = new Set([
  'app/download/page.tsx', 'app/host/download/page.tsx', 'components/marketing/links-experience.tsx',
  'components/marketing/glass-nav.tsx', 'components/sections/organiser-home/hero.tsx',
  'components/cutout/schema.tsx', 'lib/search/entity-graph.ts',
])
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue
      walk(rel, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel)
  }
  return out
}
const offenders = []
for (const file of ['app', 'components', 'lib', 'content'].flatMap((d) => walk(d))) {
  if (SEAM.has(file) || EXEMPT.has(file)) continue
  if (/\b(BUSINESS_ONELINK_URL|EXPLORER_ONELINK_URL|BUSINESS_WEB_URL)\b/.test(stripComments(read(file)))) offenders.push(file)
}
assert.deepEqual(offenders, [], '#4137 AC-D8: CTAs must resolve through lib/cta-destination.ts, not the URL constants')
for (const file of ['app/tools/events/EventPredictorExperience.tsx', 'app/tools/trips/TripQuoterExperience.tsx',
  'app/tools/pricing/PricingAuditExperience.tsx', 'app/tools/venues/ReportView.tsx',
  'app/event-preview/EventPreviewClient.tsx', 'app/trip-preview/TripPreviewClient.tsx',
  'components/page-system/city-host-acquisition-bar.tsx', 'components/cities/city-actions.tsx',
  'components/page-system/host-selling-guide.tsx', 'components/cutout/device-cta.tsx']) {
  assert.match(read(file), /<DeviceLink\b/, `#4137: ${file} must render its CTA through DeviceLink`)
}

// --- The rendered link and the layout wiring. --------------------------------
const deviceLink = read('components/cutout/device-link.tsx')
assert.match(deviceLink, /data-cta-phone-href=\{destinations\.phoneHref\}/)
assert.match(deviceLink, /platform === null \? destinations\.computerHref : ctaHrefFor\(platform, destinations\)/)
const layout = read('app/layout.tsx')
assert.match(layout, /<head>\s*[\s\S]*?<script dangerouslySetInnerHTML=\{\{ __html: DEVICE_PLATFORM_BOOT_SCRIPT \}\} \/>/)
assert.match(layout, /suppressHydrationWarning/)
const css = read('app/globals.css')
assert.match(css, /html\[data-platform="ios"\] \[data-cta-when="phone"\]/)
assert.match(css, /html\[data-platform="android"\] \[data-cta-when="computer"\] \{ display: none; \}/)
assert(Buffer.byteLength(DEVICE_PLATFORM_BOOT_SCRIPT) <= 700, `#4137: boot script is ${Buffer.byteLength(DEVICE_PLATFORM_BOOT_SCRIPT)} bytes (budget 700)`)

// --- AC-D9: boot-script parity with resolvePlatform. --------------------------
const AGENTS = [
  ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', 'iPhone', 5],
  ['iPad classic', 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 'iPad', 5],
  ['iPadOS as Mac, touch', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', 'MacIntel', 5],
  ['iPadOS as Mac, no touch', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', 'MacIntel', 0],
  ['iPod', 'Mozilla/5.0 (iPod touch; CPU iPhone OS 12_5 like Mac OS X)', 'iPod', 5],
  ['Android phone', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', 'Linux armv8l', 5],
  ['Android tablet', 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', 'Linux aarch64', 10],
  ['Samsung Internet', 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36', 'Linux armv8l', 5],
  ['Instagram on Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 Instagram 340.0.0.22.109 Android', 'Linux armv8l', 5],
  ['Facebook on Android', 'Mozilla/5.0 (Linux; Android 14; SM-S921B; wv) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]', 'Linux armv8l', 5],
  ['Instagram on iOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 340.0.0.22.109', 'iPhone', 5],
  ['Facebook on iOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]', 'iPhone', 5],
  ['macOS Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', 'MacIntel', 0],
  ['Windows Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', 'Win32', 0],
  ['Linux Firefox', 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0', 'Linux x86_64', 0],
  ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', '', 0],
  ['empty', '', '', 0],
]
assert(AGENTS.length >= 12)

function runBoot({ ua, plat, touch }) {
  const attrs = {}
  const listeners = {}
  const anchor = {
    attrs: { href: '/download', 'data-cta-phone-href': EXPLORER_PHONE },
    getAttribute(name) { return this.attrs[name] ?? null },
    setAttribute(name, value) { this.attrs[name] = value },
  }
  const target = { closest: (sel) => (sel === 'a[data-cta-phone-href]' ? anchor : null) }
  const document = {
    documentElement: { setAttribute(name, value) { attrs[name] = value } },
    addEventListener(type, fn, opts) {
      assert.equal(opts?.capture, true, '#4137: boot listeners must run in the capture phase')
      listeners[type] = fn
    },
  }
  vm.runInNewContext(DEVICE_PLATFORM_BOOT_SCRIPT, { navigator: { userAgent: ua, platform: plat, maxTouchPoints: touch }, document })
  return { platform: attrs['data-platform'], listeners, anchor, target }
}

for (const [name, ua, plat, touch] of AGENTS) {
  const expected = platform.resolvePlatform(ua, plat, touch)
  const run = runBoot({ ua, plat, touch })
  assert.equal(run.platform, expected, `#4137 AC-D9: boot script disagrees with resolvePlatform for ${name}`)
  const types = Object.keys(run.listeners).sort()
  if (expected === 'other') {
    assert.deepEqual(types, [], `#4137: computers keep the computer href (${name})`)
  } else {
    assert.deepEqual(types, ['auxclick', 'click', 'contextmenu', 'touchstart'], `#4137: phone listeners (${name})`)
    run.listeners.click({ target: run.target })
    assert.equal(run.anchor.attrs.href, EXPLORER_PHONE, `#4137 AC-D3: a pre-hydration tap gets the phone href (${name})`)
  }
}
// A broken navigator must never throw out of the boot script.
assert.doesNotThrow(() => vm.runInNewContext(DEVICE_PLATFORM_BOOT_SCRIPT, {}))

const packageJson = JSON.parse(read('package.json'))
assert(packageJson.scripts.build.includes('issue-4137-cta-destinations.implementor.happy.test.mjs'),
  '#4137: the seam contract must run in the production build gate')

process.stdout.write(`PASS #4137 CTA seam: destination matrix, tool attribution bytes, no URL constants outside the seam, boot-script parity over ${AGENTS.length} agents\n`)
