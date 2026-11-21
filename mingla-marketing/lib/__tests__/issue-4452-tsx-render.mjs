// #4452 test harness (not a test): render marketing .tsx components to static
// HTML in plain node, with no install. Each file is transpiled with the
// repo's own `typescript` (as the #4137 menu test does), its '@/…' and
// relative imports are followed, CSS imports are dropped, and the listed
// modules are swapped for small stubs (next/link, the CTA seam, analytics).
// React and react-dom come from the app's node_modules.
//
// `source` lets a test render a file as it is on another commit (the order
// guard renders origin/main's report views with the same fixtures).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { MARKETING } from './issue-4452-ts-loader.mjs'

const REQUIRE = /require\("([^"]+)"\)/g

export function tsxRenderer(prefix, { stubs = {}, source = (rel) => null } = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  fs.symlinkSync(path.join(MARKETING, 'node_modules'), path.join(out, 'node_modules'), 'dir')
  fs.mkdirSync(path.join(out, '__stubs'))
  fs.writeFileSync(path.join(out, '__stubs', 'empty.js'), 'module.exports = {}\n')
  for (const [id, code] of Object.entries(stubs)) {
    fs.writeFileSync(path.join(out, '__stubs', `${id.replace(/[^a-z0-9]/gi, '_')}.js`), code)
  }
  const seen = new Set()
  const resolve = (rel) => {
    for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
      if (source(`${rel}${ext}`) !== null || fs.existsSync(path.join(MARKETING, `${rel}${ext}`))) return `${rel}${ext}`
    }
    throw new Error(`tsx-render: cannot resolve ${rel}`)
  }
  const emit = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    const text = source(file) ?? fs.readFileSync(path.join(MARKETING, file), 'utf8')
    const js = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: file,
    }).outputText
    const dir = path.posix.dirname(file)
    const target = path.join(out, file.replace(/\.tsx?$/, '.js'))
    const rewritten = js.replace(REQUIRE, (m, spec) => {
      const rel = (to) => {
        const r = path.relative(path.dirname(target), to)
        return r.startsWith('.') ? r : `./${r}`
      }
      if (spec.endsWith('.css')) return `require("${rel(path.join(out, '__stubs', 'empty.js'))}")`
      if (spec in stubs) return `require("${rel(path.join(out, '__stubs', `${spec.replace(/[^a-z0-9]/gi, '_')}.js`))}")`
      let local = null
      if (spec.startsWith('@/')) local = spec.slice(2)
      else if (spec.startsWith('.')) local = path.posix.normalize(path.posix.join(dir, spec))
      if (local === null) return m
      const resolved = resolve(local)
      emit(resolved)
      return `require("${rel(path.join(out, resolved.replace(/\.tsx?$/, '.js')))}")`
    })
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, rewritten)
  }
  const req = createRequire(path.join(out, 'index.js'))
  return {
    load(file) {
      emit(file)
      return req(path.join(out, file.replace(/\.tsx?$/, '.js')))
    },
    render(element) {
      const { renderToStaticMarkup } = req('react-dom/server')
      return renderToStaticMarkup(element)
    },
    React: req('react'),
    cleanup: () => fs.rmSync(out, { recursive: true, force: true }),
  }
}

/** The stubs every tools page needs (no network, no analytics, plain links). */
export const TOOL_STUBS = {
  'next/link': "const React = require('react'); module.exports = { __esModule: true, default: function Link(p) { const { href, children, prefetch, ...rest } = p; return React.createElement('a', { href, ...rest }, children) } }",
  '@/components/cutout/device-link': "const React = require('react'); module.exports = { DeviceLink: function DeviceLink(p) { return React.createElement('a', { href: '#app', 'data-device-link': p.surface, className: p.className }, p.children) } }",
  '@/components/marketing/marketing-capture': 'module.exports = { captureMarketing() {}, isMarketingAnalyticsOn() { return false } }',
  '@/components/forms/form-events': "globalThis.__formEvents = []; module.exports = { formEvent(name, form, extra) { globalThis.__formEvents.push([name, extra]) } }",
  '@/lib/links-src': "module.exports = { toolAttribution(c) { return { pid: c, campaign: c } } }",
  '@/components/ui/button': "module.exports = { buttonClasses() { return 'btn' } }",
  // #4523: the Mingla calendar needs a browser; a plain button stands in so the tool markup still renders.
  '@mingla/calendar-web': "const React = require('react'); module.exports = { CalendarInput: function CalendarInput(p) { return React.createElement('button', { type: 'button', id: p.id, className: p.className, 'data-calendar-mode': p.mode }, p.value || p.placeholder || '') } }",
  '@mingla/calendar-web/calendar.css': 'module.exports = {}',
  'framer-motion': "const React = require('react'); const tag = (t) => function M(p) { const { initial, animate, whileInView, viewport, transition, ...rest } = p; return React.createElement(t, rest) }; module.exports = { motion: new Proxy({}, { get: (_, t) => tag(t) }), useReducedMotion: () => true }",
}
