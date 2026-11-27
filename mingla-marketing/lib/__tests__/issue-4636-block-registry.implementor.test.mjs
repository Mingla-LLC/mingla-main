// MINGLA-INVARIANT: I-4636-ONE-BLOCK-REGISTRY | issue #4636 | lib/site-blocks/registry.ts is the one block registry: registry.json (what the database validator and Admin read) is generated from it and identical, and the renderer maps exactly its keys.
// MINGLA-INVARIANT: I-4636-BLOCKS-ARE-EXISTING-SECTIONS | issue #4636 | every registry block renders through the extracted section component its original page also renders, and every page's default content passes the registry.
// #4636 build 1 (happy path): the block registry, its JSON twin, the renderer's
// key → component map, the original pages rendering the same components, and
// every page's default content passing the registry's own validator.
// Run from mingla-marketing/: node --test lib/__tests__/issue-4636-block-registry.implementor.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { loader, MARKETING } from './issue-4452-ts-loader.mjs'
import { tsxRenderer } from './issue-4452-tsx-render.mjs'
import { registryJsonText, JSON_PATH } from '../../scripts/issue-4636-block-registry.mjs'

const L = loader('issue-4636-registry-')
after(L.cleanup)
const r = await L.load('site-blocks/registry')
const read = (p) => fs.readFileSync(path.join(MARKETING, p), 'utf8')

// Content modules load through the TSX harness (it follows '@/…' imports).
const T = tsxRenderer('issue-4636-content-')
after(T.cleanup)
const home = T.load('content/site-blocks/home.ts')
const host = T.load('content/site-blocks/host.ts')
const icp = T.load('content/site-blocks/icp.ts')
const programmes = T.load('content/site-blocks/programmes.ts')
const core = T.load('content/site-blocks/core.ts')
const icps = T.load('content/host-landing/icps.ts')
const cities = T.load('content/cities/registry.ts')

/** The renderer's key → component map, read from block-renderer.tsx. */
function rendererMap() {
  const src = read('components/site-blocks/block-renderer.tsx')
  const body = src.slice(src.indexOf('export const BLOCK_COMPONENTS'), src.indexOf('\n}\n', src.indexOf('export const BLOCK_COMPONENTS')))
  return Object.fromEntries([...body.matchAll(/^\s+(\w+): (\w+),$/gm)].map((m) => [m[1], m[2]]))
}

test('I-4636-ONE-BLOCK-REGISTRY: registry.json is generated from registry.ts and identical', async () => {
  assert.equal(fs.readFileSync(JSON_PATH, 'utf8'), await registryJsonText(), 'run node scripts/issue-4636-block-registry.mjs')
  const json = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))
  assert.equal(json.registry_version, r.REGISTRY_VERSION)
  assert.deepEqual(json.blocks.map((b) => b.key), r.BLOCK_KEYS)
  assert.equal(new Set(r.BLOCK_KEYS).size, r.BLOCK_KEYS.length, 'block keys are unique')
})

test('every block has a version, a plain-English name and description, a category, colours from the brand fields and the landing wrapper', () => {
  for (const b of r.BLOCKS) {
    assert.ok(Number.isInteger(b.version) && b.version >= 1, b.key)
    assert.ok(b.name.length > 2 && b.description.length > 10, b.key)
    assert.ok(['hero', 'story', 'media', 'action', 'live'].includes(b.category), b.key)
    assert.equal(b.wrapper.landingRoot, true, b.key)
    for (const list of Object.values(b.colours)) {
      assert.ok(list.length >= 1, `${b.key} has a default colour`)
      for (const c of list) assert.ok(r.COLOURS.includes(c), `${b.key} colour ${c}`)
    }
    // R2/R3: no layout, spacing or type settings in the editable surface.
    for (const f of b.fields) assert.doesNotMatch(f.key, /^(layout|spacing|padding|margin|columns|font|size|align|side)$/i, `${b.key}.${f.key}`)
  }
  // Only fields that have a working section style today: no sand or clay section yet.
  const offered = new Set(r.BLOCKS.flatMap((b) => Object.values(b.colours).flat()))
  assert.deepEqual([...offered].sort(), ['cream', 'moss', 'night', 'paper'])
})

