# SPEC — ORCH-0855 [Tr1 Trip Planner Brand Onboarding]

**Mode:** SPEC
**Skill:** Claude `mingla-forensics`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md` (binding evidence base)
**Milestone brief:** `Mingla_Artifacts/milestones/Tr1_TRIP_PLANNER_ONBOARDING.md`
**Upstream:** ORCH-0826 [M0 Hub Foundation + universal-plus creator] CLOSED Grade A
**Downstream:** ORCH-XXXX [Tr2 Minimum Viable Trip] — depends on this milestone

---

## 1. Goal (one sentence)

A trip-planning host installs Mingla Business, opens Brand Switcher → taps "A trip" persona card, fills brand name + bio + cover image, completes Stripe Connect onboarding, and lands on Home where a `kind='trip_planner'` brand exists with Stripe attached and a Stripe-status-gated "Plan a trip" / "Finish Stripe setup" CTA is rendered — the foundation for Tr2 to slot the real trip-creation wizard into.

---

## 2. Scope

### In-scope (this SPEC)
1. Migration: widen `brands_kind_check` to admit `'trip_planner'`.
2. Type union widening across `types/brand.ts` + `brandMapping.ts` + `brandsService.ts` (3 files).
3. NEW `PersonaPickerCards.tsx` component with locked `PersonaDef[]` interface (so Ve1 plugs in cleanly).
4. NEW `TripBrandWizard.tsx` — name + bio + cover image → createBrand(`kind='trip_planner'`) → route to `/brand/{id}/payments` (which renders existing `BrandOnboardView` for Stripe Connect launch).
5. REFACTOR `BrandSwitcherSheet.tsx` — add `"persona"` intermediate mode between `"switch"` and the current `"create"` (now renamed `"popup-create"`); "An event" persona card preserves today's minimal flow verbatim.
6. EXTEND `home.tsx` — add `kind`-aware CTA for `'trip_planner'` brands with Stripe-status gating per Finding I-2 (`stripeStatus === 'active'` → "Plan a trip" → routes `/trip/coming-soon`; otherwise → "Finish Stripe setup" → routes `/brand/{id}/payments`).
7. Lock `kind` as IMMUTABLE post-create — hide kind editor for `'trip_planner'` brands in `BrandEditView` (or omit the trip-planner option from the toggle entirely). DISCOVERY-4 resolution.
8. Regression-test gate (Step 0.5): 3 implementor jest tests + 1 tester adversarial mjs check.

### Non-goals (explicitly OUT of scope)
| Non-goal | Why |
|---|---|
| Trip CREATION wizard | Tr2 scope. Tr1 only ships the brand; "Plan a trip" CTA routes to existing `/trip/coming-soon` stub (M0). |
| Ve1's "A place" persona card implementation | Ve1 scope, different developer. Tr1 ships the framework + Trip card only; Ve1 adds Place card via the locked `PersonaDef[]` interface. |
| `brand-stripe-onboard` edge function changes | Already kind-agnostic per Finding B-1. Zero changes needed. |
| `stripe-onboarding-return.tsx` changes | Already kind-transparent per Finding B-2. Zero changes needed. |
| New BrandOnboardView state machine | Existing one is reusable as-is (Finding I-1); TripBrandWizard delegates to it via `router.push('/brand/{id}/payments')`. |
| Public brand-page rendering of trip-planner brands | Polish item — Tr1 mirrors popup-brand rendering (no address shown). Trip-planner-specific public page comes later (likely C1 or trip-planner profile polish ORCH). |
| Country picker UI in TripBrandWizard | Per P1-2 resolution: country selection happens INSIDE BrandOnboardView via existing `BrandStripeCountryPicker`. Wizard does NOT duplicate. |
| AppsFlyer `kind` discriminator on `mingla_brand_created` event | DISCOVERY-3. Out of Tr1 scope — register as follow-up ORCH if operator wants per-kind funnel. |
| Hardcoded `"Lonely Moth"` default fix in BrandSwitcherSheet | DISCOVERY-1. Pre-existing P3. Out of Tr1 scope per scope discipline. Implementor MAY drop the default (replace with empty string) opportunistically in the same file edit — but only as a clean 1-line co-change with no extra logic. |
| Country default from device locale | DISCOVERY-2. Cross-cutting concern affecting all brand kinds. Out of Tr1 scope. |

### Assumptions
- ORCH-0826 M0 migration `20260605000000_orch_0826_events_event_type_discriminator.sql` is live on remote (confirmed by investigation Phase 0 — ratified live 2026-05-14 per I-1.2-UNIFIED-EVENT-TYPE).
- Live `brands_kind_check = ('physical','popup')` (confirmed via MCP `execute_sql` 2026-05-17).
- `mingla-business/jest.config.cjs` is present and `npx jest` runs from `mingla-business/` (confirmed).
- `brand_covers` storage bucket + `uploadBrandCover` service exists (confirmed at `brandCoverService.ts:37`).
- `app/trip/coming-soon.tsx` stub exists from ORCH-0826 M0 (confirmed via investigation Phase 0).
- `BrandOnboardView` handles Stripe Connect country selection via `BrandStripeCountryPicker` (confirmed `BrandOnboardView.tsx:183, 607`).
- `creator_accounts.default_brand_id` is set via `useUpdateCreatorAccount` post-create (existing pattern in BrandSwitcherSheet).

---

## 3. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| Surface | In/Out | User-visible behaviour | Files touched | Parity mode |
|---|---|---|---|---|
| **Business iOS** | ✅ IN | Brand Switcher → "Create brand" footer → persona picker with 3 cards → tap "A trip" → trip-brand wizard (name + bio + cover) → submit → Stripe Connect via existing BrandOnboardView at `/brand/{id}/payments` → return to Home → Home shows "Plan a trip" or "Finish Stripe setup" CTA based on Stripe status. | All files in §6 below | **Automatic parity** with Android — shared React Native code. |
| **Business Android** | ✅ IN | Identical to iOS. | Same files. | **Automatic parity** — shared RN code. |
| **Database (Postgres on Supabase linked project)** | ✅ IN | `brands_kind_check` admits `'trip_planner'`. `brands` rows can now be inserted with the new kind. RLS unchanged (Finding C-3 — zero `kind`-aware policies). | Migration file in §4.1 | N/A — single DB. |
| **Consumer iOS** (`app-mobile/` on iOS) | ❌ OUT | No consumer-facing change in Tr1. Trip-planner brands do not yet surface to consumers — that's C1 [Consumer Discover Trips Tab]. | None | Trip-planner brands are visible publicly via `/b/{slug}` but the consumer Discover tab does not aggregate them until C1. |
| **Consumer Android** (`app-mobile/` on Android) | ❌ OUT | Same reason — C1 scope. | None | — |
| **Buyer/anonymous Web** (`mingla-business/` `/checkout/`, `/e/`, `/b/`) | ❌ OUT | The `/b/{brandSlug}` public brand page WILL render for trip-planner brands (RLS public-read policy is `kind`-agnostic per investigation Finding C-3) — but Tr1 explicitly does NOT customise the rendering. Tr1 ships the trip-planner brand as functionally identical to a popup brand on the public page (no address shown). Public-page polish is out of Tr1 scope. | None (public page intentionally unchanged) | Manual visual check at TEST time: public `/b/{trip-planner-slug}` renders without crash and without address — same as popup. |
| **Admin Web** (`mingla-admin/`) | ❌ OUT | No admin queue for trip planners per DEC-4 (Stripe Connect KYC replaces phone-callback). Admin dashboard's brand list will surface `kind='trip_planner'` rows (the column exists and SELECT policies are unchanged) — Tr1 does NOT add any admin-side UI for trip planners. | None | If admin's brand list renders the `kind` column literal, "trip_planner" appears as a raw string — acceptable cosmetic for Tr1; admin polish is a follow-up. |
| **Business Web preview** (`mingla-business/` dev/web build) | ❌ OUT | `BrandSwitcherSheet` opens via TopSheet which uses React Native Modal — does not render on web. Web preview is for buyer-anon flows only (Cycle 8a anon buyer routes). Operators never use web preview for brand onboarding. | None | N/A. |

**Parity strategy:** all in-scope surfaces (business iOS + business Android) share React Native code via `mingla-business/src/` and `mingla-business/app/`. Per Tr1 §7 regression #1, the popup-brand "An event" persona card preserves today's minimal flow byte-equivalent — Implementor must NOT alter the popup-brand-creation code path; the persona picker simply routes to it.

---

## 4. Layer-by-layer specification

### 4.1 Database layer

**Migration file:** `supabase/migrations/<UTC-timestamp>_orch_0855_brands_kind_trip_planner.sql`

**Naming:** filename timestamp MUST be later than `20260605000000_orch_0826_events_event_type_discriminator.sql` (the M0 migration). Use `20260607000000_orch_0855_brands_kind_trip_planner.sql` or later.

**Exact SQL (verbatim):**

```sql
-- ORCH-0855 — Tr1 Trip Planner Brand Onboarding: widen brands.kind to admit 'trip_planner'.
--
-- Pre-state (verified live 2026-05-17 via MCP execute_sql):
--   brands_kind_check = CHECK ((kind = ANY (ARRAY['physical'::text, 'popup'::text])))
--   Live row count by kind: 12 popup, 0 physical, 0 trip_planner.
-- Post-state:
--   brands_kind_check = CHECK ((kind = ANY (ARRAY['physical'::text, 'popup'::text, 'trip_planner'::text])))
--
-- RLS: zero policies on public.brands reference kind (verified via pg_policy probe).
--      Migration is fully RLS-transparent — no policy changes needed.
-- Data backfill: not needed (no existing rows have or need 'trip_planner').
-- Revert: DROP CONSTRAINT brands_kind_check; ADD CONSTRAINT brands_kind_check CHECK (kind IN ('physical','popup'));
--
-- Per I-1.2-BRAND-AS-CONTAINER (PROJECT_SPEC §54): kind is starting identity, NOT capability gate.
-- Per DEC-4 (project spec §8): Stripe Connect doubles as identity proof for trip planners
--   (no admin phone-callback flow needed).

