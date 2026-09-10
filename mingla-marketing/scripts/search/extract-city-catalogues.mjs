#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUTPUT = path.join(ROOT, 'content/cities/catalogues.generated.json')
const RECEIPT_OUTPUT = path.join(ROOT, 'content/cities/catalogue-receipts.generated.json')
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'gqnoajqerqhnvulmnyvv'
const WRITE = process.argv.includes('--write')
const asOfArgument = process.argv.find((value) => value.startsWith('--as-of='))?.split('=', 2)[1]
const AS_OF = asOfArgument || new Date().toISOString().slice(0, 10)
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN

const SIGNALS = [
  'nature', 'icebreakers', 'drinks', 'brunch', 'casual_food',
  'fine_dining', 'movies', 'theatre', 'creative_arts', 'play',
]

const CATEGORY_LABELS = {
  nature: 'Nature & Views',
  icebreakers: 'Icebreakers',
  drinks: 'Drinks & Music',
  brunch: 'Brunch',
  casual_food: 'Casual',
  fine_dining: 'Fine Dining',
  movies: 'Movies',
  theatre: 'Theatre',
  creative_arts: 'Creative & Arts',
  play: 'Play',
}
const CITY_OUTPUT_ORDER = [
  'lagos', 'durham-nc', 'cary-nc', 'raleigh-nc', 'new-york-city',
  'brussels', 'paris', 'london', 'fort-lauderdale', 'washington-dc',
]

const TIGER_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/28/query'
const US_BOUNDARY_PAGE = 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html'
const CITY_CONTRACTS = [
  {
    slug: 'lagos', databaseName: 'Lagos', countryCode: 'NG',
    boundary: {
      sourceUrl: 'https://datacatalogfiles.worldbank.org/ddh-published/0039368/1/DR0048904/ngaadmbndaadm1osgof20161215.geojson',
      landingUrl: 'https://energydata.info/en/dataset/nigeria-administrative-boundaries-2017/resource/b02a26ea-58af-4862-9b5d-b0cf9cc3987e?inner_span=True',
      authority: 'Office of the Surveyor General of the Federation; republished by World Bank Group / ESMAP',
      license: 'CC BY 4.0', vintage: '2016-12-15', semantics: 'Lagos State',
      select(features) { return features.filter((feature) => feature.properties?.admin1Name === 'Lagos') },
    },
  },
  ...[
    ['durham-nc', 'Durham', 'NC', '3719000', 'City of Durham corporate limits'],
    ['cary-nc', 'Cary', 'NC', '3710740', 'Town of Cary corporate limits'],
    ['raleigh-nc', 'Raleigh', 'NC', '3755000', 'City of Raleigh corporate limits'],
    ['new-york-city', 'New York', 'NY', '3651000', 'New York City, five boroughs'],
    ['fort-lauderdale', 'Fort Lauderdale', 'FL', '1224000', 'City of Fort Lauderdale municipal limits'],
    ['washington-dc', 'Washington', 'DC', '1150000', 'District of Columbia boundary'],
  ].map(([slug, databaseName, state, geoid, semantics]) => ({
    slug, databaseName, countryCode: 'US',
    boundary: {
      sourceUrl: `${TIGER_BASE}?${new URLSearchParams({ where: `GEOID='${geoid}'`, outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'geojson' })}`,
      landingUrl: US_BOUNDARY_PAGE,
      authority: 'United States Census Bureau', license: 'United States federal public domain',
      vintage: '2025-01-01', semantics, state, geoid,
      select(features) { return features.filter((feature) => feature.properties?.GEOID === geoid) },
    },
  })),
  {
    slug: 'brussels', databaseName: 'Brussels', countryCode: 'BE',
    boundary: {
      sourceUrl: 'https://data.mobility.brussels/geoserver/bm_urbis/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=bm_urbis%3Aurbadm_re&outputFormat=application%2Fjson&srsName=EPSG%3A4326',
      landingUrl: 'https://data-mobility.irisnet.be/info/urbadm_re',
      authority: 'Brussels Mobility / Paradigm UrbIS', license: 'CC0', vintage: '2024-06-21',
      semantics: 'Brussels-Capital Region (all 19 municipalities)',
      select(features) { return features.filter((feature) => feature.properties?.inspire_id === 'BE.BRUSSELS.BRIC.ADM.RE.1' && feature.properties?.urbis_id === 1) },
    },
  },
  {
    slug: 'paris', databaseName: 'Paris', countryCode: 'FR',
    boundary: {
      sourceUrl: 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arrondissements/exports/geojson?lang=fr&timezone=Europe%2FParis',
      landingUrl: 'https://opendata.paris.fr/explore/dataset/arrondissements/',
      authority: 'Ville de Paris, Direction de l’Urbanisme', license: 'ODbL', vintage: '2026-09-03',
      semantics: 'Commune of Paris, union of the 20 municipal arrondissements',
      select(features) { return features.filter((feature) => Number(feature.properties?.c_arinsee) >= 75101 && Number(feature.properties?.c_arinsee) <= 75120) },
    },
  },
  {
    slug: 'london', databaseName: 'London', countryCode: 'GB',
    boundary: {
      sourceUrl: 'https://services1.arcgis.com/YswvgzOodUvqkoCN/arcgis/rest/services/Greater_London_Authority__GLA_/FeatureServer/17/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson',
      landingUrl: 'https://data.london.gov.uk/dataset/statistical-gis-boundary-files-for-london-20od9',
      authority: 'Greater London Authority', license: 'Open Government Licence v2', vintage: '2015',
      semantics: 'Greater London: 32 boroughs plus the City of London',
      attribution: 'Contains National Statistics data © Crown copyright and database right 2015. Contains Ordnance Survey data © Crown copyright and database right 2015.',
      select(features) { return features.filter((feature) => feature.properties?.FILE_NAME === 'GREATER_LONDON_AUTHORITY') },
    },
  },
]

