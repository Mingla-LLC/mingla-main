#!/usr/bin/env node
// #4137 Wave 2 tester: grouped menu and city catalogue in real Chrome.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { open, press, waitFor, withNextBrowser } from './issue-4137-browser-harness.mjs'

if (!process.argv.includes('--built-only')) {
  process.stdout.write('SKIP #4137 menu/city tester: run with --built-only after next build\n')
  process.exit(0)
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VIEWPORTS = [[360, 780], [375, 667], [390, 844], [402, 874], [768, 1024], [1440, 900]]
// #4339 phase 2a: `/` and `/host` carry the redesign's site nav (pinned by
// lib/__tests__/issue-4339-site-chrome.*), not this grouped side menu.
// #4339 phase 2b: the redesigned pages (/going-out, /cities, the city pages,
// /tools, /help, /support, /about) carry the site nav, pinned by
// lib/__tests__/issue-4339-*.implementor.test.mjs; this matrix keeps the
// grouped side menu on the pages that still render it.
const ROUTES = ['/tools/venues', '/help/getting-the-apps']

for (const file of [
  'components/cities/city-weekend.tsx', 'components/cities/city-page.tsx',
  'lib/city-place-photo.ts', 'components/page-system/current-place-photo.tsx',
]) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(source, /render\/image|photoUrls|s-maxage/i, `${file}: forbidden place-photo path`)
}

