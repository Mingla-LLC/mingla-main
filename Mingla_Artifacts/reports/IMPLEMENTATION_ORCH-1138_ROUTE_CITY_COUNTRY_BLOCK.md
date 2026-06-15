# IMPLEMENTATION — ORCH-1138 [trip-page-redesign] — Route block: "City, Country" + single aligned row

**Branch:** `ORCH-1138-trip-page-redesign`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/`
**HEAD at completion:** `3f30313525569d7689b85509aa3257bf85d4b7aa`
**Rebased onto origin/main:** yes (was 11 behind; clean fast-forward rebase to `8f9fe7baa`).
**Status:** implemented and verified (jest green + fails-on-revert proven; on-device render UNVERIFIED — needs sim/device eyeball).

---

## 1. Summary

Seth device feedback: on the trip page the "Leaving from / Destination" addresses were
too long and ragged, and the two legs could wrap to different heights. Two fixes,
applied to BOTH the business/web trip page and the consumer trip page:

- **Fix 1 — standardize to "City, Country".** New shared pure normalizer
  `normalizeCityCountry` turns a departure/destination value into exactly
  "City, Country" (e.g. `Raleigh, North Carolina, United States` → `Raleigh, USA`;
  `Washington DC, District of Columbia, United States` → `Washington DC, USA`;
  `Positano, Province of Salerno, Italy` → `Positano, Italy`; airport noise stripped
  via structured fields or free text → `Naples, Italy`). US country/state variants
  collapse to `USA`; other countries keep their common name. Unresolvable → `null`,
  so the leg is hidden (rule 9, no fabrication).
- **Fix 2 — always one aligned row.** Both route blocks already used a row of two
  `flex:1 / minWidth:0` columns; added `numberOfLines={1}` + `ellipsizeMode="tail"`
  to the place text on each leg so a long city truncates rather than wrapping the
  row — both legs stay balanced on a single line, native + web.

The trip payload carries NO structured Mapbox city/country string fields (only
free-text `*LocationText`/`*Text` + placeId + lat/lng — verified against
`TripBusinessTrip` and `ConsumerTripDetail`), so the normalizer parses the free text.
The optional structured-field PREFER path is wired and tested for a future caller.

---

## 2. SPEC success-criteria coverage

(No dedicated SPEC file — this was a direct Seth device-feedback dispatch; criteria
are the dispatch's FIX-1 / FIX-2 / HARD GUARDS.)

| Criterion | Met | Evidence (commit `3f303135`) |
|---|---|---|
| SC-1 Shared normalizer (reuse, don't fork) | ✓ | `packages/offering-rendering/normalizeCityCountry.ts` + exported from `index.ts`; imported by BOTH surfaces |
| SC-2 PREFER structured city/country when present | ✓ | `StructuredPlaceParts` arg short-circuits parsing; test "structured fields are PREFERRED" |
| SC-3 Else parse free text → City, Country | ✓ | free-text branch; tests for Raleigh/DC/Positano/Naples |
| SC-4 US → "USA"; other countries common name | ✓ | `COUNTRY_ALIASES`; test "US country aliases all collapse to 'USA'" |
| SC-5 Strip airport codes / street / region | ✓ | `stripAirportNoise` + `looksLikeStreetLine` + region-drop; tests for NAP + street line |
| SC-6 City-only → city; nothing → hide (rule 9) | ✓ | returns city-only / `null`; tests cover both |
| SC-7-Biz Applied to departure + destination (business/web) | ✓ | `TripPreview.tsx` FOUNDATION block + LEGACY wizard meta-rows |
| SC-7-Consumer Applied (consumer app) | ✓ | `useConsumerTripFoundation.ts` route adapter |
| SC-8 Same line, no wrap, balanced | ✓ | `numberOfLines={1}` + `ellipsizeMode="tail"` on both legs both surfaces; existing `flex:1/minWidth:0` |
| SC-9 No schema/edge/checkout change | ✓ | zero files under `supabase/`; no service/query change |
| SC-10 Regression test + fails-on-revert | ✓ | `routeCityCountry.orch1138.test.ts` (15 tests); fails-on-revert proven (§6) |
| SC-11 No new dependency | ✓ | pure TS, no imports |

---

## 3. Files changed

| File | Δ | What |
|---|---|---|
| `packages/offering-rendering/normalizeCityCountry.ts` | +~215 (new) | the shared normalizer |
| `packages/offering-rendering/index.ts` | +8 | export `normalizeCityCountry` + `StructuredPlaceParts` |
| `mingla-business/src/components/trip/TripPreview.tsx` | ~+45/-15 | import + normalize departure/destination; FOUNDATION block + LEGACY meta-rows use normalized values + `numberOfLines={1}`/ellipsis |
| `app-mobile/src/hooks/useConsumerTripFoundation.ts` | ~+12/-3 | import + normalize both route legs in the adapter |
| `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | ~+8 | `numberOfLines={1}` + `ellipsizeMode="tail"` on both route legs |
| `mingla-business/src/components/trip/__tests__/routeCityCountry.orch1138.test.ts` | +~170 (new) | regression test |