function parseGeoJson(text) {
  // The World Bank alternate currently appends the .NET stream type after the
  // valid GeoJSON document. Keep only the JSON object; its hash still records
  // the exact upstream response before this transport cleanup.
  const lastBrace = text.lastIndexOf('}')
  if (lastBrace < 0) throw new Error('Boundary response did not contain a JSON object')
  return JSON.parse(text.slice(0, lastBrace + 1))
}

async function fetchBoundary(contract) {
  const response = await fetch(contract.boundary.sourceUrl, { headers: { Accept: 'application/geo+json, application/json' } })
  if (!response.ok) throw new Error(`${contract.slug} boundary download failed with ${response.status}`)
  const body = await response.text()
  const document = parseGeoJson(body)
  assert.equal(document.type, 'FeatureCollection', `${contract.slug} boundary must be a FeatureCollection`)
  const features = contract.boundary.select(document.features || [])
  const expectedCount = contract.slug === 'paris' ? 20 : 1
  assert.equal(features.length, expectedCount, `${contract.slug} boundary identity did not match ${expectedCount} feature(s)`)
  for (const feature of features) assert(['Polygon', 'MultiPolygon'].includes(feature.geometry?.type), `${contract.slug} boundary geometry must be polygonal`)
  return {
    features,
    receipt: {
      sourceUrl: contract.boundary.sourceUrl,
      landingUrl: contract.boundary.landingUrl,
      authority: contract.boundary.authority,
      license: contract.boundary.license,
      vintage: contract.boundary.vintage,
      semantics: contract.boundary.semantics,
      attribution: contract.boundary.attribution || contract.boundary.authority,
      featureCount: features.length,
      fetchedAt: AS_OF,
      sha256: createHash('sha256').update(body).digest('hex'),
    },
  }
}

function onSegment([x, y], [ax, ay], [bx, by]) {
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
  if (Math.abs(cross) > 1e-10) return false
  return x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by)
}

function inRing(point, ring) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index]
    const previousPoint = ring[previous]
    if (onSegment(point, previousPoint, currentPoint)) return true
    const intersects = ((currentPoint[1] > point[1]) !== (previousPoint[1] > point[1])) &&
      point[0] < ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
        (previousPoint[1] - currentPoint[1]) + currentPoint[0]
    if (intersects) inside = !inside
  }
  return inside
}

