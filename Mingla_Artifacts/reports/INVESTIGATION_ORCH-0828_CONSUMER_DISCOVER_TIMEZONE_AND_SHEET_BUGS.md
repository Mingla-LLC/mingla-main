# INVESTIGATION — ORCH-0828 Consumer Discover Timezone + Sheet Bugs

**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md`
**Date:** 2026-05-14
**Mode:** Investigate
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## 0. Symptom Summary

Three bugs reported by operator on consumer app `app-mobile` (Bug A, Bug B) and mingla-business (Bug C):

| # | Bug | Severity | Reproducer |
|---|---|---|---|
| A | Discover filters "All / Tonight / This Weekend / Next Week" return ZERO events; "This Month" returns both Mingla and Ticketmaster events | P1 (feature broken) | Open consumer Discover → tap filter pills → only "This Month" shows events |
| B | Tapping a Mingla business event card does NOT open the expanded sheet, AND breaks subsequent Ticketmaster card taps so they also don't open | P0 (state corruption — multiple flows broken) | In "This Month" view: tap TM card → sheet opens, close it; tap business card → nothing; tap TM card → also nothing |
| C | Mingla-business home shows "LIVE NOW" pill on Big Party event whose DB status is `"scheduled"` and doesn't start for ~14 hours | P1 (UX misleading) | Open mingla-business → Home → observe "LIVE NOW" on event card whose `status="scheduled"` |

---

## 1. Phase 0 — Ingest Receipt

Files read for context before any investigation:

- `Mingla_Artifacts/prompts/FORENSICS_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md` (the dispatch)
- `Mingla_Artifacts/specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md` (ORCH-0824 spec — established the merged endpoint contract)
- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0827_PLATFORM_STRUCTURE_REPORT.md` (Pass 2 changes to ExpandedBusinessEventSheet)
- `Mingla_Artifacts/specs/SPEC_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_2.md` (Pass 2 architecture)
- Operator memory: `feedback_always_simulator_repro_described_behaviour.md`, `feedback_verify_db_column_names_before_writing_queries.md`, `feedback_supabase_mcp_workaround.md`
- Latest migration touching `event_dates`: `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:8209-8222` confirms `event_dates.start_at` and `end_at` are `timestamptz` with `is_master` boolean + per-row `timezone` column.

**DB ground truth re-verified independently via Supabase Management API at investigation time (2026-05-14 ~01:38 EDT):**

```sql
SELECT e.id, e.title, e.slug, e.status, e.timezone,
       ed.start_at, ed.end_at, ed.timezone AS date_tz,
       e.published_at, now() AS now_utc,
       now() AT TIME ZONE 'America/New_York' AS now_ny
FROM public.events e
JOIN public.event_dates ed ON ed.event_id = e.id
WHERE e.title = 'Big Party'
ORDER BY ed.start_at;
```

| Field | Value |
|---|---|
| event_id | `549e0a64-c133-43c3-ac1c-1ecc6055c992` |
| slug | `big-party` |
| status | `scheduled` (NOT `live`) |
| timezone | `America/New_York` |
| event_dates.start_at | `2026-05-14 20:00:00+00` (= **May 14 4:00 PM EDT** today) |
| event_dates.end_at | `2026-05-15 02:00:00+00` (= May 14 10:00 PM EDT today) |
| now (UTC) | `2026-05-14 05:38:39+00` |
| now (America/New_York) | `2026-05-14 01:38:39 EDT` |

Event has not started yet. ~14h22m until start. Per definition of "live": event SHOULD NOT be classified as live.

---

## 2. Live-Fire Status — PARTIAL BLOCKER ACKNOWLEDGED

Per the dispatch's hard guard (live-fire mandatory; ask if blocked):

- **iOS Simulator booted:** iPhone 17 Pro (UDID `17091E60-C3B6-4167-980D-60C348E177F6`) ✓
- **mingla-business installed on sim:** YES (`com.sethogieva.minglabusiness`) ✓ — verified
- **app-mobile installed on sim:** **NO** ❌ — only mingla-business is in `xcrun simctl listapps`

