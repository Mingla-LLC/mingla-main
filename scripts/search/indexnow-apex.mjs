#!/usr/bin/env node
// #4339 round B (SEO audit 12) — IndexNow for usemingla.com pages.
//
// The database-driven sender (indexnow.mjs) submits host.usemingla.com public
// documents. The apex marketing pages are not in that queue: they change when
// the site deploys. This step diffs the sitemap `lastmod` from BEFORE a deploy
// with the live sitemap AFTER it, and submits every apex URL that is new or
// whose lastmod moved (the redesign constant SITE_REDESIGN_LAST_MODIFIED in
// mingla-marketing/lib/search/route-registry.ts moves them all at once).
//
// How it runs (an operator step; no workflow, no new secret — it reuses
// INDEXNOW_KEY, already served at https://usemingla.com/indexnow-key.txt):
//
//   1. before merging:   node scripts/search/indexnow-apex.mjs snapshot > /tmp/sitemap-before.xml
//   2. after the deploy reaches READY, dry run (prints the URLs and a digest):
//                        node scripts/search/indexnow-apex.mjs --before=/tmp/sitemap-before.xml
//   3. send, with the digest from step 2:
//                        INDEXNOW_KEY=… node scripts/search/indexnow-apex.mjs --before=/tmp/sitemap-before.xml --send --confirm=<bodySha256>
//
// Only https://usemingla.com/ URLs are ever submitted (host usemingla.com,
// keyLocation https://usemingla.com/indexnow-key.txt). The key is never
// printed. `--current=<file|url>` overrides the live sitemap (tests).

import crypto from 'node:crypto'
import fs from 'node:fs'
import { parseArgs } from './lib.mjs'

export const APEX = 'https://usemingla.com'
export const KEY_LOCATION = `${APEX}/indexnow-key.txt`

/** <loc> → <lastmod> of a sitemap document (lastmod may be empty). */
export function parseSitemap(xml) {
  const entries = new Map()
  for (const block of String(xml).matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(block[1])?.[1]
    if (!loc) continue
    const lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(block[1])?.[1] ?? ''
    entries.set(loc.replace(/&amp;/g, '&'), lastmod.slice(0, 10))
  }
  return entries
}

/** The apex URLs that are new, or whose lastmod moved, between two sitemaps. */
export function changedApexUrls(beforeXml, afterXml) {
  const before = parseSitemap(beforeXml)
  const changed = []
  for (const [loc, lastmod] of parseSitemap(afterXml)) {
    let url
    try {
      url = new URL(loc)
    } catch {
      continue
    }
    if (url.origin !== APEX || url.search || url.hash) continue
    if (!before.has(loc) || before.get(loc) !== lastmod) changed.push(loc)
  }
  return [...new Set(changed)].sort()
}

export function indexNowBody(urls, key) {
  return { host: 'usemingla.com', key, keyLocation: KEY_LOCATION, urlList: urls }
}

async function load(source) {
  if (/^https:\/\//.test(source)) {
    const response = await fetch(source, { headers: { 'user-agent': 'mingla-indexnow-apex' } })
    if (!response.ok) throw new Error(`sitemap_fetch_${response.status}`)
    return response.text()
  }
  return fs.readFileSync(source, 'utf8')
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv[0] === 'snapshot') {
    process.stdout.write(await load(`${APEX}/sitemap.xml`))
    return
  }
  const args = parseArgs(argv)
  if (!args.before) throw new Error('--before=<sitemap file or https URL> is required (take it with `snapshot` before merging)')
  const urls = changedApexUrls(await load(String(args.before)), await load(String(args.current ?? `${APEX}/sitemap.xml`)))
  const plan = { dryRun: !args.send, urlCount: urls.length, bodySha256: crypto.createHash('sha256').update(JSON.stringify(urls)).digest('hex'), urls }
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  if (!args.send) return
  if (args.confirm !== plan.bodySha256) throw new Error('Refusing delivery: pass --confirm=<bodySha256> from a fresh dry run')
  const key = process.env.INDEXNOW_KEY ?? ''
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) throw new Error('INDEXNOW_KEY is missing or invalid')
  if (urls.length === 0) return
  const live = await fetch(KEY_LOCATION)
  if (!live.ok || (await live.text()).trim() !== key) throw new Error('the key at https://usemingla.com/indexnow-key.txt does not match INDEXNOW_KEY')
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(indexNowBody(urls, key)),
  })
  process.stdout.write(`${JSON.stringify({ delivered: response.ok, status: response.status, urlCount: urls.length })}\n`)
  if (!response.ok) throw new Error(`indexnow_delivery_${response.status}`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
