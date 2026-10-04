#!/usr/bin/env node
// #3645 — Organiser Terms website half.
//
// Source mode (default, or --source-only) proves the page, its search_ready
// registration (promoted from draft after legal review), the held-clause
// omissions, the two-company identity, the four link surfaces, the Terms of
// Service carve-out and the corrected help copy.
// Built mode (--built-only) reads the prerendered HTML from `next build` and
// proves the same omissions and the self-canonical, indexable page that ships.
// Each verifier is also run against a reverted source to prove it goes RED.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')
const mode = process.argv.includes('--built-only') ? 'built' : 'source'

// Phrases that only appear in clauses the draft holds back ("Publish when …")
// or in its editor notes. None may reach the published page.
const HELD_PHRASES = [
  'Ads through Mingla',
  'Host Community',
  '100 texts',
  '1,000 emails',
  'friends of your followers',
  'Friends of followers',
  '24 months',
  'Prohibited Items',
  'before you publish your first paid listing',
  'Paystack payout account',
  'Selling before you add a bank',
  'held for a quick Mingla review',
  'Recovering money already paid out',
  'Pausing payouts',
  '120 days after your last event',
  'accept the new terms in the app',
  'Unfollow',
  'Former host',
  '15% service fee',
]
const EDITOR_MARKERS = ['[Publish when', '[Legal review', 'Editor notes', 'Publish when', 'Legal review']
const COMPANY_FACTS = [
  'Mingla LLC',
  'UseMingla Limited',
  'RC 9591121',
  '700 Corporate Center Dr, Raleigh, NC 27607, USA',
  'No 1, Fortune Avenue, Off Omumah Pipeline Road, Igwuruta, Port Harcourt, Rivers State, Nigeria',
]
const KEPT_SECTION_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18]
const CARVE_OUT =
  'If you use Mingla Host to list, sell, message or advertise as an organiser, that use is commercial and is governed by the Mingla Organiser Terms at usemingla.com/organiser-terms, which apply alongside these Terms.'
const LINK_SURFACES = [
  'components/marketing/footer.tsx',
  'components/cutout/footer.tsx',
  'components/page-system/page-system-shell.tsx',
  'app/support/page.tsx',
]

