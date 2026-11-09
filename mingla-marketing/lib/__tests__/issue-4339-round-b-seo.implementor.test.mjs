// #4339 round B (A) — implementor regression test for the five SEO
// ship-blockers of the 8 Nov audit:
//   1. city pages: the H1 is "Things to do in <City>" (the pill), the brand
//      line is not a heading, the H2s carry the city, a visible
//      Home / Cities / <City> breadcrumb, and the BreadcrumbList has the
//      Cities level;
//   2. /going-out renders its direct question and answer and links all ten
//      cities as "Things to do in <City>";
//   3. /about renders "What is Mingla?" and its direct answer;
//   4. each ICP page has a keyword-first title under 60 characters ending
//      "| Mingla Host", and its sub (the meta description) is 140–160
//      characters;
//   5. the sitemap lastmod of every redesigned route is the one bumpable
//      SITE_REDESIGN_LAST_MODIFIED constant; the legal texts keep theirs.
//
// Source mode (default) reads the source and loads the .ts modules with
// stripped types. Built mode (ISSUE_4339_BUILT=1 after `npm run build`) reads
// the prerendered HTML too.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-round-b-seo.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { MARKETING, makeLoader } from './issue-4339-round-b-load.mjs'

const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const BUILT = process.env.ISSUE_4339_BUILT === '1'
const loader = makeLoader()
after(() => loader.cleanup())

