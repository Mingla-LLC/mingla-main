#!/usr/bin/env node
// #4137 wave 3 — implementor happy path: the built blog renders real data.
//
// Starts `next start` on the built site with NEXT_PUBLIC_SUPABASE_URL pointing
// at a tiny local HTTP fixture that answers the five public blog RPCs exactly
// in the shape supabase/migrations/20280122004137_issue_4137_blog_public_reads.sql
// returns, then reads the real HTML.
//
//   AC-P1  /blog, a category page and a post: 200, self-canonical, indexable, <main> text
//   AC-P2  draft (RPC null) 404
//   AC-P3  sitemap: registry routes then one entry per public post
//   AC-P4  BlogPosting + BreadcrumbList JSON-LD, og:type article, og:image, twitter large card
//   AC-P5  place card: name, type, rating line, stored _thumb.jpg photo, no credit line; closed place absent
//   AC-P6  event card: editor title + city eyebrow + Open in Mingla; passed event absent
//   AC-P7  CTAs are DeviceLink anchors with the Explorer phone OneLink in data-cta-phone-href
//   AC-P8  no newsletter / sign-up / email field
//   AC-P9  no iframe before a click
//   AC-P10 hostile rich text renders inert
//   AC-P13 preview banner + noindex; wrong token 404
//
// MINGLA-INVARIANT: I-4137-BLOG-NO-HOST-IDENTITY | issue #4137 | blog pages show the editor's event title, never the host's title, brand or cover.
// Fails on revert: without the blog routes every request below is a 404.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (!process.argv.includes('--built-only')) {
  process.stdout.write('SKIP #4137 blog render: run with --built-only after next build\n')
  process.exit(0)
}
assert(fs.existsSync(path.join(ROOT, '.next/BUILD_ID')), '#4137: run next build first')

const PLACE_OPEN = '11111111-1111-4111-8111-111111111111'
const PLACE_CLOSED = '22222222-2222-4222-8222-222222222222'
const PLACE_TWO = '33333333-3333-4333-8333-333333333333'
const EVENT_LIVE = '44444444-4444-4444-8444-444444444444'
const EVENT_PASSED = '55555555-5555-4555-8555-555555555555'
const MEDIA_IMAGE = '66666666-6666-4666-8666-666666666666'
const PREVIEW_TOKEN = 'A'.repeat(43)
const STORED = 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJrenderTestPlace/0.jpg'

