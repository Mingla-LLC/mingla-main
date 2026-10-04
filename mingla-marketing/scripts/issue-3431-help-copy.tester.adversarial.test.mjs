#!/usr/bin/env node
// #3431 — adversarial: the Help copy opt-in must not leak, and nothing else in
// the content protection may loosen. Fails if the marker appears anywhere but
// the Help layout, if the html-level lock goes, if drag / devtools-key blocking
// become conditional, or if images/video inside the region become copyable.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// TypeScript's own transpiler (a devDependency) so this runs on Node 20 and 22 alike.
const ts = createRequire(import.meta.url)('typescript')
const toJs = (tsSource) =>
  ts.transpileModule(tsSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve },
  }).outputText
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')

// ---- 1. the marker lives ONLY on the Help layout ----------------------------
const ALLOWED = new Set(['app/help/layout.tsx'])
const MARKER_ALLOWED_TO_READ = new Set([
  'components/marketing/content-protection.tsx', // the selector that honours it
  'app/globals.css', // the selection rule
])
const walk = (dir) =>
  readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = path.join(dir, name)
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel]
  })
const carriers = ['app', 'components']
  .flatMap(walk)
  .filter((rel) => /\.(tsx?|jsx?|mdx?|css)$/.test(rel))
  .filter((rel) => !MARKER_ALLOWED_TO_READ.has(rel))
  .filter((rel) => /data-allow-copy|dataAllowCopy|allowCopy/.test(stripComments(read(rel))))
assert.deepEqual(
  carriers.sort(),
  [...ALLOWED],
  'only app/help/layout.tsx may opt a page out of copy protection',
)

// ---- 2. html-level lock + img/video lock still present ----------------------
const css = stripComments(read('app/globals.css'))
const htmlRule = [...css.matchAll(/(^|\})\s*html\s*\{([^}]*)\}/g)].find((m) =>
  /(^|[;\s])user-select:\s*none/.test(m[2]),
)
assert.ok(htmlRule, 'globals.css must keep html { user-select: none } (the site-wide lock)')
assert.match(htmlRule[2], /(^|[;\s])user-select:\s*none/, 'html must keep user-select: none')
assert.match(htmlRule[2], /-webkit-touch-callout:\s*none/, 'html must keep -webkit-touch-callout: none')
const mediaInRegion = /\[data-allow-copy\]\s+img,\s*\[data-allow-copy\]\s+video\s*\{([^}]*)\}/.exec(css)
assert.ok(mediaInRegion, 'img/video inside [data-allow-copy] need their own (0,1,1) rule to beat [data-allow-copy] *')
for (const decl of [/-webkit-user-drag:\s*none/, /-webkit-touch-callout:\s*none/, /(^|[;\s])user-select:\s*none/]) {
  assert.match(mediaInRegion[1], decl, `img/video inside the region must keep ${decl}`)
}

// ---- 3. behaviour: run the real handlers against a fake DOM -----------------
class FakeNode {
  constructor(parent = null) {
    this.parentElement = parent
  }
}
class FakeElement extends FakeNode {
  constructor(tagName, attrs = {}, parent = null) {
    super(parent)
    this.tagName = tagName.toUpperCase()
    this.attrs = attrs
    this.isContentEditable = false
  }
  closest(selector) {
    const match = /^\[([a-z-]+)\]$/.exec(selector)
    if (!match) throw new Error(`fake closest() does not support ${selector}`)
    for (let el = this; el; el = el.parentElement) {
      if (Object.hasOwn(el.attrs, match[1])) return el
    }
    return null
  }
}
class FakeHTMLElement extends FakeElement {}
class FakeText extends FakeNode {}

const listeners = new Map()
let source = read('components/marketing/content-protection.tsx')
source = toJs(source.replace(/^'use client'\s*$/m, ''))
source = source.replace(/^import .*$/gm, '').replace(/export function/g, 'function')
const ContentProtection = new Function(
  'useEffect', 'document', 'Element', 'HTMLElement', 'Node',
  `${source}\nreturn ContentProtection`,
)(
  (effect) => effect(),
  { addEventListener: (t, fn) => listeners.set(t, fn), removeEventListener: () => {} },
  FakeElement, FakeHTMLElement, FakeNode,
)
ContentProtection()
const fire = (type, target, extra = {}) => {
  const handler = listeners.get(type)
  assert.ok(handler, `ContentProtection must listen for ${type}`)
  let prevented = false
  handler({ type, target, key: '', ...extra, preventDefault: () => { prevented = true } })
  return prevented
}

const body = new FakeHTMLElement('body')
const homeMain = new FakeHTMLElement('main', { id: 'main' }, body)
const homeHeading = new FakeHTMLElement('h1', {}, homeMain)
const helpMain = new FakeHTMLElement('main', { id: 'main', 'data-allow-copy': '' }, body)
const helpText = new FakeText(new FakeHTMLElement('p', {}, helpMain))
const helpImg = new FakeHTMLElement('img', {}, helpMain)
const helpVideo = new FakeHTMLElement('video', {}, helpMain)

// Everywhere else stays locked — elements, Text nodes, and non-Node targets.
for (const type of ['copy', 'cut', 'selectstart', 'contextmenu']) {
  assert.equal(fire(type, homeHeading), true, `${type} outside Help must stay blocked`)
  assert.equal(fire(type, new FakeText(homeHeading)), true, `${type} on non-Help Text must stay blocked`)
  assert.equal(fire(type, null), true, `${type} with no target must stay blocked`)
  assert.equal(fire(type, {}), true, `${type} on a non-Node target must stay blocked`)
}
// Images/video inside Help keep no context menu (no save-image-as).
assert.equal(fire('contextmenu', helpImg), true, 'right-click on a Help image must stay blocked')
assert.equal(fire('contextmenu', helpVideo), true, 'right-click on a Help video must stay blocked')
// Drag-out is unconditional, Help included.
for (const target of [helpImg, helpVideo, helpText, homeHeading]) {
  assert.equal(fire('dragstart', target), true, 'dragstart must stay blocked everywhere')
}
// Devtools / save / print / view-source keys are unconditional, Help included.
for (const target of [helpText, homeHeading]) {
  assert.equal(fire('keydown', target, { key: 'F12' }), true, 'F12 must stay blocked')
  for (const key of ['u', 's', 'p']) {
    assert.equal(fire('keydown', target, { key, metaKey: true }), true, `Cmd+${key} must stay blocked`)
  }
  assert.equal(fire('keydown', target, { key: 'I', ctrlKey: true, shiftKey: true }), true, 'Ctrl+Shift+I must stay blocked')
  assert.equal(fire('keydown', target, { key: 'j', metaKey: true, altKey: true }), true, 'Cmd+Opt+J must stay blocked')
}
// Copy shortcut itself is NOT a blocked key (the copy event decides).
assert.equal(fire('keydown', helpText, { key: 'c', metaKey: true }), false, 'Cmd+C keydown must not be blocked on Help')

console.log('issue-3431 help copy adversarial: PASS')
