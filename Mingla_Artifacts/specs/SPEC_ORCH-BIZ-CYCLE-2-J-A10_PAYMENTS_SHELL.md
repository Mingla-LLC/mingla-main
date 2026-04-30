# Spec — J-A10 + J-A11: Stripe Connect Onboarding Shell + View Brand Payments

> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A10
> **Cycle:** 2 — Brands
> **Codebase:** `mingla-business/` (mobile-first; web parity gated to Cycle 6/7 per DEC-071)
> **Predecessor investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A10.md`
> **Predecessor commit:** `c947c292` (Avatar carve-out CLOSE)
> **Authoritative design:** `HANDOFF_BUSINESS_DESIGNER.md` §5.3.7 (line 1850), §5.3.8 (line 1857), §6.3.3 (lines 3045-3071)
> **Spec writer turn:** 2026-04-30
> **Status:** locked

---

## 1. Scope

### 1.1 In scope

- **Routes (NEW):**
  - `mingla-business/app/brand/[id]/payments/index.tsx` — dashboard
  - `mingla-business/app/brand/[id]/payments/onboard.tsx` — onboarding shell
- **Components (NEW):**
  - `mingla-business/src/components/brand/BrandPaymentsView.tsx`
  - `mingla-business/src/components/brand/BrandOnboardView.tsx`
- **Schema (MOD):** `mingla-business/src/store/currentBrandStore.ts` — Brand v7 → v8 + new types
- **Stub data (MOD):** `mingla-business/src/store/brandList.ts` — all 4 brands gain Stripe state + payouts/refunds spread
- **J-A7 wiring (MOD):** `mingla-business/src/components/brand/BrandProfileView.tsx` — add `onStripe` + `onPayments` props · banner status awareness · Operations row #1 dynamic sub-text · 2 TRANSITIONAL Toasts removed
- **Route wiring (MOD):** `mingla-business/app/brand/[id]/index.tsx` — pass `onStripe` + `onPayments` handlers

### 1.2 Out of scope (hard non-goals)

- ❌ Real Stripe Connect API integration (B2 backend cycle)
- ❌ Stripe Payment Element / Connect.js embedded panel (web parity Cycle 6/7)
- ❌ `/brand/:id/payments/onboard/return` deep-link route (B2)
- ❌ Real WebView opening to a real URL (Cycle 2 = placeholder content only)
- ❌ J-A12 finance reports detail screen
- ❌ Per-row payout/refund detail views
- ❌ Push notifications for Stripe verification (B5 marketing infrastructure)
- ❌ "Resolve" deep-link to real Stripe dashboard (B2)
- ❌ Country support / KYC document upload / identity verification branches (B2)
- ❌ Multi-brand Stripe routing decisions (Q5 in BUSINESS_STRATEGIC_PLAN — B2)
- ❌ Real onboarding state advancement past `onboarding` (Cycle 2 stub cannot reach `active` via the flow; only via pre-seeded data)
- ❌ Backend code (DEC-071)
- ❌ New kit primitives (DEC-079; StatusBanner / formatGbp / formatRelativeTime watch-points logged but not lifted)

### 1.3 Assumptions

- Avatar carve-out shipped at `c947c292` (DEC-083)
- J-A9 brand team baseline shipped at `e242bf59`
- Brand v7 schema is the latest persisted version (`mingla-business.currentBrand.v7`)
- `useLocalSearchParams<{id: string | string[]}>()` returns string segment on all 3 platforms
- AsyncStorage persistence works on web via Cycle 0b WEB3 fixes
- KpiTile primitive supports `value: string | number` + `sub` + omitting `delta`/`deltaUp`

---

## 2. Authoritative design source

**§5.3.7 Brand payments dashboard** (line 1850-1855):
> **Mobile:** vertical: Stripe banner (Action required / Active / Restricted) · KPI tiles (Available balance, Pending balance, Last payout) · Recent payouts list · Recent refunds list · "Export finance report" CTA.
> **States:** stripe-not-connected (banner + Connect Stripe CTA dominates) · onboarding-incomplete (banner + "Finish onboarding" CTA) · active · restricted (red banner with reason + "Resolve" CTA linking to Stripe dashboard).

**§5.3.8 Stripe Connect onboarding** (line 1857-1862):
> **Mobile:** WebView taking full screen with native top bar (Cancel left, "Stripe onboarding" title).
> **States:** loading · in-progress · complete · failed (with retry).

**§6.3.3 Sara onboards Stripe** (line 3045-3071):
> Tap Connect → /payments/onboard → WebView loads → Stripe asks for details → "Submitted — we'll email you when verified" → tap Done → returns to /payments with banner now "Onboarding submitted — verifying" → push notification "Stripe ready" → banner now "Stripe active" + KPI tiles populated.

**§7 copy bank** (per Designer Handoff):
- Connect banner: "Connect Stripe to sell tickets"
- Onboarding banner: "Onboarding submitted — verifying"
- Restricted banner: "Action required — your account is limited"
- Onboarding done: "Stripe onboarding submitted. We'll email you when verified."
- Failed: "Onboarding couldn't complete. Try again or contact support."

**For Cycle 2 stub:**
- Real Stripe deferred → onboarding shell shows placeholder copy "Stripe onboarding lands when we wire it up. For now this is a preview of where it will appear." with 1.5s simulated loading state.
- "Resolve" CTA (restricted banner) → TRANSITIONAL Toast.
- "Email when verified" / push notifications → not exercised; smoke uses pre-seeded `active` brand.

---

## 3. Layer specifications

### 3.1 Schema layer (Brand v7 → v8)

**File:** `mingla-business/src/store/currentBrandStore.ts`

**New types:**

```typescript
/**
 * Brand's Stripe Connect state. NEW in J-A10 schema v8.
 *
 * - not_connected: brand has not started Stripe Connect onboarding
 * - onboarding: submitted but Stripe is verifying (KYC in progress)
 * - active: fully verified, can sell tickets and receive payouts
 * - restricted: Stripe has flagged the account; payouts paused until resolved
 *
 * Per Designer Handoff §5.3.7 + §6.3.3.
 */
