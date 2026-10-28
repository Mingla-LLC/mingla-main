#!/usr/bin/env node
// #4137 Phase 1 tester: real-Chrome device, keyboard, motion and layout checks.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { open, press, waitFor, withNextBrowser } from './issue-4137-browser-harness.mjs'

if (!process.argv.includes('--built-only')) {
  process.stdout.write('SKIP #4137 host/CTA tester: run with --built-only after next build\n')
  process.exit(0)
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UAS = [
  ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 'iPhone', 5, true],
  ['Android Chrome', 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36', 'Linux armv8l', 5, true],
  ['Android Instagram', 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Mobile Safari/537.36 Instagram 352.0.0.0', 'Linux armv8l', 5, true],
  ['iPadOS as Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'MacIntel', 5, true],
  ['macOS Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'MacIntel', 0, false],
  ['Windows Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36', 'Win32', 0, false],
]

const files = fs.readdirSync(path.join(ROOT, 'public/marketing/host'))
for (const file of files) {
  const bytes = fs.statSync(path.join(ROOT, 'public/marketing/host', file)).size
  assert(bytes <= 350 * 1024, `${file} is ${bytes} bytes; host assets must stay <=350KB`)
  if (/^hero-/.test(file)) assert(bytes <= 250 * 1024, `${file} is ${bytes} bytes; hero tiles must stay <=250KB`)
}

await withNextBrowser(ROOT, async ({ page, baseUrl, consoleErrors }) => {
  for (const [name, userAgent, platform, touchPoints, phone] of UAS) {
    await open(page, baseUrl, '/host?qa=cta-matrix', { width: phone ? 390 : 1440, height: 900, userAgent, platform, touchPoints })
    if (phone) {
      await waitFor(() => page.evaluate(`[...document.querySelectorAll('a[data-cta-phone-href]')].every(a => a.href === a.dataset.ctaPhoneHref)`), `${name}: device links did not finish hydrating`)
    }
    const links = await page.evaluate(`[...document.querySelectorAll('a[data-cta-phone-href]')].map(a => ({
      href: a.href, phone: a.dataset.ctaPhoneHref, surface: a.dataset.ctaSurface,
      target: a.getAttribute('target'), platform: document.documentElement.dataset.platform
    }))`)
    assert(links.length >= 3, `${name}: expected several device-aware CTAs`)
    for (const link of links) {
      if (phone) {
        assert.equal(link.href, link.phone, `${name}: phone href did not hydrate to its OneLink`)
        assert.equal(link.platform === 'ios' || link.platform === 'android', true, `${name}: platform=${link.platform}`)
      } else {
        const expected = link.surface === 'explorer' ? '/download' : 'https://host.usemingla.com/'
        assert.equal(new URL(link.href).href.startsWith(new URL(expected, baseUrl).href), true, `${name}: computer destination ${link.href}`)
        assert.equal(link.platform, 'other', `${name}: desktop must stay other`)
      }
    }
  }

  await open(page, baseUrl, '/host?qa=no-js', { width: 1440, height: 900, scriptDisabled: true })
  const noJs = await page.evaluate(`[...document.querySelectorAll('a[data-cta-phone-href]')].map(a => ({href:a.getAttribute('href'),surface:a.dataset.ctaSurface}))`)
  assert(noJs.every((link) => link.surface === 'explorer' ? link.href === '/download' : link.href.startsWith('https://host.usemingla.com')), 'no-JavaScript CTAs must retain computer destinations')

  await open(page, baseUrl, '/host?qa=keyboard', { width: 1280, height: 900, reducedMotion: true })
  await page.evaluate(`document.body.focus()`)
  await waitFor(async () => {
    await press(page, 'Tab')
    return page.evaluate(`document.activeElement?.classList.contains('cut-xcard-trigger')`)
  }, 'keyboard did not reach an expanding card')
  await press(page, 'Tab')
  await waitFor(() => page.evaluate(`document.querySelectorAll('.cut-xcard-trigger')[1].getAttribute('aria-expanded') === 'true'`), 'keyboard focus did not expand the second card')
  assert.equal(await page.evaluate(`document.querySelectorAll('.cut-xcard-trigger')[0].getAttribute('aria-expanded')`), 'false')
  const focusVisible = await page.evaluate(`(() => { const s=getComputedStyle(document.querySelectorAll('.cut-xcard-trigger')[1]); return s.outlineStyle !== 'none' || s.boxShadow !== 'none'; })()`)
  assert.equal(focusVisible, true, 'expanded-card trigger lost its visible focus treatment')
  assert.equal(await page.evaluate(`document.getAnimations().filter(a=>a.playState==='running').length`), 0, 'reduced-motion left an animation running')

  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__qaCls=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__qaCls+=e.value}).observe({type:'layout-shift',buffered:true})` })
  for (const width of [390, 1440]) {
    await open(page, baseUrl, '/host?qa=cls', { width, height: 900 })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const cls = await page.evaluate(`window.__qaCls || 0`)
    assert(cls <= 0.05, `${width}px: host CLS ${cls} exceeded 0.05`)
  }
  assert.deepEqual(consoleErrors, [], `browser errors: ${consoleErrors.join('\n')}`)
})

process.stdout.write(`PASS #4137 Phase 1 tester: ${UAS.length} device classes, no-JS, keyboard, reduced motion, CLS and ${files.length} assets\n`)
