# INVESTIGATION — ORCH-0965 [Home dashboard intelligent KPIs + tri-kind upcoming]

**Investigator:** Claude `mingla-forensics` (INVESTIGATE mode).
**Date:** 2026-05-25.
**Working tree:** `~/Desktop/mingla-orchs/0965-[home-dash-intelligent-kpis-upcoming]/` on branch `0965-home-dash-intelligent-kpis-upcoming`.
**Severity:** S2-medium · **Classification:** `missing-feature` + `ux` + `quality-gap`.
**Confidence:** HIGH (source-truth audit across home screen + 4 prior precedent investigations + trip / event / experience services + Brand type). No live-fire performed this phase — pure code audit was sufficient to prove every finding mechanically. Live sim repro deferred to TEST phase.
**Status:** root cause proven (Phase 4 five-layer check passed for all root causes).

---

## 1. Layman summary

The brand-owner home dashboard today is **trip-blind**. The "Upcoming" list explicitly filters out `event_type='trip'` at the service layer (`fetchBusinessEventsForBrand` lines 478–509), so trip-planner brands and any brand running trips never see them on home — they live only on `/hub/trips`. The "Active events" KPI tile counts the same trip-blind set, so a brand running five live trips reads "0 active". On top of that, the Upcoming list sort is not pure soonest-first — it sorts by status-rank (live → upcoming → past → draft) FIRST and only sorts by `.date` within the `upcoming` bucket, which means a draft starting tomorrow appears below a live event that's already underway and below all upcoming-bucket events regardless of their start date. The KPI hero also collapses N simultaneous live events into a single "primary" card (the first one in the sorted list) — brands running 2+ live events lose visibility on the rest.

For the empty-state side, there's already a strong architectural precedent: ORCH-0855 added a `trip_planner`-specific best-next-action card at lines 419–477 (`currentBrand.kind === 'trip_planner'` → Stripe-status-aware CTA). The operator-requested rule ladder generalises that pattern to all three brand kinds and to all readiness gaps.

Fix direction (defer to SPEC phase): (a) introduce a `useUpcomingForBrand` hook that composes events + experiences + trips and sorts strictly by start time ascending; (b) generalise the trip-planner CTA into a multi-signal rule ladder rendered when the dashboard would otherwise be empty; (c) make the "Active events" KPI tri-kind aware. All three are additive — they preserve every existing behaviour because they ride on the existing per-kind services that already work.

---

## 2. Phase 0 — Mandatory ingestion

| # | File | One-line summary |
|---|---|---|
| 1 | `mingla-business/app/(tabs)/home.tsx` (1,053 lines) | Authoritative home dashboard render. Three states (no-brand / brand-no-live / brand-with-live). KPI grid = 2 tiles; Upcoming list = `eventSummary.activeItems`. Trip-planner CTA already present (lines 419–477) — architectural precedent for the rule-ladder pattern. |
| 2 | `mingla-business/src/services/businessEvents.ts:466–521` (`fetchBusinessEventsForBrand`) | The Upcoming source query. **Explicitly filters out `event_type='trip'`** via a 2-step probe (rows from `business_management_events_view` then `.in("id", ids)` against `events` to read `event_type`, then `filteredRows = rows.filter(r => !tripIds.has(r.id))`). Keeps `event` AND `experience`. |
| 3 | `mingla-business/src/services/tripsService.ts:611–661` (`getTripsByBrand`) | Trips live on the SAME `events` table (`.eq("event_type", "trip")`) and use `event_dates` (`is_master=true`) for start time. Used today only by `/hub/trips`. Hook: `useTripsByBrand`. |
| 4 | `mingla-business/src/services/experiencesService.ts` | Experiences = `event_type='experience'`, same `events` table. Currently flows through `fetchBusinessEventsForBrand` (kept by the trip filter). ORCH-0881 Ve5 origin. |
| 5 | `mingla-business/src/utils/brandEventSummary.ts` (107 lines) | `buildBrandEventSummary(liveEvents, drafts)` — status classification + sort. Sort is **statusRank first** (live=0, upcoming=1, past=2, draft=3), then by `.date` ascending within upcoming, by `updatedAt` desc within draft. **Not pure soonest-first.** |
| 6 | `mingla-business/src/utils/eventLifecycle.ts` → `deriveLiveStatus` (called from brandEventSummary) | Computes live/upcoming/past/cancelled from event + master start. Status authority for the existing pipeline. |
| 7 | `mingla-business/src/utils/eventDateMath.ts` → `computeMasterStartAtUtc` | Reads `event.dates` (master row) → UTC instant. Will need a trip equivalent (trips already store `event_dates` master rows — same primitive should work). |
| 8 | `mingla-business/src/hooks/useBusinessEvents.ts` + `useServerDraftEvents.ts` + `store/liveEventStore.ts` + `store/draftEventStore.ts` | React-Query server-state + Zustand legacy/local stores. `liveEvents` = server + legacy merged; `drafts` = local Zustand. |
| 9 | `mingla-business/src/types/brand.ts` (`Brand`, `BrandStats`) | Readiness signal columns: `kind` ('physical' \| 'popup' \| 'trip_planner'), `address` (string \| null), `stripeStatus` ('active' \| ...), `stats: { rev, rev7d, events, followers, attendees }`. No explicit `published_at` on the Brand type — brand existence implies publishable. |
| 10 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md` | 2026-05-08. Precedent: retired stub Upcoming rows; established the "derive Home from real stores + lifecycle helpers" architecture. **Constitutional rule #9 (no fabricated data) is the prior anchor here.** |
| 11 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md` | 2026-05-12. Fixed "Last 7 days" tile (was lifetime GMV, now `currentBrand.stats.rev7d` windowed). Added Realtime invalidation + pull-to-refresh on home. **Must not regress.** |
| 12 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0913_TRIP_DASHBOARD_PARITY.md` | 2026-05-22. Trip dashboard parity work — confirms `ActionTile`, `EventDetailKpiCard`, `EventDetailActivityRow` are shared primitives between event + trip surfaces. No home-screen overlap but confirms the trips-as-first-class-citizen direction. |
| 13 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md` | 2026-05-24. Trip capacity dual-source-of-truth fix. Confirms `ticket_types.quantity_total` is canonical capacity (not JSONB), and `event_dates` is canonical for dates. Aligns with what tri-kind upcoming needs. |
| 14 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (skim for KPI/home invariants) | No conflicting invariants found. The new "tri-kind home Upcoming" rule will become a new invariant (proposed I-PROPOSED-HOME-UPCOMING-TRI-KIND-SOONEST-FIRST) at SPEC time. |
| 15 | `COMMS_LEDGER.md` Active entries (this session) | COMMS-0001 not in scope (Tax/ORCH-0955). COMMS-0002 (ORCH-0863 strict-grep) — no backend additions in this ORCH's likely scope, will re-verify at SPEC. COMMS-0003 (external API docs verified) — Stripe Connect readiness signal is a SOURCE READ from the brand record (already-trusted column), no new Stripe API surface — does NOT trigger COMMS-0003. COMMS-0004 (INTAKE numbering) — honoured at INTAKE. |

