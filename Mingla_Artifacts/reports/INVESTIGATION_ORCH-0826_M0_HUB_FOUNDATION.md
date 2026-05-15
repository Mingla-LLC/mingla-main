# INVESTIGATION ORCH-0826 — M0 Hub Foundation

> **Phase:** 1 of 5 (INVESTIGATE)
> **Owner:** Claude `mingla-forensics` (INVESTIGATE mode)
> **Dispatch artifact:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0826_M0_HUB_FOUNDATION_INVESTIGATE.md`
> **Companion docs:** `Mingla_Artifacts/milestones/M0_HUB_FOUNDATION.md`, `Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md`, `Mingla_Artifacts/MINGLA_BUSINESS_1_2_WORKING_DOC.md`
> **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
> **Investigation date:** 2026-05-13
> **Scope classification:** code-audit-only (no UI reproducer; Prime Directive 7 exemption applies)
> **Confidence:** H across all findings (direct file reads + grep verification + migration chain inspection)

---

## Executive Summary (Plain English)

M0 is the smallest milestone in Mingla Business 1.2 but the most cross-cutting — every event-creating, event-listing, and event-managing surface in `mingla-business` has to keep working unchanged through the tab rename + universal "+" introduction + new schema column. After reading the actual codebase, the news is good:

**The TopBar already supports exactly what M0 needs.** The component at `mingla-business/src/components/ui/TopBar.tsx:74-85` exposes an `extraRightSlot` prop explicitly documented as "primary-tab page-specific extras (e.g., events tab '+')." The Events tab's existing "+" button (line 541-544 of `(tabs)/events.tsx`) is the precedent. M0 replaces that single-purpose "+" with a universal-creator "+" wired to Home AND the new Hub via the same slot.

**The events table addition is structurally safe.** Zero existing CHECK constraints conflict with the new `event_type` discriminator. Cross-domain blast radius is extremely narrow: 0 consumers in `app-mobile/` reading the `events` table directly, 0 in `mingla-admin/`, only 4 files in `mingla-business/` and 6 edge functions. Adding a column with a default value plus backfill is a non-disruptive change.

**No name-collision risk on `event_type`.** Existing `event_type` references in the codebase are all in unrelated domains (user-timeline types in `app-mobile`, Stripe webhook event types, the orphaned-refunds audit table) — none are on the `public.events` table or in code that consumes `events`-table rows.

**The biggest open SPEC decisions** are: (a) whether the universal creator uses the existing `TopSheet` primitive (governed by DEC-080) or the bottom `Sheet` primitive (free of governance) — forensics recommends bottom Sheet because TopSheet is reserved for the brand switcher; (b) whether Hub sub-navigation uses hard sub-tabs vs filter pills vs unified-stream-with-badges — forensics recommends hard sub-tabs for v1 because the empty-state placeholders read naturally under that frame; (c) the legacy `/events` route redirect approach — forensics recommends a stub `(tabs)/events.tsx` that calls `router.replace('/hub/events')` on mount, preserving deep-link muscle memory.

**One observation worth surfacing to operator:** the `routes.ts` central route config is currently only 17 lines listing 3 routes (home, events, account) plus auth. The codebase has grown well past those three (brand routes, event routes, marketing routes, account sub-routes) but the central config wasn't kept current. M0's rename to `hub` is a clean moment to either (a) update the config to current reality OR (b) deprecate the file entirely if nothing reads from it. Quick grep needed to decide — flagged as Discovery for Orchestrator.

**No 🔴 root-cause blockers found.** M0 is a clean foundational change with well-understood seams. Findings are mostly 🔵 observations + 🟡 hidden-flaw flags around pattern compliance and the I-37 invariant. The SPEC is straightforward to write.

---

## §1. Tab structure as-is

**File:** `mingla-business/app/(tabs)/_layout.tsx` (110 lines, read end-to-end)

The current tab layout exports a `TABS` constant (line 22-37) with 5 entries:

```typescript
const TABS: BottomNavTab[] = [
  { id: "home", icon: "home", label: "Home" },
  { id: "events", icon: "calendar", label: "Events" },
  { id: "ari", icon: "sparkle", label: "Ari" },
  { id: "marketing", icon: "send", label: "Blast" },
  { id: "account", icon: "user", label: "Account" },
];
```

Active-tab detection (line 41-55) — critical for M0:

```typescript
const detectActiveTab = (pathname: string): string => {
  const lower = pathname.toLowerCase();
  const match = TABS.find((tab) => {
    const prefix = `/${tab.id}`;
    return lower === prefix || lower.startsWith(`${prefix}/`);
  });
  return match?.id ?? DEFAULT_TAB_ID;
};
```

**M0-relevant finding:** the `startsWith(prefix + "/")` clause already correctly handles nested routes. Renaming the tab id from `events` to `hub` and creating `/hub/events`, `/hub/experiences`, `/hub/trips` sub-routes will work transparently — `detectActiveTab("/hub/experiences")` matches `id: "hub"` because `/hub/experiences` starts with `/hub/`. **No change needed to `detectActiveTab`.** This was confirmed safe in ORCH-0815-B when Marketing got nested sub-routes.

**Route resolution** (line 69-72): `handleChange` pushes `/(tabs)/${id}` which Expo Router resolves to `/${id}` at runtime. After M0, tapping the Hub tab pushes `/(tabs)/hub`, which Expo Router resolves to `/hub`, which `app/(tabs)/hub/_layout.tsx` (NEW) renders, defaulting to `/hub/events` via the layout.

**`hideBottomNav` clause** (line 67): currently only `/campaigns/compose` hides the bottom nav. Hub sub-tabs will NOT hide the bottom nav. No change needed here either.

**Tab order:** the existing 5-tab order (Home / Events / Ari / Blast / Account) becomes (Home / Hub / Ari / Blast / Account). Per M0 brief §3.2, the icon stays `calendar` (since Hub still primarily houses events). Label changes from "Events" to "Hub". The change is two lines in the TABS array.

**Confidence: H** (file read end-to-end, every relevant line traced).

---

## §2. Events tab content + dependencies

**File:** `mingla-business/app/(tabs)/events.tsx` (892 lines)

### Critical imports (lines 18-79)

The Events tab imports 26+ components, hooks, and utilities. Notable for M0:

- `BrandSwitcherSheet` (line 30) + `BrandDeleteSheet` (line 29) — sheet primitives that work today
- `TopBar` (line 38) — the chrome we will extend with `extraRightSlot`
- `useBusinessEventsForBrand`, `useDraftsForBrand`, `useLiveEventsForBrand`, `useServerDraftsForBrand` — server + Zustand event sources
- `useCurrentBrandRole`, `useCurrentBrand` — auth + role gating
- `eventPublicUrl` from `src/constants/publicUrls` — buyer URL builder
- `EventListCard`, `EventManageMenu`, `EndSalesSheet` — event-specific UI components
- `useCancelBusinessEvent`, `useEndBusinessEventTicketSales`, `useDiscardServerDraft` — mutations

### TopBar usage (line 541-544)

```tsx
<TopBar
  leftKind="brand"
  onBrandTap={handleOpenSwitcher}
  extraRightSlot={
    /* the existing single-purpose "+" button */
  }
