#!/usr/bin/env node
// #4137 wave 2 — implementor happy path (--built-only, release artifact): the
// redesigned /cities/<slug> pages, read from .next/server/app/cities/*.html for
// all ten cities.
//
// #4339 phase 2b re-pinned the layout to the approved redesign (AC-P1, AC-P2,
// AC-P4, AC-P10 and AC-P11 below now describe it: the "<City>, what are we
// outside for?" hero with the city pill and Use Mingla, "This weekend" with
// the Events / Experiences / Places chips, the "More than one mode." guide
// band, the FAQ and ONE See Mingla Host button). The data contracts are
// unchanged: 50 ranked places with stored thumbnails, plans only where real,
// FAQ parity, no score, no blog.
//
// The #4137 wave 2 acceptance list as first written:
//   AC-P1  one H1 "Things to do in {city}."; the true-parts lede (plans
//          sentence only where plans exist).
//   AC-P2  hero = the licensed /marketing/cities/cards/<slug>.jpg (manifest:
//          aiGenerated false, licensed), alt="", preloaded; no photo caption.
//   AC-P3  50 [data-city-place-card] in stored rank order.
//   AC-P4  zero "Get the app" and zero "Mingla score"; one Explorer CTA outside
//          plan cards (hero) and two Host CTAs (hero + band).
//   AC-P5  in-category rank pills.
//   AC-P6  (Seth, 27 Oct 2026) every card shows its stored place-pool
//          `_thumb.jpg`; never an original, never /render/image, never the
//          business logo; no credit or attribution text.
//   AC-P10 plans only where real (Lagos 6, Raleigh none), one interactive
//          element per plan card, thumbnail tiles only.
//   AC-P11 host band copy; AC-P12 FAQ matches FAQPage; AC-P13 no blog block.
// Fails on revert: the old page renders ps-catalogue-card with 50 "Get the
// app", "Mingla score", the old H1 and the business-logo fallback.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const APP = path.join(ROOT, '.next/server/app/cities')
assert(process.argv.includes('--built-only'), '#4137: run with --built-only after the release build')
assert(fs.existsSync(APP), '#4137: run `next build` before this test')