test('the colour classes are the ones the sections already style (site.css / pages.css)', () => {
  const css = read('components/site/site.css') + read('components/site/pages.css')
  for (const cls of ['.sec.dark', '.sec.sandbg', '.sec.moss', '.rm.dark']) assert.ok(css.includes(`[data-landing] ${cls}`), cls)
  const shared = read('components/site-blocks/sections/shared.tsx')
  assert.match(shared, /case 'night':\s*return 'sec dark'/)
  assert.match(shared, /case 'cream':\s*return 'sec sandbg'/)
  assert.match(shared, /case 'moss':\s*return 'sec moss'/)
})

test('I-4636-ONE-BLOCK-REGISTRY: the renderer maps exactly the registry keys, each to a section component file', () => {
  const map = rendererMap()
  assert.deepEqual(Object.keys(map).sort(), [...r.BLOCK_KEYS].sort())
  const renderer = read('components/site-blocks/block-renderer.tsx')
  for (const component of new Set(Object.values(map))) {
    const file = renderer.match(new RegExp(`import \\{ ${component} \\} from '\\./sections/([\\w-]+)'`))?.[1]
    assert.ok(file, `${component} is imported from sections/`)
    assert.match(read(`components/site-blocks/sections/${file}.tsx`), new RegExp(`export (async )?function ${component}\\b`), component)
  }
})

test('I-4636-BLOCKS-ARE-EXISTING-SECTIONS: each original page renders the same block component the renderer uses', () => {
  const map = rendererMap()
  const coverage = JSON.parse(read('lib/site-blocks/coverage.json'))
  const used = new Map()
  for (const page of coverage.pages) {
    const file = page.source.split('#')[0]
    for (const s of page.sections) {
      if (!s.startsWith('block:')) continue
      const key = s.slice(6)
      const component = key === 'heroWords' ? 'HeroWords' : map[key]
      assert.match(read(file), new RegExp(`<${component}\\b`), `${page.key} renders ${component} for ${key}`)
      used.set(key, [...(used.get(key) ?? []), page.key])
    }
  }
  // Every catalogued block is a section of at least one live page, except the
  // #4452 blocks, which reach pages through <Spot>.
  for (const key of r.BLOCK_KEYS) {
    if (['form', 'buttons', 'banner'].includes(key)) continue
    assert.ok(used.has(key), `${key} is rendered by an original page`)
  }
  // heroWords: the #4452 hero renders the block component.
  assert.match(read('components/site-blocks/hero-words.tsx'), /<HeroWordsBlock\b/)
})

const ok = (key, content, colour) => {
  const block = { type: key, version: 1, content, ...(colour ? { colour } : {}) }
  const res = r.validateBlock(JSON.parse(JSON.stringify(block)))
  assert.ok(res.ok, `${key}: ${res.ok ? '' : res.errors.join('; ')}`)
}

const heroWords = (coded) => ({
  title: coded.h1,
  em: coded.em,
  lead: coded.lead,
  primary: { label: coded.app.text, to: 'app:explorer', track: coded.app.location },
  secondary: { label: coded.call.text, to: coded.call.href },
})

