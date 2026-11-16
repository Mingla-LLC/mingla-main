// #4452 test harness (not a test): load lib/*.ts modules in plain node by
// stripping their TypeScript types (no install), following their './' and
// '@/lib/' imports. Same approach as the #4318 links test.
//
// node:module stripTypeScriptTypes exists from Node 22.13. Older runners (the
// mingla-business web build runs this app's prebuild on Node 20) fall back to
// the app's own `typescript` transpiler, so the same assertions run there.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as nodeModule from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let fallbackStrip = null
function stripTypeScriptTypes(source) {
  if (typeof nodeModule.stripTypeScriptTypes === 'function') return nodeModule.stripTypeScriptTypes(source)
  if (!fallbackStrip) {
    const ts = nodeModule.createRequire(path.join(MARKETING, 'package.json'))('typescript')
    console.log(`issue-4452-ts-loader: node ${process.version} has no stripTypeScriptTypes; transpiling with typescript ${ts.version}`)
    fallbackStrip = (text) => ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
    }).outputText
  }
  return fallbackStrip(source)
}
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
