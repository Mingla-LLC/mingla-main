# Investigation Report: Business Home Upcoming Stub Data (ORCH-0754)

> Date: 2026-05-08
> Source: Orchestrator prompt ORCH-0754 from user report
> Confidence: HIGH - current render path, historical scope decisions, state stores, and schema/RLS were traced statically
> Status: root cause proven

## 1. Layman Summary

The business app Home page still shows fake upcoming events because its Upcoming section kept the old Cycle 1/Cycle 3 transitional rows after the Events tab gained the real draft/live/upcoming pipeline. The visible fake rows are `Sunday Languor Brunch` and `The Long Lunch (Series)`. The page also hardcodes event counts and live-event display details, so the whole Home event summary can drift from actual organiser data.

This is a confirmed launch blocker for the business Home page under the "no fabricated data" rule. The fix direction is to retire `STUB_UPCOMING_ROWS` completely and derive Home's live/upcoming/draft rows from the same real stores and lifecycle helpers that power `app/(tabs)/events.tsx`.

## 2. Scope

- **Feature / issue:** Business app Home tab, "Upcoming" section and adjacent event KPI/live summary.
- **Actor:** Business organiser viewing a selected brand.
- **Environment:** `mingla-business/`, Expo Router tab route.
- **Success definition:** Home shows only actual brand-scoped draft/live/upcoming event data, or an honest empty/loading state. No hardcoded event names, counts, dates, capacities, scan counts, or ticket counts remain.
- **Assumptions:** "Actual data" currently means the app's established brand-scoped event truth: server-fresh brand identity via React Query plus local persisted draft/live event stores. Full Supabase event reads are not yet wired in this surface.
- **Out of scope:** Product-code implementation, Supabase event write/read migration design, tester retest, and unrelated stub-data cleanup in profile/finance surfaces.

## 3. Intended Journey

`Home tab opens -> current brand resolves from persisted currentBrandId -> Home reads brand-scoped draft/live event stores -> lifecycle helper classifies events -> Upcoming renders actual upcoming/draft rows or an empty state -> KPI/live summary reflects those same derived rows`

Expected negative behavior: while no brand is selected, Home should show the existing no-brand state; while no events exist, Home should say there are no upcoming events instead of filling the gap with fake rows. Errors and loading states should remain honest; no demo/stub fallback should appear in production-facing Home content.

## 4. Historical Context

- `IMPLEMENTATION_CYCLE_1_ACCOUNT_ANCHOR.md` recorded Home Upcoming as "live event row + 2 stub rows."
- `INVESTIGATION_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md` explicitly allowed Home to render draft rows above `STUB_UPCOMING_ROWS` temporarily, with a note that Cycle 9 would retire the stubs when the real event list existed.
- `SPEC_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md` required preserving the stub rows in Cycle 3.
- `INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md` and `SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md` then scoped Cycle 9 away from Home: `Q-9-10 - Live tonight on Home tab: NO TOUCH in Cycle 9`.
- `IMPLEMENTATION_BIZ_CYCLE_9a_EVENTS_TAB_DETAIL_MANAGE.md` confirms the Events tab changed from drafts-only to the full pipeline, while Home was not updated.

Conclusion: this is not a random regression. It is a lifecycle gap. Cycle 3 put a retirement condition on the Home stub rows, and Cycle 9 implemented the event list elsewhere while explicitly excluding Home.

## 5. Investigation Manifest

