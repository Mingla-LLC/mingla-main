#!/usr/bin/env node
// #4137 wave 2 — implementor happy path (--built-only, release artifact): the
// redesigned /cities/<slug> pages, read from .next/server/app/cities/*.html for
// all ten cities.
//
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

  // AC-P1
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => text(match[1]))
  assert.deepEqual(h1s, [`Things to do in ${city}.`], `#4137 AC-P1: ${label} H1`)
  const lede = text(between(main, 'class="city-v2-hero-lede"', '</p>').replace(/^[^>]*>/, ''))
  assert.equal(lede, `The top 50 places in ${city}, ranked by Mingla, not by who paid.${hasPlans ? ' Plus ready-made plans to send to the group.' : ''}`, `#4137 AC-P1: ${label} lede`)
  assert.doesNotMatch(text(main), /this week/i, `#4137 AC-P1: ${label} promises no events`)

  // AC-P2
  const heroSrc = `/marketing/cities/cards/${slug}.jpg`
  const heroImg = /<img\b[^>]*class="city-v2-hero-photo"[^>]*>/.exec(main)?.[0] ?? assert.fail(`#4137 AC-P2: ${label} hero image`)
  assert.match(heroImg, /\balt=""/, `#4137 AC-P2: ${label} decorative hero`)
  assert(heroImg.includes(`/_next/image?url=${encodeURIComponent(heroSrc)}`), `#4137 AC-P2: ${label} hero src ${heroSrc}`)
  assert.match(html, new RegExp(`<link rel="preload" as="image"[^>]*${encodeURIComponent(heroSrc).replace(/[.*+?^${}()|[\]\\%]/g, '\\$&')}`), `#4137 AC-P2: ${label} hero preloaded (priority)`)
  const asset = manifest.assets.find((entry) => entry.path === heroSrc) ?? assert.fail(`#4137: ${heroSrc} missing from the asset manifest`)
  assert.equal(asset.aiGenerated, false, `#4137: ${heroSrc} must be a real licensed photo`)
  assert(asset.license, `#4137: ${heroSrc} must carry a licence`)
  assert(heroSource.includes(`src: '${heroSrc}'`), `#4137: CITY_HERO_IMAGE.${slug}`)
  assert.doesNotMatch(main, /<figcaption/i, `#4137 AC-P2: ${label} has no figcaption`)
  for (const phrase of ['Photo:', 'Photo by', 'Unsplash', 'Google Maps']) assert(!text(main).includes(phrase), `#4137: ${label} shows no credit or attribution ("${phrase}")`)

  // AC-P3 + AC-P5
  const cards = [...main.matchAll(/<article class="city-v2-place" data-city-place-card="true" data-category="([a-z_]+)">([\s\S]*?)<\/article>/g)]
  assert.equal(cards.length, 50, `#4137 AC-P3: ${label} renders 50 place cards`)
  const seen = new Map()
  cards.forEach(([, category, card], index) => {
    const place = places[index]
    assert.equal(category, place.categorySlug, `#4137 AC-P3: ${label} card ${index + 1} category`)
    assert.equal(text(/<h3>([\s\S]*?)<\/h3>/.exec(card)?.[1] ?? ''), place.name, `#4137 AC-P3: ${label} card ${index + 1} is ${place.name}`)
    seen.set(category, (seen.get(category) ?? 0) + 1)
    assert.equal(text(/class="city-v2-rank"[^>]*>([\s\S]*?)<\/span>/.exec(card)?.[1] ?? ''), `#${seen.get(category)} · ${place.categoryLabel}`, `#4137 AC-P5: ${label} ${place.name} rank pill`)
    assert(decode(card).includes(`href="/cities/${slug}?type=places&detail=place:${place.placePoolId}"`), `#4137: ${label} ${place.name} opens its detail`)
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

  // AC-P4
  assert(!html.includes('>Get the app<'), `#4137 AC-P4: ${label} has no per-card "Get the app"`)
  assert(!text(html).includes('Mingla score'), `#4137 AC-P4: ${label} has no Mingla score`)
  const outsidePlans = main.replace(/<article class="city-v2-plan"[\s\S]*?<\/article>/g, '')
  assert.equal((outsidePlans.match(/data-cta-surface="explorer"/g) ?? []).length, 1, `#4137 AC-P4: ${label} has one page-level Explorer CTA`)
  assert.equal((outsidePlans.match(/data-cta-surface="host"/g) ?? []).length, 2, `#4137 AC-P4: ${label} has hero + band Host CTAs`)
  assert.equal((between(main, 'class="city-v2-hero"', '</section>').match(/data-cta-surface="explorer"/g) ?? []).length, 1, `#4137 AC-P4: ${label} Explorer CTA sits in the hero`)

  // AC-P10
  const plans = [...main.matchAll(/<article class="city-v2-plan" data-city-plan-card="true"[\s\S]*?<\/article>/g)].map((match) => match[0])
  if (hasPlans) {
    assert.equal(plans.length, 6, '#4137 AC-P10: Lagos renders six plans')
    assert.match(main, /<h2 id="plans">Pick a plan, send it to the group\.<\/h2>/)
    for (const plan of plans) {
      assert.equal((plan.match(/<(a|button)\b/g) ?? []).length, 1, '#4137 AC-P10: one interactive element per plan card')
      assert.match(plan, /data-cta-surface="explorer"[\s\S]*Open in Mingla|Open in Mingla[\s\S]*data-cta-surface="explorer"/, '#4137 AC-P10: the card opens Mingla')
      for (const [, src] of plan.matchAll(/<img\b[^>]*src="([^"]+)"/g)) assert.match(decode(src), THUMB, '#4137 AC-P10: plan tiles use stored thumbnails only')
    }
  } else {
    assert.equal(plans.length, 0, `#4137 AC-P10: ${label} has no plans`)
    assert(!main.includes('Ready-made plans') && !main.includes('id="plans"'), `#4137 AC-P10: ${label} renders no plans section`)
  }

  // AC-P11
  const band = text(between(main, 'class="city-v2-host"', '</section>'))
  assert(band.includes(`Run a venue, event or trip in ${city}?`), `#4137 AC-P11: ${label} host band heading`)
  assert(band.includes(`Get in front of the people planning their weekend in ${city}.`), `#4137 AC-P11: ${label} host band copy`)
  assert(!band.includes('Get on this page'), `#4137 AC-P11: ${label} promises no host listing`)

  // AC-P12
  const faqs = [...main.matchAll(/<details class="city-faq-item"><summary>([\s\S]*?)<\/summary>/g)].map((match) => text(match[1]))
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]))
  const faqPage = JSON.stringify(ld).includes('"FAQPage"')
    ? ld.flatMap((doc) => doc['@graph'] ?? [doc]).find((node) => node['@type'] === 'FAQPage')
    : null
  assert(faqPage, `#4137 AC-P12: ${label} keeps its FAQPage markup`)
  assert.deepEqual(faqs, faqPage.mainEntity.map((question) => question.name), `#4137 AC-P12: ${label} visible questions equal the FAQPage questions`)

  // AC-P13
  assert.doesNotMatch(text(main), /Latest stor|Guides|Blog/, `#4137 AC-P13: ${label} has no blog block`)
  assert(!main.includes('href="/blog'), `#4137 AC-P13: ${label} links no blog`)
  assert(!main.includes('ps-catalogue-card'), `#4137: ${label} no longer renders the old catalogue cards`)
}

process.stdout.write('PASS #4137 city pages (10 cities, release build): H1 + true lede, licensed hero, 50 ranked cards with stored thumbnails and no credit lines, one Explorer CTA, plans only where real, host band, FAQ parity, no blog\n')
