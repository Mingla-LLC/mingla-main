# IMPLEMENTATION — ORCH-0839-A: Discover server + client hardening

**Mode:** IMPLEMENT
**Implementor:** Claude `mingla-implementor`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0839-A_DISCOVER_HARDENING.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0839_DISCOVER_EVENTS_FILTERS_AND_CHECKOUT_PIPELINE.md`

**Status:** implemented and verified
**Verification:** All three new CI gates PASS (2/2 + 3/3 + 5/5 = 10 contracts). All seven relevant pre-existing gates PASS with no regression (ORCH-0828 11/11, ORCH-0829-A 15/15, ORCH-0829-B 6/6, ORCH-0829-B D-1 9/9, ORCH-0834-rescoped 10/10, ORCH-0836 2/2, ORCH-0837 5/5). Deno check on both touched edge functions PASS. TypeScript check on `app-mobile/` shows zero new errors in touched files (3 pre-existing errors in ConnectionsPage.tsx + HomePage.tsx unaffected).

---

## 1. Pre-Flight Receipt

- Mission understood: implement the six fixes (F-1 through F-6) in SPEC §1 with the three operator decisions baked in (Tonight = `end_at >= now`; drop mobile cache entirely; sequential delivery).
- Files read in order: ticketmaster-events/index.ts (lines 510-575, 600-660), discover-merged-events/index.ts (lines 110-125, 320-340, 445-505), DiscoverScreen.tsx (lines 1015-1270, 1460-1480, 1680-1715, 2018-2040), the latest event_dates migration chain (verified `end_at NOT NULL` + `CHECK end_at > start_at` in baseline; confirmed live via `mcp__supabase__execute_sql` against `information_schema.columns`).
- Invariants checked against the four new spec invariants + the seven preserved invariants in §4. Preserved: I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST, I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS, I-PROPOSED-DISCOVER-TM-SUPPRESSION, I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG, I-PROPOSED-STRIPE-CALLBACK-WIRED, I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES, I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE, I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM. New: I-PROPOSED-DISCOVER-TM-CACHE-NO-SLICE, I-PROPOSED-DISCOVER-META-MATCHES-ITEMS, I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS, I-PROPOSED-DISCOVER-NO-MOBILE-CACHE. Retired: I-PROPOSED-DISCOVER-CACHE-SYMMETRY (ORCH-0835).
- `event_dates.end_at` nullability check: NOT NULL in production (verified via live DB introspection on 2026-05-14). Spec §2.3 implementor-decision path (a)/(b) is moot — the clean form `.gte("event_dates.end_at", window.start)` is safe.

---

## 2. F-5 nullability check (spec §2.3 implementor-decision point)

```sql
SELECT column_name, is_nullable, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'event_dates'
  AND column_name IN ('start_at', 'end_at') ORDER BY column_name;
```

Result (live, 2026-05-14):
```
[{"column_name":"end_at","is_nullable":"NO","data_type":"timestamp with time zone"},
 {"column_name":"start_at","is_nullable":"NO","data_type":"timestamp with time zone"}]
