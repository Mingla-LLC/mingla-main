// MINGLA-INVARIANT: I-4636-NO-ADDRESS-COLLISION | issue #4636 | a staff-made page address never starts with a segment the coded site answers: lib/site-pages/reserved-paths.json is generated from app/** (and the middleware, rewrites and route registry) and equals the database's site_reserved_segments().
// MINGLA-INVARIANT: I-4636-NO-IMAGE-TRANSFORMS | issue #4636 | no site page, block, media library or editor code uses Supabase Image Transformations (/render/image, hold #1643); library media are plain public object URLs.
// #4636 build 2: the database's copies stay identical to the site's sources.
//   - site_block_registry() (the LATEST migration that defines it) = lib/site-blocks/registry.json
//     (I-4636-ONE-BLOCK-REGISTRY, declared in issue-4636-block-registry.implementor.test.mjs);
//   - site_reserved_segments() = lib/site-pages/reserved-paths.json, which is current with the app routes;
//   - site_converted_page_keys() = lib/site-pages/converted.ts;
//   - no /render/image anywhere in the site CMS code.
// FAILS-ON-REVERT: adding a route folder under app/ without regenerating fails the reserved check; changing a
// block in registry.ts (and its JSON) without a migration that re-emits site_block_registry() fails the first test.
// Run from mingla-marketing/: node --test lib/__tests__/issue-4636-db-parity.implementor.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { loader, MARKETING } from './issue-4452-ts-loader.mjs'
import { reservedJsonText, RESERVED_JSON, appSegments } from '../../scripts/issue-4636-reserved-paths.mjs'

const REPO = path.resolve(MARKETING, '..')
const MIGRATIONS = path.join(REPO, 'supabase/migrations')
const L = loader('issue-4636-parity-')
after(L.cleanup)
const converted = await L.load('site-pages/converted')

/** The body of the latest migration that (re)defines a function. */
function latestDefinition(fn) {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files.reverse()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')
    if (new RegExp(`FUNCTION public\\.${fn}\\(\\)`).test(sql)) return { file: f, sql }
  }
  throw new Error(`no migration defines ${fn}()`)
}

function jsonLiteral(sql, fn) {
  const at = sql.search(new RegExp(`FUNCTION public\\.${fn}\\(\\)`))
  const body = sql.slice(at)
  const m = body.match(/\$json\$([\s\S]*?)\$json\$/)
  assert.ok(m, `${fn}: a $json$ literal`)
  return JSON.parse(m[1])
}

test('I-4636-ONE-BLOCK-REGISTRY: site_block_registry() equals registry.json', () => {
  const { file, sql } = latestDefinition('site_block_registry')
  const db = jsonLiteral(sql, 'site_block_registry')
  const site = JSON.parse(fs.readFileSync(path.join(MARKETING, 'lib/site-blocks/registry.json'), 'utf8'))
  assert.deepEqual(db, site, `${file} re-emits a stale registry; add a migration that re-emits site_block_registry() from registry.json`)
})

test('I-4636-NO-ADDRESS-COLLISION: reserved-paths.json is current with the app and equals site_reserved_segments()', () => {
  assert.equal(fs.readFileSync(RESERVED_JSON, 'utf8'), reservedJsonText(), 'run node scripts/issue-4636-reserved-paths.mjs')
  const site = JSON.parse(fs.readFileSync(RESERVED_JSON, 'utf8'))
  const { file, sql } = latestDefinition('site_reserved_segments')
  assert.deepEqual(jsonLiteral(sql, 'site_reserved_segments'), site, `${file} is stale; re-emit site_reserved_segments()`)
  // Every coded first segment is reserved (the catch-all can never shadow a coded route).
  for (const seg of appSegments()) assert.ok(site.segments.includes(seg), `app/${seg} is reserved`)
  for (const seg of ['host', 'blog', 'api', 'site-preview', 'careers', 'careers-not-found', 'm', 'p', 's', 'og', 'share', 'unsubscribe']) assert.ok(site.segments.includes(seg), seg)
})

test('site_converted_page_keys() equals lib/site-pages/converted.ts', () => {
  const { sql } = latestDefinition('site_converted_page_keys')
  const body = sql.slice(sql.indexOf('FUNCTION public.site_converted_page_keys()'))
  const keys = [...body.slice(0, body.indexOf('$$;', body.indexOf('ARRAY['))).matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
  assert.deepEqual(keys, [...converted.CONVERTED_PAGE_KEYS])
  assert.equal(converted.CONVERTED_PAGE_KEYS.length, 14)
})

test('I-4636-NO-IMAGE-TRANSFORMS: no /render/image in the site CMS code', () => {
  const roots = [
    'mingla-marketing/lib/site-pages', 'mingla-marketing/lib/site-blocks', 'mingla-marketing/components/site-blocks',
    'mingla-marketing/app/site-preview', 'mingla-marketing/app/[...slug]', 'mingla-marketing/lib/landing-media-ref.ts', 'mingla-marketing/lib/clip-sources.ts',
    'supabase/migrations/20281208004636_issue_4636_site_cms.sql', 'mingla-admin/src/services/siteCmsService.js',
  ]
  const files = []
  const walk = (p) => {
    const abs = path.join(REPO, p)
    if (!fs.existsSync(abs)) return
    if (fs.statSync(abs).isDirectory()) for (const f of fs.readdirSync(abs)) walk(path.join(p, f))
    else if (/\.(ts|tsx|js|jsx|mjs|sql|json)$/.test(p)) files.push(p)
  }
  roots.forEach(walk)
  assert.ok(files.length > 20)
  // Code only: comments that NAME the hold are fine (// and -- line comments, /* */ blocks).
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)(\/\/|--)\s.*$/, '')).join('\n')
  for (const f of files) assert.doesNotMatch(code(fs.readFileSync(path.join(REPO, f), 'utf8')), /\/render\/image/, f)
  assert.match(code('const u = `${root}/storage/v1/render/image/public/x`'), /\/render\/image/, 'the scan sees code')
})
