#!/usr/bin/env node
// #4339 round B (anti-copy) — nothing internal ships in usemingla.com's built
// HTML and JS. Seth (8 Nov): make the design, copy and tech hard to copy or
// fingerprint, so the built output must not carry:
//
//   ISSUE_REF      work-item numbers ("#4339 going-out: …") in visible text or
//                  string literals (CSS colours such as #111 and street numbers
//                  such as "St #120," are not issue numbers);
//   TODO           TODO / FIXME markers;
//   INTERNAL_HOST  internal hostnames: *.vercel.app previews, localhost:<port>,
//                  *.internal / *.local, the Supabase project's *.supabase.in;
//   TEST_ID        data-testid attributes (stripped by next.config's
//                  compiler.reactRemoveProperties);
//   DEV_COMMENT    developer comments: an HTML comment other than React's
//                  markers and Next's build-id marker, or a JS block comment
//                  other than a /*! licence */ or /*#__PURE__*/ annotation.
//
// Modes (I-PROPOSED-1383-GATE-MANIFEST-TOTALITY registry, local descriptor
// beside this file):
//   --self-test   the detector against fixtures (bad output is caught, the
//                 real exemptions pass);
//   plain         the wiring: the marketing build runs this gate with
//                 --built after `next build`, and next.config strips what the
//                 gate refuses (poweredByHeader off, test ids, issue refs);
//   --built       scans mingla-marketing/.next (fails closed when it is
//                 missing). Run as the last step of `npm run build`, so a deploy
//                 whose output leaks fails.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const MARKETING = path.join(ROOT, 'mingla-marketing')

const ADDRESS_BEFORE = /(?:St|Ave|Rd|Blvd|Dr|Hwy|Pkwy|Ln|Ct|Pl|Way|Suite|Ste|Unit|Street|Avenue|Road|Floor)\.?\s*$/i

// #4339 (release fix): on a Vercel PREVIEW build, Next.js points file-based
// og:image / twitter:image URLs at the deployment's own preview host on purpose
// (it overrides metadataBase for social images so link previews resolve on the
// preview). Production builds use metadataBase (usemingla.com). So, only when
// VERCEL_ENV is "preview", the deployment's OWN host (VERCEL_URL or
// VERCEL_BRANCH_URL) is allowed, and only inside an og:image / twitter:image
// value. Any other *.vercel.app host, and every host on a production or local
// build, still fails.
export function ownPreviewHosts(env = process.env) {
  if (env.VERCEL_ENV !== 'preview') return []
  return [env.VERCEL_URL, env.VERCEL_BRANCH_URL].filter((host) => typeof host === 'string' && host.length > 0)
}

function isOwnPreviewSocialImage(text, index, match, env = process.env) {
  if (!ownPreviewHosts(env).includes(match)) return false
  return /(?:og|twitter):image(?::url|:secure_url)?\W{1,12}content\W{1,12}https:\/\/$/.test(text.slice(Math.max(0, index - 60), index))
}