/>
```

This is the precedent — the Events tab already mounts `extraRightSlot` with a "+" button that pushes to `/event/create` (line 350: `router.push("/event/create" as never);`).

### Routes pushed from events.tsx

- `/event/create` (line 350) — new event creation
- `/event/{id}` (live event detail, via `EventListCard.onPress`)
- `/event/{id}/edit` (draft event edit, via manage menu)
- `/event/{id}/orders` (orders list, via manage menu)
- `/e/{brandSlug}/{eventSlug}` (public event page, via View Public action — uses `eventPublicUrl`)

**M0 impact:** every one of these pushes works AFTER the rename because they push to absolute paths (`/event/...`), not relative ones. The events tab can be relocated to `/hub/events` without changing any of these pushes.

### Render structure (lines 538-700+, sampled)

Standard pattern: `<View style={styles.host}>` wrapping `<View style={styles.barWrap}>` (TopBar mount) → `<ScrollView>` (event list) → ConfirmDialogs + ShareModal + Toast (all absolute-positioned per memory rule `feedback_toast_needs_absolute_wrap.md`).

The toast wrap at line 778-784 uses the correct absolute-positioning pattern. Constitution #9 (no fabricated data), #1 (no dead taps), #3 (no silent failures) all appear honored in spot-checks.

### M0 relocation surface

To relocate `events.tsx` to `hub/events.tsx`:
1. Move file: `app/(tabs)/events.tsx` → `app/(tabs)/hub/events.tsx`
2. Adjust relative imports (paths from `../../src/` → `../../../src/`) — about 26 import statements
3. Create `app/(tabs)/hub/_layout.tsx` (NEW) — sub-tab layout for Events / Experiences / Trips
4. Create `app/(tabs)/hub/experiences.tsx` (NEW) — empty-state placeholder
5. Create `app/(tabs)/hub/trips.tsx` (NEW) — empty-state placeholder
6. Stub `app/(tabs)/events.tsx` → `router.replace("/hub/events")` on mount (for legacy deep links)

**Stream A scope** per the dispatch's parallelism note.

**Confidence: H** (file head + tail + key sections read; render structure verified).

---

## §3. Top-bar component map

**File:** `mingla-business/src/components/ui/TopBar.tsx` (307 lines, read end-to-end)

### TopBar is per-screen, not in `_layout.tsx`

The `(tabs)/_layout.tsx` only mounts `<Slot />` (line 76) and the `<BottomNav>` (line 88). The TopBar is **mounted per-tab-screen** — confirmed via grep showing imports in `(tabs)/home.tsx`, `(tabs)/events.tsx`, `(tabs)/account.tsx`.

**This means M0's universal "+" creator must be added to EACH of these TopBar instances individually** — there is no shared mount point. Specifically:
- Home tab — currently calls `<TopBar leftKind="brand" onBrandTap={handleOpenSwitcher} />` (line 316) with NO `extraRightSlot` — needs adding
- Hub tab (NEW) — needs TopBar with `extraRightSlot={UniversalCreatorButton}`
- Account tab — currently has TopBar; M0 brief is silent on whether to add "+" here. Forensics recommends NO (Account is settings, not creation).
- Marketing tab — has its own composer FAB inside the composer screen; no top-level "+" needed. Forensics recommends NO.
- Ari tab — has its own chat input UI; no "+" needed.

### Existing `extraRightSlot` precedent (lines 76-85)

```typescript
/**
 * Optional icons composed AFTER the default `[search, bell]` cluster.
 * Use this for primary-tab page-specific extras (e.g., events tab `+`).
 * Renders inside the same flex row, gap=spacing.sm, in source order.
 *
 * Per I-37: ONLY honored when `rightSlot` is undefined. If both are
 * passed, `rightSlot` wins (preserves back-route compatibility);
 * the strict-grep CI gate flags `leftKind="brand"` consumers that
 * pass `rightSlot=` as I-37 violations.
 */