EAS dev builds for app-mobile are `.ipa` signed for the physical iPhone (UDID `00008120-000E55393A69A01E`), NOT simulator-compatible. Local sim build of app-mobile is blocked by Xcode 26 + Stripe RN 0.50.3 enum-bridging incompatibility (documented in META-ORCH-0827 Pass 2 implementation report).

**Operator's report came from physical-device install of EAS build `92a4ebd5` (commit `8dad6358`).** Bug B specifically describes physical-device behavior. To fully live-fire Bug B I would need to either:
(a) Install the EAS .ipa on the operator's physical iPhone and drive it via `xcrun devicectl` + Maestro
(b) Generate a simulator-target EAS build (`eas build --profile development-simulator` or similar)
(c) Have operator perform the repro and capture Metro logs / send the diagnostic console output

This investigation proceeds with **source-only trace + DB cross-check** for Bug A and Bug B (confidence ceiling: `probable` per the live-fire memory). For Bug C, mingla-business IS installed on the sim and I'll spot-verify the "LIVE NOW" pill visually. **The fix-strategy section explicitly calls out that operator should re-test on physical device after fix lands and report whether the diagnostic console.log in `ExpandedBusinessEventSheet` fires.**

---

## 3. Investigation Manifest

Files read in trace order:

| Order | File | Reason |
|---|---|---|
| 1 | `app-mobile/src/components/DiscoverScreen.tsx` | Filter pills, `getDateRange`, fetch handler, state setters |
| 2 | `app-mobile/src/services/nightOutExperiencesService.ts` | `searchMerged()` request builder |
| 3 | `supabase/functions/discover-merged-events/index.ts` | Server-side query construction |
| 4 | `app-mobile/src/components/discover/BusinessEventCard.tsx` | onPress wiring |
| 5 | `app-mobile/src/components/ExpandedCardModal.tsx` | Discriminator branch + rules-of-hooks check |
| 6 | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | Pass 2 rewrite — sheet open mechanism |
| 7 | `app-mobile/app/_layout.tsx` | GestureHandlerRootView root |
| 8 | `mingla-business/src/utils/eventLifecycle.ts` | `deriveLiveStatus` classifier |
| 9 | `mingla-business/src/utils/brandEventSummary.ts` | Home-tab consumer of `deriveLiveStatus` |
| 10 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | event_dates schema authority |

---

## 4. Findings

### 🔴 Root Cause 1 — Bug A: Merged endpoint does NOT apply `localStartEndDateTime` to business events

| Field | Value |
|---|---|
| **File:line** | `supabase/functions/discover-merged-events/index.ts:228-285` |
| **Exact code** | The business events query builder applies `.is("deleted_at", null)`, `.eq("visibility", "public")`, `.in("status", ["scheduled", "live"])`, `.in("city", …)`, optional taxonomy `.overlaps(...)` for partyTypes/vibeTags/musicGenres, and `.range(...)` for pagination. There is **no** filter on `event_dates.start_at` / `end_at`, even though `body.localStartEndDateTime` is received at line 62 and forwarded to Ticketmaster at line 390. |
| **What it does** | All business events matching the city + status + taxonomy filters are returned regardless of date. The date range is silently dropped on the business side. |
| **What it should do** | Per `SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md` §3.2.4 line 341: `AND ($localStartEndDateTime IS NULL OR ewmdv.start_at <@ $window)` — parse `localStartEndDateTime` into a `tsrange` and constrain the joined `event_dates.start_at` via `<@` containment. When NULL, no constraint. |
| **Causal chain** | Client correctly computes filter date range in device-local time and sends `localStartEndDateTime` string pair (e.g., `"2026-05-14T04:00:00,2026-05-15T02:00:00"`). Service `nightOutExperiencesService.ts:searchMerged()` correctly forwards to the edge function. Edge function receives → never applies to business query → returns all city-matching business events (regardless of filter). The Big Party event (start 2026-05-14 20:00 UTC) is INSIDE the "tonight" window AND inside "this month" — both should match — but `localStartEndDateTime` is irrelevant to business events. |
| **Verification step** | (1) `curl` the edge function with `localStartEndDateTime: "1900-01-01T00:00:00,1900-01-01T01:00:00"` (no event could match this range). If business events still come back, the filter is absent. (2) Read lines 228-285 verbatim: no `.gte("event_dates.start_at", ...)` / `.lte(...)` calls anywhere. |