const catalogue = JSON.parse(read('content/cities/catalogues.generated.json'))
const manifest = JSON.parse(read('public/marketing/cities/asset-manifest.json'))
const heroSource = read('lib/city-hero-images.ts')
const CITY = {
  lagos: 'Lagos', 'durham-nc': 'Durham', 'cary-nc': 'Cary', 'raleigh-nc': 'Raleigh', 'new-york-city': 'New York City',
  brussels: 'Brussels', paris: 'Paris', london: 'London', 'fort-lauderdale': 'Fort Lauderdale', 'washington-dc': 'Washington, DC',
}
const CITY_COUNTRY = {
  lagos: 'Nigeria', 'durham-nc': 'United States', 'cary-nc': 'United States', 'raleigh-nc': 'United States', 'new-york-city': 'United States',
  brussels: 'Belgium', paris: 'France', london: 'United Kingdom', 'fort-lauderdale': 'United States', 'washington-dc': 'United States',
}
// Cities whose hero is a picked clip or redesign photo (components/site/city-media.tsx).
const MEDIA_CITIES = new Set([...read('components/site/city-media.tsx').matchAll(/^\s+'?([a-z-]+)'?: '[vp]:[a-z0-9-]+',$/gm)].map((match) => match[1]))
const THUMB = /^https:\/\/gqnoajqerqhnvulmnyvv\.supabase\.co\/storage\/v1\/object\/public\/place-photos\/[A-Za-z0-9_-]+\/0_thumb\.jpg$/
const decode = (value) => value.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const text = (html) => decode(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const between = (html, open, close) => {
  const start = html.indexOf(open)
  assert(start >= 0, `missing ${open}`)
  return html.slice(start, html.indexOf(close, start) + close.length)
}

for (const [slug, city] of Object.entries(CITY)) {
  const html = fs.readFileSync(path.join(APP, `${slug}.html`), 'utf8')
  const main = between(html, '<main', '</main>')
  const places = catalogue.cities[slug].places
  const hasPlans = slug === 'lagos'
  const label = `/cities/${slug}`

  // AC-P1 (#4339): one H1, the design's headline; no promise of events.
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => text(match[1]))
  assert.deepEqual(h1s, [`${city}, what are we outside for?`], `#4137/#4339 AC-P1: ${label} H1`)
  const hero = between(main, 'class="lp-hero city-lp-hero"', '</section>')
  assert(text(hero).includes(`${city}, ${CITY_COUNTRY[slug]}`), `#4339: ${label} hero carries the city pill`)
  assert.doesNotMatch(text(main), /events? (?:this|on) (?:week|weekend)/i, `#4137 AC-P1: ${label} promises no events`)

  // AC-P2 (#4339): the hero is the city's tile media (components/site/city-media.tsx):
  // a picked clip or redesign photo, else the licensed city photo; never captioned.
  const heroSrc = `/marketing/cities/cards/${slug}.jpg`
  if (MEDIA_CITIES.has(slug)) {
    assert.match(hero, /data-landing-clip="\/marketing\/site\/m\/|src="\/marketing\/site\/p\//, `#4339 AC-P2: ${label} hero uses its picked city media`)
  } else {
    const heroImg = new RegExp(`<img\\b[^>]*src="${heroSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`).exec(hero)?.[0] ?? assert.fail(`#4137 AC-P2: ${label} hero image`)
    assert.match(heroImg, /\balt=""/, `#4137 AC-P2: ${label} decorative hero`)
    assert.match(heroImg, /fetchPriority="high"|fetchpriority="high"/, `#4137 AC-P2: ${label} hero is the priority image`)
    const asset = manifest.assets.find((entry) => entry.path === heroSrc) ?? assert.fail(`#4137: ${heroSrc} missing from the asset manifest`)
    assert.equal(asset.aiGenerated, false, `#4137: ${heroSrc} must be a real licensed photo`)
    assert(asset.license, `#4137: ${heroSrc} must carry a licence`)
    assert(heroSource.includes(`src: '${heroSrc}'`), `#4137: CITY_HERO_IMAGE.${slug}`)
  }
  assert.doesNotMatch(main, /<figcaption/i, `#4137 AC-P2: ${label} has no figcaption`)
  for (const phrase of ['Photo:', 'Photo by', 'Unsplash', 'Google Maps']) assert(!text(main).includes(phrase), `#4137: ${label} shows no credit or attribution ("${phrase}")`)

  // #4339: "This weekend" with the four chips, each a button.
  const weekend = between(main, 'id="weekend"', '</section>')
  const chips = [...weekend.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>([^<]+)<\/button>/g)].map((match) => [match[2], match[1]])
  assert.deepEqual(chips, [['All', 'true'], ['Events', 'false'], ['Experiences', 'false'], ['Places', 'false']], `#4339: ${label} weekend chips`)

  // AC-P3 + AC-P5
  const cards = [...weekend.matchAll(/<a\b[^>]*class="wk-card" data-city-place-card="" data-category="([a-z_]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  assert.equal(cards.length, 50, `#4137 AC-P3: ${label} renders 50 place cards`)
  const seen = new Map()
  cards.forEach(([whole, category, card], index) => {
    const place = places[index]
    assert.equal(category, place.categorySlug, `#4137 AC-P3: ${label} card ${index + 1} category`)
    assert.equal(text(/<h3>([\s\S]*?)<\/h3>/.exec(card)?.[1] ?? ''), place.name, `#4137 AC-P3: ${label} card ${index + 1} is ${place.name}`)
    seen.set(category, (seen.get(category) ?? 0) + 1)
    assert.equal(text(/class="kind"[^>]*>([\s\S]*?)<\/span>/.exec(card)?.[1] ?? ''), `Place · #${seen.get(category)} · ${place.categoryLabel}`, `#4137 AC-P5: ${label} ${place.name} rank`)
    assert(decode(whole).includes(`href="/cities/${slug}?type=places&detail=place:${place.placePoolId}"`), `#4137: ${label} ${place.name} opens its detail`)
    // AC-P6 — the stored thumbnail, nothing else.
    const imgs = [...card.matchAll(/<img\b[^>]*src="([^"]+)"/g)].map((match) => decode(match[1]))
    assert.deepEqual(imgs, [`https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/${place.googlePlaceId}/0_thumb.jpg`], `#4137 AC-P6: ${label} ${place.name} shows its stored thumbnail`)
    if (typeof place.rating === 'number' && typeof place.reviewCount === 'number') {
      assert.match(text(card), new RegExp(`${place.rating.toFixed(1)} · [0-9.,\\s\\u202f\\u00a0]+ Google reviews`), `#4137: ${label} ${place.name} keeps its rating line`)
    }
  })
  for (const [, src] of main.matchAll(/<img\b[^>]*src="([^"]+)"/g)) {
    const value = decode(src)
    assert.doesNotMatch(value, /mingla-business-logo|\/render\/image\//, `#4137 AC-P6: ${label} must not render ${value}`)
    if (value.includes('place-photos')) assert.match(value, THUMB, `#4137 AC-P6: ${label} stored photos must be thumbnails (${value})`)
  }

  // AC-P4 (#4339): no per-card CTA, no score; the one Explorer CTA sits in the
  // hero (plan "Save" buttons aside); no Host device CTA; ONE See Mingla Host → /host.
  assert(!main.includes('>Get the app<'), `#4137 AC-P4: ${label} has no per-card "Get the app"`)
  assert(!text(html).includes('Mingla score'), `#4137 AC-P4: ${label} has no Mingla score`)
  const outsidePlans = main.replace(/<li class="list-item" data-city-plan-card=""[\s\S]*?<\/li>/g, '')
  assert.equal((outsidePlans.match(/data-cta-surface="explorer"/g) ?? []).length, 1, `#4137 AC-P4: ${label} has one page-level Explorer CTA`)
  assert.equal((hero.match(/data-cta-surface="explorer"/g) ?? []).length, 1, `#4137 AC-P4: ${label} Explorer CTA sits in the hero`)
  assert.equal((main.match(/data-cta-surface="host"/g) ?? []).length, 0, `#4339: ${label} has no Host device CTA`)
  const hostLinks = [...main.matchAll(/<a\b[^>]*href="\/host"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => text(match[1]))
  assert.deepEqual(hostLinks, ['See Mingla Host'], `#4339 AC-P11: ${label} has one See Mingla Host button`)
  assert(text(main).includes(`Run a place in ${city}?`), `#4339 AC-P11: ${label} host heading`)

  // AC-P10 (#4339): plans only where real, in the guide band, one Save each.
  const plans = [...main.matchAll(/<li class="list-item" data-city-plan-card=""[\s\S]*?<\/li>/g)].map((match) => match[0])
  assert(text(main).includes('More than one mode.'), `#4339: ${label} guide band`)
  if (hasPlans) {
    assert.equal(plans.length, 6, '#4137 AC-P10: Lagos renders six plans')
    for (const plan of plans) {
      assert.equal((plan.match(/<(a|button)\b/g) ?? []).length, 1, '#4137 AC-P10: one interactive element per plan')
      assert.match(plan, /data-cta-surface="explorer"/, '#4137 AC-P10: Save opens Mingla')
    }
  } else {
    assert.equal(plans.length, 0, `#4137 AC-P10: ${label} has no plans`)
  }

  // AC-P12
  const faqs = [...main.matchAll(/<details><summary>([\s\S]*?)<span class="pl"/g)].map((match) => text(match[1]))
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]))
  const faqPage = JSON.stringify(ld).includes('"FAQPage"')
    ? ld.flatMap((doc) => doc['@graph'] ?? [doc]).find((node) => node['@type'] === 'FAQPage')
    : null
  assert(faqPage, `#4137 AC-P12: ${label} keeps its FAQPage markup`)
  assert.deepEqual(faqs, faqPage.mainEntity.map((question) => question.name), `#4137 AC-P12: ${label} visible questions equal the FAQPage questions`)

  // AC-P13
  assert.doesNotMatch(text(main), /Latest stor|Blog/, `#4137 AC-P13: ${label} has no blog block`)
  assert(!main.includes('href="/blog'), `#4137 AC-P13: ${label} links no blog`)
  assert(!main.includes('ps-catalogue-card'), `#4137: ${label} no longer renders the old catalogue cards`)
}

process.stdout.write('PASS #4137/#4339 city pages (10 cities, release build): redesigned hero with the city pill, This weekend chips, 50 ranked cards with stored thumbnails, one Explorer CTA, one See Mingla Host, plans only where real, FAQ parity, no blog\n')