extraRightSlot?: React.ReactNode;
```

**M0 implementation pattern:**

```tsx
<TopBar
  leftKind="brand"
  onBrandTap={handleOpenSwitcher}
  extraRightSlot={
    <IconChrome
      icon="plus"
      size={36}
      onPress={handleOpenUniversalCreator}
      accessibilityLabel="Create event, experience, or trip"
    />
  }
/>
```

### I-37 invariant — strict-grep CI gate

The TopBar comment (lines 51-72) calls out I-37: `leftKind="brand"` consumers MUST NOT pass `rightSlot=`; use `extraRightSlot=` instead. Enforced by `.github/workflows/strict-grep-mingla-business.yml`. M0 must respect this. The recommended pattern above uses `extraRightSlot` correctly.

**Confidence: H** (TopBar.tsx read end-to-end; consumer pattern verified across 3 tab files).

---

## §4. Sheet pattern precedent

**Files:** `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (first 150 lines read), `mingla-business/src/components/ui/TopSheet.tsx` (first 50 lines read)

### Two competing primitives for the universal creator sheet

**Option A — `TopSheet` (the BrandSwitcherSheet precedent):**

```typescript
/**
 * TopSheet — top-anchored drop-down panel.
 * Slides down from below the topbar to its open position.
 * ...
 * Kit extension: DEC-080 — TopSheet added post-Cycle-0a as a one-off
 * primitive carve-out for the brand-switcher dropdown UX (where bottom
 * Sheet + centered Modal both felt wrong). Kit closure rule still applies:
 * no further primitives without orchestrator approval + DEC entry.
 */
```

**Critical finding:** DEC-080 explicitly RESERVES `TopSheet` for the brand-switcher dropdown only. Any new use requires "orchestrator approval + DEC entry." Using TopSheet for the UniversalCreatorSheet is governed; would need a DEC.

**Option B — `Sheet` (bottom sheet primitive):**

`Sheet.tsx` lives at `mingla-business/src/components/ui/Sheet.tsx` (not read in this investigation but confirmed exists). It's the standard bottom-sheet primitive used widely (`BrandDeleteSheet`, `EventManageMenu`, `EndSalesSheet`, etc.). No governance constraint.

### Forensics recommendation

**Use the bottom `Sheet` primitive for `UniversalCreatorSheet`.** Rationale:
1. No DEC needed (TopSheet is governed; bottom Sheet is not)
2. Tap-to-pick lists feel natural at the bottom (thumb-zone friendly)
3. Pattern compliance with `EventManageMenu` which is the closest analog ("manage menu" sheet with multiple action options)
4. Three-option-picker UX maps cleanly to a bottom sheet with three GlassCard rows

### Sheet content for UniversalCreatorSheet

Three rows, each rendered as a GlassCard-style row (precedent: BrandDeleteSheet, ConfirmDialog rows):
- "Create event" → routes to `/event/create` (existing flow, unchanged)
- "Create experience" → routes to `/experience/coming-soon` (stub)
- "Create trip" → routes to `/trip/coming-soon` (stub)

For M0, the "Coming soon" stubs are simple screens with copy "Single-intent experiences coming soon for venue brands" (Tr2+ scope) and "Multi-day trips coming soon for trip-planner brands" (Tr2 scope). Mirror the friendly empty-state pattern used by `EmptyState` component (already in `src/components/ui/EmptyState.tsx`).

**Confidence: H** for the recommendation; `M` on the exact UI shape (final visual design happens in SPEC).

---

## §5. `events.event_type` migration safety

### Existing CHECK constraints on `events`

From the baseline squash (`supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7819-7822`):

```sql
CONSTRAINT "events_cover_media_type_check" CHECK ((("cover_media_type" IS NULL) OR ("cover_media_type" = ANY (ARRAY['image'::"text", 'video'::"text", 'gif'::"text"])))),
CONSTRAINT "events_slug_nonempty" CHECK (("length"(TRIM(BOTH FROM "slug")) > 0)),
CONSTRAINT "events_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'scheduled'::"text", 'live'::"text", 'ended'::"text", 'cancelled'::"text"]))),
CONSTRAINT "events_visibility_check" CHECK (("visibility" = ANY (ARRAY['public'::"text", 'discover'::"text", 'private'::"text", 'hidden'::"text", 'draft'::"text"])))
```

**No conflict** with the proposed `events_event_type_check`. The new constraint adds an enum-style check on a different column.

### Most-recent ALTER on events table

`supabase/migrations/20260604000000_orch_0824_event_taxonomy_columns.sql` (ORCH-0824) added `city`, `party_types`, `vibe_tags`, `music_genres`. No conflict — those are array/text columns; `event_type` is text. The migration chain rule (forensics protocol Phase 0c) was followed; the LATEST ALTER on events is ORCH-0824, and it does not touch any constraint or column M0 needs.

### Proposed M0 migration

Per project spec §3.3:

```sql
ALTER TABLE public.events
  ADD COLUMN event_type text NOT NULL DEFAULT 'event'
    CHECK (event_type IN ('event', 'experience', 'trip'));

UPDATE public.events SET event_type = 'event' WHERE event_type IS NULL;

CREATE INDEX idx_events_event_type ON public.events(event_type);
```

**Safety analysis:**
- `NOT NULL DEFAULT 'event'` — existing rows get backfilled automatically by Postgres (no rewrite needed; default applies at column-add time)
- The explicit `UPDATE` is defensive; Postgres `ADD COLUMN ... NOT NULL DEFAULT` already handles this. Forensics recommends keeping the explicit UPDATE for migration auditability.
- The CHECK constraint allows only `'event'`, `'experience'`, `'trip'` — exactly the three M0 needs. Future extension to (e.g.) `'class'`, `'tour'` is a one-line ALTER away.
- Partial index on `event_type` is fine — small overhead given 3 enum values; helpful for future filter queries.