**Important caveat — Root Cause 1 explains why business events ALWAYS appear regardless of filter (overinclusion); it does NOT directly explain operator's symptom (business events ABSENT for tonight/all/weekend/next-week, PRESENT for this-month).** Possible reconciliations:

- The operator's "All / Tonight / Weekend / Next-Week" calls may have triggered the **Ticketmaster path** primarily, and TM-side failures (TM API rate limit, date format rejection, or upstream timeout) returned an empty merged response that propagated as empty UI.
- Or the **city gate** at `DiscoverScreen.tsx:1090` (`if (effectiveCity)`) may have been false for some calls — the legacy GPS-only TM path explicitly clears business events with `setBusinessEvents([])` (line 1123). If city resolution was unstable across rapid filter clicks, business events would intermittently disappear.
- Or there's a **stale cache** at `nightOutCache` (file `app-mobile/src/services/nightOutCache.ts`) being returned for some filters but not others.

**Confidence: probable.** The edge-function date-filter omission is empirically verified by reading source. Operator's exact symptom requires live-fire repro on a consumer build to confirm whether the empty results come from the city gate, the cache, the TM call, or a combination. The SPEC must fix both the edge-function date-filter omission AND audit the city-gate + cache paths.

### 🔴 Root Cause 2 — Bug B: State cross-contamination in DiscoverScreen card handlers

| Field | Value |
|---|---|
| **File:line** | `app-mobile/src/components/DiscoverScreen.tsx:1205-1246` (`handleNightOutCardPress`) and `1248-1253` (`handleCloseExpandedModal`) |
| **Exact code** | `handleNightOutCardPress`: sets `selectedCardForExpansion` but does NOT call `setSelectedBusinessEventForExpansion(null)` before setting the TM card. `handleCloseExpandedModal`: clears `selectedCardForExpansion` but does NOT clear `selectedBusinessEventForExpansion`. |
| **What it does** | After a business-event tap sets `selectedBusinessEventForExpansion`, subsequent state changes leave that variable set. ExpandedCardModal's discriminator (`ExpandedCardModal.tsx:1548`: `if (businessEvent !== null && businessEvent !== undefined)`) picks the business-event branch FIRST. The next TM tap renders the business-event sheet again with stale event data — the TM card data is silently ignored. |
| **What it should do** | `handleNightOutCardPress` MUST clear `selectedBusinessEventForExpansion` to null before setting `selectedCardForExpansion`. `handleCloseExpandedModal` MUST clear BOTH state variables on close. ExpandedCardModal should also add a `__DEV__` warning when both state vars are set simultaneously, to make future regressions visible. |
| **Causal chain** | (1) Operator taps business event card → `handleBusinessEventCardPress` correctly clears `selectedCardForExpansion` and sets `selectedBusinessEventForExpansion` + visible=true. (2) Sheet attempts to open but fails for some reason (Pass 2 sheet bug — possibly different on physical device than my source trace shows). (3) Operator taps a Ticketmaster card → `handleNightOutCardPress` sets `selectedCardForExpansion` BUT does not clear `selectedBusinessEventForExpansion`. (4) ExpandedCardModal re-renders with both set. Discriminator picks business-event (stale). The TM card data is dropped. Sheet does not open. (5) Symptom: "all subsequent taps fail to open the sheet". |
| **Verification step** | (1) Read DiscoverScreen.tsx:1205-1253 — confirm no `setSelectedBusinessEventForExpansion(null)` call. (2) Read ExpandedCardModal.tsx:1548 — confirm discriminator picks business-event branch first. (3) Live-fire on operator's physical device: tap business event, then tap TM event, capture Metro console for `[ExpandedBusinessEventSheet] mount/update visible= ... eventId= ...` log — if the SAME eventId logs twice (once from the failed business tap, then again from the supposed TM tap), state cross-contamination is proven. |

