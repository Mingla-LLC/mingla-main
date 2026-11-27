// MINGLA-INVARIANT: I-4636-PREVIEW-EVERY-PAGE | issue #4636 | every site registry page key has a preview renderer that draws the real route inside its real layouts; no page previews as "This page has no inline spots".
// MINGLA-INVARIANT: I-4636-EDITOR-ORIGIN-CAN-FRAME | issue #4636 | every Admin origin the preview talks to (lib/site-pages/editor.ts) may also frame it (SITE_PREVIEW_FRAME_ANCESTORS), and the editor bridge acts only on messages from that origin and the parent frame.
// #4636 build 2: the preview and the editor bridge for build 3 (Admin canvas).
// Happy: every key renders; a staff page, a settings draft and a converted draft render; the
// message contract accepts its own shapes and maps a click to a field.
// Adversarial: messages from another origin, from another frame or malformed are ignored;
// the vercel.app origin (accepted but not frameable before) is gone; never postMessage('*').
// Run from mingla-marketing/: node --test lib/__tests__/issue-4636-preview-editor.implementor.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { loader, MARKETING } from './issue-4452-ts-loader.mjs'

const read = (p) => fs.readFileSync(path.join(MARKETING, p), 'utf8')
const L = loader('issue-4636-preview-')
after(L.cleanup)
const protocol = await L.load('site-pages/editor-protocol')
const editor = await L.load('site-pages/editor')
const registryKeys = JSON.parse(read('lib/site-pages/registry.json')).pages.map((p) => p.key)