export const RULES = [
  { id: 'ISSUE_REF', re: /#[1-9]\d{2,3}\b(?![,;}!0-9a-fA-F])/g, skipIn: /\.css$/, keep: (text, index) => ADDRESS_BEFORE.test(text.slice(Math.max(0, index - 12), index)) || /[a-fA-F0-9]$/.test(text.slice(index - 1, index)) || /^#[1-9]\d{2,3}["')\]]/.test(text.slice(index, index + 6)) },
  { id: 'TODO', re: /\b(?:TODO|FIXME)\b/g },
  { id: 'INTERNAL_HOST', re: /\b[a-z0-9-]+\.vercel\.app\b|\blocalhost:\d{2,5}\b|\b127\.0\.0\.1:\d{2,5}\b|\b[a-z0-9-]+\.(?:internal|local)\b(?!\w)|\b[a-z0-9]+\.supabase\.in\b/g, keep: (text, index, match) => isOwnPreviewSocialImage(text, index, match) },
  { id: 'TEST_ID', re: /data-testid/g },
  {
    id: 'DEV_COMMENT',
    re: /<!--([\s\S]*?)-->|\/\*(?![!#@])([\s\S]*?)\*\//g,
    keep: (text, index, match) => {
      if (match.startsWith('<!--')) return /^<!--(?:\s*|\$|\/\$|\$\?|\$!|[A-Za-z0-9_-]{10,40})-->$/.test(match)
      return /^\/\*\s*(?:webpackChunkName|@__PURE__|#__PURE__|@license|istanbul)/.test(match) || match.length < 6
    },
  },
]

/** Every rule hit in one text (with its file and a short context). */
export function scanText(text, file = '<text>') {
  const hits = []
  for (const rule of RULES) {
    if (rule.skipIn?.test(file)) continue
    for (const m of text.matchAll(rule.re)) {
      if (rule.keep?.(text, m.index, m[0])) continue
      hits.push({ rule: rule.id, file, at: text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ') })
    }
  }
  return hits
}

function builtFiles(next) {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'cache' || e.name === 'types' || e.name === 'diagnostics') continue
        walk(p)
      } else if (/\.(?:html|js|rsc|css)$/.test(e.name) && (p.includes(`${path.sep}static${path.sep}`) || p.includes(`${path.sep}server${path.sep}app${path.sep}`))) {
        // Route handlers under /api run on the server and never reach a browser.
        if (p.includes(`${path.sep}server${path.sep}app${path.sep}api${path.sep}`)) continue
        out.push(p)
      }
    }
  }
  walk(next)
  return out
}

function selfTest() {
  const bad = [
    ['ISSUE_REF', 'throw Error(`#4339 going-out: city hub "x" is not in the registry`)'],
    ['ISSUE_REF', '<strong>#2990 private review</strong>'],
    ['ISSUE_REF', 'throw Error("#4137: ".concat(id," has no rank"))'],
    ['TODO', 'const x = 1 // TODO wire this'],
    ['INTERNAL_HOST', 'fetch("https://mingla-marketing-git-4339-mingla.vercel.app/api")'],
    ['INTERNAL_HOST', 'const api = "http://localhost:3000"'],
    ['TEST_ID', '<div data-testid="privacy-strip">'],
    ['DEV_COMMENT', '<!-- hero picked by Seth on 8 Nov -->'],
    ['DEV_COMMENT', 'a=1;/* hack: remove after launch */b=2'],
  ]
  for (const [rule, sample] of bad) {
    if (!scanText(sample).some((h) => h.rule === rule)) throw new Error(`self-test: ${rule} missed ${sample}`)
  }
  const good = [
    '.mpb-primary{background:#eb7825;color:#111}',
    'fill:"#333" stroke:"#1111"',
    'color:#222!important',
    '"address":"4 Fenton Main St #120, Cary, NC 27511, USA"',
    '"126 W Chatham St #200, Cary"',
    '<!DOCTYPE html><!--oTdoM_KexEF3etwLUOvXS--><html>',
    '<!-- --><!--$--><!--/$-->',
    '/*! For license information please see 1.js.LICENSE.txt */',
    'a=/*#__PURE__*/b()',
    'if(["localhost","127.0.0.1"].includes(e))return""',
    'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event_covers/x.jpg',
  ]
  for (const sample of good) {
    const hits = scanText(sample)
    if (hits.length) throw new Error(`self-test: false positive ${hits[0].rule} in ${sample}`)
  }
  // #4339 (release fix): the preview build's own social-image host is allowed;
  // nothing else is, and nothing on a production or local build.
  const own = 'mingla-marketing-git-4339-x-seth-ogievas-projects.vercel.app'
  const html = `<meta property="og:image" content="https://${own}/opengraph-image.jpg">`
  const rsc = String.raw`[\"$\",\"meta\",\"5\",{\"property\":\"og:image\",\"content\":\"https://${own}/opengraph-image.jpg\"}]`
  const escaped = String.raw`\\\"twitter:image\\\",\\\"content\\\":\\\"https://${own}/twitter-image.jpg`
  const saved = { VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_URL: process.env.VERCEL_URL, VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL }
  const setEnv = (values) => { for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
  const internal = (sample) => scanText(sample).some((h) => h.rule === 'INTERNAL_HOST')
  try {
    setEnv({ VERCEL_ENV: 'preview', VERCEL_URL: undefined, VERCEL_BRANCH_URL: own })
    for (const sample of [html, rsc, escaped]) if (internal(sample)) throw new Error(`self-test: preview own social-image host flagged in ${sample}`)
    if (!internal(`<a href="https://${own}/x">`)) throw new Error('self-test: preview own host outside a social image must still fail')
    if (!internal(html.replace(own, 'other-app.vercel.app'))) throw new Error('self-test: another preview host must still fail')
    setEnv({ VERCEL_ENV: 'production', VERCEL_URL: own, VERCEL_BRANCH_URL: own })
    if (!internal(html)) throw new Error('self-test: a production build must reject any vercel.app social image')
    setEnv({ VERCEL_ENV: undefined, VERCEL_URL: undefined, VERCEL_BRANCH_URL: undefined })
    if (!internal(html)) throw new Error('self-test: a local build must reject any vercel.app social image')
  } finally {
    setEnv(saved)
  }
  process.stdout.write(`PASS #4339 built-output anti-copy self-test (${bad.length} caught, ${good.length} exempt, preview social-image host scoped)\n`)
}

function wiring() {
  const failures = []
  const pkg = JSON.parse(fs.readFileSync(path.join(MARKETING, 'package.json'), 'utf8'))
  const build = pkg.scripts.build ?? ''
  const own = 'node ../.github/scripts/strict-grep/issue-4339-built-output-anti-copy.mjs --built'
  if (!build.endsWith(` && ${own}`) || build.lastIndexOf(own) < build.lastIndexOf('next build')) {
    failures.push('package.json build does not end by running this gate with --built after the final next build')
  }
  // The test-only keep switch (the #2771 Playwright build) never reaches the release build.
  if (/MINGLA_KEEP_TEST_IDS/.test(build)) failures.push('package.json build must not set MINGLA_KEEP_TEST_IDS (test builds only)')
  const config = fs.readFileSync(path.join(MARKETING, 'next.config.ts'), 'utf8')
  if (!/poweredByHeader:\s*false/.test(config)) failures.push('next.config.ts must set poweredByHeader: false')
  if (!/reactRemoveProperties:\s*\{\s*properties:\s*\['\^data-testid\$'\]\s*\}/.test(config)) failures.push('next.config.ts must strip data-testid')
  if (!/new StripIssueRefsPlugin\(\)/.test(config)) failures.push('next.config.ts must strip issue references from emitted JS')
  if (!/key: 'Content-Security-Policy', value: csp\.enforced/.test(config)) failures.push('next.config.ts must send the Content-Security-Policy')
  if (failures.length) throw new Error(`#4339 built-output anti-copy wiring FAIL\n- ${failures.join('\n- ')}`)
  process.stdout.write('PASS #4339 built-output anti-copy wiring (build-final scan, poweredByHeader off, test ids and issue refs stripped, CSP)\n')
}

function built() {
  const next = path.join(MARKETING, '.next')
  if (!fs.existsSync(path.join(next, 'BUILD_ID'))) throw new Error('#4339 anti-copy: run `next build` first (no mingla-marketing/.next/BUILD_ID)')
  const files = builtFiles(next)
  if (files.length < 50) throw new Error(`#4339 anti-copy: only ${files.length} built files found; refusing a vacuous pass`)
  const hits = files.flatMap((file) => scanText(fs.readFileSync(file, 'utf8'), path.relative(MARKETING, file)))
  if (hits.length) {
    const byRule = {}
    for (const h of hits) (byRule[h.rule] ??= []).push(h)
    const lines = Object.entries(byRule).flatMap(([rule, list]) => [`${rule}: ${list.length}`, ...list.slice(0, 10).map((h) => `  ${h.file} :: ${h.at}`)])
    throw new Error(`#4339 built-output anti-copy FAIL (${hits.length} hits in ${files.length} files)\n${lines.join('\n')}`)
  }
  process.stdout.write(`PASS #4339 built-output anti-copy: ${files.length} built HTML/JS/RSC/CSS files carry no issue number, TODO, internal host, test id or developer comment\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv.includes('--self-test') ? 'self-test' : process.argv.includes('--built') ? 'built' : 'plain'
  if (mode === 'self-test') selfTest()
  else if (mode === 'built') built()
  else wiring()
}
