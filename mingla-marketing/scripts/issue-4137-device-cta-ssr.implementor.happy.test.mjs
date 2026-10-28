#!/usr/bin/env node
// #4137 — implementor happy path, AC-D1 over the built HTML (--built-only).
//
// In the server HTML, for any user agent, every CTA <a> carries the COMPUTER
// destination in `href` and the PHONE destination in `data-cta-phone-href`,
// both from the device matrix (spec §4.1, Seth OQ-1/OQ-3). No CTA renders as a
// dialog button before hydration. Both labels and all three marks are present,
// so CSS can show the right one from first paint (F-7).

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(ROOT, '.next/server/app')

const EXPLORER_PHONE = 'https://go.usemingla.com/w36m?pid=mingla_web&amp;c=explorer_nav'
const HOST_PHONE = /^https:\/\/biz\.usemingla\.com\/ZSCW\?pid=mingla_web&amp;c=(business_nav|business_hero)$/
const HOST_COMPUTER = /^https:\/\/host\.usemingla\.com(\/(event|trip|experience|venue)\/create)?$/

// / (home) and /cities render their CTAs client-side or dynamically, so they are not in the static HTML.
const PAGES = ['host.html', 'about.html', 'going-out.html', 'help.html']
// One city page, whichever the final build prerendered.
const cityDir = path.join(APP, 'cities')
if (fs.existsSync(cityDir)) {
  const city = fs.readdirSync(cityDir).find((f) => f.endsWith('.html'))
  if (city) PAGES.push(`cities/${city}`)
}

assert(fs.existsSync(path.join(APP, 'host.html')), '#4137: run `next build` before this test')

const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
let total = 0
for (const page of PAGES) {
  const file = path.join(APP, page)
  assert(fs.existsSync(file), `#4137: ${page} missing from the build`)
  const html = fs.readFileSync(file, 'utf8')
  const ctas = html.match(/<a\b[^>]*data-cta-phone-href="[^"]*"[^>]*>/g) ?? []
  assert(ctas.length > 0, `#4137 AC-D1: ${page} has no device-aware CTA`)
  for (const tag of ctas) {
    const surface = attr(tag, 'data-cta-surface')
    const href = attr(tag, 'href')
    const phone = attr(tag, 'data-cta-phone-href')
    if (surface === 'explorer') {
      assert.equal(href, '/download', `#4137 AC-D1: ${page} explorer computer href`)
      assert.equal(phone, EXPLORER_PHONE, `#4137 AC-D1: ${page} explorer phone href`)
    } else {
      assert.equal(surface, 'host', `#4137: ${page} unknown CTA surface`)
      assert.match(href, HOST_COMPUTER, `#4137 AC-D1: ${page} host computer href`)
      assert.match(phone, HOST_PHONE, `#4137 AC-D1: ${page} host phone href`)
    }
    assert.doesNotMatch(tag, /aria-haspopup/, `#4137 AC-D1: ${page} CTA must not be a dialog trigger in the server HTML`)
    total += 1
  }
  // The menu toggle is a legitimate dialog button; an app CTA never is.
  const dialogButtons = (html.match(/<button\b[^>]*aria-haspopup="dialog"[^>]*>[\s\S]*?<\/button>/g) ?? [])
    .filter((button) => /Use Mingla|Get the app|Explore Your City/.test(button))
  assert.deepEqual(dialogButtons, [], `#4137 AC-D1: ${page} renders an app CTA as a dialog button`)
  // F-7: both labels and the three marks ship in the server HTML.
  if (/data-cta-surface="[a-z]+"[^>]*class="cut-btn/.test(html) || /class="cut-btn[^"]*"[^>]*data-cta/.test(html)) {
    assert.match(html, /data-cta-when="phone"/, `#4137 F-7: ${page} phone label`)
    assert.match(html, /data-cta-when="computer"/, `#4137 F-7: ${page} computer label`)
    for (const mark of ['ios', 'android', 'other']) assert.match(html, new RegExp(`data-cta-mark="${mark}"`), `#4137 F-7: ${page} ${mark} mark`)
  }
  // The boot script ships in <head> on every page.
  assert.match(html, /<head>[\s\S]*?setAttribute\('data-platform',p\)[\s\S]*?<\/head>/, `#4137 F-7: ${page} boot script in <head>`)
}

process.stdout.write(`PASS #4137 AC-D1: ${total} CTAs across ${PAGES.length} built pages carry the computer href and the phone href\n`)