test('I-4636-BLOCKS-ARE-EXISTING-SECTIONS: every page\'s default content passes the registry (the editor can load today\'s pages)', () => {
  ok('reelHero', home.HOME_HERO, 'paper')
  ok('steps', home.HOME_HOW, 'paper')
  ok('tiles', home.AUDIENCES, 'night')
  ok('citiesRow', home.HOME_CITIES, 'paper')
  ok('marquee', home.MARQUEE)
  ok('videoBand', home.HOME_BAND)

  ok('reelHero', host.HOST_HERO, 'night')
  ok('tiles', host.HOST_KINDS, 'paper')
  ok('promptDemo', host.HOST_SITE, 'cream')
  ok('vcards', host.ARI_CARDS, 'night')
  ok('toolkit', host.TOOLKIT, 'paper')
  ok('videoBand', host.HOST_BAND)

  for (const slug of icps.ICP_SLUGS) {
    const b = icp.icpBlocks(slug)
    ok('icpHero', b.hero)
    ok('litAbout', b.about, 'cream')
    ok('icpFeatures', b.features)
    ok('chips', b.who, 'paper')
    ok('toolCard', b.tool, 'paper')
    ok('faq', b.faq, 'paper')
    ok('videoBand', b.band)
  }

  ok('heroWords', heroWords(programmes.CREATORS_HERO))
  ok('clipGrid', programmes.CREATORS_CLIPS)
  ok('steps', programmes.CREATORS_STEPS)
  ok('videoBand', programmes.CREATORS_BAND)
  ok('finePrint', programmes.CREATORS_FINE)
  ok('heroWords', heroWords(programmes.LOCALS_HERO))
  ok('steps', programmes.LOCALS_STEPS)
  ok('facts', programmes.LOCALS_FACTS)
  ok('videoBand', programmes.LOCALS_BAND)
  ok('finePrint', programmes.LOCALS_FINE)

  for (const name of ['ABOUT_HERO', 'GOING_OUT_HERO', 'CITIES_HERO', 'SUPPORT_HERO', 'HELP_HERO', 'CAREERS_HERO', 'TOOLS_HERO']) ok('pageHero', core[name])
  ok('answer', core.ABOUT_ANSWER)
  ok('answer', core.GOING_OUT_ANSWER)
  ok('wideClip', core.ABOUT_CLIP)
  ok('paras', core.ABOUT_WHY, 'paper')
  ok('vcards', core.ABOUT_CARDS, 'cream')
  ok('filterGrid', core.GOING_OUT_GUIDES)
  ok('cityLinks', core.GOING_OUT_CITIES)
  ok('citiesRow', core.CITIES_TILES)
  ok('getApp', core.GET_APP)
  ok('quickLinks', core.SUPPORT_LINKS)
  ok('stillStuck', core.HELP_STUCK)
  ok('steps', core.CAREERS_VALUES)
  ok('toolCards', core.TOOLS_CARDS)
  ok('blogStories', { title: 'Go out *better.*', lede: 'Going out, date ideas and the playbook for hosts, from the people building Mingla.' })
  for (const key of ['helpVideos', 'openRoles', 'scheduler']) ok(key, {})

  for (const record of cities.CITY_HUBS) {
    const city = { city: record.slug }
    for (const key of ['cityHero', 'cityWeekend', 'topPlaces', 'cityHostBand']) ok(key, city)
    ok('cityPlans', { ...city, heading: 'More than *one mode.*' }, 'moss')
    if (record.faqs.length) {
      ok('faq', { variant: 'city', heading: `${record.city} questions, *answered.*`, items: record.faqs.map((f) => ({ question: f.question, answer: f.answer })) }, 'paper')
    }
  }
})

test('a whole page of blocks plans into frames: programme blocks share one frame, city blocks ask for the city wrapper', async () => {
  const plan = (await L.load('site-blocks/render-plan')).planBlocks
  const messages = []
  const p = plan(
    [
      { type: 'heroWords', version: 1, content: heroWords(programmes.CREATORS_HERO) },
      { type: 'clipGrid', version: 1, content: programmes.CREATORS_CLIPS },
      { type: 'steps', version: 1, content: programmes.CREATORS_STEPS },
      { type: 'finePrint', version: 1, content: programmes.CREATORS_FINE },
      { type: 'cityHostBand', version: 1, content: { city: 'lagos' } },
    ].map((b) => JSON.parse(JSON.stringify(b))),
    (m) => messages.push(m),
  )
  assert.deepEqual(messages, [])
  assert.deepEqual(p.groups.map((g) => [g.frame, g.items.map((i) => i.block.type)]), [
    ['own', ['heroWords']],
    ['programme', ['clipGrid', 'steps', 'finePrint']],
    ['own', ['cityHostBand']],
  ])
  assert.equal(p.city, true)
})
