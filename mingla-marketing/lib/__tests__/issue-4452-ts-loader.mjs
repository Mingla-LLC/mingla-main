// #4452 test harness (not a test): load lib/*.ts modules in plain node by
// stripping their TypeScript types (no install), following their './' and
// '@/lib/' imports. Same approach as the #4318 links test.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const IMPORT = /from\s+'(@\/lib\/|\.\/|\.\.\/)([\w\/-]+)'/g

export function loader(prefix) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const seen = new Set()
  const emit = (rel) => {
    if (seen.has(rel)) return
    seen.add(rel)
    const source = fs.readFileSync(path.join(MARKETING, 'lib', `${rel}.ts`), 'utf8')
    const deps = []
    const dir = path.posix.dirname(rel)
    const js = stripTypeScriptTypes(source).replace(IMPORT, (_m, prefixKind, dep) => {
      const target = prefixKind === '@/lib/' ? dep : path.posix.normalize(path.posix.join(dir, prefixKind === '../' ? `../${dep}` : dep))
      deps.push(target)
      const relTo = path.posix.relative(dir, target)
      return `from '${relTo.startsWith('.') ? relTo : `./${relTo}`}.mjs'`
    })
    const file = path.join(out, `${rel}.mjs`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, js)
    for (const d of deps) emit(d)
  }
  return {
    load: async (rel) => {
      emit(rel)
      return import(pathToFileURL(path.join(out, `${rel}.mjs`)).href)
    },
    cleanup: () => fs.rmSync(out, { recursive: true, force: true }),
  }
}