export type BrandStripeStatus =
  | "not_connected"
  | "onboarding"
  | "active"
  | "restricted";

/** Payout status. NEW in J-A10 schema v8. */
export type BrandPayoutStatus = "paid" | "in_transit" | "failed";

export interface BrandPayout {
  id: string;
  /** Amount in GBP, positive number. */
  amountGbp: number;
  currency: "GBP";
  status: BrandPayoutStatus;
  /** ISO 8601 timestamp when funds arrived (for "paid") or expected (for "in_transit"). */
  arrivedAt: string;
}

export interface BrandRefund {
  id: string;
  /** Amount in GBP, positive number (the refund value, not negative). */
  amountGbp: number;
  currency: "GBP";
  /** Display title of the event the refund relates to. */
  eventTitle: string;
  /** ISO 8601 timestamp when the refund processed. */
  refundedAt: string;
  /** Optional human-readable reason. Surfaces in row sub-text. */
  reason?: string;
}
```

**Extend Brand type:**

```typescript
export type Brand = {
  // ... v7 fields unchanged ...
  /**
   * Stripe Connect status. NEW in J-A10 schema v8. Undefined treated as
   * `"not_connected"` at read sites.
   */
  stripeStatus?: BrandStripeStatus;
  /**
   * Available balance (clears for next payout) in GBP minor units would be
   * cleaner long-term, but Cycle 2 stub uses GBP whole-units (number) for
   * simplicity. NEW in J-A10 schema v8. Undefined treated as 0.
   */
  availableBalanceGbp?: number;
  /**
   * Pending balance (Stripe escrow window before clearing). NEW in J-A10
   * schema v8. Undefined treated as 0.
   */
  pendingBalanceGbp?: number;
  /**
   * ISO 8601 timestamp of the most recent payout. NEW in J-A10 schema v8.
   * Undefined when no payouts have occurred. Drives the "Last payout" KPI
   * tile sub-text.
   */
  lastPayoutAt?: string;
  /**
   * Recent payouts. NEW in J-A10 schema v8. Undefined treated as `[]`.
   * Sorted newest-first by arrivedAt at render time.
   */
  payouts?: BrandPayout[];
  /**
   * Recent refunds. NEW in J-A10 schema v8. Undefined treated as `[]`.
   * Sorted newest-first by refundedAt at render time.
   */
  refunds?: BrandRefund[];
};
```

**Persist version bump:**
- `persistOptions.name` → `"mingla-business.currentBrand.v8"`
- `version: 8`
- Migration: passthrough for `version >= 3` (extends existing v3→v8 chain).

```typescript
// v7 → v8: passthrough. New optional `stripeStatus`, balances, lastPayoutAt,
// payouts, refunds fields start undefined; default to sensible read-site
// values (not_connected / 0 / [] / undefined-string).
return persistedState as PersistedState;
```

**Header comment update:** extend schema-version history with v8 entry.

### 3.2 Stub data layer

**File:** `mingla-business/src/store/brandList.ts`

Each of 4 STUB_BRANDS gets stripe state + payouts/refunds. **Coverage spread:**

```typescript
// Lonely Moth — not_connected (drives J-A7 banner)
stripeStatus: "not_connected",
availableBalanceGbp: 0,
pendingBalanceGbp: 0,
lastPayoutAt: undefined,
payouts: [],
refunds: [],

// The Long Lunch — onboarding (just submitted)
stripeStatus: "onboarding",
availableBalanceGbp: 0,
pendingBalanceGbp: 0,
lastPayoutAt: undefined,
payouts: [],
refunds: [],

// Sunday Languor — active (full populated)
stripeStatus: "active",
availableBalanceGbp: 156.20,
pendingBalanceGbp: 45.60,
lastPayoutAt: "2026-04-27T10:00:00Z",
payouts: [
  { id: "p_sl_4", amountGbp: 156.20, currency: "GBP", status: "in_transit", arrivedAt: "2026-05-01T10:00:00Z" },
  { id: "p_sl_3", amountGbp: 482.50, currency: "GBP", status: "paid", arrivedAt: "2026-04-27T10:00:00Z" },
  { id: "p_sl_2", amountGbp: 312.80, currency: "GBP", status: "paid", arrivedAt: "2026-04-20T10:00:00Z" },
  { id: "p_sl_1", amountGbp: 198.40, currency: "GBP", status: "paid", arrivedAt: "2026-04-13T10:00:00Z" },
],
refunds: [
  { id: "r_sl_2", amountGbp: 24.00, currency: "GBP", eventTitle: "Slow Burn vol. 4", refundedAt: "2026-04-25T15:30:00Z", reason: "Couldn't make it" },
  { id: "r_sl_1", amountGbp: 48.00, currency: "GBP", eventTitle: "Slow Burn vol. 3", refundedAt: "2026-04-22T11:00:00Z" },
],

// Hidden Rooms — restricted (historical data preserved; balances frozen)
stripeStatus: "restricted",
availableBalanceGbp: 0,
pendingBalanceGbp: 0,
lastPayoutAt: "2026-04-09T10:00:00Z",
payouts: [
  { id: "p_hr_1", amountGbp: 88.00, currency: "GBP", status: "paid", arrivedAt: "2026-04-09T10:00:00Z" },
],
refunds: [],
```

**Header comment update:** append v8 entry noting stripe + payouts/refunds spread.

### 3.3 Route layer — Dashboard (NEW)

**File:** `mingla-business/app/brand/[id]/payments/index.tsx`

```typescript
import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandPaymentsView } from "../../../../src/components/brand/BrandPaymentsView";
import { canvas } from "../../../../src/constants/designSystem";
import { useBrandList } from "../../../../src/store/currentBrandStore";

