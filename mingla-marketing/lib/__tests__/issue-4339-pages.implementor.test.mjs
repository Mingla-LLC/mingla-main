// #4339 phase 2b — implementor regression test for the redesigned inner pages:
// Going out, Cities, the city page, Get the app, Free tools, About, Locals,
// Creators, the careers index, Blog, Help, Support, the six legal documents,
// Delete account and Unsubscribe.
//
// Source mode (default, no install): reads the source, and runs the real
// hand-off seam (lib/app-handoff.ts → lib/cta-destination.ts) with node's
// TypeScript type stripping. Built mode (`npm run test:issue-4339:built` after
// `npm run build`, i.e. ISSUE_4339_BUILT=1) also reads the prerendered HTML
// and, when Chrome is installed, presses the filter chips in a real browser.
//
// Pins:
//   - THE LEGAL TEXT DID NOT CHANGE: each document's <article> text in the
//     built page hashes to the value it had before the redesign (taken from
//     the pre-redesign build of fd8c08a616), and the six content modules keep
//     their bytes;
//   - no "Privacy choices" text or link anywhere (the #4318 strip is the only
//     privacy control, §9/§10);
//   - careers: "No open roles right now." + "Follow @usemingla", and NO email
//     sign-up form (§7); no "Notify me" form on the cities pages;
//   - the filter chips are <button aria-pressed> in one swipeable row and they
//     filter (Going out guides, the city "This weekend" chips, Help, the
//     Get the app toggle);
//   - every hand-off goes through the seam: Explorer buttons are the shared
//     ExplorerHandoffButton (Creators' "Get Mingla to join" too), Get the app
//     reads lib/app-handoff.ts, and no new file holds a store, OneLink or host
//     URL;
//   - the brand faces load on these routes through app/site-fonts.ts.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-pages.implementor.test.mjs

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const BUILT = process.env.ISSUE_4339_BUILT === '1'

// ---- the legal documents ---------------------------------------------------
// Article-text hashes of the PRE-redesign build (fd8c08a616, 8 Nov 2026): the
// text of the one <article> on each page, tags and comments removed, entities
// decoded, whitespace collapsed (articleText below).
// Privacy: re-pinned after #4349 (merged on main, 33d6973942) moved only
// PRIVACY_EFFECTIVE_DATE from 'October 22, 2026' to 'November 9, 2026'; the
// redesign itself still changes no legal word (the article text with the old
// date put back still hashes to c8e76e28…, the pre-redesign pin).
// #4339: re-pinned (privacy and terms) after merging origin/main 28f88fea6d: #4334 (#4350) replaced the former map vendor's processor line with Google's address, geocoding and map-image services in lib/privacyContent.ts. That is main's approved legal change, not the redesign's.
const LEGAL = {
  'privacy-policy': { key: 'privacy', module: 'lib/privacyContent.ts', text: 'ac7e165cfb62ebc598371efe8e52f3aab91989848032430d90bf4369e44678f3', moduleSha: 'd76f0d71069e7d33cec417f790c8bf9699c80f144929bb77e29f9e01c7e862e7' },
  'terms-of-service': { key: 'terms', module: 'lib/termsContent.ts', text: '4a54ce1728ae12f75c349f3f39b1f5b2b0bfd99fa5b6828f90786fdfdf5a3fe9', moduleSha: '4d5c225a822ecb8e631b40820e5eebbabf0c7f96ce574189399943a34d383674' },
  'organiser-terms': { key: 'organiser', module: 'lib/organiserTermsContent.ts', text: '39f27a554b33a65e4433770b067b6593c78833feab64992ab837c107abcb64b8', moduleSha: '20e189ed504b312ee689516957a0db970d787413c741df70cfd8e0ba3451dde3' },
  'sms-terms': { key: 'sms', module: 'lib/smsTermsContent.ts', text: 'a9da87ccc105805c96a254ca6aa28d55071bf598ec9205d35be7d7a90f627fd0', moduleSha: '5e5bc19c3e54739c8ee4eeed7b2f36549843099b6d7c6b03fb77867fd72abbad' },
  'creator-agreement': { key: 'creator', module: 'lib/creatorAgreementContent.ts', text: 'b94c973ab5d7e82bad68f8a415ee738a08645248f65ddb8f107fba680ec631cc', moduleSha: '3cb320d01602848ea026acd6ecaa8d48b63929d84938daca6664606fcd436c9d' },
  'local-agreement': { key: 'local', module: 'lib/localAgreementContent.ts', text: '79842486cd1a371b1d79775461abd114a973e513914d4addae59d3e92d457986', moduleSha: 'a565a4881c8794008a9e528371162cab332a860adf0aaffc1c277b0dd490296b' },
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
/** The text of the page's legal <article>, as the pre-redesign hashes were taken. */
export function articleText(html, marker) {
  const at = marker ? html.indexOf(marker) : html.indexOf('<article')
  assert.notEqual(at, -1, `no ${marker ?? '<article'} in the page`)
  const start = html.lastIndexOf('<article', at)
  const end = html.indexOf('</article>', start)
  return html
    .slice(start, end)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, c) =>
      c[0] === '#' ? String.fromCodePoint(c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10)) : (ENTITIES[c] ?? m),
    )
    .replace(/\s+/g, ' ')
    .trim()
}