const cover = { path: 'u/cover.jpg', width: 2400, height: 1200, alt: 'The lake at dusk' }
const card = (slug, title, category = { slug: 'going-out', label: 'Going out' }) => ({
  slug, title, summary: `${title} summary.`, category, read_minutes: 4, publish_at: '2026-10-20T10:00:00Z', cover, author: { display_name: 'Mingla Editorial' },
})
const HOSTILE = [
  '<img src=x onerror=alert(1)',
  '<a href="javascript:alert(1)">js link</a>',
  '<svg><script>alert(1)</script></svg>after-svg',
  '<p onclick=alert(1)>clicky</p>',
  '<a data-mingla-target="place:../../x">bad target</a>',
]
const documentBlocks = [
  { id: 'para01', type: 'paragraph', html: `Start at <a href="/cities/raleigh-nc">Raleigh</a> and <a data-mingla-target="place:${PLACE_OPEN}">open the lake in Mingla</a>.` },
  ...HOSTILE.map((html, index) => ({ id: `hostile${index}`, type: 'paragraph', html })),
  { id: 'head01', type: 'heading', level: 2, text: 'Walk the boardwalk' },
  { id: 'place1', type: 'place', placeId: PLACE_OPEN, style: 'card' },
  { id: 'place2', type: 'place', placeId: PLACE_CLOSED, style: 'card' },
  { id: 'image1', type: 'image', mediaId: MEDIA_IMAGE, alt: 'Gallery wall', caption: 'The main room' },
  { id: 'offer1', type: 'offering', eventId: EVENT_LIVE, displayTitle: 'Bachata social, lesson included', eyebrowCity: 'Cary, NC' },
  { id: 'offer2', type: 'offering', eventId: EVENT_PASSED, displayTitle: 'A social that already happened' },
  { id: 'plan01', type: 'plan', title: 'A slow Saturday', stops: [PLACE_OPEN, PLACE_TWO, PLACE_CLOSED] },
  { id: 'video1', type: 'video', provider: 'youtube', videoId: 'dQw4w9WgXcQ', title: 'A walk around the lake' },
  { id: 'embed1', type: 'embed', provider: 'instagram', url: 'https://www.instagram.com/p/abc123/' },
  { id: 'city01', type: 'city', citySlug: 'raleigh-nc' },
]
const post = {
  ...card('a-slow-saturday', 'A slow Saturday in three stops'),
  first_published_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-21T10:00:00Z',
  hide_passed_event_cards: true,
  topics: ['raleigh'],
  published_version: {
    title: 'A slow Saturday in three stops', summary: 'A lake, a gallery and a bar.', cover,
    seo_title: null, seo_description: null, social_title: null, social_description: null,
    document: { version: 1, blocks: documentBlocks }, read_minutes: 4,
    media: { [MEDIA_IMAGE]: { path: 'u/image.jpg', width: 1600, height: 1200 } },
  },
  more_stories: [card('pricing-the-door', 'Pricing the door', { slug: 'host-playbook', label: 'Host playbook' })],
}
const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString()
const embeds = {
  places: {
    [PLACE_OPEN]: { name: 'Lakeside Park', primary_type_display_name: 'Park', city: 'Raleigh', rating: 4.7, review_count: 4940, google_place_id: 'ChIJrenderTestPlace', google_maps_uri: 'https://maps.google.com/?cid=1', stored_photo_url: STORED, open: true },
    [PLACE_TWO]: { name: 'Corner Gallery', primary_type_display_name: 'Art gallery', city: 'Raleigh', rating: null, review_count: null, google_place_id: 'ChIJrenderTestTwo', google_maps_uri: null, stored_photo_url: null, open: true },
    [PLACE_CLOSED]: { name: 'Closed Bar Never Shown', primary_type_display_name: 'Bar', city: 'Raleigh', rating: 4, review_count: 3, google_place_id: 'ChIJclosed', google_maps_uri: null, stored_photo_url: null, open: false },
  },
  offerings: {
    [EVENT_LIVE]: { event_type: 'event', city: 'Cary', is_public: true, status: 'scheduled', next_start_at: soon, next_end_at: soon, timezone: 'America/New_York', passed: false },
    [EVENT_PASSED]: { event_type: 'event', city: 'Durham', is_public: true, status: 'ended', next_start_at: null, next_end_at: null, timezone: 'America/New_York', passed: true },
  },
}
const indexBody = {
  featured: card('a-slow-saturday', 'A slow Saturday in three stops'),
  posts: [card('pricing-the-door', 'Pricing the door', { slug: 'host-playbook', label: 'Host playbook' }), card('quiet-weekends', 'Quiet weekends away')],
  total: 2,
  categories: [],
}