export default function BrandPaymentsRoute(): React.ReactElement {
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
    } else {
      router.replace("/(tabs)/account" as never);
    }
  };

  const handleOpenOnboard = (): void => {
    if (brand === null) return;
    router.push(`/brand/${brand.id}/payments/onboard` as never);
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover, // I-12
      }}
    >
      <BrandPaymentsView
        brand={brand}
        onBack={handleBack}
        onOpenOnboard={handleOpenOnboard}
      />
    </View>
  );
}
```

### 3.4 Route layer — Onboarding shell (NEW)

**File:** `mingla-business/app/brand/[id]/payments/onboard.tsx`

```typescript
import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandOnboardView } from "../../../../src/components/brand/BrandOnboardView";
import { canvas } from "../../../../src/constants/designSystem";
import {
  useBrandList,
  useCurrentBrandStore,
  type Brand,
} from "../../../../src/store/currentBrandStore";

export default function BrandOnboardRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
  const setBrands = useCurrentBrandStore((s) => s.setBrands);
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrandStore((s) => s.currentBrand);
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

  const handleAfterDone = (): void => {
    if (brand === null) {
      handleBack();
      return;
    }
    // Stub flow: any onboarding completion advances stripeStatus to
    // "onboarding" (not "active" — only B2 + real Stripe webhooks can
    // advance to active). Smoke uses pre-seeded "active" brand to
    // exercise the active state.
    const next: Brand = { ...brand, stripeStatus: "onboarding" };
    setBrands(brands.map((b) => (b.id === next.id ? next : b)));
    if (currentBrand !== null && currentBrand.id === next.id) {
      setCurrentBrand(next);
    }
    handleBack();
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover, // I-12
      }}
    >
      <BrandOnboardView
        brand={brand}
        onCancel={handleBack}
        onAfterDone={handleAfterDone}
      />
    </View>
  );
}
```

### 3.5 Component — BrandPaymentsView (NEW)

**File:** `mingla-business/src/components/brand/BrandPaymentsView.tsx`

**Props:**

```typescript
export interface BrandPaymentsViewProps {
  brand: Brand | null;
  onBack: () => void;
  /** Called when user taps Connect/Finish/Resolve banner CTA — routes to onboarding shell. */
  onOpenOnboard: () => void;
}
```

**Layout:**

- **TopBar:** `leftKind="back"` + title `"Payments"` + onBack=`onBack` + `rightSlot={<View />}`
- **Not-found state** when `brand === null`: same pattern as J-A7/A8/A9.
- **Populated state:** ScrollView with sections in this order:

#### Section A — Status Banner (per stripeStatus)

Inline composition. Status-driven copy/icon/color/CTA table:

```typescript
const stripeStatus = brand.stripeStatus ?? "not_connected";

interface BannerConfig {
  visible: boolean;
  icon: IconName;
  iconColor: string;
  title: string;
  sub: string;
  ctaLabel?: string;
  ctaVariant: "primary" | "destructive";
  destructiveBorder: boolean;
  /** When tapped, fires onCtaPress. */
  ctaAction: "open_onboard" | "resolve_toast";
}

const BANNER_CONFIG: Record<BrandStripeStatus, BannerConfig> = {
  not_connected: {
    visible: true,
    icon: "bank",
    iconColor: accent.warm,
    title: "Connect Stripe to sell tickets",
    sub: "Get paid for your events. Setup takes 5 minutes.",
    ctaLabel: "Connect Stripe",
    ctaVariant: "primary",
    destructiveBorder: false,
    ctaAction: "open_onboard",
  },
  onboarding: {
    visible: true,
    icon: "bank",
    iconColor: accent.warm,
    title: "Onboarding submitted — verifying",
    sub: "Stripe is reviewing your details. We'll email you when verified.",
    ctaLabel: "Finish onboarding",
    ctaVariant: "primary",
    destructiveBorder: false,
    ctaAction: "open_onboard",
  },
  active: {
    visible: false, // Suppressed entirely — KPIs + lists are the affirmative state
    icon: "bank",
    iconColor: accent.warm,
    title: "",
    sub: "",
    ctaVariant: "primary",
    destructiveBorder: false,
    ctaAction: "open_onboard",
  },
  restricted: {
    visible: true,
    icon: "alert", // verify icon name; if not present, use "info"
    iconColor: semantic.error,
    title: "Action required — your account is limited",
    sub: "Stripe needs additional information before you can sell tickets.",
    ctaLabel: "Resolve",
    ctaVariant: "destructive",
    destructiveBorder: true,
    ctaAction: "resolve_toast",
  },
};
```

**IMPORTANT — Icon verification:** If `"alert"` is not in the kit Icon set, implementor uses `"info"` (verified present). Banner color emphasis comes from border + icon color, not from any new icon.

Render layout (when `visible: true`):

```tsx
<GlassCard
  variant="base"
  padding={spacing.md}
  style={config.destructiveBorder ? styles.bannerDestructive : undefined}
>
  <View style={styles.bannerRow}>
    <View style={[styles.bannerIconWrap, config.destructiveBorder && styles.bannerIconWrapDestructive]}>
      <Icon name={config.icon} size={20} color={config.iconColor} />
    </View>
    <View style={styles.bannerTextCol}>
      <Text style={styles.bannerTitle}>{config.title}</Text>
      <Text style={styles.bannerSub}>{config.sub}</Text>
    </View>
  </View>
  {config.ctaLabel !== undefined ? (
    <View style={styles.bannerCtaRow}>
      <Button
        label={config.ctaLabel}
        onPress={config.ctaAction === "open_onboard" ? onOpenOnboard : handleResolveToast}
        variant={config.ctaVariant}
        size="md"
        fullWidth
      />
    </View>
  ) : null}
</GlassCard>
```

#### Section B — KPI Tiles (3-col)

Skip when `brand.stripeStatus !== "active"`? Or always render? **Spec decision:** ALWAYS render the KPI section. Non-active brands see £0/£0/— values, which is the honest state. Affirmative empty matches J-A7's "Recent events" empty pattern.

```typescript
const formatGbp = (value: number): string =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(value);

const lastPayoutDisplay = brand.lastPayoutAt !== undefined
  ? formatGbp(brand.payouts?.[0]?.amountGbp ?? 0)
  : "—";

