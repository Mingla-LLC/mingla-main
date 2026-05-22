# SPEC — ORCH-0913 [Trip dashboard tile-grid + recent-activity + revenue/spots-strip full parity with event dashboard]

**Author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0913_TRIP_DASHBOARD_PARITY.md`
**Orchestrator REVIEW verdict:** APPROVED with HF-1 decision LOCKED (Edit-trip stays as primary tile per investigator recommendation)
**Severity:** S1-high · **Classification:** `design-debt` + `ux` + `missing-feature`

---

## 1. Layman summary

Replace the trip dashboard's 3-tab strip (Overview / Travelers / Money) with the event dashboard's tile-grid + sections-beneath pattern. Trip operator opens the page → sees hero + 7 action tiles in a grid → Revenue + Spots strip directly under the grid → Pricing Tiers section → Recent Activity feed (last 5 booking + payment events newest-first) → Cancel-trip ghost CTA at the bottom. Tap Travelers tile → opens a dedicated traveller-list route. Tap Money tile → opens a dedicated installment-ledger route. Status pill picks up event's lifecycle awareness (Live / Upcoming / Past / Cancelled instead of just Draft / Published). Web text-shadow regression fixed in the same diff. No database changes, no edge functions, no new data hooks — purely presentation-layer.

---

## 2. Scope + Non-goals + Assumptions

### 2.1 Scope (IN)

1. **Subtract:** delete the 3-tab strip, the `tab` state variable, all per-tab body branches, and all tab-only styles (`tabs`, `tab`, `tabActive`, `tabText`, `tabTextActive`, `tabBadgeAtRisk`) from `mingla-business/app/trip/[id]/index.tsx`.
2. **Add 2 new dashboard tiles** (Travelers, Money) wired to new destination routes.
3. **Lift KPI cards** out of the deleted Overview tab body into a top-level Revenue+Spots strip directly beneath the action grid.
4. **Add PRICING TIERS section** rendering `trip.pricingTiers` via the existing `EventDetailTicketTypeRow` primitive (or a renamed `DashboardTicketTypeRow` if SPEC §3.1 extraction lands — see §3.1).
5. **Add RECENT ACTIVITY section** with 4 source streams (order-paid, order-cancelled, installment-collected, installment-failed) plus the trip-cancelled lifecycle row; cap at 5 rows newest-first; reuse `EventDetailActivityRow` primitive (or rename per §3.1).
6. **Keep Cancel trip CTA** at the bottom of the ScrollView (current behaviour) — only its sibling position shifts.
7. **Create 2 new routes:** `mingla-business/app/trip/[id]/travelers/index.tsx` (lifts existing Travelers tab body verbatim) + `mingla-business/app/trip/[id]/money/index.tsx` (lifts existing `MoneyTabBody` + `RefundPreviewSheet` + `InstallmentScheduleDisplay` verbatim).
8. **Normalise tile labels:** trip Blasts tile picks up sub `"Message ticket buyers"` matching event; trip Group chat tile picks up sub `"Read + reply + moderate"` matching event.
9. **CF-1 fix:** adopt event's `deriveLiveStatus`-style lifecycle pill for trip hero (Live / Upcoming / Past / Cancelled) — derive from `trip.businessTrip.startAt` + `trip.businessTrip.endAt` + `trip.status`. Pill primitive may be extracted (`EventDetailHeroStatusPill` → `DashboardHeroStatusPill`) or trip may use a parallel `TripDetailHeroStatusPill` — implementor's call.
10. **CF-2 fix:** add `Platform.OS === "web"` branch to trip hero `heroTitle` + `heroSubline` textShadow, mirroring `event/[id]/index.tsx:968–974` (ORCH-0743/CF-2 precedent).
11. **HF-1 LOCKED:** "Edit trip" remains a **primary** action tile in the trip grid (orange-highlighted via `ActionTile primary={true}`). DELIBERATE DIVERGENCE from event dashboard (where Edit lives in the manage menu). Rationale: trip operators edit drafts more frequently than event operators; ORCH-0874 shipped this with zero friction reports. **Document the divergence in the file's header JSDoc + add a strict-grep allowlist comment so future audits don't flag it.**
12. **Implementor regression test + tester adversarial test** committed in same PR (Step 0.5 gate).
13. **NEW invariant** `I-PROPOSED-DASHBOARD-PARITY-TRIP-EVENT` proposed via strict-grep gate at `.github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs` failing CI if any `Pressable` or `View` with `accessibilityRole="tab"` appears in `mingla-business/app/(event|trip)/[id]/index.tsx`.

### 2.2 Non-goals (explicitly OUT)

- **NOT redesigning Money tab content.** The MoneyTabBody is lifted verbatim into the new `trip/[id]/money/index.tsx` route. ORCH-0914 [Trip Money tab redesign — organiser visibility into traveller payment-plan progress] redesigns the content layer inside that route AFTER ORCH-0913 closes.
- **NOT adding Room-Share tile.** TR7 / ORCH-0917 [Tr7 Room-Share Matching] adds Room-Share AFTER ORCH-0913 establishes the canonical grid.
- **NOT touching buyer-facing flows.** No changes to `/checkout/{eventId}`, no changes to consumer app, no changes to admin web.
- **NOT adding Scan tickets / Scanners / Door Sales / Reconciliation tiles** to trip. These are event-specific (physical event check-in + door sales + per-event reconciliation). Trips have no analogues today.
- **NOT changing the underlying data hooks.** `useTrip`, `useTripOrders`, `useTripIntakeSchemasByEvent`, `useInstallmentsForBrandTrips`, `useRetryInstallment`, `useSoftDeleteTrip` consumed unchanged.
- **NOT extracting `EventDetailKpiCard` / `EventDetailActivityRow` / `EventDetailTicketTypeRow` to a `shared/` directory** unless the implementor finds it trivial. Wrapping with a `TripDetailKpiCard` / clone is equally acceptable. SPEC declares the rendered SHAPE; implementor picks the file structure within hard guards in §6.
- **NOT touching wizards or edit flows.** `trip/[id]/edit.tsx` unchanged.
- **NOT redesigning the hero cover layout or status-pill visual style** (pill stays in the same place; only its STATE DERIVATION upgrades per CF-1).

### 2.3 Assumptions

- A1. `trip.businessTrip.startAt` is ISO-8601 string or null. CF-1 lifecycle derivation falls back to `"upcoming"` when null (matches event pattern via `computeMasterStartAtUtc`).
- A2. `trip.businessTrip.capacity` is `number | null` per existing usage at `trip/[id]/index.tsx:454`. Spots renders `"${N} / ${capacity}"` when capacity is set, `"${N}"` when null.
- A3. `useInstallmentsForBrandTrips(brandId, { tripEventId, atRiskOnly })` query returns `OrderInstallmentForBrand[]` per existing usage. Recent Activity uses the same query (no second hook instance — React Query dedupes by key).
- A4. `useTripOrders(eventId)` returns trip orders with `paymentStatus`, `totalCents`, `buyerName`, `currency`, and a timestamp suitable for activity sorting. Verified at `trip/[id]/index.tsx:184–199` (revenue aggregation already excludes failed/cancelled/refunded).
- A5. The mingla-business desktop-web baseline preserves the trip-dashboard render path unchanged (no `.web.tsx` override exists today).
- A6. The new `trip/[id]/travelers/index.tsx` + `trip/[id]/money/index.tsx` routes inherit the same `useTrip` + `useTripOrders` + `useInstallmentsForBrandTrips` query patterns from the dashboard; no new data plumbing required.

---

## 3. Layer-by-layer specification

### 3.1 Component layer — Dashboard restructure

**File:** `mingla-business/app/trip/[id]/index.tsx`

#### 3.1.1 Removed (deletions in same diff — Constitution #8 subtract-before-add)

| Element | Lines (current) | Reason |
|---|---|---|
| `type TabKey = "overview" \| "travelers" \| "money";` | 72 | Tab structure deleted |
| `const [tab, setTab] = useState<TabKey>("overview");` | 101 | Tab state deleted |
| `<View style={styles.tabs}>...</View>` (3 Pressables + 3 Text labels) | 387–435 | Tab bar render deleted |
| `{tab === "overview" ? ... : tab === "travelers" ? ... : (...) }` ternary inside ScrollView | 441–580 | Per-tab body branches deleted — content moves to new routes (travelers, money) or top-level sections (KPI strip, Recent Activity) |
| `styles.tabs`, `styles.tab`, `styles.tabActive`, `styles.tabText`, `styles.tabTextActive`, `styles.tabBadgeAtRisk`, `styles.kpiRow` (if no longer used after lifting), `styles.kpiSubvalue` (review usage) | 830–882 | Tab + Overview-tab-specific styles deleted |
| All `MoneyTabBody` + `MoneyTabBodyProps` + `MoneyFilter` type + `statusPillStyle` + `statusLabel` + `friendlyFailureCopy` + `formatMoneyDate` definitions | 1093–1458 | Lifted to new file at `mingla-business/app/trip/[id]/money/index.tsx` |
| Travelers tab body JSX (per-order rows + `TravelerIntakeAnswerCard` + `TravelerTierChip` rendering) | 481–550 | Lifted to new file at `mingla-business/app/trip/[id]/travelers/index.tsx` |
| Imports made unused by deletions: `RefundPreviewSheet`, `useInstallmentsForBrandTrips`, `useRetryInstallment`, `OrderInstallmentForBrand`, `OrderInstallmentStatus`, `InstallmentScheduleDisplay`, `InstallmentScheduleDisplaySchedule`, `projectInstallmentSchedule`, `useTripIntakeSchemasByEvent`, `TravelerIntakeAnswerCard`, `TravelerTierChip`, `IntakeAnswerValue` | (multiple) | All dashboard-internal usages are gone — these move to the new route files |

#### 3.1.2 Added (top-level beneath hero, in render order)

**Render order beneath hero is locked:**

1. Action grid (7 tiles — see 3.1.3)
2. Revenue + Spots KPI strip (see 3.1.4)
3. PRICING TIERS section (see 3.1.5)
4. RECENT ACTIVITY section (see 3.1.6)
5. Cancel trip ghost CTA (unchanged from current behaviour — only its position shifts; see 3.1.7)

#### 3.1.3 Action grid — 7 tiles, LOCKED order

```tsx
<View style={styles.actionGrid}>
  <ActionTile
    icon="users"
    label="Travelers"
    sub={`${travelersCount} ${travelersCount === 1 ? "traveler" : "travelers"}`}
    onPress={() => router.push(`/trip/${trip.id}/travelers` as never)}
  />
  <ActionTile
    icon="pound"
    label="Money"
    sub={(moneyData?.atRiskOrderCount ?? 0) > 0
      ? `${moneyData?.atRiskOrderCount} at risk`
      : undefined}
    onPress={() => router.push(`/trip/${trip.id}/money` as never)}
  />
  <ActionTile
    icon="send"
    label="Blasts"
    sub="Message ticket buyers"
    onPress={() => router.push(`/event/${trip.id}/blasts` as never)}
  />
  <ActionTile
    icon="chat"
    label="Group chat"
    sub="Read + reply + moderate"
    onPress={() => router.push(`/event/${trip.id}/group-chat` as never)}
  />
  {trip.brandSlug !== null && trip.brandSlug.length > 0 ? (
    <ActionTile
      icon="eye"
      label="Public page"
      onPress={() => router.push(`/t/${trip.brandSlug}/${trip.slug}` as never)}
    />
  ) : null}
  {trip.brandSlug !== null && trip.brandSlug.length > 0 ? (
    <ActionTile
      icon="user"
      label="Brand page"
      onPress={() => router.push(`/b/${trip.brandSlug}` as never)}
    />
  ) : null}
  <ActionTile
    icon="edit"
    label={trip.status === "draft" ? "Continue editing" : "Edit trip"}
    primary
    onPress={() => router.push(`/trip/${trip.id}/edit` as never)}
  />