const decode = (v) => v.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const text = (html) => decode(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const builtHtml = (route) => fs.readFileSync(path.join(MARKETING, '.next/server/app', `${route}.html`), 'utf8')

test('1. city page: H1 pill, brand line, H2s, breadcrumb and BreadcrumbList', async () => {
  const page = code(read('components/cities/city-page.tsx'))
  assert.match(page, /<h1 className="pill glass city-h1" id="city-hub-title">\s*<MapPin aria-hidden="true" \/> Things to do in \{record\.city\}\s*<\/h1>/)
  assert.match(page, /<p className="city-brand-line">\s*<span>\{record\.city\}, what are we<\/span>/)
  assert.equal((page.match(/<h1\b/g) ?? []).length, 1, 'one H1 in the city template')
  assert.match(page, /<nav className="city-crumbs wrap" aria-label="Breadcrumb">[\s\S]*href="\/">Home<[\s\S]*href="\/cities">Cities<[\s\S]*aria-current="page">\{record\.city\}</)
  assert.match(page, /<CityHero record=\{record\} \/>\s*<CityBreadcrumb record=\{record\} \/>/)
  assert.match(code(read('components/cities/city-this-weekend.tsx')), /Things to do in \{cityName\} <em>this weekend\.<\/em>/)
  assert.match(code(read('components/cities/city-weekend.tsx')), /Top places <em>in \{cityName\}\.<\/em>/)
  // The brand line keeps the hero headline look.
  const css = read('components/site/pages.css')
  assert.match(css, /\.lp-hero \.city-brand-line \{[^}]*font-size: clamp\(46px, 7\.6vw, 120px\)/)
  assert.match(css, /\.lp-hero h1\.city-h1 \{[^}]*font-size: 11px/)

  const schema = await loader.load('lib/search/city-schema.ts')
  const registry = await loader.load('content/cities/registry.ts')
  for (const record of registry.CITY_HUBS) {
    const data = schema.cityHubStructuredData(record)
    if (!data) continue
    const crumbs = data['@graph'].find((node) => node['@type'] === 'BreadcrumbList').itemListElement
    assert.deepEqual(crumbs.map((c) => [c.position, c.name, c.item]), [
      [1, 'Home', 'https://usemingla.com/'],
      [2, 'Cities', 'https://usemingla.com/cities'],
      [3, record.city, `https://usemingla.com/cities/${record.slug}`],
    ], `${record.slug} breadcrumb`)
  }
})

test('1b. city descriptions are 140–155 characters and keyword first', async () => {
  const { CITY_META_DESCRIPTIONS } = await loader.load('content/cities/meta-descriptions.ts')
  const registry = await loader.load('content/cities/registry.ts')
  const routes = await loader.load('lib/search/route-registry.ts')
  for (const record of registry.CITY_HUBS) {
    const d = CITY_META_DESCRIPTIONS[record.slug]
    assert.ok(d, `${record.slug} has a description`)
    assert.ok(d.length >= 140 && d.length <= 155, `${record.slug} description is ${d.length} characters`)
    assert.ok(d.startsWith(`Things to do in ${record.city}`), `${record.slug} starts with the search phrase`)
    const contract = routes.routeContractForPath(`/cities/${record.slug}`)
    if (contract.lifecycle === 'search_ready') assert.equal(contract.description, d)
  }
})

test('2. /going-out renders its direct answer and links all ten cities', async () => {
  const page = code(read('app/(core)/going-out/page.tsx'))
  assert.match(page, /<h2 className="h2" id="going-out-answer">\s*\{record\.directQuestion\}\s*<\/h2>\s*<p className="lead">\{record\.directAnswer\}<\/p>/)
  assert.match(page, /CITY_HUBS\.map\(\(city\) => \([\s\S]*<Link href=\{cityHubPath\(city\)\}>\s*Things to do in \{city\.city\}/)
})

test('3. /about renders "What is Mingla?" and its direct answer', async () => {
  const page = code(read('app/(core)/about/page.tsx'))
  assert.match(page, /<h2 className="h2" id="about-what">\s*\{record\.directQuestion\}\s*<\/h2>\s*<p className="lead">\{record\.directAnswer\}<\/p>/)
  const core = read('content/core-pages.ts')
  assert.match(core, /directQuestion: 'What is Mingla\?'/)
})

test('4. ICP titles are keyword first, under 60 characters, and the sub is 140–160', async () => {
  const icps = await loader.load('content/host-landing/icps.ts')
  const expected = {
    events: 'Event ticketing & guest lists for organizers | Mingla Host',
    trips: 'Group trip payment plans & itineraries | Mingla Host',
    experiences: 'Class & workshop booking software | Mingla Host',
    restaurants: 'Restaurant reservations & venue listing | Mingla Host',
    hotels: 'Hotel day passes & resort events | Mingla Host',
    art: 'Gallery & museum ticketing and RSVPs | Mingla Host',
    play: 'Bowling, arcade & escape room bookings | Mingla Host',
  }
  assert.deepEqual([...icps.ICP_SLUGS].sort(), Object.keys(expected).sort())
  for (const slug of icps.ICP_SLUGS) {
    const meta = icps.icpLandingMeta(slug)
    assert.equal(meta.title, expected[slug])
    assert.ok(meta.title.length < 60, `${slug} title is ${meta.title.length}`)
    assert.ok(meta.title.endsWith(' | Mingla Host'))
    assert.equal(meta.description, icps.ICP_LANDINGS[slug].sub)
    assert.ok(meta.description.length >= 140 && meta.description.length <= 160, `${slug} sub is ${meta.description.length}`)
  }
})

test('5. sitemap lastmod: one bumpable redesign date; the legal texts keep theirs', async () => {
  const routes = await loader.load('lib/search/route-registry.ts')
  assert.match(routes.SITE_REDESIGN_LAST_MODIFIED, /^\d{4}-\d{2}-\d{2}$/)
  const src = read('lib/search/route-registry.ts')
  assert.match(src.replace(/\s*\*\s*/g, ' '), /set it to the day the #4339 pull request merges/, 'the constant documents how to bump it')
  for (const route of routes.searchReadyRoutes()) {
    const lastmod = routes.sitemapLastModified(route)
    if (routes.REDESIGN_UNCHANGED_ROUTE_IDS.has(route.id)) assert.equal(lastmod, route.lastModified, route.id)
    else assert.ok(lastmod >= routes.SITE_REDESIGN_LAST_MODIFIED, `${route.id} lastmod ${lastmod}`)
  }
  for (const id of ['explorer-home', 'host-home', 'core-going-out', 'core-about', 'city-hub-lagos', 'host-landing-events', 'locals', 'creators']) {
    const route = routes.searchReadyRoutes().find((r) => r.id === id)
    assert.ok(route, `${id} is search ready`)
    assert.equal(routes.sitemapLastModified(route), routes.SITE_REDESIGN_LAST_MODIFIED, id)
  }
  assert.match(code(read('app/sitemap.ts')), /lastModified: new Date\(`\$\{sitemapLastModified\(route\)\}T00:00:00\.000Z`\)/)
})

test('built: city, going-out and about HTML', { skip: !BUILT && 'set ISSUE_4339_BUILT=1 after npm run build' }, () => {
  const lagos = builtHtml('cities/lagos')
  const h1s = [...lagos.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => text(m[1]))
  assert.deepEqual(h1s, ['Things to do in Lagos'])
  assert.ok(text(lagos).includes('Lagos, what are we outside for?'))
  const h2s = [...lagos.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => text(m[1]))
  assert.ok(h2s.includes('Things to do in Lagos this weekend.'), h2s.join(' | '))
  assert.ok(h2s.includes('Top places in Lagos.'), h2s.join(' | '))
  assert.match(lagos, /<nav class="city-crumbs wrap" aria-label="Breadcrumb">/)
  const goingOut = builtHtml('going-out')
  assert.ok(text(goingOut).includes('What does Mingla Explorer help you do?'))
  for (const city of ['Lagos', 'Durham', 'Cary', 'Raleigh', 'New York City', 'Brussels', 'Paris', 'London', 'Fort Lauderdale', 'Washington, DC']) {
    assert.ok(text(goingOut).includes(`Things to do in ${city}`), `/going-out links ${city}`)
  }
  const about = builtHtml('about')
  assert.ok(text(about).includes('What is Mingla?'))
  assert.ok(text(about).includes('Mingla is one platform with an Explorer experience'))
  const events = builtHtml('host/events')
  assert.match(events, /<title>Event ticketing &amp; guest lists for organizers \| Mingla Host<\/title>/)
})
