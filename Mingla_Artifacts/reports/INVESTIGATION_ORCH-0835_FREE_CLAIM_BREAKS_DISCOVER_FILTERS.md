# INVESTIGATION — ORCH-0835: Free-ticket claim introduces Discover filter regression

**Mode:** INVESTIGATE (bundled with ORCH-0836)
**Investigator:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence:** **Probable** — root cause is source-traced and matches the operator-described symptom plus the R-4 hidden-flaw blast prediction made in `INVESTIGATION_ORCH-0833_ALL_FILTER_NO_TM_REAL_DEVICE.md` §"Candidate R-4." Live-fire on the iOS sim was attempted (app launched on iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6` PID 68400; Metro running on :8081); however the sim's installed `Mingla.app` is the older dev binary from 02:00 local and is not the post-ORCH-0834-rescoped EAS bundle the operator tested on real device — so a 1:1 live-fire repro on sim cannot validate the post-claim state under the current bottom-sheet code path. Named blocker: a fresh sim dev build matching `Seth` HEAD would promote this to `proven`. Operator-decision: ship the fix from `probable` (the source proof is conclusive and the symptom matches the prior R-4 prediction), or request a sim rebuild first.

---

## SYMPTOM SUMMARY

| | What happened |
|---|---|
| **Expected** | After claiming a free ticket and navigating back to Discover, all filters (`All`, `Tonight`, `Tomorrow`, `Weekend`, `Next Week`, `This Month`) consistently show both Mingla business events and Ticketmaster events for the selected city, per `I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST` and `I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS`. |
| **Actual (operator, real iPhone, post-EAS build with the ORCH-0834-rescoped bottom-sheet claim modal)** | After completing a free claim and returning to Discover: (1) **at first** the Mingla business event is missing entirely (only TM events visible); (2) **later** when tapping the `All` filter pill, only the Mingla business event is visible (TM is gone); (3) other filter pills (Tonight / Weekend / Next Week) appear empty or stuck; (4) **only** `This Month` shows the full populated list (Mingla + TM). The state oscillates across filter taps. |

The "before claim, everything worked" half of the report is independently corroborated by the operator's prior Metro log from the same EAS build, which captured `[NightOutService] searchMerged: {city: "Raleigh", segmentSlug: "music", timezone: "America/New_York", localStartEndDateTime: undefined}` for `All` and the equivalent for `Tonight` — both returning populated business + TM responses (ORCH-0833 R-2 stale-bundle was the prior root cause, now fixed by the EAS rebuild). So the regression introduced by free claim is genuine and post-claim-specific.

---

## INVESTIGATION MANIFEST (every file read, in trace order)

| # | File | Why read |
|---|------|----------|
| 1 | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | Free-claim happy-path — what runs after `onConfirm` |
| 2 | `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` | The new bottom-sheet confirmation; verify it doesn't mutate Discover state |
| 3 | `app-mobile/src/payments/nativeCheckoutFlow.ts` | `runNativeCheckout` → `ticket-checkout-create` → `free_completed` branch |
| 4 | `app-mobile/src/services/nightOutExperiencesService.ts` (lines 200-298) | `searchMerged` shape + tz forwarding |
| 5 | `app-mobile/src/components/DiscoverScreen.tsx` (lines 880-1240, 1340-1400, 1490-1520) | Filter state, cache key construction, cache hit short-circuit, partition logic, empty-state guards |
| 6 | `app-mobile/src/store/appStore.ts` (around lines 200-340) | `discoverFilters` Zustand persistence shape |
| 7 | `supabase/functions/discover-merged-events/index.ts` (lines 1-500) | TM suppression rules + merge math |
| 8 | `app-mobile/node_modules/@stripe/stripe-react-native/lib/module/components/*.js` | (cross-referenced for ORCH-0836; no influence here) |

Plus grep coverage for `invalidateQueries`, `setQueryData`, `removeQueries` across `app-mobile/src/components/expandedCard/` and `app-mobile/src/hooks/` to confirm the only cache invalidation in the free-claim chain is `queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] })` at `ExpandedBusinessEventSheet.tsx:268-279`.

---

## FINDINGS

### 🔴 Root Cause R-1: cache-hit short-circuit at `DiscoverScreen.tsx:1115-1129` restores ONLY `nightOutCards` (TM); the in-memory `businessEvents` state is left empty after a remount, which guarantees the post-claim symptom

**File + line:** `app-mobile/src/components/DiscoverScreen.tsx:1115-1129`

**Exact code:**
```ts
if (
  cached &&
  cached.date === getTodayDateString() &&
  cached.venues.length > 0 &&
  cached.genre === selectedFilters.genre
) {
  setNightOutCards(cached.venues);
  setFallbackActive(cached.fallbackActive ?? false);
  setNightOutLoading(false);
  return;  // <-- early return; setBusinessEvents NEVER called
}
```

**Cache shape (`NightOutCache`, lines 1017-1030):**
```ts
interface NightOutCache {
  date: string;
  venues: NightOutCardData[];  // Ticketmaster cards ONLY
  genre: string;
  fallbackActive: boolean;
}
```

**Cache key (line 1039):**
```ts
const nightOutCacheKey = `${NIGHT_OUT_CACHE_KEY}_v2_${user?.id}_${nightOutCityKey}_seg:${selectedFilters.segment}_date:${selectedFilters.date}_gen:${selectedFilters.genre}`;
```

Cache key partitions by **user × city × segment × date × genre**. Each filter pill change produces a different cache key. Cache values store only TM venues (`cards = tmVenues.map(transformNightOutVenue)` at line 1165-1167, persisted via `saveNightOutCache(cards, false)` at line 1167). **Business events are never written to AsyncStorage.**

**What it does today:**
- On cache hit, `setNightOutCards(cached.venues)` restores the TM array.
- `setBusinessEvents(...)` is NOT called; the in-memory state for business events is whatever React last rendered with.
- Early `return` — no merged refetch, no business-events population.

**What it should do:**
- Either persist business events to the cache alongside TM (cache shape becomes `{date, venues, businessEvents, genre, fallbackActive}`), and restore both on hit;
- OR — preferred for correctness — only short-circuit when BOTH `cached.venues.length > 0` AND `businessEvents.length > 0` (in-memory). If `businessEvents` is empty (because the component just mounted with no prior fetch), fall through to a fresh merged call so both lists populate together;
- OR — simplest — DELETE the cache short-circuit entirely. With React Query persisted at 24h max age elsewhere in the app, AsyncStorage caching for `nightOutCards` is redundant and harmful (the cache only ever has half the data).

**Causal chain — step-by-step from this code → user symptom:**

1. **Pre-claim baseline.** User opens Discover. `effectiveCity = "Raleigh"`. Cache miss for `date:any` cache key → fresh merged fetch → `setBusinessEvents([bigParty])` + `setNightOutCards([linkinPark, benFolds, ...])` + `saveNightOutCache([linkinPark, benFolds, ...])`. Both visible. Operator's prior Metro log confirms this state.

2. **Claim.** User taps Big Party → bottom sheet opens → taps "Get Free" → bottom-sheet confirmation modal shows → taps "Claim Free Ticket" → `handleConfirmClaim` → `handleBuy(ticketId, isFreeTicket=true)` → `runNativeCheckout()` returns `{outcome: "succeeded", orderId}` via the `free_completed` branch of `ticket-checkout-create` → toast "Ticket secured! Check your calendar." → `sheetRef.current?.close()` → `queryClient.invalidateQueries({queryKey: ["businessEventOrders", userId]})`. (Discover state untouched at this point — the only invalidated query is for the calendar.)

3. **Navigate to Calendar.** Operator taps the Calendar tab to see the just-claimed ticket. Mingla's custom navigation unmounts Discover (DiscoverScreen does not use React Navigation's screen preservation — it's a plain tab swap in the bottom tab bar). Local `useState` values die: `businessEvents = []`, `nightOutCards = []`, `nightOutLoading = true`, `selectedFilters` snapshots into the Zustand registry via the `setDiscoverFiltersRegistry` sync effect (line 928-932). AsyncStorage cache is intact (`saveNightOutCache` already persisted the TM venues).

4. **Return to Discover.** Operator taps Discover tab → DiscoverScreen remounts. Initial state from `useState`:
   - `businessEvents = []`
   - `nightOutCards = []`
   - `selectedFilters = discoverFiltersSnapshot ? {date, segment, genre, partyTypes: [], vibeTags: [], musicGenres: []} : defaults` — the Zustand snapshot only restores date/segment/genre; taxonomy facets are hardcoded `[]` (lines 905-908, defensive per ORCH-0824).
   - Async-load preference effect (lines 948-971) kicks off `PreferencesService.getUserPreferences(user.id)` → eventually calls `setSelectedCity(...)`. **Until this resolves, `selectedCity = null`.**
   - GPS reverse-geocode effect (lines 976-1005) kicks off — eventually calls `setGpsDefaultCity(...)`.

5. **Race condition window.** On first render after remount, `effectiveCity = selectedCity ?? gpsDefaultCity = null`. The 300ms-debounced `fetchNightOutEvents` (line 1224) fires; the guard at line 1108-1109 short-circuits because there's no city AND possibly no GPS yet. But — once `selectedCity` resolves and the `useEffect` dep array fires `fetchNightOutEvents` again — the cache load triggers.

6. **Cache hit path executes.** For the user's restored `date:any` selection (the same one they had pre-navigation), the AsyncStorage cache has populated TM venues from step 1. Cache hit → `setNightOutCards([linkinPark, benFolds, ...])` → `setFallbackActive(false)` → early `return`. **`setBusinessEvents` is never called.** State is now: `businessEvents = []`, `nightOutCards = [linkinPark, benFolds, ...]`.

7. **Symptom #1 manifests.** Grid renders. `showGrid` predicate at line 1515-1516 is true because `nightOutCards.length > 0`. But `businessEvents.length === 0`, so the business-events row above the TM grid (line 1737 `{businessEvents.map((be) => ...)}`) renders nothing. **User sees: TM events visible, Big Party (Mingla event) missing.** = operator's "at first did not see the mingla event anymore."

8. **User taps a different filter pill (e.g., Tonight → then back to All; OR Tonight directly).** Tapping a different `selectedFilters.date` changes the cache key. New cache key may be a miss (if Tonight wasn't fetched before this session) → fresh merged fetch → `setBusinessEvents(...)` populates, `setNightOutCards(...)` populates from server response. Both visible. **OR** new cache key is also a hit (if Tonight was previously cached) → another cache-only restore → only TM, no business events.

9. **Server-side TM suppression edge.** The merged endpoint's TM suppression rules (`discover-merged-events/index.ts:410-420`) fire when `partyTypeSlugs OR vibeTagSlugs` is non-empty. Operator's restored `selectedFilters` always sets those arrays to `[]`, so suppression should NOT trigger. **However** — there is an alternate failure mode: TM API timeout or rate-limit returns empty array, edge function logs `tmError` but still returns the (empty) `tmItems = []`. If Tonight's fresh fetch hits this, the merged response is `{items: [{source: "business_event", item: bigParty}], meta: {ticketmasterCount: 0, tmError: <msg>}}`. The partition logic at `DiscoverScreen.tsx:1158-1166` then does `setBusinessEvents([bigParty])` + `setNightOutCards([])` + `saveNightOutCache([], false)`. **User sees: only Big Party, no TM.** = operator's "only see the mingla event in all."

10. **"This Month works" is consistent.** The This Month filter (`selectedFilters.date = "month"`) has its own cache key. If This Month was less commonly fetched in the prior session, its cache may be empty → fresh merged fetch — and because the merged endpoint's TM call uses `localStartEndDateTime` covering a 30-day window, TM is more likely to return populated results (more events match a wider window). Both arrays populate → user sees full list.

**Verification step:** 
1. Operator clears AsyncStorage via dev menu (Reload → Clear AsyncStorage), repeats the claim flow, and watches Metro for the `[NightOutService] searchMerged:` log after each filter tap. Filters that show full results should log a fresh merged call (cache miss). Filters that show only TM (no business event) should NOT log a merged call (cache hit short-circuit fired).
2. Alternatively, temporarily add a `console.log("[Discover] cache HIT for key=", nightOutCacheKey)` right before the `return` at line 1128 and a `console.log("[Discover] fresh merged fetch", selectedFilters.date)` right before the merged call at line 1139 — the asymmetry between filters that work and filters that don't will be visible in real-time.

### 🟠 Contributing Factor C-1: tab navigation away from Discover unmounts the screen and loses ephemeral `businessEvents` state, while AsyncStorage cache survives

**File + line:** `app-mobile/app/index.tsx` (tab navigation) + `DiscoverScreen.tsx:915-917` (`businessEvents` local `useState`)

DiscoverScreen does not preserve state across tab unmount; the bottom tab swap kills and re-creates the screen. Combined with R-1, every Discover→Calendar→Discover round-trip is an opportunity for the cache-hit short-circuit to land in the inconsistent state.

If business events were managed via React Query (with persist), this would self-heal — the query would re-hydrate from AsyncStorage on remount. The current pattern bypasses React Query entirely for the merged-discover response and uses a manual cache that only persists half the data.

### 🟡 Hidden Flaw H-1: cache key does not include `partyTypeSlugs`, `vibeTagSlugs`, `musicGenreSlugs` — switching any of these post-launch will serve stale cache without invalidation

**File + line:** `DiscoverScreen.tsx:1039`

```ts
const nightOutCacheKey = `${NIGHT_OUT_CACHE_KEY}_v2_${user?.id}_${nightOutCityKey}_seg:${selectedFilters.segment}_date:${selectedFilters.date}_gen:${selectedFilters.genre}`;
```

Missing facets: `partyTypes`, `vibeTags`, `musicGenres`. Today these arrays are always `[]` on remount (line 905-908 hardcode), so the bug doesn't manifest. **But** any future change that persists these arrays into Zustand and restores them on remount will cause the cache to serve stale results across taxonomy facet changes. Fix in the same SPEC as R-1.

### 🟡 Hidden Flaw H-2: edge function's `tmError` is silently swallowed by the client

**File + line:** `discover-merged-events/index.ts:452-462` + `DiscoverScreen.tsx:1139-1167`

The edge function returns `meta.tmError` populated when TM throws or returns non-events. The client ignores `meta` entirely — it only reads `merged.items`. If TM fails for a specific filter, the user sees a silently-empty TM grid with no indication that anything went wrong. Constitution #3 violation latent here; should be addressed in the same SPEC (small effort, big payoff for diagnosability).

### 🔵 Observation O-1: the free-claim chain does NOT directly invalidate any Discover query keys

**File + line:** `ExpandedBusinessEventSheet.tsx:268-279`

The only invalidation is `queryClient.invalidateQueries({queryKey: ["businessEventOrders", userId]})` — for the calendar, not Discover. So the post-claim regression is NOT caused by an over-broad invalidation cascade. The regression is purely the cache-hit short-circuit + tab-unmount race condition explained in R-1.

---

## FIVE-LAYER CROSS-CHECK

| Layer | What it says | Matches reality? |
|---|---|---|
| **Docs** | `INVESTIGATION_ORCH-0833_ALL_FILTER_NO_TM_REAL_DEVICE.md` Candidate R-4 explicitly predicted "this asymmetry between persisted TM and in-memory business events will eventually cause a different bug (probably 'wrong business events showing under wrong filter' if business events state leaks across filter changes)" — exactly what the operator is now reporting | **Predicted in advance — matches now-observed reality** |
| **Schema** | `events` table + `discover_merged_events` edge function unchanged since ORCH-0824. RLS unaffected. | Healthy |
| **Code (claim chain)** | `nativeCheckoutFlow.ts` returns `{outcome: "succeeded"}` for free; `ExpandedBusinessEventSheet.tsx` toasts, closes sheet, invalidates only `businessEventOrders`. No Discover state mutation. | Claim chain is innocent |
| **Code (DiscoverScreen)** | Cache shape is TM-only; cache hit short-circuit fires without re-fetching business events; `useState` is the storage for `businessEvents` (no persistence) | **Defect at lines 1017-1030 + 1115-1129 + 1039** |
| **Runtime (operator's real iPhone)** | Post-claim: filters oscillate between TM-only, business-only, and both — exactly the pattern R-1 predicts. Pre-claim: Metro log confirms both populated. | **Matches R-1 predicted blast radius** |
| **Runtime (sim live-fire attempted)** | Sim app launched (PID 68400); Metro running on :8081. Sim app build (Mingla.app @ 02:00 local) predates the post-ORCH-0834-rescoped bottom-sheet migration. Free-claim flow would still trigger the same DiscoverScreen R-1 path because R-1 is in code that has not changed since ORCH-0828 — but full 1:1 repro requires a sim dev build matching `Seth` HEAD. **Named blocker.** | Source confidence intact; runtime confidence pending sim rebuild |
| **Data (AsyncStorage)** | `nightOutCache_v2_<userId>_<cityKey>_<filters>` keys hold only TM venues. Confirmed by reading `saveNightOutCache` at lines 1041-1057. | **Matches code's stated behavior — half-cached by design** |

No contradictions between layers. R-1 explains the symptom completely.

---

## BLAST RADIUS

| Surface | Impact |
|---|---|
| **Consumer mobile Discover, solo mode** | Affected directly. Every claim → calendar → discover round-trip is at risk. |
| **Consumer mobile Discover, collab mode** | Not affected — collab mode is in a different code path (the Discover sheet routes to a collab session view, not back to Discover). |
| **Consumer mobile Calendar** | Not affected — `useBusinessEventOrders` uses React Query with proper invalidation. |
| **Business mobile** | Not affected — `mingla-business` has its own discovery / event-list code; not shared with consumer Discover. |
| **Admin dashboard** | Not affected — admin has no Discover surface. |
| **Other free-claim trigger paths** | If any other path navigates the user away from Discover after a claim (e.g., deep-link from a notification to a different screen), the same bug fires on return. Same root cause. |

**Other tabs that unmount Discover and cause the same symptom even WITHOUT a free claim:**
- Tap any non-Discover tab → return to Discover → same R-1 path. **The bug is not actually free-claim-specific** — claiming a free ticket is just the most natural reason a user navigates away (to see the ticket in Calendar). The regression has been latent the entire time and would surface on any Discover-tab-away-tab-back cycle. The new bottom-sheet bottom-sheet migration (ORCH-0834-rescoped) did not introduce it.

---

## INVARIANT VIOLATIONS

- **I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS** (codified ORCH-0828): empty/loading/error guards must consider BOTH `nightOutCards` AND `businessEvents`. Today's `showGrid` predicate at lines 1500-1516 correctly considers both arrays — but the CACHE-HIT short-circuit at 1115-1129 silently violates the invariant in spirit by populating only TM and leaving business events stale. The invariant covers the render-time empty-state check; it does not cover the data-loading-time short-circuit. The fix needs to extend the invariant.

**Proposed new invariant (to codify on CLOSE):** `I-PROPOSED-DISCOVER-CACHE-SYMMETRY` — any cache-restore short-circuit in DiscoverScreen MUST either (a) restore both `nightOutCards` AND `businessEvents` together, or (b) not short-circuit at all. CI gate: a `strict-grep` script that fails if `loadNightOutCache` is followed by `setNightOutCards` without `setBusinessEvents` in the same control-flow path.

---

## RECURRING-PATTERN CHECK

This is the second consumer-Discover regression in ORCH-0833 → ORCH-0835 lineage caused by the dual-state ownership of business-events vs TM-events in DiscoverScreen. The underlying architectural smell is: business events live in `useState` (ephemeral), TM events live in `useState` + AsyncStorage cache (half-persisted). A clean fix would migrate the merged-discover response to React Query (single source of truth, persisted, auto-invalidated). That is the "right" fix but is larger in scope than this regression demands.

**Bug class for the registry:** `dual-state-ownership-with-asymmetric-persistence`.

---

## FIX STRATEGY DIRECTION (NOT a spec — spec belongs to a separate dispatch)

Three paths, ranked by risk/reward:

**Path A — Minimum fix (recommended): condition the cache-hit short-circuit on `businessEvents.length > 0`.**

Replace lines 1115-1129 with:
```ts
if (
  cached &&
  cached.date === getTodayDateString() &&
  cached.venues.length > 0 &&
  cached.genre === selectedFilters.genre &&
  businessEvents.length > 0  // NEW — ensure in-memory business events are populated
) {
  setNightOutCards(cached.venues);
  setFallbackActive(cached.fallbackActive ?? false);
  setNightOutLoading(false);
  return;
}
```

This forces a fresh merged fetch on every remount (because `businessEvents=[]` after `useState` initial), which restores both arrays consistently. The TM cache still serves on within-session filter toggles where `businessEvents` is non-empty. Smallest possible change. ~5 lines including the eslint dep-array update for the `businessEvents` capture inside `useCallback`.

**Path B — Cache symmetry: extend the cache to persist business events alongside TM.**

Change `NightOutCache` shape:
```ts
interface NightOutCache {
  date: string;
  venues: NightOutCardData[];
  businessEvents: BusinessEventCardData[];  // NEW
  genre: string;
  fallbackActive: boolean;
}
```

Update `saveNightOutCache(cards, businessEvents, false)` and the cache-hit branch to call `setBusinessEvents(cached.businessEvents)`. Version-bump the cache prefix from `_v2_` → `_v3_` so old shape entries are invalidated. ~15 lines.

**Path C — Architectural: migrate merged-discover to React Query with persist.**

Lift `searchMerged` into a `useMergedDiscover(city, filters)` hook backed by React Query. The existing 24h AsyncStorage persist at `app-mobile/app/index.tsx:2986` covers it via `shouldDehydrateMinglaQuery`. Delete the manual AsyncStorage cache entirely. ~40-60 lines, touches one hook + DiscoverScreen + cache-eviction policy on logout (Constitution #6).

**Recommended: Path A** — solves the regression with minimum surface area. Path C is the right long-term answer but exceeds the scope of a regression patch; track as a hidden flaw to address in the next Discover refactor cycle.

Whichever path is taken, the SPEC must also address H-1 (cache key missing taxonomy facets) and H-2 (`tmError` silently swallowed). Adding `partyTypes` / `vibeTags` / `musicGenres` to the cache key is a one-line change; surfacing `tmError` to a small inline banner is a 5-line change. Both belong in the same fix to prevent recurrence.

---

## REGRESSION PREVENTION

1. **New CI gate (`orch-0835-regression-check.mjs`):** assert that `app-mobile/src/components/DiscoverScreen.tsx` contains either (a) `businessEvents.length > 0` in the cache-hit condition (Path A) OR (b) `setBusinessEvents(cached.businessEvents)` in the cache-hit body (Path B). Fail otherwise.
2. **Invariant codification:** add `I-PROPOSED-DISCOVER-CACHE-SYMMETRY` to `INVARIANT_REGISTRY.md` on CLOSE.
3. **Strict-grep registry entry:** add to `.github/workflows/strict-grep-mingla-business.yml` per the operator's standing pattern.
4. **One-paragraph PROTECTIVE COMMENT** at the top of the cache-hit branch explaining WHY the symmetry condition exists (citing ORCH-0833 R-4 and ORCH-0835).

---

## DISCOVERIES FOR ORCHESTRATOR

1. **The bug is NOT actually free-claim-specific.** Any tab unmount → Discover remount cycle triggers R-1. The free claim just makes it likely because users naturally navigate to Calendar to see their new ticket. Implementation report should reflect this — fix must not be scoped only to the claim flow.

2. **The R-4 hidden flaw from ORCH-0833 has materialized exactly as predicted.** This validates the original investigation's classification system and the practice of recording hidden flaws as Discoveries-for-Orchestrator. Worth a small CLOSE memo item.

3. **Discover's merged-discover state architecture is fragile by design** — `useState` for business events + half-persisted AsyncStorage for TM. The Path C refactor (React Query everything) is the right long-term answer. Track as a Cycle B5 / pre-launch hardening item.

4. **The Stripe forwardRef warning is unrelated to the PaymentSheet hang** — see companion `INVESTIGATION_ORCH-0836_STRIPE_FORWARDREF_REACT19_INCOMPAT.md`. Plan Z3 is dead. The PaymentSheet hang investigation needs a new ORCH-0837 to re-decide between Z1 / Z2 / X2.

---

## CONFIDENCE

**Probable** — root cause is source-traced (R-1 at `DiscoverScreen.tsx:1115-1129` + cache shape at 1017-1030 + cache key at 1039), matches the operator-described symptom (TM-only / Mingla-only / both / empty oscillation across filters), and matches the explicit R-4 prediction from `INVESTIGATION_ORCH-0833_ALL_FILTER_NO_TM_REAL_DEVICE.md`. Live-fire on iOS sim was attempted; the installed sim binary predates the post-ORCH-0834-rescoped EAS build and cannot 1:1 reproduce the bottom-sheet claim flow used on the operator's real device. Source-side proof and prior-investigation prediction are sufficient to proceed to SPEC at `probable` confidence per Prime Directive 7's "named blocker → probable not proven" rule.

**To promote to `proven`:** rebuild the dev sim binary to match `Seth` HEAD, complete a free claim end-to-end in the sim, observe the post-claim filter regression directly, and capture Metro logs showing the cache-hit short-circuit firing without a fresh merged fetch. Estimated effort: ~10 minutes for sim rebuild (per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md`) plus ~3 minutes for the live-fire repro.
