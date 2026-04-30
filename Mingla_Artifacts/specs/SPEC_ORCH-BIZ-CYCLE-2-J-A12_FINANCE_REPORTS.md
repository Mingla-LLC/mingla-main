# Spec — J-A12: Finance Reports + Cycle-2 Polish Bundle (FINAL Cycle 2)

> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A12
> **Cycle:** 2 — Brands · **FINAL** journey
> **Codebase:** `mingla-business/` (mobile-first; web parity gated to Cycle 6/7 per DEC-071)
> **Predecessor investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A12.md`
> **Predecessor commit:** `b117c39e` (J-A10/A11 CLOSE) → `0f309f89` (orchestrator handoff lock-in)
> **Authoritative design:** `Mingla_Artifacts/design-package/mingla-business-app-screens/project/screens-brand.jsx` lines 363-441 (FinanceReportsScreen — verbatim)
> **Spec writer turn:** 2026-04-30
> **Status:** locked

---

## 1. Scope

### 1.1 In scope

#### Part A — J-A12 Finance Reports surface
- **Route (NEW):** `mingla-business/app/brand/[id]/payments/reports.tsx`
- **Component (NEW):** `mingla-business/src/components/brand/BrandFinanceReportsView.tsx`
- 5 sections: TopBar (with download IconChrome right-slot, inert) · Period switcher · Headline card (net + delta + sparkline) · Breakdown card (5 rows) · Top events list (top 5) · Exports list (3 rows)

#### Part B — Utility lift (Cycle-2 polish)
- **NEW:** `mingla-business/src/utils/currency.ts` — exports `formatGbp` + `formatCount`
- **NEW:** `mingla-business/src/utils/relativeTime.ts` — exports `formatRelativeTime` + `formatJoinedDate`
- **MOD:** Replace inline copies in 4 component files (BrandProfileView · BrandPaymentsView · BrandTeamView · BrandMemberDetailView)

#### Part C — Schema + stub data
- **MOD:** `mingla-business/src/store/currentBrandStore.ts` — Brand v8 → v9 + new `BrandEventStub` type
- **MOD:** `mingla-business/src/store/brandList.ts` — 4 brands gain events array per spec §3.2

#### Part D — TRANSITIONAL retires
- **MOD:** `mingla-business/src/components/brand/BrandProfileView.tsx` — Operations row #4 navigates instead of Toast; gains `onReports` prop
- **MOD:** `mingla-business/src/components/brand/BrandPaymentsView.tsx` — Export Button navigates instead of Toast; gains `onOpenReports` prop
- **MOD:** `mingla-business/app/brand/[id]/index.tsx` — pass `handleOpenReports` to BrandProfileView
- **MOD:** `mingla-business/app/brand/[id]/payments/index.tsx` — pass `handleOpenReports` to BrandPaymentsView

### 1.2 Out of scope (hard non-goals)

- ❌ Real CSV export (B2 wires real Stripe data + actual file download)
- ❌ Per-day revenue time series (sparkline derived deterministically from events; B2 wires real data)
- ❌ Per-event drill-in detail screen (B2 / Cycle 3+)
- ❌ Charts library (sparkline composed inline with View + flex)
- ❌ Custom date range picker (predefined ranges only)
- ❌ YTD edge cases (treat YTD as "since Jan 1 of current year")
- ❌ Real Stripe / Mingla fee rates (hard-coded 1.5% + £0.20 Stripe + 2% + £0.30 Mingla; B2 wires real)
- ❌ Backend code (DEC-071)
- ❌ New kit primitives (DEC-079; sparkline / segmented control / breakdown table / top-event row are watch-points but single-use)

### 1.3 Assumptions

- J-A10/J-A11 baseline shipped at `b117c39e`: BrandPaymentsView + BrandOnboardView + Brand v8 schema with stripeStatus + payouts + refunds + balances
- `useLocalSearchParams<{id: string | string[]}>()` returns string segment on all 3 platforms
- Existing `mingla-business/src/utils/` directory contains hapticFeedback.ts + responsive.ts; clean precedent for adding currency.ts + relativeTime.ts
- Icon set has `download` and `receipt` icons (verified Icon.tsx)

---

## 2. Authoritative design source

**Designer FinanceReportsScreen (line 363-441):**

```
TopBar: leftKind="back" · onBack · title="Finance" · right=<IconChrome icon="download"/>

Period switcher (5 buttons in row, equal flex):
  ["7d", "30d", "90d", "YTD", "All"]
  Default: "30d" (highlighted with accent.tint background + accent.border border)
  Other: glass-card style

