// #4339 (Seth, 10 Nov 2026): "the old x links are gone everywhere that it
// matters." X and every @minglahost account are retired (#4318 feedback 16).
// Mingla's own profiles are the approved @usemingla seven in
// lib/links-config.ts, and every surface that lists them reads that list.
//
//   X-1  nothing usemingla.com ships (app/, components/, content/, lib/,
//        public/) links to a Mingla X account or names @minglahost, and Threads
//        lives on threads.com, not threads.net
//   X-2  the careers footer and the Organization sameAs read LINKS_SOCIALS
//   X-3  the hosted email signature carries exactly the approved seven
//   X-4  /links has a current title and description
//
// Other people's X links (a booker's own handle, for example) are not
// Mingla's accounts and are out of scope: the scan matches only Mingla handles.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
// Comments may say an account is retired; only shipped code and markup count.
const code = (source) => source
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

const SHIPPED_DIRS = ['app', 'components', 'content', 'lib', 'public']
const SCANNED = /\.(tsx?|mjs|js|json|html|md|mdx|txt|xml|css)$/
const SKIP_DIR = new Set(['node_modules', '.next', '__tests__'])
// The guards that name the retired accounts in order to forbid them.
const SKIP_FILE = new Set(['lib/links-config.tester.test.ts'])

/** Every Mingla handle we ever used: the retired ones may never come back. */
const RETIRED = [
  [/(?:^|[^a-z0-9.-])(?:www\.)?(?:x|twitter)\.com\/(?:use)?mingla(?:host|business|app)?\b/i, 'a Mingla X account'],
  [/[@/]minglahost\b/i, '@minglahost'],
  [/threads\.net\/@?(?:use)?mingla/i, 'Threads on threads.net (it is threads.com)'],
  [/Share on X/, 'a Share on X button'],
]

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(MARKETING, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) walk(rel, out)
    } else if (SCANNED.test(entry.name) && !SKIP_FILE.has(rel)) {
      out.push(rel)
    }
  }
  return out
}

const APPROVED = [
  'https://www.instagram.com/usemingla',
  'https://www.tiktok.com/@usemingla',
  'https://www.threads.com/@usemingla',
  'https://www.snapchat.com/add/usemingla',
  'https://www.youtube.com/@usemingla',
  'https://www.facebook.com/usemingla',
  'https://www.linkedin.com/company/usemingla',
]

test('X-1 nothing shipped links to a Mingla X account or names @minglahost', () => {
  const files = SHIPPED_DIRS.flatMap((dir) => walk(dir))
  assert.ok(files.length > 100, `scanned only ${files.length} files`)
  const hits = []
  for (const file of files) {
    const text = /\.(json|txt|xml|css)$/.test(file) ? read(file) : code(read(file))
    for (const [pattern, what] of RETIRED) {
      if (pattern.test(text)) hits.push(`${file}: ${what}`)
    }
  }
  assert.deepEqual(hits, [])
})

test('X-1 the scan catches each retired account (self-check)', () => {
  const caught = (text) => RETIRED.some(([pattern]) => pattern.test(text))
  for (const bad of ['https://x.com/usemingla', 'href="https://twitter.com/minglahost"', 'https://www.threads.net/@usemingla', '@MinglaHost', 'https://www.instagram.com/minglahost', 'Share on X']) {
    assert.ok(caught(bad), bad)
  }
  for (const fine of ['https://x.com/blue_note', 'https://www.threads.com/@usemingla', 'https://www.instagram.com/usemingla', 'https://dropbox.com/usemingla', 'export default function MinglaHostPage()']) {
    assert.ok(!caught(fine), fine)
  }
})

test('X-2 the careers footer and the Organization sameAs read the approved list', () => {
  const careers = read('app/careers/roles/layout.tsx')
  assert.match(careers, /import \{ LINKS_SOCIALS \} from '@\/lib\/links-config'/)
  assert.match(careers, /const SOCIAL_LINKS = LINKS_SOCIALS\.map\(/)
  const schema = read('components/cutout/schema.tsx')
  assert.match(schema, /import \{ LINKS_SOCIALS \} from '@\/lib\/links-config'/)
  assert.match(schema, /const SAME_AS = \[\s*\.\.\.LINKS_SOCIALS\.map\(\(social\) => social\.href\),/)
  const config = read('lib/links-config.ts')
  for (const url of APPROVED) assert.ok(config.includes(`href: '${url}'`), url)
})

test('X-3 the hosted email signature links exactly the approved seven, each with its icon', () => {
  const html = read('public/signature.html')
  const start = html.indexOf('<!-- socials -->')
  const end = html.indexOf('<!-- ============ /SIGNATURE')
  assert.ok(start >= 0 && end > start, 'the signature has a socials block before its end marker')
  const socials = html.slice(start, end)
  assert.ok(socials.length > 200 && socials.length < 20000, `socials window is ${socials.length} chars`)
  const hrefs = [...socials.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(hrefs, APPROVED)
  for (const [, icon] of socials.matchAll(/src="https:\/\/usemingla\.com\/brand\/email\/(social-[a-z]+\.png)"/g)) {
    assert.ok(fs.existsSync(path.join(MARKETING, 'public/brand/email', icon)), `${icon} is missing`)
  }
  assert.doesNotMatch(socials, /social-x\.png|alt="X"/)
})

test('X-4 /links has a current title and description', () => {
  const page = read('app/links/page.tsx')
  assert.match(page, /title: 'Mingla · Links',/)
  assert.doesNotMatch(page, /title: 'Get Mingla'/)
  assert.doesNotMatch(page, /experiences app for date nights/)
})