---

## 3. Symptom map (current behaviour, multi-variant)

### 3.1 KPI top section (lines 478–556)

```
+---------------------------------------------+ +----------------------+
| LIVE HERO (if primaryLiveEvent !== null)    | | Active events tile   |
|   • Pill "Live now" (livePulse)             | |   value = counts.active
|   • event name + date                       | |   sub = "N live · M upcoming · K drafts"
|   • revenueLabel (from useEventSalesSummaries)| +----------------------+
|   • progress bar (sold / capacity)          |
|   • 3-cell strip: sold | capacity | scanned |
| ELSE → Last-7-days KpiTile (rev7d)          |
+---------------------------------------------+
```

**Variants and their gaps:**

| Brand state | Tile 1 today | Gap |
|---|---|---|
| No brand selected | empty state | (correct) |
| Brand, 0 events / 0 trips / 0 experiences, no sales | "Last 7 days" tile showing `0.00` | Empty zero is uninformative. Operator wants a single best-next-action card here. |
| Brand, 1 live event | live hero | (works, but ignores live trips + live experiences) |
| Brand, 2+ live events | live hero of FIRST live item only | **Other live events are invisible.** |
| Brand, 0 live event but 1+ live TRIP | "Last 7 days" tile | **Trip blindness — no live-trip hero.** (Trip-planner brands hit the ORCH-0855 CTA above, but multi-kind brands with trips don't have a trip-planner kind.) |
| Brand, 0 live event but 1+ live EXPERIENCE | live hero of experience (if it sneaks through) | partial — experience is kept by `fetchBusinessEventsForBrand` so this may already work; needs sim repro to confirm visual parity. |

### 3.2 Upcoming section (lines 558–710)

```
Upcoming
  See all → /(tabs)/hub/events

[GlassCard "No upcoming events" — empty state]
or
[ list of eventSummary.activeItems ]
  - Each item: cover media + status pill (Live / Upcoming / Draft) + name + dateLine + sold/revenue
  - Sort: statusRank (live=0, upcoming=1, past=2, draft=3) → then date asc within upcoming, updatedAt desc within draft
  - Source: liveEvents (events+experiences, server) + legacyLiveEvents (Zustand) + drafts (Zustand)
  - **Trips: NEVER appear here.**
```

**Sort proof** — `brandEventSummary.ts:31–37`:
```
const statusRank: Record<BrandEventSummaryStatus, number> = {
  live: 0, upcoming: 1, past: 2, draft: 3,
};
```
A draft with `startsAt=tomorrow` ranks 3; a live event ranks 0; an upcoming event ranks 1. The current ordering is "by lifecycle bucket then by date within bucket" — NOT "by start time across all kinds and lifecycles". This is the operator's "true upcoming" violation.

---

## 4. Findings (classified, six-field evidence)

### F-1 🔴 Root cause — Upcoming list excludes trips entirely

| Field | Value |
|---|---|
| **Where** | [mingla-business/src/services/businessEvents.ts:478–509](../../mingla-business/src/services/businessEvents.ts#L478-L509) |
| **Exact code** | `filteredRows = rows.filter((r) => !tripIds.has(r.id));` after a 2-step probe that captures every row's `event_type` and builds `tripIds = new Set<string>` for `t === "trip"`. |
| **What it does** | Removes every row where `event_type === 'trip'` before the events list is returned to `useBusinessEventsForBrand`. Home reads from this hook. |
| **What it should do** | For the events tab (current consumer): keep filtering trips. For the home Upcoming list (operator scope): include trips. The fix is NOT to weaken `fetchBusinessEventsForBrand` (that would regress the events tab and the consumer feed which already excludes trips — `supabase/functions/discover-merged-events/index.ts` per the comment) — instead, introduce a new dedicated `useUpcomingForBrand` hook that calls both `fetchBusinessEventsForBrand` AND `getTripsByBrand` and merges. |
| **Causal chain** | home.tsx:139 `useBusinessEventsForBrand` → service filter excludes trips → `liveEvents` array has zero trip rows → `buildBrandEventSummary` builds activeItems from events+experiences+drafts only → Upcoming list never renders trips → operator sees no trips on home regardless of how many live trips the brand has. |
| **Verification** | Source-proven by code path. Live-fire verification at TEST: create a `physical` or `popup` brand, publish one trip (event_type='trip', status='live', master event_date in the future), open home → confirm trip is missing from Upcoming. |

### F-2 🔴 Root cause — Upcoming sort violates "true soonest-first ascending"

| Field | Value |
|---|---|
| **Where** | [mingla-business/src/utils/brandEventSummary.ts:31–74](../../mingla-business/src/utils/brandEventSummary.ts#L31-L74) |
| **Exact code** | `if (aRank !== bRank) return aRank - bRank;` — primary sort is by `statusRank` (live=0, upcoming=1, past=2, draft=3); date sort applies ONLY within the `upcoming` bucket. |
| **What it does** | All live items appear before any upcoming item; all upcoming items appear before any draft; date is used only for tie-breaking within `upcoming`. A draft starting tomorrow appears AFTER an upcoming event starting in three weeks. |
| **What it should do** | Sort strictly by `startAtUtc` ascending across all items regardless of kind or lifecycle (with a defined tiebreaker rule for items without a `startAt` — most likely: draft items without a date go to the bottom; SPEC will decide). Past items excluded. Live items either pinned-to-top OR treated as "starts in the past, ends in the future" with `endsAt asc` (open question — see §6 Q-O-1). |
| **Causal chain** | `buildBrandEventSummary` sort returns `activeItems` in lifecycle-bucket order → home.tsx:592 renders `activeItems.map(...)` in that order → user sees a draft tomorrow below an upcoming event three weeks out. |
| **Verification** | Unit-testable. Create two synthetic items: `{kind:'draft', startsAt:T+1d}` and `{kind:'upcoming-event', startsAt:T+21d}`. Current sort returns `[upcoming, draft]`; correct sort returns `[draft, upcoming]`. |

### F-3 🔴 Root cause — Active events KPI counts only events + experiences

| Field | Value |
|---|---|
| **Where** | [mingla-business/app/(tabs)/home.tsx:296–299, 549–555](../../mingla-business/app/(tabs)/home.tsx#L296-L299) |
| **Exact code** | `const eventSummary = useMemo(() => buildBrandEventSummary(liveEvents, drafts), [liveEvents, drafts]);` — and `liveEvents` is the merge of server (trip-stripped) + Zustand legacy. The Active events KpiTile binds to `eventSummary.counts.active`. |
| **What it does** | Counts only events + experiences + local drafts. Trips are absent. A brand with 5 live trips + 0 events reads `0 active` on the KPI tile. |
| **What it should do** | Sum across all three kinds. A trip counts toward `live` / `upcoming` / `past` by the same lifecycle logic events use. SPEC will decide whether the sub label "N live · M upcoming · K drafts" needs a kind breakdown (e.g., "3 live (1 event, 2 trips)") or stays kind-agnostic. |
| **Causal chain** | Same as F-1 — the trip-blind source feeds both the Upcoming list AND the KPI counts via `eventSummary.counts`. |
| **Verification** | Same trip brand as F-1 verification → confirm tile reads `0` despite the live trip. |

### F-4 🟠 Contributing factor — KPI hero collapses N live events into 1

| Field | Value |
|---|---|
| **Where** | [mingla-business/app/(tabs)/home.tsx:300, 313–343, 480–531](../../mingla-business/app/(tabs)/home.tsx#L300) and [brandEventSummary.ts:94](../../mingla-business/src/utils/brandEventSummary.ts#L94) |
| **Exact code** | `primaryLiveItem = activeItems.find((item) => item.status === "live") ?? null;` — returns the FIRST item in the lifecycle-sorted list whose status is `live`. Hero binds to `primaryLiveEvent` only. |
| **What it does** | When a brand has 2+ simultaneous live events (or once F-1 is fixed, 2+ live items across events/trips/experiences), only one renders in the hero. The others fall into the Upcoming list as "Live" pill rows — visible but de-emphasised. |
| **What it should do** | Open scope decision for SPEC (see §6 Q-O-5). Options: (a) carousel of live cards; (b) summary tile "N live now" → tap to expand; (c) keep current single-primary + a "+N more live" affordance; (d) accept current behaviour as fine for v1 and defer. |
| **Causal chain** | `activeItems.find(...)` returns the first match → hero shows that one → other live items are reachable only in the Upcoming list (with reduced visual weight). |
| **Verification** | Create 2 live events on one brand. Confirm only the first renders in the hero. |

### F-5 🟠 Contributing factor — Empty-state CTA is kind-blind (except for trip_planner)

| Field | Value |
|---|---|
| **Where** | [mingla-business/app/(tabs)/home.tsx:579–590](../../mingla-business/app/(tabs)/home.tsx#L579-L590) (Upcoming empty); [419–477](../../mingla-business/app/(tabs)/home.tsx#L419-L477) (trip-planner CTA — partial precedent). |
| **Exact code** | The Upcoming empty card hardcodes `"No upcoming events"` + `"Tap + in the top right to create your first event."` Regardless of brand kind, Stripe status, draft existence, etc. The KPI tile in the empty case is the `Last 7 days` zero. |
| **What it does** | A brand with no Stripe connected, no published brand state, no offerings drafted gets a generic "create your first event" prompt — no signal-aware best-next-action. |
| **What it should do** | A static rule ladder over readiness signals (see §5 Readiness inventory) renders ONE best-next-action card. The trip-planner CTA at lines 419–477 is the existing pattern to generalise. |
| **Causal chain** | `eventSummary.activeItems.length === 0` → static empty card → no signal-aware guidance → high-friction onboarding for new brands. |
| **Verification** | Create a fresh `physical`-kind brand with no Stripe, no offerings. Confirm only the generic "create your first event" prompt is shown. |

### F-6 🟡 Hidden flaw — `formatActiveEventsSub` hardcodes "drafts" terminology kind-blindly

| Field | Value |
|---|---|
| **Where** | [mingla-business/app/(tabs)/home.tsx:111–119](../../mingla-business/app/(tabs)/home.tsx#L111-L119) — `formatActiveEventsSub` (note: home.tsx actually delegates to `getActiveEventsKpiSub` at `homeKpiPresentation.ts:?`, but the bones are equivalent). |
| **Exact code** | `${counts.live} live · ${counts.upcoming} upcoming · ${counts.draft} ${counts.draft === 1 ? "draft" : "drafts"}` |
| **What it does** | When trips enter the count, the sub-label still says "live / upcoming / drafts" — semantically correct, but the brand-owner can't tell what KIND of offering is contributing to the count. |
| **What it should do** | Open question for SPEC — either accept "kind-agnostic counts" (simpler, recommended) or expose breakdowns (`3 live: 1 event · 2 trips`). |
| **Causal chain** | Future visibility issue, not a today-bug. |
| **Verification** | Manual eyeball. |

### F-7 🔵 Observation — ORCH-0855 trip-planner CTA is the architectural precedent for the rule ladder

| Field | Value |
|---|---|
| **Where** | [mingla-business/app/(tabs)/home.tsx:419–477](../../mingla-business/app/(tabs)/home.tsx#L419-L477) |
| **Exact code** | `{currentBrand.kind === "trip_planner" ? (<View style={styles.tripPlannerCtaWrap}><GlassCard ...><Text>{currentBrand.stripeStatus === "active" ? "Plan a trip" : "Finish setting up Stripe"}...</GlassCard></View>) : null}` |
| **What it does** | Renders a brand-kind-aware best-next-action card ABOVE the KPI grid. Survives regression because it's purely additive (returns `null` for other kinds). |
| **What it should do** | Generalise into a multi-signal rule ladder that covers all three kinds. The trip-planner case becomes the FIRST or SECOND rung of the new ladder, not a parallel card. |
| **Causal chain** | n/a — observation. |
| **Verification** | n/a. |

### F-8 🟡 Hidden flaw — `mergeServerAndLegacyLiveEvents` may need a trip-aware sibling

| Field | Value |
|---|---|
| **Where** | [mingla-business/src/hooks/useBusinessEvents.ts:?](../../mingla-business/src/hooks/useBusinessEvents.ts) — `mergeServerAndLegacyLiveEvents`. |
| **Exact code** | (not fully read this phase) merges `server` events with `legacyLiveEvents` from Zustand. The Zustand `liveEventStore` holds locally-cached event rows. |
| **What it does** | Provides offline / optimistic merging for events. There's no equivalent for trips — `useTripsByBrand` is server-only. |
| **What it should do** | SPEC decides: either (a) compose at hook level without legacy-merge for trips (acceptable — trips are server-authoritative, no local optimistic store today), or (b) add a `tripsStore` (over-scoped for this ORCH). Recommend (a). |
| **Causal chain** | n/a — surfaces only if SPEC tries to compose the new hook by reusing the legacy-merge pattern. |
| **Verification** | n/a until SPEC. |

---

## 5. Readiness-signal inventory for the best-next-action rule ladder

Source-of-truth columns confirmed from `mingla-business/src/types/brand.ts` + the `Brand` query path:

| Signal | Field | When TRUE means | Likely ladder priority |
|---|---|---|---|
| Stripe Connect status | `currentBrand.stripeStatus === 'active'` | Brand can collect money. The most critical gating signal — without this nothing sells. | **1 (highest)** if not active. |
| Brand kind | `currentBrand.kind` ('physical' \| 'popup' \| 'trip_planner') | Determines which offering-creation CTA copy + route to surface. | Modifier across all ladder rungs. |
| Venue address (physical only) | `currentBrand.address !== null` when `kind === 'physical'` | Physical brands have set their location → consumer feed can recommend them. | 4 (after Stripe, after first offering exists). |
| Any offering drafted | `liveEvents.length + drafts.length + trips.length > 0` (with new tri-kind hook) | Brand has at least started one piece of inventory. | 2 (next after Stripe). |
| Any offering LIVE | `counts.live > 0` (tri-kind) | Brand is actively selling something. | 3 (next after at-least-drafted). |
| Lifetime revenue | `currentBrand.stats.rev > 0` | Brand has ever sold anything. | Side signal, not a primary ladder rung — used to suppress "create your first event" prompt phrasing. |
| 7-day revenue | `currentBrand.stats.rev7d > 0` | Currently selling. | Already on the KPI tile. Used as a "you're doing it" celebration vs. "kick off" prompt indicator. |
| Capacity set per offering | `ticket_types.quantity_total IS NOT NULL` per live offering | Sell-through tracking is enabled. | 5 (per-offering nuance — may be too granular for v1; defer or surface only when one specific live offering has unset capacity). |

**Proposed rule ladder (first-match wins, top-to-bottom):**

1. Stripe not active → "Finish setting up Stripe to start selling" → `/brand/{id}/payments`.
2. Stripe active AND zero offerings (no drafts, no live across all 3 kinds) → kind-aware first-offering CTA:
   - `physical` / `popup` → "Create your first event" → `/event/create`.
   - `trip_planner` → "Plan your first trip" → `/trip/create` (this is the existing ORCH-0855 case).
3. At least one draft, zero live → "Finish your draft and go live" → routes to the most-recently-edited draft.
4. At least one live, but `kind === 'physical' && address === null` → "Add your venue address so Mingla can recommend you locally" → `/brand/{id}/edit`.
5. (Optional v1.5 rung) At least one live offering with `quantity_total IS NULL` → "Set capacity for {offeringName}" → that offering's edit route.

If none of rungs 1–5 fire, the brand is in a "healthy" state and the KPI section renders normally (live hero or 7-day tile).

**Note on F-7 / ORCH-0855:** rung 1 + rung 2-trip_planner FULLY ABSORB the existing trip-planner CTA. The SPEC should delete the standalone block at lines 419–477 once the new ladder ships, to avoid double-rendering.

---

## 6. Tri-kind upcoming query design sketch (NOT the full SPEC)

### Composition

New hook: `useUpcomingForBrand(brandId: string | null): UseQueryResult<UpcomingItem[]>`.

Internally composes three existing queries (no new edge function needed):

```
useBusinessEventsForBrand(brandId) → events + experiences (already trip-filtered, that's fine)
useTripsByBrand(brandId)           → trips (already trip-only via .eq('event_type', 'trip'))
useDraftsForBrand(brandId)         → local drafts (Zustand)
```

Normalise into a common `UpcomingItem` shape:

```typescript
type UpcomingItem = {
  key: string;                              // `${kind}-${id}`
  kind: 'event' | 'experience' | 'trip' | 'draft';
  status: 'live' | 'upcoming' | 'draft';    // past excluded
  startAtUtc: Date | null;                  // null for drafts without a date
  endAtUtc: Date | null;                    // for live-vs-upcoming determination
  source: LiveEvent | DraftEvent | Trip;    // for the row-renderer
};
```

### Sort

Open question — see §7 Q-O-1. Conservative default:

```
items.sort((a, b) => {
  // Live first (pinned), then ascending startAtUtc, then drafts last.
  if (a.status === 'live' && b.status !== 'live') return -1;
  if (b.status === 'live' && a.status !== 'live') return 1;
  if (a.startAtUtc && b.startAtUtc) return a.startAtUtc.getTime() - b.startAtUtc.getTime();
  if (a.startAtUtc && !b.startAtUtc) return -1;
  if (!a.startAtUtc && b.startAtUtc) return 1;
  return (a.source.updatedAt ?? '').localeCompare(b.source.updatedAt ?? '');
});
```

A pure strict-soonest-first variant (which is what the operator literally asked for) would simply sort by `startAtUtc` ascending across ALL kinds and lifecycles. This is cleaner but requires the SPEC to confirm live events are OK being mixed with upcoming items based on their `startAtUtc` (which is in the past for live items).

### Past exclusion

For events + experiences: filter `endAtUtc !== null && endAtUtc < now()`. For trips: same (trip `event_dates.end_at`, master row). For drafts: never excluded (they're work-in-progress, not on a calendar).

### Counts

`Active events` KPI tile rebinds to a tri-kind count from the new hook. Sub-label becomes kind-agnostic ("N live · M upcoming · K drafts") per F-6's "simpler" option, unless SPEC chooses to expose breakdowns.

### Renderer

The existing row JSX at home.tsx:592–707 already handles `draft` + `live`/`upcoming` row variants and already routes via `routeForEventRowDefensive` which is kind-aware. The only delta is the renderer must accept the new normalised `UpcomingItem` instead of `BrandEventSummaryItem`. Pure refactor — no new primitives needed.

---

## 7. Regression surface map (every behaviour the SPEC must preserve)

| # | Behaviour | Where today | Preservation strategy |
|---|---|---|---|
| R-1 | Live-event "Live now" pill with pulse animation | `<Pill variant="live" livePulse>` at home.tsx:483, 684 | Carry into new renderer unchanged. |
| R-2 | 7-day GMV tile when no live event | home.tsx:533–545, ORCH-0816 windowed `rev7d` | Keep the "no live → 7-day tile" branch; only replace it with the rule-ladder card when the ladder fires (otherwise show 7-day as today). |
| R-3 | Live hero progress bar (sold / capacity) | home.tsx:499–512, `liveHeroMetrics` | Carry unchanged when live event exists. For live TRIPS, sold/capacity sources differ (`ticketsSoldCount` + `ticket_types.quantity_total` per ORCH-0950) — SPEC must spell out the per-kind binding. |
| R-4 | Desktop two-pane layout (`isWideDesktop` branch) | home.tsx:478, 558, 569–577 | Untouched — pane structure is kind-agnostic. |
| R-5 | `routeForEventRowDefensive` per-kind routing | home.tsx:251–277 | Already trip-aware (defensive). Keep using it. |
| R-6 | Empty-state pathway (`hasNoBrands`, `hasBrandsButNoSelection`, brand-resolving loader) | home.tsx:285–295, 375–415 | Pre-brand states untouched. Rule ladder ONLY fires inside the `currentBrand !== null` branch. |
| R-7 | Pull-to-refresh + Realtime invalidation | home.tsx:160–174, ORCH-0816 | Invalidations must include the new `trips` query key and the new `useUpcomingForBrand` key. |
| R-8 | Toast system + BrandSwitcherSheet + UniversalCreatorSheet + BrandDeleteSheet | home.tsx:716–745 | Untouched. |
| R-9 | ORCH-0855 trip-planner CTA presence (`trip_planner` kind always sees a CTA) | home.tsx:419–477 | **Behaviour-equivalent** preservation via rung 1 (Stripe-gated) + rung 2-trip_planner of the new ladder. Source block deleted in the same PR. Visual + copy parity tested at QA. |
| R-10 | "See all" navigation to `/(tabs)/hub/events` | home.tsx:561–567 | SPEC decision — keep "events" route, or split into "See all upcoming" pointing at a new tri-kind hub view? Conservative answer for v1: keep as today; tri-kind hub is a separate ORCH. |
| R-11 | `useEventSalesSummaries` per-event sales binding (15s staleTime, ORCH-0816) | home.tsx:308–311 | Add equivalent `useTripSalesSummaries` if not already present; otherwise SPEC must specify revenue-binding for trip rows. |
| R-12 | Strict-grep gate `orch-strict-grep-allow events-type-filter` markers in `businessEvents.ts` | service file lines 469, 493, 529, 540 | Untouched — the events service still filters trips; the new compose hook adds trips via a separate path. |
| R-13 | ORCH-0865 REWORK 5 `event_type` attachment on LiveEvent | businessEvents.ts:356–358 | Untouched — service keeps attaching `event_type` for defensive routing. |
| R-14 | "Active events" tile freshness post-checkout (ORCH-0816 Realtime + 15s staleTime) | home.tsx + useBrands + Realtime channel | New `useUpcomingForBrand` must subscribe to the same channel or invalidate on the same events. |
| R-15 | Constitutional rule #9 (no fabricated data) | global | Empty-state rule ladder must never show fake counts / fake CTAs; copy reads from real signals only. |

---

## 8. Five-layer cross-check

| Layer | F-1 (trip exclusion) | F-2 (sort) | F-3 (KPI count) |
|---|---|---|---|
| **Docs** | The home.tsx top comment claims "7-day aggregate hero + KPI grid + Upcoming list" — no mention of trips. Operator INTAKE spec explicitly demands tri-kind. | No spec exists for the sort order today — operator request creates it. | Top comment + sub-label make no claim about kind-aware counting. |
| **Schema** | `events.event_type` enum is `event \| experience \| trip` (PostgreSQL check or text). All three kinds share the same table. `event_dates` is canonical for start times. Confirmed via `tripsService.ts:611–636` + `businessEvents.ts:471–474`. | n/a — sort is client-side. | Counts are client-side derived from the trip-stripped source. |
| **Code** | `fetchBusinessEventsForBrand:478–509` explicit filter. `getTripsByBrand:611` separate query. **Two paths agree the filter is intentional.** | `brandEventSummary.ts:31–74` sort proves status-rank-first ordering. | `eventSummary.counts` derived from `buildBrandEventSummary(liveEvents, drafts)` — trip-blind input. |
| **Runtime** | Deferred to TEST live-fire — code path is mechanical and the test brand setup will confirm in <5 minutes. | Same. | Same. |
| **Data** | DB rows with `event_type='trip'` exist on multiple production brands per ORCH-0913 + ORCH-0950 closes. Confirmed via prior investigations. | n/a. | Same. |

All three root causes pass the five-layer check at confidence HIGH.

---

## 9. Constitutional compliance check

| # | Rule | Status |
|---|---|---|
| 1 | No dead taps | N/A — no new interactive elements proposed yet (SPEC will). |
| 2 | One owner per truth | PASS — the new hook composes existing single-owner sources; no new ownership. |
| 3 | No silent failures | SPEC must ensure tri-kind hook surfaces errors from any of the 3 underlying queries — don't swallow trip-query errors. |
| 4 | One query key per entity | PASS — events / trips / drafts each retain their own factory keys; the compose hook depends on theirs (`useQueries`) or uses its own composite key + invalidation list. |
| 5 | Server state server-side | PASS — Zustand is touched only for `legacyLiveEvents` + `drafts`, both already-established local-state paradigms. Trips are server-only. |
| 6 | Logout clears everything | PASS — no new persisted client state proposed. |
| 7 | Label temporary | N/A — fix is permanent. |
| 8 | Subtract before adding | PASS — F-7 explicitly subtracts the standalone trip-planner CTA when the rule ladder ships. |
| 9 | No fabricated data | **Critical.** SPEC's rule ladder must NEVER show a CTA based on fake signals. Every ladder rung must read from a real column. |
| 10 | Currency-aware | PASS — existing currency handling (`formatCurrencyRound` + `currentBrand.defaultCurrency`) is reused. |
| 11 | One auth instance | N/A. |
| 12 | Validate at the right time | PASS — start-time math reuses `computeMasterStartAtUtc` which already handles timezone correctly per ORCH-0828. |
| 13 | Exclusion consistency | **Important.** The consumer-feed exclusion of trips (`discover-merged-events`) is a different surface — SPEC must NOT touch it. The home tri-kind addition is operator-facing only. |
| 14 | Persisted-state startup | PASS — `_hasHydrated` gate already exists for current brand resolution; unchanged. |

---

## 10. Open questions for SPEC

| # | Question | Recommendation |
|---|---|---|
| **Q-O-1** | Sort handling of **live items**: pin live to top, or sort strictly by `startAtUtc` ascending (which would mix live items in with upcoming by their start instant)? | **Recommendation: pin live to top**, then sort upcoming + drafts by `startAtUtc` ascending. Rationale: live items are operationally the most important — the brand owner needs them at the top regardless of when they started. Operator can override if they want pure-chronological. |
| **Q-O-2** | **Past inclusion**: confirm past items (`endAtUtc < now`) are excluded entirely from the home Upcoming list? | **Recommendation: exclude past entirely** — matches operator's "true upcoming" phrasing. |
| **Q-O-3** | **Drafts in Upcoming list**: keep them (current behaviour) or move to a dedicated "Drafts" section? Operator phrase was "upcoming events, trips, or experiences" — drafts not named. | **Recommendation: keep drafts in the same list at the bottom**, sorted by `updatedAt` desc among themselves. They're the most actionable item for an unfinished brand. Operator can split into a separate section if preferred. |
| **Q-O-4** | **ORCH-0855 trip-planner CTA placement**: fold into rung 2 of the rule ladder, or keep as a separate always-on card above the ladder? | **Recommendation: fold into the ladder** (rung 1 = Stripe gating, rung 2 kind-aware first-offering). Cleaner UX, no double-rendering. Delete the standalone block in the same PR. |
| **Q-O-5** | **N simultaneous live events**: hero shows one today. Carousel / "+N more live" / accept current behaviour? | **Recommendation: accept current for v1** — single primary hero. Other live items still render in the Upcoming list with the "Live" pill. Operator can request carousel in a follow-up ORCH if it becomes a pain point. |
| **Q-O-6** | **`rev7d` trip inclusion**: does `currentBrand.stats.rev7d` include trip sales today? Backend question — operator's "7-day" tile may already be tri-kind (good), or may exclude trips (would need a follow-up). | **Investigation handoff to SPEC author**: read `brandStatsService` / RPC to confirm. If trip-blind, raise as Discovery for Orchestrator → likely separate ORCH (out-of-scope for ORCH-0965). |
| **Q-O-7** | **Capacity ladder rung (rung 5)**: include in v1 or defer? It's the most "per-offering" rung — may feel out of place on home. | **Recommendation: defer rung 5** to v1.5. Ship rungs 1–4 in this ORCH. |

---

## 11. Discoveries for Orchestrator (side issues — NOT in this ORCH's scope)

- **D-1** — Q-O-6 above: if `currentBrand.stats.rev7d` excludes trip GMV, that's a separate backend bug deserving its own ORCH. Investigate at SPEC time; if confirmed broken, register as ORCH-NNNN.
- **D-2** — "See all" link at home.tsx:561–567 points to `/(tabs)/hub/events`. Once Upcoming is tri-kind, the link target should arguably point at a tri-kind hub. No such hub exists today. Defer to a follow-up ORCH.
- **D-3** — `homeKpiPresentation.ts` (the `getActiveEventsKpiSub` helper, imported at home.tsx:75) was not opened this turn. SPEC should read it to confirm sub-label formatting is fully kind-agnostic before claiming F-6 is non-blocking.
- **D-4** — The `useBusinessEventsForBrand` hook is used by multiple surfaces (events hub, home, possibly experience hub). Confirming this ORCH's compose-at-home-only approach doesn't accidentally affect those other surfaces is a quick SPEC verification.

---

## 12. Fix strategy (direction only — not a spec, not code)

1. **Introduce `useUpcomingForBrand(brandId)`** in `mingla-business/src/hooks/` that composes the three existing queries via `useQueries` (or sequential `useQuery` + `useMemo`), normalises to `UpcomingItem`, sorts (pinned-live then start-asc), excludes past, and exposes counts.
2. **Replace `eventSummary` in home.tsx** with the new hook's result. Update the renderer to accept `UpcomingItem` instead of `BrandEventSummaryItem`. Sales-summary bindings adapt per kind.
3. **Build the rule ladder** as a single component (e.g. `<HomeNextActionCard brand={currentBrand} state={...}/>`) rendered when the new hook returns zero active items (and no live event for the hero).
4. **Subsume ORCH-0855 trip-planner CTA** into rung 2 of the ladder. Delete the standalone JSX block.
5. **Tri-kind "Active events" KPI** — rebind sub-label from the new hook's counts.
6. **CI safety nets**: add a strict-grep rule that home.tsx may not directly call `fetchBusinessEventsForBrand` (force routing through the new compose hook). Add a unit test asserting strict-soonest-first sort (with the live-pinned tweak).
7. **Regression tests**: implementor happy-path covering "trip appears in Upcoming" and "rule ladder fires when Stripe inactive"; tester adversarial covering "two live events still both reachable" + "draft with no date sorts last" + "ORCH-0816 rev7d still binds when no live event".

No new edge functions. No new migrations. No new external API calls. Pure client composition over existing services.

---

## 13. Confidence: HIGH

All three root causes (F-1 trip exclusion, F-2 sort, F-3 KPI count) are proven by direct source reading. The remaining findings (F-4 hero collapse, F-5 empty-state kind-blindness) are observable from source and matched against operator scope. Live-fire deferred to TEST phase per dispatch authorisation ("source + 4 precedent ORCHs proved every finding mechanically"). Open questions are scoped to SPEC decisions, not blocking the investigation.

**Next phase:** SPEC (same skill — Claude `mingla-forensics`) once operator answers Q-O-1 through Q-O-7 (or defers to recommendations).
