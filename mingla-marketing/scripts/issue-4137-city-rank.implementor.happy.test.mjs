#!/usr/bin/env node
// #4137 wave 2 — implementor happy path (source): the city page's pure helpers.
//
//   categoryRank / rankLabel  "#n · Category" = rank WITHIN the category, in the
//                             validated stored order (Seth's default for OQ-2).
//   ratingLine                today's rating line from the stored catalogue
//                             (Seth, 27 Oct 2026), locale-formatted, null when
//                             the place has no rating.
//   storedPlaceThumbSrc       the stored `<placeId>/0_thumb.jpg`, never the
//   storedThumbFromPhotoUrl   original and never the billed /render/image path.
//
// Fails on revert: none of these modules exist before #4137 wave 2.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function load(relative) {
  assert(fs.existsSync(path.join(ROOT, relative)), `#4137: ${relative} must exist`)
  const compiled = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  Function('module', 'exports', 'require', compiled)(module, module.exports, () => ({}))
  return module.exports
}

const { categoryRank, rankLabel, ratingLine, CITY_RATING_SOURCE, CATEGORY_TILE_ICON } = load('lib/city-place-rank.ts')
const { storedPlaceThumbSrc, storedThumbFromPhotoUrl } = load('lib/city-place-photo.ts')
const catalogue = JSON.parse(read('content/cities/catalogues.generated.json'))
const raleigh = catalogue.cities['raleigh-nc'].places

// AC-P5 — Raleigh rank pills.
const ranks = categoryRank(raleigh)
const byName = (name) => raleigh.find((place) => place.name === name) ?? assert.fail(`#4137: ${name} missing from the Raleigh catalogue`)
assert.equal(rankLabel(byName('Lake Johnson Park'), ranks), '#1 · Nature & Views', '#4137 AC-P5 Lake Johnson Park')
assert.equal(rankLabel(byName('Sopranos Grill'), ranks), '#1 · Brunch', '#4137 AC-P5 Sopranos Grill')
assert.equal(rankLabel(byName('William & Company'), ranks), '#1 · Drinks & Music', '#4137 AC-P5 William & Company')
const casual = raleigh.filter((place) => place.categorySlug === 'casual_food')
assert.equal(casual.length, 17, '#4137: Raleigh holds 17 casual places')
assert.equal(rankLabel(casual[16], ranks), '#17 · Casual', '#4137 AC-P5 17th casual card')
assert.equal(ranks.size, 50, '#4137: every listed place gets a rank')
for (const slug of new Set(raleigh.map((place) => place.categorySlug))) {
  const ordered = raleigh.filter((place) => place.categorySlug === slug).map((place) => ranks.get(place.placePoolId))
  assert.deepEqual(ordered, ordered.map((_, index) => index + 1), `#4137: ${slug} ranks follow the stored order`)
}
assert.throws(() => rankLabel({ placePoolId: 'nope', categorySlug: 'play', categoryLabel: 'Play' }, ranks), /no category rank/)

// Rating line — the stored catalogue, as the live page shows it.
assert.equal(CITY_RATING_SOURCE, 'catalogue', '#4137: Seth kept the stored rating line')
assert.equal(ratingLine({ rating: 4.7, reviewCount: 4940 }, 'en-US'), '4.7 · 4,940 Google reviews')
assert.equal(ratingLine({ rating: 4.7, reviewCount: 4940 }, 'en-GB'), '4.7 · 4,940 Google reviews')
assert.equal(ratingLine({ rating: 4.7, reviewCount: 4940 }, 'en-FR'), `4.7 · ${new Intl.NumberFormat('en-FR').format(4940)} Google reviews`)
assert.equal(ratingLine({ rating: 4, reviewCount: null }, 'en-US'), '4.0 on Google')
assert.equal(ratingLine({ rating: null, reviewCount: 12 }, 'en-US'), null)
assert.equal(ratingLine(byName('Lake Johnson Park'), 'en-US'), `${byName('Lake Johnson Park').rating.toFixed(1)} · ${byName('Lake Johnson Park').reviewCount.toLocaleString('en-US')} Google reviews`)

// Category tiles cover every Explorer category.
const shared = read('content/page-system/shared.ts')
for (const slug of [...shared.matchAll(/\{ slug: '([a-z_]+)', label:/g)].map((match) => match[1])) {
  assert.match(CATEGORY_TILE_ICON[slug] ?? '', /^[A-Z][A-Za-z0-9]+$/, `#4137: ${slug} needs a tile icon`)
}

// Stored thumbnails only (Seth, 27 Oct 2026; hold #1643).
const BASE = 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/'
assert.equal(storedPlaceThumbSrc('ChIJF1nRfeb0rIkRcOIaLLNq5jc'), `${BASE}ChIJF1nRfeb0rIkRcOIaLLNq5jc/0_thumb.jpg`)
assert.equal(storedPlaceThumbSrc('../../etc'), null)
assert.equal(storedThumbFromPhotoUrl(`${BASE}ChIJnfWgLfn2OxARZjghHw4IIMA/0.jpg`), `${BASE}ChIJnfWgLfn2OxARZjghHw4IIMA/0_thumb.jpg`)
assert.equal(storedThumbFromPhotoUrl(`${BASE}ChIJx/2.png?v=1`), `${BASE}ChIJx/2_thumb.jpg`)
assert.equal(storedThumbFromPhotoUrl(`${BASE}ChIJx/0_thumb.jpg`), null)
assert.equal(storedThumbFromPhotoUrl('https://images.unsplash.com/x.jpg'), null)
assert.equal(storedThumbFromPhotoUrl(`${BASE}rootfile.jpg`), null)
for (const value of [storedPlaceThumbSrc('ChIJF1nRfeb0rIkRcOIaLLNq5jc'), storedThumbFromPhotoUrl(`${BASE}a1b2c3d4/0.jpg`)]) {
  assert.doesNotMatch(value, /\/render\/image\//, '#4137: never the billed transformation endpoint')
  assert.match(value, /_thumb\.jpg$/, '#4137: thumbnails only')
}

process.stdout.write('PASS #4137 city rank: in-category rank labels (AC-P5), stored rating line with locale formatting, category tiles, stored thumbnails only\n')