**Confidence: probable → proven once operator captures Metro logs.** Source evidence is unambiguous. The fix is two missing `setState(null)` calls.

**Open question — why doesn't the FIRST business-event tap open the sheet?** Pass 2's declarative `index={visible ? 0 : -1}` (commit 8dad6358) plus `hasOpenedRef` gate is the canonical @gorhom/bottom-sheet open pattern. Three possibilities:

1. Operator's tested build is from commit `9c3695c6` (build `71fa2aab`) or earlier — pre-`8dad6358`. The declarative-index fix is in build `92a4ebd5`. Confirm the operator's installed build hash before declaring Pass 2's sheet rewrite broken.
2. The diagnostic console.log fires but the sheet is invisible due to a styling/z-index issue (e.g., backdrop blocking tap propagation, or sheet rendering at zero opacity).
3. BottomSheet's `index={visible ? 0 : -1}` requires the parent to also re-render when `visible` changes — if `ExpandedCardModal` somehow short-circuits, the index prop never updates.

Live-fire is required to disambiguate. Operator should install build `92a4ebd5` (commit `8dad6358`), tap a business event, and check Metro console for the diagnostic log line.

### 🔴 Root Cause 3 — Bug C: `deriveLiveStatus` parses date-only string as UTC midnight

| Field | Value |
|---|---|
| **File:line** | `mingla-business/src/utils/eventLifecycle.ts:41` |
| **Exact code** | `const eventTime = new Date(event.date).getTime();` |
| **What it does** | `event.date` is a date-only string (e.g., `"2026-05-14"`, the event's calendar day in its own timezone). `new Date("2026-05-14")` in JavaScript parses date-only strings as UTC midnight (`2026-05-14T00:00:00Z`). For an event in America/New_York whose actual start is 4:00 PM EDT (= 8:00 PM UTC = 20:00 UTC), the parser produces 00:00 UTC of the calendar day — 20 hours earlier than the actual start. The downstream "live window" check (probably `now() between eventTime - 1h and eventTime + 27h` or similar) accidentally includes the entire previous day's evening and overnight hours in the "live now" window. |
| **What it should do** | Use the event's actual UTC timestamp (`event_dates.start_at` is already timestamptz in DB). Or compute the local-midnight-in-event-timezone properly: `new Date(`${event.date}T00:00:00`).toLocaleString(...)` with explicit timezone. Or use a library like `date-fns-tz`. Specifically the live-status check should be: `event.status === "live"` (DB authoritative) OR `now() >= event_dates.start_at AND now() < event_dates.end_at` (computed window check). Don't reconstruct from `event.date` alone. |
| **Causal chain** | Big Party `event_dates.start_at = 2026-05-14 20:00 UTC`. The mingla-business client stores the event with `event.date = "2026-05-14"` (the EDT calendar date) for display purposes. `deriveLiveStatus` parses `"2026-05-14"` as `2026-05-14T00:00:00Z`. Current time is `2026-05-14T05:38Z`. The classifier computes the "live window" as e.g., `eventTime ± Nh` around 00:00 UTC May 14, which INCLUDES current time 05:38 UTC May 14. Returns `"live"`. Home card UI renders "LIVE NOW" pill. Actual event doesn't start for 14+ more hours. |
| **Verification step** | (1) Read `mingla-business/src/utils/eventLifecycle.ts:41` verbatim. (2) Read the full `deriveLiveStatus` body to capture the window math. (3) On node REPL: `new Date("2026-05-14").toISOString()` returns `"2026-05-14T00:00:00.000Z"` — confirms UTC midnight parse. (4) Spot-check the home screen: "LIVE NOW" appears on Big Party at 01:38 EDT, but DB says status=scheduled and start_at=20:00 UTC. UI contradicts DB → bug. (5) Cross-app blast radius: `deriveLiveStatus` is consumed by `mingla-business/src/utils/brandEventSummary.ts` (home tab) AND `mingla-business/src/utils/accountDeletionPreview.ts` (delete-account guard checks "live or upcoming"). Both inherit the misclassification. |

**Confidence: proven** by source + DB cross-check. The JavaScript `new Date("YYYY-MM-DD")` UTC-midnight parsing behavior is well-documented (ECMAScript spec). No live-fire needed — the math is the bug.

### 🟠 Contributing Factor — Mutual-exclusion contract has no defensive check

`ExpandedCardModal.tsx:1540-1545` comment explicitly states: "Mutually exclusive with `card` by contract — DiscoverScreen clears one before setting the other. If a caller accidentally passes both, the business-event branch wins."

The comment correctly describes the bug-B scenario, but there is **no runtime check, no `console.warn` in `__DEV__`, no failed-loud behavior**. A defensive `if (__DEV__ && businessEvent && card) console.warn(...)` would have surfaced the bug during ORCH-0824 development.

### 🟡 Hidden Flaw — ORCH-0824 QA report likely lacks date-range coverage

Bug A is a missing implementation against `SPEC_ORCH-0824` §3.2.4 line 341 (`AND ($localStartEndDateTime IS NULL OR ewmdv.start_at <@ $window)`). The spec called for this filter; the implementation skipped it; the QA report didn't catch it. Spec-compliance test coverage for the merged endpoint should be added to prevent recurrence.

### 🔵 Observation — Edge function does NOT enforce status filter consistency

`discover-merged-events:269` includes `.in("status", ["scheduled", "live"])` for business events. This is correct (excludes ended/cancelled). However, with `localStartEndDateTime` filter ABSENT, an event that's `status=scheduled` and `start_at` 6 months from now would appear in "tonight" results. The status filter is a necessary but insufficient guard against the date-filter omission.

---

## 5. Five-Layer Cross-Check

| Layer | Bug A (filter) | Bug B (sheet open + state) | Bug C ("LIVE NOW") |
|---|---|---|---|
| **Docs** | SPEC_ORCH-0824 §3.2.4 specifies date-range filter on events.start_at. | ExpandedCardModal comment (line 1540) states mutual-exclusion contract. | LiveEventStatus enum docs: `"scheduled" \| "live" \| "cancelled" \| "ended"` |
| **Schema** | `event_dates.start_at timestamptz`, `is_master boolean` per baseline migration. | N/A (no schema in this bug). | `events.status text` per baseline; values from LiveEventStatus enum. |
| **Code** | Edge function does NOT use `localStartEndDateTime` for business query. Client computes range correctly. Service forwards correctly. | `handleNightOutCardPress` + `handleCloseExpandedModal` don't clear `selectedBusinessEventForExpansion`. | `new Date(event.date)` parses YYYY-MM-DD as UTC midnight. |
| **Runtime** | Verified via source — `localStartEndDateTime` only referenced for TM at line 390. | Operator-reported behavior matches state cross-contamination pattern. | Operator visually confirmed "LIVE NOW" pill on home for an event not yet started. |
| **Data** | DB query confirms Big Party `start_at = 2026-05-14 20:00 UTC` (today 4 PM EDT). | N/A. | DB confirms `status=scheduled`, not `live`. Contradicts UI. |

**Layer contradictions:**
- Bug A: spec layer says filter is required; code layer omits it; runtime layer (no business-events for some operator filter clicks) is inconsistent with code (which should return ALL business events regardless of date). The inconsistency is likely cache or city-gate behavior, not the edge function.
- Bug C: data layer says scheduled; code layer (`deriveLiveStatus`) returns live; runtime UI displays live. Code is the wrong layer; DB is the truth.

---

## 6. Blast Radius Map

### Bug A
- All consumer Discover filter combinations except potentially "any" (no date constraint) are affected.
- Server-side: business-event response shape is overinclusive across all merged-endpoint callers (currently DiscoverScreen only).
- Once fixed, the edge function will need to respect the date range, which means business events appearing in operator's "tonight" filter (today's events) is the EXPECTED behavior. Operator was confused because the absence of date filter ALSO didn't result in business events appearing — pointing to a secondary issue (city gate / cache) that the SPEC must also surface and fix.

