#!/usr/bin/env node
// #4452 §2.1 T-2.1 (SC-90) — fails the build when a public page is missing from the registry.
//
// Walks app/**/page.tsx, turns each into its route pattern (route groups
// stripped, dynamic segments kept as [name]), and requires every route to be a
// registry page path or match an EXCLUDED route (with a reason). `--self-test`
// proves the check fails on a fixture route and passes once it is added.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function routesUnder(appDir) {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === 'page.tsx' || e.name === 'page.ts') {
        const rel = path.relative(appDir, path.dirname(p)).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s))
        out.push('/' + rel.join('/'))
      }
    }
  }
  walk(appDir)
  return [...new Set(out.map((r) => r.replace(/\/$/, '') || '/'))].sort()
}

function matches(route, pattern) {
  if (pattern === route) return true
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2)
    if (route === base) return false
    const re = new RegExp(`^${base.replace(/\[[^\]]+\]/g, '[^/]+').replace(/\*/g, '[^/]+')}/`)
    return re.test(route)
  }
  const re = new RegExp(`^${pattern.replace(/\[[^\]]+\]/g, '\\[[^\\]]+\\]').replace(/\*/g, '[^/]+')}$`)
  return re.test(route)
}

export function missingRoutes(appDir, registry) {
  const listed = new Set(registry.pages.map((p) => p.path))
  return routesUnder(appDir).filter((r) => !listed.has(r) && !registry.excluded.some((x) => x.reason && matches(r, x.route)))
}

function main() {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/site-pages/registry.json'), 'utf8'))
  if (process.argv.includes('--self-test')) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4452-manifest-'))
    try {
      fs.mkdirSync(path.join(tmp, '(core)', 'brand-new-page'), { recursive: true })
      fs.writeFileSync(path.join(tmp, '(core)', 'brand-new-page', 'page.tsx'), 'export default function P() { return null }\n')
      fs.writeFileSync(path.join(tmp, 'page.tsx'), 'export default function P() { return null }\n')
      const before = missingRoutes(tmp, registry)
      if (JSON.stringify(before) !== JSON.stringify(['/brand-new-page'])) throw new Error(`self-test: expected the fixture to fail, got ${JSON.stringify(before)}`)
      const after = missingRoutes(tmp, { ...registry, pages: [...registry.pages, { key: 'brand-new-page', path: '/brand-new-page' }] })
      if (after.length !== 0) throw new Error(`self-test: expected a pass once added, got ${JSON.stringify(after)}`)
      console.log('PASS issue-4452 site manifest check self-test (fails on a missing fixture page, passes once added)')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
    return
  }
  const missing = missingRoutes(path.join(ROOT, 'app'), registry)
  if (missing.length) {
    for (const r of missing) console.error(`${r} is a public page missing from lib/site-pages/registry.ts (add it, or add it to EXCLUDED with a reason)`)
    process.exit(1)
  }
  console.log('PASS issue-4452 site manifest check: every public page is listed')
}

if (import.meta.url === `file://${process.argv[1]}`) main()