const lastPayoutSub = brand.lastPayoutAt !== undefined
  ? formatRelativeTime(brand.lastPayoutAt)
  : "No payouts yet";
```

```tsx
<View style={styles.kpisRow}>
  <KpiTile
    label="Available"
    value={formatGbp(brand.availableBalanceGbp ?? 0)}
    sub="Ready to pay out"
    style={styles.kpiCell}
  />
  <KpiTile
    label="Pending"
    value={formatGbp(brand.pendingBalanceGbp ?? 0)}
    sub="In Stripe escrow"
    style={styles.kpiCell}
  />
  <KpiTile
    label="Last payout"
    value={lastPayoutDisplay}
    sub={lastPayoutSub}
    style={styles.kpiCell}
  />
</View>
```

#### Section C — Recent Payouts

Section header "RECENT PAYOUTS" + GlassCard variant="base" padding=0 with rows. Empty state: GlassCard with "No payouts yet" + body "Payouts arrive here once you start selling tickets." Tappable rows are NOT in scope (visually inert per O-A10-5).

Row layout:
- Left: status icon + amount (formatted GBP, 600 weight)
- Middle: status pill + relative-time label
- (No chevron right — row is inert)

```tsx
const renderPayoutRow = (payout: BrandPayout, index: number, isLast: boolean): React.ReactNode => (
  <View key={payout.id} style={[styles.txnRow, !isLast && styles.txnRowDivider]}>
    <View style={styles.txnLeftCol}>
      <Text style={styles.txnAmount}>{formatGbp(payout.amountGbp)}</Text>
      <Text style={styles.txnSub}>
        {payout.status === "in_transit" ? "In transit" : `Paid ${formatRelativeTime(payout.arrivedAt)}`}
      </Text>
    </View>
    <Pill variant={payout.status === "paid" ? "live" : payout.status === "in_transit" ? "info" : "error"}>
      {payout.status.toUpperCase()}
    </Pill>
  </View>
);
```

(Verify Pill variant `"live"` is appropriate for paid; otherwise `"info"`.)

#### Section D — Recent Refunds

Section header "RECENT REFUNDS". Same row pattern as payouts. Empty state: NO header rendered (skip section entirely if `refunds.length === 0`).

Row layout:
- Amount (formatted GBP, prefixed with `−`) + event title (bodySm secondary)
- "Refunded {relative time} · {reason if present}"

#### Section E — Export CTA

```tsx
<Button
  label="Export finance report"
  onPress={handleExport}
  variant="secondary"
  size="md"
  leadingIcon="chart"
  fullWidth
/>
```

`handleExport`: `[TRANSITIONAL]` Toast "Finance reports land in J-A12."

#### Toast mount

Bottom-mounted Toast (same pattern as other Cycle-2 views) for:
- Resolve banner CTA (restricted state) — TRANSITIONAL "Stripe support lands in B2."
- Export CTA — TRANSITIONAL "Finance reports land in J-A12."

### 3.6 Component — BrandOnboardView (NEW)

**File:** `mingla-business/src/components/brand/BrandOnboardView.tsx`

**Props:**

```typescript
export interface BrandOnboardViewProps {
  brand: Brand | null;
  onCancel: () => void;
  onAfterDone: () => void;
}
```

**State machine:**

```typescript
type OnboardingState = "loading" | "complete" | "failed";

const SIMULATED_LOADING_MS = 1500;

const [state, setState] = useState<OnboardingState>("loading");

useEffect(() => {
  if (state !== "loading") return;
  const timer = setTimeout(() => {
    setState("complete");
  }, SIMULATED_LOADING_MS);
  return (): void => clearTimeout(timer);
}, [state]);
```

**Long-press dev gesture (per H-A10-4 / O-A10-8):**

```typescript
// [TRANSITIONAL] dev gesture for QA — long-press the header to flip into
// the failed state. Exit when B2 wires real Stripe SDK that fails naturally.
const handleHeaderLongPress = (): void => {
  setState((prev) => (prev === "failed" ? "loading" : "failed"));
};
```

**Layout:**

- **TopBar (custom):** Pressable on the left ("Cancel" text Button — variant="ghost", size="sm") + centered Pressable wrapping `<Text>Stripe onboarding</Text>` (long-press fires `handleHeaderLongPress`) + empty rightSlot.
- **Body (full-screen, centered content):**
  - **Loading state:** Centered `Spinner` (size 48) + Text "Loading Stripe onboarding…" + sub "[TRANSITIONAL] This will be a real WebView in B2."
  - **Complete state:** Centered Icon (e.g., `check` in 64px accent.warm circle) + Text h2 "Onboarding submitted" + body "Stripe is verifying your details. We'll email you when ready." + Button "Done" (primary, fullWidth) → calls `onAfterDone`
  - **Failed state:** Centered Icon (`alert` in 64px semantic.error circle, OR `info` if `alert` absent) + Text h2 "Onboarding couldn't complete" + body "Try again or contact support." + Button "Try again" (primary, fullWidth) → setState("loading") (re-enters the simulated flow) + Button "Cancel" (secondary, fullWidth) → onCancel

(Spinner primitive: verify exists in kit. If not, use ActivityIndicator from RN.)

### 3.7 J-A7 wiring (BrandProfileView modification)

**File:** `mingla-business/src/components/brand/BrandProfileView.tsx`

**Add 2 props:**

```typescript
export interface BrandProfileViewProps {
  brand: Brand | null;
  onBack: () => void;
  onEdit: (brandId: string) => void;
  onTeam: (brandId: string) => void;
  /**
   * Called when user taps the Stripe banner (any state). Receives brand id.
   * NEW in J-A10. Pattern continues onEdit (J-A8) + onTeam (J-A9).
   */
  onStripe: (brandId: string) => void;
  /**
   * Called when user taps the "Payments & Stripe" Operations row.
   * Receives brand id. NEW in J-A10. Pattern continues onEdit + onTeam.
   */
  onPayments: (brandId: string) => void;
}
```

**Banner suppression + status awareness:**

```typescript
// Banner block (replace existing always-on banner with status-driven render):
const stripeStatus = brand.stripeStatus ?? "not_connected";

