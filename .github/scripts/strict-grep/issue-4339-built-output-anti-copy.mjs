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
// Modes (I-PROPOSED-1383 registry, local descriptor beside this file):
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

export const RULES = [
  { id: 'ISSUE_REF', re: /#[1-9]\d{2,3}\b(?![,;}!0-9a-fA-F])/g, skipIn: /\.css$/, keep: (text, index) => ADDRESS_BEFORE.test(text.slice(Math.max(0, index - 12), index)) || /[a-fA-F0-9]$/.test(text.slice(index - 1, index)) || /^#[1-9]\d{2,3}["')\]]/.test(text.slice(index, index + 6)) },
  { id: 'TODO', re: /\b(?:TODO|FIXME)\b/g },
  { id: 'INTERNAL_HOST', re: /\b[a-z0-9-]+\.vercel\.app\b|\blocalhost:\d{2,5}\b|\b127\.0\.0\.1:\d{2,5}\b|\b[a-z0-9-]+\.(?:internal|local)\b(?!\w)|\b[a-z0-9]+\.supabase\.in\b/g },
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
  process.stdout.write(`PASS #4339 built-output anti-copy self-test (${bad.length} caught, ${good.length} exempt)\n`)
}

function wiring() {
  const failures = []
  const pkg = JSON.parse(fs.readFileSync(path.join(MARKETING, 'package.json'), 'utf8'))
  const build = pkg.scripts.build ?? ''
  const own = 'node ../.github/scripts/strict-grep/issue-4339-built-output-anti-copy.mjs --built'
  if (!build.endsWith(` && ${own}`) || build.lastIndexOf(own) < build.lastIndexOf('next build')) {
    failures.push('package.json build does not end by running this gate with --built after the final next build')
  }
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