function verifySource(files) {
  const content = files['lib/organiserTermsContent.ts']
  const page = files['app/organiser-terms/page.tsx']
  const registry = files['lib/search/route-registry.ts']
  assert(content, 'lib/organiserTermsContent.ts must exist')
  assert(page, 'app/organiser-terms/page.tsx must exist')

  // Route + lifecycle: search_ready since legal review cleared it, therefore
  // self-canonical, indexable and in the sitemap.
  assert.doesNotMatch(registry, /const DRAFT_ROUTES = \[[\s\S]*?organiser-terms/, '/organiser-terms must no longer be registered draft')
  assert.match(registry, /NOINDEX_LIFECYCLES[\s\S]*'draft'/, 'draft must stay a noindex lifecycle')
  const searchReady = registry.slice(registry.indexOf('const SEARCH_READY_ROUTES = ['), registry.indexOf('] as const satisfies readonly SearchReadyRouteContract[]'))
  assert.match(searchReady, /match: \{ type: 'exact', pathname: '\/organiser-terms' \},\s*lifecycle: 'search_ready',/, '/organiser-terms must be search_ready')
  assert.match(files['scripts/verify-search-foundation.mjs'], /'\/terms-of-service',[\s\S]*?'\/organiser-terms',/, '/organiser-terms must be in the sitemap/search-ready verifier')
  assert.match(page, /searchRouteMetadata\('\/organiser-terms'\)/, 'page must use the search-ready metadata helper')
  assert.doesNotMatch(page, /publicNoindexMetadata/, 'page must not use the noindex metadata helper')
  assert.match(page, /<main\b[^>]*id="main"/, 'page needs the <main id="main"> landmark')

  // Held clauses and editor notes never render.
  for (const phrase of [...HELD_PHRASES, ...EDITOR_MARKERS]) {
    assert(!content.includes(phrase), `content must not contain held/editor text: ${phrase}`)
    assert(!page.includes(phrase), `page must not contain held/editor text: ${phrase}`)
  }
  for (const number of KEPT_SECTION_NUMBERS) {
    assert.match(content, new RegExp(`number: ${number},`), `section ${number} must be published`)
  }
  for (const held of [10, 12]) {
    assert.doesNotMatch(content, new RegExp(`number: ${held},`), `wholly-held section ${held} must be omitted`)
  }
  assert.match(content, /title: 'Words we use'/, 'definitions must be published')
  assert.match(content, /We record the version you accepted and when\./)
  assert.match(content, /ticking "I agree" in Mingla Host before you connect a payout account/)
  assert.match(content, /ORGANISER_TERMS_LAST_UPDATED = '1 October 2026'/)
  assert.match(page, /Last updated \{ORGANISER_TERMS_LAST_UPDATED\}/)
  assert.match(page, /Contents/, 'page must render a table of contents')
  for (const fact of COMPANY_FACTS) assert(content.includes(fact), `content must name ${fact}`)

  // Every link surface reaches the page.
  for (const surface of LINK_SURFACES) {
    assert.match(files[surface], /href(?:=|: )["']\/organiser-terms["']/, `${surface} must link /organiser-terms`)
    assert.match(files[surface], /Organiser Terms/, `${surface} must label the link Organiser Terms`)
  }

  // Terms of Service: both the §6 commercial-use bullet and the §8 licence.
  const terms = files['lib/termsContent.ts']
  assert.equal(terms.split(CARVE_OUT).length - 1, 2, 'termsContent must carry the organiser carve-out in §6 and §8')
  assert(terms.includes(`'Use the Service for any commercial purpose without our prior written consent. ${CARVE_OUT}'`), '§6 carve-out')
  assert(terms.includes(`personal, non-commercial use. ${CARVE_OUT}`), '§8 carve-out')

  // Help Centre: the organiser is the seller; Mingla is not merchant of record.
  const help = files['content/help/registry.ts']
  assert.doesNotMatch(help, /merchant of record/i, 'help registry must not claim Mingla is merchant of record')
  assert.match(help, /You are the seller of your event: on Stripe, each sale is made on your own Stripe account\. In Nigeria, UseMingla Limited collects the payment through Paystack and transfers it to you\./)
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

function verifyBuilt(pages) {
  const html = pages['organiser-terms']
  assert(html, 'the build must prerender /organiser-terms')
  assert.doesNotMatch(html, /<meta name="robots" content="[^"]*noindex/, '/organiser-terms must not ship a noindex robots meta')
  assert.match(html, /<link rel="canonical" href="https:\/\/usemingla\.com\/organiser-terms"/, '/organiser-terms must ship its self-canonical')
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)
  assert(main, '/organiser-terms must render a <main> landmark')
  const text = stripTags(main[1])
  assert(text.length > 5000, '/organiser-terms must server-render the terms text')
  for (const phrase of [...HELD_PHRASES, ...EDITOR_MARKERS]) {
    assert(!text.includes(phrase), `rendered page must not contain held/editor text: ${phrase}`)
  }
  for (const fact of COMPANY_FACTS) assert(text.includes(fact), `rendered page must name ${fact}`)
  assert(text.includes('Last updated 1 October 2026'), 'rendered page shows the effective date')
  for (const number of KEPT_SECTION_NUMBERS) {
    assert(text.includes(` ${number}. `), `rendered page must include section ${number}`)
  }
  assert(!/ 10\. | 12\. /.test(text), 'rendered page must omit sections 10 and 12')
  assert(text.includes('We record the version you accepted and when.'))
  assert.match(pages['support'], /href="\/organiser-terms"/, '/support must link /organiser-terms')
  // /terms-of-service is a standalone page with no footer; the footers ship on
  // the Host and tools pages.
  assert.match(pages['host'], /href="\/organiser-terms"/, '/host footer must link /organiser-terms')
  assert.match(pages['tools'], /href="\/organiser-terms"/, '/tools footer must link /organiser-terms')
  assert(stripTags(pages['terms-of-service']).includes(CARVE_OUT), '/terms-of-service must render the carve-out')
}

if (mode === 'source') {
  const names = [
    'lib/organiserTermsContent.ts',
    'app/organiser-terms/page.tsx',
    'lib/search/route-registry.ts',
    'scripts/verify-search-foundation.mjs',
    'lib/termsContent.ts',
    'content/help/registry.ts',
    ...LINK_SURFACES,
  ]
  const files = Object.fromEntries(names.map((name) => [name, existsSync(path.join(ROOT, name)) ? read(name) : '']))
  verifySource(files)

  // RED proofs: each reverted piece must be rejected.
  const reverts = [
    ['page removed', { 'app/organiser-terms/page.tsx': '' }],
    ['still draft instead of search_ready', { 'lib/search/route-registry.ts': files['lib/search/route-registry.ts'].replace("pathname: '/organiser-terms' },\n    lifecycle: 'search_ready',", "pathname: '/organiser-terms' },\n    lifecycle: 'draft',") }],
    ['held ads section published', { 'lib/organiserTermsContent.ts': `${files['lib/organiserTermsContent.ts']}\n// title: 'Ads through Mingla'` }],
    ['editor note published', { 'lib/organiserTermsContent.ts': `${files['lib/organiserTermsContent.ts']}\n// [Legal review: media licence.]` }],
    ['company registration dropped', { 'lib/organiserTermsContent.ts': files['lib/organiserTermsContent.ts'].replaceAll('RC 9591121', 'RC') }],
    ['footer link dropped', { 'components/cutout/footer.tsx': files['components/cutout/footer.tsx'].replace("{ href: '/organiser-terms', label: 'Organiser Terms' }, ", '') }],
    ['carve-out reverted', { 'lib/termsContent.ts': files['lib/termsContent.ts'].replaceAll(` ${CARVE_OUT}`, '') }],
    ['help copy reverted', { 'content/help/registry.ts': `${files['content/help/registry.ts']}\n// Mingla is the merchant of record for ticket sales` }],
  ]
  for (const [label, override] of reverts) {
    assert.throws(() => verifySource({ ...files, ...override }), assert.AssertionError, `RED proof failed to reject: ${label}`)
  }
  process.stdout.write(`RED proof: ${reverts.length} reverted states rejected\n`)
  process.stdout.write('PASS #3645 source: /organiser-terms search_ready/canonical, held clauses omitted, both companies named, four link surfaces, ToS carve-out, help copy corrected\n')
} else {
  const appDir = path.join(ROOT, '.next/server/app')
  const pages = Object.fromEntries(['organiser-terms', 'support', 'terms-of-service', 'host', 'tools'].map((name) => {
    const file = path.join(appDir, `${name}.html`)
    assert(existsSync(file), `missing prerendered ${name}.html — run next build first`)
    return [name, readFileSync(file, 'utf8')]
  }))
  verifyBuilt(pages)
  const reverted = { ...pages, 'organiser-terms': pages['organiser-terms'].replace('</main>', '<p>Ads through Mingla</p></main>') }
  assert.throws(() => verifyBuilt(reverted), assert.AssertionError, 'RED proof failed to reject a held clause in the built page')
  process.stdout.write('PASS #3645 built: /organiser-terms prerendered indexable with its self-canonical, held clauses absent, companies named; /support, /host and /tools link it; /terms-of-service renders the carve-out\n')
}