const J_A7_BANNER_COPY: Record<BrandStripeStatus, { title: string; sub: string } | null> = {
  not_connected: {
    title: "Connect Stripe to sell tickets",
    sub: "Get paid for your events. Setup takes 5 minutes.",
  },
  onboarding: {
    title: "Onboarding submitted — verifying",
    sub: "We'll email you when Stripe finishes verifying your details.",
  },
  active: null, // suppress
  restricted: {
    title: "Action required",
    sub: "Stripe has limited your account. Tap to resolve.",
  },
};

const bannerCopy = J_A7_BANNER_COPY[stripeStatus];

{bannerCopy !== null ? (
  <Pressable
    onPress={handleStripeBanner}
    accessibilityRole="button"
    accessibilityLabel={bannerCopy.title}
  >
    <GlassCard
      variant="base"
      padding={spacing.md}
      style={stripeStatus === "restricted" ? styles.bannerDestructive : undefined}
    >
      <View style={styles.bannerRow}>
        <View style={styles.bannerIconWrap}>
          <Icon
            name="bank"
            size={20}
            color={stripeStatus === "restricted" ? semantic.error : accent.warm}
          />
        </View>
        <View style={styles.bannerTextCol}>
          <Text style={styles.bannerTitle}>{bannerCopy.title}</Text>
          <Text style={styles.bannerSub}>{bannerCopy.sub}</Text>
        </View>
        <Icon name="chevR" size={16} color={textTokens.tertiary} />
      </View>
    </GlassCard>
  </Pressable>
) : null}
```

**handleStripeBanner navigates instead of Toast:**

```typescript
// Before (J-A7):
// const handleStripeBanner = useCallback(() => fireToast("Stripe Connect lands in J-A10."), [fireToast]);

// After (J-A10):
const handleStripeBanner = useCallback((): void => {
  if (brand !== null) onStripe(brand.id);
}, [brand, onStripe]);
```

**Operations row #1 dynamic sub-text + onPress:**

```typescript
const OPERATIONS_SUB_TEXT: Record<BrandStripeStatus, string> = {
  not_connected: "Not connected",
  onboarding: "Onboarding…",
  active: "Active",
  restricted: "Action required",
};

// Inside operationsRows useMemo:
{
  icon: "bank",
  label: "Payments & Stripe",
  sub: OPERATIONS_SUB_TEXT[stripeStatus],
  onPress: () => brand !== null && onPayments(brand.id),
},
```

**Remove TRANSITIONAL markers:**
- `// [TRANSITIONAL] Stripe banner — exit when Brand.stripeStatus field lands (J-A10).` — DELETE
- `{/* [TRANSITIONAL] always-on banner — replaced by stripe-state-driven banner in J-A10. */}` — DELETE

### 3.8 Route wiring (BrandProfileRoute modification)

**File:** `mingla-business/app/brand/[id]/index.tsx`

```typescript
const handleOpenStripe = (brandId: string): void => {
  router.push(`/brand/${brandId}/payments` as never);
};

const handleOpenPayments = (brandId: string): void => {
  router.push(`/brand/${brandId}/payments` as never);
};

return (
  <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}>
    <BrandProfileView
      brand={brand}
      onBack={handleBack}
      onEdit={handleOpenEdit}
      onTeam={handleOpenTeam}
      onStripe={handleOpenStripe}
      onPayments={handleOpenPayments}
    />
  </View>
);
```

(Both handlers go to `/payments` dashboard — banner taps inside dashboard handle onboarding routing per H-A10-2 recommendation.)

---

## 4. Success Criteria

**AC#1** Tap J-A7 Stripe banner (any visible state) → navigates to `/brand/[id]/payments`. (Toast removed.)

**AC#2** Tap J-A7 Operations row "Payments & Stripe" → navigates to `/brand/[id]/payments`. (Toast removed.)

**AC#3** J-A7 Operations row sub-text reflects stripeStatus: "Not connected" / "Onboarding…" / "Active" / "Action required".

**AC#4** J-A7 Stripe banner SUPPRESSED when stripeStatus = `active`. No banner element rendered, no leftover spacing.

**AC#5** J-A7 Stripe banner uses `semantic.error` border tint when stripeStatus = `restricted`.

**AC#6** Open `/brand/lm/payments` (not_connected): banner "Connect Stripe to sell tickets" + Connect Stripe Button + 3 KPI tiles all £0.00 / £0.00 / "—" + Recent payouts empty card + (no refunds section header) + Export Button.

**AC#7** Open `/brand/tll/payments` (onboarding): banner "Onboarding submitted — verifying" + Finish onboarding Button + 3 KPI tiles all £0.00 / £0.00 / "—" + (no payouts/refunds sections) + Export Button.

**AC#8** Open `/brand/sl/payments` (active): NO banner + 3 KPI tiles £156.20 / £45.60 / £156.20 (latest payout amount) with "3d ago" sub + Recent payouts list (4 rows: in_transit, paid 3d ago, paid 10d ago, paid 2w ago) + Recent refunds list (2 rows: £24.00 with reason, £48.00 without) + Export Button.

**AC#9** Open `/brand/hr/payments` (restricted): red-bordered banner "Action required" + Resolve Button (destructive variant) + 3 KPI tiles £0.00 / £0.00 / £88.00 with "21d ago" sub + Recent payouts list (1 row) + (no refunds section) + Export Button.

**AC#10** Tap Connect Stripe / Finish onboarding (banner CTA when not_connected or onboarding) → navigates to `/brand/[id]/payments/onboard`.

**AC#11** Tap Resolve (banner CTA when restricted) → Toast "Stripe support lands in B2." NO navigation.

**AC#12** Tap Export finance report → Toast "Finance reports land in J-A12." NO navigation.

**AC#13** Onboarding shell loading state — Spinner centered + "Loading Stripe onboarding…" copy. Auto-advances to "complete" after 1.5s.

**AC#14** Onboarding shell complete state — check icon + "Onboarding submitted" + "Stripe is verifying your details…" + Done Button.