// Every redesigned page module (and the shared pieces they render).
const PAGES = [
  'app/(core)/going-out/page.tsx',
  'app/(core)/cities/page.tsx',
  'app/(core)/about/page.tsx',
  'app/cities/[city]/page.tsx',
  'app/download/page.tsx',
  'app/tools/page.tsx',
  'app/locals/page.tsx',
  'app/creators/page.tsx',
  'app/careers/page.tsx',
  'app/blog/page.tsx',
  'app/blog/category/[category]/page.tsx',
  'app/help/page.tsx',
  'app/support/page.tsx',
  ...Object.keys(LEGAL).map((page) => `app/${page}/page.tsx`),
  'app/delete-account/page.tsx',
  'app/unsubscribe/page.tsx',
]
const SHARED = [
  'components/site/site-page.tsx',
  'components/site/filter-row.tsx',
  'components/site/legal-shell.tsx',
  'components/site/city-media.tsx',
  'components/site/download-toggle.tsx',
  'components/site/route-frame.tsx',
  'components/site/pages.css',
  'components/cities/city-page.tsx',
  'components/cities/city-weekend.tsx',
  'components/cities/city-this-weekend.tsx',
  'components/help/help-browser.tsx',
  'components/blog/blog-index.tsx',
  'components/blog/blog-category-tabs.tsx',
  'app/unsubscribe/UnsubscribeForm.tsx',
]