function inPolygon(point, polygon) {
  if (!polygon[0] || !inRing(point, polygon[0])) return false
  return polygon.slice(1).every((hole) => !inRing(point, hole))
}

export function pointInGeometry(point, geometry) {
  if (geometry.type === 'Polygon') return inPolygon(point, geometry.coordinates)
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((polygon) => inPolygon(point, polygon))
  return false
}

async function managementQuery(query) {
  if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN is required for the read-only catalogue export')
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!response.ok) throw new Error(`Read-only production query failed with ${response.status}`)
  return response.json()
}

async function fetchCandidates() {
  const names = CITY_CONTRACTS.map(({ databaseName, countryCode }) => `('${databaseName.replaceAll("'", "''")}','${countryCode}')`).join(',')
  const signals = SIGNALS.map((signal) => `'${signal}'`).join(',')
  return managementQuery(`
    with eligible_signals as (
      select sc.name as database_city, sc.country_code, sc.id as city_id,
             pp.id as place_pool_id, pp.google_place_id, pp.name, pp.address,
             pp.lat, pp.lng, pp.rating, pp.review_count, pp.updated_at,
             pp.google_maps_uri, ps.signal_id, ps.score, ps.contributions,
             ps.scored_at, ps.signal_version_id,
             row_number() over (
               partition by sc.id, pp.id
               order by ps.score desc, pp.review_count desc nulls last, ps.signal_id asc
             ) as place_signal_rank
      from public.seeding_cities sc
      join public.place_pool pp on pp.city_id = sc.id
      join public.place_scores ps on ps.place_id = pp.id
      where (sc.name, sc.country_code) in (${names})
        and sc.is_live_for_consumers is true
        and pp.is_servable is true
        and pp.is_active is true
        and pp.deleted_at is null
        and pp.lat is not null and pp.lng is not null
        and pp.stored_photo_urls is not null
        and pg_catalog.array_length(pp.stored_photo_urls, 1) > 0
        and not (pg_catalog.array_length(pp.stored_photo_urls, 1) = 1 and pp.stored_photo_urls[1] = '__backfill_failed__')
        and ps.signal_id in (${signals})
        and ps.score >= case when ps.signal_id = 'movies' then 80 else 120 end
    ), ranked_places as (
      select *, row_number() over (
        partition by city_id
        order by score desc, review_count desc nulls last, place_pool_id asc
      ) as candidate_rank
      from eligible_signals
      where place_signal_rank = 1
    )
    select * from ranked_places
    where candidate_rank <= 3000
    order by database_city, country_code, candidate_rank
  `)
}

function iso(value) {
  return new Date(value).toISOString()
}

function assertTopFifty(slug, places) {
  assert.equal(places.length, 50, `${slug} must have exactly 50 boundary-contained eligible places`)
  assert.equal(new Set(places.map((place) => place.placePoolId)).size, 50, `${slug} places must be unique`)
  for (let index = 1; index < places.length; index += 1) {
    const left = places[index - 1]
    const right = places[index]
    const correctlyOrdered = left.signalScore > right.signalScore ||
      (left.signalScore === right.signalScore && (left.reviewCount ?? -1) > (right.reviewCount ?? -1)) ||
      (left.signalScore === right.signalScore && (left.reviewCount ?? -1) === (right.reviewCount ?? -1) && left.placePoolId.localeCompare(right.placePoolId) <= 0)
    assert(correctlyOrdered, `${slug} ranking order changed at positions ${index} and ${index + 1}`)
  }
}