**AC#15** Tap Done on complete state — brand.stripeStatus mutates to "onboarding" (if was not_connected or restricted) → navigates back to `/brand/[id]/payments` → dashboard re-renders with onboarding banner.

**AC#16** Long-press "Stripe onboarding" header → state flips to "failed". Failed state shows alert/info icon + "Onboarding couldn't complete" + Try again Button + Cancel Button.

**AC#17** Tap Try again on failed state → state returns to "loading"; auto-advances to complete.

**AC#18** Tap Cancel on failed state OR Cancel button on top-bar (any state) → returns to dashboard via router.back. NO state mutation.

**AC#19** Brand-not-found state when `:id` doesn't match any brand on either route — same pattern as J-A7/A8/A9.

**AC#20** Persist v7 → v8 migration cold-launch — app opens without crash; v7 brands hydrate with stripeStatus undefined, treated as "not_connected" at read sites; J-A7 banner shows.

**AC#21** Web direct URL `/brand/sl/payments` and `/brand/lm/payments/onboard` open correctly.

**AC#22** TopBar on dashboard: title "Payments" + back arrow. TopBar on onboarding: Cancel left + "Stripe onboarding" centered (long-pressable) + empty right.

**AC#23** `npx tsc --noEmit` exits 0. No `any`, no `@ts-ignore`. Both new routes have `backgroundColor: canvas.discover` (I-12).

**AC#24** All `[TRANSITIONAL]` markers grep-verifiable: 1.5s simulated loading delay (BrandOnboardView), long-press failed dev gesture (BrandOnboardView), Resolve Toast (BrandPaymentsView), Export Toast (BrandPaymentsView), inert payout/refund rows (BrandPaymentsView). 2 J-A7 markers REMOVED (Stripe banner Toast + Operations row #1 Toast).

**AC#25** GBP formatting consistent — all currency values pass through `Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 })`. £156.20 not £156.2.

**AC#26** Relative-time formatting consistent — payouts/refunds rows + Last payout sub use the same relative-time output as J-A9 (e.g., "3d ago", "21d ago"). For "in_transit" payout, sub reads "In transit" instead.

**AC#27** Refund row prefix — refund amount in row visually prefixed with `−` (minus sign) to denote outflow. e.g., "−£24.00".

**AC#28** Empty-payouts state — when `brand.payouts.length === 0`, render GlassCard with "No payouts yet" / "Payouts arrive here once you start selling tickets." copy. Refunds section: HEADER + CARD entirely skipped (not even an empty card).

---

## 5. Invariants

| ID | Preserve / Establish |
|---|---|
| I-1 | designSystem.ts not modified |
| I-3 | iOS / Android / web all execute |
| I-4 | No `app-mobile/` imports |
| I-6 | tsc strict — explicit return types on all new components and inline helpers |
| I-7 | TRANSITIONAL markers labeled (1.5s delay · long-press dev gesture · Resolve Toast · Export Toast · inert rows) |
| I-9 | No animation timings touched |
| I-11 | Format-agnostic ID resolver (both new routes) |
| I-12 | Host-bg cascade (both new routes set canvas.discover) |
| I-13 | Overlay-portal contract (no Sheets in scope; ConfirmDialog not exercised here) |
| DEC-071 | Frontend-first; no backend code |
| DEC-079 | Kit closure preserved (StatusBanner / formatGbp / formatRelativeTime composed inline; watch-points D-INV-A10-1..3 logged) |
| DEC-080 | TopSheet untouched |
| DEC-081 | No `mingla-web/` references |
| DEC-082 | Icon set unchanged — `bank`, `chart`, `chevR`, `arrowL`, `check` already present (verify `alert` or fallback to `info`) |
| DEC-083 | Avatar primitive unused here |

**Retired markers (J-A7):**
- `[TRANSITIONAL] Stripe banner` (handleStripeBanner closure) — REMOVED
- `[TRANSITIONAL] always-on banner` (JSX comment) — REMOVED
- TRANSITIONAL Toast on Operations row #1 — Toast string literal removed (entire `() => fireToast(...)` replaced with `() => onPayments(brand.id)`)

**New code-structural pattern:** Status-driven banner config record (`Record<BrandStripeStatus, BannerConfig>`) — clean abstraction; if a 3rd status-driven banner pattern emerges, lift the pattern to a kit `StatusBanner` primitive (D-INV-A10-1).

---

