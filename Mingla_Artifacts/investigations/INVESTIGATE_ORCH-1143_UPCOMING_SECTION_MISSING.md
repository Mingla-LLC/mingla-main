# INVESTIGATE — ORCH-1143 [live-card-scan-accordion] — "I can't see the Upcoming section"

**Date:** 2026-06-15
**Skill:** mingla-forensics (INVESTIGATE)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1143-[live-card-scan-accordion]/` on branch `ORCH-1143-live-card-scan-accordion`
**Mode:** read-only forensics — NO fix proposed.

## Symptom summary

- **Expected (Seth's mental model):** the business-app Home screen shows an "Upcoming" section.
- **Actual (Seth, dev OTA, on device):** "I can't see the Upcoming section." The section header and its list are entirely absent.
- **Trigger:** introduced when ORCH-1143 SC-7 changed the Upcoming gate + list to render `upcoming.nonLiveItems` (live offerings de-duplicated out, surfaced only in the new "Live now" carousel).
- **Question dispatched:** is SC-7 a regression (H2) or correct-but-jarring UX (H1)?

## Investigation manifest (files read, trace order)

1. `mingla-business/src/utils/upcomingBuilder.ts` — where `items` / `liveItems` / `nonLiveItems` / `counts` are computed; the past-exclusion + status assignment.
2. `mingla-business/src/hooks/useUpcomingForBrand.ts` — how the hook threads the builder output per brand; the data sources feeding it.
3. `mingla-business/app/(tabs)/home.tsx` — every consumer of `upcoming.items`, `.nonLiveItems`, `.liveItems`, `.counts`; the section gate + both render paths.
4. `mingla-business/src/services/businessEvents.ts` (`fetchBusinessEventsForBrand`) — what server rows feed `serverEvents`; which statuses the view exposes.
5. `mingla-business/src/store/draftEventStore.ts` — draft source (client-local vs server).
6. `mingla-business/src/utils/eventLifecycle.ts` (`deriveLiveStatus`) — how a "scheduled" event becomes "live".
7. Git: commit `4c6314f81` (the SC-7 diff) — exact pre/post delta.
8. LIVE prod DB (project `gqnoajqerqhnvulmnyvv`) — Seth's brand inventory.

## Q-scorecard

- **Q1.** Does `nonLiveItems` over-filter (wrongly drop scheduled-upcoming or draft items it should keep)?
  **Verdict:** NO. `nonLiveItems = nonPast.filter(status !== "live")` = exactly `upcoming + draft`. No over-filtering. `proven` (source + builder math).
- **Q2.** Is the section-hiding logic structurally broken?
  **Verdict:** NO. `hasUpcomingItems = upcoming.nonLiveItems.length > 0` gates both header and list, consistently across desktop + mobile paths. Behaves exactly as designed. `proven`.
- **Q3.** For Seth's actual brand, is there ANY non-live, non-past, non-ended offering that SHOULD appear in Upcoming but doesn't?
  **Verdict:** NO. Live-DB enumeration (below) shows the brand has exactly one active/published offering — and it is currently LIVE. There is nothing scheduled-future and nothing server-published in draft that the Upcoming list is suppressing. `proven` (live prod query).
- **Q4.** H1 or H2?
  **Verdict:** **H1 — EXPECTED behavior, not a code bug.** The Upcoming section correctly hides because every active offering is live. `proven`.
- **Q5.** Other-regressions sweep — did SC-7 damage `liveItems`, `counts`, the KPI grid, sales summaries, or past/ended exclusion?
  **Verdict:** NO collateral regression. Only the Upcoming gate + render data changed; all full-set consumers (`counts`, `items` for sales summaries, carousel `liveItems`) are untouched. `proven`.

## Findings (six-field evidence)

### F-1 — `nonLiveItems` is a correct, non-over-filtering projection — RULED OUT as bug

1. **Symptom:** Upcoming list empty for Seth's brand.
2. **Layer:** code.
3. **Probe:** read `buildUpcomingItems` in `upcomingBuilder.ts:184-240`.
4. **Evidence (verbatim):**
   ```
   const nonPast = items.filter((i) => !isPastForUpcoming(i, now));
   nonPast.sort(compareUpcomingItems);
   ...
   const liveItems = nonPast.filter((i) => i.status === "live");
   const nonLiveItems = nonPast.filter((i) => i.status !== "live");
   return { items: nonPast, counts, primaryLiveItem, liveItems, nonLiveItems };
   ```
   Status assignment: events `lifecycle === "live" ? "live" : "upcoming"` (`upcomingBuilder.ts:86`); trips `trip.status === "live" ? "live" : "upcoming"` (`:112`); drafts always `"draft"` (`:131`).
5. **Mechanism:** `nonLiveItems` is the exact set complement of `liveItems` within the already-past-filtered, already-sorted `nonPast`. Scheduled-upcoming (status `"upcoming"`) and drafts (status `"draft"`) are RETAINED — they are `!== "live"`. The only thing excluded is genuinely-live items. There is no path that drops an upcoming/draft item.
6. **Severity:** RULED OUT (this is correct behavior, not a defect).

### F-2 — The Upcoming section gate hides correctly when `nonLiveItems` is empty — RULED OUT as bug

1. **Symptom:** header + list both absent.
2. **Layer:** code.
3. **Probe:** read `home.tsx:460` and the two render sites `:676` (desktop), `:880`/`:894` (mobile).
4. **Evidence (verbatim):**
   ```
   460: const hasUpcomingItems = upcoming.nonLiveItems.length > 0;
   676: {hasUpcomingItems ? ( <View style={styles.desktopUpcomingPane}> ...
   700:   {upcoming.nonLiveItems.map((item) => { ...
   880: {hasUpcomingItems ? ( <View style={styles.mobileSectionHeaderRow}> ...
   894: <FlatList ... data={upcoming.nonLiveItems} ...
   ```
5. **Mechanism:** when `nonLiveItems.length === 0`, `hasUpcomingItems` is false → the header is not rendered on either path, and the FlatList renders an empty list. Net visual: the Upcoming section vanishes. This is exactly what the SC-7 comment at `:455-459` describes ("When every active item is live, the Upcoming section hides cleanly").
6. **Severity:** RULED OUT (intended).

### F-3 — LIVE prod inventory for Seth's brand proves H1 — CONFIRMED ROOT CAUSE (of the perceived "disappearance")

1. **Symptom:** Upcoming gone for the brand Seth is testing.
2. **Layer:** data (live prod).
3. **Probe (read-only, project `gqnoajqerqhnvulmnyvv`):**
   ```sql
   -- who owns the live offering
   SELECT e.id, e.title, e.event_type, b.name FROM events e JOIN brands b ON b.id=e.brand_id
   WHERE e.title ILIKE '%Wine and Dine%';
   -- full inventory + lifecycle dates
   SELECT e.id, e.title, e.event_type, e.status, e.published_at,
     (SELECT count(*) FROM event_dates ed WHERE ed.event_id=e.id) date_count,
     (SELECT min(ed.start_at) FROM event_dates ed WHERE ed.event_id=e.id) first_start,
     (SELECT max(ed.end_at)   FROM event_dates ed WHERE ed.event_id=e.id) last_end
   FROM events e WHERE e.brand_id='53aaea42-0e7d-4b2a-92db-c220d78a352c';
   -- what the Home fetch actually returns
   SELECT id, title, status FROM business_management_events_view
   WHERE brand_id='53aaea42-0e7d-4b2a-92db-c220d78a352c';
   ```
4. **Evidence (verbatim rows):**
   - Owner brand: **Lantern & Vine** (`53aaea42-0e7d-4b2a-92db-c220d78a352c`). The offering is an `experience`.
   - Full `events` inventory for the brand (4 rows):
     | title | type | status | published_at | dates | first_start (UTC) | last_end (UTC) |
     |---|---|---|---|---|---|---|
     | Raleigh Wine and Dine Crawl | experience | scheduled | 2026-06-02 | 1 | 2026-06-15 04:15 | 2026-06-16 03:00 |
     | Recur_Test | experience | draft | null | 0 | null | null |
     | Recur_Date_Test | experience | draft | null | 0 | null | null |
     | Test Jazz Crawl | experience | draft | null | 0 | null | null |
   - No `event_type='trip'` rows exist for this brand (so `useTripsByBrand` returns none).
   - `business_management_events_view` for the brand returns **ONLY 1 row**: Raleigh Wine and Dine Crawl (scheduled). The 3 `status='draft'` rows are excluded by the view.
5. **Mechanism:** `fetchBusinessEventsForBrand` reads `business_management_events_view`, which returns exactly the one published experience. `deriveLiveStatus` puts it in the live window: start 2026-06-15 04:15 UTC, window = `[start−4h, start+24h]` = `[06-15 00:15, 06-16 04:15]` UTC; today (2026-06-15) is inside → status `"live"`. Trips: none. Local drafts: the 3 server drafts are NOT on this code path — `draftEventStore` is a client-only AsyncStorage Zustand store, not a server fetch, so they never enter the Home builder regardless. Result: `items=[live experience]`, `liveItems=[that]`, **`nonLiveItems=[]`**, `counts={total:1,active:1,live:1,upcoming:0,draft:0}`. `hasUpcomingItems=false` → Upcoming section correctly hidden; the one offering shows in the "Live now" carousel.
6. **Severity:** CONFIRMED ROOT CAUSE of the perceived disappearance — it is **H1**, correct behavior, not a defect.

### F-4 — Other-regressions sweep: full-set consumers intact — RULED OUT

1. **Symptom:** potential collateral from SC-7.
2. **Layer:** code.
3. **Probe:** grep every `upcoming.*` consumer in `home.tsx`; `git show 4c6314f81 -- app/(tabs)/home.tsx`.
4. **Evidence:**
   - SC-7 diff touched ONLY three lines: `hasUpcomingItems` gate (items→nonLiveItems), desktop `.map` (items→nonLiveItems), mobile FlatList `data` (items→nonLiveItems). Nothing else.
   - `liveItems` (carousel, `home.tsx:313`, `452`, `504`, `545`, `564`) = `upcoming.liveItems` = `nonPast.filter(status==="live")` — unchanged; includes all live kinds (event/experience/trip). The live experience renders in the carousel.
   - KPI "Active events" (`home.tsx:668`, `873`) = `upcoming.counts.active` = `nonPast.length` (full set) — unchanged; still shows 1.
   - `kpiCountsForSub` (`:388-398`) reads `upcoming.counts.*` (full set) — unchanged.
   - `summaryEvents` (`:334-345`) iterates `upcoming.items` (full set) for sales summaries — correct: upcoming events still sell tickets; using the full set is right, NOT a place that should switch to `nonLiveItems`.
   - Past/ended exclusion `isPastForUpcoming` (`upcomingBuilder.ts:142-149`) — byte-identical to pre-1143; SC-7 added only the `nonLiveItems` projection, it did not touch `nonPast`.
5. **Mechanism:** the live-state truth is single-sourced (`liveItems`), counts stay on the full set, and only the Upcoming view projection is the de-duped subset. Internally consistent; no consumer is left reading the wrong field.
6. **Severity:** RULED OUT — no collateral regression.

## Five-Truth-Layer reconciliation

| Layer | Finding |
|---|---|
| **Docs** | SC-7 commit `4c6314f81` + `home.tsx:455-459` comment explicitly state Upcoming hides when all items are live. Matches observed behavior. No contradiction. |
| **Schema** | `events.status` text; dates in `event_dates`; trips are `event_type='trip'` in `events` (none for this brand). `business_management_events_view` excludes `draft`-status rows. Consistent with code. |
| **Code** | `nonLiveItems = nonPast − live`; gate hides on empty. Correct, no over-filter. |
| **Runtime** | Not separately sim-driven — the cause is fully proven by data + source (exempt per the reproducer being a pure data-state outcome, decisively settled by the live-DB query). For the one live offering, `deriveLiveStatus` returns "live" given today's date inside the window. |
| **Data** | Live prod: brand has 1 published offering (live now) + 3 server drafts (excluded by the view) + 0 trips → `nonLiveItems` legitimately empty. |

No layer contradicts another. The "gap" Seth perceives is a real UX delta, not a layer disagreement.

## Repro status

Not sim-driven. This is not a UI-event/gesture/keyboard bug — it is a deterministic data-state outcome (empty `nonLiveItems` → hidden section), proven decisively by the live prod inventory + the builder math + the gate source. A sim run would only re-confirm what the data proves. Confidence is `proven` via the data + source layers.

## Blast radius / cross-surface map

- **In-scope:** Business iOS + Business Android Home (`mingla-business/app/(tabs)/home.tsx`) — both share the same `hasUpcomingItems`/`nonLiveItems` code; the hide affects both. Business Web preview uses the same desktop path (`:676`) — same behavior.
- **Out-of-scope:** Consumer iOS/Android (`app-mobile/`) — different Home, no `upcomingBuilder`. Buyer/anon Web — unaffected. Admin Web — unaffected.

## Invariant impact

- Constitution #2 (one-owner-per-truth for live-state): UPHELD — `liveItems` is the single owner; `nonLiveItems` is a derived complement, not a second source. No violation.
- No invariant is violated by SC-7. The UX gap is a product-design question, not an invariant breach.

## Discoveries for Orchestrator (side notes)

- The brand carries 3 orphan `status='draft'` server experiences with zero dates (`Recur_Test`, `Recur_Date_Test`, `Test Jazz Crawl`) — test residue. They never reach Home Upcoming (view excludes them; local draft store is the only Home draft source). Not a bug; flagged as data hygiene only.
- `deriveLiveStatus` anchors the live window on `masterStartAtUtc` (start + 24h), not on the actual `end_at`. For this offering both agree it's live. Pre-existing behavior, out of ORCH-1143 scope.

## VERDICT: H1 (EXPECTED behavior — NOT a code regression)

SC-7 works exactly as specified. Lantern & Vine (Seth's test brand) has exactly ONE active offering — "Raleigh Wine and Dine Crawl" — and it is currently LIVE. Its 3 other offerings are dateless server drafts that never appeared in Home Upcoming (and still don't). So `nonLiveItems` is legitimately empty and the Upcoming section correctly hides per SC-7's "all-live hides cleanly" design.

### The genuine UX gap (the real thing to decide)

Pre-ORCH-1143, the Upcoming list rendered `upcoming.items` — which INCLUDED live items. So this same brand previously always saw an Upcoming section containing at least the live offering (with a "Live" pill). After SC-7 the live item is pulled out into the "Live now" carousel and the Upcoming section vanishes entirely. For a brand whose ONLY offering is live, the screen now reads "Live now: [card]" and then... nothing labeled "Upcoming." That is jarring-but-correct: Seth read the absence as a regression because the section used to be unconditionally present.

### Options to consider (product decision — NOT specced here)

1. **Keep an Upcoming header with an empty-state line** when `hasLiveItems && !hasUpcomingItems` — e.g. header "Upcoming" + muted "Nothing scheduled yet — create your next offering." (preserves spatial continuity; gives a creation affordance).
2. **Rename/merge:** show a single "Your offerings" framing where Live + Upcoming are one section with a live group on top, so nothing ever fully disappears.
3. **Leave as-is** and accept the all-live empty state (cleanest, but this is the exact thing Seth flagged).

Recommendation direction (not a fix): option 1 is the smallest change that resolves Seth's confusion without undoing SC-7's de-dup — but this is a product call, route to SPEC only if Seth wants the empty-state.

## Other-regressions sweep: CLEAN

No collateral regression. SC-7 touched only the Upcoming gate + the two Upcoming render-data references. `liveItems`/carousel, `counts`/KPI grid, `summaryEvents` sales lookups, and past/ended exclusion are all unchanged and still correctly read the full set where they should.

## Recommended next phase

Product decision by Seth: accept the all-live empty behavior, or open a small SPEC for an Upcoming empty-state header (option 1). No code fix is warranted for a "bug" — there is no bug.
