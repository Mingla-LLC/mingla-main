// #4339 — Seth's CTA rule for usemingla.com, his words: "Why does the use
// mingla button anywhere go to host? it should go to explorer and if it is
// meant to go to host, it should say host."
//
//   1. A button or link labelled "Use Mingla" / "Get Mingla" (no "Host") goes
//      to the Explorer hand-off (Explorer store on a phone, the Explorer QR
//      sheet on a computer).
//   2. A button or link that goes to Mingla Host (Host OneLink, Host stores,
//      host.usemingla.com, the Host hand-off sheet) says "Host" in its visible
//      label and in its accessible name, on BOTH devices.
//   3. /creators is an Explorer page (Creators sign up in Explorer).
//
// Source mode builds the CTA table from every DeviceLink / DeviceCta /
// HostHandoffButton / ExplorerHandoffButton / CityDeviceAction call site in
// app/ and components/, resolves each label (prop, children or the component's
// default) and checks the rule. A label it cannot resolve FAILS: a new CTA
// must be readable here, so the rule cannot be dodged by an expression.
// CTA_TABLE=1 prints the table.
//
// Built mode (ISSUE_4339_BUILT=1, after `next build`) scans every prerendered
// page's anchors: the device-aware ones by `data-cta-surface`, the rest by
// href, and checks the phone label, the computer label and the accessible
// name separately.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const BUILT = process.env.ISSUE_4339_BUILT === '1'

const SAYS_HOST = /\bhost/i
const PLAIN_MINGLA = /\b(use|get) mingla\b(?! host)/i

// ---- the rule --------------------------------------------------------------
/** Returns the broken rule for one CTA row, or null. */
export function ruleBreak({ destination, labels }) {
  for (const label of labels) {
    if (destination === 'host' && !SAYS_HOST.test(label)) return `goes to Mingla Host but "${label}" does not say Host`
    if (destination !== 'explorer' && PLAIN_MINGLA.test(label)) return `"${label}" goes to ${destination}, not Explorer`
  }
  return null
}

test('the rule itself: Host without "Host" and a plain "Use Mingla" to Host both fail', () => {
  assert.match(ruleBreak({ destination: 'host', labels: ['Use Mingla Web'] }), /does not say Host/)
  assert.match(ruleBreak({ destination: 'host', labels: ['Use Mingla'] }), /does not say Host/)
  assert.match(ruleBreak({ destination: 'host', labels: ['Get Mingla Host', 'Use Mingla'] }), /does not say Host/)
  assert.equal(ruleBreak({ destination: 'host', labels: ['Get Mingla Host', 'Use Mingla Host'] }), null)
  assert.equal(ruleBreak({ destination: 'host', labels: ['Host in Lagos', 'Continue on host.usemingla.com'] }), null)
  assert.equal(ruleBreak({ destination: 'explorer', labels: ['Use Mingla', 'Get Mingla to join'] }), null)
  assert.match(ruleBreak({ destination: 'web', labels: ['Get Mingla'] }), /not Explorer/)
})

// ---- source: the CTA table ---------------------------------------------------
const TAGS = ['DeviceLink', 'DeviceCta', 'HostHandoffButton', 'ExplorerHandoffButton', 'CityDeviceAction']

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(MARKETING, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      walk(rel, out)
    } else if (/\.tsx$/.test(entry.name)) out.push(rel)
  }
  return out
}

/** The end of a JSX opening tag that starts at `from` (skips `{…}` and strings). */
function openingTagEnd(src, from) {
  let depth = 0
  let quote = null
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return { end: i, selfClosing: src[i - 1] === '/' }
  }
  throw new Error('unterminated JSX tag')
}

function prop(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}=(?:"([^"]*)"|\\{\`([^\`]*)\`\\}|\\{'([^']*)'\\})`))
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