---

## 4. Data-model changes applied

None. No migration, no schema, no RLS, no column. (HARD GUARD honored.)

## 5. Edge functions touched

None. (HARD GUARD honored.)

---

## 6. Regression tests added

**Path:** `mingla-business/src/components/trip/__tests__/routeCityCountry.orch1138.test.ts`
(15 tests; discovered by the default `mingla-business/jest.config.cjs`; imports the
pure normalizer by relative path — same precedent as `createThemePalette.parity.orch1138.test.ts`.)

Passing run:
```
PASS src/components/trip/__tests__/routeCityCountry.orch1138.test.ts
Tests:       15 passed, 15 total
```

**fails-on-revert verified at `3f30313525569d7689b85509aa3257bf85d4b7aa`** — by TRUE LINE DELETION (not comment-out):
- Deleted the USA `COUNTRY_ALIASES` entries → 4 normalizer tests FAILED (Raleigh/DC/aliases/street). Restored → 15 pass.
- Deleted `numberOfLines={1}`+`ellipsizeMode` from the FOUNDATION route block in `TripPreview.tsx` → the "TripPreview routePlace is numberOfLines={1} + ellipsis" assertion FAILED. Restored → 15 pass.

---

## 7. Old → New receipts

### packages/offering-rendering/normalizeCityCountry.ts (NEW)
**Before:** no shared route-leg normalizer existed; both surfaces rendered the raw
free-text address.
**Now:** pure function `normalizeCityCountry(freeText, structured?)` → "City, Country"
| "City" | null. USA-collapse, US-state→USA inference, airport/street/region strip,
structured-field PREFER path.
**Why:** FIX-1 (standardize) + reuse (one normalizer, both surfaces).

### packages/offering-rendering/index.ts
**Before:** exported the layout primitives only.
**Now:** also exports `normalizeCityCountry` + `StructuredPlaceParts`.
**Why:** both apps import the normalizer from the shared package.

### mingla-business/src/components/trip/TripPreview.tsx
**Before:** FOUNDATION route block rendered raw `bt.departureLocationText` /
`bt.destinationLocationText`; place text had no line limit (could wrap). LEGACY
wizard meta-rows rendered raw text at `numberOfLines={2}`.
**Now:** computes `departureCityCountry`/`destinationCityCountry` via the normalizer;
FOUNDATION block gates + renders the normalized values with `numberOfLines={1}` +
`ellipsizeMode="tail"`; LEGACY meta-rows render `legacyDeparture`/`legacyDestination`
at `numberOfLines={1}` (Fix-1 applies; the legacy vertical layout is not the
same-line block so Fix-2 layout is N/A there).
**Why:** FIX-1 + FIX-2 on the business/web public trip page (+ parity on the wizard preview).
**Lines:** ~+45 / -15.