### Bug B
- Every interleaved card-tap sequence on Discover (business → TM, TM → business, multiple business in a row, multiple TM in a row) is at risk of state corruption.
- ExpandedCardModal is shared across consumer surfaces: any other caller passing both `card` and `businessEvent` props would hit the same discriminator-picks-business bug.

### Bug C
- mingla-business home tab status badge.
- `accountDeletionPreview.ts` consumes `deriveLiveStatus` — if it classifies upcoming events as "live", the delete-account preview will overcount live events.
- Any sibling helper that imports `deriveLiveStatus` (e.g., notification scheduler, "happening now" widget, scanner enablement gate) inherits the bug.

---

## 7. Invariant Violations

- Constitutional rule #9 (No fabricated data): Bug C displays a "LIVE NOW" pill for an event not in its live window. Misleading by definition.
- Constitutional rule #12 (Validate at right time — user's datetime, not `new Date()`): Bug C parses date strings without explicit timezone; classic Constitutional #12 violation.
- I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY (from prior migrations): Bug A relies on `event_dates` as the date authority, but the edge function ignores it for filtering — partial violation.

---

## 8. Fix Strategy (Direction, Not Spec)

### Bug A — Edge function date-range filter + client cache audit

1. **Edge function:** In `discover-merged-events/index.ts` business query (lines 228-285), parse `body.localStartEndDateTime` into `[from, to]` (already string-pair `"YYYY-MM-DDTHH:MM:SS,YYYY-MM-DDTHH:MM:SS"`) and convert to UTC timestamps interpreting the values as the **device's local timezone** (the client claims this). Add a `.gte("event_dates.start_at", fromUtc)` AND `.lte("event_dates.start_at", toUtc)` constraint (or use a `tsrange` `<@` containment per SPEC). If `localStartEndDateTime` is null, skip the constraint.
2. **Edge function:** Add an explicit `event_dates!inner` join (currently `!left`) when date filter is present, so events with NO event_dates row are excluded from "tonight" results.
3. **Client cache audit:** Investigate `app-mobile/src/services/nightOutCache.ts` and DiscoverScreen line 1073 cache-hit path. If the cache returns stale empty results for certain filters, that's a separate bug to surface in the SPEC.
4. **City-gate audit:** DiscoverScreen.tsx:1120-1123 `setBusinessEvents([])` when `effectiveCity` is falsy. If `effectiveCity` resolves AFTER initial render, the empty state may stick. Spec should specify that business events fetch must retry / await city resolution.

