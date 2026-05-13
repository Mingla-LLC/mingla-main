# IMPLEMENTATION — ORCH-0816 — Brand KPI tile: real 7-day window + freshness signals

**Status:** implemented and verified (unit + TypeScript + strict-grep). Live-fire T-15 awaits operator.
**Date:** 2026-05-12.
**Owner:** Claude `mingla-implementor` (operator delegated from `mingla-orchestrator`).
**Spec:** [Mingla_Artifacts/specs/SPEC_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md](Mingla_Artifacts/specs/SPEC_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md)
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md)
**Working tree:** /Users/sethogieva/Desktop/mingla-main on branch Seth.

---

## 1. Summary

Implemented per spec without deviation. Three coordinated changes:

1. **Honest label.** The home-screen "Last 7 days" tile now binds to a real windowed field (`stats.rev7d`) computed from `orders.created_at >= now - 7d`. BrandProfileView's "GMV / all time" tile unchanged (still lifetime).
2. **Faster cache.** `useBrands` / `useBrand` staleTime dropped from 5 min → 30 s.
3. **Realtime + pull-to-refresh.** New `postgres_changes` subscription on `orders` mirroring `useBrandStripeBankVerification` verbatim, RefreshControl on both ScrollViews, and a migration adding `public.orders` to the `supabase_realtime` publication.

CI gate `orch-0816-last-7-days-binds-rev7d.mjs` added so the binding cannot silently regress.

---

## 2. Old → New receipts

### `supabase/migrations/20260602000004_orch_0816_orders_realtime_publication.sql` (CREATED)
**Before:** `public.orders` not in `supabase_realtime` publication — `postgres_changes` subscribers silently never delivered.
**After:** `ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;`. RLS unchanged. Filename `20260602000004` is monotonic > the latest existing prefix `20260602000003` (ORCH-0815 Phase A).
**Why:** SPEC §3.1 (F-3 fix). Required for SC-3, SC-7.
**Lines:** 11.

### `mingla-business/src/types/brand.ts` (MODIFIED)
**Before:** `BrandStats` had `events / followers / rev / attendees`.
**After:** Added `rev7d: number` between `rev` and `attendees`. Doc comment on `rev` clarifies it is the lifetime field.
**Why:** SPEC §5. Required for SC-1, SC-10.
**Lines:** +3.

### `mingla-business/src/services/brandsService.ts` (MODIFIED)
**Before:** `OrderStatsRow` had no `created_at`. `BrandStatsAggregate` had only `revByCurrencyCents`. `aggregateBrandStatsByBrandIds` had no date filter. `pickRevForCurrency` was the only currency picker.
**After:**
- `OrderStatsRow.created_at: string | null` added.
- `BrandStatsAggregate.rev7dByCurrencyCents: Map<string, number>` added.
- `SEVEN_DAYS_MS` constant added.
- `aggregateBrandStatsByBrandIds` now selects `created_at` and buckets each order into both lifetime and 7-day maps in one pass.
- `pickRev7dForCurrency` added, mirrors `pickRevForCurrency`.
- Both `getBrands` and `getBrand` consumers populate `stats.rev7d` via the new picker.
**Why:** SPEC §4.1. Required for SC-1, SC-2.
**Lines:** ~+30.

### `mingla-business/src/services/brandMapping.ts` (MODIFIED)
**Before:** `EMPTY_BRAND_STATS` lacked `rev7d`.
**After:** `rev7d: 0` added.
**Why:** SPEC §5 fan-out. Required for SC-10.
**Lines:** +1.

### `mingla-business/src/hooks/useBrands.ts` (MODIFIED)
**Before:** `STALE_TIME_MS = 5 * 60 * 1000`. No realtime subscription. Optimistic temp brand initializer lacked `rev7d`. No import of `useEffect` / `supabase` / `eventOrdersKeys`.
**After:**
- `STALE_TIME_MS = 30 * 1000` with ORCH-0816 rationale comment.
- Added imports: `useEffect`, `supabase`, `eventOrdersKeys`.
- `useBrands(accountId)` adds a `useEffect` subscribing to `postgres_changes` on `public.orders`, invalidating `brandKeys.all` + `eventOrdersKeys.all` on each event. RLS gates delivery; pattern mirrors `useBrandStripeBankVerification` verbatim.
- `useBrand(brandId)` adds the same subscription scoped per brand, invalidating `brandKeys.detail(brandId)` + `eventOrdersKeys.all`.
- Optimistic temp brand initializer now includes `rev7d: 0`.
**Why:** SPEC §6.1. Required for SC-3, SC-6, SC-8, SC-9.
**Lines:** ~+50.