// ---- strip-types loader for the hand-off seam ------------------------------
const IMPORT = /from\s+'(@\/lib\/|\.\/)([\w-]+)'/g
function emit(sourcePath, outName, out, seen) {
  if (seen.has(outName)) return
  seen.add(outName)
  const deps = []
  const js = stripTypeScriptTypes(fs.readFileSync(sourcePath, 'utf8')).replace(IMPORT, (_m, _p, name) => {
    deps.push(name)
    return `from './${name}.mjs'`
  })
  fs.writeFileSync(path.join(out, `${outName}.mjs`), js)
  for (const name of deps) emit(path.join(MARKETING, 'lib', `${name}.ts`), name, out, seen)
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-pages-'))
after(() => fs.rmSync(out, { recursive: true, force: true }))
const seen = new Set()
emit(path.join(MARKETING, 'lib/app-handoff.ts'), 'app-handoff', out, seen)
const load = (name) => import(pathToFileURL(path.join(out, `${name}.mjs`)).href)
const handoff = await load('app-handoff')
const stores = await load('store-links')
const links = await load('links-src')

// ---------------------------------------------------------------------------
test('legal pages: the six content modules keep their bytes, and each page renders its text inside the legal layout', () => {
  for (const [page, doc] of Object.entries(LEGAL)) {
    assert.equal(sha256(fs.readFileSync(path.join(MARKETING, doc.module))), doc.moduleSha, `${doc.module}: the legal words must not change`)
    const source = code(read(`app/${page}/page.tsx`))
    assert.match(source, new RegExp(`<LegalShell current="${doc.key}">`), `${page}: rendered in the legal reading layout`)
    assert.match(source, /className=\{`\$\{landingSerif\.variable\} \$\{landingSans\.variable\} \$\{landingMono\.variable\}`\}/, `${page}: brand faces`)
  }
  const shell = code(read('components/site/legal-shell.tsx'))
  assert.match(shell, /<article className="doc" data-legal-doc=\{current\}>\s*\{children\}\s*<\/article>/, 'the document is the article, unwrapped')
  const switcher = [...shell.matchAll(/\{ key: '(\w+)', href: '([^']+)', label: '([^']+)' \}/g)].map((m) => [m[2], m[3]])
  assert.deepEqual(switcher, [
    ['/privacy-policy', 'Privacy policy'],
    ['/terms-of-service', 'Terms of service'],
    ['/organiser-terms', 'Organiser terms'],
    ['/sms-terms', 'SMS terms'],
    ['/creator-agreement', 'Creator agreement'],
    ['/local-agreement', 'Local agreement'],
  ], 'the document switcher lists the six documents')
  assert.match(shell, /aria-current=\{doc\.key === current \? 'page' : undefined\}/)
  const css = code(read('components/site/pages.css'))
  assert.match(css, /\.doc h1 \{\s*font-family: var\(--serif\);/, 'Instrument Serif title')
  assert.match(code(read('components/landing/landing.css')), /--sans: var\(--font-landing-sans, 'Geist'\)/, 'Geist body through the brand root')
})

test('no "Privacy choices" anywhere in the redesigned pages', () => {
  for (const rel of [...PAGES, ...SHARED, 'components/site/site-nav.tsx', 'components/marketing/footer.tsx']) {
    assert.doesNotMatch(code(read(rel)), /privacy choices|privacy-choices|PrivacyChoices/i, `${rel}: the #4318 strip is the only privacy control`)
  }
})

test('careers: "No open roles right now." + Follow @usemingla, and no email sign-up form; no Notify me form on cities', () => {
  const careers = code(read('app/careers/page.tsx'))
  assert.match(careers, /No open roles <em>right now\.<\/em>/)
  assert.match(careers, /const INSTAGRAM_URL = 'https:\/\/www\.instagram\.com\/usemingla'/)
  assert.match(careers, /<a className="btn ink" href=\{INSTAGRAM_URL\}[^>]*>\s*Follow @usemingla\s*<\/a>/)
  assert.doesNotMatch(careers, /<form|type="email"|Keep me posted|Notify me|newsletter/i, 'no email sign-up: nothing would receive it (§7)')
  assert.match(careers, /listOpenRoles\(\)/, 'the live job data stays')
  assert.match(careers, /href=\{`\/roles\/\$\{role\.slug\}`\}/, 'roles open their page on the careers host')
  assert.match(careers, /<SitePage surface="explorer" origin=\{SITE_ORIGIN\}>/, 'nav and footer links are absolute on usemingla.com (ORCH-1225)')
  // The apply flow keeps its frame.
  assert.match(code(read('app/careers/roles/layout.tsx')), /<CareersHeader \/>/)
  assert(fs.existsSync(path.join(MARKETING, 'app/careers/roles/[slug]/apply/page.tsx')))
  for (const rel of ['app/(core)/cities/page.tsx', 'components/cities/city-page.tsx', 'components/cities/city-weekend.tsx']) {
    assert.doesNotMatch(code(read(rel)), /<form|type="email"|Notify me/i, `${rel}: no Notify me form (§7)`)
  }
})

test('filter chips are <button aria-pressed> in one swipeable row, and they filter', () => {
  const row = code(read('components/site/filter-row.tsx'))
  assert.match(row, /<button key=\{option\} type="button" aria-pressed=\{option === value\} onClick=\{\(\) => onChange\(option\)\}>/, 'each chip is a pressed-state button')
  assert.match(row, /value === FILTER_ALL \? items : items\.filter\(\(item\) => item\.tags\.includes\(value\)\)/, 'a chip hides what does not match')
  const css = code(read('components/site/pages.css'))
  const tabs = /\[data-landing\] \.tabs \{([^}]*)\}/.exec(css)?.[1] ?? ''
  assert.match(tabs, /flex-wrap: nowrap;/, 'one row, never wraps')
  assert.match(tabs, /overflow-x: auto;/, 'swipes on a phone')
  assert.match(css, /\.tabs button,\s*\[data-landing\] \.tabs a \{[^}]*flex: none;[^}]*white-space: nowrap;[^}]*min-height: 44px;/, 'chips never squash and keep a 44px target')
  // Going out: every chip has at least one guide (no dead chip), every guide a real destination.
  const goingOut = code(read('app/(core)/going-out/page.tsx'))
  const chips = /const CHIPS = \[([^\]]+)\] as const/.exec(goingOut)[1].match(/'([^']+)'/g).map((c) => c.slice(1, -1))
  assert.deepEqual(chips, ['Date ideas', 'With friends', 'Solo', 'Family', 'Side quests'])
  const tagged = [...goingOut.matchAll(/tags: \[([^\]]*)\], city: (null|'[a-z-]+')/g)]
  assert.equal(tagged.length, 6, 'six guide tiles')
  for (const chip of chips) assert(tagged.some(([, tags]) => tags.includes(`'${chip}'`)), `chip "${chip}" filters to at least one guide`)
  assert.match(goingOut, /<FilterGrid\s+label="Filter guides"/)
  // The city page: the four weekend chips. #4339 phase 4a moved them onto the
  // live "This weekend" (city-this-weekend.tsx; its own test,
  // issue-4339-city-weekend.implementor.test.mjs, pins how they filter); the
  // ranked places sit below under their own heading.
  const weekend = code(read('components/cities/city-this-weekend.tsx'))
  assert.match(weekend, /const KINDS = \['All', 'Events', 'Experiences', 'Places'\] as const/)
  assert.match(weekend, /<FilterChips label=\{`Filter \$\{cityName\} listings`\} options=\{KINDS\} value=\{kind\} onChange=\{selectKind\} \/>/)
  assert.doesNotMatch(code(read('components/cities/city-weekend.tsx')), /FilterChips/, 'the places section has no chips of its own')
  assert.match(code(read('components/help/help-browser.tsx')), /<FilterChips\s+label="Filter help videos"/)
  assert.match(code(read('components/site/download-toggle.tsx')), /<FilterChips\s+label="Choose the app"/)
  assert.match(code(read('components/blog/blog-category-tabs.tsx')), /className="tabs"/, 'blog categories use the same chip row (each a real category page)')
})