</View>
```

**Notes:**
- `Money` tile sub is `undefined` (not rendered) when there are zero at-risk orders. The tile body shows only the label + icon — matches the "Reconciliation" pattern on event side (no sub).
- The `icon="pound"` choice is for visual parity with the existing money/pound iconography in `MoneyTabBody`'s empty state (line 1239). Implementor may verify the Icon registry has `pound`; if not, fall back to `ticket` or `bars-chart`.
- `travelersCount` continues to be derived from the existing `(ordersQuery.data ?? []).filter((o) => o.paymentStatus !== "failed" && o.paymentStatus !== "cancelled").length` formula at trip:241–243.
- `moneyData?.atRiskOrderCount` continues to be derived from the existing `useInstallmentsForBrandTrips` query + `useMemo` aggregation at trip:151–182 (still required — see Recent Activity § 3.1.6).

#### 3.1.4 Revenue + Spots KPI strip — lifted from Overview tab to top-level

**Direct beneath the action grid, before any section labels.**

The implementor has two equally acceptable options for the strip primitive:

**Option A — Extract `EventDetailKpiCard` to a shared primitive** (`mingla-business/src/components/shared/DashboardKpiCard.tsx`) parameterised on `leftLabel`/`leftValue`/`rightLabel`/`rightValue`. Then both event and trip use the shared primitive. Event passes Revenue/Payout; trip passes Revenue/Spots. Sparkline placeholder either becomes optional or gets a per-side prop.

**Option B — Clone the existing `EventDetailKpiCard` as a sibling `TripDetailKpiCard`** at `mingla-business/src/components/trip/TripDetailKpiCard.tsx` with the same `GlassCard variant="elevated" radius="lg" padding={spacing.lg}` shell and the same 2-column row layout, but with:
- Left label: `REVENUE` · Left value: `formatCurrency(totalRevenue, primaryCurrency)`
- Right label: `SPOTS` · Right value: `${travelersCount}${capacity !== null ? ` / ${capacity}` : ""}`
- Sparkline placeholder OMITTED on trip side (trips don't have hourly revenue patterns in the same way events do).

**Implementor decision freedom — but the SHAPE is locked:** `GlassCard variant="elevated"`, two columns, label-on-top + value-below. **Whichever option the implementor picks, the rendered visual shape MUST match event's KPI card so the parity is operator-visible at first glance.**

If implementor picks Option A, also update `event/[id]/index.tsx:723–727` to use the shared primitive — that's a 3-line edit (import path + invocation rename + prop name shift). Strict-grep gate added in §8.4 enforces neither dashboard imports the old `EventDetailKpiCard` post-refactor (only the shared primitive). If implementor picks Option B, event side is untouched.

#### 3.1.5 PRICING TIERS section

```tsx
<Text style={styles.sectionLabel}>PRICING TIERS</Text>
{trip.pricingTiers.length === 0 ? (
  <GlassCard variant="base" radius="md" padding={spacing.md}>
    <Text style={styles.emptySectionText}>No pricing tiers yet.</Text>
  </GlassCard>
) : (
  <View style={styles.tiersList}>
    {trip.pricingTiers
      .filter((t) => /* visibility filter if applicable to trip tiers — confirm during implementation */ true)
      .sort((a, b) => /* displayOrder if present, else creation order */ 0)
      .map((tier) => (
        <DashboardTicketTypeRow  // or EventDetailTicketTypeRow if no rename
          key={tier.ticketTypeId}
          ticket={/* adapt PricingTier → ticket shape per existing trip data model */}
          soldCount={/* count from soldCountByTier-equivalent if implemented; else omit */}
        />
      ))}
  </View>
)}
```

**Implementor:** confirm the `PricingTier` data shape (`trip.pricingTiers[i]`) maps cleanly to `EventDetailTicketTypeRow`'s `ticket` prop. If shapes diverge, write a trip-side adapter inline OR clone the row component as `TripDetailTierRow`. **Do NOT mutate the trip data hook return type** — the adapter is a pure local transform.

If a tier-sold-count is not trivially available from existing data, OMIT the `soldCount` rendering (do not fabricate — Constitution #9). The orchestrator may register a follow-up ORCH if per-tier counts become a felt gap.

#### 3.1.6 RECENT ACTIVITY section — 5 streams, capped at 5 rows newest-first

```tsx
const recentActivity = useMemo<ActivityEvent[]>(() => {
  if (trip === null) return [];
  const events: ActivityEvent[] = [];

  // ---- Stream 1: order-paid (paid orders, non-refunded) ---
  for (const o of ordersQuery.data ?? []) {
    if (o.paymentStatus !== "paid") continue;
    events.push({
      kind: "purchase",
      orderId: o.id,
      buyerName: o.buyerName ?? o.buyerEmail ?? "Anonymous",
      summary: `booked ${/* tier name if available, else "the trip" */}`,
      amountGbp: o.totalCents / 100,
      currency: o.currency,
      at: /* paid_at timestamp from order — adapt per useTripOrders return shape */,
    });
  }

  // ---- Stream 2: order-cancelled ---
  for (const o of ordersQuery.data ?? []) {
    if (o.paymentStatus !== "cancelled") continue;
    events.push({
      kind: "cancel",
      orderId: o.id,
      buyerName: o.buyerName ?? o.buyerEmail ?? "Anonymous",
      summary: "cancelled their booking",
      at: /* cancelled_at timestamp from order — adapt per useTripOrders return shape */,
    });
  }

  // ---- Stream 3: installment-collected ---
  for (const r of installmentsQuery.data ?? []) {
    if (r.status !== "collected") continue;
    events.push({
      kind: "purchase",  // reuse purchase row kind — semantically a money-in event
      orderId: r.orderId,
      buyerName: r.buyerName ?? r.buyerEmail ?? "Anonymous",
      summary: `paid installment ${r.ordinal}`,
      amountGbp: r.amountCents / 100,
      currency: r.currency,
      at: r.collectedAt /* or paid_at field per useInstallmentsForBrandTrips return shape */,
    });
  }

  // ---- Stream 4: installment-failed ---
  for (const r of installmentsQuery.data ?? []) {
    if (r.status !== "failed") continue;
    events.push({
      kind: "refund",  // reuse refund row kind for visual color/icon; copy is "failed"
      orderId: r.orderId,
      buyerName: r.buyerName ?? r.buyerEmail ?? "Anonymous",
      summary: `installment ${r.ordinal} failed`,
      amountGbp: r.amountCents / 100,
      currency: r.currency,
      at: r.failedAt /* or attempted_at field per shape */,
    });
  }

  // ---- Stream 5: trip-cancelled lifecycle row ---
  if (trip.status === "cancelled" && /* trip.cancelledAt available — confirm field name during implementation */ trip.cancelledAt !== null) {
    events.push({
      kind: "event_cancelled",
      eventId: trip.id,
      summary: "Trip cancelled",
      at: trip.cancelledAt,
    });
  }

  // Newest first, cap at 5
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events.slice(0, 5);
}, [ordersQuery.data, installmentsQuery.data, trip]);
```

```tsx
<Text style={styles.sectionLabelSpacer}>RECENT ACTIVITY</Text>
<GlassCard variant="base" radius="md" padding={spacing.md}>
  {recentActivity.length === 0 ? (
    <Text style={styles.emptySectionText}>No activity yet.</Text>
  ) : (
    <View style={styles.activityList}>
      {recentActivity.map((a) => (
        <EventDetailActivityRow  // or DashboardActivityRow if renamed
          key={activityRowKey(a)}
          event={a}
        />
      ))}
    </View>
  )}
