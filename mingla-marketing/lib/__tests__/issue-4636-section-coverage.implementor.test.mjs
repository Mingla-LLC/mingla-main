// MINGLA-INVARIANT: I-4636-SECTION-COVERAGE | issue #4636 | every public page's sections are listed in lib/site-blocks/coverage.json as a registry block or an explicit not-a-block reason, and the page source renders exactly that list.
// #4636 R5 — the coverage gate. The catalogue cannot silently fall behind the
// site: for every page in lib/site-blocks/coverage.json the test reads the page
// function's source and takes the JSX components it renders, in order (a
// source scan: comments stripped, lower-case HTML ignored except <section>).
// That sequence must equal the manifest's list, where
//   - `block:<key>` is a registry block, rendered by its section component
//     (the component the renderer maps the key to);
//   - `frame:programme` is the shared `<section className="pb-100">` frame;
//   - any other name is page chrome listed under `chrome` with its reason.
// So a page that renders a new section (an inline <section>, or a component
// the manifest does not list) fails here, and so does a removed or reordered
// block. Every page in the #4452 site page registry must also be accounted
// for (a manifest page or a not-a-block page with a reason).
// Run from mingla-marketing/: node --test lib/__tests__/issue-4636-section-coverage.implementor.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { MARKETING } from './issue-4452-ts-loader.mjs'

const read = (p) => fs.readFileSync(path.join(MARKETING, p), 'utf8')
const coverage = JSON.parse(read('lib/site-blocks/coverage.json'))
const registryKeys = JSON.parse(read('lib/site-blocks/registry.json')).blocks.map((b) => b.key)

/** Line comments, then block / JSX comments (a `//` inside a string such as a URL is kept). */
export function stripComments(src) {
  return src.replace(/(^|[^:'"])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The body of the named export (`default` = the default export function). */
export function functionBody(src, name) {
  const re = name === 'default' ? /export default (async )?function \w*\s*\(/ : new RegExp(`export (async )?function ${name}\\s*\\(`)
  const m = re.exec(src)
  assert.ok(m, `no exported function ${name}`)
  const end = src.indexOf('\n}\n', m.index)
  return src.slice(m.index, end === -1 ? undefined : end)
}

/** The JSX components a function renders, in order; `<section …>` as `section:<className>`. */
export function renderedTags(body) {
  const out = []
  for (const m of body.matchAll(/(?<=[\s({>?:])<([A-Z][A-Za-z0-9.]*|section)\b([^>]*)/g)) {
    if (m[1] === 'section') out.push(`section:${m[2].match(/className="([^"]*)"/)?.[1] ?? ''}`)
    else out.push(m[1])
  }
  return out
}

/** Component name → registry key, from the renderer's map (one owner). */
function componentKeys() {
  const src = read('components/site-blocks/block-renderer.tsx')
  const start = src.indexOf('export const BLOCK_COMPONENTS')
  const body = src.slice(start, src.indexOf('\n}\n', start))
  const map = new Map([['HeroWords', 'heroWords']])
  for (const m of body.matchAll(/^\s+(\w+): (\w+),$/gm)) if (m[2] !== 'SpotBlock') map.set(m[2], m[1])
  return map
}

test('I-4636-SECTION-COVERAGE: every listed page renders exactly its manifest sections, in order', () => {
  const keys = componentKeys()
  for (const page of coverage.pages) {
    const [file, name = 'default'] = page.source.split('#')
    const tags = renderedTags(functionBody(stripComments(read(file)), name))
    const seen = tags.map((t) => {
      if (t.startsWith('section:')) {
        assert.equal(t, 'section:pb-100', `${page.key}: an inline <section className="${t.slice(8)}"> is not a block (move it into a block or list it)`)
        return 'frame:programme'
      }
      if (keys.has(t)) return `block:${keys.get(t)}`
      return t
    })
    assert.deepEqual(seen, page.sections, `${page.key} (${file}): the page's sections and lib/site-blocks/coverage.json differ`)
    for (const s of page.sections) {
      if (s.startsWith('block:')) assert.ok(registryKeys.includes(s.slice(6)), `${page.key}: ${s} is not in the registry`)
      else if (s !== 'frame:programme') assert.ok(coverage.chrome[s], `${page.key}: ${s} has no not-a-block reason under "chrome"`)
    }
  }
})

test('I-4636-SECTION-COVERAGE: every public page in the #4452 site page registry is accounted for', () => {
  const sitePages = JSON.parse(read('lib/site-pages/registry.json')).pages
  const listed = new Set([...coverage.pages.map((p) => p.key), ...coverage.notBlocks.map((p) => p.key)])
  for (const p of sitePages) {
    const key = p.template === 'host' ? 'host-template' : p.key
    assert.ok(listed.has(key), `${p.key} (${p.path}) is neither a covered page nor a not-a-block page in lib/site-blocks/coverage.json`)
  }
  for (const nb of coverage.notBlocks) assert.ok(nb.reason && nb.reason.length > 10, `${nb.key} needs a reason`)
})

test('the scan sees inline sections and unknown components (the gate can fail)', () => {
  const page = `export default function P() {\n  return (\n    <SitePage>\n      <PageHeroBlock content={x} />\n      {/* <ToolkitBlock /> commented out */}\n      <section className="sec dark">\n        <NewThing />\n      </section>\n    </SitePage>\n  )\n}\n`
  assert.deepEqual(renderedTags(functionBody(stripComments(page), 'default')), ['SitePage', 'PageHeroBlock', 'section:sec dark', 'NewThing'])
  // A URL in a string is not a comment.
  assert.deepEqual(renderedTags(stripComments(`x = (\n <a href="https://x.example">\n <Spot />\n)`)), ['Spot'])
})