test('hand-offs go through the seam; no new file holds a store, OneLink or host URL', () => {
  for (const rel of [...PAGES, ...SHARED]) {
    const source = code(read(rel))
    assert.doesNotMatch(source, /apps\.apple\.com|play\.google\.com|onelink\.me|https:\/\/host\.usemingla\.com/, `${rel}: URLs come from lib/cta-destination.ts`)
  }
  // Explorer buttons ("Use Mingla", "Get Mingla to apply", "Save", the About card) are the shared hand-off.
  for (const rel of ['components/cities/city-page.tsx', 'app/locals/page.tsx', 'app/creators/page.tsx', 'app/(core)/about/page.tsx']) {
    assert.match(code(read(rel)), /<ExplorerHandoffButton\b/, `${rel}: the Explorer hand-off`)
  }
  assert.match(code(read('app/locals/page.tsx')), /<ExplorerHandoffButton location="locals_apply"[^>]*>\s*Get Mingla to apply/)
  // #4339 calls: the agreement button became Book a call (issue-4339-calls pins the rest).
  assert.match(code(read('app/locals/page.tsx')), /<Link className="btn soft" href="\/schedule\/locals">\s*Book a call/)
  assert.match(code(read('app/(core)/about/page.tsx')), /<Link className="vcard text-card reveal" href="\/host">/, 'the Mingla Host card opens /host')
  assert.match(code(read('components/cities/city-page.tsx')), /<Link className="btn ink" href="\/host">\s*See Mingla Host/, 'the city page has one host button, to /host')
  assert.doesNotMatch(code(read('components/cities/city-page.tsx')), /surface="host"|HostHandoffButton|CityDeviceAction/, 'no other host button on the city page')
  // #4339 phase 4a (§4 rule 4): the one exception is the empty week's "Host
  // something in <City> →", the Host hand-off, inside "This weekend" only.
  assert.deepEqual(
    [...code(read('components/cities/city-this-weekend.tsx')).matchAll(/<HostHandoffButton location="([a-z_]+)"/g)].map((m) => m[1]),
    ['city_strip', 'city_quiet', 'city_quiet'],
    'Host hand-offs on the city page: a Host admin strip, and Host something in <City> in the quiet and fallback branches',
  )
  // Get the app reads the seam.
  const download = code(read('app/download/page.tsx'))
  assert.match(download, /appHandoffHrefs\('explorer', siteAttribution\('explorer_nav'\)\)/)
  assert.match(download, /appHandoffHrefs\('host', siteAttribution\('business_download'\)\)/)
  assert.match(download, /if \(platform === 'ios'\) redirect\(APP_STORE_URL\)\s*if \(platform === 'android'\) redirect\(PLAY_STORE_URL\)/, 'phones still go straight to their store')
  assert.match(download, /<DownloadQr size=\{172\} \/>/, 'the Explorer QR still encodes /download')
  assert.match(download, /<a className="btn soft" href=\{host\.computerHref\}>\s*Or use Mingla Host on web/)
  // #4339 calls: creator setup is in the Explorer app, so Creators joins through
  // the Explorer hand-off; the dead host web /creator/setup link is gone.
  assert.match(code(read('app/creators/page.tsx')), /<ExplorerHandoffButton location="creators_join"[^>]*>\s*Get Mingla to join/)
  assert.equal('hostWebPageHref' in handoff, false, 'no host web page helper is left for a dead link')
  // And the stores on the computer page are the app's own listings.
  const explorer = handoff.appHandoffHrefs('explorer', links.siteAttribution('explorer_nav'))
  const host = handoff.appHandoffHrefs('host', links.siteAttribution('business_download'))
  assert.deepEqual(explorer.stores, { appStore: stores.APP_STORE_URL, googlePlay: stores.PLAY_STORE_URL })
  assert.deepEqual(host.stores, { appStore: stores.BUSINESS_APP_STORE_URL, googlePlay: stores.BUSINESS_PLAY_STORE_URL })
  assert.equal(host.computerHref, stores.BUSINESS_WEB_URL)
})

