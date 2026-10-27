#!/usr/bin/env node
// #4137 wave 3 — implementor happy path: the blog's routes, registry, sitemap
// wiring, footer link and CTA/no-host/no-newsletter source rules.
//
//   default        source checks (no build needed)
//   --built-only   the built site with NO database (as in CI): /blog renders
//                  its empty state, the category pages render, unknown
//                  categories and posts are 404s.
//
// MINGLA-INVARIANT: I-4137-BLOG-PLACE-PHOTOS-STORED-THUMBS | issue #4137 | blog place cards show only stored place-pool thumbnails: no live Google fetch, no next/image, no /render/image, no attribution line (Seth, 27 Oct 2026).
// Fails on revert: without the blog routes, registry entries and footer link every check below fails.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(ROOT, '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const builtOnly = process.argv.includes('--built-only')
const CATEGORY_SLUGS = ['going-out', 'date-ideas', 'host-playbook', 'product-news']

function walk(dir) {
  const full = path.join(ROOT, dir)
  if (!fs.existsSync(full)) return []
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(relative) : [relative]
  })
}

function sourceContract() {
  // Route files.
  for (const file of [
    'app/blog/layout.tsx', 'app/blog/page.tsx', 'app/blog/error.tsx', 'app/blog/category/[category]/page.tsx',
    'app/blog/[slug]/page.tsx', 'app/blog/[slug]/not-found.tsx', 'app/blog/preview/[token]/page.tsx',
    'app/api/blog/revalidate/route.ts', 'app/api/blog/posts/route.ts', 'lib/blog/data.ts', 'content/blog/categories.ts',
  ]) assert(fs.existsSync(path.join(ROOT, file)), `#4137: ${file} exists`)
  assert.match(read('app/blog/layout.tsx'), /<main id="main">\{children\}<\/main>/, '#4137: the blog layout owns <main>')
  for (const file of ['app/blog/page.tsx', 'app/blog/category/[category]/page.tsx', 'app/blog/[slug]/page.tsx', 'app/blog/preview/[token]/page.tsx']) {
    assert.match(read(file), /export const dynamic = 'force-dynamic'/, `#4137: ${file} renders per request`)
  }
  assert.match(read('app/blog/page.tsx'), /searchRouteMetadata\('\/blog'\)/)
  assert.match(read('app/blog/category/[category]/page.tsx'), /export const dynamicParams = false/, '#4137: unknown categories 404')
  assert.match(read('app/blog/preview/[token]/page.tsx'), /robots: \{ index: false, follow: false \}/)

  // Categories mirror the database seed exactly; no city category.
  const seed = fs.readFileSync(path.join(REPO, 'supabase/migrations/20280120004137_issue_4137_blog_schema.sql'), 'utf8')
  const seeded = [...seed.matchAll(/\('([a-z-]+)', '([^']+)', '([^']+)', (\d)\)/g)].map(([, slug, label, description]) => ({ slug, label, description }))
  const categories = read('content/blog/categories.ts')
  assert.deepEqual(seeded.map((row) => row.slug), CATEGORY_SLUGS, '#4137: four seeded categories')
  for (const row of seeded) {
    assert(categories.includes(`slug: '${row.slug}'`) && categories.includes(`label: '${row.label}'`) && categories.includes(`description: '${row.description}'`), `#4137: ${row.slug} mirrors the seed`)
  }
  assert.doesNotMatch(categories.replace(/\/\/.*$/gm, ''), /city/i, '#4137: no city category')

  // Registry: /blog, projected categories, the noindex family and the post contract.
  const registry = read('lib/search/route-registry.ts')
  const searchReady = registry.slice(registry.indexOf('const SEARCH_READY_ROUTES = ['), registry.indexOf('] as const satisfies readonly SearchReadyRouteContract[]'))
  assert.match(searchReady, /id: 'blog-home',\s*match: \{ type: 'exact', pathname: '\/blog' \},\s*lifecycle: 'search_ready'/, '#4137: /blog is search-ready')
  assert.match(registry, /export const BLOG_CATEGORY_ROUTE_CONTRACTS[^=]*= BLOG_CATEGORIES\.map/, '#4137: category contracts are a projection')
  assert.match(registry, /id: 'blog-post-family',\s*match: \{ type: 'prefix', pathname: '\/blog' \},\s*lifecycle: 'public_noindex'/, '#4137: every other /blog path has a noindex owner')
  const registryOrder = registry.slice(registry.indexOf('export const ROUTE_REGISTRY'))
  assert(registryOrder.indexOf('...HELP_ROUTE_CONTRACTS') < registryOrder.indexOf('...BLOG_CATEGORY_ROUTE_CONTRACTS') && registryOrder.includes('  BLOG_ROUTE_FAMILY,'), '#4137: registry order')
  assert.match(registry, /export function blogPostRouteContract\(/)
  assert.match(read('lib/search/metadata.ts'), /export function blogPostMetadata[\s\S]*blogPostRouteContract\(/, '#4137: post metadata shares the sitemap derivation')
  const sitemap = read('app/sitemap.ts')
  assert.match(sitemap, /searchReadyRoutes\(\)\.map/)
  assert.match(sitemap, /listBlogSitemapEntries\(\)\)[\s\S]*blogPostRouteContract/, '#4137: posts join the sitemap through the contract')

  // verify-search-foundation and the #2981 gate know /blog.
  const verify = read('scripts/verify-search-foundation.mjs')
  assert.match(verify, /'\/organiser-terms',\n  \/\/ #4137[^\n]*\n  '\/blog',/, '#4137: /blog after /organiser-terms')
  for (const slug of CATEGORY_SLUGS) assert(verify.includes(`'/blog/category/${slug}'`), `#4137: verify lists ${slug}`)
  assert.match(fs.readFileSync(path.join(REPO, '.github/scripts/strict-grep/issue-2981-marketing-search-foundation.mjs'), 'utf8'), /'\/blog',\n\]/)

  // Footer (AC-P12) and image host (no Google host).
  assert.match(read('components/cutout/footer.tsx'), /\{ href: '\/blog', label: 'Blog' \}/, '#4137 AC-P12: footer links to /blog')
  const nextConfig = read('next.config.ts')
  assert.match(nextConfig, /pathname: '\/storage\/v1\/object\/public\/blog-media\/\*\*'/)
  assert.doesNotMatch(nextConfig, /googleusercontent|googleapis/, '#4137: no Google host in the image optimiser')

  // AC-P7 — every blog CTA is a DeviceCta for Explorer with a blog_ location; no URL constants.
  const blogSources = [...walk('components/blog'), ...walk('app/blog'), ...walk('lib/blog'), ...walk('app/api/blog')]
    .filter((file) => /\.(tsx?|css)$/.test(file))
  assert(blogSources.length >= 20, '#4137: blog sources found')
  for (const file of blogSources) {
    const source = read(file)
    assert.doesNotMatch(source, /go\.usemingla\.com|biz\.usemingla\.com|onelink\.me|apps\.apple\.com|play\.google\.com/, `#4137 AC-P7: ${file} has no app URL constant`)
    for (const cta of source.matchAll(/<DeviceCta\b[^>]*>/g)) {
      assert.match(cta[0], /surface="explorer"/, `#4137 AC-P7: ${file} CTA opens Explorer`)
      assert.match(cta[0], /location="blog_[a-z_]+"/, `#4137 AC-P7: ${file} CTA location starts blog_`)
    }
    // AC-P8 — no newsletter, sign-up box, email field or city filter.
    const visible = source.replace(/^\s*\/\/.*$|\/\*[\s\S]*?\*\//gm, '')
    assert.doesNotMatch(visible, /\/render\/image|city-place-media|places\.googleapis/, `#4137: ${file} never fetches or transforms Google/Supabase images`)
    assert.doesNotMatch(visible, /newsletter|subscribe|sign up|city guide|type="email"/i, `#4137 AC-P8: ${file}`)
  }
  const placeCard = read('components/blog/blocks/place-card.tsx')
  assert.doesNotMatch(placeCard.replace(/\/\/.*$/gm, ''), /next\/image|Photo by|Google Maps/, '#4137: place photos are plain stored thumbnails with no credit line')
  assert.match(placeCard, /storedThumbFromPhotoUrl\(place\.stored_photo_url\) \?\? \(place\.google_place_id \? storedPlaceThumbSrc/, '#4137: stored thumbnail first, then the place-id thumbnail')
  const offering = read('components/blog/blocks/offering-card.tsx').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(offering, /brand|cover_media|\.title\b|location_text/, '#4137: the event card reads no host field')
  // Rich text is rendered from the sanitiser's tree, never injected as HTML.
  for (const file of blogSources.filter((file) => file !== 'components/blog/blog-article-schema.tsx')) {
    assert.doesNotMatch(read(file).replace(/^\s*\/\/.*$/gm, ''), /dangerouslySetInnerHTML/, `#4137: ${file} injects no HTML`)
  }
  assert.match(read('components/blog/blog-rich-text.tsx'), /parseBlogRichText\(html\)/)
  assert.match(read('components/cutout/device-cta.tsx'), /variant\?: 'primary' \| 'ink' \| 'quiet' \| 'inline'/, '#4137: the inline CTA variant')
  process.stdout.write('PASS #4137 blog routes (source): routes, seed-mirrored categories, registry family + contracts, sitemap, verify lists, footer, DeviceCta-only CTAs, no newsletter, stored thumbnails, no injected HTML\n')
}

// ── built ──────────────────────────────────────────────────────────────────
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}
function get(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: { Host: 'usemingla.com', 'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/128' } }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end()
  })
}

