#!/usr/bin/env node
// #3645 — Organiser Terms promoted to search_ready after legal review
// (Seth, 4 Oct 2026).
//
// Source mode (default, or --source-only) proves the route is a search_ready
// contract with its own title, description and effective date; that it is no
// longer draft; that the page takes its metadata from that contract; and that
// all three search-ready lists (registry, sitemap verifier, strict-grep gate)
// agree, with the verifier keeping registry emission order.
// Built mode (--built-only) reads `next build` output and proves the shipped
// page carries the self-canonical, no noindex, and is in the sitemap.
// Each verifier is also run against a reverted state to prove it goes RED.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(ROOT, '..')
const mode = process.argv.includes('--built-only') ? 'built' : 'source'
const PATHNAME = '/organiser-terms'
const CANONICAL = 'https://usemingla.com/organiser-terms'

const SOURCES = {
  registry: 'mingla-marketing/lib/search/route-registry.ts',
  page: 'mingla-marketing/app/organiser-terms/page.tsx',
  verifier: 'mingla-marketing/scripts/verify-search-foundation.mjs',
  gate: '.github/scripts/strict-grep/issue-2981-marketing-search-foundation.mjs',
  packageJson: 'mingla-marketing/package.json',
}

function block(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  return from >= 0 && to > from ? source.slice(from, to) : ''
}

function verifySource(files) {
  const { registry, page, verifier, gate, packageJson } = files

  // Registry: one search_ready contract, last in the base array.
  const searchReady = block(registry, 'const SEARCH_READY_ROUTES = [', '] as const satisfies readonly SearchReadyRouteContract[]')
  assert(searchReady, 'route registry must declare SEARCH_READY_ROUTES')
  const contract = searchReady.match(/\{\s*id: 'organiser-terms',\s*match: \{ type: 'exact', pathname: '\/organiser-terms' \},\s*lifecycle: 'search_ready',\s*title: '([^']+)',\s*description:\s*'([^']+)',\s*lastModified: '(\d{4}-\d{2}-\d{2})',\s*\}/)
  assert(contract, '/organiser-terms must be an exact search_ready contract in SEARCH_READY_ROUTES')
  assert.equal(contract[1], 'Mingla Organiser Terms', 'the search title keeps the page title')
  assert.equal(contract[2], 'The terms for anyone who lists, sells, messages or advertises with Mingla Host: who you contract with, fees, payouts, refunds, Buyer data and disputes.', 'the search description keeps the page description')
  assert.equal(contract[3], '2026-10-01', 'lastModified is the terms effective date (1 October 2026)')
  const basePaths = [...searchReady.matchAll(/pathname: '([^']+)'/g)].map((match) => match[1])
  assert.equal(basePaths.at(-1), PATHNAME, '/organiser-terms is the last base contract, so emission order puts it after /terms-of-service')
  assert.equal(basePaths.filter((value) => value === PATHNAME).length, 1, '/organiser-terms is declared once')
  assert.doesNotMatch(registry, /DRAFT_ROUTES[\s\S]*?organiser-terms/, '/organiser-terms must not still be draft')
  assert.doesNotMatch(registry, /pathname: '\/organiser-terms'[^}]*\}[\s\S]{0,40}lifecycle: '(?:draft|public_noindex)'/, '/organiser-terms has no noindex contract')

  // Page: metadata comes from the search_ready contract, never the noindex helper.
  assert.match(page, /export const metadata = searchRouteMetadata\('\/organiser-terms'\)/, 'page must use searchRouteMetadata')
  assert.doesNotMatch(page, /publicNoindexMetadata/, 'page must not use publicNoindexMetadata')
  assert.match(page, /<main\b[^>]*id="main"/, 'page keeps its <main id="main"> landmark for the content probe')

  // Verifier: both the search-contract list and the sitemap list carry it, in order.
  const verifierPaths = block(verifier, 'const SEARCH_READY_PATHS = [', ']')
  assert.match(verifierPaths, /'\/terms-of-service',\s*(?:\/\/[^\n]*\n\s*)*'\/organiser-terms',\s*(?:\/\/[^\n]*\n\s*)*'\/going-out',/, 'SEARCH_READY_PATHS must list /organiser-terms between /terms-of-service and /going-out')
  const sitemapPaths = block(verifier, 'const SITEMAP_SEARCH_READY_PATHS = [', ']\n')
  assert.match(sitemapPaths, /releaseSearchReadyPaths\.slice\(helpInsertionIndex, organiserTermsInsertionIndex\),\s*'\/organiser-terms',\s*\.\.\.releaseSearchReadyPaths\.slice\(organiserTermsInsertionIndex\),/, 'the sitemap expectation must insert /organiser-terms right after /terms-of-service')
  assert.match(verifier, /const organiserTermsInsertionIndex = releaseSearchReadyPaths\.indexOf\('\/terms-of-service'\) \+ 1/, 'the sitemap insertion anchor is /terms-of-service')

  // Strict-grep gate: SEARCH_READY and the page-metadata map both own it.
  assert.match(block(gate, 'const SEARCH_READY = [', ']\n'), /'\/organiser-terms',/, 'issue-2981 gate SEARCH_READY must list /organiser-terms')
  assert.match(gate, /\['\/organiser-terms', 'mingla-marketing\/app\/organiser-terms\/page\.tsx'\],/, 'issue-2981 gate must check the page uses the search contract')

  // Wiring: runs before every build and with the issue script.
  const scripts = JSON.parse(packageJson).scripts
  assert.match(scripts.build, /node scripts\/issue-3645-organiser-terms-search-ready\.implementor\.happy\.test\.mjs --source-only/, 'build must run this guard in source mode')
  assert.match(scripts['test:issue-3645'], /issue-3645-organiser-terms-search-ready\.implementor\.happy\.test\.mjs --built-only/, 'test:issue-3645 must run this guard against the build')
}