test('the redesigned pages use the site nav, one <main> and the canonical footer, and the brand faces', () => {
  const shell = code(read('components/site/site-page.tsx'))
  assert.match(shell, /<SiteNav surface=\{surface\} current=\{current\} origin=\{origin\} \/>/)
  assert.match(shell, /\{layoutMain \? children : <main id="main">\{children\}<\/main>\}/)
  assert.match(shell, /<SiteFooter surface=\{surface\} origin=\{origin\} \/>/)
  for (const rel of PAGES) {
    const source = code(read(rel))
    // #4339 phase 2c: the /tools hub takes the faces from app/tools/layout.tsx.
    const fonts = rel === 'app/tools/page.tsx' ? code(read('app/tools/layout.tsx')) : source
    assert.match(fonts, /from '@\/app\/site-fonts'/, `${rel}: imports the brand faces`)
    assert.match(source, /<SitePage\b|<LegalShell\b|<CityHub\b/, `${rel}: renders the redesigned shell`)
  }
  // Layouts that also frame untouched pages leave the redesigned ones bare.
  // (#4339 phase 2c moved the tools and the blog posts onto the new frame too;
  // issue-4339-leftovers.implementor.test.mjs pins them.)
  assert.match(code(read('app/tools/layout.tsx')), /<RouteFrame\s+bare=\{\['\/tools'\]\}\s+variant="site-tools"/)
  assert.match(code(read('app/blog/layout.tsx')), /<RouteFrame\s+bare=\{\['\/blog'\]\}\s+barePrefixes=\{\['\/blog\/'\]\}\s+framedPrefixes=\{\['\/blog\/preview\/'\]\}/)
})

// ---- built mode ------------------------------------------------------------
const APP = path.join(MARKETING, '.next/server/app')
const builtHtml = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8')

test('built: the legal article text is byte-for-byte the pre-redesign text', { skip: !BUILT }, () => {
  for (const [page, doc] of Object.entries(LEGAL)) {
    const html = builtHtml(`${page}.html`)
    assert.equal((html.match(/<article\b/g) ?? []).length, 1, `${page}: one article`)
    assert.equal(sha256(articleText(html, `data-legal-doc="${doc.key}"`)), doc.text, `${page}: the legal text changed`)
  }
})

