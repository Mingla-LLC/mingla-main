// #4452 rework 1 (FAIL verdict, comment 6915027543): the site-side defects.
// Run from mingla-marketing/: node --test lib/__tests__/issue-4452-rework-ui.implementor.test.mjs
//
// RW-UI-1 (P1-5)  a pop-up holds back only while the privacy panel is OPEN; the hidden panel
//                 that is always in the DOM never blocks it.
// RW-UI-2 (P0-2)  the bot trap is never focusable and never the first field: rendered form
//                 markup puts it after the fields with tabindex=-1 inside aria-hidden, and the
//                 first-field rule lands on the name input. The pop-up host and the preview use it.
// RW-UI-3 (P1-6)  every forms.css rule outranks a page reset like `[data-landing] button`.
// RW-UI-4 (P0-3)  no ISR page under the root layout (which carries the site-pages tag) has
//                 `dynamicParams = false`: on Next 15 revalidating the tag 404s such pages.
// RW-UI-5 (P2-12) Send is pinned inside the pop-up's scrolling pane.
// RW-UI-6 (P2-13) /apply/<slug> routes the top-bar call by the form's audience.
// RW-UI-7 (P3-14) the 47px call link takes 44px in the CTA bar's layout (the bar keeps its height).
// RW-UI-8 (P3-15) the draft preview's pop-up has Esc, a focus trap and sits above the preview bar.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { loader, MARKETING } from './issue-4452-ts-loader.mjs'
import { tsxRenderer, TOOL_STUBS } from './issue-4452-tsx-render.mjs'

const L = loader('issue-4452-rework-ui-')
after(L.cleanup)
const dom = await L.load('forms/popup-dom')
const read = (p) => fs.readFileSync(path.join(MARKETING, p), 'utf8')
const code = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** A tiny element: attributes, `hidden`, an ancestor chain and a rect count. */
function el(attrs = {}, { hidden = false, rects = 1, parent = null } = {}) {
  return {
    hidden,
    parent,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    getClientRects: () => ({ length: rects }),
    closest(sel) {
      for (let node = this; node; node = node.parent) {
        if (sel === '[aria-hidden="true"]' && node.getAttribute('aria-hidden') === 'true') return node
        if (sel === '.fk-hp' && (node.getAttribute('class') ?? '').split(' ').includes('fk-hp')) return node
      }
      return null
    },
  }
}
const docWith = (...sheets) => ({ querySelectorAll: (s) => (s === '.mpb' ? sheets : []) })

test('RW-UI-1 P1-5 only an OPEN privacy panel holds a pop-up back', () => {
  assert.equal(dom.privacySheetOpen(docWith()), false, 'no panel')
  assert.equal(dom.privacySheetOpen(docWith(el({ hidden: '' }, { hidden: true }))), false, 'the closed panel (hidden) is always in the DOM')
  assert.equal(dom.privacySheetOpen(docWith(el({ hidden: '' }))), false, 'the hidden attribute alone')
  assert.equal(dom.privacySheetOpen(docWith(el({}, { rects: 0 }))), false, 'not rendered')
  assert.equal(dom.privacySheetOpen(docWith(el({ role: 'dialog' }))), true, 'open')
  const host = code(read('components/forms/popup-host.tsx'))
  assert.match(host, /if \(privacySheetOpen\(document\)\) return/)
  assert.doesNotMatch(host, /document\.querySelector\('\.mpb'\)/, 'never "the panel exists"')
})

test('RW-UI-2 P0-2 the bot trap is unfocusable, after the fields, and never gets first focus', () => {
  const R = tsxRenderer('issue-4452-rework-form-', {
    stubs: {
      ...TOOL_STUBS,
      '@/lib/marketing-pixels': 'module.exports = { fireMarketingLead() {} }',
      '@/lib/growth-tools-transport': 'module.exports = { postGrowthTools() { return Promise.resolve({}) } }',
    },
  })
  try {
    const { FormRenderer } = R.load('components/forms/form-renderer.tsx')
    const form = {
      id: '4452f000-0000-4000-8000-0000000000ad', key: 'creators-join', version: 1, audience: 'creator', preview: true,
      fields: [
        { key: 'name', type: 'name', label: 'Your name', required: true, locked: true },
        { key: 'email', type: 'email', label: 'Email', required: true, locked: true },
        { key: 'what_do_you_make', type: 'single', label: 'What do you make?', required: true, options: ['Video', 'Photo'] },
      ],
    }
    const html = R.render(R.React.createElement(FormRenderer, { form, placement: 'popup', onDone() {} }))
    const fields = html.indexOf('class="fk-fields"')
    const trap = html.indexOf('class="fk-hp"')
    assert.ok(fields > -1 && trap > fields, 'the trap comes after the field list')
    const trapHtml = html.slice(trap, html.indexOf('</div>', trap))
    assert.match(trapHtml, /^class="fk-hp" aria-hidden="true"/)
    const trapInput = /<input[^>]*>/.exec(trapHtml)?.[0] ?? ''
    assert.match(trapInput, /tabindex="-1"/)
    assert.match(trapInput, /aria-hidden="true"/)
    assert.match(trapInput, /name="website_url"/)
    // The first control FIRST_FIELD_SELECTOR picks: the first input/textarea/button inside the
    // field list without tabindex=-1 (document order) is the name input.
    const inside = html.slice(fields)
    const first = /<(input|textarea|button)\b([^>]*)>/.exec(inside)
    assert.ok(first && !/tabindex="-1"/.test(first[2]) && /autoComplete="name"|autocomplete="name"/i.test(first[2]), `first field: ${first?.[0]}`)
  } finally {
    R.cleanup()
  }
  assert.match(dom.FIRST_FIELD_SELECTOR, /^\.fk-fields input:not\(\[type="hidden"\]\):not\(\[tabindex="-1"\]\)/)
  for (const part of dom.FIRST_FIELD_SELECTOR.split(',')) assert.match(part, /^\.fk-fields /, 'only inside the field list')
  // The focus trap never cycles to the trap.
  const trapRoot = el({ class: 'fk-hp', 'aria-hidden': 'true' })
  const trapInput = el({ tabindex: '-1', name: 'website_url' }, { parent: trapRoot })
  const name = el({ name: 'name' })
  assert.deepEqual(dom.focusablesIn({ querySelectorAll: () => [trapInput, name] }), [name])
  for (const file of ['components/forms/popup-host.tsx', 'components/forms/preview-popup.tsx']) {
    const src = code(read(file))
    assert.match(src, /querySelector<HTMLElement>\(FIRST_FIELD_SELECTOR\)/, `${file} starts in the first real field`)
    assert.match(src, /focusablesIn<HTMLElement>\(dialog\.current\)/, `${file} traps focus without the bot trap`)
  }
})