### app-mobile/src/hooks/useConsumerTripFoundation.ts
**Before:** `route` carried the raw `detail.departureText` / `detail.destinationText`.
**Now:** normalizes both into `departureCityCountry`/`destinationCityCountry` and the
`route` is built from those (null legs hidden). `heroEyebrow` intentionally keeps the
raw destination (only the route BLOCK is standardized, per Seth's request).
**Why:** FIX-1 on the consumer surface, in the adapter so the render stays clean.
**Lines:** ~+12 / -3.

### app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx
**Before:** route place text had no line limit (could wrap, making legs uneven).
**Now:** `numberOfLines={1}` + `ellipsizeMode="tail"` on both legs.
**Why:** FIX-2 single aligned row, parity with TripPreview.
**Lines:** ~+8.

---

## 8. Cross-surface impact table

| Surface | Affected | What changes / why not | Parity |
|---|---|---|---|
| Consumer iOS | YES | trip detail route legs now "City, Country" on one row | shared normalizer (auto) |
| Consumer Android | YES | same | shared normalizer (auto) |
| Buyer/anonymous Web (mingla-business `/t/...`) | YES | public trip page FOUNDATION route legs now "City, Country" on one row | shared normalizer (auto) |
| Business iOS | YES | wizard Step-5 preview meta-rows shortened to "City, Country" | same component |
| Business Android | YES | same | same component |
| Admin Web | NO | does not render the trip route block | — |
| Business Web preview | YES | same `/t/...` render as buyer web | shared component |

Parity is **automatic** — one normalizer, imported by both render paths; no manual
per-app fork.

---

## 9. Smoke result

- `npx jest routeCityCountry.orch1138` → 15/15 PASS (and example inputs sanity-checked
  inside the test: `Raleigh, North Carolina, United States`→`Raleigh, USA`,
  structured `Naples`/`Italy`→`Naples, Italy`, free-text `Naples Intl (NAP), Italy`→
  `Naples, Italy`).
- `tsc --noEmit` (mingla-business AND app-mobile): zero errors in any of the 6 changed
  files (the pre-existing packages/* "Cannot find module 'react'" noise on ChipGroup/
  CountAwareGallery/PhoneInput is unrelated config drift, not introduced here).
- Strict-grep: META-ORCH-0827 package-isolation PASS; I-PROPOSED-TRIP-CANONICAL-COLUMNS
  PASS (2298 files, 0 violations); ORCH-0963 public-trip RPC/route segregation 2/2 PASS.
- Adjacent: `offeringRenderingIsolation.orch1138` PASS, `createThemePalette.parity.orch1138` PASS.
- **On-device render: UNVERIFIED** — needs a sim/device eyeball of a real trip page on a
  narrow phone width to confirm the single-row truncation looks right (tester job).

---

## 10. Known issues / deferred

- The free-text parser is heuristic. For trip departure/destination values (place/city
  names) it is correct on the spec examples; a pathological multi-region address where
  the locality is neither parts[0] nor adjacent to the state/country could mis-pick the
  city. Structured fields (PREFER path) sidestep this entirely if a future leg wires
  Mapbox structured city/country onto the trip payload.
- `looksLikeStreetLine` skips a leading street line so the next part is used as the city
  (e.g. `123 Glenwood Ave, Raleigh, NC, USA` → `Raleigh, USA`).

## 11. Operator action required

- **Migration db push:** none.
- **Edge-fn deploy:** none.
- **OTA:** this is a pure-JS change to consumer (`app-mobile`) + business/web
  (`mingla-business`). After merge, an OTA is needed for the native consumer + business
  apps to pick it up (web ships via Vercel). ⚠️ COMMS-0027 (ALL/WARN): publish per-
  platform from a clean detached checkout with isolated TMPDIR — do NOT concurrent-OTA
  from symlinked worktrees (poisons the shared Metro/Haste cache). Not the implementor's
  to run.

## 12. Discoveries for Orchestrator

- **Pre-existing failing test (NOT mine):** `mingla-business/src/components/offering/__tests__/OfferingParity.test.ts`
  → "trip + experience Hub lists pass onManageOpen" fails on the CLEAN tree
  (`git stash` confirmed: fails without my changes). It expects `<OfferingManageSheet`
  in the Hub trips/experiences list route files, which currently render `TripListCard`/
  filter pills instead. Unrelated to this dispatch (a different ORCH-1138 leg's file).
  Register + dispatch separately.
- COMMS ledger: no BLOCK+OPEN entries addressed to me / ORCH-1138 / ALL. Acked the
  ALL/WARN entries (COMMS-0027 OTA-cache noted above; COMMS-0003/0004/0011/0015 not
  applicable to a UI normalizer). No new cross-ORCH discovery to write.
