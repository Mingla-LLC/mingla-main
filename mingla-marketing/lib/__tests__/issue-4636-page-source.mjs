// #4636 test harness (not a test): a page's source as source-scanning tests
// should see it after the block extraction. Each catalogued section moved out
// of its page file into a block component (components/site-blocks/sections/)
// and its copy into a default-content module (content/site-blocks/), so a
// test that pinned markup or copy "in the page" now reads the page file plus
// every block and content module it imports (recursively), in import order.
// A file that imports no blocks reads exactly as before.
import fs from 'node:fs'
import path from 'node:path'
import { MARKETING } from './issue-4452-ts-loader.mjs'

const BLOCK_IMPORT = /from '(@\/components\/site-blocks\/sections\/[\w-]+|@\/content\/site-blocks\/[\w-]+|@\/components\/site-blocks\/hero-words|\.\/sections\/[\w-]+|\.\/[\w-]+)'/g

function resolve(spec, fromRel) {
  let rel
  if (spec.startsWith('@/')) rel = spec.slice(2)
  else rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  for (const ext of ['.tsx', '.ts']) if (fs.existsSync(path.join(MARKETING, rel + ext))) return rel + ext
  return null
}

// shared.tsx and city-data.ts are the blocks' generic helpers (every hand-off
// kind, every city reader), not any page's own markup: they are left out.
const GENERIC = new Set(['components/site-blocks/sections/shared.tsx', 'components/site-blocks/sections/city-data.ts'])
const inBlocks = (rel) =>
  !GENERIC.has(rel) && (rel.startsWith('components/site-blocks/sections/') || rel.startsWith('content/site-blocks/') || rel === 'components/site-blocks/hero-words.tsx')

export function pageSource(rel, seen = new Set()) {
  if (seen.has(rel)) return ''
  seen.add(rel)
  const own = fs.readFileSync(path.join(MARKETING, rel), 'utf8')
  let out = own
  for (const m of own.matchAll(BLOCK_IMPORT)) {
    const dep = resolve(m[1], rel)
    if (!dep || !inBlocks(dep)) continue
    out += `\n/* ---- ${dep} ---- */\n` + pageSource(dep, seen)
  }
  return out
}