Headline (elevated card, padding 20):
  - Caption (uppercase, tertiary, letter-spacing 1.4): "Net revenue · {period label}"
  - Big mono value (32px, weight 700, white): formatted GBP
  - Delta line (12px, success green, weight 600): "+22% vs prior 30d · £3,378 more"
  - Sparkline (30 bars, height 56px, gap 4px):
    - Each bar: flex 1, height proportional to value
    - Last 5 bars: gradient(180deg, #fb923c, #eb7825)
    - Earlier bars: rgba(255,255,255,0.16)

Breakdown (base card, padding 16):
  Row3b: label · value · (tone)
  - "Gross sales" · £20,420.00
  - "Refunds" · −£480.00 · accent
  - "Mingla fee (2% + £0.30)" · −£612.40
  - "Stripe processing" · −£607.20
  - "Net to bank" · £18,720.40 · last (emphasis)

Top events (sectionLbl + base card padding 4):
  RevRow: title · sub · amount
  - "Slow Burn vol. 4" · "284 sold · in person" · £8,420
  - "Sunday Languor (4 brunches)" · "248 sold · brunch series" · £5,420
  - "A Long Sit-Down" · "32 sold · upcoming" · £1,920
  - "Slow Burn vol. 3" · "392 sold · ended" · £2,960

Exports (sectionLbl + base card padding 4):
  Row3: icon · label · sub
  - receipt · "Stripe payouts CSV" · "For Xero / QuickBooks"
  - receipt · "Tax-ready (UK VAT)" · "Quarterly summary"
  - receipt · "All transactions" · "Itemised CSV"
```

**For Cycle 2 stub:** real Stripe deferred → exports fire TRANSITIONAL Toasts. Sparkline derived from events stub. Net revenue computed client-side via hard-coded fee rates.

---

## 3. Layer specifications

### 3.1 Schema layer (Brand v8 → v9)

**File:** `mingla-business/src/store/currentBrandStore.ts`

**New type:**

```typescript
/**
 * Stub of an event for Brand-level summarization (J-A12 schema v9).
 * Real event records ship in Cycle 3 (event creator); this stub field
 * exists ONLY to drive the J-A12 finance reports' "Top events" + revenue
 * breakdown until Cycle 3 wires per-event records to a separate table.
 *
 * Per Designer Handoff finance-reports design (screens-brand.jsx
 * FinanceReportsScreen line 411-417).
 */
export interface BrandEventStub {
  id: string;
  title: string;
  /**
   * Gross revenue from this event in GBP whole-units (before fees / refunds).
   * Drives both the Top events list amount and the breakdown computation.
   */
  revenueGbp: number;
  /** Number of tickets sold for this event. */
  soldCount: number;
  /**
   * Status drives the row sub-text label fallback.
   */
  status: "upcoming" | "in_progress" | "ended";
  /** ISO 8601 — when the event was held (or scheduled to be held). */
  heldAt: string;
  /**
   * Optional explicit context blurb for the row sub-text (e.g.,
   * "in person", "brunch series"). When undefined, the rendering falls
   * back to a status-derived label (e.g., "ended", "upcoming").
   */
  contextLabel?: string;
}
```

**Extend Brand type:**

```typescript
export type Brand = {
  // ... v8 fields unchanged ...
  /**
   * Recent events for finance-reports rendering. NEW in J-A12 schema v9.
   * Undefined treated as `[]` at read sites. Real per-event records ship
   * Cycle 3 (event creator) and live in a separate table; this Brand-
   * level stub array exists ONLY to populate J-A12 finance reports until
   * Cycle 3 lands.
   */
  events?: BrandEventStub[];
};
```

**Persist version bump:**
- `persistOptions.name` → `"mingla-business.currentBrand.v9"`
- `version: 9`
- Migration: passthrough for `version >= 3` (extends existing chain).

```typescript
// v8 → v9: passthrough. New optional `events` array starts undefined;
// finance reports render empty-state when absent. Read sites default to [].
return persistedState as PersistedState;
```

**Header comment update:** extend schema-version history with v9 entry.

### 3.2 Stub data layer

**File:** `mingla-business/src/store/brandList.ts`

Each brand gains an `events` array per O-A12-4:

```typescript
// Lonely Moth — empty state
events: [],

// The Long Lunch — empty state
events: [],

// Sunday Languor — 4 events
events: [
  {
    id: "e_sl_4",
    title: "Slow Burn vol. 4",
    revenueGbp: 8420,
    soldCount: 284,
    status: "ended",
    heldAt: "2026-04-26T20:00:00Z",
    contextLabel: "in person",
  },
  {
    id: "e_sl_brunches",
    title: "Sunday Languor — March brunches",
    revenueGbp: 5420,
    soldCount: 248,
    status: "ended",
    heldAt: "2026-03-30T11:30:00Z",
    contextLabel: "brunch series",
  },
  {
    id: "e_sl_sitdown",
    title: "A Long Sit-Down",
    revenueGbp: 1920,
    soldCount: 32,
    status: "upcoming",
    heldAt: "2026-05-15T19:00:00Z",
  },
  {
    id: "e_sl_3",
    title: "Slow Burn vol. 3",
    revenueGbp: 2960,
    soldCount: 392,
    status: "ended",
    heldAt: "2026-03-15T20:00:00Z",
  },
],

// Hidden Rooms — 1 historical event
events: [
  {
    id: "e_hr_studio",
    title: "Hidden Rooms — Studio",
    revenueGbp: 88,
    soldCount: 50,
    status: "ended",
    heldAt: "2026-04-09T20:00:00Z",
  },
],
```

**Header comment update:** append v9 entry + finance-reports stub note.

### 3.3 Utility layer (NEW)

#### `mingla-business/src/utils/currency.ts`

```typescript
/**
 * Currency formatters — single source of truth for GBP rendering across
 * mingla-business. ALL currency display passes through this util per
 * Constitution #10 (currency-aware UI).
 *
 * Lifted from inline copies in J-A7 BrandProfileView + J-A11
 * BrandPaymentsView during J-A12 Cycle-2 polish (D-INV-A10-2 watch-point
 * THRESHOLD HIT 2026-04-30).
 *
 * DO NOT add ad-hoc Intl.NumberFormat calls outside this file.
 */

/**
 * Format a numeric GBP value as a locale-aware currency string.
 * Always uses en-GB locale + GBP currency + max 2 fraction digits.
 *
 * @example formatGbp(156.20) → "£156.20"
 * @example formatGbp(0)      → "£0.00"
 */
export const formatGbp = (value: number): string =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(value);

/**
 * Format a numeric count with thousands separators.
 *
 * @example formatCount(1860) → "1,860"
 * @example formatCount(284)  → "284"
 */
export const formatCount = (value: number): string =>
  value.toLocaleString("en-GB");
```

#### `mingla-business/src/utils/relativeTime.ts`

```typescript
/**
 * Relative-time formatters — single source of truth for time display
 * across mingla-business.
 *
 * Lifted from inline copies in J-A9 BrandTeamView + J-A9
 * BrandMemberDetailView + J-A11 BrandPaymentsView during J-A12 Cycle-2
 * polish (D-INV-A10-3 watch-point THRESHOLD HIT 2026-04-30).
 *
 * DO NOT add ad-hoc Date / Intl calls for relative-time formatting.
 */

/**
 * Format an ISO 8601 timestamp as a relative-time string.
 *
 * Output buckets:
 *   < 60s        → "just now"
 *   < 60m        → "{N}m ago"
 *   < 24h        → "{N}h ago"
 *   exactly 1d   → "yesterday"
 *   < 7d         → "{N}d ago"
 *   < 30d        → "{N}w ago"
 *   ≥ 30d        → "Mmm d" (e.g., "Apr 3")
 *
 * @example formatRelativeTime(now - 5h) → "5h ago"
 */
export const formatRelativeTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
};

/**
 * Format an ISO 8601 timestamp as "Mmm yyyy" (used for "Joined" labels).
 *
 * @example formatJoinedDate("2025-07-01T10:00:00Z") → "Jul 2025"
 */