function verifyBuilt({ html, sitemap }) {
  assert(html, 'the build must prerender /organiser-terms')
  assert.match(html, new RegExp(`<link rel="canonical" href="${CANONICAL.replaceAll('.', '\\.')}"/?>`), '/organiser-terms ships its self-canonical')
  assert.doesNotMatch(html, /<meta name="robots" content="[^"]*noindex/i, '/organiser-terms ships no noindex robots meta')
  assert.match(html, /<meta name="robots" content="index, follow"/, '/organiser-terms ships an explicit index, follow robots meta')
  assert.match(html, /<title>Mingla Organiser Terms<\/title>/, '/organiser-terms keeps its title')
  assert(sitemap, 'the build must emit /sitemap.xml')
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
  assert.equal(locations.filter((value) => value === CANONICAL).length, 1, '/sitemap.xml lists /organiser-terms exactly once')
  assert.equal(locations.indexOf(CANONICAL), locations.indexOf('https://usemingla.com/terms-of-service') + 1, '/organiser-terms follows /terms-of-service in the sitemap')
}

if (mode === 'source') {
  const files = Object.fromEntries(Object.entries(SOURCES).map(([key, relative]) => {
    const file = path.join(REPO, relative)
    return [key, existsSync(file) ? readFileSync(file, 'utf8') : '']
  }))
  verifySource(files)

  const reverts = [
    ['still draft', { registry: files.registry.replace("pathname: '/organiser-terms' },\n    lifecycle: 'search_ready',", "pathname: '/organiser-terms' },\n    lifecycle: 'draft',") }],
    ['page back on the noindex helper', { page: files.page.replace("searchRouteMetadata('/organiser-terms')", "publicNoindexMetadata('/organiser-terms', { title: 'Mingla Organiser Terms' })") }],
    ['missing from the sitemap verifier', { verifier: files.verifier.replace("  '/organiser-terms',\n", '') }],
    ['missing from the strict-grep gate', { gate: files.gate.replace("  '/organiser-terms',\n", '') }],
    ['future lastModified', { registry: files.registry.replace("lastModified: '2026-10-01'", "lastModified: '2026-12-01'") }],
  ]
  for (const [label, override] of reverts) {
    assert.throws(() => verifySource({ ...files, ...override }), assert.AssertionError, `RED proof failed to reject: ${label}`)
  }
  process.stdout.write(`RED proof: ${reverts.length} reverted states rejected\n`)
  process.stdout.write('PASS #3645 search-ready source: /organiser-terms is search_ready in the registry, verifier and strict-grep gate; page uses searchRouteMetadata\n')
} else {
  const appDir = path.join(ROOT, '.next/server/app')
  const htmlFile = path.join(appDir, 'organiser-terms.html')
  assert(existsSync(htmlFile), 'missing prerendered organiser-terms.html — run next build first')
  const sitemapFile = ['sitemap.xml.body', 'sitemap.xml'].map((name) => path.join(appDir, name)).find((file) => existsSync(file))
  assert(sitemapFile, 'missing prerendered sitemap.xml — run next build first')
  const built = { html: readFileSync(htmlFile, 'utf8'), sitemap: readFileSync(sitemapFile, 'utf8') }
  verifyBuilt(built)
  const reverts = [
    ['noindex shipped', { ...built, html: built.html.replace('content="index, follow"', 'content="noindex, nofollow"') }],
    ['canonical dropped', { ...built, html: built.html.replace(/<link rel="canonical"[^>]*>/, '') }],
    ['sitemap row dropped', { ...built, sitemap: built.sitemap.replace(`<loc>${CANONICAL}</loc>`, '') }],
  ]
  for (const [label, reverted] of reverts) {
    assert.throws(() => verifyBuilt(reverted), assert.AssertionError, `RED proof failed to reject: ${label}`)
  }
  process.stdout.write(`RED proof: ${reverts.length} reverted built states rejected\n`)
  process.stdout.write(`PASS #3645 search-ready built: /organiser-terms ships canonical ${CANONICAL}, index robots, and one sitemap row after /terms-of-service\n`)
}
