# Spec: Business Home Upcoming Stub Data Fix (ORCH-0754)

> Date: 2026-05-08
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md`
> Root cause: `RC-0754`
> Status: SPEC READY

## 1. Layman Summary

The business Home tab must stop showing fake upcoming events and fake live-event metrics. After this fix, organisers see their actual current-brand event pipeline on Home: drafts from `draftEventStore`, published live/upcoming events from `liveEventStore`, and honest empty/unavailable states when data does not exist.

This is a first-screen trust repair. The Events tab already has the right local event truth; Home needs to use the same truth instead of the Cycle 1/3 transitional rows.

## 2. User Story

As a business organiser, I want the Home tab's Upcoming section and Active events KPI to reflect my actual current-brand events, so that I can trust the dashboard before opening the full Events tab.

## 3. Scope

- **In scope:**
  - `mingla-business/app/(tabs)/home.tsx`
  - A small shared pure helper at `mingla-business/src/utils/brandEventSummary.ts`
  - Unit tests at `mingla-business/src/utils/__tests__/brandEventSummary.test.ts`
  - ORCH-0754 regression gate at `.github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs`
  - `.github/workflows/strict-grep-mingla-business.yml`, `.github/scripts/strict-grep/README.md`, and `mingla-business/package.json` script registration.

- **Non-goals:**
  - No Supabase event reads/writes, migrations, RLS, edge functions, RPCs, or server status adapter in this fix.
  - No restoration of full `Brand` snapshots or Brand-level event truth in persisted Zustand.
  - No changes to `BrandProfileView.tsx` fake recent events.
  - No changes to `BrandFinanceReportsView.tsx` Brand-level event stubs.
  - No public brand page, mobile app, admin app, Stripe, scanner, order creation, checkout, or finance changes.

- **Assumptions:**
  - ORCH-0754 "actual data" means the existing transitional local truth for business events: `useDraftsForBrand`, `useLiveEventsForBrand`, and `useOrderStore` where sold/revenue metrics are already available.
  - Backend event storage remains transitional and out of scope.

- **Dependencies:** Existing `deriveLiveStatus`, `formatDraftDateLine`, `useDraftsForBrand`, `useLiveEventsForBrand`, `useOrderStore`, `EventCover`, `Pill`, and Home styles.

## 4. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|
| Remove fake upcoming rows | Investigation Finding 1; `home.tsx:59-88`, `home.tsx:357-380` | Proven |
| Replace hardcoded KPI/live copy | Investigation Finding 2; `home.tsx:269-274`, `home.tsx:331-356` | Proven |
| Consume live event store on Home | Investigation Finding 3; `events.tsx:52-235` has pattern, Home lacks live selector | Proven |
| Do not use Supabase event statuses yet | Investigation Finding 4; status vocabulary mismatch is future backend work | Proven |
| Add regression guard | Investigation §11; no existing Home fake-data guard | Proven |

## 5. Success Criteria

1. `home.tsx` no longer contains `STUB_UPCOMING_ROWS`, `StubUpcomingRow`, `Sunday Languor Brunch`, `The Long Lunch (Series)`, `"1 live · 2 upcoming"`, `Tonight · 21:00`, `Math.round(liveEvent.soldGbp / 30)`, or hardcoded event capacity/scanned values.
2. Home imports `useLiveEventsForBrand` and derives its event summary from current-brand drafts + live events.
3. Home's Active events KPI value is derived from live + upcoming + draft counts, excluding past/cancelled events.
4. Home's Active events KPI subcopy is derived from counts. If no active events exist, it says `No active events`.
5. Home's Upcoming section renders real active event rows only: live-window published events first, future/upcoming published events next, drafts last.
6. If there are no active rows, Home shows an honest empty state inside the Upcoming section: title `No upcoming events` and body `Build an event to see it here.`
7. If a live-window event exists, the Home hero uses that `LiveEvent`, not `currentBrand.currentLiveEvent`.
8. The live hero does not show fake goal/progress/capacity/scanned values. It may show real revenue/sold/capacity from `useOrderStore` + `LiveEvent.tickets`, and must show `—` for metrics not backed by a truth owner.
9. `cd mingla-business && npm run lint` passes.
10. `cd mingla-business && npm run test:orch-0754` passes and fails on the pre-fix fake signatures.

## 6. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|
| No fabricated data | Delete Home stubs and fake metrics; add strict-grep gate | `test:orch-0754` |
| One owner per truth | Events come from draft/live/order stores, not Brand snapshots | code review + unit tests |
| I-16 Live-event ownership separation | Read only from `useLiveEventsForBrand`; do not call `addLiveEvent` | grep/code review |
| I-18/I-19 Order truth | Sold/revenue metrics read from `useOrderStore`, not local arithmetic from revenue | code review |
| I-14 date display | Use `formatDraftDateLine`; do not add local date formatter | unit tests/code review |

### New Invariants

No new global invariant is required. ORCH-0754 adds a local regression gate under provisional name `I-PROPOSED-Z: HOME-NO-FABRICATED-EVENTS`; orchestrator may ratify or rename it during close.

## 7. Database / RLS / Migration

None.

- RLS policies: no change.
- Backfill/data migration: none.
- Indexes/constraints: none.
- Rollback: revert product-code/helper/test/gate changes only.

## 8. Edge Functions / RPCs / Webhooks

None.

## 9. Service Layer

None.

## 10. Hook / State / Cache Layer

### Shared Helper

- **Path:** `mingla-business/src/utils/brandEventSummary.ts`
- **Purpose:** Pure derivation helper so Home and Events can share the active-event classification contract without duplicating inline list logic.
- **Inputs:**

```ts
import type { DraftEvent } from "../store/draftEventStore";
import type { LiveEvent } from "../store/liveEventStore";