test('I-4636-PREVIEW-EVERY-PAGE: every registry key has a renderer; the old "no inline spots" line is gone', () => {
  const src = read('app/site-preview/[token]/renderers.tsx')
  const body = src.slice(src.indexOf('export const PREVIEW_RENDERERS'))
  const keys = [...body.matchAll(/^  '?([a-z][a-z-]*)'?: /gm)].map((m) => m[1])
  assert.deepEqual([...keys].sort(), [...registryKeys].sort())
  assert.equal(registryKeys.length, 40)
  for (const dir of ['app/site-preview/[token]', 'components/site-blocks']) {
    for (const f of fs.readdirSync(path.join(MARKETING, dir))) {
      if (/\.tsx?$/.test(f)) assert.doesNotMatch(read(`${dir}/${f}`), /has no inline spots/, `${dir}/${f}`)
    }
  }
  // Pattern pages take ?sample= (else their first item); framed layouts get the real address.
  assert.match(src, /city: async \(\{ sample \}\) =>/)
  assert.match(read('components/site/route-frame.tsx'), /const pathname = previewPath \?\? routePath/)
  const bodySrc = read('app/site-preview/[token]/preview-body.tsx')
  assert.match(bodySrc, /if \(key === SITE_SETTINGS_KEY\) \{\n    const home = await PREVIEW_RENDERERS\.home\(ctx\)/, 'a nav / footer draft previews on Home')
  assert.match(bodySrc, /if \(isCustomPageKey\(key\)\) \{/, 'a staff page previews from its draft blocks')
})

test('the preview keeps the #4452 contract (expired token 404, preview forms, popup outside the editor)', () => {
  const page = read('app/site-preview/[token]/page.tsx')
  assert.match(page, /if \(!preview\) notFound\(\)/)
  assert.match(page, /for \(const f of Object\.values\(preview\.forms\)\) f\.preview = true/)
  assert.match(page, /const origin = q\.editor === '1' \? editorOrigin\(q\.ao\) : null/)
  assert.match(page, /\{!origin && popup && popupForm \? <PreviewPopup /)
  assert.match(page, /renderDraft=\{renderPreviewDraft\}/)
  const action = read('app/site-preview/[token]/actions.tsx')
  assert.match(action, /^'use server'/)
  assert.match(action, /if \(!preview \|\| preview\.pageKey !== pageKey\) return refuse\('This preview has expired\.'\)/, 'a draft renders only for a live token of the same page')
  assert.match(action, /const origin = editorOrigin\(ao\)/)
})

test('I-4636-EDITOR-ORIGIN-CAN-FRAME: every editor origin may frame the preview; vercel.app is gone', async () => {
  const cfg = read('next.config.ts')
  const start = cfg.indexOf('export const SITE_PREVIEW_FRAME_ANCESTORS')
  const block = cfg.slice(start, cfg.indexOf('\n]', start))
  assert.match(block, /'https:\/\/admin\.usemingla\.com'/)
  assert.match(block, /http:\/\/localhost:\*/)
  assert.match(block, /http:\/\/127\.0\.0\.1:\*/)
  assert.equal(editor.ADMIN_ORIGINS.length, 3)
  for (const o of ['https://admin.usemingla.com', 'http://localhost:5173', 'http://127.0.0.1:5173']) assert.equal(editor.editorOrigin(o), o)
  for (const o of ['https://mingla-admin.vercel.app', 'https://mingla-admin-git-x.vercel.app', 'https://admin.usemingla.com.evil.io', 'http://admin.usemingla.com']) assert.equal(editor.editorOrigin(o), null, o)
})

test('the message contract: well-formed shapes in both directions, clicks map to a field', () => {
  const box = { index: 0, type: 'answer', id: null, top: 120, height: 400 }
  assert.ok(protocol.isPageMessage({ type: 'editor-ready', v: 2, page: 'home', mode: 'blocks', blocks: [box], height: 3000 }))
  assert.ok(protocol.isPageMessage({ type: 'editor-blocks', page: 'p-0123456789ab', blocks: [], height: 900 }))
  assert.ok(protocol.isPageMessage({ type: 'editor-click', page: 'home', index: 2, blockType: 'steps', field: 'items[1].title', text: 'Save' }))
  assert.ok(protocol.isPageMessage({ type: 'editor-applied', page: 'home', seq: 3, ok: false, errors: ['block 0: x'] }))
  assert.ok(protocol.isAdminMessage({ type: 'editor-draft', page: 'home', seq: 4, content: { sections: [] } }))
  assert.ok(protocol.isAdminMessage({ type: 'editor-select', page: 'home', index: null }))
  assert.ok(protocol.isAdminMessage({ type: 'editor-scroll-to', page: 'site-settings', index: 0 }))
  const content = { heading: 'How it *works.*', items: [{ title: 'Discover', body: 'Find plans.' }, { title: 'Save', body: 'Keep them.' }] }
  assert.equal(protocol.fieldForText(content, 'How it works.'), 'heading')
  assert.equal(protocol.fieldForText(content, ' Save '), 'items[1].title')
  assert.equal(protocol.fieldForText(content, 'Nothing like this'), null)
})

test('adversarial: the page acts only on its Admin origin, from the parent frame, with well-formed data', () => {
  const parent = {}
  const msg = { type: 'editor-draft', page: 'home', seq: 1, content: { sections: [] } }
  const A = 'https://admin.usemingla.com'
  assert.deepEqual(protocol.acceptAdminMessage({ origin: A, source: parent, data: msg }, A, parent), msg)
  assert.equal(protocol.acceptAdminMessage({ origin: 'https://evil.example', source: parent, data: msg }, A, parent), null, 'another origin')
  assert.equal(protocol.acceptAdminMessage({ origin: A, source: {}, data: msg }, A, parent), null, 'another frame')
  assert.equal(protocol.acceptAdminMessage({ origin: A, source: parent, data: msg }, null, parent), null, 'not in the editor')
  for (const bad of [
    { ...msg, page: '../x' }, { ...msg, seq: -1 }, { ...msg, seq: 1.5 }, { ...msg, content: [] }, { ...msg, content: { big: 'x'.repeat(400_001) } },
    { type: 'editor-select', page: 'home', index: 999 }, { type: 'run-script', page: 'home' }, null, 'editor-draft',
  ]) assert.equal(protocol.acceptAdminMessage({ origin: A, source: parent, data: bad }, A, parent), null, JSON.stringify(bad)?.slice(0, 80))
  for (const bad of [{ type: 'editor-click', page: 'home', index: 0, blockType: 'x', field: null, text: 'y'.repeat(201) }, { type: 'editor-ready', v: 1, page: 'home', mode: 'blocks', blocks: [], height: 1 }]) {
    assert.equal(protocol.isPageMessage(bad), false)
  }
  const canvas = read('components/site-blocks/preview-canvas.tsx')
  assert.match(canvas, /const msg = acceptAdminMessage\(event, origin, window\.parent\)/)
  assert.doesNotMatch(canvas + read('components/site-blocks/editor-bridge.tsx'), /postMessage\([^)]*'\*'\)/, 'never to every origin')
  assert.match(read('components/site-blocks/editor-bridge.tsx'), /window\.parent\.postMessage\(msg, ORIGIN\)/)
})