</GlassCard>
```

**Implementor notes:**
- `ActivityEvent`, `activityRowKey`, `EventDetailActivityRow` already exist at `mingla-business/src/components/event/EventDetailActivityRow.tsx`. Import as-is OR rename to `DashboardActivityRow` if Option A primitive extraction is chosen.
- If `ActivityEvent` kinds (purchase / refund / cancel / event_edit / event_sales_ended / event_cancelled / event_scan / event_door_refund) don't include an installment-specific kind, the SPEC accepts reusing `purchase` for installment-collected (money-in semantics) and `refund` for installment-failed (failure-icon visual). If implementor prefers cleaner semantics, ADD `installment_collected` + `installment_failed` kinds to the `ActivityEvent` discriminated union and extend `EventDetailActivityRow` with renderers for those kinds — but this is OPTIONAL and additive (no behaviour change for existing event kinds).
- Field name caveats (`paid_at`, `cancelled_at`, `collected_at`, `failed_at`, `trip.cancelledAt`): the SPEC names these placeholders because the investigator did not exhaustively trace every hook return type. Implementor must confirm the actual field names at implementation time and lock them in the implementation report. If a field is missing entirely (e.g., `useInstallmentsForBrandTrips` does not expose `collected_at`), DO NOT FABRICATE a timestamp — omit that stream and document it as DISC for orchestrator.

#### 3.1.7 Cancel trip CTA — position only

The existing render at `trip/[id]/index.tsx:585–596` is preserved verbatim. It becomes the LAST direct child of the ScrollView (after the new Recent Activity section). The conditional gating (`trip.status !== "ended" && trip.status !== "cancelled"`) is unchanged.

#### 3.1.8 CF-1 lifecycle status pill

Replace the existing binary pill render at trip:304–316 with a lifecycle-aware variant. Two implementor-acceptable approaches:

**A. Reuse `EventDetailHeroStatusPill`** — but it accepts `EventStatus = "live" | "upcoming" | "past"` (3 states). Trip needs 4 (add `"cancelled"`). Either extend `EventStatus` to 4 (and update event-side to handle the 4th — already done internally via `deriveScreenStatus`'s cancelled→past collapse), OR build a parallel `TripDetailHeroStatusPill` with 4 states.

**B. Build `TripDetailHeroStatusPill`** at `mingla-business/src/components/trip/TripDetailHeroStatusPill.tsx` with 4 states (`live`, `upcoming`, `past`, `cancelled`). Color tokens: live=success-green-tint, upcoming=neutral-glass, past=neutral-muted, cancelled=error-tint. Mirror the visual style of `EventDetailHeroStatusPill`.

**Derivation:** use `deriveLiveStatus` from `mingla-business/src/utils/eventLifecycle.ts:53` (already exports `EventLifecycleStatus = "live" | "upcoming" | "past" | "cancelled"` per line 24). Trip start/end timestamps come from `trip.businessTrip.startAt` + `trip.businessTrip.endAt`. If `deriveLiveStatus` expects an `event`-shape object, write a tiny inline adapter:

```ts
const tripLifecycleStatus = deriveLiveStatus(
  {
    status: trip.status,
    cancelledAt: trip.cancelledAt ?? null,
    endedAt: null,  // trips don't have explicit endedAt — derive from endAt comparison if needed
    startAt: trip.businessTrip.startAt,
  } as any,  // adapter shim — flag for follow-up if Constitution #1/#2 violation is risked
  computeMasterStartAtUtc-equivalent  // if not directly applicable to trips, use new Date(trip.businessTrip.startAt)
);
```

If the `as any` shim feels brittle, prefer Option B (parallel `TripDetailHeroStatusPill` with self-contained derivation reading directly from `trip.businessTrip.startAt`/`endAt`/`status`).

#### 3.1.9 CF-2 web textShadow Platform.select

Replace the current trip `heroTitle` + `heroSubline` `textShadowColor` / `textShadowOffset` / `textShadowRadius` triples with Platform.select branches mirroring `event/[id]/index.tsx:967–974`:

```ts
heroTitle: {
  fontSize: 24,
  fontWeight: "700",
  letterSpacing: -0.2,
  color: textTokens.inverse,
  ...(Platform.OS === "web"
    ? { textShadow: "0 1px 4px rgba(0, 0, 0, 0.6)" }
    : {
        textShadowColor: "rgba(0, 0, 0, 0.6)",
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
      }),
  marginTop: spacing.xs,
},
heroSubline: {
  fontSize: 13,
  color: "rgba(255, 255, 255, 0.85)",
  ...(Platform.OS === "web"
    ? { textShadow: "0 1px 3px rgba(0, 0, 0, 0.5)" }
    : {
        textShadowColor: "rgba(0, 0, 0, 0.5)",
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
      }),
},
```

Add `import { Platform } from "react-native";` if not already imported. Adds zero behaviour difference on iOS/Android; removes the deprecation warning + restores visible shadow on web.

### 3.2 Component layer — New route `mingla-business/app/trip/[id]/travelers/index.tsx`

**Behaviour:** lifts the existing Travelers tab body (trip:481–550) verbatim. Same `useTripOrders` + `useTripIntakeSchemasByEvent` data wiring. Same `TravelerIntakeAnswerCard` + `TravelerTierChip` render. Same empty-state copy ("No travelers yet. Share the trip link to start taking bookings."). Same row layout + spacing.

**Page chrome:**
- Header: TopBar with `leftKind="back"` + `title="Travelers"`. Back button returns to `trip/[id]/index.tsx`.
- Body: ScrollView with same `bodyContent` padding.
- Loading state: `<ActivityIndicator />` (current pattern).
- Error state: `<EmptyState illustration="users" title="Couldn't load travelers" description={errorMessage} cta={{ label: "Retry", onPress: refetch }} />`.

**File template:**
```tsx
import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeScreen } from "../../../../src/components/ui/SafeScreen";
import { TopBar } from "../../../../src/components/ui/TopBar";
// ... existing imports lifted from trip/[id]/index.tsx

