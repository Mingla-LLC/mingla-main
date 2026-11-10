// #4339 — blog button block and Share row, regression for Seth's 10 Nov 2026
// report on the 1.2 launch posts (/blog/mingla-host-1-2, /blog/mingla-1-2):
//
//   1. The button block rendered black text on a black pill. Cause: the anchor
//      was `.cut-btn-dark` (one class, colour #fff), and the site-wide
//      `[data-landing] a { color: inherit }` (attribute + element) outranks one
//      class, so the label took the dark prose colour. The button now has its
//      own new-brand class whose colour rule is scoped by two selectors, and
//      no blog button relies on a single-class tint for its text colour.
//   2. Nothing said where the button goes. Every app-download button now
//      carries a helper line (and an arrow).
//   3. X is retired for Mingla, so the Share row offers no X button.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-blog-button-'))
after(() => fs.rmSync(out, { recursive: true, force: true }))
fs.writeFileSync(path.join(out, 'button-helper.mjs'), stripTypeScriptTypes(read('lib/blog/button-helper.ts')))
const { blogButtonHelper } = await import(pathToFileURL(path.join(out, 'button-helper.mjs')).href)

// CSS specificity as [ids, classes+attributes+pseudo-classes, elements].
function specificity(selector) {
  const s = selector.replace(/::?[a-z-]+\([^)]*\)/g, (m) => (m.startsWith('::') ? ' e' : ' .c'))
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length
  const elements = (s.replace(/\[[^\]]+\]|\.[\w-]+|#[\w-]+|:[\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length
  return [ids, classes, elements]
}
const beats = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]

test('the button block label outranks [data-landing] a { color: inherit }', () => {
  const landing = code(read('components/landing/landing.css'))
  assert.match(landing, /\[data-landing\] a\s*\{[^}]*color:\s*inherit/, 'the rule this guards against is still present; if it is gone, update this test')
  const doc = code(read('components/blog/blog-document.tsx'))
  const fn = doc.slice(doc.indexOf('function TargetButton'), doc.indexOf('function renderBlock'))
  assert.match(fn, /className="blog-button focus-ring"/)
  assert.doesNotMatch(fn, /cut-btn-dark/, 'the single-class tint loses its colour to [data-landing] a')
  const css = code(read('components/blog/blog.css'))
  const rule = css.match(/([^{}]*\.blog-button)\s*\{([^}]*)\}/)
  assert.ok(rule, 'blog.css styles .blog-button')
  assert.match(rule[2], /background:\s*#111110/i, 'Ink background')
  assert.match(rule[2], /(^|[\s;])color:\s*#f5f4f0/i, 'Paper text')
  for (const selector of rule[1].split(',')) {
    assert.ok(beats(specificity(selector.trim()), specificity('[data-landing] a')), `${selector.trim()} must outrank [data-landing] a`)
  }
  // The prose link colour rule (several :not()s) outranks .blog-button, so it
  // must exclude it; otherwise the label turns the link orange-brown.
  for (const prose of css.match(/[^{}]*\.blog-prose a[^{}]*(?=\{)/g) ?? []) {
    for (const selector of prose.split(',')) {
      if (!/\.blog-prose a\b/.test(selector) || !/color/.test(css.slice(css.indexOf(prose)).split('}')[0])) continue
      assert.match(selector, /:not\(\.blog-button\)/, `${selector.trim()} would recolour the button label`)
    }
  }
  const restore = css.match(/([^{}]*a\.cut-btn-dark[^{}]*)\{([^}]*)\}/)
  assert.ok(restore && /color:\s*#fff/.test(restore[2]), 'moulded buttons inside a post get their white text back')
  for (const selector of restore[1].split(',')) {
    assert.ok(beats(specificity(selector.trim()), specificity('[data-landing] a')), `${selector.trim()} must outrank [data-landing] a`)
  }
})

test('the button block shows an arrow and its helper line', () => {
  const fn = code(read('components/blog/blog-document.tsx'))
  assert.match(fn, /<ArrowRight aria-hidden="true" className="blog-button-arrow" \/>/)
  assert.match(fn, /blogButtonHelper\(target\)/)
  assert.match(fn, /className="blog-button-helper"/)
})

test('app-download buttons say where they go', () => {
  for (const p of ['/host/get', '/host/get?x=1', '/host/get/', '/host/download']) {
    assert.match(blogButtonHelper({ kind: 'page', path: p }), /App Store or Google Play.*Mingla Host on the web/, p)
  }
  assert.match(blogButtonHelper({ kind: 'page', path: '/download' }), /App Store or Google Play.*code to scan/)
  assert.equal(blogButtonHelper({ kind: 'page', path: '/about' }), null)
  assert.equal(blogButtonHelper({ kind: 'url', href: 'https://www.example.com/a', newTab: true }), 'Opens example.com in a new tab.')
  assert.equal(blogButtonHelper({ kind: 'url', href: 'https://example.com' }), 'Opens example.com.')
  assert.equal(blogButtonHelper({ kind: 'url', href: 'not a url' }), null)
})

test('the Share row has no X button', () => {
  const share = code(read('components/blog/blog-share.tsx'))
  assert.doesNotMatch(share, /x\.com|twitter\.com/i)
  assert.doesNotMatch(share, />X</)
  assert.match(share, />Copy link</)
  assert.match(share, />WhatsApp</)
  assert.match(share, />More</)
})