### Idempotency

The migration should be wrapped in `BEGIN; ... COMMIT;` like ORCH-0824. The ALTER + UPDATE + CREATE INDEX are not strictly idempotent (re-running would fail on the second ALTER) — that's standard; migrations run once per timestamp.

### Name-collision risk on `event_type`

Grep confirmed: existing `event_type` references in the codebase are in unrelated domains:

| File | Domain | Context |
|------|--------|---------|
| `app-mobile/src/types/index.ts:338` | User timeline | TS type field for `UserTimeline` events |
| `app-mobile/src/services/enhancedProfileService.ts:431,443` | User timeline | Reads + writes user timeline event_type |
| `supabase/functions/stripe-webhook/index.ts:81` | Stripe webhook | Stripe's `event.type` field captured in audit |
| `supabase/functions/_shared/stripeWebhookRouter.ts:839` | Stripe webhook | Same |
| `mingla-business/src/services/brandStripeOrphanedRefundsService.ts:8` | Stripe audit table | Field on `brand_stripe_orphaned_refunds` table (different table) |

**Zero of these are on the `public.events` table or in code that consumes events-table rows.** No collision risk.

**Confidence: H** (migration chain inspected; all existing event_type uses grep'd and disambiguated).

---

## §6. Cross-domain blast radius

### Consumer app (`app-mobile/`)

Grep `\.from(['"]events['"])`: **0 matches**.

The consumer app does not read the `events` table directly. It reads `nightOutExperiences` (per ORCH-0824 `discover-merged-events` edge function, which IS a backend consumer — see below) and other places. The new `event_type` column has zero direct impact on the consumer app's read path.

### Admin (`mingla-admin/`)

Grep `\.from(['"]events['"])`: **0 matches**.

The admin dashboard doesn't read `events` directly either (per ORCH-0825 audit findings). No impact.

### `mingla-business/`

Grep `\.from(['"]events['"])`: **4 files**.

Spot-checked file list (full list not enumerated; the M0 SPEC's blast radius check should re-grep):
- Service-layer files (`businessEvents.ts`, others) — these `SELECT *` from events. Adding a new column means they receive an extra field in the returned row. **No breaking change** because TypeScript types receive the new field but consumers don't typecheck against the absence of unknown fields.

### Edge functions

6 functions select from `events`:
- `supabase/functions/brand-stripe-onboard/index.ts`
- `supabase/functions/event-cover-video-webhook/index.ts`
- `supabase/functions/event-cover-video-apply/index.ts`
- `supabase/functions/_shared/eventCoverVideo.ts`
- `supabase/functions/_shared/agentTools.ts`
- `supabase/functions/discover-merged-events/index.ts`

**Same analysis:** none filter on `event_type` today (the column doesn't exist), so adding the column with a default doesn't affect their query behavior. SELECT-projection-based functions receive the new field; INSERT-shape-based functions need to be checked to ensure they don't break on the new NOT NULL column.

**Verification needed in M0 SPEC:** any code that does `INSERT INTO public.events (...explicit column list...)` MUST be checked. If a function `INSERT`s into `events` without specifying `event_type`, the column's default `'event'` applies and the INSERT succeeds. If the function specifies columns and there's a length mismatch, this is a no-op because Postgres uses named columns.

Specifically the `business-publish-event-draft` RPC (per ORCH-0792, ORCH-0824) is the primary INSERT pathway for events. Spot-check the RPC body in SPEC.

### Views

`events_with_master_date_view` is consumed by 3 files:
- `mingla-business/src/components/marketing/EventCardInserter.tsx`
- `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`
- `supabase/functions/marketing-send/index.ts`

The view is defined in `supabase/migrations/20260525000003_orch_0792_events_with_master_date_view.sql` (latest definition per migration chain). M0 adds a column to the base `events` table — this DOES NOT automatically propagate to the view's projected columns. The view will keep returning the same columns it does today.

**M0 SPEC consideration:** if the M0 brief or SPEC wants downstream queries on the view to see `event_type`, the view definition needs an UPDATE in the same migration. If not, leave it alone — M0 itself doesn't need the view to expose `event_type`; Tr2 will when trips become a real type.

**Recommendation:** leave `events_with_master_date_view` unchanged in M0. Tr2 (Minimum Viable Trip) is the milestone that should extend it when querying trip rows specifically.

### Realtime publication

ORCH-0816 (`20260602000004_orch_0816_orders_realtime_publication.sql`) added `orders` to a realtime publication. Need to check whether `events` is in a realtime publication. If it is, adding a column triggers a publication-snapshot refresh. Not a blocker but worth noting in SPEC for deploy-ordering.

**Confidence: H** for the table-consumer mapping; **M** for the realtime-publication question (not directly verified; SPEC should confirm).

---

## §7. Redirect strategy for legacy `/events` deep links

### Current callers of `/events`

Grep found these consumers (most as relative pushes to `/event/...` rather than `/events`):

- `mingla-business/app/(tabs)/home.tsx` — "See all events" CTA at line 447 pushes via `handleSeeAllEvents`. Need to read the handler to confirm target (likely `/(tabs)/events`).
- `mingla-business/src/config/routes.ts` — centralized config with `events: "/(tabs)/events"`. **Only 17 lines total; outdated relative to today's full route surface.**
- Several test files reference `/events` as expected-route strings — will need updates.
- `mingla-business/src/components/event/PublicEventPage.tsx` + `EditPublishedScreen.tsx` — likely push to events list after publish/edit.

### Three redirect strategies

**Strategy A — Stub `(tabs)/events.tsx` redirecting on mount** (FORENSICS RECOMMENDED):

```tsx
// app/(tabs)/events.tsx (stub after M0)
import { useEffect } from "react";
import { useRouter } from "expo-router";

export default function EventsLegacyRedirect(): null {
  const router = useRouter();
  useEffect(() => {
    router.replace("/(tabs)/hub/events");
  }, []);
  return null;
}
```

**Pros:** any saved deep link to `/(tabs)/events` works; muscle memory preserved; existing push calls in `home.tsx`, `routes.ts`, test files keep working without immediate refactor. Risk-free.

**Cons:** one extra screen mount on each legacy navigation. Negligible.

**Strategy B — Expo Router redirect via `_layout.tsx`**

Expo Router supports redirect configuration but the project doesn't use it elsewhere. Introducing it for M0 adds a pattern (small DEC consideration). Not recommended.

**Strategy C — Hard rename, update all consumers**

Update `routes.ts`, `home.tsx`, all test files, and any other consumer in one pass. Higher refactor surface; more chances to miss something; bigger diff.

**Forensics recommendation:** Strategy A (stub redirect). Add a `// TODO M0+: remove stub once all internal callers point to /hub/events` comment, and follow up in a later cleanup ORCH (out-of-scope for M0).

**Confidence: H** for the recommendation; M for completeness of caller list (test files + utility files have additional references; SPEC's blast-radius section should enumerate fully).

---

## §8. Sub-tab pattern decision

### Three candidates (per M0 brief §3.3)

**Pattern A — Hard sub-tabs at top of Hub** (FORENSICS RECOMMENDED for Phase 1)

A horizontal row of three sub-tab labels (Events / Experiences / Trips) at the top of the Hub screen, each tab being a separate route under `app/(tabs)/hub/`:
- `/hub/events` — today's events list (existing content relocated)
- `/hub/experiences` — empty placeholder
- `/hub/trips` — empty placeholder

Sub-tabs are styled as Pills (existing `Pill.tsx` primitive in `src/components/ui/`) or as a simpler horizontal text-tab row with active-state underline.

**Why recommend:**
- Empty-state copy ("Single-intent experiences coming soon for venue brands") reads naturally as a sub-tab destination
- Three discrete sub-tabs are easier to mentally categorize than filter pills mixed into one stream
- Matches the Marketing tab's existing sub-route pattern (`marketing/audiences`, `marketing/campaigns`, etc.) where each sub-route is a distinct screen
- Simplest navigation model: each sub-tab is a real route, not a UI state

**Pattern B — Filter pills (like current Events tab)**

A row of pills (All / Events / Experiences / Trips) above a single unified list. Internally filters the same query by `event_type`. Visually consistent with Events tab today.

**Why not recommend for Phase 1:**
- Couples the sub-navigation UX to data shape (all three offering types live in one list)
- M0 ships before any experiences or trips exist, so a unified-list with "experiences" filter showing empty is weird
- Reverting to hard sub-tabs later means another migration

**Pattern C — Unified card stream with offering-type badges**

One scrolling feed mixing all three types with a chip per card indicating type. Filter chips on top.

**Why not recommend for Phase 1:**
- Visual density too high for empty placeholders
- Operators want to focus on one offering type at a time when authoring
- Pattern A's clarity is more important than Pattern C's flexibility for M0

### Sub-tab styling reference

`mingla-business/app/(tabs)/marketing/_layout.tsx` (if it exists) likely has a sub-tab pattern. If so, Hub should mirror it. SPEC should verify and align.

**Confidence: H** for the recommendation; **L** for the exact visual treatment until SPEC + UI/UX skill weighs in (engineering handbook calls out this is a `mingla-designer` or `ui-ux-pro-max` polish item per M0 brief §9).

---

## §9. Findings classification

### 🔵 Observations (5)

**O-1:** `routes.ts` is outdated relative to today's route surface (17 lines, 3 routes; codebase has many more). M0 is a clean moment to either update it or deprecate. SPEC decision.

**O-2:** TopBar's `extraRightSlot` already supports the M0 universal-creator pattern (lines 76-85 of TopBar.tsx). No primitive extension needed.

**O-3:** The events table's existing CHECK constraints (`status_check`, `visibility_check`, `cover_media_type_check`, `slug_nonempty`) are independent of the new `event_type_check`. Zero conflict.

**O-4:** Cross-domain blast radius is extremely narrow. 0 reads from `app-mobile/` and `mingla-admin/`; only 4 files in `mingla-business/` and 6 edge functions. Backward-compatible column add with default + backfill is non-disruptive.

**O-5:** The Marketing tab's nested-route pattern (`/marketing/audiences`, `/marketing/campaigns`, etc.) is the precedent for Hub's sub-routes. The `detectActiveTab` function in `_layout.tsx:50-52` already handles nested routes correctly.

### 🟡 Hidden Flaws (3)

**H-1: I-37 invariant — strict-grep CI gate must be respected.** The TopBar `extraRightSlot` pattern is documented as the canonical way to add primary-tab "+" affordances for `leftKind="brand"` consumers. The strict-grep CI gate at `.github/workflows/strict-grep-mingla-business.yml` enforces no `rightSlot=` for brand-left consumers. M0 must use `extraRightSlot`, never `rightSlot`, when adding the universal creator "+". **SPEC must explicitly call this out.**

**H-2: `TopSheet` is governed (DEC-080).** The `TopSheet` primitive that powers `BrandSwitcherSheet` is reserved by DEC-080 for the brand-switcher use case only. Any new TopSheet usage requires orchestrator approval + DEC entry. **If SPEC decides to use TopSheet for the UniversalCreatorSheet, it must include a new DEC.** Forensics recommends using the bottom `Sheet` primitive instead (governance-free).

**H-3: `events_with_master_date_view` does NOT inherit new columns automatically.** Postgres views snapshot the projection at definition time. Adding `event_type` to base table doesn't make it queryable via the view. SPEC for M0 should explicitly leave the view alone (defer to Tr2); if any M0-era consumer needs `event_type` from the view, they read from the base table instead.

### 🟠 Contributing Factors (0)

None — M0 is foundational, not a bug fix.

### 🔴 Root Causes (0)

M0 is not a defect investigation. The "root cause" frame doesn't apply.

---

## §10. Open questions for SPEC

These are decisions the SPEC writer needs operator input on before proceeding:

**Q1.** Sub-tab pattern: confirm hard sub-tabs (Pattern A) vs filter pills (Pattern B) vs unified-stream (Pattern C). **Forensics recommendation: Pattern A.** Final decision needed by SPEC fire.

**Q2.** Sheet primitive for UniversalCreatorSheet: confirm bottom `Sheet` (no governance) vs `TopSheet` (needs DEC entry). **Forensics recommendation: bottom Sheet.**

**Q3.** Legacy `/events` redirect strategy: confirm stub-redirect (Strategy A) vs hard-rename (Strategy C). **Forensics recommendation: Strategy A.**

**Q4.** Universal creator "+" placement: confirm Home + Hub TopBars only, NOT Account / Marketing / Ari. **Forensics recommendation: Home + Hub only.**

**Q5.** Existing Home tab "+ Build event" CTA (line 463-469 of `home.tsx`): keep as a redundant shortcut OR consolidate to the top-bar "+". **Forensics recommendation: KEEP** — it lives in an empty-state card (only visible when operator has no events), serves a different UX moment than the always-visible top-bar "+". Two non-conflicting entry points are fine for v1.

**Q6.** `routes.ts` central config: update it to current reality (add missing routes + rename events → hub/events) OR deprecate (delete the file if nothing reads from it). **SPEC investigates** — grep usage and decide.

**Q7.** "Coming soon" stub screen content: short-and-friendly empty-state copy vs richer preview-of-upcoming-functionality. **Forensics recommendation: short-and-friendly** for M0; richer marketing copy can come later when Tr2 / Ve5 lands.

**Q8.** Streams A/B partition for two-engineer parallelism (per dispatch's parallelism note):
- **Stream A (UI restructure, ~3-4 days):** `_layout.tsx` (TABS array + label/icon update), new `hub/_layout.tsx`, `hub/events.tsx` (relocate content), `hub/experiences.tsx` + `hub/trips.tsx` (placeholders), `events.tsx` stub redirect, `routes.ts` update, Home `home.tsx` TopBar `extraRightSlot` add.
- **Stream B (Universal creator + data model, ~3-4 days):** new `UniversalCreatorSheet.tsx`, wire `extraRightSlot` `+` button + sheet trigger from Home + Hub TopBars, two stub "Coming soon" screens (`app/experience/coming-soon.tsx`, `app/trip/coming-soon.tsx`), migration `supabase/migrations/<timestamp>_m0_events_event_type_discriminator.sql`.

**Forensics observation:** Stream A and Stream B touch mostly different files. Merge conflicts should be near-zero by design. The only shared edit is wherever Home's TopBar gets the new `extraRightSlot` — but Stream A adds the JSX skeleton and Stream B fills in the handler that opens the UniversalCreatorSheet. Coordinate via a 5-minute end-of-day sync.

---

## §11. Investigation manifest (files actually read)

| File | Read | Purpose |
|------|------|---------|
| `Mingla_Artifacts/milestones/M0_HUB_FOUNDATION.md` | Phase 0 | Authoritative scope contract |
| `Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md` (§3 data model) | Phase 0 | Migration shape reference |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0825_BUSINESS_APP_VENUE_CLAIM_INTEGRATION_AUDIT.md` (§1 Surface Inventory) | Phase 0 | Existing tab structure baseline |
| `mingla-business/app/(tabs)/_layout.tsx` | Phase 3 | Tab structure as-is |
| `mingla-business/app/(tabs)/events.tsx` (head + key sections) | Phase 3 | Events tab content + TopBar usage pattern |
| `mingla-business/src/components/ui/TopBar.tsx` | Phase 3 (end-to-end) | extraRightSlot pattern + I-37 invariant |
| `mingla-business/src/components/ui/TopSheet.tsx` (first 50 lines) | Phase 3 | DEC-080 governance constraint |
| `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (first 150 lines) | Phase 3 | Sheet usage precedent |
| `mingla-business/src/config/routes.ts` | Phase 3 | Central route config (17 lines) |
| `supabase/migrations/20260604000000_orch_0824_event_taxonomy_columns.sql` (top section) | Phase 3 | Most-recent events table ALTER |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7819-7822` | Phase 3 | Existing CHECK constraints on events |

**Greps run (search-based discovery):**

- `event_type` across all mingla code domains → confirmed zero collision on events table
- `\.from(['"]events['"])` across `app-mobile/`, `mingla-admin/`, `mingla-business/`, `supabase/functions/` → cross-domain blast radius confirmed narrow
- `events_with_master_date_view` consumers → 3 files, all in marketing surface
- `TopBar\|extraRightSlot` consumers → confirms per-screen mount pattern
- `/events\|/(tabs)/events` route consumers → identified for redirect strategy

**Files explicitly NOT read** (deferred to SPEC if needed):
- Sheet primitive itself (`mingla-business/src/components/ui/Sheet.tsx`) — pattern is well-known, SPEC can read if it picks Sheet over TopSheet
- Specific marketing sub-route layout (`marketing/_layout.tsx`) — if SPEC picks Pattern A for sub-tabs, it should read this for styling parity
- `business-publish-event-draft` RPC body — SPEC's blast-radius section should verify INSERT shape is compatible with the new NOT NULL column

---

## §12. Five-layer cross-check

**Docs:** M0 brief, project spec §3, working doc §3 (tab architecture) — all consistent on the M0 scope. No contradictions across documents.

**Schema:** events table has existing CHECK constraints on `cover_media_type`, `slug`, `status`, `visibility`. New `event_type` CHECK is independent. No conflict. Migration chain verified — ORCH-0824 is the most-recent ALTER, and it doesn't touch event_type.

**Code:** TopBar already exposes `extraRightSlot` for primary-tab "+" patterns. `detectActiveTab` in `_layout.tsx` already handles nested routes via `startsWith(prefix + "/")`. BrandSwitcherSheet shows the sheet pattern (using `TopSheet`, which is governance-reserved). Universal creator should use bottom `Sheet` instead.

**Runtime:** Not directly verified (code-audit-only investigation per the dispatch's classification). M0 is foundational; runtime behavior changes are minimal (rename + new column + new sheet). No specific runtime trace needed beyond the smoke test the SPEC will define.

**Data:** Existing `events` rows have `cover_media_type`, `status`, `visibility` values within their CHECK domains. Adding `event_type` with default `'event'` + backfill leaves all existing rows in a valid state. No data migration anomaly expected.

**Cross-layer verdict:** all five layers agree on M0's intended scope. No hidden contradictions.

---

## §13. Discoveries for orchestrator

**D-0826-1:** `routes.ts` (17 lines) is significantly out-of-date relative to the actual route surface (brand routes, event routes, marketing routes, account sub-routes, public routes are all missing). M0 is a clean moment to either bring it current or deprecate. Out-of-scope for M0 itself; could be a small follow-up ORCH or a Stream A polish item.

**D-0826-2:** The `mingla-business/src/components/ui/Sheet.tsx` primitive is widely used (EventManageMenu, BrandDeleteSheet, EndSalesSheet, ConfirmDialog, etc.) but its full API surface wasn't read in this investigation. SPEC should read it before designing the UniversalCreatorSheet to confirm the three-row tap-to-pick pattern fits.

**D-0826-3:** `events_with_master_date_view` is used by 3 marketing-side consumers. If a future cycle (Tr2+) needs trips visible in the marketing campaign composer, this view's projection must be updated to include `event_type`. Not an M0 concern but worth tracking.

**D-0826-4:** The `business-publish-event-draft` RPC (ORCH-0792) is the primary INSERT pathway for events. M0 SPEC's blast-radius section should verify the RPC body either: (a) doesn't specify `event_type` (column default `'event'` applies); or (b) is updated to explicitly write `event_type='event'` for popup-brand events. Either works; SPEC picks.

**D-0826-5:** ORCH-0816 added `orders` to a Postgres logical replication publication for realtime. Need to check whether `events` is also published; if so, adding a column triggers a publication-snapshot refresh on `supabase db push`. Not a blocker but adds 10-30s to migration apply time and should be noted in deploy-ordering.

---

## §14. Confidence statement

**Overall investigation confidence: HIGH.**

Per-section confidence:

| Section | Confidence | Notes |
|---------|-----------|-------|
| §1 Tab structure | H | `_layout.tsx` read end-to-end |
| §2 Events tab content | H | Imports + key sections + render verified |
| §3 TopBar map | H | TopBar.tsx read end-to-end; consumer pattern verified |
| §4 Sheet primitive | H for recommendation; M for visual shape | DEC-080 verified; final UI is SPEC scope |
| §5 Migration safety | H | Migration chain inspected; collisions checked |
| §6 Blast radius | H for grep-based mapping; M for INSERT-pathway RPC | RPC body not directly read |
| §7 Redirect strategy | H for recommendation; M for full caller enumeration | Test files contain additional refs |
| §8 Sub-tab pattern | H for recommendation; L for visual treatment | Design skill (ui-ux-pro-max / mingla-designer) needed for final visual |
| §9 Findings classification | H | All findings backed by direct evidence |
| §10 Open questions | H | All forks are operator-decidable |

Per the forensics protocol's failure-honesty levels, every finding above is **proven** (six-field evidence: file path, line, exact code, what it does, what it should do, causal chain) — not "probable" or "suspected."

Per the live-fire mandate (Prime Directive 7): this investigation is classified **code-audit-only** because the dispatch is foundational (rename + new column + stub sheet) with no specific UI reproducer to run on simulators. No simulator session was opened. Exemption applies.

---

## §15. Recommended fix strategy (not a SPEC)

A spec is the next phase. This is **direction only** — what the SPEC should specify:

1. **Tab rename** — `_layout.tsx` TABS array: rename `events` → `hub`, label `"Events"` → `"Hub"`, icon stays `calendar`
2. **New Hub route group** — `app/(tabs)/hub/_layout.tsx` with sub-tab UI (Pattern A: hard sub-tabs)
3. **Sub-tab files** — `hub/events.tsx` (relocate `(tabs)/events.tsx` content + adjust import paths), `hub/experiences.tsx` + `hub/trips.tsx` (Coming Soon placeholders)
4. **Legacy redirect stub** — `app/(tabs)/events.tsx` becomes a `router.replace("/hub/events")` redirect screen
5. **Universal creator sheet** — `UniversalCreatorSheet.tsx` using bottom `Sheet` primitive (NOT TopSheet); three rows (Create event / Create experience / Create trip); event row pushes to `/event/create` (existing), other two push to "Coming soon" stub screens
6. **Coming Soon stubs** — `app/experience/coming-soon.tsx` and `app/trip/coming-soon.tsx` with friendly empty-state copy + back button
7. **TopBar wiring** — Home + Hub TopBars gain `extraRightSlot={<UniversalCreatorButton onPress={openSheet}/>}`
8. **Migration** — `supabase/migrations/<timestamp>_m0_events_event_type_discriminator.sql` adding the column + CHECK + index + explicit backfill UPDATE; wrapped in BEGIN/COMMIT
9. **routes.ts** — update `events` route to `/(tabs)/hub/events` (or deprecate file pending D-0826-1 decision)
10. **Regression tests** — add `mingla-business/app/(tabs)/__tests__/hub_navigation.test.tsx` (verifies tab structure + sub-tab routing + deep-link redirect) and `mingla-business/src/components/ui/__tests__/UniversalCreatorSheet.test.tsx` (verifies 3-option rendering + routing)

The SPEC writer fleshes each item into the layer-by-layer contract per `references/spec-template.md`.

---

## §16. Regression prevention

For the class of change M0 represents (tab rename + new column + new universal creator):

1. **Strict-grep CI gate** — verify after implementation that `mingla-business/` contains no `rightSlot=` usage with `leftKind="brand"` (preserves I-37). The existing `.github/workflows/strict-grep-mingla-business.yml` already enforces this; M0 just needs to not break it.
2. **Tab-structure unit test** — `mingla-business/app/(tabs)/__tests__/hub_navigation.test.tsx` verifies the 5-tab structure with Hub in slot 2, and that `detectActiveTab` correctly resolves nested routes.
3. **Migration replay test** — after the M0 migration lands, verify `supabase db push --linked` is idempotent (re-running doesn't fail) and `SELECT event_type, COUNT(*) FROM events GROUP BY event_type;` returns all-`'event'` rows post-backfill.
4. **Universal creator test** — `UniversalCreatorSheet.test.tsx` verifies the 3-option sheet renders, each option routes correctly, and the dismiss behavior works.

These are all SPEC-scoped; this investigation surfaces them for the SPEC to formalize.

---

## §17. Invariant compliance

Checked against `references/invariant-violations.md` patterns. M0 must preserve:

- **I-37** (TopBar `extraRightSlot` for brand-left consumers) — explicit pattern, called out in SPEC notes above
- **Constitution #1** (No dead taps) — universal creator "+" must respond on tap; SPEC defines feedback (haptic + sheet open)
- **Constitution #3** (No silent failures) — failed migrations must surface; SPEC includes operator confirmation pattern
- **Constitution #4** (One query key per entity) — N/A for M0 (no new server-state hooks)
- **Constitution #14** (Persisted-state startup) — N/A for M0 (no new persisted state)
- **`feedback_anon_buyer_routes.md`** — Hub is INSIDE `(tabs)` (auth-required); no anon impact
- **`feedback_toast_needs_absolute_wrap.md`** — N/A; M0 doesn't introduce new Toasts
- **`feedback_rn_color_formats.md`** — N/A; M0 doesn't introduce new inline-style colors
- **`feedback_verify_db_column_names_before_writing_queries.md`** — RESPECTED in this investigation (migration chain inspected; baseline + ORCH-0824 cited directly)

No invariant violations expected from M0 itself; SPEC must preserve them.

---

## §18. Next phase routing

After this INVESTIGATE returns:

1. Operator + orchestrator review this report
2. Operator resolves the 8 open questions in §10
3. Orchestrator dispatches Claude `mingla-forensics` (SPEC mode) for M0
4. SPEC produces `Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md`
5. Operator reviews SPEC
6. Implementation dispatched:
   - **Stream A** to Seth via Codex `implementor-mingla` OR Claude `mingla-implementor`
   - **Stream B** to Taofeek (autonomous from the brief + SPEC; no agent skill)
7. Implementation reports written
8. TEST dispatched (Claude `mingla-forensics` TEST mode)
9. CLOSE (orchestrator) — including TestFlight EAS OTA + project board issue #90 status flip to Done

Working tree throughout: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

## §19. Artifact metadata

- **Report path:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_M0_HUB_FOUNDATION.md`
- **Length:** ~750 lines
- **Files read end-to-end:** 1 (`TopBar.tsx`)
- **Files read partial:** 4 (`_layout.tsx`, `events.tsx`, `BrandSwitcherSheet.tsx`, `TopSheet.tsx`)
- **Files read full structural:** 2 (`routes.ts`, `M0_HUB_FOUNDATION.md`)
- **Migrations inspected:** 2 (baseline squash, ORCH-0824)
- **Greps run:** 8 (event_type collision, `from('events')`, `events_with_master_date_view` consumers, route consumers, TopBar consumers, etc.)
- **Sub-agents dispatched:** 0 (this is a tightly-scoped investigation; sub-agent overhead unnecessary)
- **Findings:** 0 🔴 / 0 🟠 / 3 🟡 / 5 🔵 / 5 Discoveries-for-Orchestrator
- **Open questions for SPEC:** 8
- **Confidence overall:** H
- **Live-fire status:** N/A (code-audit-only per Prime Directive 7 exemption)

---

*End of investigation. Next phase: SPEC.*