const calls = []
const fixture = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const name = (req.url ?? '').replace(/^\/rest\/v1\/rpc\//, '')
    const args = raw ? JSON.parse(raw) : {}
    calls.push(name)
    const reply = (value) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (req.headers.apikey !== 'anon-fixture-key') { res.writeHead(401); res.end('{}'); return }
    if (name === 'blog_public_index') return reply(args.p_category === 'host-playbook' ? { featured: null, posts: [indexBody.posts[0]], total: 1, categories: [] } : indexBody)
    if (name === 'blog_public_post') return reply(args.p_slug === 'a-slow-saturday' ? post : null)
    if (name === 'blog_public_post_embeds') return reply(args.p_slug === 'a-slow-saturday' ? embeds : {})
    if (name === 'blog_public_sitemap') return reply([{ slug: 'a-slow-saturday', last_modified: '2026-10-21T10:00:00Z' }, { slug: 'pricing-the-door', last_modified: '2026-10-19T10:00:00Z' }])
    if (name === 'blog_public_preview') return reply(args.p_token === PREVIEW_TOKEN ? { ...post, title: 'DRAFT IN PREVIEW', published_version: { ...post.published_version, title: 'DRAFT IN PREVIEW' }, embeds, preview: true, more_stories: [] } : null)
    res.writeHead(404); res.end('{}')
  })
})

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}
function get(port, pathname, userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: { Host: 'usemingla.com', 'User-Agent': userAgent } }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end()
  })
}
const withoutScripts = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '')
const mainText = (html) => (/<main[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const fixturePort = await freePort()
await new Promise((resolve) => fixture.listen(fixturePort, '127.0.0.1', resolve))
const port = await freePort()
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: ROOT,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${fixturePort}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-fixture-key' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
child.stdout.on('data', (chunk) => { log += chunk })
child.stderr.on('data', (chunk) => { log += chunk })

try {
  const deadline = Date.now() + 30_000
  for (;;) {
    try { if ((await get(port, '/robots.txt')).status === 200) break } catch { /* starting */ }
    if (Date.now() > deadline) throw new Error('next start did not come up')
    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  // AC-P1 index + category.
  const index = await get(port, '/blog')
  assert.equal(index.status, 200)
  assert.match(index.body, /<link rel="canonical" href="https:\/\/usemingla\.com\/blog"/)
  assert.doesNotMatch(index.body, /<meta name="robots" content="[^"]*noindex/)
  assert.match(index.body, /data-blog-featured="a-slow-saturday"/, '#4137: featured card')
  assert.deepEqual([...index.body.matchAll(/data-blog-card="([^"]+)"/g)].map((m) => m[1]), ['pricing-the-door', 'quiet-weekends'], '#4137: grid newest first, no featured repeat')
  assert(mainText(index.body).length >= 100)
  assert.match(index.body, /"@type":"CollectionPage"/)
  const category = await get(port, '/blog/category/host-playbook')
  assert.equal(category.status, 200)
  assert.match(category.body, /data-blog-featured="pricing-the-door"/, '#4137: newest category story takes the big card')
  assert.match(category.body, /aria-current="page"[^>]*>Host playbook</)

  // AC-P1/P4 post.
  const page = await get(port, '/blog/a-slow-saturday')
  assert.equal(page.status, 200, log)
  const html = page.body
  const visible = withoutScripts(html)
  assert.match(html, /<link rel="canonical" href="https:\/\/usemingla\.com\/blog\/a-slow-saturday"/)
  assert.match(html, /<meta name="robots" content="index, follow"/)
  assert.match(html, /<meta property="og:type" content="article"/)
  assert.match(html, /<meta property="og:image" content="https:\/\/gqnoajqerqhnvulmnyvv\.supabase\.co\/storage\/v1\/object\/public\/blog-media\/u\/cover\.jpg"/)
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/)
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
  const graph = ld.flatMap((value) => value['@graph'] ?? [value])
  const posting = graph.filter((node) => node['@type'] === 'BlogPosting')
  assert.equal(posting.length, 1, '#4137 AC-P4: one BlogPosting')
  for (const key of ['headline', 'datePublished', 'image', 'author', 'publisher']) assert(posting[0][key], `#4137 AC-P4: BlogPosting.${key}`)
  assert(graph.some((node) => node['@type'] === 'BreadcrumbList'), '#4137 AC-P4: BreadcrumbList')
  assert(mainText(html).length >= 100)
  assert.match(visible, /<h1[^>]*>A slow Saturday in three stops<\/h1>/)

  // AC-P5 place card.
  assert.match(visible, /Place · RALEIGH/)
  assert.match(visible, /Lakeside Park/)
  assert.match(visible, /Park · 4\.7 · 4,940 Google reviews/, '#4137: the city pages\' rating line')
  assert.match(visible, /src="https:\/\/gqnoajqerqhnvulmnyvv\.supabase\.co\/storage\/v1\/object\/public\/place-photos\/ChIJrenderTestPlace\/0_thumb\.jpg"/, '#4137: stored thumbnail')
  assert.doesNotMatch(visible, /_next\/image\?url=[^"]*(place-photos|googleusercontent)/, '#4137: place photos never go through the optimiser')
  assert.doesNotMatch(visible, /Photo by|Google Maps<|render\/image/, '#4137: no credit line, no transformations')
  assert.doesNotMatch(visible, /Closed Bar Never Shown/, '#4137 AC-P5: a closed place renders nothing')
  assert.match(visible, /href="https:\/\/maps\.google\.com\/\?cid=1"[^>]*>Directions</)

  // AC-P6 event card.
  assert.match(visible, /(Tonight|This week) in the Mingla app · CARY, NC/)
  assert.match(visible, /Bachata social, lesson included/)
  assert.match(visible, /Dates, prices and tickets live in the app/)
  assert.doesNotMatch(visible, /A social that already happened/, '#4137 AC-P6: a passed event card is removed')

  // Plan card skips the closed stop and keeps two.
  assert.match(visible, /A slow Saturday · 2 stops/)

  // AC-P7 — every CTA is a DeviceLink anchor for Explorer.
  const ctas = [...visible.matchAll(/<a [^>]*data-cta-surface="([a-z]+)"[^>]*>/g)]
  assert(ctas.length >= 5, '#4137: inline, place, event, plan and nav CTAs')
  for (const [anchor, surface] of ctas) {
    assert.equal(surface, 'explorer', anchor)
    assert.match(anchor, /href="\/download"/, '#4137: computer destination before hydration')
    assert.match(anchor, /data-cta-phone-href="https:\/\/[^"]+"/, '#4137: phone OneLink for the boot script')
  }
  assert.match(visible, /class="cut-cta-inline focus-ring"[^>]*>open the lake in Mingla</, '#4137: the inline app link is a DeviceCta')

  // AC-P8, AC-P9, AC-P10.
  assert.doesNotMatch(visible, /newsletter|subscribe|sign up|type="email"/i)
  assert.doesNotMatch(visible, /<iframe/i, '#4137 AC-P9: no iframe before a click')
  assert.match(visible, /Play video: A walk around the lake/)
  assert.match(visible, /Open on Instagram/)
  assert.match(visible, /Things to do in Raleigh/)
  const article = /<article>([\s\S]*?)<\/article>/.exec(visible)?.[1] ?? ''
  assert.doesNotMatch(article, /<(img|svg|script)[^>]*(onerror|onclick)|\son[a-z]+=|javascript:/i, '#4137 AC-P10: hostile text is inert')
  assert.match(article, /&lt;img src=x onerror=alert\(1\)/, '#4137 AC-P10: the fragment shows as text')
  assert.doesNotMatch(article, /href="javascript/i)

  // AC-P2 and the share row.
  assert.match(visible, />Copy link</)
  assert.match(visible, /href="https:\/\/wa\.me\/\?text=/)
  assert.doesNotMatch(visible, />Instagram</)
  assert.equal((await get(port, '/blog/still-a-draft')).status, 404, '#4137 AC-P2')

  // AC-P3 sitemap.
  const sitemap = (await get(port, '/sitemap.xml')).body
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  assert.deepEqual(locs.slice(-2), ['https://usemingla.com/blog/a-slow-saturday', 'https://usemingla.com/blog/pricing-the-door'], '#4137 AC-P3: posts after the registry routes')
  assert(locs.indexOf('https://usemingla.com/blog') < locs.indexOf('https://usemingla.com/blog/category/going-out'))

  // AC-P13 preview.
  const preview = await get(port, `/blog/preview/${PREVIEW_TOKEN}`)
  assert.equal(preview.status, 200)
  assert.match(preview.body, /Preview\. Not public\./)
  assert.match(preview.body, /DRAFT IN PREVIEW/)
  assert.match(preview.body, /<meta name="robots" content="noindex, nofollow"/)
  assert.equal((await get(port, `/blog/preview/${'B'.repeat(43)}`)).status, 404)

  // Load more API.
  const more = await get(port, '/api/blog/posts?offset=12')
  assert.equal(more.status, 200)
  assert.equal(JSON.parse(more.body).items[0].coverSrc, 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/blog-media/u/cover.jpg')
  assert.equal((await get(port, '/api/blog/posts?category=city-guide&offset=0')).status, 400)

  // AC-P11 revalidate without the secret.
  const revalidate = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/blog/revalidate', method: 'POST', headers: { Host: 'usemingla.com', 'x-mingla-revalidate-secret': 'wrong' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.once('error', reject)
    req.end()
  })
  assert.equal(revalidate, 401, '#4137 AC-P11: no secret, no revalidation')

  assert(calls.includes('blog_public_post_embeds'), '#4137: the post page read live embeds')
  process.stdout.write(`PASS #4137 blog render: index, category, post (place/event/plan/city/video/embed cards, JSON-LD, OG), sitemap, preview, load more, revalidate 401 (${calls.length} fixture RPC calls)\n`)
} catch (error) {
  process.stderr.write(`${log}\n`)
  throw error
} finally {
  child.kill('SIGTERM')
  fixture.close()
}