async function builtContract() {
  assert(fs.existsSync(path.join(ROOT, '.next/BUILD_ID')), '#4137: run next build first')
  const port = await freePort()
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
  delete env.NEXT_PUBLIC_SUPABASE_URL
  delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', (chunk) => { log += chunk })
  child.stderr.on('data', (chunk) => { log += chunk })
  try {
    const deadline = Date.now() + 30_000
    for (;;) {
      try { if ((await get(port, '/robots.txt')).status === 200) break } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error('next start did not come up')
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    const index = await get(port, '/blog')
    assert.equal(index.status, 200)
    assert.match(index.body, /<h1[^>]*>Go out better\.<\/h1>/, '#4137: /blog h1')
    assert.match(index.body, /<main id="main">/)
    assert.match(index.body, /New stories are on the way/, '#4137: honest empty state without a database')
    assert.match(index.body, /<nav aria-label="Blog categories"/)
    assert.doesNotMatch(index.body.replace(/<script[\s\S]*?<\/script>/g, ''), /newsletter|subscribe|type="email"/i, '#4137 AC-P8')
    assert.match(index.body, /href="\/blog"[^>]*>Blog</, '#4137 AC-P12: footer link')
    for (const slug of CATEGORY_SLUGS) {
      const page = await get(port, `/blog/category/${slug}`)
      assert.equal(page.status, 200, `/blog/category/${slug}`)
      assert.match(page.body, new RegExp(`<link rel="canonical" href="https://usemingla.com/blog/category/${slug}"`))
    }
    assert.equal((await get(port, '/blog/category/city-guide')).status, 404, '#4137 AC-P2: no city category')
    assert.equal((await get(port, '/blog/any-post')).status, 404, '#4137: no database, no post')
    process.stdout.write('PASS #4137 blog routes (built, no database): /blog empty state, four category pages, 404s\n')
  } catch (error) {
    process.stderr.write(log)
    throw error
  } finally {
    child.kill('SIGTERM')
  }
}

if (builtOnly) await builtContract()
else sourceContract()