export const formatJoinedDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
```

### 3.4 Utility callers — replace inline blocks

For each file, REMOVE inline definition + REPLACE consumer with import:

#### `BrandProfileView.tsx`
- DELETE inline `formatGbp` (around line 44-49) + `formatCount` (around line 51)
- ADD import: `import { formatGbp, formatCount } from "../../utils/currency";`

#### `BrandPaymentsView.tsx`
- DELETE inline `formatGbp` block + `formatRelativeTime` block
- ADD imports: `import { formatGbp } from "../../utils/currency";` + `import { formatRelativeTime } from "../../utils/relativeTime";`

#### `BrandTeamView.tsx`
- DELETE inline `formatRelativeTime` block (lines 70-86)
- ADD import: `import { formatRelativeTime } from "../../utils/relativeTime";`

#### `BrandMemberDetailView.tsx`
- DELETE inline `formatRelativeTime` + `formatJoinedDate` blocks (lines 75-93)
- ADD import: `import { formatRelativeTime, formatJoinedDate } from "../../utils/relativeTime";`

### 3.5 Route layer — Reports (NEW)

**File:** `mingla-business/app/brand/[id]/payments/reports.tsx`

```typescript
import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandFinanceReportsView } from "../../../../src/components/brand/BrandFinanceReportsView";
import { canvas } from "../../../../src/constants/designSystem";
import { useBrandList } from "../../../../src/store/currentBrandStore";

export default function BrandFinanceReportsRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
  const brand =
    typeof idParam === "string" && idParam.length > 0
      ? brands.find((b) => b.id === idParam) ?? null
      : null;

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (brand !== null) {
      router.replace(`/brand/${brand.id}/payments` as never);
    } else {
      router.replace("/(tabs)/account" as never);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover, // I-12
      }}
    >
      <BrandFinanceReportsView brand={brand} onBack={handleBack} />
    </View>
  );
}
```

### 3.6 Component — BrandFinanceReportsView (NEW)

**File:** `mingla-business/src/components/brand/BrandFinanceReportsView.tsx`

**Props:**

```typescript
export interface BrandFinanceReportsViewProps {
  brand: Brand | null;
  onBack: () => void;
}
```

**Type:**

```typescript
type TimeRange = "7d" | "30d" | "90d" | "ytd" | "all";

const PERIOD_OPTIONS: TimeRange[] = ["7d", "30d", "90d", "ytd", "all"];
const PERIOD_LABEL: Record<TimeRange, string> = {
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  ytd: "YTD",
  all: "All",
};
const PERIOD_DAYS: Record<TimeRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  ytd: null, // computed from Jan 1
  all: null, // no filter
};

// Hard-coded fee rates — TRANSITIONAL until B2 wires real Stripe + Mingla rates
const STRIPE_PERCENT = 0.015; // 1.5%
const STRIPE_FLAT_GBP = 0.20;
const MINGLA_PERCENT = 0.02; // 2%
const MINGLA_FLAT_GBP = 0.30;
```

**State:**

```typescript
const [period, setPeriod] = useState<TimeRange>("30d");
const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });
```

**Filtering logic (useMemo):**

```typescript
const filteredEvents = useMemo<BrandEventStub[]>(() => {
  if (brand === null) return [];
  const allEvents = brand.events ?? [];
  if (period === "all") return allEvents;
  const now = Date.now();
  const cutoff = (() => {
    if (period === "ytd") {
      return new Date(new Date().getFullYear(), 0, 1).getTime();
    }
    const days = PERIOD_DAYS[period];
    return days === null ? 0 : now - days * 24 * 60 * 60 * 1000;
  })();
  return allEvents.filter((e) => new Date(e.heldAt).getTime() >= cutoff);
}, [brand, period]);

const filteredRefunds = useMemo<BrandRefund[]>(() => {
  if (brand === null) return [];
  const allRefunds = brand.refunds ?? [];
  if (period === "all") return allRefunds;
  const cutoff = /* same as above */;
  return allRefunds.filter((r) => new Date(r.refundedAt).getTime() >= cutoff);
}, [brand, period]);
```

**Headline computation:**

```typescript
const grossSales = filteredEvents.reduce((sum, e) => sum + e.revenueGbp, 0);
const totalRefunds = filteredRefunds.reduce((sum, r) => sum + r.amountGbp, 0);
const eventCount = filteredEvents.filter((e) => e.revenueGbp > 0).length;
const minglaFee = grossSales * MINGLA_PERCENT + eventCount * MINGLA_FLAT_GBP;
const stripeFee = grossSales * STRIPE_PERCENT + eventCount * STRIPE_FLAT_GBP;
const netToBank = grossSales - totalRefunds - minglaFee - stripeFee;
```

**Sparkline data:**

```typescript
const sparklineBars = useMemo<number[]>(() => {
  // 30 bars representing daily revenue distribution. For Cycle 2 stub:
  // distribute filteredEvents' revenueGbp values randomly across 30 buckets
  // weighted by heldAt (events closer to "now" go in later buckets).
  // Empty events → return [] (sparkline omitted).
  if (filteredEvents.length === 0) return [];
  // ... deterministic bar generation logic ...
}, [filteredEvents]);
```

(Implementor decides exact sparkline distribution algorithm — design intent is "looks like time series", not "is real time series". Acceptable: hash event IDs to bar positions; OR sort events by heldAt and bucket; OR just render all bars at average-of-events height with last 5 brighter. Any deterministic algorithm matching design visual.)

**Layout (in render):**

##### TopBar
```tsx
<TopBar
  leftKind="back"
  title="Finance"
  onBack={onBack}
  rightSlot={
    <Pressable accessibilityRole="button" accessibilityLabel="Quick export" disabled>
      <View style={styles.downloadIconChrome}>
        <Icon name="download" size={20} color={textTokens.primary} />
      </View>
    </Pressable>
  }
/>
```

(Icon is visually present per design but `disabled` — no onPress wired. Per O-A12-7 recommendation: inert. The Exports section below IS the export affordance.)

##### Period switcher
```tsx
<View style={styles.periodRow}>
  {PERIOD_OPTIONS.map((p) => {
    const isSelected = p === period;
    return (
      <Pressable
        key={p}
        onPress={() => setPeriod(p)}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={`Period ${PERIOD_LABEL[p]}`}
        style={[styles.periodBtn, isSelected && styles.periodBtnSelected]}
      >
        <Text style={[styles.periodLabel, isSelected && styles.periodLabelSelected]}>
          {PERIOD_LABEL[p]}
        </Text>
      </Pressable>
    );
  })}
