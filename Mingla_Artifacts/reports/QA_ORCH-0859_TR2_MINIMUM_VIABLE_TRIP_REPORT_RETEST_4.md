# QA REPORT — ORCH-0859 [Tr2 Minimum Viable Trip] RETEST 4 (post-operator-smoke)

**Verdict:** FAIL — verdict reversal of prior PASS at RETEST 3
**Mode:** RETEST · **Retest cycle:** 4 of N
**Skill:** Claude `mingla-tester`
**Tested HEAD:** `899b6c70` + REWORK 1 + 2 + 3 edits
**Predecessor:** `Mingla_Artifacts/reports/QA_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP_REPORT_RETEST_3.md` (RETEST 3 PASS — REVERSED)
**Date:** 2026-05-17

---

## 0. Verdict reversal

RETEST 3 returned PASS based on (a) 80/80 jest, (b) production DB evidence of a published trip with final slug, (c) RLS probes, (d) source-grep audit. **That verdict was insufficient.** Operator smoke immediately after RETEST 3 surfaced two issues I should have caught by exercising the actual UI:

1. **Events tab still shows the published trip** as a card alongside events (operator screenshot 13:02).
2. **Operator dashboard at `/trip/[id]` has no Edit affordance** for either draft or published trips.

The lesson: source-grep + DB probes verify the CODE is correct; they do NOT verify the BUNDLE running on the operator's sim has the code. And source-only audit can't find missing UI affordances. RETEST 3 was PASS-by-construction, not PASS-by-observation. Reversing.

---

## 1. Severity counts