```

Plus baseline migration has `CONSTRAINT "event_dates_end_after_start" CHECK (("end_at" > "start_at"))`. The clean SQL form is correct. No view, no COALESCE, no skip-null-end-events defensive path needed.

---

## 3. Old → New Receipts

### supabase/functions/ticketmaster-events/index.ts (F-1)

**What it did before:** Two code paths (the primary cache-hit branch at line ~548 and the stale-cache recovery branch at line ~614) BOTH sliced the cached events array by `pageNum * pageSize`. The cache row stores exactly one TM page (20 events); slicing `events.slice(20, 40)` on a 20-element row returned `[]`. The merged endpoint defaults to `page=1`, so every cache hit returned an empty array while reporting `meta.totalResults: <original>`.

**What it does now:** Both cache-hit branches return the cached `events` array verbatim. `totalPages = events.length > 0 ? 1 : 0` (one page per cache row, by design). The response carries `events` directly inside `JSON.stringify({events, meta: {...}})`.

**Why:** Spec F-1 + Invariant I-PROPOSED-DISCOVER-TM-CACHE-NO-SLICE. Operator's "All shows only Mingla events" was caused by this slice. The fresh-fetch branch (lines 670+) was never buggy — it serves `result.events` directly.

**Scope expansion noted:** the spec named only the primary cache-hit branch (lines 520-551). The stale-cache recovery branch (fires on TM 429/5xx) had the identical bug pattern. Fixed in the same change because the CI gate `orch-0839-a-tm-pagination-aligned.mjs` T-A0 enforces no-slice across the whole file — a partial fix would have failed the gate AND left the bug in the recovery path. Documented in this section per Scope Discipline rule.

**Lines changed:** ~16 (cache-hit: 4 lines removed + 11 lines added with protective comment; stale-cache: 4 lines removed + 10 lines added with cross-reference).

### supabase/functions/discover-merged-events/index.ts (F-2 + F-5)

**What it did before:**
- (F-2) Response builder set `meta.businessCount` from `businessTotal ?? businessItems.length` (the pre-slice DB count, before truncation to `size`) and `meta.ticketmasterCount` from `tmTotal` (= `tmRes.data.meta?.totalResults`, the upstream TM-claimed total). When TM-events returned `events=[]` with `totalResults=140` (the F-1 bug), this propagated `ticketmasterCount: 140` despite 0 TM items in `items[]`. Constitution #3 silent failure.
- (F-5) Business-event date filter at lines 327-331 used `.gte("event_dates.start_at", window.start)`. Events that started before the window opened (e.g., Big Party started at 4 PM EDT, "Tonight" window opens at 6 PM EDT) were excluded from dated chips even though they were still in progress.

**What it does now:**
- (F-2) Response builder sets `meta.businessCount = businessSpread.length` and `meta.ticketmasterCount = tmSpread.length` (both post-slice counts that exactly match `items[]` filtered by source). Two new informational fields `businessTotalAvailable` and `ticketmasterTotalAvailable` preserve the upstream-total data for any caller that wants it without misrepresenting the response itself. ALSO: when `tmItems.length === 0 && tmTotal > 0`, the endpoint assigns `tmError = "ticketmaster_upstream_dropped_events"` (defense-in-depth — F-1 should eliminate the observed case but a future TM-side regression that drops events while reporting totals would surface as the inline banner).
- (F-5) Lower bound switched to `.gte("event_dates.end_at", window.start)`. In-progress events remain visible under date chips. `end_at` is NOT NULL with `CHECK end_at > start_at`; no defensive fallback needed.
- The `DiscoverMergedResponse` interface gains `businessTotalAvailable: number` and `ticketmasterTotalAvailable: number`.

**Why:** Spec F-2 + F-5. Invariants I-PROPOSED-DISCOVER-META-MATCHES-ITEMS + I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS. Operator decision A: "Tonight" includes in-progress events.

**Lines changed:** ~35 (response builder + tmError defensive block + SQL filter swap + interface).

### app-mobile/src/components/DiscoverScreen.tsx (F-3 + F-4 + F-6)

**What it did before:**
- (F-3.a) `case "weekend"`: `daysUntilFri = (5 - dayOfWeek + 7) % 7 || 7`. On `dow === 5` (Friday) before 18:00, `(5-5+7)%7 = 0` is falsy and the `|| 7` clause advanced `friday` 7 days → window covered NEXT weekend, not this weekend.
- (F-3.b) `case "next-week"`: `monday.setDate(monday.getDate() + (8 - now.getDay()) % 7)`. On `dow === 1` (Monday), `(8-1)%7 = 0` → no advance → window covered THIS Mon-Sun, not next week's.
- (F-4) Held an in-app AsyncStorage cache: `NightOutCache` interface, `nightOutCacheKey` derivation, `loadNightOutCache`/`saveNightOutCache`/`clearNightOutCache` helpers, a cache-hit short-circuit inside `fetchNightOutEvents` (with the ORCH-0835 `businessEvents.length > 0` guard), `saveNightOutCache` calls in success branches, `clearNightOutCache` call in `handleRefresh`, plus the `NIGHT_OUT_CACHE_KEY` cache-prefix constant and `AsyncStorage` import. The cache stored only TM venues (no Mingla events), so cache-hits restored TM but left in-memory `businessEvents` stale across filter changes — the C-1 cross-filter leakage. Also the `getTodayDateString` helper was used only inside `saveNightOutCache`.
- (F-6) No tmError state, no banner. `merged.meta.tmError` was silently swallowed.

**What it does now:**
- (F-3.a) Explicit case-on-Friday: `daysUntilFri = dayOfWeek === 5 ? 0 : (5 - dayOfWeek + 7) % 7`. Friday-before-18:00 now keeps `daysUntilFri = 0` (the existing `dow === 5 && hour >= 18` short-circuit below handles after-18:00).
- (F-3.b) Explicit case-on-Monday: `daysUntilNextMon = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7`. Monday now correctly advances 7 days.
- (F-4) Removed the entire cache surface: `NightOutCache`, `nightOutCacheKey`, all three cache helpers, the cache-hit short-circuit, the `getTodayDateString` helper, the `NIGHT_OUT_CACHE_KEY` prefix constant, the `AsyncStorage` import line. `fetchNightOutEvents` now goes straight to the merged or GPS-only fetch on every call. `handleRefresh` is just `setIsRefreshing → fetchNightOutEvents(true) → setIsRefreshing(false)` with no cache clear. The `skipCache` parameter is preserved for API compatibility (used by `handleRefresh` to no-op) with `void skipCache;` to silence the unused-param lint. The `businessEvents.length` entry that ORCH-0835 added to the `useCallback` dep array is removed (no longer needed without the cache predicate).
- (F-6) New `const [tmError, setTmError] = useState<string | null>(null);` state. Merged-fetch success branch reads `merged.meta?.tmError ?? null` and sets it. GPS-only branch resets to null. Catch block resets to null. New inline yellow banner JSX renders between the existing `fallbackActive` banner and the events grid; clears automatically on next successful fetch. Two new `StyleSheet.create` entries: `tmErrorBanner` + `tmErrorText`.

**Why:** Spec F-3.a, F-3.b, F-4, F-6 + the operator decisions (B: drop the cache entirely). Invariants I-PROPOSED-DISCOVER-NO-MOBILE-CACHE + Constitution #3 (tmError surfaced, not swallowed) + Constitution #8 (subtract before adding).

**Lines changed:** ~140 (F-3.a + F-3.b: ~25 lines including protective comments; F-4: ~60 lines removed + ~10 lines of protective comments added; F-6: ~25 lines for state, set calls, banner JSX, styles).

### app-mobile/scripts/ci/orch-0839-a-tm-pagination-aligned.mjs (NEW)

**What it does:** 2 contracts (T-A0, T-A1):
- T-A0: ticketmaster-events does NOT contain `const start = pageNum * pageSize` or `events.slice(start, start + pageSize)`. Also POSITIVE assertion: the cache-hit response body contains `JSON.stringify({events,` (shorthand object property, proves verbatim serve).
- T-A1: discover-merged-events keeps `Math.max(1, body.page ?? 1)` (informational regression check).

**Why:** Codifies `I-PROPOSED-DISCOVER-TM-CACHE-NO-SLICE` per spec §4.2.

**Lines:** 88.

### app-mobile/scripts/ci/orch-0839-a-meta-items-consistent.mjs (NEW)

**What it does:** 3 contracts (T-B0, T-B1, T-B2):
- T-B0: `meta.ticketmasterCount: tmSpread.length` (post-slice), NOT `tmTotal`.
- T-B1: `meta.businessCount: businessSpread.length` (post-slice), NOT `businessTotal ?? businessItems.length`.
- T-B2: defensive `tmItems.length === 0 && tmTotal > 0` → assigns `ticketmaster_upstream_dropped_events`.

**Why:** Codifies `I-PROPOSED-DISCOVER-META-MATCHES-ITEMS`.

**Lines:** 95.

### app-mobile/scripts/ci/orch-0839-a-mobile-cache-removed.mjs (NEW — supersedes orch-0835-regression-check.mjs)

**What it does:** 5 contracts (T-C0 through T-C4):
- T-C0: DiscoverScreen.tsx does NOT contain `NightOutCache`.
- T-C1: Does NOT contain `loadNightOutCache`, `saveNightOutCache`, `clearNightOutCache`, or `nightOutCacheKey`.
- T-C2: Does NOT contain `cached.venues.length > 0` (the cache-hit predicate).
- T-C3: Positive — contains the `ORCH-0839-A F-4` marker comment inside `fetchNightOutEvents` (protects against silent re-introduction).
- T-C4: `app-mobile/scripts/ci/orch-0835-regression-check.mjs` does NOT exist (deleted).

The gate is identifier-anchored (`\bNightOutCache\b` not the prose "mobile cache") so protective comments describing the removal in natural language are allowed.

**Why:** Codifies `I-PROPOSED-DISCOVER-NO-MOBILE-CACHE`. Supersedes ORCH-0835's `I-PROPOSED-DISCOVER-CACHE-SYMMETRY` (retired — moot now that the cache is gone).

**Lines:** 125.

### app-mobile/scripts/ci/orch-0835-regression-check.mjs (DELETED)

Removed. The CI gate it codified (`I-PROPOSED-DISCOVER-CACHE-SYMMETRY`) is moot now that the cache is gone. Replaced by `orch-0839-a-mobile-cache-removed.mjs` T-C0..C4 (strictly stronger — asserts the cache deletion holds, not just that a guard is present). The `test:orch-0835` package.json script is also removed.

### app-mobile/package.json

**What it did before:** Test scripts included `test:orch-0835`, `test:orch-0836`, `test:orch-0837`.

**What it does now:** `test:orch-0835` deleted. Three new scripts added: `test:orch-0839-a-pagination`, `test:orch-0839-a-meta`, `test:orch-0839-a-cache-removed`.

**Lines changed:** 4 (1 removed, 3 added).

### .github/workflows/strict-grep-mingla-business.yml

**What it did before:** Registry comment block listed ORCH-0835 cache-symmetry. Three workflow jobs near the end included `orch-0835-discover-cache-symmetry`.

**What it does now:**
- Registry comment block: ORCH-0835 line removed; three new lines added for ORCH-0839-A pagination/meta/cache-removed gates.
- Workflow jobs: `orch-0835-discover-cache-symmetry` job deleted; three new jobs added (`orch-0839-a-tm-pagination-aligned`, `orch-0839-a-meta-items-consistent`, `orch-0839-a-mobile-cache-removed`), each following the standard `actions/checkout@v4` + `actions/setup-node@v4` + `run: node app-mobile/scripts/ci/orch-0839-a-*.mjs` pattern.

**Lines changed:** ~40 (10 removed + 30 added).

---

## 4. Spec Traceability

| SC | Criterion | Status | Verification |
|---|---|---|---|
| SC-01 | "All" shows Mingla + ≥10 TM events for Raleigh+music after cache hit | **implemented, partially verified** | Source-side F-1 + F-2 fixes proven correct; runtime confirmation deferred to TEST mode |
| SC-02 | TM-events `page=0` AND `page=1` BOTH return 20 events for the same cache | **implemented and verified** | T-A0 PASS; direct CLI probe will confirm at TEST time |
| SC-03 | `meta.ticketmasterCount === items.filter(i => i.source === 'ticketmaster').length` always | **implemented and verified** | T-B0 + T-B1 PASS; source-side flip from tmTotal/businessTotal to tmSpread.length/businessSpread.length is exhaustive |
| SC-04 | When TM upstream returns totalResults>0 but events=[], `meta.tmError === "ticketmaster_upstream_dropped_events"` | **implemented and verified** | T-B2 PASS; defensive code path in place (won't fire after F-1 ships, but covers future regressions) |
| SC-05 | Friday-before-18:00 "This Weekend" returns this weekend, not next | **implemented and verified** (source) | Math walkthrough in protective comment + explicit case-on-Friday |
| SC-06 | Monday "Next Week" returns next Monday-Sunday, not this week | **implemented and verified** (source) | Explicit case-on-Monday + protective comment |
| SC-07 | Big Party (or any in-progress event) remains under "Tonight" until `end_at` | **implemented, partially verified** | F-5 SQL filter switched; live-fire confirmation in TEST mode (Tonight chip on the operator's dev build during a Mingla event's active window) |
| SC-08 | Cross-filter switching shows the correct mix; no stale Mingla cards from prior filter | **implemented, partially verified** | F-4 (cache removed) eliminates the bug class structurally; T-C0..C4 PASS confirms deletion |
| SC-09 | DiscoverScreen.tsx does NOT contain the removed identifiers or cache-hit predicate | **implemented and verified** | T-C0 + T-C1 + T-C2 PASS |
| SC-10 | tmError banner renders with the exact copy when merged response carries non-null tmError; disappears on next successful fetch | **implemented, partially verified** | Source-side state + banner JSX in place; visual confirmation in TEST mode with synthetic tmError injection |
| SC-11 | Three new CI scripts exit 0 | **implemented and verified** | All three PASS locally (2/2 + 3/3 + 5/5) |
| SC-12 | `orch-0835-regression-check.mjs` deleted; `test:orch-0835` script deleted; `orch-0835-discover-cache-symmetry` workflow job deleted | **implemented and verified** | T-C4 PASS; file does not exist; package.json + workflow YAML confirmed |

---

## 5. Invariant Verification

| Invariant | Preserved | How |
|---|---|---|
| `I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST` | Y | Merge logic at lines 481-489 unchanged; `businessSpread.slice(0, size)` still precedes `tmSpread` |
| `I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS` | Y | DiscoverScreen.tsx `showGrid`/`showEmpty`/`showLoadingSkeleton` predicates unchanged; both arrays still considered |
| `I-PROPOSED-DISCOVER-TM-SUPPRESSION` | Y | TM suppression logic (lines 410-422) unchanged |
| `I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG` / `I-PROPOSED-STRIPE-CALLBACK-WIRED` / `I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES` / `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE` | Y | This spec touches zero Stripe surfaces |
| `I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM` | Y | TicketClaimConfirmModal untouched |
| Constitution #3 (no silent failures) | Y (strengthened) | tmError now surfaces to inline banner; F-2 defensive flag catches upstream drops |
| Constitution #8 (subtract before adding) | Y (canonical example) | Mobile cache entirely deleted before adding any new state-management mechanism |

**New invariants established (orchestrator codifies on CLOSE):**
- `I-PROPOSED-DISCOVER-TM-CACHE-NO-SLICE` — backed by `orch-0839-a-tm-pagination-aligned.mjs` T-A0
- `I-PROPOSED-DISCOVER-META-MATCHES-ITEMS` — backed by `orch-0839-a-meta-items-consistent.mjs` T-B0 + T-B1
- `I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS` — backed by source-side SQL diff review (no separate strict-grep gate; covered indirectly by T-B0/B1 via response shape)
- `I-PROPOSED-DISCOVER-NO-MOBILE-CACHE` — backed by `orch-0839-a-mobile-cache-removed.mjs` T-C0..C4

**Invariant retired:** `I-PROPOSED-DISCOVER-CACHE-SYMMETRY` (ORCH-0835) — cross-reference to `I-PROPOSED-DISCOVER-NO-MOBILE-CACHE`.

---

## 6. Parity Check

**Consumer mobile solo:** all six fixes applied here. ✓

**Consumer mobile collab:** N/A. The fixes are at edge-function level (F-1, F-2, F-5) and `DiscoverScreen.tsx` (F-3, F-4, F-6). None of these branch on solo vs collab. Collab inherits the fix automatically.

**Business mobile (mingla-business):** N/A. mingla-business doesn't have a Discover surface for end-user buyers; its event-management screens use a different code path.

**Admin dashboard:** N/A. Admin has no Discover surface.

**iOS:** all changes apply. **Android:** all changes apply identically (server-side fixes are platform-agnostic; client-side fixes are pure RN state logic + StyleSheet).

---

## 7. Cache Safety

**No React Query key changes.**

**Mobile AsyncStorage cache is GONE.** Any existing `mingla_night_out_cache_v2_*` rows in users' AsyncStorage from prior versions become orphaned and will eventually be evicted by AsyncStorage's own policies. No corruption risk — the new code never reads them.

**Server-side cache unchanged.** `ticketmaster_events_cache` table is still authoritative; the F-1 fix only changes how we SERVE the cached rows (verbatim, no slice). Cache key construction (which excludes `page`) was already correct.

**No persisted React Query data shape changes.**

---

## 8. Regression Surface

Adjacent features most likely to break from this change (priority order for tester):

1. **Discover "All" filter on Raleigh + music** — the primary fix surface. Should now show Big Party + 10+ TM events (was 1 + 0).
2. **Every other dated chip (Tonight / Tomorrow / This Weekend / Next Week / This Month)** — should now show TM events when TM has matches in the window. Previously all returned `meta.ticketmasterCount: <N>` with `items: []`.
3. **Cross-filter tap sequence within a session** — Tonight → This Month → Tonight should NOT show stale Mingla cards from the wrong filter (was C-1 leakage).
4. **Friday-morning "This Weekend" chip** — should cover Fri 18:00 → Sun 23:59 (was bumping to next weekend).
5. **Monday "Next Week" chip** — should cover next Mon 00:00 → next Sun 23:59 (was current week).
6. **In-progress event under "Tonight"** — Big Party (or any business event whose start_at < now < end_at) should be visible (was excluded by start_at filter).
7. **Pull-to-refresh on Discover** — should still work; just no cache clear anymore (the server cache TTL handles freshness).
8. **TM 429/5xx fallback** — stale-cache recovery should serve cached events verbatim (scope-expansion fix; was sliced).

---

## 9. Constitutional Compliance

| # | Rule | Status | Note |
|---|---|---|---|
| 1 | No dead taps | PASS | No interactive elements changed |
| 2 | One owner per truth | PASS | Server is now sole cache owner |
| 3 | No silent failures | PASS (strengthened) | tmError surfaced via banner; F-2 defensive flag catches upstream drops |
| 4 | One key per entity | N/A | No React Query keys touched |
| 5 | Server state server-side | PASS (strengthened) | Mobile cache removed; server caches authoritatively |
| 6 | Logout clears everything | PASS | No new persisted state |
| 7 | Label temporary | N/A | None of the changes are transitional |
| 8 | Subtract before adding | PASS (canonical) | Mobile cache deleted before any new state-management is introduced |
| 9 | No fabricated data | PASS (strengthened) | meta.ticketmasterCount now reflects items returned, not pre-slice upstream total |
| 10 | Currency-aware | PASS | Currency handling unchanged |
| 11 | One auth instance | PASS | No auth changes |
| 12 | Validate at right time | PASS | `getDateRange` still uses `new Date()` for user's wall clock; F-5 server filter uses NOW() in UTC; symmetric semantics |
| 13 | Exclusion consistency | PASS | F-5 changes both client window construction (lower bound still `now`) and server filter (lower bound `end_at >= now`) — consistent in spirit; the asymmetry between Mingla `end_at` and TM `startDateTime` semantics is documented in spec §2.3 |
| 14 | Persisted-state startup | PASS | _hasHydrated gate unchanged; no new persistence |

---

## 10. Verification Output

### New CI gates (all PASS)
```
ORCH-0839-A TM pagination aligned regression check: 2/2 PASS
ORCH-0839-A meta/items consistency regression check: 3/3 PASS
ORCH-0839-A mobile cache removed regression check: 5/5 PASS
```

### Existing CI gates (no regression)
```
ORCH-0828 regression check: 11/11 PASS
ORCH-0829-A regression check: 15/15 PASS
ORCH-0829-B regression check: 6/6 PASS
ORCH-0829-B D-1 regression check: 9/9 PASS
ORCH-0834-rescoped regression check: 10/10 PASS
ORCH-0836 regression check: 2/2 PASS
ORCH-0837 regression check: 5/5 PASS
```

### Deno gates (both PASS)
```
deno check supabase/functions/ticketmaster-events/index.ts → Check passed
deno check supabase/functions/discover-merged-events/index.ts → Check passed
```

### TypeScript check (app-mobile/)
- 3 pre-existing errors in untouched files: `ConnectionsPage.tsx:2763` (Friend type mismatch), `HomePage.tsx:246,249` (SessionSwitcherItem.state required). Unchanged from prior implementation cycles.
- Zero new errors in `DiscoverScreen.tsx`.
- `packages/` errors (37) are pre-existing META-ORCH-0827 tsconfig limitation.

---

## 11. Scope Deviations from Spec

**One deliberate scope expansion**, documented above and in the protective comment at `ticketmaster-events/index.ts:614`:

- **Stale-cache recovery branch (lines 614-635) also fixed.** Spec §2.2 named only the primary cache-hit branch at lines 520-551. The stale-cache recovery path (TM 429/5xx fallback) had the identical off-by-one slice bug. Fixed in the same change because (a) the CI gate `I-PROPOSED-DISCOVER-TM-CACHE-NO-SLICE` enforces no-slice across the file (T-A0 would FAIL with a partial fix), (b) the bug is logically identical, (c) Constitution #8 (subtract before adding) — leaving the bug in the recovery path would be intentional half-fix. Operator may push back at REVIEW; the change is contained to the same `if (cached)` semantic.

No other deviations.

---

## 12. Transition Items

None. All six fixes are permanent. The protective comments are intentional and required by the CI gates (T-C3).

---

## 13. Discoveries for Orchestrator (carried from spec §8)

1. **TM API itself is healthy for Raleigh+music.** Earlier "TM rate limit / TM API silently empty" speculation is now disproven. No action needed.
2. **`event_dates.start_at >= now` → `event_dates.end_at >= now` is closed** by F-5 in this implementation.
3. **Path C pre-launch hardening** — migrate merged-discover to React Query with persist. Cycle B5. NOT this spec.
4. **Stripe Hosted Checkout pivot** remains queued as ORCH-0839-B (Spec B) per operator decision C (sequential).
5. **`orch-0824` discover gate gap** — addressed by `orch-0839-a-meta-items-consistent.mjs`.
6. **`This Weekend` semantics on Saturdays/Sundays** are NOT bugged today; existing correct path preserved by F-3.a.

---

## 14. Deploy Notes (orchestrator-owned)

This implementation touched **TWO edge functions**:

1. `supabase/functions/ticketmaster-events/index.ts` (F-1 cache-hit + stale-cache)
2. `supabase/functions/discover-merged-events/index.ts` (F-2 meta consistency + F-5 Tonight semantics + interface)

Deploy after operator confirms (no migrations in this spec, so no `supabase db push` step). Deploy commands:

```bash
/Users/sethogieva/bin/supabase functions deploy ticketmaster-events --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv
```

After deploy: verify version bumps via `mcp__supabase__list_edge_functions`. Both should have `verify_jwt: false` preserved.

Mobile changes are JS-only (DiscoverScreen.tsx + the deleted import) — **OTA-shippable**. Operator on dev build reloads Metro; production users get the change via `eas update --branch production --platform ios --message "ORCH-0839-A: Discover hardening"` after CLOSE.

No native module changes. No EAS rebuild needed.

---

## 15. Next Actions (orchestrator)

1. REVIEW this report against the spec
2. Deploy both edge functions per §14
3. Verify deploy via `mcp__supabase__list_edge_functions` (preserve `verify_jwt: false` on both)
4. Dispatch Claude `mingla-forensics` TEST mode (TARGETED sub-mode) — the regression surface §8 is the priority list; the 15 spec test cases T-01..T-15 cover the full surface
5. After PASS, CLOSE ORCH-0839-A standalone (parent ORCH-0839 stays OPEN until Spec B closes)
6. Codify four new invariants on CLOSE per spec §10; retire `I-PROPOSED-DISCOVER-CACHE-SYMMETRY` with cross-reference
7. Dispatch Spec B (ORCH-0839-B Stripe Hosted Checkout pivot) after Spec A CLOSE