### `mingla-business/app/(tabs)/home.tsx` (MODIFIED)
**Before:** Imported `useBrands` only; no `useQueryClient`; no `RefreshControl`. "Last 7 days" tile bound to `currentBrand.stats.rev` (lifetime).
**After:**
- Imports: added `RefreshControl` from `react-native`, `useQueryClient` from `@tanstack/react-query`, `brandKeys` (now named with `useBrands`), `eventOrdersKeys`.
- `HomeTab` body: added `queryClient`, `isRefreshing` state, `handleRefresh` callback that invalidates `brandKeys.all` + `eventOrdersKeys.all`.
- ScrollView: `refreshControl` prop wired.
- Tile binding: `currentBrand.stats.rev` → `currentBrand.stats.rev7d` with comment.
**Why:** SPEC §7.1. Required for SC-1, SC-4.
**Lines:** ~+25.

### `mingla-business/src/components/brand/BrandProfileView.tsx` (MODIFIED)
**Before:** No `RefreshControl`. No `useQueryClient`.
**After:**
- Imports: `RefreshControl`, `useQueryClient`, `brandKeys`, `eventOrdersKeys`.
- Component body: `queryClient`, `isRefreshing` state, `handleRefresh` callback that invalidates `brandKeys.detail(brand.id)` (or `brandKeys.all` when brand is null) + `eventOrdersKeys.all`.
- ScrollView (populated state): `refreshControl` prop wired.
- GMV tile binding unchanged — still `brand.stats.rev` under "GMV / all time".
**Why:** SPEC §7.2. Required for SC-2, SC-5.
**Lines:** ~+25.

### Initializer fan-out (per SPEC §5)
- `mingla-business/src/services/businessEvents.ts:298` — added `rev7d: 0`.
- `mingla-business/src/hooks/useBusinessEvents.ts:44` — added `rev7d: 0`.
- `mingla-business/src/services/publicEventsService.ts:248-253` + `:277-283` — added `rev7d: 0` to both literal `stats` blocks.
- `mingla-business/src/store/brandList.ts` (×4 stub brands) — added `rev7d: 0`.
- `mingla-business/src/services/__tests__/publicEventsService.test.ts` (×2 fixtures) — added `rev7d: 0`.

### Tests
- `mingla-business/src/services/__tests__/brandsService.test.ts` — extended `OrderStatsFixture` with optional `created_at?: string | null`; added new `describe("aggregateBrandStatsByBrandIds — ORCH-0816 7-day window")` block with 4 tests (T-01, T-02, partial-null behavior, currency isolation).

### Strict-grep gate
- `.github/scripts/strict-grep/orch-0816-last-7-days-binds-rev7d.mjs` — CREATED. 3 checks: home.tsx exists, every "Last 7 days" tile references `stats.rev7d`, no "Last 7 days" tile references bare `stats.rev`.
- `.github/workflows/strict-grep-mingla-business.yml` — added registry comment + new job `orch-0816-last-7-days-binds-rev7d`.

---

## 3. Spec traceability (success criteria)