/** The values an expression label can take, read from where it is defined. */
function hostDestinationLabels() {
  return [...code(read('components/page-system/city-host-acquisition-bar.tsx')).matchAll(/\{ label: '([^']+)', href:/g)].map((m) => m[1])
}
function guideHostActions() {
  return [...code(read('content/page-system/host-guide-family.ts')).matchAll(/hostAction: '([^']+)'/g)].map((m) => m[1])
}
function hostHandoffDefaults() {
  const src = code(read('components/landing/host-handoff.tsx'))
  return [src.match(/<span data-cta-when="phone">([^<]+)<\/span>/)[1], src.match(/<span data-cta-when="computer">([^<]+)<\/span>/)[1]]
}
function explorerHandoffDefault() {
  return code(read('components/landing/explorer-handoff.tsx')).match(/\{children \?\? '([^']+)'\}/)[1]
}
/** DeviceCta's defaults per surface, read from its source. */
function deviceCtaDefaults(surface) {
  const src = code(read('components/cutout/device-cta.tsx'))
  const pick = (name) => {
    const m = src.match(new RegExp(`const ${name} = \\w+ \\?\\? (?:\\(surface === 'host' \\? '([^']+)' : '([^']+)'\\)|'([^']+)')`))
    assert.ok(m, `device-cta.tsx: ${name} default not readable`)
    return m[3] ?? (surface === 'host' ? m[1] : m[2])
  }
  return [pick('phoneText'), pick('computerText')]
}

// An expression in a label → the strings it renders. Anything else is unresolved.
const EXPRESSIONS = {
  '{destination.label}': hostDestinationLabels,
  '{guide.hostAction}': guideHostActions,
  '{label}': null, // a pass-through wrapper (its call sites are rows of their own)
  '{text}': null,
  '{children ?? \'Use Mingla\'}': null,
  '{body}': null, // city-this-weekend StripLink: pinned below
  '{copy.handoff}': null,
  // Names inside a fixed sentence (the sentence carries the Host word).
  '{model.hostCity}': () => ['<city>'],
}

/** JSX children with every tag (and its attributes) dropped, text and `{…}` kept. */
function stripTags(src) {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '<' && /[A-Za-z/]/.test(src[i + 1] ?? '')) {
      i = openingTagEnd(src, i + 1).end
      out += ' '
    } else out += src[i]
  }
  return out
}