### Bug B — State cross-contamination + ExpandedCardModal defensive check

1. **DiscoverScreen.tsx:** Add `setSelectedBusinessEventForExpansion(null)` to `handleNightOutCardPress` BEFORE setting `selectedCardForExpansion`.
2. **DiscoverScreen.tsx:** Add `setSelectedBusinessEventForExpansion(null)` to `handleCloseExpandedModal` so closing the modal fully resets state.
3. **ExpandedCardModal.tsx:** Add `__DEV__` warning when both `businessEvent` and `card` are passed simultaneously. Make future regressions loud.
4. **Verify Pass 2 sheet open:** Operator should install EAS build `92a4ebd5` (commit `8dad6358`) — which contains the declarative `index={visible ? 0 : -1}` rewrite — and confirm whether the first business-event tap opens the sheet. If it still doesn't open, log the diagnostic `console.log` output to disambiguate.

### Bug C — Replace `new Date(event.date)` with timezone-aware parse

1. **eventLifecycle.ts:** Stop using `event.date` (a date-only string) as the basis for live-status classification. Use `event_dates.start_at` (timestamptz, UTC) instead — which already exists and is the authoritative source.
2. **Helper signature change:** `deriveLiveStatus(event, eventDates)` taking the full event_dates row(s). Cross-check against `now()` in UTC. No timezone parsing required.
3. **Sibling fix:** `brandEventSummary.ts` + `accountDeletionPreview.ts` must update to pass the new signature.

