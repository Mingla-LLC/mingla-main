# IMPLEMENT — ORCH-1148 Consumer realtime freshness (venue reservation config)

**Branch:** `ORCH-1148-venue-e2e-validation` (was exactly at `origin/main` `8d1f5ce94`; no rebase needed)
**Surface:** consumer app `app-mobile` (runtime 1.1.0). **Scope:** caching/refetch policy ONLY — no engine, edge-fn, or reserve-flow logic touched.
**Goal (Seth, verbatim):** "make sure changes that the business makes update in real time for the user."

## The gap (proven)
When an operator changes venue reservation config (enable/disable reservations, fee, currency, tables, availability), the consumer venue card must reflect it promptly. The gate hook `useVenueReservable.ts` — which shows/hides "Reserve a table" and carries `brand_id` + `currency`, calling `pg_venue_reservable_for_place` — cached for **5 minutes** (`staleTime: 5*60*1000`, `gcTime: 10min`). So enabling reservations or changing the fee on the business side was **invisible to the consumer for up to 5 minutes**. This was the main culprit.

`useVenueAvailability.ts` (slots, `pg_venue_available_slots`) was already short-stale (30s) but its "refetch on focus" was only a code comment — the `refetchOnWindowFocus` flag was never actually set.

## Before / after

### `app-mobile/src/hooks/useVenueReservable.ts`
| setting | before | after |
|---|---|---|
| `staleTime` | `5 * 60 * 1000` (5 min) | `0` (always re-check) |
| `gcTime` | `10 * 60 * 1000` | `60 * 1000` |
| `refetchOnMount` | (default) | `"always"` |
| `refetchOnWindowFocus` | (default false) | `true` |

### `app-mobile/src/hooks/useVenueAvailability.ts`
| setting | before | after |
|---|---|---|
| `staleTime` | `30 * 1000` | `30 * 1000` (unchanged) |
| `gcTime` | `60 * 1000` | `60 * 1000` (unchanged) |
| `refetchOnWindowFocus` | (comment only, flag missing) | `true` (added) |

## Why this makes business changes propagate
- `staleTime: 0` + `refetchOnMount: "always"` → **every venue-card expand** re-pulls `pg_venue_reservable_for_place` live, so a just-enabled reservation / new fee / new currency appears immediately (no minutes-long cache). The RPC is cheap and anon-safe (SECURITY DEFINER, returns only `{reservable, brand_id, currency}`), so re-checking on each open is safe.
- `refetchOnWindowFocus: true` on both hooks → returning to the app (or back to the slot step) re-pulls reservability AND live remaining-capacity slots.
- A small `gcTime` (60s) keeps memory bounded while still allowing instant re-render of the last value before the fresh fetch resolves.

## Test + fails-on-revert
New gate: `app-mobile/src/hooks/__tests__/orch_1148_consumer_realtime_freshness.test.ts` (node:assert source-structure idiom, matching `orch_1138_consumer_trip_brand_cover.test.ts`; comments stripped so assertions bite on real code only).

- 6 checks PASS (A1–A4 reservable: staleTime 0, no `N*60*1000` cache, `refetchOnMount:"always"`, `refetchOnWindowFocus:true`; B1–B2 availability: ≤30s stale + `refetchOnWindowFocus:true`).
- **Fails-on-revert PROVEN**: stashing the two hook edits back to the pre-fix baseline (commit `6074cb19f`, `staleTime: 5*60*1000`) → test exits **1** at `A1` ("must be staleTime 0"). Restored cleanly.

## Gates
- **eslint** on `useVenueReservable.ts`, `useVenueAvailability.ts`, and the new test → exit 0 (clean).
- **tsc** (`tsc --noEmit -p tsconfig.json`): 441 errors both at baseline (changes stashed) and with changes — **zero new errors**. All 441 are pre-existing and live in `../packages/phone-input/` (node_modules-symlink artifacts), none reference the touched files.
- New gate test → 6/6 PASS; fails-on-revert exit 1.

## Files changed (committed)
- `app-mobile/src/hooks/useVenueReservable.ts`
- `app-mobile/src/hooks/useVenueAvailability.ts`
- `app-mobile/src/hooks/__tests__/orch_1148_consumer_realtime_freshness.test.ts`

NOT deployed, NOT merged. No engine/edge/flow logic changed.
