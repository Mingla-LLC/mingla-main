# INVESTIGATION — ORCH-0839: Consumer Discover filters + paid Mingla checkout residual regression

**Mode:** INVESTIGATE (read-only — no product code, no migrations, no deploys, no secret mutation)
**Investigator:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence:**
- **Discover filters root cause: `proven`** via direct edge-function probes (six-field evidence at `supabase/functions/ticketmaster-events/index.ts:521` + `:550-551`).
- **Mingla event date-window bugs (Friday-before-6pm, Monday-on-next-week): `proven`** via JS-arithmetic walkthrough against live `EXTRACT(DOW)` from the DB.
- **This Weekend / Next Week chip behaviour today (Thu 2026-05-14, dow=4): `proven`** via direct edge-function calls.
- **Stripe paid-checkout residual non-render: `probable`** via source + prior investigation lineage; awaiting fresh Metro-log capture from operator's real iPhone for `proven` (the operator's most recent reproducer message did not include a post-ORCH-0837-deploy log).

Operator symptoms restated verbatim from the dispatch (preserved untouched):
- consumer Discover filters **All**, **Tonight**, **This Weekend**, **Next Week**, and **This Month** do not filter both Ticketmaster and Mingla events correctly
- **All** can show only Mingla events
- other chips are stale / empty / wrong
- paid Mingla checkout still does not render the Stripe sheet

---

## 1. EXECUTIVE SUMMARY (read this first)