## 6. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-A10-01 | J-A7 banner navigates | Tap Stripe banner on /brand/lm/ | /brand/lm/payments opens; no Toast | Component (J-A7) + Route |
| T-A10-02 | J-A7 Operations row navigates | Tap "Payments & Stripe" Ops row on /brand/lm/ | /brand/lm/payments opens; no Toast | Component (J-A7) + Route |
| T-A10-03 | Operations sub-text not_connected | Inspect Ops row #1 sub on /brand/lm/ | "Not connected" | Component |
| T-A10-04 | Operations sub-text onboarding | Inspect Ops row #1 sub on /brand/tll/ | "Onboarding…" | Component |
| T-A10-05 | Operations sub-text active | Inspect Ops row #1 sub on /brand/sl/ | "Active" | Component |
| T-A10-06 | Operations sub-text restricted | Inspect Ops row #1 sub on /brand/hr/ | "Action required" | Component |
| T-A10-07 | J-A7 banner suppression | Open /brand/sl/ (active) | NO banner element | Component |
| T-A10-08 | J-A7 banner restricted variant | Open /brand/hr/ | Red-bordered banner with "Action required" | Component |
| T-A10-09 | Dashboard not_connected layout | Open /brand/lm/payments | Connect banner + 3 KPIs (£0/£0/—) + empty payouts + no refunds + Export | Component + Route |
| T-A10-10 | Dashboard onboarding layout | Open /brand/tll/payments | Onboarding banner + 3 KPIs all empty + no payouts/refunds sections + Export | Component + Route |
| T-A10-11 | Dashboard active layout | Open /brand/sl/payments | NO banner + 3 KPIs (£156.20/£45.60/£156.20) + 4 payouts + 2 refunds + Export | Component + Route |
| T-A10-12 | Dashboard restricted layout | Open /brand/hr/payments | Red Action Required banner + 3 KPIs (£0/£0/£88.00) + 1 payout + no refunds + Export | Component + Route |
| T-A10-13 | Connect CTA navigates | Tap Connect on /brand/lm/payments | /brand/lm/payments/onboard opens | Component + Route |
| T-A10-14 | Finish CTA navigates | Tap Finish on /brand/tll/payments | /brand/tll/payments/onboard opens | Component + Route |
| T-A10-15 | Resolve Toast | Tap Resolve on /brand/hr/payments | Toast "Stripe support lands in B2."; no navigation | Component |
| T-A10-16 | Export Toast | Tap Export on any payments dashboard | Toast "Finance reports land in J-A12." | Component |
| T-A10-17 | Onboarding loading state | Open /brand/lm/payments/onboard | Spinner + "Loading Stripe onboarding…" | Component |
| T-A10-18 | Onboarding auto-advance | Wait 1.5s on loading state | Auto-advances to complete state | Component |
| T-A10-19 | Onboarding complete state | After auto-advance | Check icon + "Onboarding submitted" + Done Button | Component |
| T-A10-20 | Done mutates store | Tap Done on /brand/lm/payments/onboard | Returns to /brand/lm/payments; banner now shows onboarding state | Component + Route + State |
| T-A10-21 | Long-press failed | Long-press "Stripe onboarding" header | State flips to failed | Component |
| T-A10-22 | Try again | Tap Try again on failed | State returns to loading; auto-advances | Component |
| T-A10-23 | Cancel from failed | Tap Cancel on failed | Returns to dashboard via router.back; no state mutation | Component + Route |
| T-A10-24 | Cancel from loading | Tap Cancel on top bar during loading | Returns to dashboard; no state mutation | Component + Route |
| T-A10-25 | Brand-not-found dashboard | Navigate to /brand/xyz/payments | Not-found GlassCard + Back button | Component + Route |
| T-A10-26 | Brand-not-found onboard | Navigate to /brand/xyz/payments/onboard | Not-found GlassCard + Back button | Component + Route |
| T-A10-27 | Persist v7→v8 migration | Cold-launch with v7 persisted state | Brands hydrate; stripeStatus undefined; J-A7 shows Connect banner; sub "Not connected" | State migration |
| T-A10-28 | Web direct URL dashboard | Paste /brand/sl/payments in browser | Dashboard renders for Sunday Languor | Route + web |
| T-A10-29 | Web direct URL onboard | Paste /brand/lm/payments/onboard in browser | Onboarding shell renders for Lonely Moth | Route + web |
| T-A10-30 | tsc strict | `npx tsc --noEmit` | exit 0 | Build |
| T-A10-31 | Host-bg cascade | Inspect both new routes | canvas.discover background | Route |
| T-A10-32 | TRANSITIONAL grep retire | Grep BrandProfileView for "Stripe Connect lands in J-A10" | 0 matches | Build |
| T-A10-33 | TRANSITIONAL grep new | Grep new files for `[TRANSITIONAL]` | 5 markers (1.5s delay · long-press · Resolve · Export · inert rows) | Build |
| T-A10-34 | GBP formatting | Inspect any currency value | `£156.20` not `£156.2` (always 2 fraction digits) | Component |
| T-A10-35 | Relative time | Inspect Last payout sub on /brand/sl/payments | Matches J-A9's relative-time output (e.g., "3d ago") | Component |
| T-A10-36 | Refund prefix | Inspect refund row on /brand/sl/payments | Amount prefixed with `−` (e.g., "−£24.00") | Component |
| T-A10-37 | Payout in_transit pill | Inspect first payout row on /brand/sl/payments | Pill variant info/draft + "IN TRANSIT" label | Component |
| T-A10-38 | Empty payouts copy | Inspect /brand/lm/payments | "No payouts yet" / "Payouts arrive here once you start selling tickets." | Component |

---

## 7. Implementation Order

1. **Schema bump** — currentBrandStore.ts: add `BrandStripeStatus`, `BrandPayoutStatus`, `BrandPayout`, `BrandRefund` types. Extend Brand with `stripeStatus?`, `availableBalanceGbp?`, `pendingBalanceGbp?`, `lastPayoutAt?`, `payouts?`, `refunds?`. Bump persist v7 → v8. Header comment update.
2. **tsc check** — clean.
3. **Stub data** — brandList.ts: add stripe state + payouts + refunds per spec §3.2 to all 4 brands.
4. **tsc check** — clean.
5. **Build BrandPaymentsView** — `src/components/brand/BrandPaymentsView.tsx` per spec §3.5. Status-banner config record. KPI tiles section. Payouts list with empty-state. Refunds list (skipped when empty). Export Button. Toast for Resolve + Export TRANSITIONAL feedback. Inline `formatGbp` + `formatRelativeTime` (DEC-079; D-INV-A10-2 + D-INV-A10-3 watch-points).
6. **tsc check** — clean.
7. **Build BrandOnboardView** — `src/components/brand/BrandOnboardView.tsx` per spec §3.6. State machine (loading → complete; long-press → failed). Custom TopBar (Cancel left + long-pressable centered title + empty right). Spinner / check / alert visuals per state.
8. **tsc check** — clean.
9. **Create dashboard route** — `app/brand/[id]/payments/index.tsx` per spec §3.3. Format-agnostic ID + canvas.discover. handleBack + handleOpenOnboard.
10. **tsc check** — clean.
11. **Create onboarding route** — `app/brand/[id]/payments/onboard.tsx` per spec §3.4. Format-agnostic ID + canvas.discover. handleBack + handleAfterDone (mutates store + back).
12. **tsc check** — clean.
13. **Wire J-A7 BrandProfileView** — modify per spec §3.7. Add `onStripe` + `onPayments` props. Replace banner JSX with status-driven render (J_A7_BANNER_COPY record). Replace Stripe banner Toast handler with `onStripe(brand.id)` call. Replace Operations row #1 onPress with `onPayments(brand.id)`. Operations row sub-text dynamic per OPERATIONS_SUB_TEXT record. Remove 2 TRANSITIONAL markers.
14. **tsc check** — clean.
15. **Wire route** — modify `app/brand/[id]/index.tsx` per spec §3.8. Add handleOpenStripe + handleOpenPayments handlers; pass to BrandProfileView.
16. **tsc check** — clean.
17. **Grep verify** — `grep "Stripe Connect lands in J-A10" mingla-business/src/` → 0 matches. Verify 5 new TRANSITIONAL markers in BrandPaymentsView + BrandOnboardView.
18. **Implementation report** — `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_2_J_A10_PAYMENTS_SHELL.md`.