export default function TripTravelersRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  // ... same data hooks
  // ... same render as existing Travelers tab body
}
```

### 3.3 Component layer — New route `mingla-business/app/trip/[id]/money/index.tsx`

**Behaviour:** lifts the existing `MoneyTabBody` + `MoneyTabBodyProps` + `MoneyFilter` + `statusPillStyle` + `statusLabel` + `friendlyFailureCopy` + `formatMoneyDate` + `RefundPreviewSheet` + `InstallmentScheduleDisplay` + `projectInstallmentSchedule` wiring verbatim from trip:1093–1458 + their parent invocation context.

**Page chrome:**
- Header: TopBar with `leftKind="back"` + `title="Money"`. Back button returns to `trip/[id]/index.tsx`.
- Body: same MoneyTabBody render with same props.
- ScrollView wrapping if not already.

ORCH-0914 [Trip Money tab redesign] redesigns the body content AFTER this ORCH closes. ORCH-0913's job is the verbatim lift + tile destination wiring ONLY.

### 3.4 Hook layer — no changes

Hooks consumed unchanged: `useTrip`, `useSoftDeleteTrip`, `useTripOrders`, `useTripIntakeSchemasByEvent`, `useInstallmentsForBrandTrips`, `useRetryInstallment`. New routes import the same hooks and pass them the same arguments (`tripQuery.data?.brandId`, `eventId`). React Query automatically dedupes by key when both the dashboard and the destination route fire the same hook with the same args.

### 3.5 Service layer — no changes

### 3.6 Edge function layer — no changes

### 3.7 Database layer — no changes

### 3.8 Storage layer — no changes

### 3.9 Realtime layer — no changes

---

## 4. Cross-Surface Impact (MANDATORY per Phase 2.5, codified 2026-05-15)

### 4.1 In scope (3 surfaces)

| Surface | User-visible behaviour post-fix | File paths touched | Parity |
|---|---|---|---|
| **Business iOS** (`mingla-business/` on iOS) | Trip page renders 7-tile grid + Revenue/Spots strip + Pricing Tiers + Recent Activity feed + Cancel CTA. Tabs gone. Status pill shows lifecycle state. Tap Travelers → opens dedicated route. Tap Money → opens dedicated route. | `mingla-business/app/trip/[id]/index.tsx`, NEW `mingla-business/app/trip/[id]/travelers/index.tsx`, NEW `mingla-business/app/trip/[id]/money/index.tsx`, optional `mingla-business/src/components/{shared,trip}/` new primitives | **Automatic** — same code path as Android (RN). Manual gate: live-fire sim repro mandatory at TEST. |
| **Business Android** (`mingla-business/` on Android) | Same behaviour as iOS. | Same files. | **Automatic** with iOS (shared RN code path). Manual gate: live-fire emu repro mandatory at TEST. |
| **Business web preview** (`mingla-business/` dev/web build) | Trip page renders the same restructured dashboard. CF-2 fix removes the `shadow*` Metro deprecation warning and restores visible hero text shadow on web. The 16-contract desktop-web baseline is preserved (action grid uses existing `flexWrap` pattern; no contract touches the trip-detail surface directly per the memory). | Same files. | **Automatic** within mingla-business RN-web bundle. Manual gate: visual check + run the 4 jest gates cited in `feedback_mingla_business_desktop_web_contracts.md` at TEST. |

### 4.2 NOT in scope (4 surfaces)

| Surface | Why NOT in scope |
|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | No business dashboard on consumer app — consumer surface has no equivalent to `mingla-business` trip page. |
| **Consumer Android** (`app-mobile/` on Android) | Same as Consumer iOS. |
| **Buyer/anonymous Web** (`mingla-business/` `/checkout/{eventId}` etc.) | Buyer surfaces have no organiser dashboard — these are anonymous booking routes that never render organiser tooling. |
| **Admin Web** (`mingla-admin/`) | Admin web has no trip dashboard. If admin tooling for trip ops gets requested, register a new ORCH. |

### 4.3 Parity verdict

All three in-scope surfaces share the SAME source files (mingla-business RN bundle). Parity is **automatic** within the bundle — no per-surface code paths. The success criteria below therefore have ONE shared spec; per-surface gates are TEST-mode verification gates (live-fire iOS sim + live-fire Android emu + desktop-web visual + 4 jest gates), not separate code targets.

---

## 5. Success Criteria (per-test verifiable, per-surface gated at TEST)

### 5.1 Dashboard restructure

| ID | Criterion | Verification |
|---|---|---|
| SC-01 | Trip dashboard renders ZERO Pressables with `accessibilityRole="tab"`. | Grep gate (§8.4) + unit test |
| SC-02 | Trip dashboard renders exactly 7 `<ActionTile>` children in the action grid (assuming `trip.brandSlug` set + non-draft) — Travelers, Money, Blasts, Group chat, Public page, Brand page, Edit trip. | Unit test |
| SC-03 | Travelers tile sub displays `"${N} travelers"` or `"${N} traveler"` (singular) matching `travelersCount` derivation. | Unit test |
| SC-04 | Money tile sub displays `"${N} at risk"` when `moneyData?.atRiskOrderCount > 0`; tile sub is absent otherwise. | Unit test |
| SC-05 | Blasts tile renders sub `"Message ticket buyers"` matching event's tile. | Unit test |
| SC-06 | Group chat tile renders sub `"Read + reply + moderate"` matching event's tile. | Unit test |
| SC-07 | Edit trip tile renders with `primary={true}` (orange-highlighted) AND label is `"Continue editing"` when `trip.status === "draft"` else `"Edit trip"`. | Unit test |
| SC-08 | Tapping Travelers tile navigates to `/trip/${trip.id}/travelers`. | Unit test (router mock) + live-fire sim |
| SC-09 | Tapping Money tile navigates to `/trip/${trip.id}/money`. | Unit test (router mock) + live-fire sim |
| SC-10 | Tapping Blasts tile navigates to `/event/${trip.id}/blasts` (existing route — preserved). | Unit test (router mock) + live-fire sim |
| SC-11 | Tapping Group chat tile navigates to `/event/${trip.id}/group-chat` (existing route — preserved per ORCH-0897). | Unit test (router mock) + live-fire sim |
| SC-12 | Tapping Public page tile navigates to `/t/${trip.brandSlug}/${trip.slug}` (existing route — preserved). | Unit test (router mock) + live-fire sim |
| SC-13 | Tapping Brand page tile navigates to `/b/${trip.brandSlug}` (existing route — preserved). | Unit test (router mock) + live-fire sim |
| SC-14 | Tapping Edit trip tile navigates to `/trip/${trip.id}/edit` (existing route — preserved). | Unit test (router mock) + live-fire sim |

### 5.2 KPI strip

| ID | Criterion | Verification |
|---|---|---|
| SC-15 | Revenue + Spots KPI strip renders directly beneath the action grid (no tab body wrapper around it). | Unit test (render-tree assertion) + visual snapshot |
| SC-16 | Revenue value displays `formatCurrency(totalRevenue, primaryCurrency)` matching the existing revenue aggregation formula at trip:184–199. | Unit test |
| SC-17 | Spots value displays `${travelersCount}` when capacity is null, OR `${travelersCount} / ${capacity}` when set. | Unit test |
| SC-18 | KPI strip uses `GlassCard variant="elevated"` (visual parity with `EventDetailKpiCard`). | Visual snapshot |

### 5.3 PRICING TIERS section

| ID | Criterion | Verification |
|---|---|---|
| SC-19 | PRICING TIERS section renders directly beneath the KPI strip. Section label is `"PRICING TIERS"` in the same `sectionLabel` style as event. | Unit test |
| SC-20 | Empty state copy: `"No pricing tiers yet."` when `trip.pricingTiers.length === 0`. | Unit test |
| SC-21 | Tier rows render via the same row primitive as event Ticket Types (visual parity at the row level). | Visual snapshot |

### 5.4 RECENT ACTIVITY section

| ID | Criterion | Verification |
|---|---|---|
| SC-22 | RECENT ACTIVITY section renders directly beneath the Pricing Tiers section. Section label uses `sectionLabelSpacer` style matching event. | Unit test |
| SC-23 | Empty state copy: `"No activity yet."` when zero source streams produce events. | Unit test |
| SC-24 | Recent Activity renders at most 5 rows, sorted newest-first by `at` timestamp. | Unit test |
| SC-25 | Recent Activity rows source from 5 streams: order-paid, order-cancelled, installment-collected, installment-failed, trip-cancelled-lifecycle. | Unit test (each stream independently exercised) |
| SC-26 | Recent Activity row buyer name falls back: `buyerName ?? buyerEmail ?? "Anonymous"` (no fabricated names — Constitution #9). | Unit test |
| SC-27 | Recent Activity row with missing timestamp is OMITTED from the feed (no row rendered with a placeholder date). | Unit test (adversarial input) |

### 5.5 Cancel CTA + lifecycle pill + CF-2

| ID | Criterion | Verification |
|---|---|---|
| SC-28 | Cancel trip ghost CTA renders as LAST child of the ScrollView (after Recent Activity), conditional on `trip.status !== "ended" && trip.status !== "cancelled"` (unchanged from current behaviour). | Unit test |
| SC-29 | Status pill renders 4 states: `"Live"` (between startAt and endAt), `"Upcoming"` (now < startAt), `"Past"` (now > endAt && not cancelled), `"Cancelled"` (status === cancelled). | Unit test (4 fixtures) |
| SC-30 | On web (`Platform.OS === "web"`), trip heroTitle + heroSubline use CSS shorthand `textShadow`; on iOS/Android, RN-triple is used. | Unit test + Metro warning absence check |

### 5.6 New routes — Travelers + Money

| ID | Criterion | Verification |
|---|---|---|
| SC-31 | `/trip/[id]/travelers` route renders the same Travelers list content currently inside the Travelers tab body (per-order rows + intake-form cards + tier chips). | Unit test (render-tree compare to baseline) + live-fire sim |
| SC-32 | `/trip/[id]/travelers` route header is `TopBar leftKind="back" title="Travelers"`; back returns to trip dashboard. | Unit test + live-fire sim |
| SC-33 | `/trip/[id]/travelers` route empty state copy unchanged: `"No travelers yet. Share the trip link to start taking bookings."` | Unit test |
| SC-34 | `/trip/[id]/money` route renders the same Money content currently inside the Money tab body (MoneyTabBody + RefundPreviewSheet + InstallmentScheduleDisplay). | Unit test + live-fire sim |
| SC-35 | `/trip/[id]/money` route header is `TopBar leftKind="back" title="Money"`; back returns to trip dashboard. | Unit test + live-fire sim |
| SC-36 | `/trip/[id]/money` route preserves all existing MoneyTabBody behaviour: filter chips, expand-row, retry installment, cancel-and-refund. | Unit test + live-fire sim |

### 5.7 Per-surface acceptance gates

| Surface | Acceptance gate |
|---|---|
| Business iOS | All SC-01..SC-36 pass + live-fire sim drives the 5-tap golden path (open trip → tap Travelers → back → tap Money → back) + Maestro flow captures screenshots matching the SPEC structure. |
| Business Android | All SC-01..SC-36 pass + live-fire emu drives same 5-tap golden path. |
| Business web preview | All SC-01..SC-36 pass + visual check on desktop browser shows the same structure (tile grid wraps appropriately, sections stack vertically) + 4 jest gates from `feedback_mingla_business_desktop_web_contracts.md` stay green + Metro console shows ZERO `"shadow*" style props are deprecated` warnings post-CF-2 fix. |

---

## 6. Invariants preserved + new

### 6.1 Preserved

| Invariant | How preservation is enforced |
|---|---|
| Constitution #2 — One owner per truth | Trip orders sourced from `useTripOrders` only; installments from `useInstallmentsForBrandTrips` only. Dashboard and new routes share hooks — no second authority. |
| Constitution #3 — No silent failures | New routes render error states with retry CTA; KPI strip + Recent Activity handle loading/error/empty/populated states explicitly per SC-20, SC-23, SC-33. |
| Constitution #4 — One key per entity | React Query factory unchanged; same query keys fire in dashboard and route — automatic dedup. |
| Constitution #8 — Subtract before add | All 3-tab structure + per-tab state + per-tab body branches DELETED in same diff that adds new tiles + routes. SC-01 grep gate enforces. |
| Constitution #9 — No fabricated data | Recent Activity rows fall back through `buyerName ?? buyerEmail ?? "Anonymous"` (SC-26); rows with missing timestamps omitted (SC-27); empty-state copy honest (SC-23, SC-33). |
| Constitution #10 — Currency-aware | Revenue + activity amounts use `formatCurrency` with the order's recorded currency (existing pattern preserved). |
| `I-37` WCAG AA touch target ≥ 44pt | `ActionTile` primitive enforces 44pt target — unchanged. New routes' back button uses `IconChrome size={36}` with `hitSlop={8}` matching trip dashboard's existing back button. |
| `I-39` Pressable `accessibilityLabel` coverage | All new Pressables (tiles, retry, refund, back) carry `accessibilityLabel`. Strict-grep gate `I-39` already enforces. |
| `I-PROPOSED-CREATOR-ENTRY-IS-INSTANT` (ORCH-0893) | Trip detail page is not a creator-entry page — N/A. |
| 16-contract desktop-web baseline (`feedback_mingla_business_desktop_web_contracts.md`) | New dashboard uses existing `actionGrid` `flexWrap` pattern + section stacking. SPEC §4.1 declares the baseline preserved; TEST verifies via the 4 jest gates. |

### 6.2 NEW invariant proposed

| ID | Description | Enforcement |
|---|---|---|
| `I-PROPOSED-DASHBOARD-PARITY-TRIP-EVENT` | Trip dashboard and event dashboard use the same tile-grid + section-beneath structure (Revenue/Spots strip → Tiers → Recent Activity → Cancel CTA); neither surface introduces tab strips for primary content navigation. | CI grep gate at `.github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs` failing if `accessibilityRole="tab"` appears in `mingla-business/app/(event\|trip)/[id]/index.tsx`. Status: **DRAFT → flips to ACTIVE on ORCH-0913 CLOSE.** |

---

## 7. Test cases (implementor MUST write happy-path + tester MUST write adversarial)

### 7.1 Implementor happy-path test — REQUIRED

**File:** `mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx`

| Test | Scenario | Assertion |
|---|---|---|
| T-01 | Dashboard renders zero tabs | `queryAllByA11yRole("tab")` returns `[]` |
| T-02 | Dashboard renders 7 action tiles in locked order | Render-tree assertion: tile labels match `["Travelers", "Money", "Blasts", "Group chat", "Public page", "Brand page", "Edit trip"]` in order |
| T-03 | Travelers tile sub uses singular/plural correctly | 1 traveler → `"1 traveler"`; 0 or 2+ → `"${N} travelers"` |
| T-04 | Money tile sub absent when zero at-risk | `queryByText("at risk")` returns null |
| T-05 | Money tile sub present when N at-risk | `getByText("3 at risk")` matches |
| T-06 | KPI strip renders directly beneath action grid | Render-tree assertion: KPI strip is the sibling immediately after `actionGrid` |
| T-07 | KPI strip Spots renders `N / capacity` when capacity set | Travelers=5, capacity=12 → `"5 / 12"` |
| T-08 | KPI strip Spots renders `N` when capacity null | Travelers=3, capacity=null → `"3"` |
| T-09 | Recent Activity 5-stream merge produces correct order | 4 fixture events (2 orders, 1 installment, 1 cancellation) → newest-first sort verified |
| T-10 | Recent Activity caps at 5 rows | 8 fixture events → exactly 5 rows rendered |
| T-11 | Recent Activity row omitted when timestamp missing | Order with paid_at=null → not included in feed |
| T-12 | Lifecycle status pill renders 4 states | 4 fixtures (live/upcoming/past/cancelled) → 4 distinct labels |
| T-13 | Cancel CTA renders LAST child of ScrollView when gated true | Render-tree assertion: last child === Cancel CTA |
| T-14 | Cancel CTA hidden when status=ended | Fixture with status=ended → CTA absent |
| T-15 | Travelers route renders existing list content | Render baseline assert: same number of rows + same intake-form cards + same tier chips |
| T-16 | Money route renders existing MoneyTabBody | Render baseline assert: filter chips + installment ledger present |
| T-17 | Web textShadow uses CSS shorthand on Platform.OS=web | Jest with Platform.OS mocked to "web" → style object has `textShadow` string |
| T-18 | Mobile textShadow uses RN triple on Platform.OS=ios | Jest with Platform.OS mocked to "ios" → style object has `textShadowColor` |

**Fails-on-revert verification:** Implementor MUST `git stash` the fix, re-run `npx jest mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx`, confirm all 18 tests FAIL on baseline (the deleted 3-tab structure causes assertions to fail), restore, confirm 18/18 PASS. Cite `fails-on-revert verified at <commit-hash-of-pre-fix>` in the implementation report.

### 7.2 Tester adversarial test — REQUIRED (different angles)

**File:** `mingla-business/app/trip/[id]/__tests__/dashboard-parity-adversarial.test.tsx`

| Test | Scenario | Attacks |
|---|---|---|
| T-A01 | Tile destination route integrity | Travelers tile MUST navigate to `/trip/<id>/travelers` NOT `/event/<id>/orders` (regression check vs accidentally pointing at event-side route) |
| T-A02 | Money tile destination integrity | Money tile MUST navigate to `/trip/<id>/money` NOT `/event/<id>/reconciliation` |
| T-A03 | Blasts tile preserves existing route | Blasts tile MUST navigate to `/event/<id>/blasts` NOT a new trip-specific route (existing route preserved per scope §2.2) |
| T-A04 | Group chat tile preserves existing route | Group chat tile MUST navigate to `/event/<id>/group-chat` (ORCH-0897 substrate preserved) |
| T-A05 | Recent Activity buyer-name fallback | Order with `buyerName=null` AND `buyerEmail=null` → row renders `"Anonymous"` NOT empty string NOT crash |
| T-A06 | Recent Activity zero-amount installment | Installment with `amountCents=0` → row renders `"$0.00"` NOT `"undefined"` NOT crash |
| T-A07 | Lifecycle pill cancelled state | Trip with `status=cancelled` AND `now > endAt` → pill renders `"Cancelled"` NOT `"Past"` (cancelled supersedes past) |
| T-A08 | KPI strip during loading | `ordersQuery.isLoading=true` → strip renders skeleton OR placeholder, NOT crash, NOT empty |
| T-A09 | Travelers tile when capacity is zero | Fixture with capacity=0 (degenerate but possible) → sub renders `"5 / 0"` honestly (not crash, not fallback) — operator-facing data integrity |
| T-A10 | Edit-trip primary-tile divergence preserved | Trip dashboard's Edit tile MUST render with `primary={true}` (the deliberate divergence from event per HF-1 LOCKED) — adversarial check against an over-zealous parity fix |
| T-A11 | Strict-grep gate fires on regression | Fixture: inject `accessibilityRole="tab"` into trip dashboard → CI gate FAILS with descriptive error message |
| T-A12 | New routes' back button returns to trip dashboard | Travelers route + Money route: tap back → router navigates to `/trip/[id]` not deeper into the stack |

**Fails-on-revert verification:** Tester independently verifies T-A11 fails on baseline (insert the regression, gate fires) AND T-A05–T-A07 catch defects the implementor's happy-path doesn't cover (e.g., the happy-path tests with non-null buyer names — adversarial tests buyer-name=null).

### 7.3 Strict-grep CI gate

**File:** `.github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs`

```js
#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const FILES = [
  "mingla-business/app/event/[id]/index.tsx",
  "mingla-business/app/trip/[id]/index.tsx",
];