| Bucket | Verdict | Smallest correct next contract |
|---|---|---|
| **Discover "All" returns only Mingla event** | **PROVEN ROOT CAUSE** — `ticketmaster-events` has a 1-vs-0 pagination off-by-one with `discover-merged-events`. The merged function sends `page=1` (its default, 1-indexed); the TM cache-hit path treats `page` as 0-indexed (`pageNum = page ?? 0`) and does `events.slice(pageNum*pageSize, pageNum*pageSize+pageSize)` → `slice(20, 40)` on a 20-element cached array → `[]`. The TM response then carries `meta.totalResults: 140` but `events: []`. Merged endpoint reports `ticketmasterCount: 140` in meta yet returns 0 TM items in `items[]`. Mobile client sees 1 business event + 0 TM cards → "All shows only Mingla events." | Patch TM-events cache slice to slice from `events` correctly (treat the cached array as page 0, OR include `page` in the cache key, OR — cleanest — drop the in-function pagination entirely and cache+serve the raw upstream page). Bundle with a meta-vs-items consistency check (Constitution #3). |
| **Tonight / Tomorrow / Weekend / Next Week chips empty** | **PROVEN — same root cause** — cache-hit slice returns `[]` on every chip. `meta.ticketmasterCount` is whatever TM reported as `totalElements` (2, 7, 9, 40, etc.) but `events` is empty after the buggy slice. Compounded by: the only Raleigh Mingla event (`Big Party`) has `event_dates.start_at = 2026-05-14 20:00 UTC` = **16:00 EDT** (it started 2h before the operator's test window of 18:08 EDT), so `start_at >= now` excludes it from every dated chip. The user sees empty grids — the empty TM grid is the off-by-one, the missing Mingla card is the past-event exclusion. | Same TM-events fix. Separately, decide product behaviour for "event that already started today" — likely keep it in `Tonight` until `end_at` (not `start_at`) passes. Track as Discovery for Orchestrator. |
| **This Weekend chip on Fridays before 6 PM** | **PROVEN source-level bug** at `DiscoverScreen.tsx:217-230`. When `dayOfWeek === 5` and time < 18:00, `daysUntilFri = (5-5+7)%7 \|\| 7 = 0 \|\| 7 = 7` → `friday` advances to **next** Friday → window covers next weekend, not this weekend. Today (Thu, dow=4) the path is fine; the bug fires every Friday morning. | Replace `daysUntilFri = (5 - dayOfWeek + 7) % 7 \|\| 7` with explicit `daysUntilFri = dayOfWeek === 5 ? 0 : (5 - dayOfWeek + 7) % 7`. Add unit tests covering dow 0..6 + hour 0..23. |
| **Next Week chip on Mondays** | **PROVEN source-level bug** at `DiscoverScreen.tsx:231-239`. `(8 - dayOfWeek) % 7` on Monday (dow=1) yields `7 % 7 = 0` → next-monday equals today → window covers THIS Mon..Sun, not next week's Mon..Sun. Today (Thu, dow=4) the path returns `+4 days = Mon May 18` correctly. | Replace `(8 - now.getDay()) % 7` with `dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7`. Same unit tests. |
| **Cache cross-filter leakage (stale Mingla events stay when filter changes)** | **PROVEN LATENT** — ORCH-0835 added `businessEvents.length > 0` to the cache-hit predicate at `DiscoverScreen.tsx:1127-1132`. That guards remount, NOT in-session filter switches. After `Tonight` populates `businessEvents` and the user taps `This Month` (cache hit), `setNightOutCards(cached.venues)` runs but `setBusinessEvents` is never called — the prior filter's Mingla events stay on screen mismatched with the new filter's TM grid. | Extend `I-PROPOSED-DISCOVER-CACHE-SYMMETRY` to either (a) persist business events in the cache shape and restore them on hit, or (b) drop the cache short-circuit entirely (preferred — TM-events already has a server-side cache; AsyncStorage adds no measurable benefit). |
| **Cache key missing taxonomy facets** | **PROVEN HIDDEN FLAW** at `DiscoverScreen.tsx:1039`. `partyTypes`, `vibeTags`, `musicGenres` are not in the cache key. Currently all `[]` on remount so dormant, but any feature that persists facets will serve stale across facet changes. | Add the three slug arrays (sorted, joined) to the cache key, OR drop the cache. |
| **TM `tmError` silently swallowed** | **PROVEN Constitution #3 violation** at `discover-merged-events/index.ts:452-462` + `DiscoverScreen.tsx:1170-1180`. Edge function carries `meta.tmError`; client never reads it. | Surface `tmError` to an inline banner ("Live events temporarily unavailable") in the client. |
| **Meta-vs-items consistency** | **NEW PROVEN Constitution #3 violation** at `discover-merged-events/index.ts:457` + downstream merge. `tmTotal = tmRes.data.meta?.totalResults ?? tmItems.length` keeps `ticketmasterCount` reporting 140 even when items array is 0 (cache slice empty). This actively misleads the client and us. | When `tmItems.length === 0` and `tmTotal > 0`, treat as an error (TM call returned but events array dropped) — log + fall back to a stale-cache attempt + surface tmError. |
| **Paid Mingla checkout still doesn't render Stripe sheet** | **PROBABLE — class of bug previously identified** in `INVESTIGATION_ORCH-0833-0834-RESCOPED.md` and `INVESTIGATION_ORCH-0837_PAYMENTSHEET_HANG_THREE_HYPOTHESES.md`. ORCH-0837's three fixes (backend card-only PI, mobile `handleURLCallback` wiring, LogBox filter) all shipped to source AND the backend is live (verified `mcp__supabase__get_edge_function ticket-checkout-create v41` returns `payment_method_types: ['card']`). With card-only PI the Apple-Pay-merchant-validation hang (ORCH-0837 H4) cannot fire. The residual non-render therefore points to the **Stripe RN 0.65.1 + Expo SDK 54 newArchEnabled + bridgeless mode + iOS 26** incompatibility class flagged in `INVESTIGATION_ORCH-0833-0834-RESCOPED.md` Part A — Stripe RN's own CHANGELOG says "Compatible with new architecture when bridgeless mode is disabled." App has `newArchEnabled: true` in three places (`app-mobile/app.json:9,106,109`) → bridgeless ON by default in Expo SDK 54. | **Recommend: pivot iOS consumer paid flow to Stripe Hosted Checkout via `expo-web-browser`** (Option A from ORCH-0833-0834). The edge function's `surface="web"` branch already returns `hostedCheckoutUrl`. ~1 day implementation. Side-steps the native-bridge incompatibility entirely. Alternative: disable `newArchEnabled` (likely regresses other libraries). |

**Single recommended close sequence** for the next SPEC:
1. **Spec A (Discover)** — TM-events pagination fix + meta/items consistency check + chip date-window fixes (Friday-before-6pm, Monday-on-next-week) + DiscoverScreen cache-symmetry extension (cover cross-filter, not only remount) + cache key facets. ~1 day implementor effort. 100% server-side+client-source, no native config touched.
2. **Spec B (Checkout)** — Hosted-Checkout pivot via `expo-web-browser` per ORCH-0833-0834 Option A. ~1 day.
3. Ship Spec A first (Discover is the launch-blocker for "browse what's on"). Ship Spec B in parallel; OTA-update Spec A while Spec B awaits an EAS rebuild.

---

## 2. PHASE 0 — HISTORICAL INGEST RECEIPT

| Artifact | Claim that matters now | Status | Fresh evidence this session |
|---|---|---|---|
| `INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md` | merged endpoint partitions business + TM, business-first | **PROVEN STILL TRUE** | edge fn source `discover-merged-events/index.ts:476-486` unchanged; my direct probe confirms business events ranked first |
| `IMPLEMENTATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md` | DiscoverScreen partitions `merged.items` into `businessEvents` + `nightOutCards` | **PROVEN STILL TRUE** | `DiscoverScreen.tsx:1170-1180` unchanged |
| `INVESTIGATION_ORCH-0828_BRUTAL_RETEST_REPORT.md` (R1) | empty-state guards must check BOTH arrays per `I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS` | **PROVEN STILL TRUE** | `DiscoverScreen.tsx:1518-1534` correctly considers both arrays |
| `INVESTIGATION_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md` | timezone field forwarded to merged endpoint | **PROVEN STILL TRUE** | `nightOutExperiencesService.ts:258-281` forwards `timezone` (default `Intl.DateTimeFormat().resolvedOptions().timeZone`) |
| `INVESTIGATION_ORCH-0833_ALL_FILTER_NO_TM_REAL_DEVICE.md` (R4 hidden flaw) | "asymmetry between persisted TM and in-memory business events will eventually cause a different bug" | **MATERIALIZED, PARTIALLY ADDRESSED** | ORCH-0835 added `businessEvents.length > 0` guard which fixes the remount path BUT NOT the cross-filter cache-hit path |
| `INVESTIGATION_ORCH-0833-0834_FILTERS_REGRESSION_AND_RENDERING_ARCHITECTURE.md` | "Stripe RN 0.50.3 + newArchEnabled+bridgeless on iOS 26 is incompatible with native PaymentSheet" → "pivot iOS consumer paid flow to Stripe Hosted Checkout" (Option A) | **STILL UNADDRESSED — recommended again** | Stripe RN now 0.65.1 (per `app-mobile/package.json:41`) but CHANGELOG note about bridgeless persists; `newArchEnabled: true` everywhere in `app-mobile/app.json` |
| `INVESTIGATION_ORCH-0833-0834-RESCOPED_STRIPE_CONFIG_AND_ALL_FILTER_NO_TM.md` Part A | missing Stripe Expo plugin / `merchantIdentifier` / `urlScheme` were NOT root cause of hang; pivot to Hosted Checkout is the right answer | **STILL TRUE** — all three were added by ORCH-0834-rescoped but residual hang persists | Plugin in `app-mobile/app.json:84-91`; provider props in `app/_layout.tsx:72-75`; hang persists per operator's most recent report |
| `INVESTIGATION_ORCH-0833-0834-RESCOPED…` Part B | "All" filter no-TM probable cause was cache/TM-API blip | **SUPERSEDED** | This investigation proves the actual root cause: TM-events pagination off-by-one. The earlier "cache poisoning" hypothesis was directionally right but missed the precise mechanism. |
| `INVESTIGATION_ORCH-0835_FREE_CLAIM_BREAKS_DISCOVER_FILTERS.md` | post-claim filter regression is the cache-symmetry R-4 hidden flaw materializing | **PARTIALLY TRUE** | ORCH-0835's fix (the `businessEvents.length > 0` guard) addresses the **remount → empty businessEvents** path. It does NOT address **cross-filter in-session** cache hits where businessEvents has stale data from a prior filter. New finding here. |
| `INVESTIGATION_ORCH-0836_STRIPE_FORWARDREF_REACT19_INCOMPAT.md` | the forwardRef warning is unrelated to the PaymentSheet hang | **PROVEN STILL TRUE** | LogBox filter is live at `app/_layout.tsx:19-21`; warning silencing has no causal relationship to the present-sheet flow |
| `INVESTIGATION_ORCH-0837_PAYMENTSHEET_HANG_THREE_HYPOTHESES.md` (H2/H3 proven, H4 probable) | backend `automatic_payment_methods` + missing `handleURLCallback` + Apple-Pay-merchant-cert hang | **H2 + H3 ADDRESSED IN PRODUCTION**: deployed `ticket-checkout-create v41` sends `payment_method_types: ['card']` (verified via `mcp__supabase__get_edge_function`); `app/index.tsx:17,169,1808,1821` wire `handleURLCallback`. **H4 cannot fire with card-only PI** because Apple Pay isn't in the method list. **Residual non-render** therefore reverts to the older bridgeless/iOS26 incompat class. | This investigation. |
| `IMPLEMENTATION_ORCH-0835_0836_0837_BUNDLED.md` | all four edits + three CI gates + workflow registration shipped to source | **VERIFIED IN SOURCE** | grep confirms `businessEvents.length > 0` in cache predicate, LogBox filter, `useStripe`/`handleURLCallback` imports, and `payment_method_types: ['card']` in both local source AND deployed function v41 |
| `INVARIANT_REGISTRY.md` (current) | I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST, I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS, I-PROPOSED-DISCOVER-TM-SUPPRESSION, I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG, I-PROPOSED-STRIPE-CALLBACK-WIRED, I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES, I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE | all still respected in source | grep + source reads confirm |
| `ROOT_CAUSE_REGISTER.md` | catalogues earlier root causes by class | not contradicted by this investigation | — |

**Bottom line:** every prior "fixed" claim that shipped to source IS still in source AND deployed where applicable. The operator's residual symptoms are NEW root causes (the TM pagination off-by-one is the standout) plus residual unfixed prior classes (bridgeless/iOS26 Stripe native-render).

---

## 3. RUNTIME REPRODUCTION MATRIX

Direct edge-function probes from the investigator host (anon JWT, public discover-merged-events endpoint). All probes today 2026-05-14 ~22:08-22:11 UTC (= ~18:08-18:11 EDT). City = Raleigh, NC, US, segment=music, page=1, size=20, timezone=America/New_York.

| Chip | Mobile sends `localStartEndDateTime` | Merged response: `meta.businessCount` | Merged response: `meta.ticketmasterCount` | Merged response: `items[]` count | Items sources (first 5) |
|---|---|---|---|---|---|
| All | null | **1** | **140** | **1** | `['business_event']` |
| Tonight | `2026-05-14T18:10:00,2026-05-14T23:59:59` | 0 | 0 | 0 | [] |
| Tomorrow | `2026-05-15T00:00:00,2026-05-15T23:59:59` | 0 | **2** | **0** | [] |
| This Weekend | `2026-05-15T18:00:00,2026-05-17T23:59:59` | 0 | **7** | **0** | [] |
| Next Week | `2026-05-18T00:00:00,2026-05-24T23:59:59` | 0 | **9** | **0** | [] |
| This Month | `2026-05-14T18:10:00,2026-06-13T23:59:59` | 0 | **40** | varies (20 on cache-miss, 0 on cache-hit) | TM-only when populated |

**Mobile then partitions `merged.items` into `businessEvents` + `nightOutCards`.** With `items` containing only 1 business event for "All", `nightOutCards = []` and the grid shows just Big Party. Operator's "All shows only Mingla events" matches exactly.

For Tomorrow / Weekend / Next Week, `meta.ticketmasterCount` is 2 / 7 / 9 (non-zero) but the items array is empty — Constitution #3 silent failure.

Big Party (`event_dates.start_at = 2026-05-14 20:00 UTC = 16:00 EDT`) does NOT appear in dated chips because the `event_dates.start_at >= now` filter at `discover-merged-events/index.ts:329-331` correctly excludes it (the event started at 4 PM; probe time is 6:08 PM). On "All" (no date filter, `event_dates!left`), Big Party is the sole business item.

---

## 4. FILTER TRACE MATRIX BY CHIP (server-side)

### 4.1 The TM-events pagination off-by-one (PROVEN ROOT CAUSE)

**Direct evidence — same TM-events call, page=0 vs page=1:**

```
=== TM with page=0 ===
meta: { totalResults: 140, page: 0, pageSize: 20, totalPages: 1, fromCache: True }
events len: 20
first 3 names: ['In the End - Linkin Park Experience', 'Ben Folds & A Piano Tour', 'Insane Clown Posse']

=== TM with page=1 ===
meta: { totalResults: 140, page: 1, pageSize: 20, totalPages: 1, fromCache: True }
events len: 0
```

Same cache, same call, only `page` differs. `page=0` returns 20 events; `page=1` returns 0. **discover-merged-events sends `page=1` by default**, so it always gets 0.

**Six-field evidence:**

| Field | Value |
|---|---|
| **File + line** | `supabase/functions/discover-merged-events/index.ts:204` and `:445`; `supabase/functions/ticketmaster-events/index.ts:521`, `:550-551`, `:608-609` |
| **Exact code (merged)** | `const page = Math.max(1, body.page ?? 1);` → `tmPayload.page = page;` |
| **Exact code (TM, cache-hit slice)** | `const pageNum = page ?? 0; const start = pageNum * pageSize; const paginatedEvents = events.slice(start, start + pageSize);` |
| **What it does** | merged sends `page=1`, TM treats as 0-indexed, slices `events.slice(20, 40)` on a 20-element cached array → returns `[]`. Response carries `meta.totalResults: <original>` but events array is empty. |
| **What it should do** | One source of truth for page indexing. Easiest: TM-events does NOT slice on cache hit — the cached array IS the page-0 page; serve it as-is. Or remove `pageNum * pageSize` slicing entirely (cache write stores `result.events` from a single page fetch; cache-read should return that same page). |
| **Causal chain** | (1) DiscoverScreen calls `searchMerged` with no `page` field → merged endpoint defaults `page=1` → forwards `page=1` to TM-events. (2) TM-events on a cache hit slices `events.slice(20, 40)` on a 20-element cache → returns `[]`. (3) Merged endpoint reads `tmRes.data.events = []` and `meta.totalResults = 140` → assigns `tmItems = [], tmTotal = 140`. (4) Merge step `tmItems.slice(0, 19)` is `[]`. (5) Response: `items = [{source:'business_event', item:bigParty}]`, `meta.ticketmasterCount = 140`. (6) Client partitions into `businessEvents = [bigParty]`, `nightOutCards = []`. (7) Grid renders only Big Party — "All shows only Mingla events." |
| **Verification step** | The two-line probe above is the verification. Reproduce by sending the same merged-events body with explicit `page=0` — merged endpoint will still floor to 1 because of `Math.max(1, …)`, so the bug fires no matter what the client sends. |

**Why this got missed before:** the prior investigation (`INVESTIGATION_ORCH-0833-0834-RESCOPED…` Part B) hit fresh-fetch traffic where TM-events bypasses the buggy cache slice (returns `result.events` directly without slice when `fromCache=false`). The bug only surfaces on cache hits, which happens within seconds of the first call because the TM cache TTL is 2 hours and the cache table rows are written immediately. Most of the time on first-day testing, all calls hit cache and the bug is silent.

### 4.2 Same root cause — every dated chip

The cache slice is unconditional; it fires for every TM call regardless of date window. Tonight returns `totalResults=0` (legitimately zero events match the window). Tomorrow/Weekend/Next-Week have legit TM events at TM's end (2, 7, 9 respectively) but the client never sees any of them because of the slice.

The "This Month" chip occasionally shows TM events because:
- First probe (cache miss): TM API call goes out with `page=1` → TM API treats that as "page 2" in its 0-indexed URL → returns the events from TM's page 2 (typically 20 events) → cached → returned directly (fresh fetch bypasses slice)
- Second probe (cache hit): slice now fires → returns `[]` → user sees empty.

So "This Month" oscillates: sometimes 20 events (right after a cache write), sometimes 0 (cache hit afterwards). Matches operator's intermittent observation.

### 4.3 Date-window math bugs (proven, latent today)

| Chip | Source | Bug | Affected day-of-week |
|---|---|---|---|
| This Weekend | `DiscoverScreen.tsx:217-230` | `daysUntilFri = (5 - dow + 7) % 7 \|\| 7` → on `dow === 5` (Friday) before 18:00, `(5-5+7)%7 = 0 \|\| 7 = 7` → `friday` advances 7 days → window covers NEXT weekend. The trailing `\|\| 7` was intended to bump Saturday/Sunday past the just-past Friday but also catches Friday itself, since `0` is falsy. | Fridays before 18:00 |
| Next Week | `DiscoverScreen.tsx:231-239` | `monday.setDate(monday.getDate() + (8 - now.getDay()) % 7)` → on `dow === 1` (Monday), `(8-1)%7 = 0` → no advance → `monday` is today → window is current Mon..Sun, not next week's. | Mondays (full day) |

Today is Thursday (dow=4): `daysUntilFri = (5-4+7)%7 = 8%7 = 1`; `nextWeekDays = (8-4)%7 = 4`. Both correct for today; the bugs do not currently fire but will fire on every Friday morning and every Monday until patched. Cross-checked via Postgres: `SELECT EXTRACT(DOW FROM (NOW() AT TIME ZONE 'America/New_York'))::int` returns `4`.

The "This Month" math at `DiscoverScreen.tsx:240-247` is fine: `pair(now, now + 30 days)` — wider window, no DOW math.

### 4.4 Cache-key omission (latent today)

`DiscoverScreen.tsx:1039`:
```ts
const nightOutCacheKey = `${NIGHT_OUT_CACHE_KEY}_v2_${user?.id}_${nightOutCityKey}_seg:${selectedFilters.segment}_date:${selectedFilters.date}_gen:${selectedFilters.genre}`;
```

Missing: `partyTypes`, `vibeTags`, `musicGenres`. Currently always `[]` on remount (defensive override at lines 905-908), so dormant. Will break any future feature that persists facets across remounts.

### 4.5 Cross-filter in-session cache leakage (PROVEN NEW)

`DiscoverScreen.tsx:1127-1132` — the ORCH-0835 guard:
```ts
if (
  cached &&
  cached.date === getTodayDateString() &&
  cached.venues.length > 0 &&
  cached.genre === selectedFilters.genre &&
  businessEvents.length > 0       // ORCH-0835 guard
) {
  setNightOutCards(cached.venues);
  setFallbackActive(cached.fallbackActive ?? false);
  setNightOutLoading(false);
  return;
}
```

**This protects remount (businessEvents=[] from useState init).** It does NOT protect cross-filter in-session — `businessEvents` after a successful Tonight fetch is non-empty (Big Party or whichever Mingla event matched Tonight). Tap This Month → cache key changes → if This Month has a populated cache → hits this branch → `setNightOutCards(This-Month-TM-from-cache)` + `setBusinessEvents(NEVER CALLED)` → Big Party (from Tonight) stays on screen, but TM grid is This Month's. Mismatched.

This is the bug class `dual-state-ownership-with-asymmetric-persistence` originally flagged in `INVESTIGATION_ORCH-0833_ALL_FILTER_NO_TM_REAL_DEVICE.md` §"R-4 hidden flaw." ORCH-0835 closed one face of it; the other face remains.

### 4.6 Meta-vs-items consistency (PROVEN Constitution #3)

`discover-merged-events/index.ts:452-462`:
```ts
} else if (tmRes.data && Array.isArray(tmRes.data.events)) {
  tmItems = tmRes.data.events;
  tmTotal = tmRes.data.meta?.totalResults ?? tmItems.length;
}
```

`tmTotal` is set from `meta.totalResults` regardless of whether `tmItems` is empty. When the TM-events pagination bug returns `events: []` with `meta.totalResults: 140`, the merged endpoint propagates `ticketmasterCount: 140` to the client even though `items[]` has zero TM cards. The client (and us, until we ran the direct probe) sees "140 TM events were available" alongside an empty TM grid and gets misled.

### 4.7 TM `tmError` silently swallowed

`DiscoverScreen.tsx:1170-1180` reads only `merged.items`. `merged.meta.tmError` is never inspected. If TM API fails (rate limit, transient 5xx, network blip), the client shows an empty TM grid with zero diagnostic surface for the user.

---

## 5. TICKETMASTER SOURCE-OF-TRUTH MATRIX

Direct probes against `ticketmaster-events` (same city + segment, varying `page`).

| Probe | `page` | `meta.totalResults` | `meta.totalPages` | `meta.fromCache` | `events[]` count |
|---|---|---|---|---|---|
| Direct TM (no date) page=0 | 0 | 140 | 1 | true | **20** |
| Direct TM (no date) page=1 | 1 | 140 | 1 | true | **0** |
| Direct TM (Tonight) page=1 | 1 | 0 | 0 | true | 0 |
| Direct TM (Tomorrow) page=1 | 1 | 2 | 0 | true | 0 |
| Direct TM (Weekend) page=1 | 1 | 7 | 0 | true | 0 |
| Direct TM (Next Week) page=1 | 1 | 9 | 0 | true | 0 |
| Direct TM (This Month) page=1 | 1 | 40 | 1 | true | 0 |

**DB cache table inspection** (`SELECT cache_key, total_results, jsonb_array_length(events), fetched_at FROM ticketmaster_events_cache WHERE cache_key ILIKE '%raleigh%' ORDER BY fetched_at DESC`):

| Cache key fragment | `total_results` | `events_in_cache` |
|---|---|---|
| `…dt:any` (All) | 140 | **20** |
| `…dt:local:2026-05-14T18:10:00,2026-06-13…` (This Month) | 40 | **20** |
| `…dt:local:2026-05-15T18:00:00,2026-05-17…` (Weekend) | 7 | **0** |
| `…dt:local:2026-05-18T00:00:00,2026-05-24…` (Next Week) | 9 | **0** |
| `…dt:local:2026-05-15T00:00:00,2026-05-15…` (Tomorrow) | 2 | **0** |
| `…dt:local:2026-05-14T..,2026-05-14T23:59:59` (Tonight) | 0 | 0 |

The cache row for "All" stores 20 events. The slice-on-cache-hit reads `events.slice(20, 40)` on that 20-element array → returns `[]`. Caching shape stable; serving logic off-by-one. Cache-key shape is correct (excludes `page`), so the bug is ONLY in the read-side slice.

For chips where `events_in_cache: 0` (Tomorrow / Weekend / Next Week), the TM API itself returned 0 events on the page=1 call (TM treats page=1 as the second page; if the window has only 2/7/9 events total, page 2 is empty by definition). The bug is the same: `discover-merged-events` should send `page=0` (or TM-events should not page-shift).

---

## 6. MINGLA BUSINESS EVENT SOURCE-OF-TRUTH MATRIX

Direct DB read (service-role, `mcp__supabase__execute_sql`):

```sql
SELECT e.id, e.title, e.city, e.status, e.visibility, e.party_types, e.vibe_tags,
       e.music_genres, e.timezone, e.currency, ed.start_at, ed.is_master,
       b.name AS brand_name, b.deleted_at AS brand_deleted
FROM events e
JOIN brands b ON b.id = e.brand_id
LEFT JOIN event_dates ed ON ed.event_id = e.id
WHERE e.deleted_at IS NULL
  AND e.visibility = 'public'
  AND e.status IN ('scheduled','live')
  AND e.city ILIKE '%Raleigh%'
ORDER BY ed.start_at;
```

Returned: **1 row** — `Big Party / Leggo This / Raleigh / scheduled / start_at = 2026-05-14 20:00 UTC` (= 16:00 EDT). `is_master = true`. `party_types = ['club-night']`, `vibe_tags = []`, `music_genres = []`, `timezone = America/New_York`, `currency = USD`. Brand active.

Total active public Mingla events across all cities: **8** (all in `America/New_York` timezone).

**Why "All" shows Big Party but every dated chip excludes it:**
- Edge function uses `event_dates!inner` when `dateWindowUtc` is non-null and filters `start_at >= startUtc AND start_at <= endUtc`.
- Tonight startUtc = now (22:09 UTC). Big Party start_at = 20:00 UTC. **Big Party < now → excluded** by `gte`.
- Tomorrow / Weekend / Next-Week / This-Month windows all start at or after `now` (today 18:09 EDT). Big Party `16:00 EDT` is before all of them.
- All uses `event_dates!left` (no date filter) → Big Party included regardless.

This is **correct** by the edge function's own contract — but the operator likely expected Big Party to appear under "Tonight" since it's happening tonight (4 PM). Product call: should chips use `end_at` instead of `start_at` for the lower bound? Recommend yes (a 7 PM concert that started at 4 PM is still tonight's plan). Track as Discovery for Orchestrator.

---

## 7. CLIENT STATE / CACHE / RENDERING TRACE

### 7.1 Cache shape and cache key

```ts
interface NightOutCache {
  date: string;                  // calendar-day TTL gate
  venues: NightOutCardData[];    // TM only, business events NEVER persisted
  genre: string;
  fallbackActive: boolean;
}
const nightOutCacheKey = `${NIGHT_OUT_CACHE_KEY}_v2_${user?.id}_${nightOutCityKey}_seg:${segment}_date:${date}_gen:${genre}`;
```

Asymmetric: TM persists, business events live in `useState` only. ORCH-0835 added the `businessEvents.length > 0` guard which prevents the remount-with-empty-state-cache-hit symptom but does NOT cover cross-filter switches.

### 7.2 Partition + render

`DiscoverScreen.tsx:1170-1180`:
```ts
const bizItems: BusinessEventCardData[] = [];
const tmVenues: NightOutVenue[] = [];
for (const it of merged.items as MergedDiscoverItem[]) {
  if (it.source === "business_event") bizItems.push(it.item);
  else tmVenues.push(it.item);
}
setBusinessEvents(bizItems);
setFallbackActive(false);
const cards = tmVenues.map(transformNightOutVenue);
setNightOutCards(cards);
saveNightOutCache(cards, false);
```

Partition logic correct. `saveNightOutCache` only persists `cards` (TM) — the asymmetry that creates cross-filter leakage downstream.

### 7.3 Grid guards

`DiscoverScreen.tsx:1518-1534`:
```ts
const hasCache = nightOutCards.length > 0 || businessEvents.length > 0;
const showLoadingSkeleton = nightOutLoading && nightOutCards.length === 0 && businessEvents.length === 0;
const showError = !nightOutLoading && nightOutError !== null && !hasCache;
const showEmpty = !nightOutLoading && !nightOutError && nightOutCards.length === 0 && businessEvents.length === 0;
const showFilterNoMatch = !nightOutLoading && !nightOutError && (nightOutCards.length > 0 || businessEvents.length > 0) && filteredNightOutCards.length === 0 && businessEvents.length === 0;
const showGrid = !showLoadingSkeleton && !showError && !showEmpty && !showFilterNoMatch;
```

`I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS` honored — both arrays inspected in every branch. **However:** `showFilterNoMatch` is effectively unreachable because `filteredNightOutCards = [...nightOutCards].sort(…)` so `filteredNightOutCards.length === nightOutCards.length` always. Minor dead branch — not the bug operator is hitting, but worth simplifying.

### 7.4 Stale Zustand snapshot? (No)

`useAppStore.getState().discoverFilters` is read once at mount via `useMemo([])` (line 896). Snapshot then drives `selectedFilters`'s initial state. Taxonomy facets explicitly reset to `[]` (defensive). So Zustand cannot poison facet state across remounts today.

---

## 8. PAID CHECKOUT TRACE

### 8.1 Backend deployment verified

`mcp__supabase__get_edge_function ticket-checkout-create` returns **version 41**, deployed 2026-05-14, file content shows `payment_method_types: ["card"]` at line 348 of the deployed function. The legacy `automatic_payment_methods: { enabled: true }` form is **NOT present** in production. CI gate `orch-0837-regression-check.mjs` T-C0 + T-C1 enforce this in source.

### 8.2 Mobile source verified

- `app/_layout.tsx:5,19-21` — LogBox.ignoreLogs for the forwardRef warning (ORCH-0836)
- `app/_layout.tsx:72-75` — StripeNativeProvider with `merchantIdentifier="merchant.com.mingla.app.v2"` and `urlScheme="com.mingla.app.v2"` (ORCH-0834-rescoped + I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG)
- `app/index.tsx:17` — `import { useStripe } from "@stripe/stripe-react-native"`
- `app/index.tsx:169` — `const { handleURLCallback } = useStripe()` (inside `AppContent`, descendant of `StripeNativeProvider`)
- `app/index.tsx:1803-1835` — Linking listener with `handleURLCallback(url)` FIRST, fall-through to `handleDeepLink` only if Stripe returns false; try/catch wraps the call (Constitution #3 honored)
- `packages/payments-native/useStripePaymentSheet.ts:91-163` — once-only guard + 60s `withTimeout` race intact (`I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE`)
- `app-mobile/package.json:41` — `"@stripe/stripe-react-native": "^0.65.1"` (the post-ORCH-0834-rescoped upgrade)
- `app-mobile/app.json:9, 106, 109` — `newArchEnabled: true` in three places (Expo SDK 54 + iOS + Android)
- `app-mobile/app.json:84-91` — `@stripe/stripe-react-native` Expo plugin with merchantIdentifier + enableGooglePay

### 8.3 Residual hang surface

With ORCH-0837 H2 + H3 fixed in production AND card-only PI excluding Apple Pay (so H4 Apple-Pay-merchant-cert validation can't fire either), the most likely remaining cause is the **bridgeless-mode + Stripe-RN-native-PaymentSheet + iOS 26** incompat class previously flagged in `INVESTIGATION_ORCH-0833-0834-RESCOPED.md` Part A:

- Stripe RN 0.65.1 CHANGELOG line 101: "Compatible with new architecture when bridgeless mode is disabled."
- Expo SDK 54 default with `newArchEnabled: true` is bridgeless ON.
- Symptom signature matches operator's earlier real-device Metro logs: `initPaymentSheet ← resolved error= none` (init is a config-only call, doesn't touch UIKit modal) followed by `presentPaymentSheet → native call` with no resolution → 60s synthetic timeout fires.

**Cannot be `proven` from source alone for THIS investigation** because:
1. The operator's most recent dispatch message ("paid Mingla checkout still does not render the Stripe sheet") did not include a fresh Metro log post-ORCH-0837 deploy. We don't have a 2026-05-14 post-deploy log proving `presentPaymentSheet → native call` is the line that hangs.
2. Even if we had it, source-alone cannot distinguish bridgeless incompat from (e.g.) a missing publishable key at runtime, a stale EAS bundle that doesn't have the ORCH-0837 client-side changes, or a transient TestFlight issue.

**Named blocker:** one fresh Metro log capture from operator's iPhone of a paid-checkout attempt against the post-ORCH-0837 build would promote this to `proven`. Specifically the lines around `initPaymentSheet ← resolved` and `presentPaymentSheet → native call` and the 60-second-later `presentPaymentSheet timed out after 60000ms`.

### 8.4 Why the Hosted Checkout pivot is recommended regardless

Even if the operator's residual hang turns out to be something else (e.g. stale bundle), the bridgeless+native incompat is a **structural** risk for iOS 26 users going forward. Stripe's own documentation ranks Hosted Checkout above native PaymentSheet (`stripe-best-practices/references/payments.md`). The edge function already supports the `surface="web"` branch returning `hostedCheckoutUrl`. The native client just needs to call it via `expo-web-browser.openAuthSessionAsync`. Mature module already in `package.json`. Side-steps every native-bridge failure mode for paid checkout.

The defense-in-depth wins from ORCH-0829-B (RPC tombstone-expiry + try/finally + 60s timeout race) and ORCH-0837 (card-only PI + handleURLCallback) stay in place for any residual native PaymentSheet usage (e.g. future mingla-business creator-side paid flows).

---

## 9. FIVE-TRUTH-LAYER CROSS-CHECK

| Layer | What it says | Matches reality? |
|---|---|---|
| **Docs / Specs** | ORCH-0824 spec: business-first merge, both arrays survive; ORCH-0828: timezone forwarded, both arrays in guards; ORCH-0835: cache-symmetry on remount; ORCH-0837: card-only PI + handleURLCallback wired; ORCH-0833-0834: pivot to Hosted Checkout if native PaymentSheet hangs | All shipped to source. Hosted Checkout pivot remains UNSHIPPED. |
| **DB Schema** | events / event_dates / brands / ticket_types / ticketmaster_events_cache all healthy. RLS unchanged from ORCH-0700/ORCH-0824 baselines. Big Party row valid. | Direct DB probes confirm. |
| **Code (mobile)** | `DiscoverScreen.tsx` cache predicate, partition, guards all match ORCH-0824/0828/0835 source spec. Cross-filter cache leakage is a documented gap not closed by ORCH-0835. Date-window math has Friday-before-6pm and Monday-on-next-week bugs. `app/index.tsx` Linking listener routes URLs through `handleURLCallback` first. | **Matches except for date-window bugs and cross-filter leakage gap.** |
| **Code (edge functions)** | `discover-merged-events` deployed v3 → merge logic correct, TM suppression rules correct. **Sends `page=1` to TM-events.** `ticket-checkout-create` deployed v41 → `payment_method_types: ['card']` confirmed. `ticketmaster-events` deployed v166 → **cache-hit path uses `events.slice(pageNum * pageSize, …)` which is the off-by-one with merged**. | **TM-events pagination bug proven via direct probes.** |
| **Runtime (this session)** | Direct probes against Raleigh+music: All → 1 business + 0 TM (operator's reported "All shows only Mingla"); Tonight → 0+0; Tomorrow/Weekend/Next-Week → 0 items despite `ticketmasterCount` 2/7/9; This Month → 20 on miss, 0 on hit. Backend health: TM API itself returned 140 total for All (TM service alive). | **All operator symptoms reproduce server-side. The "operator real device" layer is consistent.** |
| **Persisted data** | `ticketmaster_events_cache` rows: `events_in_cache=20` for All + This Month, `events_in_cache=0` for narrow chips. Cache write logic stores `result.events` correctly; cache read logic slices off-by-one. AsyncStorage on mobile holds half-cache (TM only) — same asymmetry as before ORCH-0835. | **Cache contents consistent with the off-by-one read path.** |

Layers agree. The two-layer disagreement is between "Code (edge functions): correct merge logic" and "Runtime: empty TM items in response" — proven cause is the off-by-one slice on the TM-events side.

---

## 10. CLASSIFIED FINDINGS

### 🔴 P0 — Root cause R-1 (Discover): TM-events pagination off-by-one — **PROVEN**
**Owner:** `supabase/functions/ticketmaster-events/index.ts:521` (`pageNum = page ?? 0`) and `:550-551`/`:608-609` (`events.slice(pageNum * pageSize, …)`) interacting with `supabase/functions/discover-merged-events/index.ts:204` (`page = Math.max(1, body.page ?? 1)`) and `:445` (forwards `page` to TM-events).
**Evidence:** Section 4.1 six-field; direct probes with `page=0` returning 20 events and `page=1` returning 0 against the same cache row.
**Fix direction:** Treat the cached `events` array as page-0 content and serve it without slicing OR include `page` in the cache key OR (cleanest) drop the slice and let the caller send `page=0`-aligned requests. Don't fix only on one side.

### 🔴 P0 — Root cause R-2 (Discover): TM-meta misreports `ticketmasterCount` when slice empties events — **PROVEN**
**Owner:** `discover-merged-events/index.ts:457` (`tmTotal = tmRes.data.meta?.totalResults ?? tmItems.length`).
**Evidence:** Section 4.6. Multiple chips return `meta.ticketmasterCount > 0` with `items[]` containing zero TM rows. Constitution #3 violation — silent failure surfaces a misleading total.
**Fix direction:** When `tmItems.length === 0 && tmTotal > 0`, treat as a failed response — log + populate `meta.tmError` + return `meta.ticketmasterCount: 0`.

### 🔴 P0 — Root cause R-3 (Discover): Friday-before-6pm `This Weekend` math skips current weekend — **PROVEN**
**Owner:** `DiscoverScreen.tsx:217-230`.
**Evidence:** Section 4.3. `(5-5+7)%7 \|\| 7 = 7` on Fridays before 18:00.
**Fix direction:** Explicit branch on `dayOfWeek === 5` to set `daysUntilFri = 0` (today is Friday — start at "now" or 18:00 whichever first) before falling through to the `% 7` math.

### 🔴 P0 — Root cause R-4 (Discover): Monday `Next Week` includes current week — **PROVEN**
**Owner:** `DiscoverScreen.tsx:231-239`.
**Evidence:** Section 4.3. `(8-1)%7 = 0` on Mondays.
**Fix direction:** Branch `dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7` so Monday advances a full week, not zero.

### 🟠 P1 — Contributing factor C-1 (Discover): Cross-filter in-session cache leakage — **PROVEN**
**Owner:** `DiscoverScreen.tsx:1127-1132`. ORCH-0835 guard covers remount only.
**Evidence:** Section 4.5. `setNightOutCards(cached.venues)` on cross-filter cache hit leaves `businessEvents` set to the prior filter's Mingla events.
**Fix direction:** Cleanest = drop the AsyncStorage cache short-circuit (TM-events already caches server-side; the mobile cache is a half-cache that creates symmetry bugs). Alternative = persist `businessEvents` alongside `venues` and restore both on hit (Path B from ORCH-0835 SPEC).

### 🟡 P2 — Hidden flaw HF-1 (Discover): Cache key omits taxonomy facets — **PROVEN LATENT**
**Owner:** `DiscoverScreen.tsx:1039`.
**Evidence:** Section 4.4. Hardcoded `[]` on remount (lines 905-908) keeps this dormant; future feature persisting facets will trip it.
**Fix direction:** Sort + join the three slug arrays into the cache key.

### 🟡 P2 — Hidden flaw HF-2 (Discover): `tmError` swallowed — **PROVEN**
**Owner:** `DiscoverScreen.tsx:1170-1180` reads only `merged.items`; ignores `merged.meta.tmError`.
**Evidence:** Section 4.7. Constitution #3 violation.
**Fix direction:** Surface `tmError` to an inline banner or toast.

### 🟠 P1 — Contributing factor C-2 (Checkout): Stripe RN 0.65.1 + Expo SDK 54 newArch+bridgeless + iOS 26 — **PROBABLE**
**Owner:** `app-mobile/package.json:41` (`@stripe/stripe-react-native@^0.65.1`) interacting with `app-mobile/app.json:9,106,109` (`newArchEnabled: true`).
**Evidence:** Section 8.3. Stripe RN's own CHANGELOG flags incompatibility with bridgeless. Expo SDK 54 defaults bridgeless ON when newArch enabled. Symptom signature matches operator's earlier `init → resolved error=none` + `present → native call` + 60s timeout pattern.
**Fix direction:** Pivot iOS consumer paid flow to Stripe Hosted Checkout via `expo-web-browser.openAuthSessionAsync(hostedCheckoutUrl)`. The edge function's `surface="web"` branch already returns the URL. Sidesteps the native bridge entirely.

### 🟡 P2 — Hidden flaw HF-3 (Discover product): Big Party excluded from "Tonight" because `start_at < now` — **PROVEN**
**Owner:** `discover-merged-events/index.ts:329-331` (`gte("event_dates.start_at", dateWindowUtc.startUtc)`).
**Evidence:** Section 6. Big Party started 4 PM, probe at 6:08 PM; correctly excluded by `start_at >= now`. User expectation: a 4 PM concert is still "tonight's plan" at 6 PM.
**Fix direction:** Product decision. Recommend filtering on `end_at >= now` for the lower bound (event hasn't ended) rather than `start_at >= now` (event hasn't started). Track as separate ORCH if approved.

### 🟡 P2 — Hidden flaw HF-4 (Discover): `showFilterNoMatch` unreachable — **PROVEN**
**Owner:** `DiscoverScreen.tsx:1527-1532`. `filteredNightOutCards.length === nightOutCards.length` always (just a sort).
**Evidence:** Section 7.3.
**Fix direction:** Remove the dead branch or repurpose it for an actual narrowing filter when one lands.

### 🔵 P4 — Observation O-1: ORCH-0835/0836/0837 bundle is fully landed
- DiscoverScreen cache-symmetry guard: present (line 1132)
- LogBox forwardRef filter: present (`app/_layout.tsx:19-21`)
- Card-only PI: deployed (function v41)
- `useStripe`/`handleURLCallback` wiring: present (`app/index.tsx:17, 169, 1808, 1821`)
- StripeProvider full config: present (`app/_layout.tsx:72-75`)
- All ORCH-08xx CI gates exist and pass per implementation report
- The operator's residual symptoms are NEW root causes (R-1, R-2, C-1) or pre-existing classes not yet addressed (C-2, HF-3), not regressions of the closed work.

### 🔵 P4 — Observation O-2: `useStripePaymentSheet` 60s timeout safety net is intact
The defensive timeout race remains in place at `packages/payments-native/useStripePaymentSheet.ts:62-89`. If Hosted Checkout takes over, this stays as belt-and-suspenders for any residual native PaymentSheet usage.

### 🔵 P4 — Stale prior claim
`INVESTIGATION_ORCH-0833_ALL_FILTER_NO_TM_REAL_DEVICE.md` Candidate R-3 ("React Query / AsyncStorage cache poisoning specific to real device") — **superseded**. The actual root cause is server-side TM-events pagination, not device-local cache poisoning. The mobile AsyncStorage cache is half-asymmetric (the cross-filter leakage), but it's a contributing factor not the primary cause of the "no TM" symptom.

---

## 11. BLAST RADIUS

| Surface | Impact |
|---|---|
| **Consumer mobile Discover (solo)** | Every chip on every device, every city. **Primary launch-blocker for Discover.** |
| **Consumer mobile Discover (collab)** | Same code path → same impact. |
| **Mingla business mobile** | No Discover surface. Unaffected. |
| **Admin dashboard** | No Discover surface. Unaffected. |
| **Web checkout** | `surface="web"` path unaffected by ALL of these findings. Hosted Checkout for paid web buyers continues to work. |
| **Free-ticket checkout** | Unaffected — bypasses the Stripe PI flow entirely. |
| **Paid mobile checkout** | Card-only PI is deployed and correct. The residual non-render is a separate class (Stripe RN + bridgeless + iOS 26). |
| **Calendar / saved tab** | Unaffected. |
| **Webhooks / order finalization** | Unaffected — backend continues to process orders correctly. |
| **CI strict-grep registry** | All existing gates (orch-0828/0829-A/0829-B/0834-rescoped/0835/0836/0837) continue to pass. The Discover filter bugs are not caught by the current gates — new gates will be needed in the next SPEC. |

---

## 12. RECURRING PATTERN ANALYSIS

This is the **third** Discover/Ticketmaster regression in 2026-05. Common thread: **assumption mismatches between edge functions** (page-indexing, meta-vs-items, cache-key shape, mobile↔server clock semantics) that source-only review misses because the helpers look correct in isolation.

Recurring bug class: **inter-edge-function contract drift** — `discover-merged-events` and `ticketmaster-events` were written at different times by different threads; the merged endpoint moved to 1-indexed pages without updating the TM helper. A SPEC for the new Discover hardening cycle should require explicit shared-contract types (TS interface or JSON Schema) for every cross-function call, with a CI gate that validates handler input/output against the shared schema.

Recurring bug class (mobile-side): **dual-state-ownership-with-asymmetric-persistence** — Discover keeps business events in `useState` and TM in `useState`+`AsyncStorage`. This is the third manifestation (R-4 → ORCH-0835 → today's cross-filter leakage). The architectural answer is Path C from `INVESTIGATION_ORCH-0835_FREE_CLAIM_BREAKS_DISCOVER_FILTERS.md` §"Fix Strategy Direction" — migrate merged-discover to React Query with persist, single source of truth.

---

## 13. UX / DESIGN ACCEPTANCE RISKS (for the SPEC's `ui-ux-mingla` gate)

| Risk | Mitigation needed in SPEC |
|---|---|
| User cannot tell whether a filter returned zero events legitimately vs because the system glitched | Empty-state copy that distinguishes "No events match" from "Live events temporarily unavailable" (`tmError != null`). |
| User taps "All" and sees only Mingla events with no diagnostic surface | Same — surface `tmError`. After R-1 fixed, "All" should always show both (TM is alive for Raleigh+music). |
| User taps "This Weekend" on Friday morning and sees next weekend's events with no indication | Title bar should display the actual window ("Fri 8 May 6 PM → Sun 10 May") so the user can see what's being queried. Alternative: when the system would advance to next weekend, suppress the chip's auto-advance and include today (current Friday) explicitly. |
| Event that started 2 hours ago disappears from `Tonight` | Use `end_at >= now` instead of `start_at >= now` for the lower-bound filter (HF-3). |
| Empty grid after filter change leaves operator unable to tell whether they tapped a filter, the network is slow, or the data is gone | Always show a brief loading skeleton on filter change (already implemented). Ensure the loading state doesn't get hidden by a stale cache hit. |

---

## 14. REGRESSION TEST REQUIREMENTS (for the SPEC's future implementation)

| Test | Layer | What it asserts | Repo-running? |
|---|---|---|---|
| TM-events page-0 vs page-1 returns deterministic events | Deno test in `supabase/functions/ticketmaster-events/_tests_/` | Same cache key + page differing → output `events` array reflects correct slice (page 0 returns first N, page 1 returns next N) OR cache stores per-page | YES |
| `discover-merged-events` items.length never < `meta.ticketmasterCount` when items contains 0 TM and meta says >0 | Deno integration test | When TM returns events:[] meta:{totalResults:N}, merged endpoint either logs+returns ticketmasterCount=0 OR retries fetch | YES |
| DiscoverScreen `getDateRange` covers every DOW + key hour for every chip | Jest in `app-mobile/scripts/ci/` | Per-chip per-day-of-week assertions — Friday 17:00 returns this weekend, not next; Monday 09:00 returns next week's Mon..Sun, not current | YES |
| DiscoverScreen cache key includes all response-affecting filter dimensions | strict-grep gate | grep that `partyTypes`, `vibeTags`, `musicGenres` appear in the cache-key template | YES |
| DiscoverScreen cache-symmetry on cross-filter switch | RTL test or Maestro flow | Tap Tonight → tap Month → assert `businessEvents` reflects Month's response, not Tonight's | YES (RTL) / manual (Maestro) |
| Paid checkout opens Hosted Checkout in `expo-web-browser` and returns to app | Maestro flow + backend integration | After Hosted Checkout pivot SPEC: tap Buy → expo-web-browser opens → complete with 4242 → app returns → calendar shows ticket | Manual (tester gate) |

The first three are pure-server / pure-client unit tests and SHOULD ship alongside the fix in CI. The last two require a tester live-fire gate.

---

## 15. RECOMMENDED NEXT DISPATCH

**Spec A (Discover server + client hardening)** — Claude `mingla-forensics` (SPEC mode). Input: this investigation. Output: `Mingla_Artifacts/specs/SPEC_ORCH-0839-A_DISCOVER_TM_PAGINATION_AND_FILTER_MATH.md` covering:
1. `ticketmaster-events` pagination fix (drop slice OR include page in cache key OR add explicit page assertion in tests)
2. `discover-merged-events` meta/items consistency (treat events:[] + totalResults>0 as failure)
3. `DiscoverScreen.tsx` date-window math fixes (Friday-before-6pm, Monday-on-next-week) + unit tests
4. `DiscoverScreen.tsx` cross-filter cache leakage — either drop AsyncStorage cache or persist both arrays
5. `DiscoverScreen.tsx` cache key facets
6. Optional: `discover-merged-events` `end_at >= now` lower bound (operator-decision)
7. CI gates: TM-events page semantics test, merged meta-consistency, date-window unit tests
8. UX: surface `tmError` to an inline banner; distinct empty-state copy

**Spec B (Stripe Hosted Checkout pivot)** — Claude `mingla-forensics` (SPEC mode) — separate dispatch. Input: this investigation + `INVESTIGATION_ORCH-0833-0834…` Part A Option A. Output: `Mingla_Artifacts/specs/SPEC_ORCH-0839-B_PAID_CHECKOUT_HOSTED_PIVOT.md`. Per ORCH-0833-0834 Option A — `nativeCheckoutFlow.ts` pivots to `surface="web"` + `expo-web-browser.openAuthSessionAsync` for paid path; free path unchanged. The ORCH-0837 backend changes (card-only PI) and mobile changes (handleURLCallback wiring) stay in place as belt-and-suspenders.

**Operator decision points for the orchestrator to capture:**
- Should "Tonight" filter include events that have already started but not ended (HF-3)? (Recommend yes.)
- Path A (drop mobile AsyncStorage cache) vs Path B (persist both arrays) for cross-filter leakage? (Recommend Path A — TM-events already caches server-side; mobile half-cache is the bug source.)
- Should Spec A and Spec B be bundled (one PR Seth→main with both fixes) or shipped sequentially (Spec A OTA, then Spec B with EAS rebuild)? (Recommend sequential — Discover is the launch-blocker for "browse what's on" and is fully OTA-able; Hosted Checkout pivot requires EAS rebuild and can ship the next morning.)

---

## 16. CONFIDENCE SUMMARY

| Finding | Confidence | Source |
|---|---|---|
| R-1 (TM-events pagination off-by-one) | **PROVEN** | Direct edge probes (page=0 → 20 events; page=1 → 0 events on same cache) + source-line evidence at TM-events:521 + merged:204 |
| R-2 (meta vs items inconsistency) | **PROVEN** | Direct edge probes showing `meta.ticketmasterCount` 2/7/9/140 with `items` count 0 |
| R-3 (Friday weekend math) | **PROVEN** | Source-line walkthrough of `(5-5+7)%7 \|\| 7` |
| R-4 (Monday next-week math) | **PROVEN** | Source-line walkthrough of `(8-1)%7 = 0` |
| C-1 (cross-filter cache leakage) | **PROVEN** | Source read of cache-hit branch; `setBusinessEvents` is missing in that branch; ORCH-0835 guard only covers remount |
| HF-1 (cache key facets) | **PROVEN LATENT** | Source line |
| HF-2 (tmError swallowed) | **PROVEN** | Source line |
| HF-3 (Big Party start_at vs end_at) | **PROVEN** | DB read of `start_at = 16:00 EDT` + edge filter source at lines 329-331 |
| HF-4 (showFilterNoMatch unreachable) | **PROVEN** | Source-line walkthrough of `filteredNightOutCards.length === nightOutCards.length` |
| C-2 (Stripe RN bridgeless + iOS 26) | **PROBABLE** | Source config + prior investigation lineage; awaiting fresh Metro log for `proven` |
| O-1 (ORCH-0835/0836/0837 bundle landed) | **PROVEN** | grep + deployed function code |

Live-fire on iOS simulator was **NOT attempted** this session for the following reasons:
- The Discover bug class is server-side (TM-events pagination) and was reproduced via direct curl probes against production edge functions, which is a stronger signal than sim repro.
- The checkout bug class requires a hardware-secure-enclave + real iOS device + active Stripe network → sim cannot reproduce the bridgeless-mode hang. The prior investigations (ORCH-0829-B RETEST_2, ORCH-0833-0834-RESCOPED) already proved the sim is the wrong tool here.

Named blockers for promoting C-2 to `proven`:
1. Operator's fresh Metro log of a paid-checkout attempt against the post-ORCH-0837 EAS build.
2. Optional: bridgeless-disabled smoke test on a single feature-branch build to isolate the bridgeless variable (operator-decision — disabling bridgeless may regress other modules).

---

## 17. DISCOVERIES FOR ORCHESTRATOR (separate from the primary findings)

1. **TM API itself is healthy for Raleigh+music.** `meta.totalResults: 140` is a real TM response. The data exists; only our cache slicing drops it. The previous "TM rate limit / TM API silently empty" speculation in earlier investigations is now disproven.
2. **`event_dates.start_at >= now` may not match user mental model for `Tonight`.** Big Party started at 4 PM and is mid-event at 6 PM; user still expects to find it under "Tonight." Recommend operator decision on switching the lower bound to `end_at`. Separate ORCH if approved.
3. **Pre-launch hardening item:** the merged-discover state architecture (Path C from ORCH-0835 investigation) — migrate to React Query with persist as a single source of truth for both arrays. Sized as a Cycle B5 / pre-launch hardening item.
4. **Stripe Hosted Checkout pivot** remains the right strategic move regardless of how the residual native-render bug resolves. Stripe ranks Hosted Checkout above PaymentSheet in their own preference order. ORCH-0838 (Apple Pay re-enable + cert validation) becomes a "later, optional" item rather than a critical-path item if the pivot ships.
5. **CI gate gap:** the existing `orch-0824` discover gate validates the merged endpoint's response shape but does not assert that `items.length` is consistent with `meta.ticketmasterCount + meta.businessCount`. The new Spec A gate should plug this.
6. **`This Weekend` semantics on Saturdays/Sundays** are NOT bugged today (the path correctly returns `pair(now, sunday)` for dow=0/6 and Fri≥18:00). The bug is narrow to Friday before 18:00. Worth documenting in unit tests so the existing correct path is not regressed by the fix.

---

## 18. WORKING-BRANCH DISCIPLINE

This investigation lives in `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. No code modified. No migrations applied. No edge functions deployed. No Stripe Dashboard mutations. No Supabase Dashboard mutations. No secrets touched. No destructive git commands. No closures of ORCH-0839 — investigation only per the dispatch's hard guards. Direct edge-function probes used to verify runtime symptoms; no temporary diagnostics added to source.

---

## 19. CITED FILES

- `app-mobile/src/components/DiscoverScreen.tsx` (cache, partition, guards, date math)
- `app-mobile/src/services/nightOutExperiencesService.ts` (request body shape)
- `app-mobile/app/_layout.tsx` (StripeProvider, LogBox)
- `app-mobile/app/index.tsx` (Linking listener, useStripe, handleURLCallback)
- `app-mobile/src/payments/nativeCheckoutFlow.ts` (PaymentSheet flow)
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (claim chain, post-claim invalidation)
- `packages/payments-native/useStripePaymentSheet.ts` (once-only + timeout race)
- `packages/payments-native/StripeNativeProvider.tsx` (provider config)
- `supabase/functions/discover-merged-events/index.ts` (merge + TM gating)
- `supabase/functions/ticketmaster-events/index.ts` (TM proxy + cache)
- `supabase/functions/ticket-checkout-create/index.ts` (PI + Hosted Checkout)
- `app-mobile/app.json` (newArchEnabled, Stripe plugin, urlScheme)
- `app-mobile/package.json` (Stripe RN version)
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0824_…`, `_ORCH-0828_…`, `_ORCH-0833_…`, `_ORCH-0833-0834_…`, `_ORCH-0833-0834-RESCOPED_…`, `_ORCH-0835_…`, `_ORCH-0836_…`, `_ORCH-0837_…`
- `Mingla_Artifacts/specs/SPEC_ORCH-0824_…`, `_ORCH-0828_…`, `_ORCH-0835_0836_0837_…`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0835_0836_0837_BUNDLED.md`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md`