await withNextBrowser(ROOT, async ({ page, baseUrl, consoleErrors }) => {
  for (const [width, height] of VIEWPORTS) {
    for (const route of ROUTES) {
      await open(page, baseUrl, `${route}?qa=menu-matrix`, { width, height, reducedMotion: true })
      await waitFor(() => page.evaluate(`(() => { document.querySelector('button[aria-label="Open menu"]')?.click(); return Boolean(document.querySelector('[role=dialog]:has(nav[aria-label="Primary"])')); })()`), `${route} ${width}px: menu did not open`)
      const result = await page.evaluate(`(() => {
        const dialog=document.querySelector('[role=dialog]:has(nav[aria-label="Primary"])');
        const groups=[...dialog.querySelectorAll('[role=group]')].map(g=>g.textContent.trim());
        const targets=[...dialog.querySelectorAll('a[href],button')].map(n=>{const r=n.getBoundingClientRect();return {text:n.textContent.trim(),h:r.height,w:r.width}});
        return {groups,targets,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,current:[...dialog.querySelectorAll('[aria-current=page]')].map(n=>n.textContent.trim())};
      })()`)
      assert.deepEqual(result.groups.map((value) => value.match(/^(Explore|Host|Company)/)?.[1]), ['Explore', 'Host', 'Company'], `${route} ${width}px: grouped menu order`)
      assert(result.targets.every(({ h, w }) => h >= 44 && w >= 44), `${route} ${width}px: a menu target is smaller than 44px`)
      assert(result.overflow <= 1, `${route} ${width}px: horizontal overflow ${result.overflow}`)
      assert.equal(result.current.some((label) => label.startsWith('Careers')), false, 'external Careers chip must never be selected')
      await press(page, 'Escape')
      await waitFor(() => page.evaluate(`!document.querySelector('[role=dialog]:has(nav[aria-label="Primary"])')`), `${route} ${width}px: menu did not close`)
    }
  }

  // #4339 phase 2b: the redesigned ranked-places grid (components/cities/city-weekend.tsx).
  // #4339 phase 4a moved it under "Places in <City>" (#places, #city-places-grid);
  // "This weekend" (#weekend) now reads the live listings (city-this-weekend.tsx).
  await open(page, baseUrl, '/cities/raleigh-nc?qa=city', { width: 390, height: 844, reducedMotion: true })
  const initial = await page.evaluate(`(() => ({
    total:document.querySelectorAll('[data-city-place-card]').length,
    visible:[...document.querySelectorAll('#city-places-grid>li')].filter(n=>getComputedStyle(n).display!=='none').length,
    button:document.querySelector('.wk-more button')?.textContent.trim(),
    labels:/Photo by|Google Maps/.test(document.querySelector('#places').textContent),
    stored:[...document.querySelectorAll('[data-place-media="stored"] img')].map(i=>i.getAttribute('src')),
    optimized:[...document.images].map(i=>i.src).filter(s=>s.includes('/_next/image')&&s.includes('place-photos'))
  }))()`)
  assert.equal(initial.total, 50)
  assert.equal(initial.visible, 12)
  assert.equal(initial.button, 'Show all 50 places')
  assert.equal(initial.labels, false, 'stored place cards must have no credit labels')
  assert(initial.stored.length > 0 && initial.stored.every((src) => /_thumb\.jpg(?:$|\?)/.test(src)), 'city cards must use stored thumbnails')
  assert.deepEqual(initial.optimized, [], 'stored place photos must not pass through the Next image optimiser')

  await page.evaluate(`document.querySelector('.wk-more button').click()`)
  await waitFor(() => page.evaluate(`[...document.querySelectorAll('#city-places-grid>li')].filter(n=>getComputedStyle(n).display!=='none').length >= 50 && document.activeElement?.classList.contains('wk-card')`), 'Show all did not reveal 50 and focus the first new place')

  const chips = await page.evaluate(`[...document.querySelectorAll('#weekend [data-filter-row] button')].map(b=>b.textContent.trim())`)
  assert.deepEqual(chips, ['All', 'Events', 'Experiences', 'Places'], 'Raleigh exposes the four weekend chips')
  await page.evaluate(`(() => { const b=[...document.querySelectorAll('#weekend [data-filter-row] button')]; for(let i=0;i<20;i++) b[i%2].click(); })()`)
  const chipState = await page.evaluate(`[...document.querySelectorAll('#weekend [data-filter-row] button')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.textContent.trim())`)
  assert.deepEqual(chipState, ['Events'], 'rapid filtering left exactly the last chip pressed')
  // The build has no database, so "This weekend" shows the shared fallback line, never invented listings.
  assert.match(await page.evaluate(`document.querySelector('#weekend .filter-note')?.textContent || ''`), /Nothing is listed this week yet\. Check back soon\./, 'an empty week says so instead of inventing listings')
  await page.evaluate(`[...document.querySelectorAll('#weekend [data-filter-row] button')].find(b=>b.textContent.trim()==='Places').click()`)
  await waitFor(() => page.evaluate(`document.querySelectorAll('[data-city-place-card]').length === 50`), 'the 50 ranked places did not stay')

  await open(page, baseUrl, '/cities/raleigh-nc?category=xyz', { width: 390, height: 844 })
  assert.equal(await page.evaluate(`document.querySelector('#weekend [data-filter-row] button').getAttribute('aria-pressed')`), 'true', 'an unknown query keeps All')
  assert.equal(await page.evaluate(`document.querySelectorAll('[data-city-place-card]').length`), 50)

  await open(page, baseUrl, '/cities/raleigh-nc?detail=place:not-a-real-id', { width: 390, height: 844 })
  await waitFor(() => page.evaluate(`/no longer available/i.test(document.querySelector('[role=alert]')?.textContent || '')`), 'a missing place must say it is no longer available')
  assert.equal(await page.evaluate(`Boolean(document.querySelector('[role=alert] a[href="/cities/raleigh-nc"]'))`), true)

  await open(page, baseUrl, '/cities/raleigh-nc?qa=no-js', { width: 390, height: 844, scriptDisabled: true })
  const noJs = await page.evaluate(`(() => ({visible:[...document.querySelectorAll('#city-places-grid>li')].filter(n=>getComputedStyle(n).display!=='none').length,button:getComputedStyle(document.querySelector('.wk-more')).display}))()`)
  assert.equal(noJs.visible, 50, 'no-JavaScript city catalogue must expose all 50 places')
  assert.equal(noJs.button, 'none', 'no-JavaScript city catalogue must hide Show all')

  await open(page, baseUrl, '/cities/raleigh-nc?qa=motion', { width: 1440, height: 900, reducedMotion: true })
  assert.equal(await page.evaluate(`document.getAnimations().filter(a=>a.playState==='running').length`), 0, 'reduced-motion city page left animations running')
  const actionableErrors = consoleErrors.filter((message) => !/favicon|Failed to load resource/i.test(message))
  assert.deepEqual(actionableErrors, [], `browser errors: ${actionableErrors.join('\n')}`)
})

process.stdout.write(`PASS #4137 Wave 2 tester: ${VIEWPORTS.length * ROUTES.length} menu views plus Raleigh catalogue boundaries\n`)