const PATTERN = /accessibilityRole=["']tab["']/g;

let violations = 0;
for (const f of FILES) {
  const src = await readFile(f, "utf8");
  const matches = src.match(PATTERN);
  if (matches) {
    console.error(`FAIL ${f}: ${matches.length} accessibilityRole="tab" usage(s) — dashboards must not introduce tab strips for primary content navigation (I-PROPOSED-DASHBOARD-PARITY-TRIP-EVENT, ORCH-0913).`);
    violations += matches.length;
  }
}

if (violations > 0) {
  console.error(`\nORCH-0913 dashboard-parity gate FAILED: ${violations} violation(s). See SPEC_ORCH-0913_TRIP_DASHBOARD_PARITY.md §6.2.`);
  process.exit(1);
}
console.log("ORCH-0913 dashboard-parity gate: PASS (zero tab role on dashboards)");
```

Register in `.github/workflows/strict-grep-mingla-business.yml` per the `feedback_strict_grep_registry_pattern.md` precedent (one script + one job, never a parallel workflow file).

### 7.4 Append-only test enforcement

Per `feedback_universal_skill_output_format.md` + ORCH-0840 [Regression-test enforcement + append-only CI] gate, both `dashboard-parity.test.tsx` and `dashboard-parity-adversarial.test.tsx` become immutable once landed. Future modifications require `[TEST-MOD-APPROVED ORCH-NNNN]` commit-body token.

---

## 8. Implementation order (LOCKED — implementor must follow)

| Phase | Step | Files | Verify |
|---|---|---|---|
| 1 | Delete tabs + per-tab state + per-tab body branches | `mingla-business/app/trip/[id]/index.tsx` (subtract per §3.1.1) | TypeScript compiles; remove now-unused imports |
| 2 | Create `mingla-business/app/trip/[id]/travelers/index.tsx` | NEW file (lift Travelers tab body per §3.2) | Renders standalone; TS compiles |
| 3 | Create `mingla-business/app/trip/[id]/money/index.tsx` | NEW file (lift MoneyTabBody + RefundPreviewSheet + InstallmentScheduleDisplay per §3.3) | Renders standalone; TS compiles |
| 4 | Add 7 ActionTiles to dashboard action grid in locked order | `mingla-business/app/trip/[id]/index.tsx` (add per §3.1.3) | Snapshot tile order |
| 5 | Add Revenue+Spots KPI strip directly beneath action grid | Same file (add per §3.1.4) — implementor chooses Option A (extract `DashboardKpiCard`) or Option B (clone as `TripDetailKpiCard`) | Snapshot strip position |
| 6 | Add PRICING TIERS section | Same file (add per §3.1.5) | Snapshot tier rows |
| 7 | Add RECENT ACTIVITY section with 5-stream `useMemo` | Same file (add per §3.1.6) | Snapshot 5 fixtures |
| 8 | Verify Cancel CTA renders as last child of ScrollView (unchanged behaviour) | Same file (per §3.1.7) | Snapshot position |
| 9 | Adopt lifecycle status pill (CF-1) | Same file + optional NEW `TripDetailHeroStatusPill.tsx` (per §3.1.8) | 4-state fixture test |
| 10 | Add Platform.OS web textShadow branch (CF-2) | Same file (per §3.1.9) | Web Metro console shows no `shadow*` deprecation warning |
| 11 | Add `[ORCH-0913 deliberate divergence from event]` JSDoc note above Edit tile primary | Same file | Code review |
| 12 | Write happy-path regression tests T-01..T-18 | NEW `mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx` | All 18 PASS on fix; FAIL on revert |
| 13 | Add strict-grep gate script + register in workflow | NEW `.github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs` + update `.github/workflows/strict-grep-mingla-business.yml` | Gate fires on injected regression |
| 14 | Run TypeScript + lint + jest locally | full repo | All green |
| 15 | Write IMPLEMENTATION report | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0913_TRIP_DASHBOARD_PARITY.md` (template per implementor skill) | Includes old→new receipts for every touched file + fails-on-revert receipt for T-01..T-18 |

**Hard guards during implementation:**
- DO NOT touch `mingla-business/app/event/[id]/index.tsx` unless Option A primitive extraction is chosen (then only the 3-line edit per §3.1.4). Event dashboard behaviour MUST NOT change for end users.
- DO NOT touch `useTripOrders`, `useInstallmentsForBrandTrips`, `useTrip`, `useTripIntakeSchemasByEvent`, `useRetryInstallment` hook signatures or return shapes.
- DO NOT add new database tables, migrations, edge functions, RPCs, or external API calls.
- DO NOT modify the existing `/event/[id]/blasts/` or `/event/[id]/group-chat/` routes — trip tiles reuse them as today.
- DO NOT change the existing trip Edit flow at `mingla-business/app/trip/[id]/edit.tsx`.
- DO NOT change RLS policies, brand-team-member predicates, or any auth-gating behaviour.
- IF a hook field name (e.g., `collected_at` for installments) doesn't exist as named in §3.1.6, OMIT the affected stream and document the omission in the implementation report as DISC for orchestrator — DO NOT FABRICATE a timestamp.

---

## 9. Regression prevention summary

- **Structural safeguard:** strict-grep gate `I-PROPOSED-DASHBOARD-PARITY-TRIP-EVENT` blocks any future `accessibilityRole="tab"` on either dashboard. Future ORCHs cannot accidentally re-introduce the tab pattern.
- **Happy-path test (T-01..T-18):** asserts the new structure is in place. If anyone deletes the new structure to "simplify" the dashboard, tests fail.
- **Adversarial test (T-A01..T-A12):** asserts the existing tile destinations (Blasts → `/event/[id]/blasts`, Group chat → `/event/[id]/group-chat`, Public page → `/t/...`, Brand page → `/b/...`, Edit → `/trip/[id]/edit`) remain intact AND the Edit-primary divergence stays in place.
- **Comment:** add JSDoc at top of trip dashboard file documenting (a) Edit-as-primary-tile deliberate divergence from event, (b) why tabs were removed (point to ORCH-0913 close banner).
- **Cross-skill memory:** orchestrator's CLOSE Step 5 (decommission extension) is NOT triggered (we're not decommissioning a DB feature) — but the `I-PROPOSED-DASHBOARD-PARITY-TRIP-EVENT` invariant gets added to `Mingla_Artifacts/INVARIANT_REGISTRY.md` at CLOSE per the standard invariant-ratification flow.

