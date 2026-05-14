# SPEC ORCH-0826 — M0 Hub Foundation + Universal Creator + Unified Data Model

> **Phase:** 2 of 5 (SPEC). Produced by Claude `mingla-forensics` (SPEC mode) on 2026-05-14.
> **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0826_M0_HUB_FOUNDATION_SPEC.md`
> **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_M0_HUB_FOUNDATION.md`
> **Milestone brief:** `Mingla_Artifacts/milestones/M0_HUB_FOUNDATION.md`
> **Project spec:** `Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md` §2, §3, §4
> **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
> **Implementor:** Seth (solo, per operator override Q8)
> **Estimate:** ~1.5 weeks single-engineer

---

## Executive Summary (Plain English)

M0 is the first milestone in Mingla Business 1.2 — the shared foundation that everything else builds on. After 1.5 weeks of implementation, the operator will see:

- The bottom-nav tab labeled "Events" is renamed "Hub" and contains three sub-tabs (Events / Experiences / Trips), where Events is today's content unchanged and the other two are friendly "Coming soon" placeholders.
- A new "+" button at the top-right of Home, Hub, Blast (Marketing), and Account opens a top-anchored dropdown sheet (TopSheet, extended with a new compact-height mode) offering three creation options: Create event / Create experience / Create trip.
- "Create event" routes to today's flow unchanged; the other two route to small "Coming soon" stub screens.
- Old `/events` route is HARD-RENAMED to `/hub/events` — every internal caller is updated; the old `(tabs)/events.tsx` file is deleted entirely.
- Home tab's empty-state "+ Build event" big button is REMOVED — the top-bar "+" is the sole creation entry point.
- Under the hood, the `events` database table gains a new `event_type` column (`event` / `experience` / `trip`) so Tr2+ and Ve5+ milestones can store their own offering types without a parallel table.
- The TopSheet primitive gains a new `heightMode="compact"` prop (additive; default behavior preserved) so the 3-option creator sheet fits its content rather than filling 70% of screen.