export type BrandEventStatus = "live" | "upcoming" | "draft" | "past";
export type BrandEventKind = "live" | "draft";

export interface BrandEventSummaryItem {
  key: string;
  event: LiveEvent | DraftEvent;
  kind: BrandEventKind;
  status: BrandEventStatus;
}

export interface BrandEventCounts {
  all: number;
  live: number;
  upcoming: number;
  draft: number;
  past: number;
  active: number;
}

export interface BrandEventSummary {
  counts: BrandEventCounts;
  allItems: BrandEventSummaryItem[];
  activeItems: BrandEventSummaryItem[];
  primaryLiveItem: BrandEventSummaryItem | null;
}

export const buildBrandEventSummary = (
  liveEvents: LiveEvent[],
  drafts: DraftEvent[],
): BrandEventSummary => { /* implement per contract below */ };
```

- **Classification contract:**
  - For each `LiveEvent`, call shared `deriveLiveStatus(event)` from `src/utils/eventLifecycle.ts`.
  - Collapse `deriveLiveStatus(event) === "cancelled"` to summary status `"past"` for Home/Events list grouping. Do not show cancelled events in Home `activeItems`.
  - Drafts always get status `"draft"`.
  - `counts.all = liveEvents.length + drafts.length`.
  - `counts.live = live event entries with status "live"`.
  - `counts.upcoming = live event entries with status "upcoming"`.
  - `counts.draft = drafts.length`.
  - `counts.past = live event entries with status "past"`.
  - `counts.active = live + upcoming + draft`.
  - `activeItems = live entries with status live, then upcoming entries, then draft entries`.

- **Sorting contract:**
  - Live entries first. Preserve existing live-event order unless a deterministic tie-breaker is needed.
  - Upcoming entries sorted by `event.date ?? ""` ascending.
  - Draft entries sorted by `updatedAt` descending.
  - Past entries only in `allItems`, sorted by `event.date ?? ""` descending.

- **No hook usage:** helper is pure and must not import React, Zustand hooks, `useOrderStore`, navigation, or components.

### Home Hook Usage

- **Path:** `mingla-business/app/(tabs)/home.tsx`
- **Required changes:**
  - Import `useLiveEventsForBrand` from `src/store/liveEventStore`.
  - Import `buildBrandEventSummary` from `src/utils/brandEventSummary`.
  - Import `formatDraftDateLine` from `src/utils/eventDateDisplay`.
  - Import `useOrderStore` if Home displays sold/revenue metrics.
  - Continue using `useCurrentBrand()` for current brand identity; do not use `currentBrand.currentLiveEvent` for Home event truth.

- **State/cache contract:**
  - `const drafts = useDraftsForBrand(currentBrand?.id ?? null);`
  - `const liveEvents = useLiveEventsForBrand(currentBrand?.id ?? null);`
  - `const eventSummary = useMemo(() => buildBrandEventSummary(liveEvents, drafts), [liveEvents, drafts]);`
  - If reading order metrics, subscribe to `useOrderStore((s) => s.entries)` or a selector that rerenders when `entries` changes. Do not use `useOrderStore.getState()` for rendered metrics.

## 11. Component / Screen Layer

### `HomeTab`

- **Path:** `mingla-business/app/(tabs)/home.tsx`
- **Props:** none.
- **States:**

| State | Condition | Renders |
|---|---|---|
| No brand | `brands.length === 0 || currentBrand === null` | Preserve existing no-brand card. Do not render event rows. |
| Drafts only | `counts.draft > 0`, `counts.live === 0`, `counts.upcoming === 0` | KPI value = draft count. KPI sub = `0 live · 0 upcoming · N drafts`. Upcoming section renders draft rows with `Draft` pill, title fallback, `Step X of 7 · <relative updatedAt>`, and resume rail. |
| Upcoming published only | `counts.upcoming > 0`, no live | KPI value = upcoming + drafts. KPI sub includes upcoming/draft counts. Upcoming section renders published upcoming rows with `Upcoming`/accent pill, title, `formatDraftDateLine(event)`, and real sold/capacity if available. |
| Live-window event exists | `primaryLiveItem !== null` | Hero renders from that `LiveEvent`. KPI sub includes live count. Upcoming section renders the live row first. |
| No active events | `counts.active === 0` | KPI value `0`, sub `No active events`; Upcoming empty card title `No upcoming events`, body `Build an event to see it here.` |

- **Hero contract when live event exists:**
  - Source event: `eventSummary.primaryLiveItem.event as LiveEvent`.
  - Pill copy: `Live now`.
  - Title: event name or `Untitled event`.
  - Date line: `formatDraftDateLine(event)`.
  - Revenue: use `useOrderStore` revenue for that event. If `0`, show `—` or `£0` only if the surrounding label makes clear this is actual current revenue.
  - Tickets sold: use `useOrderStore` sold count for that event.
  - Capacity: compute from `event.tickets`: sum finite `capacity` for non-unlimited tickets; if any unlimited tier and finite sum is `0`, render `Unlimited`; if no ticket capacity exists, render `—`.
  - Scanned: render `—` unless implementor proves an existing scan truth owner is already imported safely. Do not add scan-store scope in this fix.
  - Remove `liveProgress` based on `BrandLiveEvent.goalGbp` unless progress is recomputed from real sold/capacity.

- **KPI contract:**
  - `Active events` value = `eventSummary.counts.active`.
  - Subcopy:
    - if active > 0: `${live} live · ${upcoming} upcoming · ${draft} drafts`, with plural `draft`/`drafts` correct.
    - if active = 0: `No active events`.
  - Do not use `currentBrand.stats.events` for this KPI in ORCH-0754; it is not the Home event truth.

- **Upcoming row contract:**
  - Render `eventSummary.activeItems`.
  - Do not add artificial rows.
  - For draft rows: preserve current tap to `/event/${draft.id}/edit`, accessibility label `Resume draft: ...`, `Draft` pill, cover hue, title fallback, and resume rail.
  - For live/upcoming rows: tap opens `/event/${event.id}`; accessibility label `Open event: ...`; `Live` pill for status `live`, `Upcoming` pill for status `upcoming`; date line from `formatDraftDateLine(event)`.
  - Right rail for live/upcoming: if finite capacity > 0 render `${soldCount} / ${capacity}` with label `sold`; otherwise render sold count alone with label `sold`; never render `/ 400`.

- **Copy:**
  - Empty card title: `No upcoming events`
  - Empty card body: `Build an event to see it here.`
  - No in-app explanatory text about the bug, transitional state, or tests.

- **Accessibility:** all event row Pressables must retain `accessibilityRole="button"` and a specific label. The `See all` link remains.

- **Layout/design constraints:** preserve existing Home visual style. Do not introduce new cards inside cards. Existing row styles may be reused.

## 12. Business / Admin / Public Parity

- Business app changes: Home only plus shared helper/tests/gates.
- Admin changes: none.
- Public/web changes: none.
- Operational dependency: none.

Side discoveries explicitly not fixed here:

- `DISC-0754-A`: `BrandProfileView.tsx` fake `STUB_PAST_EVENTS`.
- `DISC-0754-B`: `BrandFinanceReportsView.tsx` Brand-level event stub dependency.
- `DISC-0754-C`: `useBrands.ts` `upcoming`/`past` status filters versus Supabase enum.

## 13. Realtime / Notifications / Analytics

None.

## 14. Implementation Order

1. Create `mingla-business/src/utils/brandEventSummary.ts` with the pure summary helper.
2. Add `mingla-business/src/utils/__tests__/brandEventSummary.test.ts`.
3. Wire `home.tsx` imports and state:
   - Add `useLiveEventsForBrand`.
   - Add `buildBrandEventSummary`.
   - Add `formatDraftDateLine`.
   - Add reactive order metric read if metrics remain visible.
4. Replace `liveEvent = currentBrand?.currentLiveEvent` with `eventSummary.primaryLiveItem`.
5. Replace `liveProgress` with real sold/capacity progress or delete the progress display.
6. Replace Active events KPI value/subcopy with `eventSummary.counts`.
7. Replace the Upcoming section rows with `eventSummary.activeItems`.
8. Delete `StubUpcomingRow`, `STUB_UPCOMING_ROWS`, and stale transitional comments in the Home header.
9. Add `.github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs`.
10. Update `.github/scripts/strict-grep/README.md` active gates table and allowlist section with `I-PROPOSED-Z`.
11. Add a workflow job in `.github/workflows/strict-grep-mingla-business.yml`.
12. Add `test:orch-0754` to `mingla-business/package.json`:

```json
"test:orch-0754": "node ../.github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs && npx jest brandEventSummary.test"
```

13. Run verification commands and write implementation report.

## 15. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|
| T-1 | Drafts only | 2 drafts, 0 live events | counts active=2, draft=2; activeItems are both drafts newest updated first | Unit | `npx jest brandEventSummary.test` |
| T-2 | Upcoming published only | 2 future live events | upcoming count=2; activeItems sorted by date asc | Unit | same |
| T-3 | Live-window event | event date inside live window | live count=1; primaryLiveItem is that event | Unit | same |
| T-4 | Past/cancelled excluded from Home active | past event + cancelled event | activeItems excludes both; past count includes both | Unit | same |
| T-5 | Mixed list order | live, upcoming, draft, past | activeItems order live -> upcoming -> draft; past only in allItems | Unit | same |
| T-6 | Home fake signatures absent | post-fix `home.tsx` | gate exits 0 | Static | `npm run test:orch-0754` |
| T-7 | Gate fails before fix | run gate against current pre-fix Home | flags fake signatures | Static | implementor report includes pre/post evidence or describes pre-fix expected fail |
| T-8 | Lint | final tree | no lint errors | Static | `npm run lint` |

## 16. Regression Prevention

- **Structural safeguard:** `buildBrandEventSummary` becomes the shared derivation point for Home and is available for Events tab follow-up reuse. The implementor may also rewire `events.tsx` to use the helper in this same diff if it is a small mechanical substitution and tests stay green; otherwise leave Events unchanged and record that the helper is ready for the next refactor.
- **Test:** `brandEventSummary.test.ts` covers classification/count/order.
- **Static gate:** `.github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs`.
- **Gate behavior:** scan only `mingla-business/app/(tabs)/home.tsx` and fail on any of these signatures:
  - `STUB_UPCOMING_ROWS`
  - `StubUpcomingRow`
  - `Sunday Languor Brunch`
  - `The Long Lunch (Series)`
  - `"1 live · 2 upcoming"` or `'1 live · 2 upcoming'`
  - `Tonight · 21:00`
  - `Math.round(liveEvent.soldGbp / 30)`
  - `/ 400`
  - `currentBrand?.currentLiveEvent`
- **Workflow:** register the gate in `strict-grep-mingla-business.yml`.
- **Artifact update:** implementation report must cite ORCH-0754 and list all removed signatures.

## 17. Rollback And Deploy Safety

- **Migration order:** none.
- **Edge function deploy:** none.
- **Mobile OTA vs native build:** JS-only `mingla-business` change; no native dependency changes. Standard Expo/EAS update path only if operator ships the business app bundle.
- **Business/admin web deploy:** Expo web/build path only if business web deploy is in use.
- **Env vars/secrets:** none.
- **Partial rollback risk:** reverting Home without reverting the strict-grep gate will make the gate fail, which is intended.

## 18. Common Mistakes

1. Do not replace `STUB_UPCOMING_ROWS` with a different local fixture array.
2. Do not use `currentBrand.currentLiveEvent` as the source of Home event truth.
3. Do not calculate ticket count from revenue.
4. Do not hardcode capacity, scanned count, or event time.
5. Do not introduce Supabase status filters like `status = "upcoming"` in this fix.
6. Do not use `useOrderStore.getState()` for rendered metrics; subscribe reactively.
7. Do not broaden into Profile/Finance fake-data cleanup.

## 19. Handoff To Implementor

Build the pure `brandEventSummary` helper first, lock it with Jest tests, then rewire `home.tsx` to use drafts + live events + order metrics instead of Brand snapshots and stubs. Remove every fake Home signature and add the `I-PROPOSED-Z` strict-grep gate plus `npm run test:orch-0754`. This is a Home trust repair only: no Supabase, no Profile/Finance cleanup, no backend status adapter.