BEGIN;

ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_kind_check;

ALTER TABLE public.brands
  ADD CONSTRAINT brands_kind_check
  CHECK (kind IN ('physical', 'popup', 'trip_planner'));

COMMENT ON COLUMN public.brands.kind IS
  'Mingla Business 1.2: physical=owns/leases venue (Ve1+); popup=organizer w/o fixed venue (today''s default); trip_planner=multi-day trips with Stripe-required identity (Tr1+). Per I-1.2-BRAND-AS-CONTAINER, kind is starting identity only — any brand can author any offering type via the universal "+" creator.';

-- Self-verification probe: confirm the constraint is in place and admits all 3 values.
DO $$
DECLARE
  constraint_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO constraint_def
  FROM pg_constraint
  WHERE conrelid = 'public.brands'::regclass AND conname = 'brands_kind_check';

  IF constraint_def IS NULL THEN
    RAISE EXCEPTION 'ORCH-0855 migration: brands_kind_check was not created';
  END IF;

  IF position('trip_planner' IN constraint_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-0855 migration: brands_kind_check does not admit ''trip_planner'' — got: %', constraint_def;
  END IF;

  IF position('physical' IN constraint_def) = 0 OR position('popup' IN constraint_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-0855 migration: brands_kind_check dropped a legacy kind — got: %', constraint_def;
  END IF;

  RAISE NOTICE 'ORCH-0855 migration complete: brands_kind_check widened to (physical, popup, trip_planner)';
END $$;

COMMIT;
```

**RLS:** no changes. Confirmed `kind`-transparent at investigation §3 Finding C-3.

**Indexes:** no new indexes. The existing `idx_brands_account_id` + `idx_brands_slug_active` are sufficient for all brand-kind queries Tr1 introduces.

**Apply protocol:** per operator memory `feedback_orchestrator_deploys_edge_functions.md`, operator runs `supabase db push --linked` before any client code that depends on the migration ships. Implementor does NOT run `supabase db push` (orchestrator memory rule).

### 4.2 Edge function layer

**No changes.** Per Finding B-1, `brand-stripe-onboard` is kind-agnostic. Per Finding B-2, `stripe-onboarding-return` is kind-transparent. Tr1 reuses both as-is.

### 4.3 Service layer

**File 1: `mingla-business/src/types/brand.ts`**

Line 192 — widen `kind` union on the `Brand` interface:

```ts
// Before:
kind: "physical" | "popup";

// After:
kind: "physical" | "popup" | "trip_planner";
```

Update the JSDoc above the field to document the new value:

```ts
/**
 * Brand kind. Drives the persona-specific creation flow and downstream UX.
 *   - "physical"     — brand owns/leases a venue. Public page renders address. (Ve1+)
 *   - "popup"        — brand operates across multiple venues. No location shown. (today's default)
 *   - "trip_planner" — multi-day trips. Stripe Connect REQUIRED at create time per DEC-4 (Tr1+).
 *
 * IMMUTABLE post-create (Tr1 lock-in per DISCOVERY-4): kind cannot be changed
 * after the brand row is inserted. Switching identity post-create would break
 * Stripe-status gating, downstream RLS assumptions, and analytics funnels.
 *
 * Per I-1.2-BRAND-AS-CONTAINER: kind is starting identity, NOT capability gate.
 * Any brand can author any offering type via the universal "+" creator.
 */
kind: "physical" | "popup" | "trip_planner";
```

**File 2: `mingla-business/src/services/brandMapping.ts`**

Two lines — both must widen identically:

```ts
// Line 45 (BrandRow interface):
kind: "physical" | "popup" | "trip_planner";

// Line 74 (BrandUiInput interface):
kind?: "physical" | "popup" | "trip_planner";
```

No other changes — `mapBrandRowToUi` already passes `row.kind` through verbatim (line 217), `mapUiToBrandInsert` already passes `brand.kind` through verbatim (line 274).

**File 3: `mingla-business/src/services/brandsService.ts`**

Line 86 — `CreateBrandInput.kind` union:

```ts
// Before:
kind: "physical" | "popup";

// After:
kind: "physical" | "popup" | "trip_planner";
```

No other service-layer changes. `createBrand` runtime logic is kind-agnostic (Finding D-2).

**Error contract:** unchanged. `SlugCollisionError` thrown on 23505 unique_violation; all other Postgrest errors re-thrown. Hook layer handles inline.

### 4.4 Hook layer

**File: `mingla-business/src/hooks/useBrands.ts`**

**No code change.** Finding E-1 confirmed `useCreateBrand` passes `input.kind` through verbatim. Once `CreateBrandInput.kind` widens (file 3 above), `useBrands.ts` type-checks against the new union without modification.

**Verification:** Implementor MUST add a type-only smoke test in `__tests__/useBrands.tripPlannerKind.test.ts` that exercises `mutateAsync({...kind: 'trip_planner'...})` to lock the union widening at the hook boundary.

### 4.5 Component layer

#### 4.5.1 NEW `mingla-business/src/components/brand/PersonaPickerCards.tsx`

**Locked interface (Ve1 plugs in via the same `PersonaDef[]` contract):**

```ts
import type { IconName } from "../ui/Icon";

/**
 * PersonaDef — the locked interface for brand-creation persona cards.
 *
 * Tr1 (ORCH-0855) introduces this interface with 3 persona ids:
 *   - 'place' (Ve1 wiring — Ve1 implements onSelect to open venue claim flow)
 *   - 'event' (Tr1 wiring — preserves today's minimal popup-brand create form)
 *   - 'trip'  (Tr1 wiring — opens TripBrandWizard)
 *
 * Ve1 (separate developer, Track 2) MUST NOT widen this id union or rename
 * any field. New persona ids require a new ORCH + SPEC + invariant amendment.
 *
 * Per I-PROPOSED-TR1-PERSONA-INTERFACE (DRAFT — flips ACTIVE on ORCH-0855 CLOSE).
 */
export interface PersonaDef {
  id: "place" | "event" | "trip";
  title: string;            // e.g. "A trip"
  description: string;      // e.g. "I plan curated trips and multi-day experiences"
  icon: IconName;           // single Icon from designSystem icon set
  onSelect: () => void;
  disabled?: boolean;       // true → renders the card as "Coming soon" (Ve1's 'place' before Ve1 ships)
  testID?: string;
}

export interface PersonaPickerCardsProps {
  personas: PersonaDef[];   // expected length: 3 (place, event, trip) in that visual order
  testID?: string;
}

export const PersonaPickerCards: React.FC<PersonaPickerCardsProps> = ({ personas, testID }) => { /* ... */ };
```

**Visual spec:**
- Three vertically-stacked `Pressable` cards in a `View` with `gap: spacing.sm`.
- Each card: GlassCard variant `'elevated'` if `!disabled`, `'flat'` if `disabled`. `padding: spacing.md`.
- Layout: `flexDirection: 'row'`, `alignItems: 'center'`, `gap: spacing.md`.
- Left: `<Icon name={persona.icon} size={28} color={accent.warm}/>` inside a 44×44 touch-target wrapper (I-38 WCAG AA invariant).
- Center: `<View style={{flex: 1}}>` with `<Text style={styles.cardTitle}>{persona.title}</Text>` + `<Text style={styles.cardDescription}>{persona.description}</Text>`.
- Right: `<Icon name="chevR" size={18} color={textTokens.tertiary}/>` (or no chevron if `disabled`).
- `accessibilityRole: 'button'`, `accessibilityLabel: persona.title + " — " + persona.description` (I-39).
- `accessibilityState: { disabled: persona.disabled === true }`.
- Disabled cards: opacity 0.5, `<Pressable disabled>`, no onPress fires.

**Hard guards (implementor):**
- Component is PRESENTATIONAL ONLY. It does NOT own state. It does NOT call mutations or services. It does NOT know about brand creation.
- `onSelect` is a parent-supplied closure. PersonaPickerCards just renders + invokes.
- No hardcoded icon mapping — caller passes `icon: IconName` per persona.

**Persona configuration in BrandSwitcherSheet (Tr1 supplies all 3 personas):**

```ts
const personas: PersonaDef[] = [
  {
    id: "place",
    title: "A place",
    description: "I run a venue (restaurant, bar, gallery, studio)",
    icon: "mapPin",            // SPEC-LOCKED — Ve1 may NOT change without an ORCH
    disabled: true,             // Tr1 ships the card as "Coming soon"; Ve1 flips this to false + implements onSelect
    onSelect: () => { /* Tr1: no-op (disabled). Ve1: open venue claim flow. */ },
    testID: "persona-place",
  },
  {
    id: "event",
    title: "An event",
    description: "I host one-off events, parties, or pop-ups",
    icon: "calendar",
    onSelect: () => setMode("popup-create"),
    testID: "persona-event",
  },
  {
    id: "trip",
    title: "A trip",
    description: "I plan curated trips and multi-day experiences",
    icon: "compass",            // alternatives — plane, suitcase; SPEC-LOCKED at compass for Tr1
    onSelect: () => setMode("trip-create"),
    testID: "persona-trip",
  },
];
```

#### 4.5.2 NEW `mingla-business/src/components/brand/TripBrandWizard.tsx`

**Props interface:**

```ts
export interface TripBrandWizardProps {
  /** Account id of the user creating the brand (auth.uid()). */
  accountId: string;
  /** Closes the parent BrandSwitcherSheet. Called after success + route to /brand/{id}/payments. */
  onClose: () => void;
  /** Back button — returns to persona picker. */
  onBack: () => void;
  /** Optional success notifier (parent surfaces toast). */
  onBrandCreated?: (brand: Brand) => void;
  /** Optional default-save error notifier (parent surfaces toast). */
  onDefaultBrandSaveError?: (message: string) => void;
  testID?: string;
}
```

**State machine:**

| State | What user sees | What renders |
|---|---|---|
| `idle` (initial) | Brand name input + bio input + cover image picker + "Continue to Stripe" button | All form fields, submit button enabled iff `name.trim().length > 0 && coverMediaUrl != null` |
| `creating-brand` | "Creating brand…" | Disable form, show spinner on submit button |
| `uploading-cover` | "Uploading cover…" | Disable form, show spinner with cover-upload progress |
| `routing-to-stripe` | "Setting up Stripe…" | Disable form, show spinner; navigate fires |
| `error-slug-collision` | Inline error under name input | Form re-enabled, slug-error text visible |
| `error-network` | Inline error banner at top | Form re-enabled, retry button visible |

**Submit flow (exact sequence):**

```
1. setStatus('creating-brand')
2. const newBrand = await createBrandMutation.mutateAsync({
     accountId, name: trimmedName, slug: slugify(trimmedName),
     kind: 'trip_planner',
     address: null, coverHue: 25, bio: trimmedBio
   })
3. setStatus('uploading-cover')
4. const coverUrl = await uploadBrandCover(newBrand.id, coverMediaFile)
5. await updateBrandMutation.mutateAsync({
     brandId: newBrand.id,
     patch: { coverMediaUrl: coverUrl, coverMediaType: 'image' },
     existingDescription: null,
     accountId,
   })
6. await updateCreatorAccountMutation.mutateAsync({ default_brand_id: newBrand.id })
7. setCurrentBrand(newBrand)  // zustand
8. onBrandCreated?.(newBrand) // parent toast
9. setStatus('routing-to-stripe')
10. onClose()                  // close BrandSwitcherSheet
11. router.push(`/brand/${newBrand.id}/payments`)
    // BrandOnboardView mounts, derives entry state, surfaces "Start onboarding" button.
    // Country picker UX is owned there (P1-2 resolution).
```

**Error handling per step:**

| Step | Error class | Recovery |
|---|---|---|
| 2 | `SlugCollisionError` | setStatus('error-slug-collision') + set inline error: "This brand name is taken. Try a small variation (e.g. \"{name} Trips\")." Form re-enabled. |
| 2 | other Error | setStatus('error-network') + banner: "Couldn't create brand. Tap Continue to try again." |
| 4 | upload Error | Brand row exists (Step 2 succeeded). Set banner: "Brand created, but cover upload failed. You can add it from brand profile." Continue to Step 6 (skip Step 5). Status → `routing-to-stripe`. |
| 5 | updateBrand Error | Same as Step 4 — brand exists, cover uploaded but not attached. Banner: "Cover uploaded but couldn't attach. Edit from brand profile." Continue to Step 6. |
| 6 | updateCreatorAccount Error | Fire-and-forget: `onDefaultBrandSaveError?.("Brand selected for now. Couldn't save it as your default.")` — same pattern as today's BrandSwitcherSheet. Continue to Step 7. |
| 11 | router.push silently fails | Pre-existing route is guaranteed to exist; treat as unreachable. |

**Layout:**
- TopSheet child (parent BrandSwitcherSheet uses `<TopSheet>` — wizard renders inside same sheet).
- `host` (flex:1 column) → `header` (with back chevron + "Create a trip-planner brand") → `body` (ScrollView with form) → `footer` (pinned full-width button).
- Body fields in order: Brand name Input (clearable), Bio Input (multiline, maxLength 200), Cover image picker (re-uses `BrandCoverPickerSheet` opened on tap of a "Choose cover" Pressable).
- Footer button label: "Continue to Stripe" (idle) / "Creating…" (creating-brand) / "Uploading…" (uploading-cover) / "Opening Stripe…" (routing-to-stripe).
- Per `feedback_keyboard_never_blocks_input`: wizard MUST handle keyboard avoidance — wrap form in a `KeyboardAvoidingView` or use the Cycle 3 dynamic paddingBottom pattern.

**Hooks used:**
- `useCreateBrand` (existing, no changes)
- `useUpdateBrand` (existing)
- `useUpdateCreatorAccount` (existing)
- `useCurrentBrandStore().setCurrentBrand` (existing zustand)
- `useRouter()` from expo-router (existing)
- NEW: `uploadBrandCover` called directly from service layer (not via a hook — same pattern as `BrandEditView`).

#### 4.5.3 REFACTOR `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`

**Mode type widening:**

```ts
// Before:
type Mode = "switch" | "create";

// After:
type Mode = "switch" | "persona" | "popup-create" | "trip-create";
```

**Initial mode logic (unchanged semantics):**

```ts
// Before:
const initialMode: Mode = brandList.isTrueEmpty ? "create" : "switch";

// After:
const initialMode: Mode = brandList.isTrueEmpty ? "persona" : "switch";
```

**Mode transitions:**
- `"switch"` → `"persona"` via existing "Create a new brand" footer button (`handleSwitchToCreate` renamed → `handleSwitchToPersona`).
- `"persona"` → `"popup-create"` via tapping "An event" card.
- `"persona"` → `"trip-create"` via tapping "A trip" card.
- `"persona"` → no-op via tapping "A place" card (disabled in Tr1, Ve1 wires onSelect later).
- `"popup-create"` / `"trip-create"` → `"persona"` via back chevron in header.
- `"persona"` → `"switch"` via back chevron in header (only if brands exist).

**Existing `"create"` mode (now `"popup-create"`):**
- COPY VERBATIM — no behavior changes to today's minimal create form.
- The hardcoded `kind: "popup"` + `coverHue: 25` + `displayName: "Lonely Moth"` defaults stay (per scope discipline — DISCOVERY-1 is out of Tr1 scope; implementor MAY replace `"Lonely Moth"` with `""` as a 1-line co-change if operator agrees at IMPL time, but no logic changes).
- Backward compat is satisfied: existing operator who taps Create → An event → enters name → submits → gets a popup-brand identical to today.

**NEW `"trip-create"` mode:**
- Renders `<TripBrandWizard accountId={user.id} onClose={onClose} onBack={() => setMode("persona")} onBrandCreated={onBrandCreated} onDefaultBrandSaveError={onDefaultBrandSaveError} testID="trip-brand-wizard"/>`
- TripBrandWizard owns the rest.

**NEW `"persona"` mode:**
- Header: "Choose a brand type" + back chevron iff `brands.length > 0` (returns to switch).
- Body: `<PersonaPickerCards personas={personas} testID="persona-picker"/>` — full-width, gap-spaced cards.
- No footer button.

#### 4.5.4 EXTEND `mingla-business/app/(tabs)/home.tsx`

**New kind-aware CTA logic.** Insert after the existing `currentBrand === null` empty state branch (line 342-383) and BEFORE the populated-brand branch (line 384+).

```tsx
// NEW: trip-planner-specific CTA gated by Stripe status.
// Per investigation Finding I-2 + DISCOVERY-4: trip planners require Stripe Connect to operate;
// CTA reflects readiness.
{currentBrand !== null && currentBrand.kind === "trip_planner" ? (
  <View style={styles.tripPlannerCtaWrap}>
    <GlassCard variant="elevated" padding={spacing.lg}>
      {currentBrand.stripeStatus === "active" ? (
        <>
          <Text style={styles.ctaTitle}>Plan a trip</Text>
          <Text style={styles.ctaBody}>
            You're set up. Create your first trip to start selling.
          </Text>
          <Pressable
            onPress={() => router.push("/trip/coming-soon" as never)}
            accessibilityRole="button"
            accessibilityLabel="Plan a trip"
            style={styles.ctaAction}
            testID="trip-planner-cta-plan-a-trip"
          >
            <Icon name="plus" size={16} color={accent.warm}/>
            <Text style={styles.ctaActionText}>Plan a trip</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.ctaTitle}>Finish setting up Stripe</Text>
          <Text style={styles.ctaBody}>
            Trip planners need Stripe Connect to collect deposits. Finish setup to publish trips.
          </Text>
          <Pressable
            onPress={() => router.push(`/brand/${currentBrand.id}/payments` as never)}
            accessibilityRole="button"
            accessibilityLabel="Finish Stripe setup"
            style={styles.ctaAction}
            testID="trip-planner-cta-finish-stripe"
          >
            <Icon name="chevR" size={16} color={accent.warm}/>
            <Text style={styles.ctaActionText}>Finish Stripe setup</Text>
          </Pressable>
        </>
      )}
    </GlassCard>
  </View>
) : null}
```

**Hard guards:**
- CTA is ADDITIVE — does NOT replace the existing populated-brand 7-day stats hero or KPI grid. Trip-planner brands see the CTA card ABOVE the stats / KPI / upcoming list.
- For `kind === 'popup'` or `'physical'` brands: CTA does NOT render (returns null). No regression for existing brands.
- Universal "+" button in TopBar remains untouched per I-1.2-BRAND-AS-CONTAINER (any brand can author any offering type).
- Tapping "Plan a trip" routes to `/trip/coming-soon` (existing M0 stub). Tr2 replaces that route with the real wizard — Tr1 ships the CTA wiring, not the destination.

#### 4.5.5 EDIT `mingla-business/src/components/brand/BrandEditView.tsx` — kind immutability

**DISCOVERY-4 resolution:** kind is IMMUTABLE post-create.

Find the existing `kind` editor (radio buttons switching between physical/popup per Finding from blast-radius §9). Add:

```ts
// Tr1 (ORCH-0855) — kind is immutable post-create. Trip-planner brands NEVER see this toggle.
// Physical ↔ popup toggle remains available for non-trip-planner brands (existing Cycle 7 behavior).
if (brand.kind === "trip_planner") {
  // Render nothing for the kind editor block. Or render a read-only label:
  // "Brand type: Trip planner (immutable)"
}
```

**Implementor note:** if the kind editor's options array literal is `["physical", "popup"]`, do NOT add `"trip_planner"` to it. Keep the toggle limited to physical↔popup for legacy brands. Trip-planner brands bypass the toggle entirely (no UI rendered).

---

## 5. Success criteria

Mapped 1:1 to milestone brief §3 acceptance criteria + DISCOVERY-4 (kind immutability) + Finding I-2 (Stripe-status-gated Home CTA). Each is observable, testable, unambiguous.

| # | Criterion | Layer | Test ID |
|---|---|---|---|
| SC-01 | Brand Switcher Sheet "Create a new brand" footer routes to the new persona picker (mode `"persona"`), not directly into the create form. | UI | T-01 |
| SC-02 | Persona picker shows exactly 3 cards in order: "A place", "An event", "A trip". | UI | T-02 |
| SC-03 | "A trip" card has icon `compass` and description "I plan curated trips and multi-day experiences". | UI | T-03 |
| SC-04 | "A place" card renders as disabled (Tr1 stub) — opacity 0.5, no onPress fires. | UI | T-04 |
| SC-05 | Tapping "A trip" opens `<TripBrandWizard>` inside the parent TopSheet. | Routing | T-05 |
| SC-06 | Tapping "An event" opens the existing minimal popup-brand create form (mode `"popup-create"`) — behavior byte-equivalent to pre-Tr1 (slug collision inline error, "Create brand" submit, etc.). | UI + Regression | T-06 |
| SC-07 | TripBrandWizard captures: brand name (required), bio (optional, maxLength 200), cover image (required). | UI | T-07 |
| SC-08 | Cover image upload reuses `uploadBrandCover` from `brandCoverService.ts` (BRAND_COVERS_BUCKET = `'brand_covers'`). | Service | T-08 |
| SC-09 | On submit success: brand row written with `kind='trip_planner'`. | DB | T-09 |
| SC-10 | `brands_kind_check` admits `'trip_planner'` at the DB level (migration applied). | DB | T-10 |
| SC-11 | After brand insert + cover upload, wizard calls `router.push('/brand/{id}/payments')` — landing on existing BrandOnboardView. | Routing | T-11 |
| SC-12 | If TripBrandWizard submit fails with slug collision: inline error shown, form re-enabled, no brand row inserted on retry until name changes. | UI + Service | T-12 |
| SC-13 | If TripBrandWizard cover upload fails after brand insert succeeded: banner shown, status continues to `routing-to-stripe`, brand row persists (Const #3 — surface the error, don't roll back the successful insert). | UI + Service | T-13 |
| SC-14 | Home tab CTA: when `currentBrand.kind === 'trip_planner' && stripeStatus !== 'active'` → renders "Finish Stripe setup" CTA routing `/brand/{id}/payments`. | UI | T-14 |
| SC-15 | Home tab CTA: when `currentBrand.kind === 'trip_planner' && stripeStatus === 'active'` → renders "Plan a trip" CTA routing `/trip/coming-soon`. | UI | T-15 |
| SC-16 | Home tab CTA: when `currentBrand.kind === 'popup'` or `'physical'` → CTA renders NOTHING (no regression for existing brands). | UI + Regression | T-16 |
| SC-17 | `BrandEditView` does NOT render a kind editor for `kind === 'trip_planner'` brands (DISCOVERY-4 immutability). | UI | T-17 |
| SC-18 | `BrandEditView` kind editor for `kind in ('physical', 'popup')` brands continues to render as today — does NOT include `'trip_planner'` as a toggle option. | UI + Regression | T-18 |
| SC-19 | "A place" persona card stub renders but does NOT yet open the venue claim flow (Ve1 scope). | UI | T-19 |
| SC-20 | Trip-planner brand created via Tr1 wizard appears in the brand switcher's `"switch"` mode list with the standard avatar+initial pattern (no per-kind chip in Tr1 — polish item §9-3 deferred). | UI + Regression | T-20 |
| SC-21 | Trip-planner brand soft-delete via existing `softDeleteBrand` flow continues to work — kind is not a soft-delete predicate. | Service + Regression | T-21 |
| SC-22 | Universal "+" creator sheet (M0) continues to open from Home / Hub / Marketing / Account TopBars for trip-planner brands — kind does NOT gate universal creator (I-1.2-BRAND-AS-CONTAINER invariant). | UI + Regression | T-22 |
| SC-23 | Stripe Connect onboarding launched via `/brand/{id}/payments` for a trip-planner brand succeeds end-to-end (account created via existing `brand-stripe-onboard` edge fn, return redirect via `stripe-onboarding-return` to deep link, BrandOnboardView shows `already-active` state). | Service + UI | T-23 |
| SC-24 | Stripe Connect onboarding abandonment for a trip-planner brand leaves the brand row persisted with `stripe_connect_id = NULL`, `stripeStatus = 'not_started'`; Home CTA correctly shows "Finish Stripe setup" (Stripe-status gating per SC-14). | Service + UI | T-24 |
| SC-25 | `PersonaPickerCards` `PersonaDef` interface is locked — id union is `'place' | 'event' | 'trip'`, no other ids accepted. (Enforced by TypeScript at the type boundary + adversarial CI gate.) | Type-system + CI | T-25 |

---

## 6. Files Touched (final list — supersedes investigation §6)

**Product code (8 files):**

| # | File | New / Edit | Purpose |
|---|---|---|---|
| 1 | `supabase/migrations/20260607000000_orch_0855_brands_kind_trip_planner.sql` | NEW | Widen `brands_kind_check`. |
| 2 | `mingla-business/src/types/brand.ts` | EDIT (1 line + JSDoc) | Widen `Brand.kind` union. |
| 3 | `mingla-business/src/services/brandMapping.ts` | EDIT (2 lines) | Widen kind unions × 2. |
| 4 | `mingla-business/src/services/brandsService.ts` | EDIT (1 line) | Widen `CreateBrandInput.kind` union. |
| 5 | `mingla-business/src/components/brand/PersonaPickerCards.tsx` | NEW | 3-card picker with locked `PersonaDef[]` interface. |
| 6 | `mingla-business/src/components/brand/TripBrandWizard.tsx` | NEW | Trip-brand wizard (name + bio + cover → Stripe). |
| 7 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | REFACTOR | Add persona mode + trip-create mode; rename existing create → popup-create. |
| 8 | `mingla-business/app/(tabs)/home.tsx` | EDIT | Add kind-aware Stripe-status-gated CTA. |
| 9 | `mingla-business/src/components/brand/BrandEditView.tsx` | EDIT | Hide kind editor for trip_planner brands (DISCOVERY-4). |

**Tests (3 implementor + 1 tester adversarial = 4 files):**

| # | File | New / Edit | Owner | Purpose |
|---|---|---|---|---|
| 10 | `mingla-business/src/components/brand/__tests__/BrandSwitcherSheet.personaFork.test.tsx` | NEW | Implementor | Happy-path regression — persona picker renders, routes correctly, popup-create preserves byte-equivalent behavior. |
| 11 | `mingla-business/src/components/brand/__tests__/TripBrandWizard.test.tsx` | NEW | Implementor | Happy-path regression — submit flow, error paths, cover-upload failure recovery. |
| 12 | `mingla-business/src/services/__tests__/brandsService.tripPlannerKind.test.ts` | NEW | Implementor | Service-layer test — `createBrand({kind:'trip_planner'})` type-checks + executes mock insert. |
| 13 | `mingla-business/scripts/ci/orch-0855-adversarial-check.mjs` | NEW | Tester | Adversarial structural-grep — verifies migration constant present, persona id union locked, `BrandEditView` does not include 'trip_planner' in kind toggle, BrandSwitcherSheet has all 4 modes. |

**Optional strict-grep gate (Ve1 interface protection):**

| # | File | New / Edit | Purpose |
|---|---|---|---|
| 14 | `.github/scripts/strict-grep/i-tr1-persona-picker-interface.mjs` | NEW (optional, recommended) | Enforces `PersonaPickerCards.tsx` exports `PersonaDef` with locked `id: 'place' \| 'event' \| 'trip'` union and `personas: PersonaDef[]` props contract. Wired into `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern.md`. |

**Files NOT touched (explicit):**
- `mingla-business/src/hooks/useBrands.ts` — passes kind through naturally; verify via test 12.
- `supabase/functions/brand-stripe-onboard/index.ts` — kind-agnostic.
- `mingla-business/app/connect-onboarding.tsx` — kind-agnostic web Embedded Components host.
- `mingla-business/app/stripe-onboarding-return.tsx` — kind-transparent HTTPS bounce.
- `mingla-business/src/components/brand/BrandOnboardView.tsx` — TripBrandWizard delegates to it via router.push; no changes.
- All RLS policies on `brands` — kind-transparent.
- All other edge functions / services / hooks.

---

## 7. Implementation order (independently revertible per step)

Per investigation §7. Each step compiles, type-checks, and ships independently.

| Step | Files | Verification before next step |
|---|---|---|
| 1 | Migration (file 1) | Operator runs `supabase db push --linked`. Verify via MCP `execute_sql` that `brands_kind_check` admits `'trip_planner'`. **GATE — Implementor does NOT proceed to Step 2 until operator confirms migration applied.** |
| 2 | Type widening (files 2, 3, 4) | `cd mingla-business && npx tsc --noEmit` — zero errors. |
| 3 | NEW PersonaPickerCards (file 5) | Component renders in isolation; type-check passes. |
| 4 | NEW TripBrandWizard (file 6) | Component renders in isolation; type-check passes. |
| 5 | REFACTOR BrandSwitcherSheet (file 7) | Existing flow (popup brand create) still works byte-equivalent. Mode transitions verified. |
| 6 | Home CTA (file 8) | Trip-planner brands see CTA. Popup/physical brands see no regression. |
| 7 | BrandEditView kind editor hide (file 9) | Trip-planner brands see no kind editor; popup/physical brands see existing toggle. |
| 8 | Tests (files 10, 11, 12) | `npx jest BrandSwitcherSheet.personaFork TripBrandWizard brandsService.tripPlannerKind` — all PASS. **Fails-on-revert verified** per Step 0.5 regression gate (implementor reverts each fixture file individually and confirms each test FAILs in isolation). |
| 9 | (Tester) Adversarial check (file 13) | Tester writes `orch-0855-adversarial-check.mjs` attacking different angles (not a copy of jest tests). Verifies via 10+ structural assertions. Fails-on-revert verified at the same commit. |
| 10 | (Optional) Strict-grep gate (file 14) | Added to workflow per registry pattern. CI green. |

---

## 8. Invariants

### Preserved (must not break)

| ID | Description | How Tr1 preserves it |
|---|---|---|
| I-1.2-BRAND-AS-CONTAINER | `brands.kind` is starting identity, NOT capability gate. Any brand can author any offering type via the universal "+" creator. | Tr1's Home CTA is informational ("Plan a trip" recommendation) — it does NOT prevent a trip-planner brand from creating events. Universal "+" creator (M0) untouched. |
| I-1.2-UNIFIED-EVENT-TYPE | Every sellable thing in Mingla Business 1.2 is a row in `public.events` distinguished by `event_type`. | Tr1 is brand-layer only — no `events` changes, no parallel `trips` table. Tr2 will INSERT into events with `event_type='trip'` per this invariant. |
| Constitution #2 (one owner per truth) | No duplicate state authorities. | `brands.kind` remains the single source of truth for brand type. Wizard reads/writes via the same `useCreateBrand` mutation as today. |
| Constitution #3 (no silent failures) | Errors must surface. | All TripBrandWizard error states surface inline or via banner — never swallowed. |
| Constitution #8 (subtract before adding) | Don't layer on broken code. | Existing minimal popup-brand create flow preserved verbatim — no rewrite. New code is additive (persona mode + trip-create mode + new components). |
| Constitution #9 (no fabricated data) | Missing = hidden, never fake. | Trip-planner brand without Stripe → CTA says "Finish Stripe setup" honestly, does NOT fake an "active" state. |
| Constitution #14 (persisted-state startup) | `_hasHydrated` gate. | TripBrandWizard does NOT touch hydration; it operates after auth state is hydrated (same as existing BrandSwitcherSheet). |
| I-38 (WCAG AA touch ≥ 44pt) | Interactive Pressables have ≥44×44 touch target. | PersonaPickerCards wrap icon in 44×44 touch target; full card row is the Pressable hit-area. |
| I-39 (accessibilityLabel on interactive Pressable) | Every interactive Pressable has explicit accessibilityLabel. | PersonaPickerCards + TripBrandWizard buttons + Home CTA all specify accessibilityLabel. |
| `feedback_topsheet_extended_universal_creator.md` | TopSheet has 2 acceptable consumers; further consumers need orchestrator approval. | Tr1 does NOT add a new TopSheet consumer — it embeds new modes (persona, trip-create) INSIDE the existing BrandSwitcherSheet TopSheet consumer. No new consumer added. |
| `feedback_rn_color_formats` | hex/rgb/hsl/hwb only (no oklch/lab/lch). | All Tr1 inline-color usage uses hex / accent tokens from designSystem. |
| `feedback_keyboard_never_blocks_input` | Keyboard never blocks an input field. | TripBrandWizard implements keyboard avoidance (Cycle 3 pattern) for name + bio inputs. |

### New (introduced by Tr1)

| ID | Status | Description |
|---|---|---|
| **I-PROPOSED-TR1-PERSONA-INTERFACE** | DRAFT — flips ACTIVE on ORCH-0855 CLOSE | `PersonaPickerCards` accepts `personas: PersonaDef[]` where `PersonaDef.id` is the locked union `'place' | 'event' | 'trip'`. Widening the union requires a new ORCH + SPEC + invariant amendment. **Why:** prevents Ve1 (different developer, same `BrandSwitcherSheet`) from forking the interface and creating drift. **Enforcement:** optional strict-grep gate `i-tr1-persona-picker-interface.mjs` (file 14) + TypeScript at compile-time. **EXIT:** permanent until/unless a future ORCH explicitly adds a 4th persona (e.g., "A creator economy brand"). |
| **I-PROPOSED-TR1-KIND-IMMUTABLE** | DRAFT — flips ACTIVE on ORCH-0855 CLOSE | `brands.kind` is IMMUTABLE post-create for `kind='trip_planner'`. `BrandEditView` MUST NOT render a kind editor for trip-planner brands. The kind toggle for legacy brands MUST NOT include `'trip_planner'` as an option. **Why:** switching kind post-create breaks Stripe-status gating semantics, downstream analytics funnels, and trip-planner-specific UX assumptions. Physical↔popup switching predates this invariant and is grandfathered (low-risk because neither has Stripe-required semantics). **Enforcement:** SC-17 + SC-18 + tester adversarial check (file 13). **EXIT:** permanent. |

---

## 9. Test matrix

Per Step 0.5 regression gate (META-ORCH-0840). Implementor writes happy-path; tester writes adversarial attacking different angles. Both fails-on-revert verified at commit hashes cited in respective reports.

### Implementor tests (files 10, 11, 12)

| Test | SC mapped | Scenario | Input | Expected | Layer | Owner |
|---|---|---|---|---|---|---|
| T-01 | SC-01 | Footer "Create a new brand" tap | mode='switch', tap footer button | mode becomes 'persona' | Component | jest (file 10) |
| T-02 | SC-02, SC-19 | Persona picker render | mode='persona' | Exactly 3 cards in order [place, event, trip]; "place" disabled | Component | jest (file 10) |
| T-03 | SC-03 | "A trip" card content | render persona picker | Card text === "A trip" + description match | Component | jest (file 10) |
| T-04 | SC-04 | Tap disabled "place" card | mode='persona', press place card | onSelect NOT called; mode stays 'persona' | Component | jest (file 10) |
| T-05 | SC-05 | Tap "A trip" | mode='persona', press trip card | mode becomes 'trip-create'; TripBrandWizard mounted | Component | jest (file 10) |
| T-06 | SC-06 | Tap "An event" preserves popup flow | mode='persona', press event card, enter "Test Brand", submit | mode='popup-create'; createBrand called with kind='popup', coverHue=25, address=null | Component + Service | jest (file 10) |
| T-07 | SC-07 | Wizard fields render | mount TripBrandWizard | name Input, bio Input, cover picker, submit button all present | Component | jest (file 11) |
| T-08 | SC-08 | Cover upload service path | mount wizard, set cover file, submit | uploadBrandCover called with new brand id + file | Component + Service | jest (file 11) |
| T-09 | SC-09 | Brand insert with trip_planner kind | wizard submit happy path | createBrand mutation called with kind='trip_planner', mock returns brand row | Component + Service | jest (file 11) |
| T-10 | SC-10 | Migration probe (deferred to TEST mode) | live DB after migration | `pg_get_constraintdef` includes 'trip_planner' | DB | TEST mode (live SQL) |
| T-11 | SC-11 | Route to /brand/{id}/payments | wizard submit success | router.push called with `/brand/${newBrand.id}/payments` | Component + Routing | jest (file 11) |
| T-12 | SC-12 | Slug collision recovery | wizard submit, mock createBrand throws SlugCollisionError | inline error rendered, form re-enabled, no router.push | Component | jest (file 11) |
| T-13 | SC-13 | Cover upload failure after brand insert | wizard submit, brand insert OK, mock uploadBrandCover throws | banner rendered, status continues to routing-to-stripe, brand row persisted | Component | jest (file 11) |
| T-14 | SC-14 | Home CTA — Stripe not active | render home with currentBrand.kind='trip_planner', stripeStatus='not_started' | "Finish Stripe setup" CTA rendered, routes /brand/{id}/payments | Component | jest (file 11 OR new home.cta.test.tsx) |
| T-15 | SC-15 | Home CTA — Stripe active | render home with currentBrand.kind='trip_planner', stripeStatus='active' | "Plan a trip" CTA rendered, routes /trip/coming-soon | Component | jest (same) |
| T-16 | SC-16 | Home CTA — non-trip-planner | render home with currentBrand.kind='popup' | NO trip-planner CTA rendered (regression) | Component | jest (same) |
| T-17 | SC-17 | BrandEditView no kind editor for trip_planner | render with brand.kind='trip_planner' | kind editor block NOT in render output | Component | jest (file 11 OR new) |
| T-18 | SC-18 | BrandEditView kind editor for legacy brands | render with brand.kind='popup' | kind editor renders; options array does NOT include 'trip_planner' | Component | jest (same) |
| T-25 | SC-25 | PersonaDef.id union locked | TypeScript compile-time | `const bad: PersonaDef = { id: 'invalid', ... }` fails tsc | Type-system | tsc + file 12 |

### Tester adversarial check (file 13)

`mingla-business/scripts/ci/orch-0855-adversarial-check.mjs` — node-mjs script, 12+ structural assertions, attacks DIFFERENT angles than implementor jest tests:

| Check | Asserts | Attack angle (different from implementor) |
|---|---|---|
| A-01 | Migration file exists at `supabase/migrations/<timestamp>_orch_0855_brands_kind_trip_planner.sql` | Filename pattern |
| A-02 | Migration contains literal `'trip_planner'` AND literal `RAISE EXCEPTION 'ORCH-0855 migration` (self-verify block present) | DDL structural |
| A-03 | Migration uses BEGIN; ... COMMIT; transactional wrapping | Transaction safety |
| A-04 | `types/brand.ts` `kind` union includes `'trip_planner'` (regex match on the type literal) | Type-source structural |
| A-05 | `brandMapping.ts` BOTH BrandRow line + BrandUiInput line widened (2 hits) | Service-source structural |
| A-06 | `brandsService.ts` `CreateBrandInput.kind` union widened | Service-source structural |
| A-07 | `PersonaPickerCards.tsx` exports `PersonaDef` AND `PersonaPickerCards`; `PersonaDef.id` literal type matches `'place' | 'event' | 'trip'` exactly (no widening) | Locked interface |
| A-08 | `BrandSwitcherSheet.tsx` `Mode` type union contains ALL 4 modes: `'switch'`, `'persona'`, `'popup-create'`, `'trip-create'` | State machine completeness |
| A-09 | `BrandSwitcherSheet.tsx` popup-create mode passes `kind: "popup"` (regression — popup flow unchanged) | Backward-compat |
| A-10 | `TripBrandWizard.tsx` calls `createBrand` mutation with `kind: 'trip_planner'` literal | Wizard contract |
| A-11 | `TripBrandWizard.tsx` final navigation step is `router.push(\`/brand/${...}/payments\`)` (Stripe Connect entry) | Routing contract |
| A-12 | `home.tsx` contains a `currentBrand.kind === "trip_planner"` branch AND a `stripeStatus === "active"` / `!== "active"` branch (gating logic) | Stripe-status gating |
| A-13 | `BrandEditView.tsx` does NOT contain `"trip_planner"` inside any kind toggle options array (regex: array literal containing kind values) | Immutability gate |
| A-14 | Adversarial: greps the entire `mingla-business/src/` for any string `trip_planner` and asserts it appears in expected files only — fails if `'trip_planner'` is introduced in unexpected files (Tr2 scope leak detection) | Scope guardrail |

Each check fails-on-revert at the commit hash cited in the QA report.

---

## 10. Regression prevention

| Class of bug | Safeguard | Test that catches it |
|---|---|---|
| Persona-fork drift (Ve1 forks the interface) | TypeScript `PersonaDef.id` literal union + optional strict-grep gate (file 14) + adversarial check A-07 | T-25 + A-07 |
| Popup-brand creation regression (Tr1 breaks today's "An event" flow) | popup-create mode preserves byte-equivalent submit logic; T-06 asserts createBrand called with exact old args (kind='popup', coverHue=25, address=null) | T-06 + A-09 |
| Kind editor accidentally admits trip_planner | A-13 adversarial grep asserts no 'trip_planner' in BrandEditView kind options | T-18 + A-13 |
| Stripe-status gating drift (CTA shows "Plan a trip" before Stripe done) | T-14 + T-15 + T-16 + A-12 | All four |
| Migration applied but client code not deployed (intermediate state) | Step 7 implementation order GATE — implementor halts after Step 1 until operator confirms migration live | Implementor process discipline + tester verifies migration constraint state via live SQL in QA |
| Universal "+" creator gated on kind (violates I-1.2-BRAND-AS-CONTAINER) | SC-22 + implementor MUST NOT add kind branches to UniversalCreatorSheet | SC-22 test (jest mount of universal creator for trip_planner brand) |
| Trip-planner brand soft-delete breaks | SC-21 + existing softDeleteBrand tests already cover the path — no Tr1 changes to softDeleteBrand | T-21 (regression jest) |

**Protective comments:** every NEW file (PersonaPickerCards, TripBrandWizard, migration) carries a header docstring citing ORCH-0855 + the locked-interface invariants + the immutability rule. Implementor must NOT omit these.

---

## 11. Discoveries to register (from investigation §10)

The orchestrator MUST decide on each before CLOSE:

| ID | Description | Recommendation |
|---|---|---|
| DISCOVERY-1 | Hardcoded `displayName = "Lonely Moth"` in `BrandSwitcherSheet.tsx:92` (pre-existing P3) | Bundle as 1-line drop into Tr1 (replace with `""`) iff operator approves; otherwise register as standalone follow-up ORCH. |
| DISCOVERY-2 | `BrandOnboardView.tsx:183` `selectedCountry` defaults to `DEFAULT_COUNTRY = "GB"` — affects all brand kinds | Out of Tr1 scope. Register as cross-cutting follow-up ORCH. |
| DISCOVERY-3 | `AppsFlyer mingla_brand_created` event has no `kind` discriminator | Out of Tr1 scope. Register as analytics-polish follow-up ORCH if operator wants per-kind funnel. |
| DISCOVERY-4 | BrandEditView kind immutability | RESOLVED inside Tr1 (SC-17 + SC-18 + I-PROPOSED-TR1-KIND-IMMUTABLE invariant). |
| DISCOVERY-5 | Cross-track coordination with Ve1 | Orchestrator shares Tr1 SPEC with Ve1 developer once approved. Ve1 plugs into the locked `PersonaDef[]` interface. |

---

## 12. Open polish item resolutions (from milestone brief §9 — locked here, no further SPEC revisions needed)

| Brief §9 item | Resolution |
|---|---|
| §9-1 Persona picker always-visible vs no-match-only | **ALWAYS-visible when "create" mode opens.** No name-matching prerequisite exists in BrandSwitcherSheet today; Tr1 does not introduce one. Simpler + matches M0's UniversalCreatorSheet always-shown 3-card pattern. |
| §9-2 Stripe Connect failure / stall recovery UX | **Delegated to existing BrandOnboardView.** TripBrandWizard creates brand + routes to `/brand/{id}/payments`; BrandOnboardView's mature 5-state error handling (cancelled / failed-stripe / failed-network / session-expired / already-active) applies as-is. Tr1 does NOT replicate that 300-line state machine. |
| §9-3 Trip-planner visual differentiator in brand switcher | **DEFERRED to follow-up polish ORCH.** Tr1 ships trip-planner brand rows with the standard avatar+initial pattern (SC-20). Adding a per-kind chip is a small SPEC for a separate ORCH. |
| §9-4 Resume Stripe Connect CTA on Home | **INCLUDED in SC-14.** Trip-planner-specific. Renders "Finish Stripe setup" CTA when `stripeStatus !== 'active'`. |

---

## 13. P1 resolutions (from investigation §5)

| P1 | Resolution |
|---|---|
| P1-1 Sideways Ve1 coordination on persona-fork interface | LOCKED via I-PROPOSED-TR1-PERSONA-INTERFACE (DRAFT → ACTIVE on CLOSE) + adversarial check A-07. Orchestrator shares this SPEC with Ve1 developer. |
| P1-2 Stripe Connect country picker placement | DELEGATED to existing BrandOnboardView via `router.push('/brand/{id}/payments')`. TripBrandWizard does NOT include a country picker. Spec §4.5.2 step 11 (routing flow) is the contract. |

---

## 14. CLOSE protocol notes (orchestrator-facing)

- **No edge function changes** → orchestrator deploy step (per `feedback_orchestrator_deploys_edge_functions.md`) is N/A for Tr1.
- **Migration apply** → operator-owned (`supabase db push --linked`). Implementor halts at Step 1 until operator confirms.
- **EAS OTA** → eligible from `mingla-business/` (pure JS+TS change, no native modules). Two separate commands per `feedback_eas_update_no_web.md`: `--platform ios` then `--platform android`.
- **DIAG reap** → zero `[ORCH-0855-DIAG]` markers expected (none specified in this SPEC).
- **Memory updates at CLOSE:**
  - NEW: `feedback_persona_picker_locked_interface.md` (status: DRAFT → ACTIVE on CLOSE) — codifies I-PROPOSED-TR1-PERSONA-INTERFACE.
  - NEW: `feedback_brand_kind_immutable_post_create.md` (status: DRAFT → ACTIVE on CLOSE) — codifies I-PROPOSED-TR1-KIND-IMMUTABLE.
  - UPDATE: `MEMORY.md` index with both new entries.
- **Decision log entries:**
  - DEC-XXX: Tr1 persona-fork interface locked to 3 ids (place/event/trip) per I-PROPOSED-TR1-PERSONA-INTERFACE.
  - DEC-XXX: `brands.kind` immutable post-create for trip_planner per I-PROPOSED-TR1-KIND-IMMUTABLE.
- **WORLD_MAP + COVERAGE_MAP + PRODUCT_SNAPSHOT updates** per standard CLOSE Step 1.

---

## 15. Cross-references

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md`
- Milestone brief: `Mingla_Artifacts/milestones/Tr1_TRIP_PLANNER_ONBOARDING.md`
- M0 upstream: `Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md`, `Mingla_Artifacts/reports/QA_ORCH-0826_M0_HUB_FOUNDATION.md`
- Project spec: `Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md` (§54 I-1.2-BRAND-AS-CONTAINER, §8 DEC-4)
- Working doc §6.2 (Track 1 Trip Planners): `Mingla_Artifacts/MINGLA_BUSINESS_1_2_WORKING_DOC.md`
- Invariants: `Mingla_Artifacts/INVARIANT_REGISTRY.md` (I-1.2-UNIFIED-EVENT-TYPE ACTIVE, I-1.2-BRAND-AS-CONTAINER per PROJECT_SPEC, NEW I-PROPOSED-TR1-PERSONA-INTERFACE + I-PROPOSED-TR1-KIND-IMMUTABLE DRAFT)
- Decisions: `Mingla_Artifacts/DECISION_LOG.md` (DEC-4, DEC-121/122 Connect multi-country, DEC-152 TopSheet)
- Operator memory: `feedback_topsheet_extended_universal_creator.md` (ACTIVE), `feedback_orchestrator_deploys_edge_functions.md` (no edge changes → N/A here), `feedback_strict_grep_registry_pattern.md` (file 14 optional gate), `feedback_keyboard_never_blocks_input.md` (wizard avoids), `feedback_rn_color_formats.md` (inline colors).