| SC | Criterion | Verification | Status |
|---|---|---|---|
| SC-1 | "Last 7 days" tile shows 7-day GMV | Jest: "splits lifetime and 7-day buckets by created_at" PASS | ✅ verified |
| SC-2 | BrandProfileView GMV unchanged | Code review: `brand.stats.rev` binding untouched at [BrandProfileView.tsx:509-513](mingla-business/src/components/brand/BrandProfileView.tsx#L509-L513); pickRevForCurrency unchanged | ✅ verified |
| SC-3 | New order reflected ≤5s without backgrounding | Requires live-fire (T-15) — Realtime subscription wired; migration ships | ⚠ awaits live-fire |
| SC-4 | Pull-to-refresh on home invalidates brandKeys.all + eventOrdersKeys.all | Code review: handleRefresh calls Promise.all of both invalidations | ✅ verified |
| SC-5 | Pull-to-refresh on brand-profile same | Code review: handleRefresh wires both keys | ✅ verified |
| SC-6 | staleTime = 30000 ms | Code review: `STALE_TIME_MS = 30 * 1000` | ✅ verified |
| SC-7 | Migration adds orders to publication | SQL: `ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;`. Probe runs after `supabase db push` | ⚠ awaits operator push |
| SC-8 | No channel created when disabled | Code review: `if (!enabled \|\| accountId === null) return;` early-return guard | ✅ verified |
| SC-9 | Channel cleaned up on unmount | Code review: useEffect returns `() => supabase.removeChannel(channel)` | ✅ verified |
| SC-10 | TypeScript build clean | `npx tsc --noEmit` exit 0 across mingla-business | ✅ verified |

---

## 4. Verification commands run

```
# TypeScript
cd mingla-business && npx tsc --noEmit
# Exit 0, no errors.

# Unit tests (touched suite)
npx jest mingla-business/src/services/__tests__/brandsService.test.ts
# 10/10 PASS — includes 4 new ORCH-0816 tests.

# Strict-grep gate
node .github/scripts/strict-grep/orch-0816-last-7-days-binds-rev7d.mjs
# "ORCH-0816 strict-grep PASS — Last-7-days tile binds rev7d."
```

**Pre-existing test failures (not caused by this change):** `mingla-business/src/services/__tests__/publicEventsService.test.ts` has 2 unrelated assertion failures on `brandEvent.date` / `2026-05-08`. Verified by `git stash && npx jest …` showing identical failures on the unchanged Seth baseline. The 7 tests that pass on baseline continue to pass with my changes (including the 2 fixtures I updated for `rev7d`).

---

## 5. Invariant verification

| Constitution # | Rule | Preserved? |
|---|---|---|
| 1 | No dead taps | ✅ RefreshControl is a real gesture |
| 2 | One owner per truth | ✅ server stats stay in React Query |
| 3 | No silent failures | ✅ migration paired with subscription; service still throws on error |
| 4 | One key per entity | ✅ `brandKeys` / `eventOrdersKeys` factories reused |
| 5 | Server state in React Query | ✅ no Zustand server-state introduced |
| 6 | Logout clears everything | ✅ N/A (no new persisted state) |
| 7 | Label temporary | ✅ N/A (no transitional items added) |
| 8 | Subtract before adding | ✅ Old binding replaced, not layered |
| 9 | No fabricated data | ✅ tile label now matches data |
| 10 | Currency-aware | ✅ pickRev7dForCurrency mirrors lifetime currency rules |
| 11 | One auth instance | ✅ N/A |
| 12 | Validate at right time | ✅ N/A |
| 13 | Exclusion consistency | ✅ same payment_status exclusion in both windows |
| 14 | Persisted-state startup | ✅ N/A (no persisted store changes) |

---

## 6. Parity check

- **Solo / collab:** N/A — this is a mingla-business surface; no solo/collab modes.
- **iOS / Android / Web:** `RefreshControl` is RN core (cross-platform). Realtime subscription pattern matches existing `useBrandStripeBankVerification` which already ships cross-platform.
- **App-mobile:** untouched. SPEC explicitly excludes.
- **Admin dashboard:** untouched. SPEC explicitly excludes.
- **Edge functions:** untouched. SPEC explicitly excludes.

---

## 7. Cache safety

| Key affected | How |
|---|---|
| `brandKeys.list(accountId)` | Now refetches every 30s (down from 5 min) AND on every `orders` row event AND on pull-to-refresh. Optimistic mutations preserved. |
| `brandKeys.detail(brandId)` | Same — 30s, realtime, pull-to-refresh. |
| `brandKeys.all` | Bulk-invalidated by useBrands realtime + home pull-to-refresh. |
| `eventOrdersKeys.all` | Bulk-invalidated by useBrands/useBrand realtime + both pull-to-refreshes. Per-event 15s staleTime unchanged. |
| `brandKeys.cascadePreview(...)` | Untouched. |
| `brandRoleKeys.*` | Untouched. |

No data-shape changes that would break persisted AsyncStorage — `Brand.stats.rev7d` is a new field; persisted v12+ caches that lack it get `rev7d: 0` from the optimistic temp initializer and from service-layer hydration paths. Hydration paths re-fetch from server inside 30s anyway.

---

## 8. Regression surface

Adjacent areas the tester should exercise:

1. **Optimistic brand create flow** — temp brand now ships `rev7d: 0`; verify creation still completes and the server response replaces the temp row.
2. **Optimistic brand update flow** — `useUpdateBrand` doesn't touch stats fields; verify patch operations leave `rev7d` untouched.
3. **Brand soft-delete flow** — invalidates `brandKeys.list(accountId)`; verify cascade preview still works.
4. **Per-event sales tiles** (`useEventSalesSummaries`) — unchanged. Confirm 15s freshness still applies and the new orders subscription doesn't cause excessive refetches on the per-event tiles (it does invalidate `eventOrdersKeys.all` — by design).
5. **Brand profile Not Found state** — `handleRefresh` falls back to `brandKeys.all` when `brand === null`, so the refresh control on the not-found ScrollView is still safe to use.

---

## 9. Discoveries for orchestrator

- **Pre-existing failing tests in publicEventsService.test.ts** (2 assertions on `brandEvent.date`) are unrelated to ORCH-0816 — verified by stash-and-run on baseline. Worth a separate small ORCH to investigate.
- **Cycle-B5 marketing hub merge risk:** ORCH-0815 Phase A modifies `BrandProfileView.tsx` (Blasts navigation prop). My changes also modify that file but in a different region (imports + component-body refresh control + ScrollView prop). Likely conflict-free, but the operator should resolve in the order: merge 0815-A first, then this branch.
- **Header comment at `home.tsx:6`** correctly describes the screen as a "7-day aggregate hero" — now finally true after years of mismatch.

---

## 10. Deploy notes

Operator owns the migration push and EAS OTA. Recommended order:

```bash
# 1. Apply migration
supabase db push --linked

# 2. Verify publication membership
psql ... -c "SELECT pubname, schemaname, tablename FROM pg_publication_tables WHERE tablename = 'orders';"
# Expect: supabase_realtime / public / orders

# 3. EAS OTA
cd mingla-business
eas update --branch production --platform ios --message "ORCH-0816: real 7-day GMV + brand-stats freshness"
eas update --branch production --platform android --message "ORCH-0816: real 7-day GMV + brand-stats freshness"

# 4. Live-fire smoke (T-15)
#    On TestFlight/Play build: open home as brand owner, run a real test checkout
#    from a separate device, observe tile updates ≤5s without remount.
```

**No edge function deploys.** SPEC §1 explicitly excludes edge functions.

---

## 11. Files changed (final list, 15)

```
Created  .github/scripts/strict-grep/orch-0816-last-7-days-binds-rev7d.mjs
Modified .github/workflows/strict-grep-mingla-business.yml
Modified Mingla_Artifacts/reports/INVESTIGATION_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md  (created earlier same session)
Modified Mingla_Artifacts/specs/SPEC_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md             (created earlier same session)
Created  Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md (this file)
Created  supabase/migrations/20260602000004_orch_0816_orders_realtime_publication.sql
Modified mingla-business/src/types/brand.ts
Modified mingla-business/src/services/brandsService.ts
Modified mingla-business/src/services/brandMapping.ts
Modified mingla-business/src/services/businessEvents.ts
Modified mingla-business/src/services/publicEventsService.ts
Modified mingla-business/src/services/__tests__/brandsService.test.ts
Modified mingla-business/src/services/__tests__/publicEventsService.test.ts
Modified mingla-business/src/hooks/useBrands.ts
Modified mingla-business/src/hooks/useBusinessEvents.ts
Modified mingla-business/app/(tabs)/home.tsx
Modified mingla-business/src/components/brand/BrandProfileView.tsx
Modified mingla-business/src/store/brandList.ts
```

---

## 12. Verdict

`implemented, partially verified` — code-side gates all PASS (TypeScript, 10/10 brandsService Jest, strict-grep). Live-fire SC-3 + SC-7 PROBE require operator-driven `supabase db push` and TestFlight live order; those are by-design out of implementor scope.

No transition items. No scope expansion. No edge-function changes.
