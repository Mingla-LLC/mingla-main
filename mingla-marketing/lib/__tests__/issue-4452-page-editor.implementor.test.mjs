// #4452 §7.6 / §2.9 (site side of the Website pages editor, item 8 pop-up preview):
//   PE-1 SC-159  the editor channel talks ONLY to an allowlisted Admin origin and
//                Admin acts only on well-formed messages (both sides check)
//   PE-2         preview-token scope (risky path): a token shows the draft of its
//                own page only; every other page stays live; every form is a preview
//   PE-3         markers and outlines only in editor mode; a page with no blocks
//                is unchanged outside it (I-4452-NO-BLOCKS-NO-CHANGE)
//   PE-4         the preview shows the pop-up as a visitor sees it (real PopupDialog)
//   PE-5         the designed look: designOf keeps every value in its list and limit;
//                a photo shows only from site-media, never /render/image
// FAILS-ON-REVERT: widening the origin allowlist to any https origin, or posting
// to "*", fails PE-1; merging the token content into other pages fails PE-2.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { loader, MARKETING } from './issue-4452-ts-loader.mjs'

const L = loader('issue-4452-editor-')
after(() => L.cleanup())
const e = await L.load('site-pages/editor')
const p = await L.load('site-pages/preview')
const d = await L.load('forms/design')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')

test('PE-1 SC-159 the editor origin allowlist and message shapes', () => {
  for (const ok of ['https://admin.usemingla.com', 'http://localhost:5173']) assert.equal(e.editorOrigin(ok), ok, ok)
  for (const bad of ['https://evil.com', 'https://admin.usemingla.com.evil.com', 'http://admin.usemingla.com', 'https://usemingla.com', '*', '', null, 'javascript:alert(1)', 'https://mingla-admin.vercel.app.evil.io',
    // #4636: a vercel.app Admin preview may not frame the page, so it is not an editor origin either.
    'https://mingla-admin.vercel.app', 'https://mingla-admin-git-4452-mingla.vercel.app']) assert.equal(e.editorOrigin(bad), null, String(bad))
  assert.equal(e.isEditorMessage({ type: 'spot-click', page: 'creators', spot: 'after-steps' }), true)
  assert.equal(e.isEditorMessage({ type: 'block-click', page: 'creators', spot: 'after-steps', block: '44520000-0000-4000-8000-000000000001' }), true)
  for (const bad of [{ type: 'spot-click', page: 'Creators!', spot: 'x' }, { type: 'run', page: 'x' }, { type: 'editor-scroll', page: 'x', y: -1 }, null, 'spot-click'])
    assert.equal(e.isEditorMessage(bad), false, JSON.stringify(bad))
  const bridge = read('components/site-blocks/editor-bridge.tsx')
  assert.match(bridge, /window\.parent\.postMessage\(msg, ORIGIN\)/)
  assert.doesNotMatch(bridge, /postMessage\([^)]*'\*'\)/, 'never to every origin')
  const page = read('app/site-preview/[token]/page.tsx')
  assert.match(page, /const origin = q\.editor === '1' \? editorOrigin\(q\.ao\) : null/)
})

test('PE-2 the preview-token scope: its own page only, every form a preview', () => {
  const live = { pages: { creators: { blocks: [{ id: 'a', type: 'banner', spot: 'after-hero' }] }, locals: { blocks: [{ id: 'b', type: 'banner', spot: 'after-hero' }] } }, forms: { f1: { id: 'f1', name: 'x' } }, form_pages: {} }
  const out = p.mergePreview(live, { page_key: 'creators', content: { blocks: [] }, changes: 2, forms: { f2: { id: 'f2', name: 'y' } } })
  assert.deepEqual(out.pages.creators, { blocks: [] })
  assert.deepEqual(out.pages.locals, live.pages.locals, 'another page keeps its live content')
  assert.equal(out.pageKey, 'creators')
  assert.equal(out.forms.f1.preview, true)
  assert.equal(out.forms.f2.preview, true)
  assert.equal(live.forms.f1.preview, undefined, 'the live cache is never changed')
})

test('PE-3 markers only in the editor; no blocks, no change outside it', () => {
  const spot = read('components/site-blocks/spot.tsx')
  assert.match(spot, /const editor = editorMode\(\)\n  if \(editor && editor\.pageKey === page\) \{/)
  assert.match(spot, /if \(!block\) return null\n  return renderBlock\(block, content, host\)/)
  const hero = read('components/site-blocks/hero-words.tsx')
  assert.match(hero, /return editorMode\(\)\?\.pageKey === page \? <HeroOutline page=\{page\}>\{hero\}<\/HeroOutline> : hero/)
  const content = read('lib/site-pages/content.ts')
  assert.match(content, /return v\?\.editor \? \{ origin: v\.editor\.origin, pageKey: v\.pageKey \} : null/)
})

test('PE-4 the preview shows the page pop-up with the real dialog', () => {
  const page = read('app/site-preview/[token]/page.tsx')
  assert.match(page, /\{!origin && popup && popupForm \? <PreviewPopup /)
  const pop = read('components/forms/preview-popup.tsx')
  assert.match(pop, /<PopupDialog /)
  assert.match(pop, /form=\{\{ \.\.\.form, preview: true \}\}/)
  assert.match(read('components/forms/popup-host.tsx'), /<PopupDialog\b/, 'the site and the preview draw the same dialog')
})

test('PE-5 the designed look stays inside its lists and limits', () => {
  const out = d.designOf({ layout: 'x', text_pos: 'bottom-right', text_color: 'red', backdrop: 'neon', head: 'h'.repeat(50), reasons: ['a', 7], columns: 3 })
  assert.deepEqual([out.layout, out.row, out.col, out.text_color, out.backdrop, out.head.length, out.reasons, out.columns], ['centre', 'bottom', 'right', '#ffffff', 'night', 24, ['a', '', ''], 1])
  assert.equal(d.safePhotoUrl('https://abc.supabase.co/storage/v1/object/public/site-media/u/forms/x.jpg'), 'https://abc.supabase.co/storage/v1/object/public/site-media/u/forms/x.jpg')
  for (const bad of ['https://abc.supabase.co/storage/v1/render/image/public/site-media/x.jpg', 'https://evil.com/x.jpg', 'javascript:x', 'https://abc.supabase.co/storage/v1/object/public/blog-media/x.jpg'])
    assert.equal(d.safePhotoUrl(bad), null, bad)
  assert.equal(d.scrimCss('night'), 'rgba(21,23,28,0.72)')
})
