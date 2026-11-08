// #4339 round B (C) — implementor regression test for the follow-up SEO items
// done in this round: share images, IndexNow for the apex, htmlLimitedBots,
// empty blog categories, route registration, place-card links, event covers,
// structured data (ICP pages, Organization sameAs, tools), careers, heading
// outline, and the minor fixes (404 title, /host/events contrast).
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-round-b-seo-more.implementor.test.mjs
// Built mode (ISSUE_4339_BUILT=1 after `npm run build`) also reads the HTML.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { MARKETING, makeLoader } from './issue-4339-round-b-load.mjs'

const REPO = path.resolve(MARKETING, '..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const BUILT = process.env.ISSUE_4339_BUILT === '1'
const loader = makeLoader()
after(() => loader.cleanup())

function jpegSize(file) {
  const b = fs.readFileSync(file)
  assert.equal(b.readUInt16BE(0), 0xffd8, `${file} is a JPEG`)
  let i = 2
  while (i < b.length) {
    const marker = b.readUInt16BE(i)
    const len = b.readUInt16BE(i + 2)
    if (marker >= 0xffc0 && marker <= 0xffc2) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    i += 2 + len
  }
  throw new Error(`${file}: no frame header`)
}

test('og:image: 1200×630 per Host landing page, per city and the default; large Twitter card', async () => {
  const og = await loader.load('lib/search/og-images.ts')
  const icps = await loader.load('content/host-landing/icps.ts')
  const cities = await loader.load('content/cities/registry.ts')
  for (const name of Object.keys(og.OG_IMAGES)) {
    const size = jpegSize(path.join(MARKETING, 'public', og.ogImageUrl(name)))
    assert.deepEqual(size, { width: 1200, height: 630 }, name)
  }
  for (const slug of icps.ICP_SLUGS) assert.equal(og.ogImageNameForPath(`/host/${slug}`), `host-${slug}`)
  for (const c of cities.CITY_HUBS) assert.equal(og.ogImageNameForPath(`/cities/${c.slug}`), `city-${c.slug}`)
  assert.equal(og.ogImageNameForPath('/about'), 'default')
  assert.deepEqual(jpegSize(path.join(MARKETING, 'app/opengraph-image.jpg')), { width: 1200, height: 630 }, 'root opengraph-image')
  assert.deepEqual(jpegSize(path.join(MARKETING, 'app/twitter-image.jpg')), { width: 1200, height: 630 }, 'root twitter-image')
  const meta = code(read('lib/search/metadata.ts'))
  assert.match(meta, /const image = \{ url: ogImageUrl\(ogImageNameForPath\(contract\.match\.pathname\)\), \.\.\.OG_IMAGE_SIZE, alt: contract\.title \}/)
  assert.match(meta, /images: \[image\],/)
  assert.match(meta, /card: 'summary_large_image',\s*title: contract\.title,\s*description: contract\.description,\s*images: \[image\.url\],/)
})

test('IndexNow for usemingla.com: lastmod diff, apex only, existing key', async () => {
  const mod = await import(pathToFileURL(path.join(REPO, 'scripts/search/indexnow-apex.mjs')).href)
  const before = '<urlset><url><loc>https://usemingla.com/</loc><lastmod>2026-09-01</lastmod></url><url><loc>https://usemingla.com/help</loc><lastmod>2026-11-08</lastmod></url><url><loc>https://usemingla.com/gone</loc><lastmod>2026-01-01</lastmod></url></urlset>'
  const afterXml = '<urlset><url><loc>https://usemingla.com/</loc><lastmod>2026-11-08T00:00:00.000Z</lastmod></url><url><loc>https://usemingla.com/help</loc><lastmod>2026-11-08</lastmod></url><url><loc>https://usemingla.com/host/events</loc><lastmod>2026-11-08</lastmod></url><url><loc>https://host.usemingla.com/e/x/y</loc></url><url><loc>https://usemingla.com/x?y=1</loc></url></urlset>'
  assert.deepEqual(mod.changedApexUrls(before, afterXml), ['https://usemingla.com/', 'https://usemingla.com/host/events'])
  assert.deepEqual(mod.indexNowBody(['https://usemingla.com/'], 'k'), { host: 'usemingla.com', key: 'k', keyLocation: 'https://usemingla.com/indexnow-key.txt', urlList: ['https://usemingla.com/'] })
  const src = fs.readFileSync(path.join(REPO, 'scripts/search/indexnow-apex.mjs'), 'utf8')
  assert.match(src, /process\.env\.INDEXNOW_KEY/, 'reuses the existing key name')
  assert.doesNotMatch(src, /process\.env\.(?!INDEXNOW_KEY)[A-Z_]+/, 'no other secret')
  assert.match(src, /if \(args\.confirm !== plan\.bodySha256\) throw/, 'send needs the dry-run digest')
  assert.match(fs.readFileSync(path.join(REPO, 'docs/search/README.md'), 'utf8'), /indexnow-apex\.mjs snapshot/)
})

test('htmlLimitedBots lists the AI and search crawlers', () => {
  const config = read('next.config.ts')
  assert.match(config, /htmlLimitedBots: HTML_LIMITED_BOTS,/)
  const re = /const HTML_LIMITED_BOTS =\s*(\/.+\/i)\n/.exec(config)
  assert.ok(re, 'the bot pattern')
  const pattern = eval(re[1])
  for (const ua of ['GPTBot/1.1', 'ClaudeBot/1.0', 'PerplexityBot', 'OAI-SearchBot', 'Google-Extended', 'CCBot/2.0', 'Applebot-Extended', 'Googlebot/2.1', 'bingbot/2.0']) {
    assert.ok(pattern.test(ua), ua)
  }
  assert.ok(!pattern.test('Mozilla/5.0 (iPhone) Safari'), 'a person is not a limited bot')
})

test('empty blog categories are noindex and leave the sitemap', () => {
  const page = code(read('app/blog/category/[category]/page.tsx'))
  assert.match(page, /if \(!\(await blogCategoryHasPosts\(category\.slug\)\)\) \{\s*return \{ \.\.\.metadata, robots: \{ index: false, follow: true \} \}/)
  const sitemap = code(read('app/sitemap.ts'))
  assert.match(sitemap, /const filled = await blogCategoriesWithPosts\(\)/)
  assert.match(sitemap, /const listed = \(pathname: string\) => !CATEGORY_PATHS\.has\(pathname\) \|\| filled\.has\(/)
  assert.match(sitemap, /\.filter\(\(entry\) => listed\(entry\.pathname\)\)/)
  const data = code(read('lib/blog/data.ts'))
  assert.match(data, /if \(!blogDataConfigured\(\)\) return new Set\(\)/, 'no database: no category is listed')
})

test('route registration: /locals, /creators and the agreements have one title each', async () => {
  const routes = await loader.load('lib/search/route-registry.ts')
  for (const p of ['/locals', '/creators', '/creator-agreement', '/local-agreement']) {
    const contract = routes.routeContractForPath(p)
    assert.equal(contract.lifecycle, 'search_ready', p)
    assert.equal((contract.title.match(/\bMingla\b/g) ?? []).length, 1, `${p} title names Mingla once: ${contract.title}`)
    assert.doesNotMatch(contract.title, /— Mingla$/)
  }
  for (const [file, p] of [['app/locals/page.tsx', '/locals'], ['app/creators/page.tsx', '/creators'], ['app/creator-agreement/page.tsx', '/creator-agreement'], ['app/local-agreement/page.tsx', '/local-agreement']]) {
    assert.match(code(read(file)), new RegExp(`searchRouteMetadata\\('${p}'\\)`), file)
  }
  assert.match(code(read('app/not-found.tsx')), /title: \{ absolute: 'Page not found — Mingla' \}/)
})

test('city place cards are nofollow; event covers have size, alt and next/image for event_covers', () => {
  const weekend = code(read('components/cities/city-weekend.tsx'))
  assert.match(weekend, /href=\{place\.detailHref\}\s*rel="nofollow"\s*className="wk-card"/)
  const tw = code(read('components/cities/city-this-weekend.tsx'))
  assert.match(tw, /<EventCover src=\{l\.cover\} title=\{l\.title\} \/>/)
  assert.match(tw, /export const EVENT_COVER_SIZE = \{ width: 640, height: 400 \} as const/)
  assert.match(tw, /<Image src=\{src\} alt=\{title\} \{\.\.\.EVENT_COVER_SIZE\}/)
  assert.match(tw, /<img src=\{src\} alt=\{title\} \{\.\.\.EVENT_COVER_SIZE\} loading="lazy"/)
  assert.doesNotMatch(tw, /render\/image/)
  const config = read('next.config.ts')
  assert.match(config, /pathname: '\/storage\/v1\/object\/public\/event_covers\/\*\*'/)
  assert.match(config, /eventCoversPattern\(\),/)
})

test('structured data: ICP WebPage + breadcrumb, Organization sameAs, tools WebApplication', async () => {
  const schema = await loader.load('lib/search/page-schema.ts')
  const icps = await loader.load('content/host-landing/icps.ts')
  for (const slug of icps.ICP_SLUGS) {
    const data = schema.hostLandingStructuredData(`/host/${slug}`, icps.ICP_LANDINGS[slug].name)
    const [page, crumbs] = data['@graph']
    assert.equal(page['@type'], 'WebPage')
    assert.equal(page.url, `https://usemingla.com/host/${slug}`)
    assert.equal(page.name, icps.icpLandingMeta(slug).title)
    assert.deepEqual(crumbs.itemListElement.map((c) => c.name), ['Home', 'Mingla Host', icps.ICP_LANDINGS[slug].name])
  }
  for (const [t, name] of [['events', 'Event Turnout Predictor'], ['venues', 'Venue Website Grader'], ['trips', 'Quote Any Trip'], ['pricing', 'The Undercharging Audit']]) {
    const data = schema.toolStructuredData(`/tools/${t}`, name)
    assert.equal(data['@graph'][0]['@type'], 'WebApplication')
    assert.equal(data['@graph'][0].isAccessibleForFree, true)
    assert.match(code(read(`app/tools/${t}/page.tsx`)), new RegExp(`toolStructuredData\\('/tools/${t}', '${name}'\\)`))
  }
  assert.match(code(read('app/host/[icp]/page.tsx')), /hostLandingStructuredData\(icpLandingPath\(icp\), ICP_LANDINGS\[icp\]\.name\)/)
  const graph = await loader.load('lib/search/entity-graph.ts')
  const org = graph.MINGLA_ENTITY_GRAPH['@graph'][0]
  for (const url of ['https://www.instagram.com/usemingla', 'https://www.tiktok.com/@usemingla', 'https://www.threads.com/@usemingla', 'https://www.snapchat.com/add/usemingla', 'https://www.youtube.com/@usemingla', 'https://www.facebook.com/usemingla', 'https://www.linkedin.com/company/usemingla']) {
    assert.ok(org.sameAs.includes(url), url)
  }
  const stores = await loader.load('lib/store-links.ts')
  for (const url of [stores.APP_STORE_URL, stores.PLAY_STORE_URL, stores.BUSINESS_APP_STORE_URL, stores.BUSINESS_PLAY_STORE_URL]) assert.ok(org.sameAs.includes(url), url)
  assert.ok(!org.sameAs.some((u) => /x\.com|twitter\.com/.test(u)), 'X is deprecated')
})

test('careers: one title template, JobPosting, own robots.txt and sitemap', async () => {
  const seo = await loader.load('lib/careers-seo.ts')
  assert.equal(seo.careersPageTitle('Founding Engineer — Mingla'), 'Founding Engineer')
  assert.equal(seo.careersPageTitle('Growth Lead | Mingla Careers'), 'Growth Lead')
  const role = { slug: 'founding-engineer', title: 'Founding Engineer', department: 'Engineering', location: 'Remote (US)', employment_type: 'full_time', salary_display: '$X', summary: 'Build it.', body: '## About\nBuild **Mingla**.', sort_order: 1, created_at: '2026-10-01T10:00:00Z' }
  const job = seo.jobPostingStructuredData(role)
  assert.equal(job['@type'], 'JobPosting')
  assert.equal(job.datePosted, '2026-10-01')
  assert.equal(job.employmentType, 'FULL_TIME')
  assert.equal(job.jobLocationType, 'TELECOMMUTE')
  assert.equal(job.url, 'https://career.usemingla.com/roles/founding-engineer')
  assert.equal(job.hiringOrganization.name, 'Mingla')
  assert.match(job.description, /Build Mingla/)
  const robots = seo.careersRobotsTxt()
  assert.match(robots, /Sitemap: https:\/\/career\.usemingla\.com\/sitemap\.xml/)
  assert.doesNotMatch(robots, /^Host:/m)
  const sm = seo.careersSitemapXml([role])
  assert.match(sm, /<loc>https:\/\/career\.usemingla\.com\/roles\/founding-engineer<\/loc><lastmod>2026-10-01<\/lastmod>/)
  assert.match(code(read('app/careers/layout.tsx')), /title: \{ default: CAREERS_DEFAULT_TITLE, template: CAREERS_TITLE_TEMPLATE \}/)
  assert.match(code(read('app/careers/roles/[slug]/page.tsx')), /serializeJobPosting\(jobPostingStructuredData\(role\)\)/)
  const mw = code(read('middleware.ts'))
  assert.match(mw, /if \(pathname === '\/robots\.txt' \|\| pathname === '\/sitemap\.xml'\) \{\s*const url = req\.nextUrl\.clone\(\)\s*url\.pathname = `\$\{CAREERS_PREFIX\}\$\{pathname\}`/)
  assert.ok(fs.existsSync(path.join(MARKETING, 'app/careers/robots.txt/route.ts')))
  assert.ok(fs.existsSync(path.join(MARKETING, 'app/careers/sitemap.xml/route.ts')))
})

test('headings: menu and footer group labels are not headings; /host/events contrast', () => {
  const nav = code(read('components/site/site-nav.tsx'))
  assert.match(nav, /<p className="drop-label">\{group\.title\}<\/p>/)
  assert.doesNotMatch(nav, /<h[1-6]>\{group\.title\}/)
  const footer = code(read('components/marketing/footer.tsx'))
  assert.match(footer, /<p className="sf-label">\{col\.title\}<\/p>/)
  assert.doesNotMatch(footer, /<h[1-6]\b/)
  const css = read('components/landing/landing.css')
  assert.match(css, /\[data-landing\] \.duo \.a \{\s*color: #6b675f;/)
  assert.match(css, /\[data-landing\]\[data-lp-js\] \.big \.w \{\s*color: rgba\(17, 17, 16, 0\.5\);/)
})

test('built: share image, structured data and headings in the HTML', { skip: !BUILT && 'set ISSUE_4339_BUILT=1 after npm run build' }, () => {
  const html = (route) => fs.readFileSync(path.join(MARKETING, '.next/server/app', `${route}.html`), 'utf8')
  const events = html('host/events')
  assert.match(events, /<meta property="og:image" content="https:\/\/usemingla\.com\/og\/host-events\.jpg"\/>/)
  assert.match(events, /<meta name="twitter:card" content="summary_large_image"\/>/)
  assert.match(events, /"@type":"WebPage"[\s\S]*"@type":"BreadcrumbList"/)
  const lagos = html('cities/lagos')
  assert.match(lagos, /og\/city-lagos\.jpg/)
  assert.doesNotMatch(lagos, /<h2[^>]*>(Explore|Host|Company|Legal)<\/h2>/)
  assert.match(html('tools/events'), /"@type":"WebApplication"/)
  assert.match(html('index'), /"sameAs":\["https:\/\/www\.instagram\.com\/usemingla"/)
})

// ---- D. robots.txt stance (Seth, 8 Nov) ------------------------------------
// RFC 9309 matching: the longest matching rule wins; `$` anchors the end;
// Allow wins a tie.
function allowedFor(rule, pathname) {
  const toList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])
  const match = (pattern) => {
    const anchored = pattern.endsWith('$')
    const body = anchored ? pattern.slice(0, -1) : pattern
    return anchored ? pathname === body : pathname.startsWith(body)
  }
  let best = { len: -1, allow: true }
  for (const [list, allow] of [[toList(rule.allow), true], [toList(rule.disallow), false]]) {
    for (const p of list) {
      if (!match(p)) continue
      const len = p.length
      if (len > best.len || (len === best.len && allow)) best = { len, allow }
    }
  }
  return best.allow
}

test('D. robots: training crawlers read marketing pages only; scrapers blocked; search bots everywhere', async () => {
  const mod = await loader.load('app/robots.ts')
  const robots = mod.default()
  assert.equal(robots.host, undefined, 'no Host line')
  const ruleFor = (agent) => robots.rules.find((r) => (Array.isArray(r.userAgent) ? r.userAgent : [r.userAgent]).includes(agent))
  for (const agent of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot']) {
    const rule = ruleFor(agent)
    assert.ok(rule, agent)
    for (const p of ['/', '/host', '/host/events', '/host/play', '/cities', '/cities/lagos', '/going-out', '/help', '/help/getting-the-apps', '/blog', '/blog/some-post', '/blog/category/going-out', '/tools', '/about']) {
      assert.equal(allowedFor(rule, p), true, `${agent} may read ${p}`)
    }
    for (const p of ['/c/abc', '/orders/1', '/chat', '/board/x', '/invite/x', '/api/blog/posts', '/tools/events', '/tools/events/report', '/schedule', '/event-preview', '/blog/preview/token', '/privacy-policy', '/terms-of-service', '/organiser-terms', '/delete-account', '/links', '/download', '/claim/earnings', '/about/x', '/going-out/x']) {
      assert.equal(allowedFor(rule, p), false, `${agent} may not read ${p}`)
    }
  }
  for (const agent of ['Bytespider', 'meta-externalagent', 'Diffbot', 'ImagesiftBot', 'Omgili']) {
    const rule = ruleFor(agent)
    assert.ok(rule, agent)
    assert.equal(allowedFor(rule, '/'), false, `${agent} is blocked`)
    assert.equal(allowedFor(rule, '/host'), false, `${agent} is blocked`)
  }
  for (const agent of ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User']) {
    const rule = ruleFor(agent)
    for (const p of ['/', '/tools/events', '/privacy-policy', '/schedule']) assert.equal(allowedFor(rule, p), true, `${agent} reads ${p}`)
  }
  assert.equal(robots.sitemap, 'https://usemingla.com/sitemap.xml')
  const md = fs.readFileSync(path.join(REPO, 'MARKETING.md'), 'utf8')
  assert.match(md, /AI training crawlers \(GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot\) may read the\s+marketing pages only/)
  assert.doesNotMatch(md, /model-training-only crawlers are blocked by default/)
})