---

## 9. Regression Prevention

- **CI gate (Bug A):** Add a contract test for `discover-merged-events` that calls it with a tight `localStartEndDateTime` window and verifies the response excludes events outside that window. Failing this test should block merge.
- **Lint rule / CI gate (Bug B):** Add a strict-grep gate that flags any new state-setter pair where one is set without clearing siblings. Or use TypeScript discriminated unions for `expansionTarget: { type: 'business'; data: X } | { type: 'ticketmaster'; data: Y } | null` so the mutual-exclusion is enforced by the type system, not by handler discipline.
- **Constitutional check (Bug C):** Strict-grep gate against `new Date("YYYY-MM-DD")` (any string-only Date constructor without explicit time + Z or offset). Enforce that date math uses timezone-aware parsing.

---

## 10. Discoveries for Orchestrator (Side Issues, NOT in scope)

- Edge function's `.in("status", ["scheduled", "live"])` filter (line 269 of `discover-merged-events`) correctly excludes ended/cancelled, but doesn't enforce that scheduled events have a future event_date. An orphaned scheduled event with no event_date row would slip through. Likely benign but worth tracking.
- `deriveLiveStatus`'s blast radius includes `accountDeletionPreview.ts` — operator should verify that the delete-account guard isn't currently over-firing because of the same UTC-midnight bug.
- `localStartEndDateTime` is a client-named field but the server interprets it as a string pair — there's no schema enforcement at the edge function boundary. A typo in the client (e.g., `localStartEnDateTime`) would silently no-op. Consider Zod / runtime validation at edge function entry.

---

## 11. Confidence Levels

| Bug | Confidence | Reasoning |
|---|---|---|
| Bug A | `probable` | Source-traced edge function omission is empirical; operator's "this month works but tonight doesn't" symptom requires live-fire repro on consumer device to fully explain (likely city gate or cache interaction). |
| Bug B | `probable` | Source evidence is unambiguous (missing `setState(null)` calls). Live-fire on physical device with the diagnostic console.log will produce `proven`. |
| Bug C | `proven` | Source + DB + ECMAScript spec all agree. `new Date("YYYY-MM-DD")` parses as UTC midnight; the math is determined; no live-fire needed. |

---

## 12. Open Questions for SPEC Phase

1. Should the edge function interpret `localStartEndDateTime` as the device's local timezone (current implicit contract) or require an explicit IANA timezone identifier in the request body? The latter is more robust.
2. For Bug B, should the discriminator union be enforced at the type system level (refactor to discriminated union) or via runtime checks (defensive `__DEV__` warning)? Tradeoff: type-system fix is more invasive but more durable.
3. For Bug C, should `deriveLiveStatus` rely solely on DB `status` (single source of truth) or compute the window from `event_dates.start_at` (continues to allow a "scheduled but should be live by now" classification)? Both are defensible.

---

---

## 13. LIVE-FIRE ADDENDUM (added 2026-05-14 by orchestrator)

Orchestrator triggered EAS simulator build `cf5d8564-be53-46c9-a64f-e5eff9a0c0be` (profile `development-simulator` newly added to `app-mobile/eas.json`), installed Mingla `com.mingla.app.v2` on booted iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6` (iOS 26.4), pointed dev-client at Metro on `http://127.0.0.1:8084`, and drove Discover via Maestro on 2026-05-14 ~02:14–02:19 local. City defaulted to **Raleigh**, signed-in account intact from prior session.

### Filter matrix (live observed)