</View>
```

##### Empty state (when filteredEvents.length === 0 AND brand !== null)
```tsx
<GlassCard variant="elevated" padding={spacing.lg}>
  <Text style={styles.emptyTitle}>
    {brand.events === undefined || brand.events.length === 0
      ? "No data yet"
      : "No data in this period"}
  </Text>
  <Text style={styles.emptyBody}>
    {brand.events === undefined || brand.events.length === 0
      ? "Finance reports populate after your first event sells tickets."
      : "Try a different time range."}
  </Text>
</GlassCard>
```

(When `brand !== null` AND `filteredEvents.length === 0`, render this card and SKIP the headline + breakdown + top-events sections. Keep period switcher visible above. Keep Exports section below — the 3 export rows are always available even when empty.)

##### Headline card (only when filteredEvents.length > 0)
```tsx
<GlassCard variant="elevated" padding={spacing.lg}>
  <Text style={styles.headlineLabel}>{`Net revenue · ${PERIOD_LABEL[period]}`}</Text>
  <Text style={styles.headlineValue}>{formatGbp(netToBank)}</Text>
  {/* Delta line: Cycle 2 stub has no historical comparison.
      Render only when prior-period data could exist (post-B2). For Cycle 2:
      omit delta entirely. The headline value alone is informative. */}
  {sparklineBars.length > 0 ? (
    <View style={styles.sparklineRow}>
      {sparklineBars.map((heightPct, i) => {
        const isRecent = i >= sparklineBars.length - 5;
        return (
          <View
            key={i}
            style={[
              styles.sparklineBar,
              {
                height: `${Math.max(heightPct, 4)}%`,
                backgroundColor: isRecent ? accent.warm : "rgba(255,255,255,0.16)",
              },
            ]}
          />
        );
      })}
    </View>
  ) : null}
</GlassCard>
```

##### Breakdown card (only when filteredEvents.length > 0)
```tsx
<GlassCard variant="base" padding={spacing.md}>
  <BreakdownRow label="Gross sales" value={formatGbp(grossSales)} />
  <BreakdownRow label="Refunds" value={`−${formatGbp(totalRefunds)}`} negative />
  <BreakdownRow label="Mingla fee (2% + £0.30)" value={`−${formatGbp(minglaFee)}`} />
  <BreakdownRow label="Stripe processing" value={`−${formatGbp(stripeFee)}`} />
  <BreakdownRow label="Net to bank" value={formatGbp(netToBank)} last />
</GlassCard>
```

`BreakdownRow` is an inline component taking `{label, value, negative?, last?}`. The `last` flag adds a top border + bolder text emphasis per design.

##### Top events (only when filteredEvents.length > 0)
```tsx
<Text style={styles.sectionLabel}>{`TOP EVENTS · ${PERIOD_LABEL[period]}`}</Text>
<GlassCard variant="base" padding={0}>
  {topEvents.map((event, index) => {
    const isLast = index === topEvents.length - 1;
    const subText =
      event.contextLabel ??
      (event.status === "upcoming"
        ? "upcoming"
        : event.status === "in_progress"
          ? "in progress"
          : "ended");
    return (
      <View
        key={event.id}
        style={[styles.eventRow, !isLast && styles.eventRowDivider]}
      >
        <View style={styles.eventLeftCol}>
          <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
          <Text style={styles.eventSub} numberOfLines={1}>
            {`${formatCount(event.soldCount)} sold · ${subText}`}
          </Text>
        </View>
        <Text style={styles.eventAmount}>{formatGbp(event.revenueGbp)}</Text>
      </View>
    );
  })}
</GlassCard>
```

`topEvents = [...filteredEvents].sort((a, b) => b.revenueGbp - a.revenueGbp).slice(0, 5);`

##### Restricted banner (only when stripeStatus === "restricted")
```tsx
{brand.stripeStatus === "restricted" ? (
  <GlassCard variant="base" padding={spacing.md} style={styles.bannerDestructive}>
    <View style={styles.bannerRow}>
      <View style={styles.bannerIconWrap}>
        <Icon name="flag" size={20} color={semantic.error} />
      </View>
      <View style={styles.bannerTextCol}>
        <Text style={styles.bannerTitle}>Stripe restricted — historical only</Text>
        <Text style={styles.bannerSub}>
          Resolve the restriction in payments to see live data.
        </Text>
      </View>
    </View>
  </GlassCard>
) : null}
```

(Render this BANNER above the period switcher. Only when stripeStatus = restricted. Cycle 2 stub: HR has restricted state with 1 historical event — banner shows + content below renders that 1 event.)

##### Exports section (always renders, even when empty)
```tsx
<Text style={styles.sectionLabel}>EXPORTS</Text>
<GlassCard variant="base" padding={0}>
  {EXPORT_ROWS.map((row, index) => {
    const isLast = index === EXPORT_ROWS.length - 1;
    return (
      <Pressable
        key={row.label}
        onPress={() => fireToast(`${row.label} export lands in B2.`)}
        accessibilityRole="button"
        accessibilityLabel={row.label}
        style={[styles.exportRow, !isLast && styles.exportRowDivider]}
      >
        <View style={styles.exportIconWrap}>
          <Icon name="receipt" size={18} color={textTokens.primary} />
        </View>
        <View style={styles.exportTextCol}>
          <Text style={styles.exportLabel}>{row.label}</Text>
          <Text style={styles.exportSub}>{row.sub}</Text>
        </View>
        <Icon name="chevR" size={16} color={textTokens.tertiary} />
      </Pressable>
    );
  })}
</GlassCard>
```

```typescript
interface ExportRow {
  label: string;
  sub: string;
}

