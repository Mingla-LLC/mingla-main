/**
 * ORCH-1028 §F.2 — tester ADVERSARIAL regression test (launch-city gate).
 *
 * Attacks a DIFFERENT angle than the implementor's happy-path test
 * (useLaunchCityGate.test.ts): instead of confirming the two success branches +
 * the override key-set, this hammers the FAILURE / DEGRADED / HOSTILE-INPUT
 * surface that the gate's safety contract depends on:
 *
 *   - permission-denied / missing coords → the gate is never invoked without
 *     finite coords (areCoordsValid is the guard the wrapper checks BEFORE any
 *     network call). E-1 / I-1028-GATE-AFTER-CAPTURE.
 *   - zero live cities → {status:'no_live_cities'} (the proceed-with-GPS path,
 *     E-3 / SC-9), regardless of the inLaunchCity flag.
 *   - transport error / 500 / malformed / partial / null / non-array body →
 *     {status:'check_failed'} and resolveLaunchGate NEVER throws (A.1
 *     never-throws contract / SC-8). The location step must always get a
 *     terminal result so it can branch instead of stranding the user.
 *   - hostile / corrupt city rows → filtered out; the gate degrades to
 *     no_live_cities rather than emitting a malformed override later.
 *   - the override builder coerces nothing dangerous and still emits EXACTLY
 *     the four owner-of-truth keys for adversarial city shapes
 *     (I-1028-ONE-LOCATION-OWNER / SC-10 supporting invariant).
 *
 * Runs under Node's built-in test runner with type-stripping (no jest):
 *   node --experimental-strip-types --test src/hooks/__tests__/useLaunchCityGate.adversarial.test.ts
 *
 * It targets the dependency-free decision core `launchCityGateLogic.ts`. The
 * network wrapper `checkLaunchCity` (useLaunchCityGate.ts) cannot load under
 * Node (it imports the RN supabase client); it is a thin try/catch + 6s-timeout
 * shell that DELEGATES every decision to resolveLaunchGate and converts any
 * throw/timeout into {status:'check_failed'}. So exhaustively proving
 * resolveLaunchGate never throws + always returns a terminal status is the
 * load-bearing guarantee behind the wrapper's never-throws contract.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// The explicit .ts extension is REQUIRED by Node's strip-types runtime (this app
// has no jest); tsc's allowImportingTsExtensions is off repo-wide.
// prettier-ignore
// @ts-expect-error -- runtime .ts import for `node --experimental-strip-types`
import { resolveLaunchGate, buildLaunchCityOverride, areCoordsValid, type LaunchCityWithBbox } from '../launchCityGateLogic.ts'

const VALID_STATUSES = new Set(['in_city', 'out_of_city', 'no_live_cities', 'check_failed'])

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

// ── E-1 / I-1028-GATE-AFTER-CAPTURE: permission-denied → no network call ──
// The wrapper guards on areCoordsValid BEFORE supabase.invoke. A permission
// denial means no GPS fix → no finite coords → the guard rejects and the gate
// short-circuits to check_failed WITHOUT a network call. Prove the guard rejects
// every shape a denied/absent capture can produce.
test('permission-denied / no-fix coords are rejected by the pre-network guard (no edge call)', () => {
  // undefined / null (no coordinates object hydrated)
  assert.equal(areCoordsValid(undefined as unknown, undefined as unknown), false)
  assert.equal(areCoordsValid(null as unknown, null as unknown), false)
  // NaN/Infinity (a failed/aborted GPS read)
  assert.equal(areCoordsValid(NaN, NaN), false)
  assert.equal(areCoordsValid(Infinity, -Infinity), false)
  // 0,0 is technically finite/in-range — the null-island — but a real denied
  // capture yields undefined coords, not 0,0; assert the finite guard still
  // passes 0,0 (documents that 0,0 is NOT special-cased; the wrapper relies on
  // the capture never producing 0,0 on denial — it produces undefined).
  assert.equal(areCoordsValid(0, 0), true)
  // out-of-range garbage from a corrupt sensor read
  assert.equal(areCoordsValid(91, 0), false)
  assert.equal(areCoordsValid(-91, 0), false)
  assert.equal(areCoordsValid(0, 181), false)
  assert.equal(areCoordsValid(0, -181), false)
  // wrong types entirely
  assert.equal(areCoordsValid({} as unknown, [] as unknown), false)
  assert.equal(areCoordsValid('51.5' as unknown, '-0.12' as unknown), false)
})

// ── E-3 / SC-9: zero live cities → no_live_cities (proceed-with-GPS path) ──
test('zero live cities → no_live_cities even when inLaunchCity is falsely true', () => {
  // inLaunchCity:false, empty list — the canonical degraded case
  assert.equal(resolveLaunchGate({ inLaunchCity: false, matchedCity: null, liveCities: [] }).status, 'no_live_cities')
  // Adversarial: a backend that claims inLaunchCity:true but ships ZERO cities
  // must STILL degrade to no_live_cities (you cannot be "in" a city that the
  // same response says doesn't exist) — never in_city with an empty list.
  assert.equal(
    resolveLaunchGate({ inLaunchCity: true, matchedCity: { id: 'x', name: 'X', center_lat: 1, center_lng: 2 }, liveCities: [] }).status,
    'no_live_cities'
  )
})

// ── E-3 (corrupt rows): a list of only-malformed cities collapses to empty ──
test('a liveCities array of only-corrupt rows is filtered to empty → no_live_cities (no malformed override survives)', () => {
  const corrupt = [
    { id: 'a', name: 'A', center_lat: 'nope', center_lng: 5 }, // non-finite lat
    { id: 'b', center_lat: 1, center_lng: 2 }, // missing name
    { name: 'C', center_lat: 1, center_lng: 2 }, // missing id
    null,
    undefined,
    42,
    'city',
    { id: 'd', name: 'D', center_lat: NaN, center_lng: 2 }, // NaN lat
    { id: 'e', name: 'E', center_lat: 1, center_lng: Infinity }, // Infinity lng
  ]
  const r = resolveLaunchGate({ inLaunchCity: false, matchedCity: null, liveCities: corrupt })
  assert.equal(r.status, 'no_live_cities')
})

test('one valid city among corrupt rows survives the filter → out_of_city with only the valid city', () => {
  const mixed = [null, { id: 'x', name: '', center_lat: 'bad', center_lng: 1 }, london, 99]
  const r = resolveLaunchGate({ inLaunchCity: false, matchedCity: null, liveCities: mixed })
  assert.equal(r.status, 'out_of_city')
  if (r.status !== 'out_of_city') return
  assert.equal(r.liveCities.length, 1)
  assert.equal(r.liveCities[0].id, 'lon')
})

// ── E-2 / SC-8: network/500/timeout/malformed → check_failed, NEVER throws ──
test('transport error → check_failed (never throws)', () => {
  // A Supabase transport error object (the wrapper passes invoke()'s `error`).
  assert.doesNotThrow(() => {
    const r = resolveLaunchGate(null, new Error('Failed to fetch'))
    assert.equal(r.status, 'check_failed')
  })
  // A non-2xx surfaced as a truthy error of any shape.
  assert.equal(resolveLaunchGate({ inLaunchCity: true, liveCities: [london] }, { status: 500 }).status, 'check_failed')
  assert.equal(resolveLaunchGate(undefined, 'boom').status, 'check_failed')
})

test('malformed / partial / wrong-typed bodies → check_failed (never throws)', () => {
  const hostileBodies: unknown[] = [
    null,
    undefined,
    {}, // missing both fields
    { inLaunchCity: true }, // missing liveCities
    { liveCities: [london] }, // missing inLaunchCity
    { inLaunchCity: 'yes', liveCities: [london] }, // inLaunchCity not a boolean
    { inLaunchCity: true, liveCities: 'not-an-array' }, // liveCities not an array
    { inLaunchCity: true, liveCities: null },
    { inLaunchCity: 1, liveCities: [] }, // numeric truthy, not boolean
    'a string body',
    42,
    [], // an array instead of an object
    true,
  ]
  for (const body of hostileBodies) {
    assert.doesNotThrow(() => {
      const r = resolveLaunchGate(body)
      assert.equal(r.status, 'check_failed', `body ${JSON.stringify(body)} should be check_failed`)
    }, `resolveLaunchGate threw on hostile body: ${JSON.stringify(body)}`)
  }
})

test('resolveLaunchGate ALWAYS returns one of the four terminal statuses (fuzz, never throws)', () => {
  const fuzz: unknown[] = [
    Symbol('x'),
    () => {},
    new Map(),
    new Set([1, 2]),
    { inLaunchCity: true, matchedCity: undefined, liveCities: [london] },
    { inLaunchCity: false, matchedCity: { id: 'lon', name: 'London', center_lat: 51.5, center_lng: -0.1 }, liveCities: [london] }, // false + matchedCity present → out_of_city (matchedCity ignored when not in-city)
    { inLaunchCity: true, matchedCity: null, liveCities: [london] }, // true but NO matchedCity → falls through to out_of_city
  ]
  for (const body of fuzz) {
    let result: { status: string } | undefined
    assert.doesNotThrow(() => {
      result = resolveLaunchGate(body)
    }, `threw on fuzz input: ${String(body)}`)
    assert.ok(result && VALID_STATUSES.has(result.status), `non-terminal status for ${String(body)}: ${result?.status}`)
  }
})

test('inLaunchCity:true WITHOUT a matchedCity does NOT claim in_city — degrades to out_of_city (no crash on missing match)', () => {
  // The reassurance/picker path is safer than a phantom "in_city" that has no
  // city object to anchor the deck. SC-2 boundary.
  const r = resolveLaunchGate({ inLaunchCity: true, matchedCity: null, liveCities: [london] })
  assert.equal(r.status, 'out_of_city')
})

// ── SC-10 support: the override builder is total + emits ONLY the 4 keys for
//    adversarial city shapes (extra props, missing-but-typed, weird names) ──
test('buildLaunchCityOverride ignores extra/foreign props and emits EXACTLY the four owner-of-truth keys', () => {
  const hostileCity = {
    id: 'lon',
    name: 'London',
    center_lat: 51.5074,
    center_lng: -0.1278,
    // adversarial extras a future contract drift might add — must NOT leak:
    discover_city_id: 'SHOULD_NOT_APPEAR',
    discover_city_name: 'SHOULD_NOT_APPEAR',
    use_gps_location: true, // a hostile pre-set that must be overridden to false
    bbox_sw_lat: 1,
  } as unknown as Parameters<typeof buildLaunchCityOverride>[0]
  const override = buildLaunchCityOverride(hostileCity)
  assert.deepEqual(Object.keys(override).sort(), ['custom_lat', 'custom_lng', 'custom_location', 'use_gps_location'])
  // use_gps_location is ALWAYS forced false — never inherits the city's hostile value.
  assert.equal(override.use_gps_location, false)
  // No discover_* leaks regardless of source shape (I-1028-ONE-LOCATION-OWNER).
  for (const k of Object.keys(override)) {
    assert.ok(!k.startsWith('discover'), `leaked key: ${k}`)
  }
  assert.equal(override.custom_location, 'London')
  assert.equal(override.custom_lat, 51.5074)
  assert.equal(override.custom_lng, -0.1278)
})

test('buildLaunchCityOverride carries through a city with an empty / unusual name without throwing', () => {
  // A degenerate but finite city — the builder must be total (write contract is
  // enforced by the picker only offering filtered cities, but the builder must
  // not crash on a thin shape).
  const override = buildLaunchCityOverride({ id: 'z', name: '', center_lat: 0, center_lng: 0 })
  assert.equal(override.custom_location, '')
  assert.equal(override.custom_lat, 0)
  assert.equal(override.custom_lng, 0)
  assert.equal(override.use_gps_location, false)
})