| # | File / artifact | Layer | Why read |
|---|---|---|---|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md` | Prompt | Scope and user symptom |
| 2 | `mingla-business/app/(tabs)/home.tsx` | Code/UI | Primary failing render path |
| 3 | `mingla-business/app/(tabs)/events.tsx` | Code/UI | Current real event-list implementation to reuse as truth pattern |
| 4 | `mingla-business/src/store/draftEventStore.ts` | State/cache | Draft-event truth and publish transition |
| 5 | `mingla-business/src/store/liveEventStore.ts` | State/cache | Published/live event truth |
| 6 | `mingla-business/src/utils/liveEventConverter.ts` | State transition | Draft-to-live conversion path |
| 7 | `mingla-business/src/utils/eventLifecycle.ts` | Domain logic | Lifecycle derivation for live/upcoming/past |
| 8 | `mingla-business/src/utils/eventDateDisplay.ts` | UI helper | Existing date formatting for event rows |
| 9 | `mingla-business/src/hooks/useCurrentBrand.ts`, `useBrands.ts`, `brandMapping.ts` | Server/cache | Current brand truth and server-fresh limits |
| 10 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Schema/RLS | Current events table statuses and policies |
| 11 | Historical Cycle 1, Cycle 3, Cycle 9 reports/specs | Docs/history | Why stubs survived |
| 12 | `PublicBrandPage.tsx`, `BrandProfileView.tsx`, `BrandFinanceReportsView.tsx` | Blast radius | Adjacent fake-data surfaces |

## 6. Five-Layer Cross-Check

| Layer | What it says | Evidence | Matches? |
|---|---|---|---|
| Docs/history | Home stub rows were transitional and intended to retire when real event lists existed; Cycle 9 excluded Home. | Cycle 3 investigation/spec and Cycle 9 investigation/spec. | No - retirement condition was never executed. |
| Schema/RLS | Supabase `events` table supports `draft`, `scheduled`, `live`, `ended`, `cancelled`; brand team can select/insert/update/delete owned events. | Baseline migration table and policies. | Partial - schema is ahead of Home, but Home does not query Supabase events. |
| Code | Home imports only drafts, not live events, and maps `STUB_UPCOMING_ROWS`. Events tab already imports both draft and live stores and derives lists. | `home.tsx:50-105`, `home.tsx:357-380`, `events.tsx:52-235`. | No - Home uses fabricated fallback instead of the existing real pipeline. |
| Runtime/tests | No repo-running automated guard exists for this Home regression. `mingla-business/package.json` has `lint` but no `test` script. | Package scripts inspected. | No - regression can return silently. |
| Data/cache | Drafts persist in `mingla-business.draftEvent.v1`; live events persist in `mingla-business.liveEvent.v1`; current brand now persists ID-only and fetches brand via React Query. | Store headers/selectors and ORCH-0742/0743-era current brand code. | Partial - event data exists locally, but Home reads only drafts and fake rows. |

**Contradictions:** Home's source comment says stub rows remain "until Cycle 9 ships live events list"; Cycle 9 shipped the Events tab list but intentionally did not touch Home. Home's KPI says `"1 live · 2 upcoming"` even when actual event counts differ.

## 7. Findings

### Finding 1: Home Upcoming Renders Hardcoded Event Rows

- **Severity:** High
- **Type:** confirmed bug, invariant violation
- **Confidence:** proven
- **Broken journey step:** Organiser opens Home and scans Upcoming for actual upcoming events.
- **Evidence:** `mingla-business/app/(tabs)/home.tsx:59-88` defines `STUB_UPCOMING_ROWS`; `home.tsx:357-380` maps those rows into the Upcoming section.
- **Current behavior:** Home always shows `Sunday Languor Brunch` and `The Long Lunch (Series)` below any real draft rows.
- **Expected behavior:** Home should show brand-scoped real draft/live/upcoming events, or an honest empty state.
- **Causal chain:** Cycle 1 added demo rows -> Cycle 3 preserved them while introducing real drafts -> Cycle 3 said Cycle 9 would retire them -> Cycle 9 built the event list in Events tab and excluded Home -> Home retained fabricated rows.
- **User impact:** Business users see fake events as operational truth, which undermines trust and can mislead demos, QA, and launch review.
- **Fix direction:** Delete `STUB_UPCOMING_ROWS` and replace Home Upcoming with derived rows from `useDraftsForBrand`, `useLiveEventsForBrand`, and shared lifecycle/date helpers.
- **Missing test or guardrail:** Static regression gate or focused component test that fails if Home contains `STUB_UPCOMING_ROWS`, the two fake event titles, or fallback event rows.
- **Invariant violated:** No fabricated data; one owner per truth.

### Finding 2: Home Event KPI And Live Row Use Hardcoded/Derived Fiction

- **Severity:** High
- **Type:** confirmed bug, invariant violation
- **Confidence:** proven
- **Broken journey step:** Organiser reads Home KPI tiles and the live event row for event status.
- **Evidence:** `home.tsx:269-274` hardcodes `"1 live · 2 upcoming"`; `home.tsx:331-356` renders `currentBrand.currentLiveEvent` with `Tonight · 21:00`, capacity `400`, sold count derived as `Math.round(soldGbp / 30)`, and scanned count `0`.
- **Current behavior:** KPI/live copy can report counts, time, capacity, sold tickets, and scans that are not sourced from actual event records.
- **Expected behavior:** KPI/live copy should be derived from real brand-scoped events and orders/scans where available, or omit unavailable metrics honestly.
- **Causal chain:** Home was built against an old `Brand.currentLiveEvent` display stub -> current brand architecture moved toward server-fresh brand records and separate event stores -> Home did not adopt the Events tab event pipeline.
- **User impact:** The first screen can contradict Events tab, event detail, orders, and scanner surfaces.
- **Fix direction:** Use shared derived event list/counts; do not calculate ticket counts from revenue; do not show capacity/scanned values unless sourced from an event/order/scanner truth owner.
- **Missing test or guardrail:** Static check for `"1 live · 2 upcoming"`, `Tonight · 21:00`, `Math.round(liveEvent.soldGbp / 30)`, and `/ 400` in `home.tsx`.
- **Invariant violated:** No fabricated data; one owner per truth.

### Finding 3: Home Does Not Consume The Live Event Store Already Used By Events Tab

- **Severity:** Medium
- **Type:** production-hardening gap
- **Confidence:** proven
- **Broken journey step:** Organiser publishes an event and expects Home and Events to agree.
- **Evidence:** `home.tsx:50` imports `useDraftsForBrand` only; `events.tsx:52-56` imports both `useDraftsForBrand` and `useLiveEventsForBrand`; `events.tsx:148-235` builds live/upcoming/draft/past list entries.
- **Current behavior:** Home can show drafts from the real draft store, but published live/upcoming events are not sourced from the live event store.
- **Expected behavior:** Home and Events should share a single classification path for event status rows.
- **Causal chain:** Cycle 3 added drafts to Home but left live/upcoming/past for later -> Cycle 9 solved this in Events tab only -> Home remained split-brained.
- **User impact:** Published events can appear correctly in Events while Home still shows fake upcoming rows.
- **Fix direction:** Extract or reuse a small `getBrandEventEntries`/selector-style helper from the Events tab pattern so Home and Events classify the same event set.
- **Missing test or guardrail:** Unit test for the shared derivation helper with draft, live-window, future scheduled, past, cancelled, and empty cases.

### Finding 4: Server/Client Event Status Vocabulary Is Still Transitional

- **Severity:** Medium
- **Type:** production-hardening gap, open question for backend wiring
- **Confidence:** proven for mismatch, not yet proven as active Home bug
- **Broken journey step:** Future migration from local event stores to Supabase events.
- **Evidence:** Supabase `events.status` permits `draft`, `scheduled`, `live`, `ended`, `cancelled`; `LiveEventStatus` permits only `live`, `cancelled`, `ended`; some brand preview queries in `useBrands.ts` search for `upcoming` and `past`, which are not DB enum values.
- **Current behavior:** Home's immediate bug is local stub rendering, but any future server-backed Home query can stumble over status-name drift.
- **Expected behavior:** Client lifecycle labels should map explicitly from Supabase statuses and event dates.
- **Causal chain:** Client stores model "published event" with local lifecycle derivation while database has `scheduled`; preview queries appear to use UI lifecycle labels against DB statuses.
- **User impact:** Future server-backed counts/previews could be empty or wrong.
- **Fix direction:** The ORCH-0754 Home fix should not invent DB status filters. If server events are in scope later, write a status adapter contract.
- **Missing test or guardrail:** Enum parity test or static query audit for `status` filters against Supabase enum values.

## 8. Root Cause Proof

### Root Cause A: Transitional Stub Rows Were Never Retired

- **File + line:** `mingla-business/app/(tabs)/home.tsx:59-88`, `home.tsx:357-380`
- **Exact code/schema:** `STUB_UPCOMING_ROWS` contains `Sunday Languor Brunch` and `The Long Lunch (Series)`; render path calls `STUB_UPCOMING_ROWS.map(...)`.
- **What it does:** Injects two fabricated upcoming rows into Home for every selected brand.
- **What it should do:** Render only actual brand-scoped event records, or an honest no-upcoming-events state.
- **Causal chain:** Cycle 3 intentionally kept rows as transitional -> Cycle 9 shipped real event management in Events tab -> Cycle 9 explicitly declared no Home changes -> Home never received the stub retirement.
- **Verification step:** `rg -n "STUB_UPCOMING_ROWS|Sunday Languor Brunch|The Long Lunch" mingla-business/app/\\(tabs\\)/home.tsx` returns the current definition and render use.

### Root Cause B: Home Has A Separate Event Summary Path From Events Tab

- **File + line:** `mingla-business/app/(tabs)/home.tsx:50-105`, `mingla-business/app/(tabs)/events.tsx:52-235`
- **Exact code/schema:** Home imports `useDraftsForBrand` and uses `currentBrand.currentLiveEvent` plus stubs. Events imports `useDraftsForBrand`, `useLiveEventsForBrand`, and derives entries with lifecycle status.
- **What it does:** Events tab can represent actual draft/live event-store data while Home cannot.
- **What it should do:** Home should use the same brand-scoped event selectors/classification as Events tab, with Home-specific truncation and presentation only.
- **Causal chain:** Draft support landed in Home first -> full event list logic landed later in Events -> no shared selector/hook was introduced -> Home became stale.
- **Verification step:** `rg -n "useLiveEventsForBrand|useDraftsForBrand" mingla-business/app/\\(tabs\\)/home.tsx mingla-business/app/\\(tabs\\)/events.tsx` shows Home lacks the live selector while Events uses it.

## 9. Static / Security / Pattern Flags

| Flag | File | Evidence | Severity | Classification |
|---|---|---|---|---|
| Fabricated event rows | `home.tsx` | `STUB_UPCOMING_ROWS` definition and render | High | confirmed bug |
| Hardcoded event counts | `home.tsx` | `"1 live · 2 upcoming"` | High | confirmed bug |
| Hardcoded event time/capacity/scanned | `home.tsx` | `Tonight · 21:00`, `400`, scanned `0` | High | confirmed bug |
| Split event truth path | `home.tsx`, `events.tsx` | Home lacks `useLiveEventsForBrand`; Events uses it | Medium | production-hardening gap |
| Status vocabulary mismatch | Supabase baseline, `liveEventStore.ts`, `useBrands.ts` | DB `scheduled` vs UI/local `upcoming`/`past` filters | Medium | production-hardening gap |
| No automated Home fake-data guard | `mingla-business/package.json` | no `test` script; only `lint` | Medium | production-hardening gap |

No direct RLS/security escalation was found in the Home stub bug. The schema/RLS layer permits brand-owned event access, but Home does not currently read server events.

## 10. Blast Radius

- **Other business flows affected:** Home tab event KPI, live hero, live row, Upcoming list.
- **Business Events tab:** Has the better current pattern and should be the source for the Home fix. Not itself the source of the fake Home rows.
- **Public brand page:** Already uses `useLiveEventsForBrand(brand.id)` and derives upcoming/past from real local live events; not using Home's stubs.
- **Brand profile:** `BrandProfileView.tsx` still has `STUB_PAST_EVENTS` for Recent events. Separate fake-data issue, not caused by ORCH-0754.
- **Finance reports:** `BrandFinanceReportsView.tsx` still reads `brand.events ?? []` from the old Brand-level stub model. Separate transitional issue; may render empty for server-fresh brands.
- **Mobile/admin parity:** No direct mobile/admin effect found for this Home render bug.
- **Query keys/cache/state:** Current brand is server-fresh/id-only; draft/live events are persisted local stores. The fix should not rehydrate full Brand snapshots.
- **RLS/auth/permission implications:** None for the local-store repair. If the repair scopes into Supabase events, brand team select policies exist and status mapping must be specified.
- **Integrations involved:** None.
- **Deploy/migration implications:** No migration needed for the smallest fix; product code and tests only.
- **Recurring pattern:** Transitional stubs remain after their retirement cycle because retirement was scoped out of the later implementation.

## 11. Production Readiness Verdict

- **Ready / not ready:** Not ready for launch. The Home event surface violates "no fabricated data."
- **Launch blockers:** Remove Home Upcoming stub rows and hardcoded event summary values; use actual brand-scoped event data or honest empty states.
- **Residual risks:** Server-backed event data is not fully wired into Home/Events yet; local-store truth remains transitional. Status vocabulary drift should be handled before backend event reads become the Home source.
- **Telemetry/monitoring gaps:** No telemetry was inspected or found for fake-data detection. This bug is better prevented with tests/static gates than telemetry.
- **Missing tests:** No existing repo-running test script for `mingla-business`; no static guard against Home fake rows.
- **Fastest next verification:** After implementation, run `npm run lint` in `mingla-business`, then run a focused grep/static guard that asserts Home no longer contains `STUB_UPCOMING_ROWS`, `Sunday Languor Brunch`, `The Long Lunch (Series)`, `"1 live · 2 upcoming"`, `Tonight · 21:00`, or hardcoded capacity/scanned placeholders.

## 12. Discoveries For Orchestrator

- **DISC-0754-A:** `BrandProfileView.tsx` has `STUB_PAST_EVENTS` and renders fake Recent events. Recommended separate orchestrator item unless already tracked.
- **DISC-0754-B:** `BrandFinanceReportsView.tsx` still depends on `brand.events ?? []`, while `currentBrandStore.ts` and `brandMapping.ts` indicate Brand-level events are transitional/server-derived. Recommended separate finance/report fake-data audit.
- **DISC-0754-C:** `useBrands.ts` has event preview queries filtering `status` by `upcoming` and `past`, but Supabase `events.status` does not include those enum values. Recommended enum/query parity investigation before backend event previews become user-visible truth.

## 13. Recommended Next Step

Write a narrow `$forensics` SPEC for ORCH-0754, then dispatch `$implementor`.

Spec requirements should be limited to:

1. Remove `STUB_UPCOMING_ROWS` and all hardcoded fake Home event rows.
2. Add/reuse a shared brand event derivation path based on `useDraftsForBrand`, `useLiveEventsForBrand`, `deriveLiveStatus`, and existing date display helpers.
3. Replace hardcoded Home event KPI/live row copy with derived actual counts and honest unavailable/empty states.
4. Do not add Supabase event reads in this fix unless the spec explicitly expands scope; do not restore full Brand snapshot event truth.
5. Add a regression guard. Minimum acceptable gate: a repo-running script or lint-adjacent check that fails on Home fake-data signatures. Better gate: shared derivation unit tests plus static fake-data grep.

Implementation should not broaden into BrandProfile or Finance fake-data cleanup in the same diff. Those are real side discoveries, but they are separate surfaces with different contracts.