test('built: no "Privacy choices" on any redesigned page; the hand-offs carry the seam hrefs', { skip: !BUILT }, () => {
  const pages = ['going-out', 'cities', 'about', 'tools', 'locals', 'creators', 'help', 'support', 'delete-account', 'unsubscribe', 'cities/lagos', 'cities/raleigh-nc', ...Object.keys(LEGAL)]
  for (const page of pages) {
    const html = builtHtml(`${page}.html`)
    assert.doesNotMatch(html.replace(/<script\b[\s\S]*?<\/script>/g, ''), /Privacy choices/i, `${page}: no Privacy choices`)
    assert.match(html, /data-site-nav=""/, `${page}: the site nav`)
    assert.match(html, /data-site-footer=""/, `${page}: the canonical footer`)
  }
  assert.doesNotMatch(builtHtml('creators.html'), /creator\/setup/, 'no dead creator setup link')
  assert.match(builtHtml('creators.html'), /data-cta-surface="explorer"[^>]*>Get Mingla to join/)
  assert.match(builtHtml('locals.html'), /data-cta-surface="explorer"[^>]*>Get Mingla to apply/)
  assert.match(builtHtml('locals.html'), /href="\/local-agreement"/, 'the fine print still links the agreement')
  const about = builtHtml('about.html')
  assert.match(about, /class="vcard text-card reveal" href="\/host"|href="\/host" class="vcard text-card reveal"/)
  assert.match(about, /data-cta-surface="explorer"[^>]*class="vcard text-card reveal"|class="vcard text-card reveal"[^>]*data-cta-surface="explorer"/)
  for (const href of ['/tools/venues', '/tools/events', '/tools/trips', '/tools/pricing']) assert.match(builtHtml('tools.html'), new RegExp(`href="${href}"`))
  const help = builtHtml('help.html')
  assert.match(help, /href="mailto:support@usemingla\.com"/)
  assert.match(help, /href="\/schedule"[^>]*>Book a call/)
  assert.doesNotMatch(help, /<form/, 'no Send to support form (§7)')
})

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((c) => fs.existsSync(c))

test('built + Chrome: pressing a chip filters (Going out, the city page)', { skip: !BUILT || !CHROME || typeof WebSocket !== 'function' }, async () => {
  const port = await freePort()
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: MARKETING, stdio: 'ignore' })
  const debug = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-chips-'))
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${debug}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  try {
    for (let i = 0; i < 150; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port}/robots.txt`)).ok) break } catch {}
      await sleep(200)
    }
    let target
    for (let i = 0; i < 100 && !target; i += 1) {
      try { target = (await (await fetch(`http://127.0.0.1:${debug}/json`)).json()).find((t) => t.type === 'page') } catch {}
      if (!target) await sleep(100)
    }
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
    let id = 0
    const pending = new Map()
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data))
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    })
    const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); socket.send(JSON.stringify({ id: n, method, params })) })
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value
    const until = async (expression, label) => {
      for (let i = 0; i < 100; i += 1) { if (await evaluate(expression)) return; await sleep(100) }
      assert.fail(label)
    }
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
    const press = (label) => `(()=>{const b=[...document.querySelectorAll('[data-filter-row] button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});b.click();return true})()`
    const hydrated = `(()=>{const b=document.querySelector('[data-filter-row] button');return !!b&&Object.keys(b).some(k=>k.startsWith('__reactProps'))})()`

    await send('Page.navigate', { url: `http://127.0.0.1:${port}/going-out` })
    await until(hydrated, '/going-out did not hydrate')
    assert.equal(await evaluate(`document.querySelectorAll('[data-filter-grid] > li').length`), 6)
    await evaluate(press('Solo'))
    await until(`document.querySelectorAll('[data-filter-grid] > li').length===1`, 'Solo did not filter the guides to one')
    assert.equal(await evaluate(`[...document.querySelectorAll('[data-filter-row] button')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.textContent).join()`), 'Solo')
    assert.equal(await evaluate(`document.querySelector('[data-filter-grid] h3').textContent`), 'Solo Saturday')
    await evaluate(press('All'))
    await until(`document.querySelectorAll('[data-filter-grid] > li').length===6`, 'All did not bring the six guides back')
    assert.equal(await evaluate(`(()=>{const r=document.querySelector('[data-filter-row]');return r.scrollWidth>r.clientWidth&&getComputedStyle(r).overflowX==='auto'&&document.documentElement.scrollWidth===innerWidth})()`), true, 'at 375px the chip row swipes inside itself and the page does not scroll sideways')

    // #4339 phase 4a: the chips belong to the live "This weekend" (the build
    // has no database, so it shows the fallback line); the 50 ranked places
    // sit below under their own heading and stay whatever chip is pressed.
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/cities/raleigh-nc` })
    await until(hydrated, '/cities/raleigh-nc did not hydrate')
    assert.equal(await evaluate(`document.querySelectorAll('[data-city-place-card]').length`), 50)
    await evaluate(press('Events'))
    await until(`[...document.querySelectorAll('#weekend [data-filter-row] button')].find(b=>b.getAttribute('aria-pressed')==='true')?.textContent==='Events'`, 'Events did not press')
    assert.equal(await evaluate(`document.querySelectorAll('[data-city-place-card]').length`), 50)
    socket.close()
  } finally {
    const exited = (child) => new Promise((resolve) => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 5000) } })
    chrome.kill()
    server.kill()
    await Promise.all([exited(chrome), exited(server)])
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