const EXPORT_ROWS: ExportRow[] = [
  { label: "Stripe payouts CSV", sub: "For Xero / QuickBooks" },
  { label: "Tax-ready (UK VAT)", sub: "Quarterly summary" },
  { label: "All transactions", sub: "Itemised CSV" },
];
```

##### Toast mount (View root, NOT inside ScrollView)

##### Not-found state (brand === null)

Same pattern as J-A11 BrandPaymentsView not-found.

### 3.7 J-A7 wiring

**File:** `mingla-business/src/components/brand/BrandProfileView.tsx`

**Add prop:**
```typescript
export interface BrandProfileViewProps {
  // ... existing props ...
  /**
   * Called when user taps the "Finance reports" Operations row.
   * Receives brand id. NEW in J-A12 — final navigation prop in the
   * Cycle-2 chain (onEdit · onTeam · onStripe · onPayments · onReports).
   */
  onReports: (brandId: string) => void;
}
```

**Modify operationsRows useMemo — replace row #4 onPress:**

```typescript
{
  icon: "chart",
  label: "Finance reports",
  sub: "Stripe-ready CSVs",
  onPress: () => {
    if (brand !== null) onReports(brand.id);
  },
},
```

(Update useMemo deps to include `onReports`.)

**Update interface comment** to include `onReports` in the chain.

**Replace inline formatGbp + formatCount imports** per spec §3.4.

### 3.8 J-A11 wiring

**File:** `mingla-business/src/components/brand/BrandPaymentsView.tsx`

**Add prop:**
```typescript
export interface BrandPaymentsViewProps {
  brand: Brand | null;
  onBack: () => void;
  onOpenOnboard: () => void;
  /**
   * Called when user taps the Export Button. Routes to /payments/reports.
   * NEW in J-A12 — replaces the prior TRANSITIONAL Toast.
   */
  onOpenReports: () => void;
}
```

**Replace handleExport:**
```typescript
const handleExport = useCallback((): void => {
  onOpenReports();
}, [onOpenReports]);
```

(Remove `[TRANSITIONAL] Export CTA fires Toast` comment block since it's no longer transitional. Toast handler `handleResolveBanner` stays — that's a separate B2 deferral.)

**Replace inline formatGbp + formatRelativeTime imports** per spec §3.4.

### 3.9 Route handler wiring

**`app/brand/[id]/index.tsx`** — add `handleOpenReports`:

```typescript
const handleOpenReports = (brandId: string): void => {
  router.push(`/brand/${brandId}/payments/reports` as never);
};

// Pass to BrandProfileView:
<BrandProfileView
  // ... existing props ...
  onReports={handleOpenReports}
/>
```

**`app/brand/[id]/payments/index.tsx`** — add `handleOpenReports`:

```typescript
const handleOpenReports = (): void => {
  if (brand === null) return;
  router.push(`/brand/${brand.id}/payments/reports` as never);
};

// Pass to BrandPaymentsView:
<BrandPaymentsView
  brand={brand}
  onBack={handleBack}
  onOpenOnboard={handleOpenOnboard}
  onOpenReports={handleOpenReports}