| Severity | Count |
|---|---|
| **P0** | 0 |
| **P1** | 2 (Bug #1 events-tab leak, Bug #2 missing edit affordance) |
| P2 | 0 |
| P3 | 2 (carryover) |
| P4 | 1 (process self-criticism — see §6) |

**Blocking:** 2 P1. Verdict: **FAIL**.

---

## 2. Bug #1 (P1) — Published trip appears in Events tab

**Symptom:** Operator's smoke at 13:02 shows the published "The DC Adventure" trip rendered in the Events tab. Operator wording: "trips show up as events. They show up as trips but also as events."

**Investigation:**
- Live DB probe against `business_management_events_view` for travelbrand returns 1 row (`the-dc-adventure`, status=scheduled, event_type='trip' per join).
- My REWORK 2 client-side filter in `fetchBusinessEventsForBrand` at `mingla-business/src/services/businessEvents.ts:454-495` does a 2-step probe: view → events.in(ids).select("id, event_type") → filter out trip IDs.
- Source code IS correct — the filter logic excludes the trip.
- **NEW runtime jest test at `mingla-business/src/services/__tests__/businessEvents.fetchExcludesTrips.runtime.test.ts` (3 tests, all PASS)** proves the filter works against a controlled mock with both event + trip rows.
- Other consumers of `business_management_events_view` that could leak: only 2 sites, both audited in REWORK 3 (fetchBusinessEventsForBrand + fetchBusinessEventById). No other unaudited path found via grep.
- `useLiveEventStore` (Zustand) is only written by `liveEventConverter.addLiveEvent()` (event publish flow, single call site per `[I-16 GUARD]`). Trip publish does NOT call this → trips cannot enter Zustand.

**Most likely root cause (rank-ordered):**

1. **STALE BUNDLE / CACHE** — Operator's iOS dev build may not have the REWORK 2 source loaded into the running JS bundle. Cmd+R reload doesn't always evict React Query's in-memory cache in dev (depends on Expo dev-client behavior — full app process restart is the only guaranteed cache wipe).
2. **React Query staleTime** — the `useBusinessEventsForBrand` query has `staleTime: 30s`. If the cache was populated with the leaking trip BEFORE the filter landed (during the REWORK 2 publish smoke), and the operator is reading the same cache before staleTime elapses, the leak appears even though the next fetch would filter correctly.
3. **An unfound code path** — possible but unlikely given the audit.

**Fix path:**
- **First** — operator hard-restarts the app (kill from sim app switcher, relaunch). If the leak disappears, root cause is #1/#2 → ship as-is, this RETEST flips to PASS on next smoke.
- **If leak persists after hard restart** — implementor adds a `console.warn` to the filter to print what `tripIds` resolves to in production. Confirms whether the filter is actually running with the expected data.

---

## 3. Bug #2 (P1) — Operator dashboard has no Edit affordance

**File:** `mingla-business/app/trip/[id]/index.tsx`

**Symptom:** Operator dashboard renders Overview + Travelers tabs with revenue/traveler-count/departure/destination cards. No "Edit trip" button anywhere. Operator wording: "no way to edit a trip that has already been published or is in draft phase."

**Source confirmation:** `grep -n "Edit\|edit" app/trip/\[id\]/index.tsx` returns no matches in the render path. The dashboard component does NOT expose a route to `/trip/{id}/edit` or any edit modal.

**Sub-point on drafts:** REWORK 2 fixed `/hub/trips` so DRAFT trips route to `/trip/{id}/edit` (verified in `app/(tabs)/hub/trips.tsx:124-128`). That path works from the trips list. But operators who tap a draft from anywhere ELSE (a recents widget, deep link, dashboard breadcrumb, post-create router.replace) land on `/trip/{id}` which then renders the dashboard with no edit affordance. The hub/trips → /edit routing alone is insufficient.

**Sub-point on published:** Published-trip editing was not in original Tr2 spec scope (publish was assumed terminal). Operator now wants edit-after-publish. Operator decision needed: should published-trip edit re-publish (with slug-immutability guard), or open a separate "Trip details edit" sub-screen that allows changes to non-slug-affecting fields (description, days, inclusions, pricing)?

**Fix path:**
- **Minimum viable:** add an "Edit" header button on `app/trip/[id]/index.tsx` that routes to `/trip/{id}/edit` regardless of status. For DRAFT trips this resumes the wizard; for PUBLISHED trips this re-enters the wizard (the publish RPC slug-immutability trigger will prevent slug change anyway, and the existing publish flow updates non-slug fields safely).
- Wizard already loads the trip via `useTrip(eventId)` — published trips will load fine, all 5 steps render with current values, operator can edit + tap Publish to update.

---

## 4. Test gates (still all green at code layer)

```
Full Tr2 jest suite (RETEST 4 fresh shell, including NEW runtime filter test):
  Test Suites: 11 passed, 11 total
  Tests:       83 passed, 83 total  (was 80; +3 from new runtime test)

Adversarial CI: 14 PASS, 0 FAIL
Strict-grep gate: 100 files scanned, 0 violations
```

The code-layer gates pass. **The failure is at the UX/observability layer**, which jest + grep cannot reach.

---

## 5. NEW runtime regression test (closes RETEST 3 gap)

`mingla-business/src/services/__tests__/businessEvents.fetchExcludesTrips.runtime.test.ts` — 3 tests:

1. View returns event + trip rows → trip excluded from result.
2. View returns only events → all rows returned (sanity).
3. Events probe RLS-rejects → function throws (NOT silently passes trips through).

Pinned to attack the LOGIC of the filter (not just its source-line shape). If the implementor's filter regressed to a `tripIds = new Set()` no-op, this test fails. The prior REWORK 3 audit only checked the `.filter(...)` call exists; this test exercises it end-to-end.

---

## 6. P4 self-criticism — what RETEST 3 missed

RETEST 3 graded PASS on code + DB + sim-evidence (the operator's published-trip data point). I treated "operator can publish a trip" as proof of "operator-facing UX is correct." That's a category error — publish working doesn't mean the post-publish surfaces are correct.

**Process improvement (recommend orchestrator register META-ORCH):** for any rework that touches a UX surface, tester verdict must be backed by EITHER (a) live Maestro flow exercising the post-fix UI directly, OR (b) operator-confirmed smoke step-by-step, NOT (c) "operator published successfully therefore PASS". Source-grep + DB probes are necessary but not sufficient.

Specifically for events-tab leaks: any future tester pass on this surface must include a Maestro flow that:
1. Navigates to /hub/events
2. Cycles through all 5 filters (All / Live / Upcoming / Drafts / Past)
3. Asserts no trip card appears (via accessibility label or testID match against trip titles)

I did not run this. PASS was issued without it.

---

## 7. Recommended dispatch path

This is REWORK 4 territory. Recommended scope:

**For Bug #1:** add a `console.log` instrumentation point in `fetchBusinessEventsForBrand` to print `{ rowsCount, tripIdsCount, filteredCount }` so operator's next smoke produces diagnostics that pinpoint whether the filter is running. If not running → root cause is bundle/cache → docs-only resolution. If running but returning wrong tripIds → code bug → real fix needed. Mark instrumentation with `// [ORCH-0859-REWORK-4-DIAG]` per the DIAG-reap protocol (cleaned up at next CLOSE).

**For Bug #2:** add Edit header button to `app/trip/[id]/index.tsx`. Routes to `/trip/{id}/edit`. Works for draft + published. Wizard host already loads the trip via `useTrip` so existing trips populate all 5 steps.

**Add tester adversarial coverage:** Maestro flow at `mingla-business/maestro/tr2-events-tab-no-trip-leak.yaml` — navigates to /hub/events, cycles filters, asserts no trip cards. Land in REWORK 4 as a closing-gate gate.

---

## 8. Discoveries for orchestrator

- **DISCOVERY (NEW):** RETEST 3 verdict reversal protocol — when a tester PASS is overruled by operator smoke, the next dispatch should attack the verification methodology in addition to the bug. See §6 process improvement candidate META-ORCH.
- **Bug #2 product question:** does published-trip edit re-publish (slug locked) or open a partial-edit sub-screen? Operator decides at REWORK 4 dispatch time.
- **Carryover:** all prior REWORK 1/2/3 discoveries remain open (META-ORCH for forensics+SPEC body-read discipline, edge-function event_type filter sweep, slug-trigger architectural cleanup, brandsService trip-vs-event accounting decision).
- The 3 P3 issues from RETEST 1 (`softDeleteTrip` refund exclusion, `getTrip` any-cast, day-vs-night labeling) all remain deferred.

---

## 9. Verdict

**FAIL** — 2 P1 bugs blocking CLOSE. Bug #1 needs operator-side bundle/cache diagnostic + (if persistent) source instrumentation; Bug #2 needs a new Edit affordance in the operator dashboard. Tester PASS at RETEST 3 was premature; this verdict reversal owns the gap.

Code-layer test gates (jest 83/83, adversarial 14/14, strict-grep 0/100) remain green and don't need re-running — the gap is at the UI/observability layer.
