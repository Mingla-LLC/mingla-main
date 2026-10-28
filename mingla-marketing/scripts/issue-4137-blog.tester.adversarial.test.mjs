#!/usr/bin/env node
// #4137 Blog tester: hostile rich text, device parity, keyboard, motion and failure paths in real Chrome.
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePort, open, waitFor, withNextBrowser } from './issue-4137-browser-harness.mjs'

if (!process.argv.includes('--built-only')) {
  process.stdout.write('SKIP #4137 blog tester: run with --built-only after next build\n')
  process.exit(0)
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLACE = '41370000-0000-4000-b000-000000000001'
const PREVIEW = 'P'.repeat(43)
const hostile = [
  '<img src=x onerror=alert(1)',
  '<a href="javascript:alert(1)">javascript</a>',
  '<a href=" javascript:alert(1)">spaced javascript</a>',
  '<svg><script>alert(1)</script></svg>',
  '<p onclick=alert(1)>click</p>',
  '&lt;img src=x onerror=alert(1)&gt;',
  '<a data-mingla-target="place:../../x">bad target</a>',
  '<a href="https://usemingla.com"><a href="https://example.com">nested</a></a>',
  'x'.repeat(50_000),
]
const category = { slug: 'going-out', label: 'Going out' }
const card = (index) => ({ slug: `story-${String(index).padStart(2, '0')}`, title: `Story ${index}`, summary: '', category, read_minutes: 3, publish_at: '2026-10-20T10:00:00Z', cover: null, author: { display_name: 'Mingla Editorial' } })
const cards = Array.from({ length: 15 }, (_, index) => card(index + 1))
const post = {
  ...card(1), slug: 'hostile-story', title: 'A safe story', first_published_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-21T10:00:00Z',
  hide_passed_event_cards: true, topics: [], more_stories: [],
  published_version: {
    title: 'A safe story', summary: 'Every hostile input stays inert.', cover: null, seo_title: null, seo_description: null,
    social_title: null, social_description: null, read_minutes: 3, media: {},
    document: { version: 1, blocks: [
      ...hostile.map((html, index) => ({ id: `hostile${index}`, type: 'paragraph', html })),
      { id: 'place01', type: 'place', placeId: PLACE, style: 'card' },
      { id: 'video01', type: 'video', provider: 'youtube', videoId: 'dQw4w9WgXcQ', title: 'A safe video' },
      { id: 'embed01', type: 'embed', provider: 'instagram', url: 'https://www.instagram.com/p/abc123/' },
    ] },
  },
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const fixturePort = await freePort()
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`
const fixture = http.createServer((request, response) => {
  if (request.url?.startsWith('/storage/')) {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public,max-age=3600' })
    response.end(png)
    return
  }
  let raw = ''
  request.on('data', (chunk) => { raw += chunk })
  request.on('end', () => {
    const rpc = request.url?.replace(/^\/rest\/v1\/rpc\//, '') ?? ''
    const args = raw ? JSON.parse(raw) : {}
    const reply = (value) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
    if (request.headers.apikey !== 'anon-fixture-key') { response.writeHead(401); response.end('{}'); return }
    if (rpc === 'blog_public_index') {
      const offset = Number(args.p_offset || 0)
      return reply({ featured: offset === 0 ? cards[0] : null, posts: cards.slice(offset, offset + 12), total: cards.length, categories: [] })
    }
    if (rpc === 'blog_public_post') return reply(args.p_slug === 'hostile-story' ? post : null)
    if (rpc === 'blog_public_post_embeds') return reply(args.p_slug === 'hostile-story' ? { places: { [PLACE]: { name: 'Stored Photo Place', primary_type_display_name: 'Park', city: 'Raleigh', rating: 4.8, review_count: 20, google_place_id: 'ChIJTester4137', google_maps_uri: 'https://maps.google.com/?cid=4137', stored_photo_url: `${fixtureOrigin}/storage/v1/object/public/place-photos/ChIJTester4137/0.jpg`, open: true } }, offerings: {} } : {})
    if (rpc === 'blog_public_preview') return reply(args.p_token === PREVIEW ? { ...post, preview: true, embeds: { places: {}, offerings: {} } } : null)
    if (rpc === 'blog_public_sitemap') return reply([{ slug: 'hostile-story', last_modified: '2026-10-21T10:00:00Z' }])
    response.writeHead(404); response.end('{}')
  })
})
await new Promise((resolve) => fixture.listen(fixturePort, '127.0.0.1', resolve))

const UAS = [
  ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', 'iPhone', 5, true],
  ['Android', 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36', 'Linux armv8l', 5, true],
  ['Instagram Android', 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36 Instagram 352.0.0.0', 'Linux armv8l', 5, true],
  ['iPadOS Mac UA', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'MacIntel', 5, true],
  ['macOS Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'MacIntel', 0, false],
  ['Windows Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36', 'Win32', 0, false],
]

try {
  await withNextBrowser(ROOT, async ({ page, baseUrl, consoleErrors }) => {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__qaDialogs=0;window.alert=()=>window.__qaDialogs++;window.confirm=()=>{window.__qaDialogs++;return false};window.__qaCls=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__qaCls+=e.value}).observe({type:'layout-shift',buffered:true})` })

    await open(page, baseUrl, '/blog/hostile-story', { width: 390, height: 844 })
    const security = await page.evaluate(`(() => { const article=document.querySelector('article'); return ({
      dangerous:[...article.querySelectorAll('[onerror],[onclick],script:not([type="application/ld+json"]),iframe')].map(n=>n.outerHTML.slice(0,300)),
      javascript:[...article.querySelectorAll('a[href]')].filter(a=>/^\\s*javascript:/i.test(a.getAttribute('href'))).length,
      dialogs:window.__qaDialogs,
      frames:document.querySelectorAll('iframe').length,
      stored:[...document.querySelectorAll('[data-place-media="stored"] img')].map(i=>i.src),
      optimized:[...document.images].map(i=>i.src).filter(s=>s.includes('/_next/image')&&s.includes('place-photos')),
      text:article.textContent.length || 0
    })})()`)
    assert.deepEqual(security.dangerous, [], `hostile rich text created executable markup: ${security.dangerous.join(' | ')}`)
    assert.equal(security.javascript, 0, 'hostile rich text created a javascript: link')
    assert.equal(security.dialogs, 0, 'hostile rich text opened a dialog')
    assert.equal(security.frames, 0, 'video/embed iframe must not exist before click')
    assert(security.stored.length === 1 && /_thumb\.jpg$/.test(security.stored[0]), 'place card must use a direct stored thumbnail')
    assert.deepEqual(security.optimized, [], 'place photo must not go through /_next/image')
    assert(security.text >= 50_000, 'the long paragraph was truncated or failed to render safely')

    for (const [name, userAgent, platform, touchPoints, phone] of UAS) {
      await open(page, baseUrl, '/blog/hostile-story?qa=ua', { width: phone ? 390 : 1440, height: 900, userAgent, platform, touchPoints })
      const ctas = await page.evaluate(`[...document.querySelectorAll('a[data-cta-phone-href]')].map(a=>({href:a.href,phone:a.dataset.ctaPhoneHref,surface:a.dataset.ctaSurface}))`)
      assert(ctas.length >= 2, `${name}: expected blog/device CTAs`)
      for (const cta of ctas) {
        if (phone) assert.equal(cta.href, cta.phone, `${name}: phone CTA did not use OneLink`)
        else assert.equal(new URL(cta.href).pathname === '/download' || new URL(cta.href).hostname === 'host.usemingla.com', true, `${name}: desktop CTA ${cta.href}`)
      }
    }

    await open(page, baseUrl, '/blog', { width: 390, height: 844, reducedMotion: true })
    assert.equal(await page.evaluate(`document.getAnimations().filter(a=>a.playState==='running').length`), 0, 'reduced-motion blog left animations running')
    const loadMore = await page.evaluate(`(() => { const a=[...document.querySelectorAll('a')].find(n=>n.textContent.includes('Load more stories')); a?.click(); return Boolean(a); })()`)
    assert.equal(loadMore, true, 'fixture must expose Load more')
    await waitFor(() => page.evaluate(`document.activeElement?.matches('a.blog-card') && document.activeElement?.closest('ul')?.style.marginTop === '40px'`), 'Load more did not move focus to the first appended story')

    for (const width of [390, 1440]) {
      await open(page, baseUrl, '/blog/hostile-story?qa=cls', { width, height: 900 })
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const cls = await page.evaluate(`window.__qaCls || 0`)
      assert(cls <= 0.05, `${width}px: blog post CLS ${cls} exceeded 0.05`)
    }

    await open(page, baseUrl, '/blog/not-published', { width: 390, height: 844, waitForPlatform: false })
    assert.match(await page.evaluate(`document.body.textContent`), /not found|404/i)
    await open(page, baseUrl, `/blog/preview/${'E'.repeat(43)}`, { width: 390, height: 844, waitForPlatform: false })
    assert.match(await page.evaluate(`document.body.textContent`), /not found|404/i)
    await open(page, baseUrl, `/blog/preview/${PREVIEW}`, { width: 390, height: 844 })
    assert.match(await page.evaluate(`document.body.textContent`), /Preview\. Not public\./)

    const revalidateStatus = await page.evaluate(`fetch('/api/blog/revalidate',{method:'POST',headers:{'x-mingla-revalidate-secret':'wrong'}}).then(r=>r.status)`)
    assert.equal(revalidateStatus, 401, 'wrong revalidation secret must return 401')
    const actionableErrors = consoleErrors.filter((message) => !/favicon|Failed to load resource|404 \(Not Found\)/i.test(message))
    assert.deepEqual(actionableErrors, [], `browser errors: ${actionableErrors.join('\n')}`)
  }, { env: { NEXT_PUBLIC_SUPABASE_URL: fixtureOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-fixture-key' } })
} finally {
  await new Promise((resolve) => fixture.close(resolve))
}

process.stdout.write(`PASS #4137 Blog tester: hostile rich text, ${UAS.length} device classes, keyboard load-more, motion, CLS, 404, preview and revalidate\n`)
