#!/usr/bin/env node
// #3431 — support agents can select and copy text on the Help pages.
// Happy path: the Help layout carries the `data-allow-copy` opt-in marker, the
// ContentProtection handlers (executed for real against a minimal fake DOM)
// let copy / cut / selectstart / contextmenu through inside it, and the CSS
// re-enables text selection for the region.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

// ---- minimal fake DOM -------------------------------------------------------
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

function mountProtection() {
  const listeners = new Map()
  const document = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  }
  let source = read('components/marketing/content-protection.tsx')
  source = toJs(source.replace(/^'use client'\s*$/m, ''))
  source = source.replace(/^import .*$/gm, '').replace(/export function/g, 'function')
  const factory = new Function(
    'useEffect', 'document', 'Element', 'HTMLElement', 'Node',
    `${source}\nreturn ContentProtection`,
  )
  const ContentProtection = factory(
    (effect) => effect(), document, FakeElement, FakeHTMLElement, FakeNode,
  )
  assert.equal(ContentProtection(), null, 'ContentProtection renders nothing')
  return (type, target) => {
    const handler = listeners.get(type)
    assert.ok(handler, `ContentProtection must listen for ${type}`)
    let prevented = false
    handler({ type, target, key: '', preventDefault: () => { prevented = true } })
    return prevented
  }
}

// ---- 1. the Help layout carries the marker ----------------------------------
const helpLayout = stripComments(read('app/help/layout.tsx'))
assert.match(
  helpLayout,
  /<main\b[^>]*\bid="main"[^>]*\bdata-allow-copy\b[^>]*>/,
  'app/help/layout.tsx must put data-allow-copy on <main id="main"> so /help and /help/[slug] are copyable',
)

// ---- 2. handlers honour the marker (behavioural) ----------------------------
const fire = mountProtection()
const body = new FakeHTMLElement('body')
const helpMain = new FakeHTMLElement('main', { id: 'main', 'data-allow-copy': '' }, body)
const helpParagraph = new FakeHTMLElement('p', {}, new FakeHTMLElement('section', {}, helpMain))
const helpText = new FakeText(helpParagraph)

for (const type of ['copy', 'cut', 'selectstart', 'contextmenu']) {
  assert.equal(fire(type, helpParagraph), false, `${type} on Help text must be allowed`)
  assert.equal(fire(type, helpText), false, `${type} on a Help Text node must be allowed`)
}

// ---- 3. CSS re-enables selection for the region -----------------------------
const css = stripComments(read('app/globals.css'))
const optIn = /\[data-allow-copy\],\s*\[data-allow-copy\]\s+\*\s*\{([^}]*)\}/.exec(css)
assert.ok(optIn, 'globals.css must style [data-allow-copy], [data-allow-copy] *')
assert.match(optIn[1], /(^|[;\s])user-select:\s*text/, 'opt-in region must set user-select: text')
assert.match(optIn[1], /-webkit-user-select:\s*text/, 'opt-in region must set -webkit-user-select: text')
assert.match(optIn[1], /-webkit-touch-callout:\s*default/, 'opt-in region must restore the touch callout')

console.log('issue-3431 help copy happy path: PASS')
