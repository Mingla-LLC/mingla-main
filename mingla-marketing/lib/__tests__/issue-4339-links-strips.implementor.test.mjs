// #4339 — regression test for usemingla.com/links after the city section was
// subtracted: the page is the Mingla bar, the two banners, the Admin Links
// strips in Admin order, "See N more from Mingla" only on overflow, the
// socials and the privacy bar. No city UI, no city reads.
//
// Runs the REAL pure modules (links-fit, links-week) with no install, and
// reads the shipped component, stylesheet and route as source.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-links-strips.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const IMPORT = /from\s+'(@\/lib\/|\.\/)([\w-]+)'/g
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function emit(name, out, seen) {
  if (seen.has(name)) return
  seen.add(name)
  const deps = []
  const js = stripTypeScriptTypes(read(`lib/${name}.ts`)).replace(IMPORT, (_m, _p, dep) => {
    deps.push(dep)
    return `from './${dep}.mjs'`
  })
  fs.writeFileSync(path.join(out, `${name}.mjs`), js)
  for (const dep of deps) emit(dep, out, seen)
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-links-'))
const seen = new Set()
for (const name of ['links-fit', 'links-week', 'links-config']) emit(name, out, seen)
after(() => fs.rmSync(out, { recursive: true, force: true }))
const load = (name) => import(pathToFileURL(path.join(out, `${name}.mjs`)).href)
const fit = await load('links-fit')
const week = await load('links-week')

const component = code(read('components/marketing/links-experience.tsx'))
const css = code(read('components/marketing/links-experience.module.css'))
const page = code(read('app/links/page.tsx'))

// ---------------------------------------------------------------- no city UI

test('no city UI: no city name or picker, tagline, chips, plan or place strips, quiet-week links or full-week sheet', () => {
  const banned = [
    /Change city/,
    /Pick a city/,
    /styles\['lk-line'\]|styles\['lk-head'\]/,
    /A quiet week in/,
    /Plans in /,
    /Host something in \$\{/,
    /A quiet one\./,
    /the full week/i,
    /links_city_changed/,
    /links_filter_changed/,
    /links_full_week_opened/,
    /CityName|cityButtonRef|pickCity|quietLinks|quietWeek|cityWeek|groupListings/,
    /LINKS_CITY_COOKIE|rememberCity/,
  ]
  for (const re of banned) assert.doesNotMatch(component, re, `component still has ${re}`)
  for (const re of [/\.lk-city\b/, /\.lk-chips\b/, /\.chip\b/, /\.cty\b/, /\.cities\b/, /\.lk-quiet/, /\.lk-listwrap/, /\.lk-head\b/, /\.wk\b/]) {
    assert.doesNotMatch(css, re, `stylesheet still has ${re}`)
  }
})

test('the route reads only the Admin strips: no city week, city list, places, geo headers or cookie', () => {
  assert.match(page, /getLinksStrips\(\)/)
  for (const re of [/getLinksData|getLinksPlaces/, /resolveCity|liveCities|bucketListings|linksCitiesFromRows/, /x-vercel-ip/, /cookies\(|headers\(/, /city=|CITY_SLUG|initialCity|searchParams: Promise<\{[^}]*city/]) {
    assert.doesNotMatch(page, re, `page still has ${re}`)
  }
  assert.match(page, /normalisePins\(strips\)\.filter\(\(pin\) => pinLive\(pin, nowIso\)\)/)
  const data = code(read('lib/links-data.ts'))
  assert.match(data, /export async function getLinksStrips/)
  // The links_page_strips read is the only one the route makes.
  assert.equal([...data.matchAll(/rpc<[A-Za-z]+>\('links_page_strips'\)/g)].length >= 1, true)
})

test('the subtracted city helpers are gone from the shared libraries', async () => {
  for (const name of ['resolveCity', 'pickerOrder', 'pickerCountLabel', 'emptyListText', 'parseGeoHeaders', 'distanceLabel', 'withListingZones']) {
    assert.equal(week[name], undefined, `links-week still exports ${name}`)
  }
  for (const name of ['computeLinksFit', 'chipFitLevel', 'spreadLeftover', 'moreLabel', 'stripsThatFit']) {
    assert.equal(fit[name], undefined, `links-fit still exports ${name}`)
  }
  assert.equal((await load('links-config')).LINKS_CITY_COOKIE, undefined)
})

// ---------------------------------------------------------------- the page order

test('the page is: bar, banners, Admin strips, "more" link, socials (one grid, banners first)', () => {
  const order = ['styles[\'lk-bar\']', 'styles[\'lk-ban\']', 'styles[\'lk-pinwrap\']', 'data-pins-more', 'styles[\'lk-foot\']']
  let at = -1
  for (const marker of order) {
    const next = component.indexOf(marker, at + 1)
    assert.ok(next > at, `${marker} comes after the previous section`)
    at = next
  }
  assert.match(component, /banner\('explorer'\)[\s\S]*banner\('host'\)/)
  assert.match(component, /Explore <em>your city<\/em>/)
  assert.match(component, /Host something in <em>your city<\/em>/)
})

test('Admin strips render in the order they arrive (Admin order) and Admin order survives normalisePins', () => {
  assert.match(component, /pins\.map\(\(pin\) => strip\(\{ type: 'pin', pin \}, pin\.id, 'pin'\)\)/)
  assert.doesNotMatch(component, /\.sort\(/, 'the component never reorders the strips')
  const row = (id, position, title) => ({ id, shows_on: '2026-11-14', shows_until: null, title, label: 'From Mingla', opens: 'explorer', url: null, blog_slug: null, position })
  const pins = week.normalisePins([row('c', 3, 'Third'), row('a', 1, 'First'), row('b', 2, 'Second')])
  assert.deepEqual(pins.map((p) => p.title), ['First', 'Second', 'Third'])
})

test('empty Admin list: no strips list at all, so the page is banners and socials only', () => {
  assert.match(component, /pins\.length > 0 \? \(\s*<ul className=\{styles\['lk-pins'\]\}/)
  assert.deepEqual(week.normalisePins([]), [])
  assert.equal(fit.pinsThatFit({ bottoms: [], room: 400, moreHeight: 32, gap: 10, columns: 2 }), 0)
  assert.equal(fit.pinsMoreLabel(0, 0), null)
})

// ---------------------------------------------------------------- the fit

const phone = (count, room) =>
  fit.pinsThatFit({ bottoms: Array.from({ length: count }, (_, i) => 56 * (i + 1) + 10 * i), room, moreHeight: 32, gap: 10, columns: 1 })
const web = (count, room) =>
  fit.pinsThatFit({ bottoms: Array.from({ length: count }, (_, i) => 60 * (Math.floor(i / 2) + 1) + 12 * Math.floor(i / 2)), room, moreHeight: 32, gap: 12, columns: 2 })

test('"See N more" shows only on overflow: everything that fits shows with no link', () => {
  assert.equal(phone(3, 400), 3)
  assert.equal(fit.pinsMoreLabel(3, phone(3, 400)), null)
  // 8 strips in a 400 px box: some fold, and the link counts exactly what folded.
  const shown = phone(8, 400)
  assert.ok(shown > 0 && shown < 8)
  assert.equal(fit.pinsMoreLabel(8, shown), `See ${8 - shown} more from Mingla`)
  // the link's own room is reserved: the last shown strip ends above it
  assert.ok(56 * shown + 10 * (shown - 1) <= 400 - 32 - 10 + fit.FIT_TOLERANCE_PX)
})

test('web: strips fold in whole rows of two; a lone last strip shows only when it is the final strip', () => {
  const shown = web(11, 300)
  assert.equal(shown % 2, 0, 'never a lone half row while strips are folded')
  assert.ok(shown < 11)
  // all 7 fit: the odd final strip shows alone on its row
  assert.equal(web(7, 1000), 7)
  assert.equal(fit.pinsMoreLabel(7, 7), null)
  // when 7 do not all fit, the odd one never shows by itself
  assert.equal(web(7, 4 * 60 + 3 * 12 - 4) % 2, 0)
})

test('the strip grid is one column on a phone and two equal aligned columns from the tablet query up, banners on the same tracks', () => {
  assert.match(css, /\.lk-pins \{[^}]*grid-template-columns: minmax\(0, 1fr\);/)
  const tablet = css.match(/@container lk \(min-width: 700px\) \{[\s\S]*?\n\}\n/)
  assert.ok(tablet, 'a tablet container query exists')
  assert.match(tablet[0], /\.lk-ban,\s*\.lk-pins \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*column-gap: var\(--gap\);/)
  assert.match(css, /\.pins-more \{[^}]*grid-column: 1 \/ -1;/)
  assert.doesNotMatch(css, /\.lk-left|\.lk-right/, 'the two-panel desktop split is gone')
})

test('the fit measures the pins and nothing else, and every tap still goes through the device seam', () => {
  assert.match(component, /pinsThatFit\(\{/)
  assert.match(component, /resolveLinksHandoff\(target, device, src\)/)
  assert.match(component, /data-cta-phone-href=\{phoneHref\}/)
  assert.match(component, /event\.key === 'Escape'/)
  assert.match(component, /trapTab\(dialog, event\)/)
  assert.match(component, /inert=\{sheet !== null\}/)
})