test('RW-UI-3 P1-6 every field-kit rule outranks a page reset ([data-landing] button)', () => {
  const css = read('components/forms/forms.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = []
  const rule = /(^|[{}])\s*([^{}@]+?)\s*\{/g
  for (const m of css.matchAll(rule)) {
    const sel = m[2].trim()
    if (!sel || /^(from|to|\d+%)$/.test(sel)) continue
    selectors.push(...sel.split(/,(?![^(]*\))/).map((s) => s.trim()))
  }
  assert.ok(selectors.length > 80, `found ${selectors.length} selectors`)
  for (const s of selectors) {
    assert.ok(s.startsWith(':is([data-landing], :root) '), `scoped so a reset cannot win: ${s}`)
  }
})

test('RW-UI-4 P0-3 no prerendered page with params under the site-pages tag has dynamicParams = false', () => {
  const pages = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(MARKETING, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, e.name)
      if (e.isDirectory()) walk(rel)
      else if (e.name === 'page.tsx') pages.push(rel)
    }
  }
  walk('app')
  // The root layout mounts the pop-up host, which reads the tagged site content: every page carries the tag.
  assert.match(code(read('app/layout.tsx')), /<PopupMount \/>/)
  assert.match(code(read('lib/site-pages/content.ts')), /tags: \[SITE_PAGES_CACHE_TAG\]/)
  const broken = pages.filter((p) => {
    const src = code(read(p))
    return /export const dynamicParams = false/.test(src) && !/export const dynamic = 'force-dynamic'/.test(src)
  })
  assert.deepEqual(broken, [], 'a revalidate of the "pages" tag would 404 these prerendered pages')
  for (const [p, guard] of [['app/host/[icp]/page.tsx', /if \(!isIcpSlug\(icp\)\) notFound\(\)/], ['app/help/[slug]/page.tsx', /if \(!video\) notFound\(\)/]]) {
    const src = code(read(p))
    assert.match(src, /export const dynamicParams = true/, p)
    assert.match(src, /export function generateStaticParams\(\)/, `${p} still prerenders every known page`)
    assert.match(src, guard, `${p} still 404s an unknown slug`)
  }
})

test('RW-UI-5 P2-12 Send is pinned at the bottom of the pop-up pane', () => {
  const css = read('components/forms/forms.css')
  assert.match(css, /:is\(\[data-landing\], :root\) \.pu-body \.fk-actions \{ position: sticky; bottom: 0;[^}]*background:/)
  assert.match(css, /\.pu-body \{ flex: 1; overflow: auto;/, 'the pane is the scroll container')
})

test('RW-UI-6 P2-13 a form page routes the call by its audience', () => {
  const page = code(read('app/apply/[slug]/page.tsx'))
  assert.match(page, /<CallAudienceProvider audience=\{form\.audience\}>\s*<SitePage /)
  const link = code(read('components/site/nav-call-link.tsx'))
  assert.match(link, /const pageAudience = useCallAudience\(\)/)
  assert.match(link, /callHrefFor\(pathname, audience \?\? pageAudience\)/)
})

test('RW-UI-7 P3-14 the 47px call link takes the ringed button\'s 44px in layout', () => {
  const css = read('components/landing/landing.css')
  const block = /\[data-landing\] \.glassbar \.btn\.bring-call \{([^}]*)\}/.exec(css)?.[1] ?? ''
  assert.match(block, /min-height: 47px;/)
  assert.match(block, /margin: -1\.5px 0;/, '47 - 3 = 44, the height the 3px-ringed Get Mingla Host button takes')
  assert.match(css, /\[data-landing\] \.glassbar \{[^}]*padding: 8px 8px 8px 20px;/s, 'the bar keeps its padding')
})

test('RW-UI-8 P3-15 the preview pop-up: Esc closes, Tab is trapped, it covers the preview bar', () => {
  const src = code(read('components/forms/preview-popup.tsx'))
  assert.match(src, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); setOpen\(false\); return \}/)
  assert.match(src, /e\.key === 'Tab' && dialog\.current/)
  assert.match(src, /<PopupDialog dialogRef=\{dialog\} overBar /)
  const dialog = code(read('components/forms/popup-dialog.tsx'))
  assert.match(dialog, /\$\{overBar \? ' pu-over-bar' : ''\}/)
  const css = read('components/forms/forms.css')
  assert.match(css, /\.pu-over-bar \{ z-index: 100; \}/)
  assert.match(css, /\.sp-bar \{ position: sticky; top: 0; z-index: 99;/, 'the bar it must cover')
})
import './issue-4640-host-demo-conversion.implementor.test.mjs'