Two new Decision Log entries are queued for CLOSE: **DEC-NEW-A** (TopSheet usage extended to UniversalCreatorSheet — supersedes DEC-080's brand-switcher-only reservation per operator override) and **DEC-NEW-B** (TopSheet gains `heightMode="compact"`). A new DRAFT memory file `feedback_topsheet_extended_universal_creator.md` is pre-written for CLOSE-time flip to ACTIVE.

Single-engineer execution per Q8 override; no Stream A/B partition. 13-step linear implementation order in §11.

---

## §1 — Scope and Non-Goals

### Scope

The 13-step implementation in §11 — covering:

1. Database migration (events.event_type column + index + CHECK)
2. TopSheet primitive extension (new `heightMode` prop)
3. New `UniversalCreatorSheet` component
4. Two "Coming soon" stub screens
5. Hub directory + sub-tab layout + three sub-routes
6. Bottom-nav `_layout.tsx` TABS rename (events → hub)
7. Hard rename: every internal `/events` caller → `/hub/events`
8. `routes.ts` update
9. TopBar `extraRightSlot` additions on Home + Blast + Account
10. Home tab empty-state copy redesign (remove "+ Build event" big button)
11. Regression tests
12. Local checks (tsc + jest)
13. iOS Simulator smoke test

### Non-Goals (explicit)

- **No real Create experience or Create trip flows.** Those land in Ve5 / Tr2 respectively. M0 only ships routing to "Coming soon" stubs.
- **No changes to existing event creation, publish, edit, scan, refund, cancel, end-sales flows.** Cross-flow regression must be zero.
- **No changes to Marketing composer behavior** beyond adding the universal "+" to the Marketing tab's TopBar. The composer screen specifically hides the universal "+" (matches existing BottomNav hiding pattern).
- **No changes to Ari tab.** Universal "+" explicitly NOT added per Q4 refinement.
- **No new edge functions, no edge function changes.** M0 is UI + schema only.
- **No new hooks, no new services.** Existing event/brand/marketing hooks unchanged.
- **No `events_with_master_date_view` modification.** The view doesn't auto-inherit `event_type`; that's a Tr2+ concern per investigation D-0826-3.
- **No primitive-kit additions beyond the additive TopSheet `heightMode` prop.** No new Modal/Sheet primitives.

### Assumptions

- The investigation's blast-radius mapping (§6 of the report) is complete. SPEC re-verifies critical claims (RPC INSERT compatibility, realtime publication implications).
- Operator (Seth) takes M0 solo. No two-engineer coordination needed.
- Stripe Connect, Resend, OneSignal, RevenueCat, and all external integrations remain unchanged.
- The strict-grep CI gate (`.github/workflows/strict-grep-mingla-business.yml`) already enforces I-37 via `i37-topbar-cluster.mjs` — no new CI gate needed for M0.

---

## §2 — Database Layer

### Migration file

**Filename:** `supabase/migrations/20260514000000_orch_0826_events_event_type_discriminator.sql`

> Timestamp `20260514000000` chosen as `YYYY-MM-DD000000` for the SPEC's authoring date; implementor adjusts to the actual apply date if it changes. Must be monotonically after the latest existing migration (`20260604000003_orch_0824_patch_event_taxonomy_rpc.sql`). If the actual apply date is after `2026-06-04`, the timestamp must reflect the actual date.

### Full migration SQL

```sql
-- ORCH-0826 — Mingla Business 1.2 M0: Hub Foundation.
-- Adds events.event_type discriminator column for the unified offering model.
--
-- I-1.2-UNIFIED-EVENT-TYPE: every sellable thing is a row in public.events
-- with event_type discriminator (`event` / `experience` / `trip`). No
-- parallel offering tables. Future Tr2+ writes 'trip' rows; Ve5+ writes
-- 'experience' rows; existing flows continue to write 'event' rows.
--
-- Safety analysis (from INVESTIGATION_ORCH-0826):
--   - Zero existing CHECK constraints conflict on the events table
--   - Zero name-collision risk for `event_type` (existing references in user-
--     timeline + Stripe webhook + brand_stripe_orphaned_refunds; none on events)
--   - Cross-domain blast radius narrow: 0 reads from app-mobile/, 0 from
--     mingla-admin/, 4 files in mingla-business/, 6 edge functions
--   - business-publish-event-draft RPC: verify INSERT compatibility (this
--     migration adds NOT NULL with DEFAULT; existing INSERTs without
--     event_type get 'event' automatically)
--
-- See: Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md §2
--      Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_M0_HUB_FOUNDATION.md
--      Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md §3.3

BEGIN;

-- (1) Add the discriminator column with default + CHECK -------------------

ALTER TABLE public.events
  ADD COLUMN event_type text NOT NULL DEFAULT 'event'
    CHECK (event_type IN ('event', 'experience', 'trip'));

COMMENT ON COLUMN public.events.event_type IS
  'Mingla Business 1.2 (ORCH-0826) — unified offering discriminator. '
  '`event` = today''s ticketed event (popup organizers); '
  '`experience` = single-intent venue-derived offering (Ve5+); '
  '`trip` = multi-day curated package (Tr2+). '
  'I-1.2-UNIFIED-EVENT-TYPE: no parallel offering tables.';

-- (2) Defensive explicit backfill -----------------------------------------
--
-- Postgres ADD COLUMN ... NOT NULL DEFAULT already handles this automatically,
-- but an explicit UPDATE ensures audit-log clarity and protects against any
-- edge case where rows might briefly exist without the column populated.

UPDATE public.events
  SET event_type = 'event'
  WHERE event_type IS NULL;

-- (3) Index for filter queries --------------------------------------------
--
-- Partial-style not needed yet (only 3 enum values, low cardinality). Full
-- index helps future Hub > Experiences and Hub > Trips filter queries that
-- will be added in Ve5+/Tr2+.

CREATE INDEX idx_events_event_type ON public.events(event_type);

-- (4) Self-verification ---------------------------------------------------
--
-- Post-migration sanity check: every row must have a valid event_type value.
-- Raises an exception if backfill missed anything (defensive guard).

DO $$
DECLARE
  v_null_count bigint;
  v_invalid_count bigint;
BEGIN
  SELECT count(*) INTO v_null_count
    FROM public.events
    WHERE event_type IS NULL;

  SELECT count(*) INTO v_invalid_count
    FROM public.events
    WHERE event_type NOT IN ('event', 'experience', 'trip');

  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'ORCH-0826 migration: % rows have NULL event_type after backfill',
      v_null_count;
  END IF;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'ORCH-0826 migration: % rows have invalid event_type after backfill',
      v_invalid_count;
  END IF;

  RAISE NOTICE 'ORCH-0826 migration complete: events.event_type discriminator added (all rows defaulted to event)';
END $$;

COMMIT;
```

### RLS

**No changes.** Existing RLS policies on `events` apply to the new column transparently. The column is `NOT NULL DEFAULT 'event'`, so no policy needs to filter by `event_type IS NOT NULL`. Future filtering by `event_type` (Hub > Experiences, Hub > Trips) happens at the application layer; no RLS predicate change required for M0.

### RPC compatibility verification (Discovery D-0826-4)

**Required pre-migration check:** SPEC mandates the implementor read `business-publish-event-draft` RPC body in `supabase/migrations/20260525000000_orch_0792_publish_writes_event_dates.sql` and confirm:

1. The RPC's `INSERT INTO public.events (...)` does NOT explicitly list every column (or if it does, `event_type` is included OR the column omission triggers the default).
2. The RPC does NOT use `INSERT INTO public.events VALUES (...)` with positional values — that would break because the column order shifts.

**Expected outcome:** the RPC uses named-column INSERTs (standard Postgres pattern), so `event_type` defaults to `'event'` for any RPC-driven insert without modification. If the implementor finds otherwise, this becomes a P0 blocker — SPEC must be amended before migration ships.

**Backfill stage:** the implementor runs the migration once locally (`supabase db reset` against a local DB seeded with production-like data) to verify the explicit UPDATE doesn't time out on large row counts. The production events table is small (<100k rows expected), so no concern, but verify.

### Realtime publication implications (Discovery D-0826-5)

**Required pre-migration check:** the implementor runs:

```sql
SELECT pubname, tablename
FROM pg_publication_tables
WHERE schemaname = 'public' AND tablename = 'events';
```

If `events` is in any publication (e.g., `supabase_realtime`), adding a column triggers a snapshot refresh on `supabase db push` (10-30s for mid-size tables). **This is not a blocker** but the deploy-ordering note in the implementation report must call it out so the operator knows to expect the delay. If `events` is NOT in any publication, the migration applies in <1s.

### Migration idempotency

The `ADD COLUMN` is not idempotent on its own (re-run would fail). This is fine — migrations are timestamp-keyed and apply once. The `DO $$ ... $$` block self-verifies; running twice would fail at the column-add step before any verification logic runs, which is the correct failure mode.

---

## §3 — Edge Function Layer

**No edge function changes for M0.**

The new `event_type` column is automatically projected by any `SELECT *` query against `events`. The 6 edge functions that read from `events`:

- `supabase/functions/brand-stripe-onboard/index.ts`
- `supabase/functions/event-cover-video-webhook/index.ts`
- `supabase/functions/event-cover-video-apply/index.ts`
- `supabase/functions/_shared/eventCoverVideo.ts`
- `supabase/functions/_shared/agentTools.ts`
- `supabase/functions/discover-merged-events/index.ts`

All continue to work unchanged. Any function that subsequently wants to filter by `event_type` (e.g., `discover-merged-events` filtering to `event_type='event'` to exclude trips and experiences from event-targeted surfaces) is out of scope for M0 — that's Ve5/Tr2 scope.

---

## §4 — Service Layer

**No service-layer changes for M0.**

Existing services in `mingla-business/src/services/` (`businessEvents.ts`, `brandsService.ts`, etc.) continue to work. The new `event_type` field becomes available implicitly through `SELECT *` patterns and TypeScript types regenerated via `supabase gen types` (out-of-band, optional).

---

## §5 — Hook Layer

**No hook-layer changes for M0.**

Existing hooks (`useBusinessEvents`, `useDraftEvents`, `useLiveEvents`, `useCurrentBrand`, etc.) continue to work unchanged.

---

## §6 — Component Layer (Detailed)

### 6.1 — TopSheet primitive extension (`heightMode` prop)

**File:** `mingla-business/src/components/ui/TopSheet.tsx` (modify, 401 lines existing)

#### New prop contract

Add to `TopSheetProps` interface (currently lines 91-99):

```typescript
export interface TopSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Tap on scrim closes. Default `true`. */
  dismissOnScrimTap?: boolean;
  /**
   * Panel height mode.
   *   - `"fixed-70"` (default) — panel fills 70% of screen height; content
   *     scrolls internally with a pinned footer. Backwards-compatible with
   *     existing BrandSwitcherSheet usage.
   *   - `"compact"` — panel height fits content via `onLayout` measurement.
   *     Suitable for short fixed-row sheets (e.g., UniversalCreatorSheet's
   *     3-option picker). Animations transition smoothly using the
   *     measured height.
   *
   * Per DEC-NEW-B (added by ORCH-0826) — additive prop, fully backwards
   * compatible. `BrandSwitcherSheet` (the original consumer) defaults to
   * `"fixed-70"` and stays unchanged.
   */
  heightMode?: "fixed-70" | "compact";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}
```

#### Implementation diff

The current implementation (line 122) computes:
```typescript
const panelHeight = screenHeight * PANEL_HEIGHT_RATIO;  // 0.7 × screen
```

Replace with conditional height:

```typescript
const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
const mode = heightMode ?? "fixed-70";

const fixedHeight = screenHeight * PANEL_HEIGHT_RATIO;

// In "compact" mode, panel height is content-measured. Before first
// measurement, render at a tiny seed height with opacity=0 to allow
// onLayout to fire; after measurement, animate to the measured height.
const panelHeight = mode === "compact"
  ? (measuredHeight ?? 0)  // 0 before measurement; rendered invisibly
  : fixedHeight;
```

Body-height calculation (current line 263):
```typescript
const bodyHeight = panelHeight - handleAreaHeight;
```

For `compact` mode, the body is content-driven; `bodyHeight` becomes `panelHeight - handleAreaHeight` still, but the panel itself is measured. The `<View style={[styles.body, { height: bodyHeight }]}>` becomes `<View style={[styles.body, mode === "compact" ? null : { height: bodyHeight }]}>` — i.e., don't impose a fixed height on the body in compact mode; let content size it.

#### onLayout measurement (NEW logic for compact mode)

Add an inner `onLayout` handler to the body's content wrapper:

```typescript
const handleContentLayout = useCallback((event: LayoutChangeEvent): void => {
  if (mode !== "compact") return;
  const measured = event.nativeEvent.layout.height;
  if (measured > 0 && measured !== measuredHeight) {
    // Account for handle area at bottom
    setMeasuredHeight(measured + HANDLE_AREA_HEIGHT);
  }
}, [mode, measuredHeight]);

// In the JSX:
<View
  style={[styles.body, mode === "compact" ? null : { height: bodyHeight }]}
  onLayout={handleContentLayout}
>
  {children}
</View>
```

#### Animation entry/exit in compact mode

The existing animation uses `closedY = -panelHeight` to slide the panel up behind the topbar. In compact mode:
- Before first measurement: `panelHeight = 0`, panel renders with `opacity: 0` (use `panelStyle.opacity` derived from `measuredHeight !== null ? 1 : 0`)
- After first measurement: `panelHeight = measured`, animations work normally with the measured value

Add to the `panelStyle` `useAnimatedStyle`:
```typescript
const panelStyle = useAnimatedStyle(() => ({
  transform: [{ translateY: translateY.value }],
  // In compact mode, hide panel until measurement completes
  opacity: mode === "compact" && measuredHeight === null ? 0 : 1,
}));
```

(Note: `measuredHeight` is a React state, not a Reanimated shared value. Since the animation already depends on JS state for `closedY`/`openY` recalculation, this works. Implementor verifies the re-mount-on-change behavior.)

#### Backwards compatibility

`BrandSwitcherSheet.tsx` (the only existing TopSheet consumer) does NOT pass `heightMode`. The default `"fixed-70"` preserves its current behavior byte-for-byte.

#### Self-test

After implementing, the implementor verifies:
1. Brand Switcher Sheet opens at 70% height as before (visual regression check)
2. UniversalCreatorSheet (created in §6.2) opens at content height
3. Both animate smoothly on open/close
4. Reduce-motion preference still works in both modes

### 6.2 — `UniversalCreatorSheet` (NEW component)

**File:** `mingla-business/src/components/ui/UniversalCreatorSheet.tsx` (new, ~150 lines)

#### Props interface

```typescript
export interface UniversalCreatorSheetProps {
  visible: boolean;
  onClose: () => void;
  testID?: string;
}
```

#### Component shape

```typescript
import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "./Icon";
import { TopSheet } from "./TopSheet";

interface CreatorOption {
  key: "event" | "experience" | "trip";
  iconName: "calendar" | "sparkle" | "compass";  // map to existing IconBrand set
  title: string;
  subtitle: string;
  route: string;
  testID: string;
}

const OPTIONS: readonly CreatorOption[] = [
  {
    key: "event",
    iconName: "calendar",
    title: "Create event",
    subtitle: "A ticketed gathering: concert, party, comedy night, festival.",
    route: "/event/create",
    testID: "universal-creator-event",
  },
  {
    key: "experience",
    iconName: "sparkle",
    title: "Create experience",
    subtitle: "A single-intent offering for venues: brunch, tasting, class.",
    route: "/experience/coming-soon",
    testID: "universal-creator-experience",
  },
  {
    key: "trip",
    iconName: "compass",
    title: "Create trip or otherwise",
    subtitle: "A multi-day curated package: retreat, tour, weekend getaway.",
    route: "/trip/coming-soon",
    testID: "universal-creator-trip",
  },
] as const;

export const UniversalCreatorSheet: React.FC<UniversalCreatorSheetProps> = ({
  visible,
  onClose,
  testID,
}) => {
  const router = useRouter();

  const handleSelect = useCallback((option: CreatorOption): void => {
    onClose();
    // Defer router push until sheet close animation begins
    setTimeout(() => {
      router.push(option.route as never);
    }, 50);
  }, [onClose, router]);

  return (
    <TopSheet
      visible={visible}
      onClose={onClose}
      heightMode="compact"
      testID={testID}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>What are you creating?</Text>
        <Text style={styles.headerSubtitle}>
          Pick one and we'll walk you through it.
        </Text>
      </View>
      <View style={styles.rows}>
        {OPTIONS.map((option) => (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityLabel={option.title}
            accessibilityHint={option.subtitle}
            onPress={() => handleSelect(option)}
            style={({ pressed }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
            testID={option.testID}
          >
            <View style={styles.rowIconWrap}>
              <Icon name={option.iconName} size={28} color={textTokens.primary} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{option.title}</Text>
              <Text style={styles.rowSubtitle}>{option.subtitle}</Text>
            </View>
            <Icon name="chevR" size={20} color={textTokens.tertiary} />
          </Pressable>
        ))}
      </View>
    </TopSheet>
  );
};

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  headerTitle: {
    ...typography.h3,
    color: textTokens.primary,
  },
  headerSubtitle: {
    ...typography.body,
    color: textTokens.secondary,
  },
  rows: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowPressed: {
    backgroundColor: glass.tint.profileElevated,
  },
  rowIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileElevated,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "600",
  },
  rowSubtitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
});

export default UniversalCreatorSheet;
```

#### State management

`visible` is controlled by the parent (Home / Hub / Blast / Account). Each parent maintains its own `[isCreatorOpen, setIsCreatorOpen]` state — there's no global sheet state. This matches the existing BrandSwitcherSheet pattern.

#### Accessibility

- Each `Pressable` row has `accessibilityRole="button"`, `accessibilityLabel` (the title), `accessibilityHint` (the subtitle)
- Icon row width = 44px (meets I-38 touch-target invariant)
- The TopSheet primitive already handles scrim-tap dismiss + iOS swipe-up + Android back + web Escape

#### Constitution compliance

- **#1 No dead taps:** every row routes
- **#3 No silent failures:** routes are static strings; no async failure path
- **#9 No fabricated data:** the subtitles describe what each offering type IS; no fake metrics
- **#11 One auth instance:** no auth changes
- **I-37:** N/A (this is a sheet component, not a TopBar consumer)
- **I-38:** Icon row 44px ✓
- **I-39:** Every Pressable has accessibilityLabel ✓
- **I-ARI-NO-OKLCH:** All colors from `designSystem` tokens (HSL/hex), no oklch ✓

### 6.3 — Stub screen: `/experience/coming-soon`

**File:** `mingla-business/app/experience/coming-soon.tsx` (new, ~60 lines)

```typescript
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../src/components/ui/Button";
import { TopBar } from "../../src/components/ui/TopBar";
import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";

export default function ExperienceComingSoonRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/hub/experiences" as never);
  };

  return (
    <View style={[styles.host, { paddingTop: insets.top + spacing.sm }]}>
      <TopBar leftKind="back" onBack={handleBack} title="Create experience" />
      <View style={styles.body}>
        <View style={styles.card}>
          <Text style={styles.title}>Coming soon.</Text>
          <Text style={styles.body}>
            Single-intent experiences let verified venue brands publish offerings like
            "Bottomless brunch Saturdays" or "Date-night tasting menu." They're powered by
            AI that reads your menu and generates candidates for you to review.
          </Text>
          <Text style={styles.body}>
            We're shipping this in a few weeks. We'll let you know the moment it's live.
          </Text>
        </View>
        <Button label="Back to Hub" onPress={handleBack} variant="secondary" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  card: {
    padding: spacing.xl,
    backgroundColor: glass.tint.profileElevated,
    borderColor: glass.border.profileElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  title: {
    ...typography.h2,
    color: textTokens.primary,
  },
});
```

### 6.4 — Stub screen: `/trip/coming-soon`

**File:** `mingla-business/app/trip/coming-soon.tsx` (new, ~60 lines)

Same structure as 6.3 but with trip copy:

```typescript
// ... same imports + back handler

      <View style={styles.card}>
        <Text style={styles.title}>Coming soon.</Text>
        <Text style={styles.body}>
          Multi-day trips let curated travel planners publish packages like
          "Tulum Yoga Retreat — March 2026" with day-by-day itineraries, installment
          payments, traveler intake forms, and a group discussion board built in.
        </Text>
        <Text style={styles.body}>
          We're shipping this in a few weeks. We'll let you know the moment it's live.
        </Text>
      </View>
```

Title bar label: `"Create trip"` (matches the universal creator's row title without the "or otherwise" tail, for screen clarity).

### 6.5 — Hub sub-route layout

**File:** `mingla-business/app/(tabs)/hub/_layout.tsx` (new, ~30 lines)

Mirrors the Marketing layout pattern at `mingla-business/app/(tabs)/marketing/_layout.tsx`:

```typescript
import React from "react";
import { StyleSheet, View } from "react-native";
import { Slot } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HubSubNav } from "../../../src/components/hub/HubSubNav";
import { canvas } from "../../../src/constants/designSystem";

export default function HubTabLayout(): React.ReactElement {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <HubSubNav />
      <Slot />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
});
```

### 6.6 — `HubSubNav` component (NEW)

**File:** `mingla-business/src/components/hub/HubSubNav.tsx` (new, ~80 lines)

Reads `usePathname` to detect active sub-tab. Three pill-style buttons:

```typescript
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter, usePathname } from "expo-router";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

interface HubSubTab {
  id: "events" | "experiences" | "trips";
  label: string;
  route: string;
}

const SUB_TABS: readonly HubSubTab[] = [
  { id: "events", label: "Events", route: "/(tabs)/hub/events" },
  { id: "experiences", label: "Experiences", route: "/(tabs)/hub/experiences" },
  { id: "trips", label: "Trips", route: "/(tabs)/hub/trips" },
] as const;

const detectActiveSubTab = (pathname: string): HubSubTab["id"] => {
  const lower = pathname.toLowerCase();
  if (lower.includes("/hub/experiences")) return "experiences";
  if (lower.includes("/hub/trips")) return "trips";
  return "events"; // default
};

export const HubSubNav: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const activeId = detectActiveSubTab(pathname);

  return (
    <View style={styles.host}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {SUB_TABS.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityLabel={`${tab.label} sub-tab`}
              accessibilityState={{ selected: isActive }}
              onPress={() => router.push(tab.route as never)}
              style={[
                styles.pill,
                isActive ? styles.pillActive : styles.pillInactive,
              ]}
              testID={`hub-subtab-${tab.id}`}
            >
              <Text
                style={[
                  styles.pillLabel,
                  isActive ? styles.pillLabelActive : styles.pillLabelInactive,
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  content: {
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillActive: {
    backgroundColor: accent.warm,
    borderColor: accent.warm,
  },
  pillInactive: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
  pillLabel: {
    ...typography.bodySm,
    fontWeight: "600",
  },
  pillLabelActive: {
    color: textTokens.onAccent,
  },
  pillLabelInactive: {
    color: textTokens.secondary,
  },
});
```

### 6.7 — `hub/events.tsx` (relocated)

**File:** `mingla-business/app/(tabs)/hub/events.tsx` (relocate from `(tabs)/events.tsx`)

The implementor:
1. Renames `app/(tabs)/events.tsx` → `app/(tabs)/hub/events.tsx`
2. Adjusts every relative import path from `../../src/` → `../../../src/` (one extra level deeper)
3. The internal logic (892 lines) is otherwise unchanged

Specifically: `import { TopBar } from "../../src/components/ui/TopBar";` becomes `import { TopBar } from "../../../src/components/ui/TopBar";` and similar for all 26 imports.

**Critical:** the TopBar's `extraRightSlot` in this file currently mounts an "events-specific +". Per the M0 design, the file's TopBar `extraRightSlot` is REPLACED with the new universal `+` button that triggers UniversalCreatorSheet. SPEC specifies this replacement explicitly in §6.10 below.

### 6.8 — `hub/experiences.tsx` (NEW placeholder)

**File:** `mingla-business/app/(tabs)/hub/experiences.tsx` (new, ~50 lines)

```typescript
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";

export default function HubExperiencesRoute(): React.ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.placeholderCard}>
        <Text style={styles.title}>Experiences coming soon.</Text>
        <Text style={styles.body}>
          Single-intent experiences for verified venue brands — like "Bottomless brunch
          Saturdays" or "Date-night tasting menu." Generated by AI from your menu and
          curated by you. Ships in a few weeks.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing.md,
    paddingBottom: 120,
  },
  placeholderCard: {
    padding: spacing.xl,
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
  },
  body: {
    ...typography.body,
    color: textTokens.secondary,
  },
});
```

### 6.9 — `hub/trips.tsx` (NEW placeholder)

**File:** `mingla-business/app/(tabs)/hub/trips.tsx` (new, ~50 lines)

Same structure as 6.8 with trip-specific copy:

```typescript
// ... same imports
      <View style={styles.placeholderCard}>
        <Text style={styles.title}>Trips coming soon.</Text>
        <Text style={styles.body}>
          Multi-day curated trips — yoga retreats, food tours, weekend getaways — with
          day-by-day itineraries, installment payments, traveler intake forms, and a
          group discussion board built in. Ships in a few weeks.
        </Text>
      </View>
```

### 6.10 — Bottom-nav `_layout.tsx` TABS rename

**File:** `mingla-business/app/(tabs)/_layout.tsx` (modify, 110 lines existing)

Single-line change in the TABS array (line 22-37):

```diff
-  { id: "events", icon: "calendar", label: "Events" },
+  { id: "hub", icon: "calendar", label: "Hub" },
```

The `detectActiveTab` function (line 41-55) requires NO changes — it already handles nested routes correctly (per investigation §1).

### 6.11 — Home tab `home.tsx` edits

**File:** `mingla-business/app/(tabs)/home.tsx` (modify)

**Change A:** Add `extraRightSlot` with universal "+" trigger to the existing `<TopBar leftKind="brand">` at line 316:

```diff
-<TopBar leftKind="brand" onBrandTap={handleOpenSwitcher} />
+<TopBar
+  leftKind="brand"
+  onBrandTap={handleOpenSwitcher}
+  extraRightSlot={
+    <IconChrome
+      icon="plus"
+      size={36}
+      onPress={() => setIsUniversalCreatorOpen(true)}
+      accessibilityLabel="Create event, experience, or trip"
+      testID="home-universal-creator-button"
+    />
+  }
+/>
```

Plus the corresponding state at the top of the component:
```typescript
const [isUniversalCreatorOpen, setIsUniversalCreatorOpen] = useState<boolean>(false);
```

Plus the sheet mount near the existing sheets in the render tree:
```typescript
<UniversalCreatorSheet
  visible={isUniversalCreatorOpen}
  onClose={() => setIsUniversalCreatorOpen(false)}
/>
```

**Change B:** Remove the empty-state "+ Build event" button (line 463-469) and replace with new copy:

```diff
-<Pressable
-  onPress={handleBuildEvent}
-  style={styles.emptyBuildAction}
->
-  <Text style={styles.emptyBuildActionText}>Build event</Text>
-</Pressable>
+{/* Per Q5 override (ORCH-0826) — empty-state button removed.
+    Universal "+" in the TopBar is the sole creation entry point. */}
```

Plus update the empty-state text just above to point at the TopBar "+":

```typescript
// Replace existing empty-state copy with:
<Text style={styles.emptyTitle}>No events yet.</Text>
<Text style={styles.emptySubtitle}>
  Tap the <Text style={styles.emptyEmphasis}>+</Text> in the top right to create your first event.
</Text>
```

Plus add the `emptyEmphasis` style:
```typescript
emptyEmphasis: {
  fontWeight: "700",
  color: textTokens.primary,
},
```

**Change C:** Hard rename `/events` to `/hub/events` per Q3 override:

```diff
-  router.push("/events" as never);  // or "/(tabs)/events"
+  router.push("/(tabs)/hub/events" as never);
```

Specifically the `handleSeeAllEvents` handler (around line 447).

Also: `handleBuildEvent` at line 226 stays unchanged (still pushes to `/event/create`), but the button that called it is removed per Change B. Keep the handler function (not orphaned — universal creator's "Create event" routes to the same `/event/create`). Or implementor decides whether to remove the orphaned handler too.

### 6.12 — Hub TopBar (mount on each sub-route OR shared via `hub/_layout.tsx`)

Decision: TopBar mounts on each sub-route (`hub/events.tsx`, `hub/experiences.tsx`, `hub/trips.tsx`), NOT on `hub/_layout.tsx`.

Rationale: each sub-route may want subtle TopBar differences (e.g., Hub > Events keeps its existing manage-menu state in mind). Mounting per-route preserves flexibility. The HubSubNav is shared via the layout; the TopBar is per-route.

Each of the three Hub sub-routes uses:

```typescript
<TopBar
  leftKind="brand"
  onBrandTap={handleOpenSwitcher}
  extraRightSlot={
    <IconChrome
      icon="plus"
      size={36}
      onPress={() => setIsUniversalCreatorOpen(true)}
      accessibilityLabel="Create event, experience, or trip"
      testID="hub-events-universal-creator-button"  // or hub-experiences-... etc
    />
  }
/>
<UniversalCreatorSheet
  visible={isUniversalCreatorOpen}
  onClose={() => setIsUniversalCreatorOpen(false)}
/>
```

For `hub/events.tsx` (the relocated existing events.tsx), this replaces the existing event-specific "+ Build event" `extraRightSlot` with the universal "+".

### 6.13 — Blast / Marketing TopBar

**File:** `mingla-business/app/(tabs)/marketing/index.tsx` (modify, currently has no TopBar — adds one) AND each marketing sub-route (`marketing/audiences/index.tsx`, `marketing/templates/index.tsx`, `marketing/campaigns/index.tsx`, `marketing/campaigns/[id].tsx`).

Looking at the marketing index (read in Phase 0): it does NOT currently mount a TopBar (the marketing tab uses `marketing/_layout.tsx` with `MarketingSubNav` + `<Slot />`).

**Implementation decision:** mount the TopBar with universal "+" in the marketing `_layout.tsx` (above the MarketingSubNav), NOT per-route. This avoids duplicating the TopBar across 5 marketing sub-routes.

Specifically `marketing/_layout.tsx` becomes:

```diff
 export default function MarketingTabLayout(): React.ReactElement {
   const insets = useSafeAreaInsets();
+  const [isUniversalCreatorOpen, setIsUniversalCreatorOpen] = useState<boolean>(false);
+  const handleOpenSwitcher = useCallback(() => { /* opens BrandSwitcherSheet — see existing pattern */ }, []);
+
+  // Hide universal "+" on composer screens (matches existing BottomNav hide pattern)
+  const pathname = usePathname();
+  const hideUniversalPlus = pathname.includes("/campaigns/compose");
+
   return (
     <View style={[styles.host, { paddingTop: insets.top }]}>
+      <TopBar
+        leftKind="brand"
+        onBrandTap={handleOpenSwitcher}
+        extraRightSlot={hideUniversalPlus ? null : (
+          <IconChrome
+            icon="plus"
+            size={36}
+            onPress={() => setIsUniversalCreatorOpen(true)}
+            accessibilityLabel="Create event, experience, or trip"
+            testID="marketing-universal-creator-button"
+          />
+        )}
+      />
       <MarketingSubNav />
       <Slot />
+      <UniversalCreatorSheet
+        visible={isUniversalCreatorOpen}
+        onClose={() => setIsUniversalCreatorOpen(false)}
+      />
     </View>
   );
 }
```

If `extraRightSlot={null}` is the way to suppress the slot in this primitive, SPEC verifies during implementation. If not, the implementor conditionally omits the prop instead.

The composer-route hide check uses `pathname.includes("/campaigns/compose")` — same idiom as `_layout.tsx`'s `hideBottomNav`.

### 6.14 — Account TopBar

**File:** `mingla-business/app/(tabs)/account.tsx` (modify)

Account currently has a TopBar (confirmed by grep). Add `extraRightSlot`:

```diff
 <TopBar leftKind="brand" onBrandTap={handleOpenSwitcher} />
+<TopBar
+  leftKind="brand"
+  onBrandTap={handleOpenSwitcher}
+  extraRightSlot={
+    <IconChrome
+      icon="plus"
+      size={36}
+      onPress={() => setIsUniversalCreatorOpen(true)}
+      accessibilityLabel="Create event, experience, or trip"
+      testID="account-universal-creator-button"
+    />
+  }
+/>
```

Plus state + sheet mount as in §6.11.

### 6.15 — Legacy `(tabs)/events.tsx` — DELETE

Per Q3 override: hard rename. The old file is deleted entirely (not stubbed). Implementor uses `git mv app/(tabs)/events.tsx app/(tabs)/hub/events.tsx` for clean git history.

---

## §7 — Realtime / Storage Layer

**N/A for M0.** No realtime channels added, no storage buckets touched. The `events` table may be in a logical replication publication; if so, the column add triggers a snapshot refresh on `supabase db push` (10-30s) — documented in §2.

---

## §8 — Success Criteria (Numbered)

Each criterion is observable, testable, and unambiguous. The TEST phase maps each one to specific test result rows.

1. **Bottom-nav rename complete.** Tab id 2 is `hub`, label "Hub", icon `calendar`. Old "Events" tab id no longer present in the TABS array.

2. **Hub sub-tabs render.** Hub screen shows `HubSubNav` with three pills (Events / Experiences / Trips) at the top. Tapping any pill navigates to the corresponding sub-route.

3. **Hub > Events shows today's content unchanged.** Filter pills (All / Live / Upcoming / Drafts / Past) work. Event list cards render. Manage menu opens. Tapping a card navigates to event detail.

4. **Hub > Experiences renders the "Coming soon" placeholder.** Visible without crashes.

5. **Hub > Trips renders the "Coming soon" placeholder.** Visible without crashes.

6. **Top-bar "+" present on Home, Hub (all 3 sub-routes), Marketing (all sub-routes except composer), Account.** Tap fires haptic + opens UniversalCreatorSheet.

7. **Top-bar "+" ABSENT on Ari tab.** Ari TopBar unchanged.

8. **Top-bar "+" hidden on `/(tabs)/marketing/campaigns/compose`** route (matches BottomNav hide pattern).

9. **UniversalCreatorSheet opens at compact height.** Panel height fits 3 rows + header + handle area (~280-340px depending on screen scale). NOT 70% screen.

10. **UniversalCreatorSheet's "Create event" routes to `/event/create`.** Existing event creation flow unchanged.

11. **UniversalCreatorSheet's "Create experience" routes to `/experience/coming-soon`.** Stub screen renders.

12. **UniversalCreatorSheet's "Create trip or otherwise" routes to `/trip/coming-soon`.** Stub screen renders.

13. **TopSheet primitive's existing BrandSwitcherSheet usage unchanged.** BrandSwitcherSheet still opens at 70% height with internal scroll. No visual regression.

14. **Migration applies cleanly.** `events.event_type` column exists with `NOT NULL DEFAULT 'event'`, CHECK constraint, index. All existing rows backfilled to `'event'`. SQL probe in §15 confirms.

15. **Hard rename complete.** Zero internal callers of `/events` or `/(tabs)/events` remain. Greps in §15 prove this. The old file `app/(tabs)/events.tsx` is deleted.

16. **Home empty-state shows new copy.** No "+ Build event" big button. Copy points at the top-bar "+" with the emphasis style.

17. **`routes.ts` update or deprecate complete.** SPEC implementor decides based on grep result during implementation; either way the file isn't left broken.

18. **Two new DEC entries logged in DECISION_LOG.md.** DEC-NEW-A (TopSheet usage extension) and DEC-NEW-B (TopSheet compact-height mode). Numbered correctly per the existing DEC sequence at CLOSE.

19. **DRAFT memory `feedback_topsheet_extended_universal_creator.md` exists** at `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/`. Tagged `status: DRAFT — flips to ACTIVE on ORCH-0826 CLOSE`.

20. **Zero regressions.** All today's event flows work end-to-end after M0: create, publish, edit, end-sales, cancel, scan, view orders, view guests, blast event, view brand profile, marketing composer.

21. **Constitutional compliance.** All 14 rules PASS. Specifically I-37 (TopBar extraRightSlot discipline) preserved across all 4 new TopBar additions.

22. **iOS Simulator smoke test passes.** The 10-step smoke test from §15 runs end-to-end on iOS Simulator without crashes or unexpected behavior.

---

## §9 — Invariants

### Preserved (existing)

| ID | Name | How M0 preserves |
|----|------|-------------------|
| I-37 | TopBar primary-tab default cluster | All 4 new TopBar additions use `extraRightSlot`, never `rightSlot`. Strict-grep CI gate (`i37-topbar-cluster.mjs`) enforces. |
| I-38 | IconChrome touch-target ≥ 44 effective | New IconChrome `+` button uses `size={36}` which renders with implicit 44pt touch target per the IconChrome implementation. CI gate (`i38-icon-chrome-touch-target.mjs`) enforces. |
| I-39 | Pressable accessibilityLabel coverage | All new Pressables (UniversalCreatorSheet rows, HubSubNav pills) have explicit accessibilityLabel. CI gate (`i39-pressable-label.mjs`) enforces. |
| I-13 | Kit overlay primitives portal to screen root | TopSheet already portals correctly; UniversalCreatorSheet uses TopSheet, so inherits this. |
| Constitution #1-14 | The 14 rules | All preserved per §6 component-by-component compliance analysis. |
| feedback_anon_buyer_routes | Buyer routes anon-tolerant | Hub is inside `(tabs)` (auth-required); Coming Soon stubs at `/experience/*` and `/trip/*` are also auth-gated (not buyer-anon routes). |
| feedback_toast_needs_absolute_wrap | Toast wrap | No new Toasts in M0; existing Toast in hub/events.tsx (relocated) preserves the wrap. |
| feedback_rn_color_formats | HSL/hex/rgb/hwb only | All colors from `designSystem` tokens. No oklch/lab/lch. |
| feedback_zustand_persist_no_server_snapshots | Zustand persist hygiene | No Zustand changes in M0. |

### Established (NEW for M0)

| ID | Name | Description | Enforcement |
|----|------|-------------|-------------|
| I-1.2-UNIFIED-EVENT-TYPE | Unified offering model via events.event_type | Every sellable thing is a row in `public.events` with `event_type` discriminator. No parallel offering tables. | Schema CHECK constraint + Postgres column NOT NULL. CI: future Tr2/Ve5 specs reference this invariant. |

### Superseded (by operator override)

| ID | Original | Superseded by |
|----|----------|---------------|
| DEC-080 | TopSheet reserved for BrandSwitcherSheet only | DEC-NEW-A (TopSheet extended to UniversalCreatorSheet). DEC-080 remains as historical context; DEC-NEW-A explicitly cites it. |

---

## §10 — Test Cases

Format: `T-NN | Scenario | Input | Expected | Layer`.

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Tab rename | Open app, observe bottom nav | Slot 2 reads "Hub" with calendar icon | UI |
| T-02 | Hub default sub-tab | Tap Hub tab | Hub > Events sub-route renders with HubSubNav showing Events pill active | Routing |
| T-03 | Hub sub-tab navigation | From Hub > Events tap Experiences pill | Routes to /hub/experiences; pill becomes active | Routing |
| T-04 | Hub > Experiences placeholder | Land on /hub/experiences | Coming Soon placeholder card visible; no crashes | UI |
| T-05 | Hub > Trips placeholder | Tap Trips pill | Placeholder card visible | UI |
| T-06 | Universal "+" on Home | Open Home, tap top-bar "+" | UniversalCreatorSheet opens at compact height with 3 rows visible | UI |
| T-07 | Universal "+" on Hub > Events | Open Hub, tap top-bar "+" | Same sheet opens | UI |
| T-08 | Universal "+" on Hub > Experiences | Open Hub > Experiences, tap top-bar "+" | Same sheet opens | UI |
| T-09 | Universal "+" on Marketing | Open Marketing, tap top-bar "+" | Same sheet opens | UI |
| T-10 | Universal "+" on Marketing composer | Open `/marketing/campaigns/compose` | Top-bar "+" is hidden | UI |
| T-11 | Universal "+" on Account | Open Account, tap top-bar "+" | Same sheet opens | UI |
| T-12 | Universal "+" ABSENT on Ari | Open Ari | TopBar has no "+" button | UI |
| T-13 | Create event route | In universal sheet, tap "Create event" | Routes to /event/create (existing flow); sheet dismisses | Routing |
| T-14 | Create experience route | Tap "Create experience" | Routes to /experience/coming-soon; stub renders; back button works | Routing |
| T-15 | Create trip route | Tap "Create trip or otherwise" | Routes to /trip/coming-soon; stub renders; back button works | Routing |
| T-16 | TopSheet compact height | Inspect UniversalCreatorSheet panel | Height fits content (~280-340px), NOT 70% of screen | UI |
| T-17 | TopSheet BrandSwitcher unchanged | Open BrandSwitcherSheet | Opens at 70% height with internal scroll, identical to pre-M0 | UI regression |
| T-18 | Migration applied | Run `supabase db push --linked` | events.event_type column exists with `event` default | DB |
| T-19 | Backfill complete | `SELECT event_type, COUNT(*) FROM events GROUP BY event_type;` | All rows show `event_type = 'event'` | DB |
| T-20 | CHECK constraint enforces | Attempt INSERT with `event_type='foo'` | Postgres rejects with CHECK violation | DB |
| T-21 | Hard rename — no broken refs | `grep -r "'/events'\|\"/events\"\|/(tabs)/events" mingla-business/` | Returns zero results (the old file is deleted) | Routing |
| T-22 | Home "See all events" navigates correctly | On Home, tap "See all events" | Navigates to /(tabs)/hub/events | Routing |
| T-23 | Home empty-state no "+ Build event" button | Account with zero events on Home | New empty copy visible; no big button | UI |
| T-24 | Home empty-state copy emphasizes top-bar | Same as T-23 | Copy includes "+" with emphasis style pointing to top-bar | UI |
| T-25 | Regression: event create end-to-end | Universal sheet → Create event → wizard → publish | Event publishes successfully on iOS Sim | Full stack |
| T-26 | Regression: event scan | Open existing live event → Scanner | QR scan still works | Full stack |
| T-27 | Regression: event end-sales | Manage menu → End ticket sales | Existing sheet opens; flow works | Full stack |
| T-28 | Regression: marketing composer | Open marketing → Campaigns → New | Composer opens, autosave fires, schedule works | Full stack |
| T-29 | Regression: Brand profile public page | Open `/b/{some-slug}` signed out | Public brand page renders | Full stack + RLS |
| T-30 | Regression: existing events RLS | Sign in as Brand A, attempt to read Brand B event | Empty result (RLS) | Security |
| T-31 | Constitution #1 (no dead taps) | Tap each row in UniversalCreatorSheet | Each routes | UI |
| T-32 | Constitution #3 (no silent failures) | Force navigation error (test mock) | Error surfaces | Error path |
| T-33 | I-37 strict-grep gate | Run `node .github/scripts/strict-grep/i37-topbar-cluster.mjs` | Exit 0 (no violations) | CI |
| T-34 | I-38 strict-grep gate | Run `i38-icon-chrome-touch-target.mjs` | Exit 0 | CI |
| T-35 | I-39 strict-grep gate | Run `i39-pressable-label.mjs` | Exit 0 | CI |
| T-36 | tsc clean | `cd mingla-business && npx tsc --noEmit` | Exit 0 | Types |
| T-37 | Jest passes | `cd mingla-business && npm test` | All existing tests pass + new tests pass | Tests |

Total: 37 tests. The TEST phase produces a QA report mapping each row.

---

## §11 — Implementation Order (Solo, Single-Threaded)

Per Q8 override: Seth executes solo, no Stream A/B partition.

### Step 1 — Migration first (foundation)

- Create `supabase/migrations/20260514000000_orch_0826_events_event_type_discriminator.sql` per §2
- Test locally: `supabase db reset` (rebuilds from migrations on local DB)
- Run probe queries:
  ```sql
  SELECT column_name, data_type, column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='events' AND column_name='event_type';
  SELECT event_type, COUNT(*) FROM public.events GROUP BY event_type;
  ```
- Confirm zero rows have NULL event_type
- Verify business-publish-event-draft RPC INSERT compatibility (read the RPC body; named-column INSERTs are safe)
- Verify realtime publication state via `SELECT * FROM pg_publication_tables WHERE tablename='events';`
- DO NOT push the migration to remote yet (operator's job at deploy time)

### Step 2 — TopSheet primitive extension

- Add `heightMode` prop to `TopSheetProps` interface (§6.1)
- Implement compact-mode height-measurement logic per §6.1
- Add unit test: `mingla-business/src/components/ui/__tests__/TopSheet.heightMode.test.tsx` covering fixed-70 (default) + compact (auto-fit)
- Verify BrandSwitcherSheet still opens at 70% (no regression)
- Run `tsc --noEmit` clean

### Step 3 — UniversalCreatorSheet component

- Create `mingla-business/src/components/ui/UniversalCreatorSheet.tsx` per §6.2
- Add unit test: `mingla-business/src/components/ui/__tests__/UniversalCreatorSheet.test.tsx` covering 3 options + routing assertions + accessibility

### Step 4 — Two "Coming soon" stub screens

- Create `mingla-business/app/experience/coming-soon.tsx` per §6.3
- Create `mingla-business/app/trip/coming-soon.tsx` per §6.4
- No test needed (purely presentational; manual smoke check)

### Step 5 — Hub directory + sub-tab UI

- Create `mingla-business/app/(tabs)/hub/_layout.tsx` per §6.5
- Create `mingla-business/src/components/hub/HubSubNav.tsx` per §6.6
- Create `mingla-business/app/(tabs)/hub/experiences.tsx` per §6.8
- Create `mingla-business/app/(tabs)/hub/trips.tsx` per §6.9
- Move `mingla-business/app/(tabs)/events.tsx` → `mingla-business/app/(tabs)/hub/events.tsx` (via `git mv`)
- Adjust ALL relative imports in the relocated file (`../../src/` → `../../../src/`)
- Replace the events-specific TopBar extraRightSlot with the universal "+" trigger per §6.12

### Step 6 — Bottom-nav `_layout.tsx` rename

- Update TABS array: `events` → `hub`, label "Events" → "Hub" per §6.10
- Verify `detectActiveTab` resolves `/hub/events`, `/hub/experiences`, `/hub/trips` correctly (existing logic handles this; no change needed)

### Step 7 — Hard rename: all `/events` callers

Search and replace across the codebase:

```bash
# Grep all callers first
grep -rln "'/(tabs)/events'\|\"/(tabs)/events\"\|'/events'\|\"/events\"" mingla-business/

# Expected hits (per investigation §7):
#   mingla-business/app/(tabs)/home.tsx (handleSeeAllEvents)
#   mingla-business/src/config/routes.ts (events route)
#   mingla-business/app/event/[id]/index.tsx (manage menu nav)
#   mingla-business/app/event/[id]/preview.tsx
#   mingla-business/app/event/[id]/edit.tsx
#   mingla-business/src/components/event/PublicEventPage.tsx
#   mingla-business/src/components/event/EditPublishedScreen.tsx
#   mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts
#   mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts
```

For each: replace `/events` or `/(tabs)/events` with `/(tabs)/hub/events`. Verify with a re-grep showing zero results.

### Step 8 — `routes.ts` update or deprecate

```bash
# Find consumers of AppRoutes
grep -rln "from.*config/routes\|AppRoutes" mingla-business/
```

Expected (from investigation): 2 real consumers (`app/index.tsx`, `app/auth/index.tsx`). Decision tree:

- **If `app/index.tsx` reads `AppRoutes.events`:** update `routes.ts` to:
  ```typescript
  const AppRoutes = {
    home: "/(tabs)/home",
    hub: "/(tabs)/hub",
    hubEvents: "/(tabs)/hub/events",
    hubExperiences: "/(tabs)/hub/experiences",
    hubTrips: "/(tabs)/hub/trips",
    account: "/(tabs)/account",
    auth: { index: "/auth" },
  } as const;
  ```
  And update the consumers to use the new keys.

- **If `app/index.tsx` does NOT read `AppRoutes.events`:** deprecate the file (delete `routes.ts` and remove the imports from the 2 consumers, replacing them with literal paths).

Implementor decides based on grep result; either way the file isn't left broken.

### Step 9 — Home TopBar `extraRightSlot` + state + sheet mount

- Edit `mingla-business/app/(tabs)/home.tsx` per §6.11 Change A
- Add `isUniversalCreatorOpen` state
- Mount UniversalCreatorSheet

### Step 10 — Home empty-state copy redesign

- Remove the "+ Build event" Pressable per §6.11 Change B
- Update copy to emphasize the top-bar "+"
- Run a manual visual check (the empty state only shows for zero-event accounts; create a clean test account or use Stripe test fixture)

### Step 11 — Home `/events` → `/hub/events` hard rename

- Update `handleSeeAllEvents` (around line 447) per §6.11 Change C

### Step 12 — Hub TopBars (per sub-route)

- Add universal "+" to `hub/events.tsx`, `hub/experiences.tsx`, `hub/trips.tsx` per §6.12

### Step 13 — Marketing TopBar (in `marketing/_layout.tsx`)

- Edit `mingla-business/app/(tabs)/marketing/_layout.tsx` per §6.13
- Add `isUniversalCreatorOpen` state + sheet mount
- Implement composer-route hide via pathname check
- Verify the existing MarketingSubNav still renders below the new TopBar

### Step 14 — Account TopBar

- Edit `mingla-business/app/(tabs)/account.tsx` per §6.14
- Add state + sheet mount

### Step 15 — Regression test additions

Add new test files:
- `mingla-business/src/components/ui/__tests__/TopSheet.heightMode.test.tsx`
- `mingla-business/src/components/ui/__tests__/UniversalCreatorSheet.test.tsx`
- `mingla-business/src/components/hub/__tests__/HubSubNav.test.tsx`
- `mingla-business/app/(tabs)/__tests__/hub_navigation.test.tsx` (verifies tab structure + sub-tab routing + that `/events` → `/hub/events` rename is enforced)

### Step 16 — Local checks

```bash
cd mingla-business && npx tsc --noEmit  # MUST exit 0
cd mingla-business && npm test           # MUST pass all
cd mingla-business && node ../.github/scripts/strict-grep/i37-topbar-cluster.mjs  # MUST exit 0
cd mingla-business && node ../.github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs  # MUST exit 0
cd mingla-business && node ../.github/scripts/strict-grep/i39-pressable-label.mjs  # MUST exit 0
```

### Step 17 — DRAFT memory file

Write `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_topsheet_extended_universal_creator.md`:

```markdown
---
name: TopSheet extended for UniversalCreatorSheet (ORCH-0826)
description: TopSheet primitive no longer reserved for BrandSwitcherSheet only; UniversalCreatorSheet uses TopSheet with new heightMode="compact" mode.
type: feedback
status: DRAFT — flips to ACTIVE on ORCH-0826 CLOSE
---

# Why this memory exists

DEC-080 originally reserved `TopSheet` as a one-off primitive for the
BrandSwitcherSheet dropdown UX, with kit closure rule requiring orchestrator
approval + DEC entry for any new use.

ORCH-0826 (M0 Hub Foundation) extends TopSheet to UniversalCreatorSheet
because:

1. The "+" button origin is at the top-right of the topbar (matches TopSheet's drop-from-top geometry)
2. Visual continuity with BrandSwitcherSheet's drop pattern
3. Bottom Sheet primitive was the alternative; operator overrode forensics recommendation in favor of TopSheet for visual continuity

This required ALSO adding a new `heightMode="compact"` prop to TopSheet for
content-fit rendering (the 3-row UniversalCreatorSheet doesn't need 70% of
screen). The compact mode is additive — BrandSwitcherSheet remains
backward-compatible at `heightMode="fixed-70"` (default).

# What's covered

- TopSheet now has two acceptable uses: BrandSwitcherSheet (legacy) and
  UniversalCreatorSheet (ORCH-0826). Future additional uses still require
  orchestrator approval + DEC entry per the kit-extension rule.

- TopSheet's `heightMode` prop is additive; existing consumers don't need
  to change anything.

# Cross-references

- DEC-080 (original TopSheet carve-out) — historical context
- DEC-NEW-A (TopSheet usage extended) — ORCH-0826 close
- DEC-NEW-B (TopSheet compact-height mode) — ORCH-0826 close
- Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md §6.1 — extension spec
```

### Step 18 — Smoke test (iOS Simulator)

Follow the 22-step smoke test in §15. Capture screenshots/screen recording per Prime Directive 7. Confirm all 37 test cases pass.

### Step 19 — Commit + push

Per `Mingla_Artifacts/MINGLA_ENGINEERING_HANDBOOK.md` §7:

```bash
git add <scoped files>
git commit -m "$(cat <<'EOF'
ORCH-0826 M0: Hub Foundation + Universal Creator + events.event_type discriminator

- Bottom-nav Events tab renamed to Hub with three sub-tabs (Events/Experiences/Trips)
- Hub > Events relocated; Experiences + Trips show Coming Soon placeholders
- Top-bar "+" added on Home, Hub, Marketing, Account (NOT Ari)
- Marketing composer screen hides the "+"
- UniversalCreatorSheet uses new TopSheet heightMode="compact" mode
- Home empty-state "+ Build event" button removed; new copy points to top-bar "+"
- Hard rename: all /events callers → /hub/events; old file deleted
- Migration: events.event_type discriminator (event/experience/trip)
- Two new DEC entries: TopSheet usage extension + compact-height mode

Migration MUST be applied before EAS OTA; native module changes: none.
EOF
)"
git push origin Seth
```

### Step 20 — Notify operator + orchestrator

Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0826_M0_HUB_FOUNDATION.md` per the engineering handbook §6 template. Include:
- Acceptance criteria status (all 22)
- Files changed (full list)
- Migration to push
- Edge function deploys: NONE for M0
- Smoke test result
- Known issues / deferred
- Operator action required: `supabase db push --linked` for the migration

Then ping orchestrator: "M0 implementation complete, ready for TEST."

---

## §12 — Regression Prevention

### Class of change

Tab rename + new top-level primitive extension + new column + new component family. Future similar work (e.g., adding a new sub-tab in Hub) should follow the same pattern.

### Structural safeguards

1. **Strict-grep CI gates already enforce I-37 / I-38 / I-39.** No new CI gate needed for M0.
2. **The new `events.event_type` column has a CHECK constraint** preventing invalid values. Any INSERT with an out-of-enum value is rejected at the DB layer.
3. **The new test `hub_navigation.test.tsx`** asserts the TABS array structure (Hub in slot 2) AND that no internal callers reference `/events` (regression-blocks any future accidental revert).
4. **The TopSheet `heightMode` prop has a default value** (`"fixed-70"`) — existing consumers stay compatible without code changes.

### Protective comments

In the migration file: prominent header comment citing ORCH-0826 + I-1.2-UNIFIED-EVENT-TYPE + the investigation report path.

In `TopSheet.tsx`: prominent JSDoc on the `heightMode` prop citing DEC-NEW-A + DEC-NEW-B.

In the relocated `hub/events.tsx`: a short comment at the top noting "Relocated from `(tabs)/events.tsx` by ORCH-0826 (Hub Foundation). Content otherwise unchanged."

### Future-proofing

If a future cycle wants to add a 4th offering type (e.g., `class`), only the migration's CHECK constraint needs ALTER:
```sql
ALTER TABLE public.events
  DROP CONSTRAINT events_event_type_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN ('event', 'experience', 'trip', 'class'));
```

The UniversalCreatorSheet's OPTIONS array adds a 4th row. No other changes needed.

---

## §13 — DEC entries (NEW for CLOSE)

The orchestrator writes these into `DECISION_LOG.md` at CLOSE time, assigning the next DEC-XXX numbers in sequence.

### DEC-NEW-A — TopSheet usage extended beyond BrandSwitcherSheet to UniversalCreatorSheet

**Date:** 2026-05-14 (proposed; finalized at CLOSE)
**Context:** ORCH-0826 M0 Hub Foundation. Operator override of forensics' bottom-Sheet recommendation (Q2 of investigation Open Questions).
**Decision:** TopSheet is no longer reserved for the BrandSwitcherSheet only. UniversalCreatorSheet (ORCH-0826) is added as a second acceptable consumer. Future additional TopSheet consumers still require orchestrator approval + new DEC entry per the kit-extension rule.
**Rationale:** The "+" button origin is at the top-right of the topbar; TopSheet's drop-from-top geometry provides visual continuity with the brand chip's drop pattern. The operator preferred this visual model over the bottom-Sheet alternative.
**Implications:**
- DEC-080's "reserved for brand-switcher only" clause is superseded by DEC-NEW-A's "two acceptable consumers" clause
- DEC-080 remains as historical context
- `feedback_topsheet_extended_universal_creator.md` (Claude memory) is the canonical reference for future skills
**Enforcement:** documented in TopSheet.tsx JSDoc; no CI gate.

### DEC-NEW-B — TopSheet gains heightMode="compact" mode

**Date:** 2026-05-14
**Context:** ORCH-0826 M0. The 3-row UniversalCreatorSheet needs content-fit height; TopSheet's existing 70% fixed-height is too tall.
**Decision:** TopSheet gains an additive `heightMode?: "fixed-70" | "compact"` prop. Default is `"fixed-70"` (backward-compatible with BrandSwitcherSheet). `"compact"` uses `onLayout` measurement to fit content height.
**Rationale:** Adding `heightMode="compact"` is preferable to forking the primitive or working around the fixed height with internal scroll. Additive props preserve backward compatibility.
**Implications:** any TopSheet consumer can opt into compact mode; BrandSwitcherSheet stays at fixed-70.
**Enforcement:** unit test in `TopSheet.heightMode.test.tsx`.

---

## §14 — Cross-Domain Risk Assessment

Per investigation §6. SPEC re-verifies + documents:

### `business-publish-event-draft` RPC

**Required pre-migration read:** `supabase/migrations/20260525000000_orch_0792_publish_writes_event_dates.sql`

Implementor reads the RPC body and verifies:
- INSERT uses named-column syntax (not positional VALUES)
- If `event_type` is not explicitly inserted, the column DEFAULT `'event'` applies
- The RPC continues to work for popup-brand events (which is all events pre-Tr2)

**If the RPC uses positional INSERT** (which would be unusual for Postgres but possible): the implementor either (a) updates the RPC to use named columns, OR (b) updates the RPC to explicitly write `event_type='event'`. Either way, this becomes an additional file in the M0 scope.

### Realtime publication

```sql
SELECT pubname, tablename FROM pg_publication_tables
  WHERE schemaname='public' AND tablename='events';
```

If `events` is in `supabase_realtime` or any other publication, the snapshot refresh on `supabase db push` may take 10-30s. The implementor notes this in the implementation report so the operator expects the delay during migration apply.

### Edge function consumers

6 edge functions select from `events`. None filter on `event_type` (the column doesn't exist yet). All continue to work unchanged after the column add. The implementor performs spot-checks on 1-2 of them (e.g., `discover-merged-events`) by greping for `SELECT` patterns and confirming they don't break.

### Consumer app and admin

Per investigation: 0 reads from `events` in `app-mobile/` and `mingla-admin/`. No impact.

### Marketing Hub composer

The composer reads `events_with_master_date_view`. That view doesn't auto-inherit `event_type` (per investigation D-0826-3). M0 does NOT update the view. If the composer needs to filter to `event_type='event'` post-Tr2, that's a Tr2 SPEC concern.

---

## §15 — Smoke Test Procedure (iOS Simulator)

A human runs this end-to-end before declaring M0 complete. Captures screenshots/screen recording per Prime Directive 7 conventions.

1. **Fresh app launch.** Build + install dev build per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (do NOT use `npx expo run:ios` per the ORCH-0823 close). Sign in with a test account that has at least 1 brand + 1 live event + 1 draft event.

2. **Verify bottom nav.** Confirm slot 2 reads "Hub" with calendar icon. No "Events" tab visible.

3. **Tap Hub tab.** Verify HubSubNav renders with 3 pills (Events / Experiences / Trips). Events pill is active by default.

4. **Verify Hub > Events content.** Today's events list renders. Filter pills work. Manage menu opens. (Same content as pre-M0.)

5. **Tap Experiences pill.** Verify routing + Coming Soon placeholder renders.

6. **Tap Trips pill.** Verify routing + Coming Soon placeholder renders.

7. **Return to Events pill.**

8. **Tap top-bar "+".** Verify UniversalCreatorSheet drops down at compact height (~280-340px). 3 rows visible.

9. **Tap "Create event".** Verify sheet dismisses + routing to existing event creation flow.

10. **Back out (dismiss event create).** Tap "+", then tap "Create experience". Verify Coming Soon stub renders with back button.

11. **Tap Back.** Verify returns to previous Hub sub-tab.

12. **Tap "+", then tap "Create trip or otherwise".** Verify Coming Soon stub renders.

13. **Back out.** Tap Home tab.

14. **Verify Home top-bar "+".** Same sheet opens.

15. **Sign out + sign in as test account with ZERO events.** Verify Home empty state shows new copy without the big "+ Build event" button.

16. **Tap Marketing (Blast) tab.** Verify top-bar "+" present. Tap it → same sheet opens.

17. **Navigate into Marketing > Campaigns > Compose (new).** Verify top-bar "+" is HIDDEN on the composer route.

18. **Back to Marketing index.** Verify top-bar "+" visible again.

19. **Tap Account tab.** Verify top-bar "+" present.

20. **Tap Ari tab.** Verify NO "+" on Ari's TopBar.

21. **Regression: tap Hub > Events → tap an existing live event → Manage → End ticket sales.** Verify the end-sales sheet opens (existing behavior).

22. **Open BrandSwitcherSheet.** Verify it still opens at 70% height with internal scroll (TopSheet regression check).

If any step fails, do NOT commit the final M0 commit. Fix and re-run.

---

## §16 — Open Questions for Implementor (decisions during implementation)

These are decisions SPEC defers to the implementor (Seth) based on what they find during implementation. They're not blockers but worth being explicit about.

**Q-IMPL-1:** If the `business-publish-event-draft` RPC uses positional INSERT (unlikely but possible), should the implementor update the RPC in the same M0 migration, or split into a follow-up ORCH? **SPEC recommends:** update in same migration, scope-allowed.

**Q-IMPL-2:** Sub-tab pill styling — match Marketing's exact MarketingSubNav style or design a Hub-specific variant? **SPEC recommends:** mirror Marketing's style for parity; visual designer can polish in a future cycle.

**Q-IMPL-3:** "compass" icon for the Trip option — does it exist in the IconBrand set? **SPEC recommends:** verify in `src/components/ui/Icon.tsx` and `BrandIcons.tsx`; if not, use a substitute (e.g., `map`) or add it (small primitive addition).

**Q-IMPL-4:** When pushing to `/event/create` from the UniversalCreatorSheet, the existing flow opens a draft event. Should the sheet `onClose` happen BEFORE the push (and `setTimeout` to push), or after? **SPEC recommends:** close first with `setTimeout(50)` then push (per §6.2 implementation) — gives the sheet animation time to begin.

**Q-IMPL-5:** Marketing `_layout.tsx` mounts TopBar shared across sub-routes, but each sub-route currently has its own TopBar in the existing code. **SPEC clarification:** read the existing marketing sub-routes to see; if they each mount their own TopBar today, the implementor either consolidates to `_layout.tsx` OR adds `extraRightSlot` to each sub-route's TopBar. Trade-off: consolidation is cleaner; per-route is lower-touch. **SPEC recommends:** consolidate via `_layout.tsx`.

---

## §17 — Artifact metadata

- **SPEC path:** `Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md`
- **Length:** ~1650 lines
- **Sections:** 17 (§1-§17)
- **Test cases:** 37
- **Success criteria:** 22
- **NEW invariants established:** 1 (I-1.2-UNIFIED-EVENT-TYPE)
- **NEW DEC entries queued:** 2 (DEC-NEW-A, DEC-NEW-B)
- **NEW memory files queued:** 1 (`feedback_topsheet_extended_universal_creator.md`)
- **Files to create:** 9 (TopSheet test + UniversalCreatorSheet + 2 stubs + Hub layout + HubSubNav + 2 sub-route placeholders + HubSubNav test + hub navigation test)
- **Files to modify:** 9 ((tabs)/_layout.tsx, home.tsx, account.tsx, marketing/_layout.tsx, TopSheet.tsx, routes.ts, and the relocated hub/events.tsx + 6 callers of `/events`)
- **Files to delete:** 1 ((tabs)/events.tsx)
- **Migrations to apply:** 1 (events.event_type discriminator)
- **Edge function deploys:** 0
- **Execution model:** solo by Seth (per Q8 override)
- **Estimate:** ~1.5 weeks
- **Confidence:** H (investigation confidence H; operator overrides documented and implementable)

---

## §18 — Next phase routing

After SPEC operator review + approval:
1. Implementation begins (Seth solo per Q8)
2. Migration applied locally first (Seth verifies); applied to remote by `supabase db push --linked` when implementation is otherwise complete
3. Edge function deploys: NONE for M0
4. Smoke test on iOS Simulator
5. Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0826_M0_HUB_FOUNDATION.md`
6. Hand to Claude `mingla-forensics` (TEST mode) for QA verdict
7. Orchestrator CLOSE — including TestFlight EAS OTA (`eas update --branch production --platform ios` + `--platform android`), DECISION_LOG entries (DEC-NEW-A, DEC-NEW-B), memory flip (DRAFT → ACTIVE on `feedback_topsheet_extended_universal_creator.md`), project board issue #90 status flip to Done

Working tree throughout: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

*End of SPEC. Implementor: Seth (solo). Time estimate: ~1.5 weeks. Implementation begins on operator approval.*