async function main() {
  assert.match(AS_OF, /^\d{4}-\d{2}-\d{2}$/, '--as-of must be YYYY-MM-DD')
  const [candidates, ...boundaries] = await Promise.all([
    fetchCandidates(),
    ...CITY_CONTRACTS.map(fetchBoundary),
  ])
  const cities = {}
  for (let contractIndex = 0; contractIndex < CITY_CONTRACTS.length; contractIndex += 1) {
    const contract = CITY_CONTRACTS[contractIndex]
    const boundary = boundaries[contractIndex]
    const candidatesForCity = candidates.filter((row) => row.database_city === contract.databaseName && row.country_code === contract.countryCode)
    const inside = candidatesForCity.filter((row) => boundary.features.some((feature) => pointInGeometry([Number(row.lng), Number(row.lat)], feature.geometry)))
    const selected = inside.slice(0, 50).map((row, index) => ({
      kind: 'place',
      rank: index + 1,
      placePoolId: row.place_pool_id,
      googlePlaceId: row.google_place_id,
      name: row.name,
      categorySlug: row.signal_id,
      categoryLabel: CATEGORY_LABELS[row.signal_id],
      signalScore: Number(row.score),
      signalVersionId: row.signal_version_id,
      aiBlended: Number(row.contributions?._ai_blended ?? 0) === 1,
      photoUrls: [],
      mediaReceipt: {
        status: 'no_photo',
        provider: 'Google Places',
        checkedAt: AS_OF,
        reason: 'Provider-cached media is not exported to this durable catalogue without a current, attributable display receipt.',
      },
      rating: row.rating == null ? null : Number(row.rating),
      reviewCount: row.review_count == null ? null : Number(row.review_count),
      oneLiner: null,
      address: row.address,
      lat: Number(row.lat),
      lng: Number(row.lng),
      scoredAt: iso(row.scored_at),
      sourceUpdatedAt: iso(row.updated_at),
      googleMapsUri: row.google_maps_uri,
      boundaryReceipt: { contained: true, boundarySha256: boundary.receipt.sha256 },
    }))
    assertTopFifty(contract.slug, selected)
    cities[contract.slug] = {
      citySlug: contract.slug,
      sourceCityName: contract.databaseName,
      rankingContract: 'top_50_overall_boundary_and_serving_gated',
      candidateCount: candidatesForCity.length,
      boundaryContainedCandidateCount: inside.length,
      boundaryExcludedCandidateCount: candidatesForCity.length - inside.length,
      boundary: boundary.receipt,
      places: selected,
    }
  }

  const orderedCities = Object.fromEntries(CITY_OUTPUT_ORDER.map((slug) => [slug, cities[slug]]))
  const output = {
    schemaVersion: 1,
    generatedAt: AS_OF,
    productionSource: `supabase:${PROJECT_REF}`,
    scoreFloor: { default: 120, movies: 80 },
    ordering: ['signalScore DESC', 'reviewCount DESC NULLS LAST', 'placePoolId ASC'],
    dedupe: 'one row per place, retaining its highest-ranked qualifying Explorer signal',
    mediaPolicy: 'No stock or generated image may stand in for a named place. Provider media needs a current attribution/display receipt; otherwise the truthful state is no_photo.',
    cities: orderedCities,
  }
  const serialized = `${JSON.stringify(output, null, 2)}\n`
  if (WRITE) {
    fs.writeFileSync(OUTPUT, serialized)
    fs.writeFileSync(RECEIPT_OUTPUT, `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: AS_OF,
      cities: Object.fromEntries(Object.entries(orderedCities).map(([slug, city]) => [slug, {
        placeCount: city.places.length,
        uniquePlaceCount: new Set(city.places.map((place) => place.placePoolId)).size,
        boundarySha256: city.boundary.sha256,
        boundaryFetchedAt: city.boundary.fetchedAt,
        boundarySourceUrl: city.boundary.sourceUrl,
        boundaryLandingUrl: city.boundary.landingUrl,
        boundaryAuthority: city.boundary.authority,
        boundaryLicense: city.boundary.license,
        mediaCurrentCount: city.places.filter((place) => place.mediaReceipt.status === 'current').length,
        noPhotoCount: city.places.filter((place) => place.mediaReceipt.status === 'no_photo').length,
        justInTimeMediaEligibleCount: city.places.filter((place) => Boolean(place.googlePlaceId)).length,
      }])),
    }, null, 2)}\n`)
  }
  process.stdout.write(`${WRITE ? 'WROTE' : 'VALID'} ten city catalogues: ${Object.keys(orderedCities).length} cities, ${Object.values(orderedCities).reduce((sum, city) => sum + city.places.length, 0)} ranked places\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
