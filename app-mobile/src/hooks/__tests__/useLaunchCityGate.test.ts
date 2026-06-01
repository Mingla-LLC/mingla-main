/**
 * ORCH-1028 §F.1 — implementor happy-path regression test (launch-city gate).
 *
 * Runs under Node's built-in test runner with type-stripping (no jest in this app):
 *   node --experimental-strip-types --test src/hooks/__tests__/useLaunchCityGate.test.ts
 * (wrapper: `npm run test:orch-1028` → scripts/ci/orch-1028-launch-city-gate-check.mjs)
 *
 * Targets the dependency-free decision core `launchCityGateLogic.ts` (the network
 * wrapper just adds supabase.invoke + a 6s timeout). Asserts:
 *  - in-city → frictionless ({status:'in_city'})
 *  - out-of-city → must-pick ({status:'out_of_city'})
 *  - the override write key-set on pick is EXACTLY the four custom_ + use_gps_location
 *    fields and contains NO discover_city_ keys (I-1028-ONE-LOCATION-OWNER).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// The explicit .ts extension is REQUIRED by Node's strip-types runtime (this app
// has no jest); tsc's allowImportingTsExtensions is off repo-wide, so this one
// runtime-only test import is suppressed. The module under test is fully typed.
// prettier-ignore
// @ts-expect-error -- runtime .ts import for `node --experimental-strip-types`
import { resolveLaunchGate, buildLaunchCityOverride, areCoordsValid, type LaunchCityWithBbox } from '../launchCityGateLogic.ts'

const cityWithBbox = (id: string, name: string, lat: number, lng: number): LaunchCityWithBbox => ({
  id,
  name,
  center_lat: lat,
  center_lng: lng,
  bbox_sw_lat: lat - 0.1,
  bbox_sw_lng: lng - 0.1,
  bbox_ne_lat: lat + 0.1,
  bbox_ne_lng: lng + 0.1,
})

const london = cityWithBbox('lon', 'London', 51.5074, -0.1278)
const lagos = cityWithBbox('lag', 'Lagos', 6.5244, 3.3792)

test('in-city → frictionless (status in_city, matchedCity + liveCities returned)', () => {
  const result = resolveLaunchGate({
    inLaunchCity: true,
    matchedCity: { id: 'lon', name: 'London', center_lat: 51.5074, center_lng: -0.1278 },
    liveCities: [london, lagos],
  })
  assert.equal(result.status, 'in_city')
  if (result.status !== 'in_city') return
  assert.equal(result.matchedCity.id, 'lon')
  assert.equal(result.matchedCity.name, 'London')
  assert.equal(result.liveCities.length, 2)
})

test('out-of-city → must-pick (status out_of_city with >=1 live city)', () => {
  const result = resolveLaunchGate({
    inLaunchCity: false,
    matchedCity: null,
    liveCities: [london],
  })
  assert.equal(result.status, 'out_of_city')
  if (result.status !== 'out_of_city') return
  assert.equal(result.liveCities.length, 1)
  assert.equal(result.liveCities[0].id, 'lon')
})

test('override write on pick is EXACTLY the four keys, no discover_city_* (I-1028-ONE-LOCATION-OWNER)', () => {
  const override = buildLaunchCityOverride({
    id: 'lon',
    name: 'London',
    center_lat: 51.5074,
    center_lng: -0.1278,
  })
  // Exact key-set — adding/removing a key fails this test.
  assert.deepEqual(Object.keys(override).sort(), [
    'custom_lat',
    'custom_lng',
    'custom_location',
    'use_gps_location',
  ])
  assert.equal(override.custom_lat, 51.5074)
  assert.equal(override.custom_lng, -0.1278)
  assert.equal(override.custom_location, 'London')
  assert.equal(override.use_gps_location, false)
  // NO discover_city_* fields written.
  for (const k of Object.keys(override)) {
    assert.ok(!k.startsWith('discover_city'), `unexpected discover_city key: ${k}`)
  }
})

test('coordinate guard rejects non-finite / out-of-range coords (no network)', () => {
  assert.equal(areCoordsValid(51.5, -0.12), true)
  assert.equal(areCoordsValid(NaN, 0), false)
  assert.equal(areCoordsValid(0, Infinity), false)
  assert.equal(areCoordsValid(95, 0), false) // lat > 90
  assert.equal(areCoordsValid(0, 200), false) // lng > 180
  assert.equal(areCoordsValid('51' as unknown, 0), false)
})