---

## 10. Discoveries for orchestrator (forwarded from INVESTIGATION §11)

- DISC-0913-1 — Trip hero hue IIFE pattern divergence from event's `event.coverHue` field. Out of scope.
- DISC-0913-2 — Trip uses `SafeScreen` wrapper; event uses raw `View + useSafeAreaInsets`. Pattern divergence noted but not in scope.
- DISC-0913-3 — Trip status pill currently uses `accessibilityRole="tab"` on its 3-tab strip — DELETED in this ORCH (per §3.1.1) so the DISC self-resolves.
- DISC-0913-4 — `MoneyTabBody`'s `RefundPreviewSheet` import ports with it when lifted to new route. Mild file-structure cleanup opportunity; not in scope.
- DISC-0913-5 — `EventDetailKpiCard` prop names use `revenueGbp`/`payoutGbp` (legacy GBP naming) — if Option A primitive extraction chosen in §3.1.4, rename to `leftValue`/`rightValue`. If Option B, prop names follow trip semantics (`revenueValue`/`spotsValue`).
- **NEW DISC-0913-6 (this SPEC):** ORCH-0914 [Trip Money tab redesign] depends on the Money route created by ORCH-0913 §3.3. ORCH-0914 SPEC author MUST cite this dependency at SPEC time so the redesign lands on a stable destination.
- **NEW DISC-0913-7 (this SPEC):** TR7 / ORCH-0917 [Tr7 Room-Share Matching] depends on the canonical tile-grid + section pattern established here. TR7 SPEC author MUST add the Room-Share tile per §3.1.3 ordering rules (after Money, before Blasts? or at end of grid? — TR7 SPEC decides) and a Room-Share section beneath Recent Activity (or wherever its data fits cleanly).

---

## 11. Confidence

**HIGH.** Investigation was code-truth and direct source-read. All primitives (ActionTile, EventDetailKpiCard, EventDetailActivityRow, EventDetailTicketTypeRow, deriveLiveStatus) exist at the cited paths — verified. All trip data hooks (`useTrip`, `useTripOrders`, `useInstallmentsForBrandTrips`, `useTripIntakeSchemasByEvent`, `useRetryInstallment`, `useSoftDeleteTrip`) consumed by the existing dashboard — verified. The ONLY remaining unknowns are field names on hook returns (e.g., exact name of the installment `collected_at` timestamp) — flagged in §3.1.6 implementor notes with explicit DO-NOT-FABRICATE guidance.

Sim-gate at TEST will convert §4.1 parity assertions from `automatic` to `proven` per Phase 0.A live-fire sim requirement.

---

## 12. Spec handoff

SPEC complete. Ready for orchestrator REVIEW. If APPROVED, dispatch to Codex `implementor-mingla` per the standard pipeline.