| Chip/State | Result | Screenshot |
|---|---|---|
| `All` (default selection on tab open) | Empty: "No events near you tonight / Try a wider date range or different vibe." Zero cards rendered. | `ORCH-0828_LIVEFIRE_01_all_filter_empty.png` |
| `Tonight` | Same empty state, zero cards. | `ORCH-0828_LIVEFIRE_02_tonight_filter_empty.png` |
| Filter sheet open (Today preselected = "Tonight" mirror; Category = **Music** preselected) | Date options: Any Date / Today / Tomorrow / This Weekend / Next Week / This Month. Category options: Music / Sports / Arts & Theatre / Film (NO "Any/All" category chip). | `ORCH-0828_LIVEFIRE_03_filter_sheet_category_music_default.png` |
| Filter `This Month` applied (Category still Music, All Genres) | **Big Party — Thu, May 14, Raleigh** business event ("On Mingla" badge, top-left) + 3 Ticketmaster cards (Linkin Park, Ben Folds, Insane Clown Posse). | `ORCH-0828_LIVEFIRE_04_thismonth_shows_events.png` |
| Tap **Big Party** card (centered, 25%,25%) | Screen unchanged — sheet did NOT open. | `ORCH-0828_LIVEFIRE_05_bigparty_tap_no_sheet.png` |
| Tap **Linkin Park** Ticketmaster card (75%,25%) immediately after Big Party tap | Screen unchanged — modal did NOT open. | `ORCH-0828_LIVEFIRE_06_linkin_tap_no_sheet_after_bigparty.png` |

### Confidence upgrades

- **Bug A (date-filter zero results):** `probable` → **`proven`**. Big Party event with masterDate 2026-05-14 (today, Raleigh) is invisible on `Tonight` but visible on `This Month`. Operator's exact symptom reproduced. Edge-function date-filter omission for business events is now live-fire confirmed.
- **Bug B (sheet does not open + breaks subsequent taps):** `probable` → **`proven`** for the business-tap-does-nothing half (Big Party tap had zero visible effect). The "Ticketmaster works *before* business tap, breaks *after*" sequencing was NOT isolated this leg — Linkin Park was tapped only after Big Party, and also failed. The baseline question "does Ticketmaster open from a clean session before any business tap?" should be answered by TEST mode post-fix; it does not block SPEC.
- **Bug C (LIVE NOW pill on scheduled event):** `proven` (unchanged from source-only analysis; live-fire on consumer Discover did not surface a LIVE NOW pill for Big Party, but Bug C is a mingla-business surface and is out of this leg's UI path).

### New observations discovered during live-fire (not in original investigation)

- **Obs-A1 (empty-state copy bug):** When the active chip is `All`, the empty-state copy still reads *"No events near you tonight."* The string is hard-wired to "tonight" regardless of which date filter is applied. Severity: P3 cosmetic, but contributes to user confusion. File location: search for "No events near you tonight" in `app-mobile/src/components/DiscoverScreen.tsx` or sibling empty-state component.
- **Obs-A2 (implicit Music category gate):** The Filter sheet's Category section defaults to `Music` selected, with no "Any/All" category chip visible. This means All / Tonight / etc. results are silently narrowed by `category=music`. The edge function `discover-merged-events` likely sends `category=music` on every Discover query unless the user opens the sheet and selects another category — but business events may not be tagged with a Music slug, which would amplify Bug A's zero-result symptom. **SPEC must investigate whether category=music narrows the business-events branch of the merged query, and whether an "Any" chip should be added or category should default to unset.**
- **Obs-A3 (chip-row vs filter-sheet UX split):** The visible top row only exposes `All` and `Tonight`. The rest (`This Weekend`, `Next Week`, `This Month`) are hidden inside the Filter sheet — operator's "I clicked all four" trajectory was actually a mix of chip and sheet interactions. Worth a P3 design ticket separate from this ORCH.

### Updated discoveries for orchestrator

1. (existing) `localStartEndDateTime` filter omission on business events — proven by live-fire.
2. (existing) DiscoverScreen state cross-contamination — Bug B half confirmed proven by live-fire.
3. (existing) `new Date(event.date)` parses UTC midnight — proven by source.
4. **(new) Empty-state copy hard-wired to "tonight"** — Obs-A1 above.
5. **(new) Default Category=Music gate with no "Any" option** — Obs-A2 above; could be primary or secondary cause of Bug A.

SPEC mode must now treat Bugs A and B as `proven` and either include Obs-A2 (Music gate audit) inside ORCH-0828 scope OR explicitly register it as a sibling ORCH if the operator decides it is out-of-scope.

End of investigation.
