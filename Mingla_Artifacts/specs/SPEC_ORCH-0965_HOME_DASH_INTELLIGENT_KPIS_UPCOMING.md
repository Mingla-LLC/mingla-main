# SPEC — ORCH-0965 [Home dashboard intelligent KPIs + tri-kind upcoming]

**Author:** Claude `mingla-forensics` (SPEC mode).
**Date:** 2026-05-25.
**Working tree:** `~/Desktop/mingla-orchs/0965-[home-dash-intelligent-kpis-upcoming]/` on branch `0965-home-dash-intelligent-kpis-upcoming`.
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0965_HOME_DASH_INTELLIGENT_KPIS_UPCOMING.md` (in this worktree).
**Severity:** S2-medium · **Classification:** `missing-feature` + `ux` + `quality-gap`.
**Confidence in spec:** HIGH (pure client composition; no new edge functions, no migrations, no external API calls).

---

## 1. Layman summary

This spec lays out exactly what code must change to make the brand-owner home dashboard see and order trips + events + experiences uniformly, render a single best-next-action card when the brand has nothing yet, and put a Scan QR action on the live hero whenever the live offering is an event. Every change is additive and reuses existing services. No new endpoints, no schema work, no external API calls.

---

## 2. Operator-locked decisions

The operator confirmed the following at INTAKE + after investigation review (2026-05-25):

| # | Decision | Locked answer |
|---|---|---|
| D-1 | Sort order | **Live items pinned to top**, then `startAtUtc` ascending across all remaining kinds + lifecycles. |
| D-2 | Past inclusion | **Exclude entirely** (any item whose `endAtUtc < now`). |
| D-3 | Drafts placement | **Same list, sorted to the bottom** by `updatedAt` descending among themselves. |
| D-4 | ORCH-0855 trip-planner CTA | **Fold into the new rule ladder** (rung 1 = Stripe gating, rung 2 = kind-aware first-offering). Delete the standalone block at home.tsx:419–477 in the same PR. |
| D-5 | Multiple simultaneous live events | **Single primary hero in v1.** Other live items render in the Upcoming list with the "Live" pill. Carousel deferred to a follow-up ORCH. |
| D-6 | `rev7d` trip inclusion | **Verified pre-SPEC:** `brandsService.ts:381–393` joins `orders → events!inner` with NO `event_type` filter, summing across all 3 kinds. No follow-up ORCH needed. Discovery D-1 from investigation closed. |
| D-7 | Capacity rung (rung 5) | **Deferred to v1.5.** Ship rungs 1–4 in this ORCH. |
| D-8 | Scan QR action on live hero | **Required.** When `primaryLiveItem.event_type === 'event'` (NOT experience, NOT trip), render a "Scan QR codes" button inside the live hero card that routes to `/event/{id}/scanner`. Hidden for non-event kinds (experience routes to a coming-soon stub; trips have no scanner). |

---

## 3. Scope

### In scope

- New hook `useUpcomingForBrand(brandId)` composing events + experiences + trips + drafts into a single normalised, sorted, past-excluded list.
- Refactor `mingla-business/app/(tabs)/home.tsx` to consume the new hook instead of `useBusinessEventsForBrand` + `useDraftsForBrand` + `useLiveEventsForBrand` directly.
- New component `<HomeNextActionCard brand={currentBrand} signals={...}/>` rendering the 4-rung rule ladder when no live event AND no upcoming items exist.
- Delete the standalone trip-planner CTA block at `home.tsx:419–477` (absorbed into ladder rung 2).
- Modify the live hero render block to include a kind-conditional "Scan QR codes" action when `primaryLiveItem.event_type === 'event'`.
- Update the "Active events" KPI tile to bind to the new hook's tri-kind counts.
- New unit-test files for `buildUpcomingItems` (sort + past-exclusion + draft-tail) and `pickHomeNextAction` (ladder priority).
- New strict-grep CI rule: `home.tsx` must not directly import `fetchBusinessEventsForBrand` (force routing through the new hook).
- React Query cache invalidation: `useQueryClient.invalidateQueries({ queryKey: upcomingKeys.all })` on pull-to-refresh, on Realtime order-channel events, and on offering create/edit/delete mutations.

### Non-goals (explicitly out of scope)

- No backend changes (no migrations, no edge functions, no RPC changes, no RLS changes).
- No changes to `fetchBusinessEventsForBrand` (events tab + consumer feed depend on the trip filter staying intact — per Constitutional rule #13 exclusion consistency).
- No changes to `discover-merged-events` edge function (consumer feed).
- No changes to the events tab, trips tab, experiences tab, or `/hub/*` surfaces.
- No new external APIs (no Stripe Connect read beyond `currentBrand.stripeStatus` already on the Brand record).
- No carousel for multiple live events (D-5 deferred).
- No capacity-aware rung 5 (D-7 deferred).
- No new "See all" tri-kind hub route (Discovery D-2 deferred).
- No `homeKpiPresentation.getActiveEventsKpiSub` rewrite beyond making it kind-agnostic (sub-label stays "N live · M upcoming · K drafts" — Discovery D-3 noted as cosmetic).
- No iOS / Android / Web platform-specific code paths — `home.tsx` is shared RN code and renders identically across all three primary surfaces under Expo Router.

### Assumptions

- `useTripsByBrand` exists and returns brand-scoped trips with `event_dates` master-row start times mapped into `Trip.businessTrip.startAt`. (Confirmed in `tripsService.ts:611–661`.)
- `mergeServerAndLegacyLiveEvents` continues to handle the events+experiences server/Zustand merge. Trips have no legacy Zustand store; that's acceptable per investigation F-8.
- The scanner route `/event/{id}/scanner` already exists and handles permissions + camera + decode. (Confirmed via `mingla-business/app/event/[id]/scanner/index.tsx`.)
- `currentBrand.stripeStatus`, `currentBrand.kind`, and `currentBrand.address` are populated on the standard `useBrands` fetch (confirmed via `Brand` type in `mingla-business/src/types/brand.ts:170–245`).

---

## 3.5 Cross-Surface Impact (MANDATORY)

| # | Surface | In scope? | Behaviour |
|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/` iOS) | **NO** | No consumer-app home screen change. The consumer feed (`discover-merged-events`) keeps filtering trips per its own contract. |
| 2 | Consumer Android (`app-mobile/` Android) | **NO** | Same as #1. |
| 3 | Buyer / anonymous Web | **NO** | Anonymous routes don't render KPIs. |
| 4 | **Business iOS** (`mingla-business/` iOS) | **YES — primary** | Home dashboard renders tri-kind Upcoming + next-action rule ladder + scan-QR on event-kind live hero. |
| 5 | **Business Android** (`mingla-business/` Android) | **YES — primary** | Parity automatic (shared RN code in `home.tsx`). |
| 6 | Admin Web (`mingla-admin/`) | **NO** | No brand-dashboard home in admin. |
| 7 | **Business Web preview** (`mingla-business/` dev/web) | **YES — adjacent** | Parity automatic (RN-Web build). Desktop two-pane layout preserved (`isWideDesktop` branch). |

**Parity:** automatic across iOS / Android / Web preview because `home.tsx` is shared RN code under Expo Router. No platform-specific branches introduced. Single set of success criteria applies to all three surfaces.

---

## 4. Layer-by-layer specification

### 4.1 Database layer

**No changes.** The fix is pure client composition over existing services.

### 4.2 Edge function layer

**No changes.**

### 4.3 Service layer

**No changes to existing services.** `fetchBusinessEventsForBrand` keeps filtering trips. `getTripsByBrand` keeps its current behaviour. `experiencesService` untouched. `brandsService.rev7d` query verified tri-kind-inclusive (D-6).

### 4.4 Hook layer

#### NEW: `useUpcomingForBrand`

**File:** `mingla-business/src/hooks/useUpcomingForBrand.ts` (new file).

**Signature:**

```typescript
export type UpcomingKind = 'event' | 'experience' | 'trip' | 'draft';
export type UpcomingStatus = 'live' | 'upcoming' | 'draft';

export interface UpcomingItem {
  key: string;                              // `${kind}-${id}`
  id: string;
  kind: UpcomingKind;
  status: UpcomingStatus;
  startAtUtc: Date | null;                  // null for drafts without a date
  endAtUtc: Date | null;
  source: LiveEvent | DraftEvent | Trip;    // typed by kind
}

export interface UpcomingCounts {
  total: number;          // sum of all items (matches today's `counts.all`)
  active: number;         // live + upcoming + draft (matches today's `counts.active`)
  live: number;
  upcoming: number;
  draft: number;
}

export interface UpcomingForBrand {
  items: UpcomingItem[];
  counts: UpcomingCounts;
  primaryLiveItem: UpcomingItem | null;
  isLoading: boolean;
  isError: boolean;
  // Pass-through for React Query observability
  errors: { events?: unknown; trips?: unknown };
}

export const upcomingKeys = {
  all: ['upcoming'] as const,
  forBrand: (brandId: string | null) => ['upcoming', brandId] as const,
};

export const useUpcomingForBrand = (brandId: string | null): UpcomingForBrand;
```

**Implementation contract:**

1. Calls `useBusinessEventsForBrand(brandId)` — returns events + experiences (already trip-filtered).
2. Calls a new thin wrapper `useTripsByBrand(brandId)` if it doesn't already exist, which calls `getTripsByBrand` from `tripsService.ts`. (If `useTripsByBrand` already exists for the trips hub, reuse it directly — confirm at implementation time.)
3. Reads `useDraftsForBrand(brandId)` from Zustand store (no React Query needed; Zustand subscription handles re-renders).
4. Composes the three sources via `useMemo` into a normalised `UpcomingItem[]` (see §4.4.1 normalisation rules below).
5. Sorts via the `compareUpcomingItems` pure function (see §4.4.2 sort rules).
6. Excludes past items per §4.4.3.
7. Computes `counts` per §4.4.4.
8. Returns `primaryLiveItem = items.find(i => i.status === 'live') ?? null`.
9. `isLoading = eventsQuery.isLoading || tripsQuery.isLoading`. `isError = eventsQuery.isError || tripsQuery.isError`. Drafts are local-only — no loading state.

#### §4.4.1 — Normalisation rules

```typescript
function normaliseEvent(event: LiveEvent): UpcomingItem;
function normaliseTrip(trip: Trip): UpcomingItem;
function normaliseDraft(draft: DraftEvent): UpcomingItem;
```

Per-kind start/end derivation:

- **Event / Experience** (from `LiveEvent`): `startAtUtc = computeMasterStartAtUtc(event)`. `endAtUtc = computeMasterEndAtUtc(event)` (add this helper if missing — mirrors `computeMasterStartAtUtc`). `status = deriveLiveStatus(event, startAtUtc)` mapped: `'cancelled' → exclude` (don't normalise), `'live' → 'live'`, `'upcoming' → 'upcoming'`, `'past' → exclude` (filtered in §4.4.3).
- **Trip** (from `Trip`): `startAtUtc = trip.businessTrip.startAt` parsed to Date (already UTC ISO from `event_dates.start_at`). `endAtUtc = trip.businessTrip.endAt` parsed similarly. `status` derived from trip lifecycle:
  - `trip.status === 'live'` → `'live'`
  - `trip.status === 'scheduled'` (i.e., published + upcoming) → `'upcoming'`
  - `trip.status === 'draft'` → SHOULD route through `useDraftsForBrand` instead; if a trip with status 'draft' reaches here, treat it as `'draft'` kind for ladder purposes. Implementor: confirm draft trips appear in Zustand drafts (yes per `liveEventStore` discipline) and skip them here to avoid double-counting.
  - `trip.status === 'ended'` or `'cancelled'` → exclude.
- **Draft** (from `DraftEvent`): `startAtUtc = parseDraftStartAtUtc(draft)` — drafts may or may not have a scheduled date. Return `null` when draft has no date set. `endAtUtc = null`. `status = 'draft'`.

#### §4.4.2 — Sort rules (pure function `compareUpcomingItems`)

```typescript
function compareUpcomingItems(a: UpcomingItem, b: UpcomingItem): number {
  // 1. Live always wins (pinned to top per D-1).
  if (a.status === 'live' && b.status !== 'live') return -1;
  if (b.status === 'live' && a.status !== 'live') return 1;

  // 2. Among multiple live items: ascending startAtUtc (older first — they started earlier).
  if (a.status === 'live' && b.status === 'live') {
    if (a.startAtUtc && b.startAtUtc) {
      return a.startAtUtc.getTime() - b.startAtUtc.getTime();
    }
    return 0;
  }

  // 3. Drafts always last (sorted by updatedAt desc among themselves).
  if (a.status === 'draft' && b.status !== 'draft') return 1;
  if (b.status === 'draft' && a.status !== 'draft') return -1;
  if (a.status === 'draft' && b.status === 'draft') {
    const aUpdated = (a.source as DraftEvent).updatedAt ?? '';
    const bUpdated = (b.source as DraftEvent).updatedAt ?? '';
    return bUpdated.localeCompare(aUpdated); // most recently edited first
  }

  // 4. Among upcoming items: ascending startAtUtc (soonest first).
  if (a.startAtUtc && b.startAtUtc) {
    return a.startAtUtc.getTime() - b.startAtUtc.getTime();
  }
  // Upcoming items without startAtUtc should not exist by definition;
  // if they do, sort to bottom of upcoming.
  if (a.startAtUtc && !b.startAtUtc) return -1;
  if (!a.startAtUtc && b.startAtUtc) return 1;
  return 0;
}
```

#### §4.4.3 — Past exclusion

Apply BEFORE sort:

```typescript
function isPastForUpcoming(item: UpcomingItem): boolean {
  if (item.status === 'draft') return false;       // drafts never past
  if (item.endAtUtc !== null) return item.endAtUtc.getTime() < Date.now();
  if (item.startAtUtc !== null) {
    // If only startAtUtc is known and no end, treat as past 24h after start
    // (mirrors existing deriveLiveStatus heuristic — verify in implementation).
    return item.startAtUtc.getTime() + 24 * 60 * 60 * 1000 < Date.now();
  }
  return false;                                    // unknown → keep
}
```

#### §4.4.4 — Counts

```typescript
const counts: UpcomingCounts = {
  total: items.length,
  active: items.length,                  // all items are non-past by definition after exclusion
  live: items.filter(i => i.status === 'live').length,
  upcoming: items.filter(i => i.status === 'upcoming').length,
  draft: items.filter(i => i.status === 'draft').length,
};
```

#### NEW: `pickHomeNextAction` (pure function — not a hook)

**File:** `mingla-business/src/utils/homeNextAction.ts` (new file).

**Signature:**

```typescript
export type HomeNextActionRung =
  | { rung: 1; kind: 'stripe_inactive'; ctaLabel: string; ctaRoute: string }
  | { rung: 2; kind: 'no_offerings'; ctaLabel: string; ctaRoute: string }
  | { rung: 3; kind: 'finish_draft'; ctaLabel: string; ctaRoute: string; draftId: string }
  | { rung: 4; kind: 'add_address'; ctaLabel: string; ctaRoute: string }
  | null;                                  // no rung applicable (healthy state)

export function pickHomeNextAction(
  brand: Brand,
  counts: UpcomingCounts,
  drafts: DraftEvent[],
): HomeNextActionRung;
```

**Rule ladder (first-match wins, top-to-bottom):**

```typescript
// Rung 1 — Stripe not active
if (brand.stripeStatus !== 'active') {
  return {
    rung: 1,
    kind: 'stripe_inactive',
    ctaLabel: 'Finish setting up Stripe',
    ctaRoute: `/brand/${brand.id}/payments`,
  };
}

// Rung 2 — Stripe active, zero offerings of any kind
if (counts.total === 0) {
  if (brand.kind === 'trip_planner') {
    return {
      rung: 2,
      kind: 'no_offerings',
      ctaLabel: 'Plan a trip',
      ctaRoute: '/trip/create',
    };
  }
  return {
    rung: 2,
    kind: 'no_offerings',
    ctaLabel: 'Create your first event',
    ctaRoute: '/event/create',
  };
}

// Rung 3 — At least one draft, zero live
if (counts.live === 0 && counts.draft > 0) {
  // Pick the most-recently-updated draft to route to.
  const mostRecentDraft = drafts
    .slice()
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
  // Use routeForEventRowDefensive for kind-aware routing.
  const route = routeForEventRowDefensive({
    id: mostRecentDraft.id,
    event_type: (mostRecentDraft as DraftEvent & { event_type?: EventTypeForRouting }).event_type ?? 'event',
    status: 'draft',
  });
  return {
    rung: 3,
    kind: 'finish_draft',
    ctaLabel: 'Finish your draft and go live',
    ctaRoute: route,
    draftId: mostRecentDraft.id,
  };
}

// Rung 4 — Live offering exists but physical brand has no address
if (brand.kind === 'physical' && (brand.address === null || brand.address.trim().length === 0)) {
  return {
    rung: 4,
    kind: 'add_address',
    ctaLabel: 'Add your venue address',
    ctaRoute: `/brand/${brand.id}/edit`,
  };
}

// Healthy state — no rung applicable
return null;
```

### 4.5 Component layer

#### NEW: `<HomeNextActionCard>`

**File:** `mingla-business/src/components/home/HomeNextActionCard.tsx` (new file under new `home/` subdir).

**Props:**

```typescript
interface HomeNextActionCardProps {
  action: HomeNextActionRung;            // non-null required by caller
  onPress: () => void;                   // caller wires router.push
  testID?: string;
}
```

**Render contract:**

- Wraps content in `<GlassCard variant="elevated" padding={spacing.lg}>` (matches the ORCH-0855 trip-planner CTA visual treatment).
- Title text: per-rung specific (e.g., "Finish setting up Stripe", "Create your first event").
- Body text: 1–2 sentence explanation per rung (see Copy Bank §6).
- CTA button: `<Pressable>` with chevron + label, styled identically to `tripPlannerCtaAction` at `home.tsx:1041–1052`. Use `accessibilityRole="button"`, `accessibilityLabel={action.ctaLabel}`, `testID={`home-next-action-rung-${action.rung}`}`.
- Renders ABOVE the KPI grid (replacing where the trip-planner CTA used to live).

**States:** single populated state (no loading / error — action is computed synchronously from already-loaded brand data).

#### MODIFIED: `mingla-business/app/(tabs)/home.tsx`

**Changes:**

1. **Imports:** add `useUpcomingForBrand` + `upcomingKeys` + `pickHomeNextAction` + `HomeNextActionCard`. Remove `useBusinessEventsForBrand`, `useDraftsForBrand` (still needed for ladder rung 3 draft selection — keep), `useLiveEventsForBrand`, `mergeServerAndLegacyLiveEvents`, `buildBrandEventSummary` types.
2. **Replace data hooks block (lines 138–149):**
   ```typescript
   const upcoming = useUpcomingForBrand(currentBrand?.id ?? null);
   const drafts = useDraftsForBrand(currentBrand?.id ?? null); // kept for rung 3
   ```
3. **Replace `eventSummary` derivation (lines 296–311):**
   ```typescript
   const primaryLiveItem = upcoming.primaryLiveItem;
   const summaryLiveEvents = useMemo(
     () => upcoming.items
       .filter(i => i.status === 'live' && (i.kind === 'event' || i.kind === 'experience'))
       .map(i => i.source as LiveEvent),
     [upcoming.items],
   );
   const eventSalesSummaries = useEventSalesSummaries(summaryLiveEvents, currentBrand?.defaultCurrency);

   const nextAction = useMemo(
     () => currentBrand !== null
       ? pickHomeNextAction(currentBrand, upcoming.counts, drafts)
       : null,
     [currentBrand, upcoming.counts, drafts],
   );
   ```
4. **Render order inside the `currentBrand !== null` branch:**
   - **DELETE the existing trip-planner CTA block at lines 419–477** (absorbed into ladder).
   - Render `<HomeNextActionCard>` IF `nextAction !== null` AND `upcoming.counts.live === 0` (don't show the ladder when there's already a live thing to highlight).
   - KPI grid (lines 478–556) — modified per §4.5.1.
   - Upcoming section (lines 558–710) — modified per §4.5.2.
5. **Pull-to-refresh handler (lines 164–174):** add `upcomingKeys.all` to the invalidation list:
   ```typescript
   await Promise.all([
     queryClient.invalidateQueries({ queryKey: brandKeys.all }),
     queryClient.invalidateQueries({ queryKey: eventOrdersKeys.all }),
     queryClient.invalidateQueries({ queryKey: upcomingKeys.all }),
   ]);
   ```

##### §4.5.1 — KPI grid changes

- Tile 1 unchanged structurally — still toggles between live-hero GlassCard and `KpiTile label="Last 7 days"` based on `primaryLiveEvent !== null`.
- Live-hero GlassCard gets ONE addition: directly below the 3-cell stat row (lines 513–530), conditionally render:
  ```tsx
  {primaryLiveItem.kind === 'event' && (
    <Pressable
      onPress={() => router.push(`/event/${primaryLiveItem.id}/scanner` as never)}
      accessibilityRole="button"
      accessibilityLabel={`Scan tickets for ${getEventName(primaryLiveEvent.name, 'Untitled event')}`}
      style={styles.heroScanAction}
      testID="home-live-hero-scan-button"
    >
      <Icon name="qr" size={16} color={accent.warm} />
      <Text style={styles.heroScanActionText}>Scan QR codes</Text>
    </Pressable>
  )}
  ```
  (If the icon set doesn't have a `qr` glyph yet, use `chevR` as a placeholder; designer can swap. Implementor: confirm `Icon` glyph availability and pick the closest existing one if needed — DO NOT add a new icon dependency.)
- Tile 2 ("Active events") binds to `upcoming.counts.active` and `getActiveEventsKpiSub(upcoming.counts, isWideDesktop)` — `homeKpiPresentation.ts` keeps its sub-label shape (kind-agnostic per D-7 rationale).

##### §4.5.2 — Upcoming list changes

- Source: `upcoming.items` instead of `eventSummary.activeItems`.
- Empty state copy stays the same (`"No upcoming events"` + `"Tap + in the top right to create your first event."`). Per investigation §10 + operator decision: when both `upcoming.items.length === 0` AND `nextAction !== null`, the ladder card above is the primary CTA; the Upcoming empty card still appears beneath as a secondary signal (no regression to current empty pathway).
- Row rendering: per-kind branch within the `.map()`:
  ```typescript
  upcoming.items.map((item) => {
    if (item.kind === 'draft') {
      const draft = item.source as DraftEvent;
      return <DraftRow key={item.key} draft={draft} onPress={handleOpenDraft} />;
    }
    if (item.kind === 'trip') {
      const trip = item.source as Trip;
      return <TripRow key={item.key} trip={trip} status={item.status} onPress={handleOpenTrip} />;
    }
    // 'event' or 'experience' — both render through the LiveEvent row JSX
    const event = item.source as LiveEvent;
    // ... existing JSX from home.tsx:641–706
  })
  ```
- **New `<TripRow>` component:** `mingla-business/src/components/home/HomeTripRow.tsx`. Mirrors the existing event row visual structure (`eventRow` style, `EventCoverMedia` with `mediaUrl` from `trip.coverMediaUrl` + hue fallback, status pill "Live"/"Upcoming", title from `trip.title`, date line from `trip.businessTrip.startAt`+`endAt` formatted, sold/revenue from `trip.ticketsSoldCount` + computed revenue). Mirror existing `eventRow` styles — do NOT introduce new visual primitives.
- **Tap handlers:** introduce `handleOpenTrip` next to existing `handleOpenLiveEvent` / `handleOpenDraft`:
  ```typescript
  const handleOpenTrip = useCallback(
    (trip: Trip): void => {
      router.push(
        routeForEventRowDefensive({
          id: trip.id,
          event_type: 'trip',
          status: trip.status,
        }) as never,
      );
    },
    [router],
  );
  ```

### 4.6 Realtime + cache invalidation

- The new hook's `upcomingKeys.forBrand(brandId)` key is invalidated on:
  - Pull-to-refresh (already wired — add to the `Promise.all`).
  - Any mutation that creates / edits / publishes / cancels an event, experience, or trip. **Implementor:** identify all mutation hooks that touch `events` and add `queryClient.invalidateQueries({ queryKey: upcomingKeys.all })` to their `onSuccess`. At minimum: `useUpdateEventBasics`, `usePublishEvent`, `useCancelEvent`, `useUpdateTripBasics`, `usePublishTrip`, `useCancelTrip` (verify names in implementation).
  - Order Realtime channel from `useBrandStripeBankVerification.ts`-style `postgres_changes` listener — if ORCH-0816 added a brand-level orders channel for `rev7d`, piggyback on it; if not, accept the existing 30-second-default staleTime + pull-to-refresh as sufficient (no new Realtime channel required for v1).
- `staleTime`: 30 seconds for the events + trips queries (matches `useBusinessEventsForBrand` precedent). `gcTime`: default (5 min). Drafts have no staleTime — they're Zustand-subscribed.

### 4.7 Strict-grep CI gate

**New file:** `.github/scripts/strict-grep/orch-0965-home-uses-upcoming-hook.mjs`.

**Rules:**

1. `mingla-business/app/(tabs)/home.tsx` MUST NOT contain a direct import of `fetchBusinessEventsForBrand` or `useBusinessEventsForBrand` or `buildBrandEventSummary`. (Forces all home consumption through `useUpcomingForBrand`.)
2. `mingla-business/app/(tabs)/home.tsx` MUST contain at least one occurrence of `useUpcomingForBrand`.
3. The trip-planner-CTA literal strings `"Plan a trip"` (rendered) and `"Finish setting up Stripe"` (rendered) MUST live inside `HomeNextActionCard.tsx` OR `homeNextAction.ts` (the rule-ladder factory). They MUST NOT appear in `home.tsx` directly. (Enforces the ORCH-0855 deletion.)

**Registry:** add the script to `.github/workflows/strict-grep-mingla-business.yml` per the registry-pattern memory rule `feedback_strict_grep_registry_pattern.md`.

### 4.8 Test surfaces

#### Unit tests (implementor writes — happy path)

**File:** `mingla-business/src/hooks/__tests__/useUpcomingForBrand.test.ts` (new).

- `T-IMPL-01` — given 1 live event + 1 upcoming trip + 1 draft, `items` order is `[live-event, upcoming-trip, draft]`.
- `T-IMPL-02` — given 1 live event ending in past, item is excluded (past).
- `T-IMPL-03` — given 1 live trip + 1 live event (event starts earlier), order is `[live-event, live-trip]` (older-start-first among live).

**File:** `mingla-business/src/utils/__tests__/homeNextAction.test.ts` (new).

- `T-IMPL-04` — stripeStatus !== 'active' → rung 1 regardless of other state.
- `T-IMPL-05` — stripe active + counts.total === 0 + kind === 'trip_planner' → rung 2 with "Plan a trip".
- `T-IMPL-06` — stripe active + counts.total === 0 + kind === 'popup' → rung 2 with "Create your first event".
- `T-IMPL-07` — stripe active + counts.live === 0 + counts.draft > 0 → rung 3 routing to most-recently-updated draft.
- `T-IMPL-08` — stripe active + counts.live > 0 + kind === 'physical' + address === null → rung 4.
- `T-IMPL-09` — stripe active + counts.live > 0 + address set → returns null (healthy).

#### Unit tests (tester writes — adversarial)

**File:** `mingla-business/src/hooks/__tests__/useUpcomingForBrand.adversarial.test.ts` (new).

- `T-QA-01` — given 2 live events both starting in the past with same start instant, order is stable (no flicker between renders).
- `T-QA-02` — given a trip with `status='cancelled'`, item is excluded (lifecycle exclusion).
- `T-QA-03` — given a draft with `updatedAt: null`, sort still works (no NaN comparisons, draft sinks to bottom of drafts).
- `T-QA-04` — counts.active matches items.length exactly (no off-by-one from past-filter edge cases).

**File:** `mingla-business/src/utils/__tests__/homeNextAction.adversarial.test.ts` (new).

- `T-QA-05` — rung 3 picks the correct draft when multiple drafts have identical `updatedAt` strings (stable choice, no crash).
- `T-QA-06` — rung 4 fires only for `kind === 'physical'` (popup brand with no address returns null at rung 4 — popup brands legitimately have no address).
- `T-QA-07` — empty string `address: ""` triggers rung 4 (treated same as null per `brand.address.trim().length === 0`).

#### Integration tests

**File:** `mingla-business/app/(tabs)/__tests__/home.tsx.test.tsx` (new or extend existing).

- `T-INT-01` — mock currentBrand with stripeStatus inactive + 0 offerings → ladder rung 1 renders + no KPI hero + no upcoming list.
- `T-INT-02` — mock currentBrand with 1 live event + 1 live trip → live hero renders the FIRST (by `compareUpcomingItems` order), upcoming list contains both. Scan QR button renders ONLY if primary is event-kind.
- `T-INT-03` — mock 0 live + 1 upcoming trip starting in 2 days + 1 draft → list is `[trip, draft]`.

---

## 5. Success criteria

Numbered, observable, testable, unambiguous.

- **SC-1** — On a brand with at least one live trip and zero live events, the home Upcoming list shows the live trip with a "Live" pill at the top. (Today: hidden entirely.)
- **SC-2** — On a brand with 1 live event + 1 upcoming trip + 1 draft, the Upcoming list renders exactly `[live-event, upcoming-trip, draft]` in that order.
- **SC-3** — On a brand with N live events + M live trips + K live experiences, the "Active events" KPI tile sub-label shows `${N+M+K} live · {upcoming count} upcoming · {draft count} drafts`. Today the count omits trips.
- **SC-4** — On a brand with `stripeStatus !== 'active'`, the home dashboard renders `<HomeNextActionCard>` with title "Finish setting up Stripe" and CTA routing to `/brand/{id}/payments`. The live hero is NOT rendered (no Stripe = no sales = no live possible).
- **SC-5** — On a brand with `stripeStatus === 'active'` AND `counts.total === 0` AND `kind === 'trip_planner'`, the card renders with title "Plan a trip" and CTA routing to `/trip/create`. (Matches the ORCH-0855 behaviour exactly — absorbed.)
- **SC-6** — On a brand with `stripeStatus === 'active'` AND `counts.total === 0` AND `kind ∈ {'physical', 'popup'}`, the card renders with title "Create your first event" and CTA routing to `/event/create`.
- **SC-7** — On a brand with at least one draft AND zero live offerings, the card renders rung 3 with CTA routing to the most-recently-updated draft (kind-correct via `routeForEventRowDefensive`).
- **SC-8** — On a brand with `kind === 'physical'` AND `address === null` AND at least one live offering, the card renders rung 4 with CTA routing to `/brand/{id}/edit`. The live hero ALSO renders (rung 4 doesn't suppress the hero).
- **SC-9** — On a brand in "healthy state" (stripe active, ≥1 live offering, kind ∈ {popup, trip_planner} OR physical with address set), `<HomeNextActionCard>` does NOT render.
- **SC-10** — When the live hero renders AND `primaryLiveItem.kind === 'event'`, a "Scan QR codes" button is visible inside the hero card. Tap navigates to `/event/{id}/scanner`.
- **SC-11** — When the live hero renders AND `primaryLiveItem.kind === 'experience'`, the "Scan QR codes" button is NOT visible.
- **SC-12** — When the live hero renders AND `primaryLiveItem.kind === 'trip'`, the "Scan QR codes" button is NOT visible.
- **SC-13** — Past items (any kind with `endAtUtc < now`) NEVER appear in the Upcoming list.
- **SC-14** — `currentBrand.stats.rev7d` continues to populate the "Last 7 days" KPI tile when no live event is rendered. Tri-kind GMV inclusion preserved (verified pre-SPEC at D-6). ORCH-0816 freshness guarantees (pull-to-refresh + Realtime invalidation if present) continue to fire.
- **SC-15** — Desktop two-pane layout (`isWideDesktop` branch at `desktopKpiGrid` + `desktopUpcomingPane`) renders identically to today on viewports ≥1024px width (RN-Web preview).
- **SC-16** — `mingla-business/app/(tabs)/home.tsx` does NOT directly import `fetchBusinessEventsForBrand` or `buildBrandEventSummary` after this ORCH ships. Strict-grep CI gate `orch-0965-home-uses-upcoming-hook.mjs` enforces.
- **SC-17** — The standalone trip-planner CTA block at the pre-ORCH-0965 `home.tsx:419–477` location is fully deleted in the same PR. No double-rendering with the rule ladder.

---

## 6. Copy bank (binding)

| Rung | Title | Body | CTA |
|---|---|---|---|
| 1 | "Finish setting up Stripe" | "Mingla needs Stripe Connect to collect money. Finish setup to start selling." | "Continue Stripe setup" |
| 2 (event/popup/physical) | "Create your first event" | "Your brand is ready. Create your first event to start selling tickets." | "Create event" |
| 2 (trip_planner) | "Plan a trip" | "You're set up. Create your first trip to start selling." | "Plan a trip" |
| 3 | "Finish your draft" | "You have a draft waiting. Finish it and publish to start selling." | "Open draft" |
| 4 | "Add your venue address" | "Add your address so people can find you and Mingla can recommend you locally." | "Edit brand" |

Live hero scan action: `"Scan QR codes"` (button label). `accessibilityLabel`: `"Scan tickets for {eventName}"`.

Designer may iterate on copy at implementation time but must preserve the rung-trigger semantics. No emoji, no exclamation marks.

---

## 7. Invariants

### Invariants preserved (must hold after this ORCH)

- **Constitution rule #9 — no fabricated data.** Every rule ladder rung reads from real columns (`stripeStatus`, `address`, `counts.*`). No defaults that could mislead.
- **Constitution rule #13 — exclusion consistency.** `fetchBusinessEventsForBrand` keeps filtering trips for the events tab + consumer feed. The new home composer ADDS trips back — different surface, different contract.
- **I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE (ORCH-0865).** All new tap-handlers (`handleOpenTrip`) and rule-ladder routes use `routeForEventRowDefensive`. No hardcoded `/event/${id}` or `/trip/${id}` constructions in home.tsx outside the strict-grep allowlist.
- **ORCH-0816 freshness.** `rev7d` tile + Realtime/pull-to-refresh invalidation chain unchanged. The new hook joins the invalidation list, doesn't replace it.
- **ORCH-0826 M0.** `UniversalCreatorSheet` "+" top-bar button remains the sole creation entry point in empty states. The rule ladder card's CTA is a SECONDARY entry point that routes directly to the specific creation flow; it does NOT replace the "+" button.

### Invariants newly established by this ORCH

- **I-PROPOSED-HOME-UPCOMING-TRI-KIND-SOONEST-FIRST** — the brand-owner home Upcoming list shows all 3 kinds (event + experience + trip) plus drafts, sorted live-pinned then `startAtUtc` ascending, past excluded, drafts at the bottom. Enforced by strict-grep gate `orch-0965-home-uses-upcoming-hook.mjs` + unit tests `useUpcomingForBrand.test.ts`. Flips DRAFT → ACTIVE on ORCH-0965 CLOSE.
- **I-PROPOSED-HOME-SCAN-ACTION-EVENT-KIND-ONLY** — the scan-QR action on the live hero renders only when `primaryLiveItem.kind === 'event'`. Enforced by integration test SC-10/11/12. Flips DRAFT → ACTIVE on ORCH-0965 CLOSE.
- **I-PROPOSED-HOME-RULE-LADDER-SINGLE-OWNER** — best-next-action logic lives exclusively in `homeNextAction.ts` (no parallel kind-specific CTAs in `home.tsx`). Strict-grep gate enforces. Flips DRAFT → ACTIVE on ORCH-0965 CLOSE.

---

## 8. Test plan (binding — matches §4.8)

| ID | Layer | Scenario | Input | Expected | Owner |
|---|---|---|---|---|---|
| T-IMPL-01 | Hook | mixed-kind sort | live event + upcoming trip + draft | order: [live-event, upcoming-trip, draft] | implementor |
| T-IMPL-02 | Hook | past exclusion | event ended yesterday | excluded from items | implementor |
| T-IMPL-03 | Hook | live tie-break | 2 live, earlier-start first | older-start at top | implementor |
| T-IMPL-04 | Ladder | rung 1 | stripeStatus !== active | rung 1 returned | implementor |
| T-IMPL-05 | Ladder | rung 2 trip | stripe active + 0 offerings + trip_planner | "Plan a trip" rung 2 | implementor |
| T-IMPL-06 | Ladder | rung 2 popup | stripe active + 0 offerings + popup | "Create your first event" rung 2 | implementor |
| T-IMPL-07 | Ladder | rung 3 | stripe active + 1 draft + 0 live | rung 3 routing to draft | implementor |
| T-IMPL-08 | Ladder | rung 4 | physical brand, no address, 1 live | rung 4 returned | implementor |
| T-IMPL-09 | Ladder | healthy | popup + stripe + 1 live | null | implementor |
| T-QA-01 | Hook | stable sort | 2 live, same start instant | order stable across renders | tester |
| T-QA-02 | Hook | cancelled trip | trip.status === 'cancelled' | excluded | tester |
| T-QA-03 | Hook | null updatedAt draft | draft.updatedAt === null | sorts to bottom of drafts, no NaN | tester |
| T-QA-04 | Hook | counts accuracy | various mixes | counts.active === items.length | tester |
| T-QA-05 | Ladder | identical updatedAt | 2 drafts, same updatedAt | stable choice, no crash | tester |
| T-QA-06 | Ladder | popup no-address | popup, no address | null at rung 4 (popup exempt) | tester |
| T-QA-07 | Ladder | empty-string address | physical, address="" | rung 4 fires | tester |
| T-INT-01 | Component | brand stripe-inactive | mocked brand | ladder rung 1 + no hero + no upcoming | implementor |
| T-INT-02 | Component | mixed live | 1 event + 1 trip | hero renders first by sort; scan button conditional | implementor |
| T-INT-03 | Component | upcoming order | trip in 2 days + draft | list = [trip, draft] | implementor |
| T-INT-04 | Component | scan button event | live hero kind=event | button visible + routes to scanner | tester |
| T-INT-05 | Component | scan button trip | live hero kind=trip (theoretical via mock) | button NOT visible | tester |
| T-INT-06 | Component | scan button experience | live hero kind=experience | button NOT visible | tester |
| T-LIVE-01 | iOS Sim | full happy path | trip-planner brand with 0 offerings | live build shows "Plan a trip" rung 2 | tester live-fire |
| T-LIVE-02 | iOS Sim | scan button tap | event-kind brand with 1 live event | tap → scanner screen opens | tester live-fire |
| T-LIVE-03 | Android Emu | parity | mirrors T-LIVE-01 | identical render + behaviour | tester live-fire |
| T-LIVE-04 | Web preview | desktop layout | wide viewport, mixed brand | two-pane layout + tri-kind list | tester live-fire |

---

## 9. Implementation order (binding)

1. **New util** — `mingla-business/src/utils/homeNextAction.ts` + unit tests `T-IMPL-04..09`.
2. **New hook** — `mingla-business/src/hooks/useUpcomingForBrand.ts` + unit tests `T-IMPL-01..03`. Includes `compareUpcomingItems` + `isPastForUpcoming` + normalisers.
3. **New components** — `mingla-business/src/components/home/HomeNextActionCard.tsx` + `HomeTripRow.tsx`.
4. **Modify** — `mingla-business/app/(tabs)/home.tsx`: replace data hooks block, replace eventSummary derivation, render the rule ladder card, add scan-QR conditional in live hero, swap upcoming list source + per-kind row branch, add `handleOpenTrip`, extend pull-to-refresh invalidation, **DELETE the trip-planner CTA block at lines 419–477**.
5. **Mutation invalidations** — locate all event/trip/experience mutation hooks and add `upcomingKeys.all` to `onSuccess` invalidations.
6. **Strict-grep gate** — `.github/scripts/strict-grep/orch-0965-home-uses-upcoming-hook.mjs` + workflow registration.
7. **Integration tests** — `T-INT-01..03` (implementor) and `T-INT-04..06` (tester adversarial set).
8. **Regression-test fails-on-revert verification** — implementor MUST capture a `fails-on-revert verified at <commit>` line in the implementation report (Step 0.5 gate per memory rule `feedback_close_commit_precommit_checks`).

Each step lands as its own logical commit on the per-ORCH branch. Step 8 happens in the implementation report, not a separate commit.

---

## 10. Regression prevention

| Class of bug | Structural safeguard | Test that catches it |
|---|---|---|
| Future home consumer bypasses the composer and re-imports `fetchBusinessEventsForBrand` | Strict-grep gate `orch-0965-home-uses-upcoming-hook.mjs` rule #1 | CI workflow fails |
| Future home adds another kind-specific CTA in JSX instead of extending the ladder | Strict-grep gate rule #3 (literal CTA strings live only in ladder file) | CI workflow fails |
| Sort drift (someone changes order semantics) | `T-IMPL-01..03` + `T-QA-01..04` unit tests | Test suite fails |
| Past items leak | `T-IMPL-02` past-exclusion test | Test suite fails |
| Scan button leaks onto trip/experience hero | `T-INT-05` + `T-INT-06` | Test suite fails |
| ORCH-0855 trip-planner CTA reintroduced as parallel surface | Strict-grep gate rule #3 + visual review at QA | CI + tester eyeball |
| `rev7d` regresses to lifetime GMV | ORCH-0816 test already covers this; no new surface added here | Existing test |
| Realtime invalidation drops the new key | Tester observes stale upcoming list after mutation in live-fire `T-LIVE-01` | live-fire confirms |

---

## 11. Operator approval gate

This SPEC is binding once the operator confirms. Areas where the operator may still want to override:

- **Q-SPEC-1** — Rule ladder rung 4 (physical-brand address): we fire it when `address === null OR trim().length === 0`. Fine to suppress for very-new physical brands who haven't gotten that far yet? Current answer: no suppression — physical brand with no address is a real onboarding gap.
- **Q-SPEC-2** — Scan QR action visual placement: spec puts it inside the hero card, below the 3-cell stat strip. Designer (ui-ux-pro-max) may want it elsewhere (top-right corner icon, ghost button below capacity bar, etc.). Implementor: invoke `/ui-ux-pro-max` during step 3 of the order (component build) per memory rule `feedback_implementor_uses_ui_ux_pro_max`.
- **Q-SPEC-3** — Icon glyph: spec assumes `Icon name="qr"` exists in the icon set. If it doesn't, implementor uses `chevR` as placeholder and flags for designer follow-up — does NOT add a new icon dependency.

If the operator rejects any of these, the SPEC author updates this section + the relevant §4 / §5 entries before dispatch.

---

## 12. Next phase

After operator approval of this SPEC, the orchestrator REVIEWs it and dispatches IMPLEMENT to Codex `implementor-mingla` (or Claude `mingla-implementor` per operator routing choice). Implementor produces:

- New / modified source files per §9 implementation order.
- Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0965_HOME_DASH_INTELLIGENT_KPIS_UPCOMING.md` (in this worktree).
- Step 0.5 evidence: `fails-on-revert verified at <commit>` for at least one of `T-IMPL-01..09`.
- Implementor invokes `/ui-ux-pro-max` for the new component visuals (mandatory per memory rule).

Then Claude `mingla-tester` (canonical TEST owner per META-ORCH-0755 reversal) runs the full QA against §8 test plan, including `T-LIVE-01..04` live-fire on iOS sim + Android emu + web preview. Then orchestrator CLOSE per the standard protocol.