---

## 8. Regression Prevention

- **BrandProfileViewProps growing prop set** — interface comment now lists 4 navigation props (onEdit, onTeam, onStripe, onPayments). J-A12 will add `onReports`. Pattern documented.
- **TRANSITIONAL marker churn** — net delta: −2 (J-A7 retires) + 5 (J-A10 new in BrandPaymentsView + BrandOnboardView) = +3 net. Implementor verifies with grep.
- **Status-banner config record pattern** — clean abstraction documented in code comment. Future surfaces (admin override, event publish gate) can reference this pattern.
- **Banner suppression discipline** — when stripeStatus = "active", banner element is `null`. Implementor verifies via inspection that no spacer / placeholder remains.
- **Persist version bump discipline** — same pattern as J-A7/A8/A9 (typed migration, header comment with version history).
- **Currency formatting locked** — `Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 })` everywhere — no ad-hoc string concat.

---

## 9. Founder-facing UX (plain English summary)

When this lands the founder will:

- **On any brand profile:**
  - If Stripe NOT connected: see the orange "Connect Stripe to sell tickets" banner. Tap it → land on the payments dashboard.
  - If Stripe is verifying: see "Onboarding submitted — verifying" banner. Tap it → dashboard.
  - If Stripe is active: NO banner — clean profile. Tap Operations row "Payments & Stripe" → dashboard.
  - If Stripe is restricted: see red "Action required" banner. Tap → dashboard.

- **On the payments dashboard:**
  - See the status banner up top (or no banner if active)
  - 3 KPI tiles: Available balance / Pending balance / Last payout (in £ with sub-text)
  - Recent payouts list with status pills (paid / in transit) and relative dates
  - Recent refunds list (only renders when there are refunds; amount prefixed with −)
  - Tap "Connect Stripe" or "Finish onboarding" → land on the onboarding shell
  - Tap "Resolve" (restricted state) → Toast "Stripe support lands in B2."
  - Tap "Export finance report" → Toast "Finance reports land in J-A12."

- **On the onboarding shell:**
  - See "Loading Stripe onboarding…" with a spinner for 1.5 seconds
  - Then: check icon + "Onboarding submitted" + Done button
  - Tap Done → back to dashboard, with banner now showing the "verifying" state
  - QA can long-press the header to see the failed state visual

**What this DOESN'T do yet:** real Stripe (B2), real WebView (B2), push notification when verification completes (B5), real "Resolve" deep-link (B2), country support / KYC flows (B2), per-row payout/refund detail screens (B2). The Cycle 2 stub cannot advance from `onboarding` to `active` via the flow — to see the active state, smoke uses Sunday Languor (pre-seeded as active).

---

## 10. Out-of-band carve-outs

| Carry-over | Status in J-A10 |
|---|---|
| **D-IMPL-A7-6** Host-bg cascade | ✅ ADDRESSED — both new routes apply I-12 |
| **H-1 (J-A6 audit)** ID format tolerance | ✅ ADDRESSED — same format-agnostic resolver |
| **HF-1 (J-A8 polish)** ConfirmDialog NOT portaled | ⚠ Not exercised here (no ConfirmDialog use) |
| **HF-2 (J-A8 polish)** kit `./Modal` NOT portaled | ⚠ Not exercised here |
| **D-INV-A9-1** Permissions matrix UI | ❌ DEFERRED |
| **D-INV-A9-3** Avatar primitive | ✅ Shipped at `c947c292` |
| **D-INV-A10-1** StatusBanner primitive | ⏸ Watch-point — first use here; promote on 3+ |
| **D-INV-A10-2** formatGbp utility | ⚠ THRESHOLD HIT (3+ uses); recommend Cycle-2-polish lift OR bundle with J-A12 |
| **D-INV-A10-3** formatRelativeTime utility | ⚠ THRESHOLD HIT (3+ uses); same recommendation |
| **D-INV-A10-4** Long-press dev gesture | ⏸ TRANSITIONAL until B2 real Stripe SDK |
| **D-INV-A10-5..8** B2 deferrals | ❌ All deferred to B2 |
| **D-INV-A10-9** DEC-082 slot ambiguity | ⏸ Orchestrator bookkeeping pass |

---

## 11. Dispatch hand-off

Implementor dispatch shall reference both:
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A10.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-2-J-A10_PAYMENTS_SHELL.md` (this file)

Implementor follows §7 implementation order verbatim. Tester (or operator smoke) verifies T-A10-01 through T-A10-38 inclusive. **5 must-test scenarios:** T-A10-09 (LM not_connected) · T-A10-11 (SL active full populated) · T-A10-13 + T-A10-20 (Connect → Done → status flips) · T-A10-21 (long-press failed) · T-A10-27 (persist v7→v8 cold-launch).

**Pre-flight watch-points for implementor:**
- **W-1** — Verify `alert` icon present in Icon.tsx; if absent, use `info`. Document choice.
- **W-2** — Verify Pill `live` variant works for "PAID" status; if not appropriate, use `info`.
- **W-3** — Verify `Spinner` primitive exists in kit; if not, use ActivityIndicator from RN.
- **W-4** — Verify `check` icon (used in onboarding complete state) — confirmed present per J-A9 spec verification.

---

**End of J-A10 + J-A11 spec.**
