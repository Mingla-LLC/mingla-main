// #4339 round B — a tiny loader for the round B tests: strips the types from a
// .ts module and every .ts module it imports (relative, `@/…` and the
// `@mingla/search-measurement` workspace package), writes them as .mjs into a
// temp directory mirroring the repo, and imports the entry. No install needed
// (node 22.13+ `stripTypeScriptTypes`).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REPO = path.resolve(MARKETING, '..')
const PACKAGES = { '@mingla/search-measurement': path.join(REPO, 'packages/search-measurement/src/index.ts') }
const SPEC = /(from\s+|import\(\s*)(['"])([^'"]+)\2/g

function resolveSpec(fromFile, spec) {
  if (PACKAGES[spec]) return PACKAGES[spec]
  let base
  if (spec.startsWith('@/')) base = path.join(MARKETING, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else return null
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (candidate.endsWith('.ts') && fs.existsSync(candidate)) return candidate
  }
  if (base.endsWith('.json') && fs.existsSync(base)) return base
  if (fs.existsSync(`${base}.json`)) return `${base}.json`
  return null
}

export function makeLoader() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-roundb-'))
  const done = new Map()
  const target = (abs) => path.join(out, path.relative(REPO, abs).replace(/\.ts$/, '.mjs'))
  function emit(abs) {
    if (done.has(abs)) return done.get(abs)
    const dest = target(abs)
    done.set(abs, dest)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    if (abs.endsWith('.json')) {
      fs.copyFileSync(abs, dest)
      return dest
    }
    const js = stripTypeScriptTypes(fs.readFileSync(abs, 'utf8')).replace(SPEC, (whole, lead, quote, spec) => {
      const resolved = resolveSpec(abs, spec)
      if (!resolved) return whole
      const emitted = emit(resolved)
      let rel = path.relative(path.dirname(dest), emitted)
      if (!rel.startsWith('.')) rel = `./${rel}`
      const attr = resolved.endsWith('.json') && lead.startsWith('from') ? " with { type: 'json' }" : ''
      return `${lead}${quote}${rel}${quote}${attr}`
    })
    fs.writeFileSync(dest, js)
    return dest
  }
  return {
    out,
    async load(rel) {
      const abs = rel.startsWith('/') ? rel : path.join(MARKETING, rel)
      return import(pathToFileURL(emit(abs)).href)
    },
    cleanup() {
      fs.rmSync(out, { recursive: true, force: true })
    },
  }
}