/>
```

---

## 4. Success Criteria

**AC#1** Tap J-A7 Operations row #4 "Finance reports" → navigates to `/brand/[id]/payments/reports`. (Toast removed.)

**AC#2** Tap J-A11 Export Button → navigates to `/brand/[id]/payments/reports`. (Toast removed.)

**AC#3** Reports route renders TopBar "Finance" + back arrow + download IconChrome right (visually present, inert).

**AC#4** Period switcher renders 5 buttons (7d / 30d / 90d / YTD / All) with 30d default-selected (accent.tint background + accent.border border).

**AC#5** Tap period button → state updates → headline + breakdown + top-events recompute.

**AC#6** Open `/brand/lm/payments/reports` (LM no events) → period switcher visible + empty card "No data yet" + "Finance reports populate after your first event…" + Exports section visible.

**AC#7** Open `/brand/tll/payments/reports` (TLL no events) → same empty state as LM.

**AC#8** Open `/brand/sl/payments/reports` (SL 4 events) at default 30d period → all 4 events filtered IN (heldAt within last 30d from now=2026-04-30: Slow Burn vol. 4 + Sunday Languor brunches + A Long Sit-Down upcoming + Slow Burn vol. 3 = 4 events). Headline net revenue computed. Breakdown rows render. Top events list shows all 4 sorted by revenueGbp DESC.

**AC#9** Open `/brand/sl/payments/reports` switch to 7d → only events within last 7d (Slow Burn vol. 4 = 1 event) → headline + breakdown reflect that single event.

**AC#10** Open `/brand/sl/payments/reports` switch to All → all 4 events.

**AC#11** Open `/brand/hr/payments/reports` → red "Stripe restricted — historical only" banner above period switcher + 1 event ("Hidden Rooms — Studio") visible at "All" period (or filtered by date depending on default 30d cutoff).

**AC#12** Headline net revenue formula: `gross − refunds − (gross × 2% + count × £0.30) − (gross × 1.5% + count × £0.20)`. All values formatted via lifted `formatGbp`.

**AC#13** Sparkline renders 30 bars (or fewer for short periods); last 5 bars use `accent.warm`; earlier use `rgba(255,255,255,0.16)`. When `filteredEvents.length === 0`, sparkline OMITTED entirely (no faint baseline).

**AC#14** Breakdown card 5 rows: Gross sales · Refunds (−) · Mingla fee · Stripe processing · Net to bank (last, emphasized with top border). Negative values prefixed `−`.

**AC#15** Top events ranked DESC by revenueGbp; sub-text format `{soldCount} sold · {contextLabel ?? statusLabel}`. Visually inert rows (no chevR right, no Pressable).

**AC#16** Exports section shows 3 rows: Stripe payouts CSV · Tax-ready (UK VAT) · All transactions. Each tappable (Pressable with chevR). Tap fires Toast `[TRANSITIONAL]` "{label} export lands in B2."

**AC#17** Brand-not-found state when `:id` doesn't match any brand. Same pattern as J-A11.

**AC#18** Persist v8 → v9 migration cold-launch — brands hydrate; events undefined; reports renders empty-state.

**AC#19** Web direct URL `/brand/sl/payments/reports` opens correctly.

**AC#20** TopBar download IconChrome is inert (no onPress fires).

**AC#21** `npx tsc --noEmit` exits 0. Both new routes set `backgroundColor: canvas.discover`.

**AC#22** Utility lift complete:
- `src/utils/currency.ts` exports `formatGbp` + `formatCount`
- `src/utils/relativeTime.ts` exports `formatRelativeTime` + `formatJoinedDate`
- 0 inline copies remain (grep verified)
- 4 component files import from utils

**AC#23** All `[TRANSITIONAL]` markers grep-verifiable: 3 export TOAST markers (per row in EXPORT_ROWS firing pattern) + 1 events-stub-array note in BrandFinanceReportsView header docstring + 1 hard-coded fee rates note. **2 J-A7/J-A11 markers REMOVED** ("Finance reports land in J-A12." × 2).

**AC#24** GBP formatting consistent — all currency values pass through lifted `formatGbp`. No ad-hoc `£${n}` concat anywhere in mingla-business/src or app.

**AC#25** BrandFinanceReportsView Toast mounted at View root (NOT inside ScrollView).

**AC#26** SL "30d" filter at now=2026-04-30 includes: Slow Burn vol. 4 (4d ago — IN), Sunday Languor brunches (1m ago — IN if 30d cutoff inclusive), A Long Sit-Down (15d ahead — IN since heldAt is in future ≥ cutoff), Slow Burn vol. 3 (45d ago — OUT). **Spec note:** filter logic includes events with heldAt ≥ cutoff (period covers "last N days" + future-dated events that fall within forecast window). Exact filter behavior is implementor decision; spec says "filtered" generally.

(Note: filtering future events into "last 30d" is unconventional but matches the use case — organisers want to see upcoming-event revenue alongside historical for forecasting. Alternative: exclude future events. Implementor reads §6.3.3 design intent; for Cycle 2 stub, INCLUDE future events with heldAt ≤ now + period_days. Document choice in implementation report.)

---

## 5. Invariants

| ID | Preserve / Establish |
|---|---|
| I-1 | designSystem.ts not modified |
| I-3 | iOS / Android / web all execute |
| I-4 | No `app-mobile/` imports |
| I-6 | tsc strict — explicit return types on all new code |
| I-7 | TRANSITIONAL markers labeled (3 export Toasts + events-stub note + fee-rates note) |
| I-9 | No animation timings touched |
| I-11 | Format-agnostic ID resolver (new route) |
| I-12 | Host-bg cascade (new route sets canvas.discover) |
| I-13 | Overlay-portal contract — no overlays in scope |
| DEC-071 | Frontend-first; no backend code |
| DEC-079 | Kit closure preserved — utilities are non-kit (live in src/utils/ alongside hapticFeedback.ts + responsive.ts; not new primitives) |
| DEC-080 | TopSheet untouched |
| DEC-081 | No `mingla-web/` references |
| DEC-082 | Icon set unchanged — `download` + `receipt` + `chevR` + `chart` all confirmed present |
| DEC-083 | Avatar primitive unused here |
| **Constitution #10 currency-aware (NEW enforcement)** | ALL GBP rendering goes through `formatGbp` from src/utils/currency.ts — single source of truth |

**Retired markers (from this dispatch):**
- J-A7 BrandProfileView Operations row #4: `"Finance reports land in J-A12."` Toast — REMOVED
- J-A11 BrandPaymentsView handleExport: `"Finance reports land in J-A12."` Toast — REMOVED

**New code-structural pattern:** utility-first currency/time formatting. Code comment in `src/utils/currency.ts` explicitly forbids ad-hoc `Intl.NumberFormat` calls outside the utility module.

---

## 6. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-A12-01 | J-A7 Ops row navigates | Tap "Finance reports" on /brand/lm/ | /brand/lm/payments/reports opens | Component (J-A7) + Route |
| T-A12-02 | J-A11 Export navigates | Tap Export on /brand/lm/payments | /brand/lm/payments/reports opens | Component (J-A11) + Route |
| T-A12-03 | Empty state LM | Open /brand/lm/payments/reports | Period switcher + "No data yet" card + Exports section | Component + Route |
| T-A12-04 | Empty state TLL | Open /brand/tll/payments/reports | Same as LM | Component + Route |
| T-A12-05 | Populated SL 30d default | Open /brand/sl/payments/reports | Period switcher (30d selected) + Headline net revenue + Breakdown + Top events (4 sorted) + Exports | Component |
| T-A12-06 | Period switch 7d | Tap "7d" on /brand/sl/payments/reports | Filtered to 1 event (Slow Burn vol. 4); recomputed headline + breakdown | Component |
| T-A12-07 | Period switch All | Tap "All" on /brand/sl/payments/reports | All 4 events; recomputed totals | Component |
| T-A12-08 | YTD filter | Tap "YTD" on /brand/sl/payments/reports | Events with heldAt ≥ Jan 1 of current year | Component |
| T-A12-09 | Restricted banner HR | Open /brand/hr/payments/reports | Red restricted banner above period switcher | Component |
| T-A12-10 | Top events ordering | Inspect SL top events list | Sorted DESC by revenueGbp: 8420 → 5420 → 2960 → 1920 | Component |
| T-A12-11 | Top events sub-text | Inspect "Slow Burn vol. 4" row | "284 sold · in person" | Component |
| T-A12-12 | Top events status fallback | Inspect "A Long Sit-Down" (no contextLabel) | "32 sold · upcoming" | Component |
| T-A12-13 | Breakdown last-row emphasis | Inspect Net to bank row | Top border + bold text | Component |
| T-A12-14 | Refund minus prefix | Inspect Refunds row | "−£NNN.NN" (positive amount data, render-time prefix) | Component |
| T-A12-15 | Sparkline last-5 accent | Inspect 30d sparkline | Last 5 bars accent.warm; earlier rgba(255,255,255,0.16) | Component |
| T-A12-16 | Sparkline omitted empty | Inspect /brand/lm/payments/reports | NO sparkline element | Component |
| T-A12-17 | Export Toast Stripe | Tap "Stripe payouts CSV" row | Toast "Stripe payouts CSV export lands in B2." | Component |
| T-A12-18 | Export Toast VAT | Tap "Tax-ready (UK VAT)" | Toast "Tax-ready (UK VAT) export lands in B2." | Component |
| T-A12-19 | Export Toast All | Tap "All transactions" | Toast "All transactions export lands in B2." | Component |
| T-A12-20 | Brand-not-found | Navigate to /brand/xyz/payments/reports | Not-found GlassCard + Back | Component + Route |
| T-A12-21 | Persist v8→v9 | Cold-launch with v8 state | Brands hydrate; events undefined; empty state | State migration |
| T-A12-22 | Web direct URL | Paste /brand/sl/payments/reports in browser | Renders | Route + web |
| T-A12-23 | tsc strict | `npx tsc --noEmit` | exit 0 | Build |
| T-A12-24 | Host-bg cascade | Inspect new route | canvas.discover background | Route |
| T-A12-25 | TRANSITIONAL retire | Grep "Finance reports land in J-A12" | 0 matches | Build |
| T-A12-26 | TRANSITIONAL new | Grep new files | 5 inline markers (3 export + events-stub + fee-rates) | Build |
| T-A12-27 | TopBar download inert | Tap download icon | No state change, no Toast, no navigation | Component |
| T-A12-28 | Currency utility lift | Grep `Intl\.NumberFormat.*currency: "GBP"` | Only in src/utils/currency.ts | Build |
| T-A12-29 | RelativeTime utility lift | Grep `formatRelativeTime` definition (=>) | Only in src/utils/relativeTime.ts | Build |
| T-A12-30 | 4 callers import currency | Grep imports | BrandProfileView · BrandPaymentsView · BrandFinanceReportsView all import formatGbp | Build |
| T-A12-31 | 3 callers import relativeTime | Grep imports | BrandTeamView · BrandMemberDetailView · BrandPaymentsView all import formatRelativeTime | Build |
| T-A12-32 | BrandMemberDetail formatJoinedDate | Inspect import | imports formatJoinedDate from utils | Build |
| T-A12-33 | Operations row sub stays | /brand/lm/ Ops row #4 sub | "Stripe-ready CSVs" (unchanged from J-A7) | Component |
| T-A12-34 | BrandProfileView prop chain | Inspect interface | onEdit · onTeam · onStripe · onPayments · onReports (5 props) | Build |
| T-A12-35 | Cycle-2 closure | Inspect implementation report | Summary section enumerating J-A6..J-A12 + DEC-080/082/083 + retires | Process |

---

## 7. Implementation Order

1. **Build utilities** — create `src/utils/currency.ts` + `src/utils/relativeTime.ts` per spec §3.3.
2. **tsc check** — clean.
3. **Migrate BrandProfileView** — delete inline `formatGbp` + `formatCount`; add imports from `../../utils/currency`.
4. **Migrate BrandPaymentsView** — delete inline `formatGbp` + `formatRelativeTime`; add imports from `../../utils/currency` + `../../utils/relativeTime`.
5. **Migrate BrandTeamView** — delete inline `formatRelativeTime`; add import.
6. **Migrate BrandMemberDetailView** — delete inline `formatRelativeTime` + `formatJoinedDate`; add imports.
7. **tsc check** — clean.
8. **Schema bump v8 → v9** — add `BrandEventStub` type + `events?` to Brand. Bump persist v9. Header comment update.
9. **tsc check** — clean.
10. **Stub data** — brandList.ts: add events arrays per spec §3.2.
11. **tsc check** — clean.
12. **Build BrandFinanceReportsView** — `src/components/brand/BrandFinanceReportsView.tsx` per spec §3.6. Period switcher · empty state · headline (with sparkline) · breakdown · top events · restricted banner · exports list · Toast at root. Inline `BreakdownRow` helper component. Inline sparkline data generator (deterministic).
13. **tsc check** — clean.
14. **Create reports route** — `app/brand/[id]/payments/reports.tsx` per spec §3.5.
15. **tsc check** — clean.
16. **Wire J-A7 Operations row #4** — modify BrandProfileView per spec §3.7. Add `onReports` prop · operationsRows[3].onPress navigates · interface comment updated · TRANSITIONAL Toast retired.
17. **Wire J-A11 Export Button** — modify BrandPaymentsView per spec §3.8. Add `onOpenReports` prop · handleExport navigates · TRANSITIONAL Toast retired.
18. **Wire route handlers** — `app/brand/[id]/index.tsx` (handleOpenReports) + `app/brand/[id]/payments/index.tsx` (handleOpenReports).
19. **tsc check** — clean.
20. **Grep verify** — `grep "Finance reports land in J-A12" mingla-business/src/` → 0 matches. `grep "Intl.NumberFormat.*GBP" mingla-business/src/ mingla-business/app/` → only in `src/utils/currency.ts`. `grep "formatRelativeTime = " mingla-business/src/ mingla-business/app/` → only in `src/utils/relativeTime.ts`.
21. **Implementation report** — `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_2_J_A12_FINANCE_REPORTS.md` with **Cycle-2 Closure Summary** section.

---

## 8. Regression Prevention

- **Constitution #10 single-source enforcement** — code comment in `src/utils/currency.ts`: "ALL GBP rendering across mingla-business MUST import from here. Inline `Intl.NumberFormat` for currency is forbidden post-Cycle-2." Implementor verifies post-migration grep passes (T-A12-28).
- **BrandProfileViewProps growing prop set documented** — interface comment lists all 5 navigation props (final state for Cycle 2). Cycle 3 (event creator) will add NEW props for event navigation; pattern continues.
- **Utility-lift completeness check** — grep gates in T-A12-28..32 verify no inline copies remain.
- **TRANSITIONAL marker churn** — net delta projection: +5 new (3 export Toasts + events-stub-array note + fee-rates note) − 2 retired = +3 net. Implementor verifies.
- **Persist version bump discipline** — same pattern as J-A7..J-A11.
- **Future-event filtering decision** — implementor documents the choice (include future events ≤ now+period_days OR exclude future events) in implementation report. Either is acceptable; spec doesn't lock.

---

## 9. Founder-facing UX (plain English summary)

When this lands the founder will:

- **On any brand profile:** tap **"Finance reports"** Operations row → land on the reports screen
- **On payments dashboard:** tap **"Export finance report"** Button → land on the reports screen
- **On reports screen:**
  - See period switcher: 7d / 30d / 90d / YTD / All (30d default)
  - For empty brands: "No data yet" + "Finance reports populate after your first event sells tickets."
  - For populated brands: headline showing net revenue + sparkline + breakdown (Gross / Refunds / Mingla fee / Stripe processing / Net to bank) + Top events ranked by revenue + Exports list
  - Tap any export row → Toast "{label} export lands in B2." (real CSV when Stripe is wired)
  - For restricted brands: red "Stripe restricted — historical only" banner at top + content below

**What this DOESN'T do yet:** real CSV export (B2), real per-day revenue time series (sparkline derived from event distribution), per-event drill-in (B2/Cycle 3), historical comparison delta on headline (Cycle 2 stub has no prior periods).

---

## 10. Out-of-band carve-outs

| Carry-over | Status in J-A12 |
|---|---|
| **D-INV-A10-2** formatGbp lift | ✅ ADDRESSED — lifted to src/utils/currency.ts |
| **D-INV-A10-3** formatRelativeTime + formatJoinedDate lift | ✅ ADDRESSED — lifted to src/utils/relativeTime.ts |
| **D-INV-A10-1** StatusBanner primitive | ⏸ Watch-point — still 1 use; no action |
| **D-INV-A9-3** Avatar primitive | ✅ Shipped at `c947c292` |
| **D-INV-A9-4** TextArea primitive | ⏸ Watch-point — still 2 uses; no action |
| **D-INV-A9-6** FAB primitive | ⏸ Watch-point — still 1 use; no action |
| **D-INV-A12-1..3** Sparkline / SegmentedControl / BreakdownTable | ⏸ Watch-points — first uses; promote on 3+ |
| **D-INV-A12-4** Currency CI gate | ⏸ Process improvement; track for Cycle 3+ |
| **D-INV-A12-5** Real fee rates | ❌ DEFERRED to B2 |
| **D-INV-A10-9 / D-IMPL-AVATAR-1** DEC-082 slot ambiguity | ⏸ Bookkeeping pass — can close as part of Cycle-2 wrap-up |

---

## 11. Cycle 2 Closure Summary

**This is the FINAL Cycle-2 dispatch. After J-A12 implementor closes, Cycle 2 is DONE.**

### Cycle 2 journeys completed (J-A6 through J-A12)

| Journey | Surface | Schema bump | Commit |
|---|---|---|---|
| J-A6 | Audit (no code) | — | (audit only) |
| J-A7 | View brand profile | v3 (bio + tagline + contact + links + stats.attendees) | `00c0c89f` |
| J-A8 | Edit brand profile | v4 (displayAttendeeCount) | `1fc35b73` |
| J-A8 polish | URL semantics + country picker + multi-platform social | v5 (links.tiktok/x/facebook/youtube/linkedin/threads) + v6 (contact.phoneCountryIso) | `1fc35b73` |
| J-A9 | Brand team (list / invite / role / remove) | v7 (members + pendingInvitations + 5 new types) | `e242bf59` |
| Avatar carve-out | Kit additive primitive | — | `c947c292` |
| J-A10/J-A11 | Stripe Connect onboarding shell + payments dashboard | v8 (stripeStatus + balances + payouts + refunds) | `b117c39e` |
| J-A12 | Finance reports + utility lift + 2 TRANSITIONAL retires | v9 (events) | (this dispatch) |

### Architectural decisions established

- DEC-079 (kit closure with additive carve-out protocol)
- DEC-080 (TopSheet primitive)
- DEC-082 (Icon set additive expansion — implicit; bookkeeping pass to formalize)
- DEC-083 (Avatar primitive carve-out)
- I-11 (format-agnostic ID resolver)
- I-12 (host-bg cascade)
- I-13 (overlay-portal contract)

### TRANSITIONAL markers retired across Cycle 2

| Cycle | Retired |
|---|---|
| J-A8 | J-A7 Edit CTA Toast |
| J-A9 | J-A7 Team & permissions Toast |
| J-A10/A11 | J-A7 Stripe banner Toast + J-A7 Operations row #1 Toast |
| J-A12 | J-A7 Operations row #4 Toast + J-A11 Export Toast |
| **Total retired** | **6 J-A7 Toasts + 1 J-A11 Toast** |

### What stays TRANSITIONAL after Cycle 2 closes

- 1 J-A7 Operations row #3 Toast: "Tax settings land in a later cycle." (deferred to §5.3.6 settings cycle)
- BrandEditView photo upload Toast (deferred to Cycle 14+)
- BrandEditView 300ms simulated save delay (B1)
- BrandInviteSheet 300ms simulated send (B1)
- BrandTeamView Resend Toast (B5)
- BrandMemberDetailView email-tap-to-copy Toast (Cycle 14)
- isCurrentUserSelf heuristic (B1)
- BrandPaymentsView Resolve Toast (B2)
- BrandPaymentsView inert payout/refund rows (B2)
- BrandOnboardView 1.5s simulated loading + long-press dev gesture (B2)
- BrandFinanceReportsView 3 export Toasts (B2)
- BrandFinanceReportsView events-stub-array (Cycle 3 event creator)
- BrandFinanceReportsView hard-coded fee rates (B2)

### What's next

**Cycle 3 — Event creator (mingla-business)**
- Roadmap §5 line 272: 7-step wizard + draft + publish gate
- 5 journeys (J-E1..J-E4 + J-E12)
- 48 hrs estimated
- Dependencies: J-A4 (brand creation — done in Cycle 1)

This is the wedge feature — where the app starts feeling like a real product. Cycle 3 forensics dispatch should be written by orchestrator immediately after J-A12 CLOSE protocol completes.

### Watch-points still active post-Cycle-2

- D-INV-A10-1 StatusBanner primitive (1 use)
- D-INV-A9-4 TextArea primitive (2 uses)
- D-INV-A9-6 FAB primitive (1 use)
- D-INV-A12-1 Sparkline primitive (1 use)
- D-INV-A12-2 SegmentedControl primitive (1 use)
- D-INV-A12-3 BreakdownTable primitive (1 use)
- D-INV-A12-4 Currency CI gate (process improvement)

None block Cycle 3. All promoted on 3+ uses per DEC-079 protocol.

---

## 12. Dispatch hand-off

Implementor dispatch shall reference both:
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A12.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-2-J-A12_FINANCE_REPORTS.md` (this file)

Implementor follows §7 implementation order verbatim. Tester (or operator smoke) verifies T-A12-01 through T-A12-35 inclusive. **Top 5 must-test scenarios:**
- T-A12-05 (SL populated dashboard at 30d default)
- T-A12-06 (period switch 7d filters down)
- T-A12-09 (HR restricted banner)
- T-A12-17 (export Toast)
- T-A12-21 (persist v8→v9 cold launch)

**Implementation report MUST include:** `Cycle-2 Closure Summary` section enumerating all journeys + schema bumps + DECs + retires + watch-points + Cycle-3 announcement. This report is the canonical Cycle-2 closure evidence — orchestrator references it when announcing Cycle 3 forensics.

---

**End of J-A12 + Cycle-2 polish bundle spec.**