/** Visible text of JSX children: tags dropped, known expressions resolved. */
function childLabels(children, where) {
  let text = children
  // A Toolkit row that goes to Host renders its "Use Mingla Host" pill.
  text = text.replace(/<ToolkitRow\b[^>]*\btoHost\b[^>]*\/>/g, ' Use Mingla Host ')
  if (/<ToolkitRow\b/.test(text)) throw new Error(`${where}: a ToolkitRow without toHost inside a Host hand-off`)
  text = stripTags(text)
  const exprs = [...text.matchAll(/\{[^{}]*\}/g)].map((m) => m[0]).filter((e) => !/^\{\s*\}$/.test(e))
  let variants = [text]
  for (const expr of exprs) {
    if (expr === '{body}' || /^\{\s*$/.test(expr)) continue
    if (!(expr in EXPRESSIONS)) throw new Error(`${where}: unresolved label expression ${expr} — add it to the resolver`)
    const resolve = EXPRESSIONS[expr]
    if (!resolve) continue
    variants = variants.flatMap((v) => resolve().map((value) => v.replace(expr, ` ${value} `)))
  }
  return variants
    .map((v) => v.replace(/<[^>]+>/g, ' ').replace(/\{[^{}]*\}/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export function ctaTable() {
  const rows = []
  for (const rel of [...walk('app'), ...walk('components')]) {
    const src = code(read(rel))
    const re = new RegExp(`<(${TAGS.join('|')})\\b`, 'g')
    let m
    while ((m = re.exec(src))) {
      const tag = m[1]
      const line = src.slice(0, m.index).split('\n').length
      const where = `${rel}:${line}`
      const { end, selfClosing } = openingTagEnd(src, m.index + 1)
      const attrs = src.slice(m.index, end)
      const children = selfClosing ? '' : src.slice(end + 1, src.indexOf(`</${tag}>`, end))
      let destination =
        tag === 'HostHandoffButton' ? 'host' : tag === 'ExplorerHandoffButton' ? 'explorer' : prop(attrs, 'surface')
      // Pass-through wrappers (surface={surface}) — their call sites are rows.
      if (!destination) {
        if (/surface=\{surface\}/.test(attrs)) continue
        throw new Error(`${where}: <${tag}> has no readable surface`)
      }
      let labels
      // A Host CTA's label must be readable here, never an opaque expression.
      if (destination === 'host' && /\b(label|phoneLabel|desktopLabel)=\{(?![`'])/.test(attrs)) throw new Error(`${where}: a Host CTA with an unreadable label prop`)
      const label = prop(attrs, 'label')
      if (label !== null) labels = [label]
      else if (tag === 'DeviceCta' || tag === 'CityDeviceAction') {
        const [phone, computer] = deviceCtaDefaults(destination)
        labels = [prop(attrs, 'phoneLabel') ?? phone, prop(attrs, 'desktopLabel') ?? computer]
      } else if (children.trim() === '' || /^\s*\{children \?\? /.test(children)) {
        if (/^\s*\{children \?\? /.test(children)) continue // the wrapper's own default (pinned via the call sites)
        labels = tag === 'HostHandoffButton' ? hostHandoffDefaults() : tag === 'ExplorerHandoffButton' ? [explorerHandoffDefault()] : []
      } else {
        // The pin strip's body is admin text; the Host tag is pinned separately below.
        if (children.trim() === '{body}') {
          labels = destination === 'host' ? ['Mingla Host · <when> <title>'] : ['<when> <title>']
        } else labels = childLabels(children, where)
      }
      if (labels.length === 0) throw new Error(`${where}: <${tag}> has no label`)
      rows.push({ where, tag, destination, labels })
    }
  }
  return rows
}

test('source: every CTA on usemingla.com follows the rule (the CTA table)', () => {
  const rows = ctaTable()
  if (process.env.CTA_TABLE === '1') {
    for (const r of rows) console.log(`${r.where}\t${r.labels.join(' / ')}\t${r.destination}`)
  }
  assert.ok(rows.length >= 40, `the table found the CTAs (${rows.length})`)
  assert.ok(rows.some((r) => r.destination === 'host') && rows.some((r) => r.destination === 'explorer'))
  const broken = rows.map((r) => [r.where, ruleBreak(r)]).filter(([, why]) => why)
  assert.deepEqual(broken, [], `CTAs that break Seth's rule:\n${broken.map(([w, why]) => `  ${w}: ${why}`).join('\n')}`)
})

test('source: the Host defaults say Host on both devices; the Explorer default is "Use Mingla"', () => {
  assert.deepEqual(hostHandoffDefaults(), ['Get Mingla Host', 'Use Mingla Host'])
  assert.deepEqual(deviceCtaDefaults('host'), ['Get Mingla Host', 'Use Mingla Host'])
  assert.deepEqual(deviceCtaDefaults('explorer'), ['Use Mingla', 'Use Mingla'])
  assert.equal(explorerHandoffDefault(), 'Use Mingla')
  // The nav: Host pages use the Host hand-off with its default (now "Use Mingla Host").
  const nav = code(read('components/site/site-nav.tsx'))
  assert.match(nav, /surface === 'host' \? \(\s*<HostHandoffButton location="nav" className="btn cta nav-cta" \/>\s*\) : \(\s*<ExplorerHandoffButton location="nav" className="btn cta nav-cta" \/>/)
})

test('source: the Host sheets, /download, /host/download, /links and Ari name Host on every Host button', () => {
  const sheet = code(read('components/landing/handoff-sheet.tsx'))
  assert.match(sheet, /<StoreButtons stores=\{hrefs\.stores\} onStore=\{onStore\} host=\{sheet === 'host'\} \/>/)
  assert.match(sheet, /\{host \? 'Get Mingla Host on the' : 'Download on the'\}/)
  assert.match(sheet, /\{host \? 'Get Mingla Host on' : 'Get it on'\}/)
  assert.match(sheet, /Continue on \{hostWebLabel\(hrefs\.computerHref\)\}/, 'Continue on host.usemingla.com')

  const download = code(read('app/download/page.tsx'))
  const hostPanel = download.slice(download.indexOf('const hostPanel'), download.indexOf('return ('))
  assert.match(hostPanel, /aria-label="Get Mingla Host on the App Store"[\s\S]*<small>Get Mingla Host on the<\/small>/)
  assert.match(hostPanel, /aria-label="Get Mingla Host on Google Play"[\s\S]*<small>Get Mingla Host on<\/small>/)
  assert.match(hostPanel, /Or use Mingla Host on web/)

  const choice = code(read('lib/business-app-target.ts'))
  assert.match(choice, /download: '([^']*Host[^']*)'/, '/host/download install button says Host')
  assert.match(choice, /useWeb: '([^']*Host[^']*)'/, '/host/download web button says Host')

  const linksPage = code(read('components/marketing/links-experience.tsx'))
  assert.match(linksPage, /const host = app === 'host' \? 'Mingla Host on ' : ''/)
  assert.match(linksPage, /\{host\}App Store[\s\S]*\{host\}Google Play/)

  assert.match(code(read('components/site/site-prompt-demo.tsx')), /Continue on Mingla Host <ArrowRight/)
  // A Host pin on the city strip says Host whatever its admin title.
  assert.match(code(read('components/cities/city-this-weekend.tsx')), /\{pin\.opens === 'host' \? `Mingla Host · \$\{when\}` : when\}/)
  // A Toolkit row that opens host web keeps its "Use Mingla Host" pill on a phone.
  assert.match(code(read('components/site/site.css')), /\.list-item \.go\.to-host \{\s*display: inline-flex;/)
})

test('source: "Mingla Web" is retired from every rendered label', () => {
  for (const rel of [...walk('app'), ...walk('components')]) {
    assert.doesNotMatch(code(read(rel)), /Mingla Web\b/, `${rel}: says "Mingla Web"`)
  }
})

test('source: /creators and the Creator agreement are Explorer pages; Host-audience pages stay Host', () => {
  assert.match(code(read('app/creators/page.tsx')), /<SitePage surface="explorer">/)
  assert.doesNotMatch(code(read('app/creators/page.tsx')), /surface="host"/)
  assert.match(code(read('components/site/legal-shell.tsx')), /<SitePage surface=\{current === 'organiser' \? 'host' : 'explorer'\}>/)
  for (const rel of ['app/tools/page.tsx', 'app/help/page.tsx', 'app/help/[slug]/page.tsx', 'app/schedule/page.tsx']) {
    assert.match(code(read(rel)), /<SitePage surface="host"/, `${rel}: Host page`)
  }
})

// ---- built: every prerendered page ------------------------------------------
const APP = path.join(MARKETING, '.next/server/app')

function htmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) htmlFiles(full, out)
    else if (entry.name.endsWith('.html')) out.push(full)
  }
  return out
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
const textOf = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
/** Drops aria-hidden elements (marks and arrows; no nesting of the same tag in these). */
const visible = (html) => html.replace(/<(span|svg|i)\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, ' ')

/** The app URLs, read from lib/store-links.ts (the one place they live). */
function storeUrl(name) {
  const m = code(read('lib/store-links.ts')).match(new RegExp(`export const ${name} =\\s*'([^']+)'`))
  assert.ok(m, `lib/store-links.ts: ${name}`)
  return m[1]
}
const HOST_URLS = ['BUSINESS_APP_STORE_URL', 'BUSINESS_PLAY_STORE_URL', 'BUSINESS_WEB_URL', 'BUSINESS_ONELINK_URL'].map(storeUrl)
const EXPLORER_URLS = ['APP_STORE_URL', 'PLAY_STORE_URL', 'EXPLORER_ONELINK_URL'].map(storeUrl)
// #4339 (release fix): a live listing card ("This weekend" on a city page,
// lib/cta-destination.ts resolveListingDestinations) opens the listing's PUBLIC
// page on the host web app on a computer (/e, /t or /exp/<brand>/<slug>) and
// the Explorer OneLink on a phone. That is a guest's listing page, not the Host
// product, so it is not a Host CTA. Only a build with the Supabase env renders
// listings; a card whose phone href is not Explorer stays a Host CTA.
const LISTING_PAGE = new RegExp(`^${storeUrl('BUSINESS_WEB_URL').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:e|t|exp)/[^/?#]+/[^/?#]+$`)
export function isListingPage(href, phoneHref) {
  return LISTING_PAGE.test(href) && typeof phoneHref === 'string' && phoneHref.startsWith(storeUrl('EXPLORER_ONELINK_URL'))
}

export function builtRows(html, page) {
  const rows = []
  for (const m of html.replace(/<script\b[\s\S]*?<\/script>/g, '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const [, attrs, inner] = m
    const surface = attrs.match(/data-cta-surface="(\w+)"/)?.[1]
    const href = decode(attrs.match(/href="([^"]*)"/)?.[1] ?? '')
    let destination = surface ?? null
    const phoneHref = decode(attrs.match(/data-cta-phone-href="([^"]*)"/)?.[1] ?? '')
    if (!destination) {
      if (isListingPage(href, phoneHref)) destination = 'listing'
      else if (HOST_URLS.some((u) => href.startsWith(u)) || href.startsWith('/host/download') || href.startsWith('/host/get') || href === '/download?app=host') destination = 'host'
      else if (EXPLORER_URLS.some((u) => href.startsWith(u)) || href === '/download') destination = 'explorer'
      else destination = 'web'
    }
    const ariaLabel = attrs.match(/aria-label="([^"]*)"/)?.[1]
    const phone = inner.match(/<span data-cta-when="phone"[^>]*>([\s\S]*?)<\/span>/)?.[1]
    const computer = inner.match(/<span data-cta-when="computer"[^>]*>([\s\S]*?)<\/span>/)?.[1]
    const labels = phone !== undefined && computer !== undefined ? [textOf(phone), textOf(computer)] : [textOf(visible(inner))]
    if (ariaLabel) labels.push(decode(ariaLabel))
    if (labels.every((l) => !l)) continue
    // Only anchors that leave for an app (or claim to) are CTAs for this rule.
    if ((destination === 'web' || destination === 'listing') && !labels.some((l) => PLAIN_MINGLA.test(l))) continue
    rows.push({ where: `${page} ${href}`, destination, labels: labels.filter(Boolean) })
  }
  return rows
}

test('built rows: a live listing card (public page on a computer, Explorer on a phone) is not a Host CTA; Host app links still are', () => {
  const web = storeUrl('BUSINESS_WEB_URL')
  const explorer = storeUrl('EXPLORER_ONELINK_URL')
  const host = storeUrl('BUSINESS_ONELINK_URL')
  const card = (href, phone) => `<a class="wk-card" href="${href}" data-cta-phone-href="${phone}" data-weekend-listing="event"><span class="kind">Event · Fri–Sun</span><h3>Boat Day</h3></a>`
  const rows = (html) => builtRows(html, 'cities/x.html')
  assert.deepEqual(rows(card(`${web}/e/brand/boat-day`, `${explorer}?pid=mingla_web`)), [], 'listing card is a guest page, not a Host CTA')
  assert.deepEqual(rows(card(`${web}/exp/brand/tour`, `${explorer}?pid=mingla_web`)), [])
  // Not a listing: phone goes to Host, or the href is not a listing page.
  assert.match(ruleBreak(rows(card(`${web}/e/brand/boat-day`, `${host}?pid=mingla_web`))[0]), /does not say Host/)
  assert.match(ruleBreak(rows(card(`${web}/e/brand`, `${explorer}?pid=mingla_web`))[0]), /does not say Host/)
  assert.match(ruleBreak(rows(`<a href="${web}/create">Start here</a>`)[0]), /does not say Host/)
  // A listing card labelled "Use Mingla" still breaks the rule.
  assert.match(ruleBreak(rows(`<a href="${web}/e/brand/boat-day" data-cta-phone-href="${explorer}">Use Mingla</a>`)[0]), /not Explorer/)
})

test('built: no prerendered page has a Host CTA without "Host" or a plain "Use Mingla" that is not Explorer', { skip: !BUILT }, async () => {
  const files = htmlFiles(APP)
  assert.ok(files.length > 50, `prerendered pages found (${files.length})`)
  const broken = []
  let host = 0
  for (const file of files) {
    const page = path.relative(APP, file)
    for (const row of builtRows(fs.readFileSync(file, 'utf8'), page)) {
      if (row.destination === 'host') host++
      const why = ruleBreak(row)
      if (why) broken.push(`${row.where}: ${why}`)
    }
  }
  assert.ok(host > 20, `Host CTAs were found in the build (${host})`)
  assert.deepEqual(broken, [], `built CTAs that break Seth's rule:\n${broken.slice(0, 40).join('\n')}`)
})

test('built: the nav says "Use Mingla" on Explorer pages and "Use Mingla Host" on Host pages; /creators is Explorer', { skip: !BUILT }, () => {
  const nav = (page) => {
    const html = fs.readFileSync(path.join(APP, page), 'utf8')
    const header = html.match(/<header\b[^>]*data-site-nav=""[^>]*data-surface="(\w+)"[\s\S]*?<\/header>/) ?? html.match(/<header\b[^>]*data-surface="(\w+)"[^>]*data-site-nav=""[\s\S]*?<\/header>/)
    assert.ok(header, `${page}: the site nav`)
    return { surface: header[1], html: header[0] }
  }
  for (const page of ['index.html', 'creators.html', 'going-out.html', 'cities.html', 'about.html', 'locals.html']) {
    const { surface, html } = nav(page)
    assert.equal(surface, 'explorer', `${page}: Explorer surface`)
    assert.match(html, /data-cta-surface="explorer"[^>]*>Use Mingla</, `${page}: "Use Mingla" to Explorer`)
    assert.doesNotMatch(html, /data-cta-surface="host"/, `${page}: no Host hand-off in the nav`)
  }
  for (const page of ['host.html', 'tools.html', 'help.html', 'schedule.html']) {
    if (!fs.existsSync(path.join(APP, page))) continue
    const { surface, html } = nav(page)
    assert.equal(surface, 'host', `${page}: Host surface`)
    assert.match(html, /<span data-cta-when="phone">Get Mingla Host<\/span><span data-cta-when="computer">Use Mingla Host<\/span>/, `${page}: the Host nav button says Host`)
  }
})
