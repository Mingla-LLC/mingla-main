# INVESTIGATION — ORCH-0855 [Tr1 Trip Planner Brand Onboarding]

**Mode:** INVESTIGATE
**Skill:** Claude `mingla-forensics`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md`
**Milestone brief:** `Mingla_Artifacts/milestones/Tr1_TRIP_PLANNER_ONBOARDING.md`
**Affected Surfaces:** business iOS, business Android, database. NOT in scope: consumer (no consumer surface), buyer-web (anonymous flows untouched), admin-web (Stripe Connect KYC replaces phone-callback per DEC-4 / project spec §8).

---

## 1. Executive Summary (layman)

Tr1 is structurally **clean to build**. M0 (ORCH-0826) shipped exactly the foundation Tr1 needs — universal "+" creator, `events.event_type` discriminator, TopSheet `heightMode="compact"` primitive, kind-discriminated brand model. None of M0's surfaces conflict with Tr1.

The work is almost entirely **net-new product code on top of stable infrastructure**: a 3-card persona picker, a trip-brand wizard, a `kind`-aware Home CTA, plus a 1-line `CHECK`-constraint migration on `public.brands`. The brief's claim that `createBrand` "already accepts a `kind` param" is *shape-true but value-false* — the param exists, but its TypeScript union is `"physical" | "popup"`. Widening the union to admit `"trip_planner"` is a 3-file change (types/brand.ts, brandMapping.ts, brandsService.ts).

There are **zero blockers**: Jest is wired in `mingla-business/`, the Stripe Connect edge function + `WebBrowser.openAuthSessionAsync` flow + universal HTTPS bounce route are all kind-agnostic and reusable as-is, the `brand_covers` storage pipeline exists, and the 7 RLS policies on `brands` do not reference `kind` — the migration is fully RLS-transparent. Live DB confirms `brands_kind_check` is `('physical','popup')` with 12 brands all `kind='popup'` and zero `physical` — no data backfill needed.

The riskiest unknown is **scope coordination with Ve1** (Track 2, different developer): both milestones need a persona-fork in `BrandSwitcherSheet`. Whichever lands first sets the framework. The SPEC must define the persona-card interface explicitly enough that the second developer can plug in without rewriting.

**Recommended direction:** widen types → migrate → build PersonaPickerCards → build TripBrandWizard → wire Stripe Connect launch → add kind-aware Home CTA. Each step independently revertible.

---

## 2. Phase 0 Ingestion Checklist

| Input | Status |
|---|---|
| `Mingla_Artifacts/milestones/Tr1_TRIP_PLANNER_ONBOARDING.md` | ✅ read end-to-end |
| `Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md` (M0 spec) | ✅ DB section + universal creator section |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0826_M0_HUB_FOUNDATION.md` (M0 impl) | ✅ scanned for brand-kind touches (none) |
| `Mingla_Artifacts/reports/QA_ORCH-0826_M0_HUB_FOUNDATION.md` (M0 QA) | ✅ verdict context |
| `Mingla_Artifacts/MINGLA_BUSINESS_1_2_WORKING_DOC.md` §§3.1 + 8 + 6.2 | ✅ DEC-4 Stripe Connect-as-identity + Tr1 plan |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-1.2-UNIFIED-EVENT-TYPE | ✅ |
| `Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md` §54 I-1.2-BRAND-AS-CONTAINER | ✅ |
| `Mingla_Artifacts/DECISION_LOG.md` DEC-152 (TopSheet) + DEC-121/122 (B2a V3 Connect) | ✅ |

No prior investigation exists for ORCH-0855 — clean slate. No DRAFT memory or prior dispatch contradicts findings below.

---

## 3. Findings (six-field evidence per section)

Legend: 🔴 root cause · 🟠 contributing factor · 🟡 hidden flaw · 🔵 observation

### A. BrandSwitcherSheet today — no persona fork exists

🔵 **Observation A-1** — Current sheet has exactly two modes, no persona concept.

- **File + line:** `mingla-business/src/components/brand/BrandSwitcherSheet.tsx:66, 90-105, 268-312`
- **Exact code:**
  ```ts
  type Mode = "switch" | "create";
  // …
  const initialMode: Mode = brandList.isTrueEmpty ? "create" : "switch";
  // Create mode renders Input(displayName) → Button(Create brand)
  ```
- **What it does:** Renders `"switch"` (list of brands + footer "Create a new brand") or `"create"` (single displayName Input → submit). On submit, calls `createBrandMutation.mutateAsync({...kind: "popup"...})` with hardcoded `kind` and `coverHue`.
- **What it should do (per Tr1 brief §3-1..3):** Show three persona cards ("A place" / "An event" / "A trip") and route to the selected persona's wizard.
- **Causal chain:** No persona fork → no way for a trip planner to declare intent → no `kind='trip_planner'` brand can be created from the UI today.
- **Verification step:** grep `mingla-business/src/` for `persona`, `PersonaPicker`, `trip_planner` — zero hits in component code.

🟡 **Hidden flaw A-2** — Hardcoded test-data default in Production code.

- **File + line:** `BrandSwitcherSheet.tsx:92`
- **Exact code:** `const [displayName, setDisplayName] = useState<string>("Lonely Moth");`
- **What it does:** Pre-fills the brand-name input with "Lonely Moth" for every real user opening the create form today.
- **What it should do:** Empty string (let placeholder render), or remove the default.
- **Causal chain:** Real users see "Lonely Moth" as their brand name unless they clear it — produces fabricated-default brand names on lazy submit. Constitution #9 adjacent (fabricated data shown to user).
- **Verification step:** open business app create flow on iOS sim → confirm displayName is prefilled with "Lonely Moth".
- **Scope note:** **Pre-existing, out of Tr1 scope.** Register as DISCOVERY-1 for orchestrator. Tr1 will refactor this file but should NOT fix this in-flight (scope discipline). Operator may choose to bundle the fix if it's a 1-line drop during Tr1 implementation.

🔵 **Observation A-3** — TopSheet primitive already supports the compact mode Tr1 needs.

- **File + line:** `BrandSwitcherSheet.tsx:186` (`<TopSheet visible={visible} onClose={onClose}>` — no explicit `heightMode` prop, uses default)
- **Per DEC-152:** TopSheet has `heightMode={"fixed-70"|"compact"}` since ORCH-0826 M0. UniversalCreatorSheet uses `"compact"`. Trip-brand wizard with 3 fields + cover picker may want `"compact"` or could grow taller → SPEC decision.

### B. Connect-onboarding flow today — fully reusable as-is

🔵 **Observation B-1** — Edge function does NOT take `kind`; it's brand-agnostic.

- **File + line:** `supabase/functions/brand-stripe-onboard/index.ts:74-76, 260-281`
- **Exact code:**
  ```ts
  brand_id: string;
  return_url: string;
  country: string;   // V3 multi-country; from 34-country allowlist
  ```
- **What it does:** Verifies caller can manage payments for brand, reads existing `stripe_connect_accounts` row for the brand, creates Stripe Account via `POST /v2/core/accounts` (with country normalization), creates Account Link via `POST /v2/core/account_links`, returns `{onboarding_url, account_id}`.
- **What it should do for Tr1:** Same. Tr1 needs NO edge-function changes. Brand identity (kind, name, owner) is fetched from `brands` table inside edge fn — `kind='trip_planner'` is transparent to Stripe Connect because Stripe doesn't care about Mingla's classification.
- **Causal chain:** Edge fn is kind-agnostic → Tr1 wizard can launch existing flow via `useStartBrandStripeOnboarding({brandId, returnUrl: "mingla-business://onboarding-complete", country})`.
- **Verification step:** grep `supabase/functions/brand-stripe-onboard/` for `kind` — zero hits.

🔵 **Observation B-2** — `stripe-onboarding-return.tsx` is already kind-transparent.

- **File + line:** `mingla-business/app/stripe-onboarding-return.tsx:25-50`
- **Exact code:**
  ```ts
  function isAllowedReturnTo(value: string | null): value is string {
    return value.startsWith("mingla-business://") || value.startsWith("https://business.usemingla.com/");
  }
  ```
- **What it does:** HTTPS bounce route. Routes back to whatever `return_to` deep link the caller passed, regardless of brand kind. Already works for Tr1 unmodified.
- **Tr1 §7 regression #2 ("Stripe Connect onboarding return routes back to Home regardless of brand kind"):** ✅ satisfied with no changes needed.

🔵 **Observation B-3** — `BrandOnboardView` is the existing in-app Connect entry; Tr1 can reuse OR replicate inline.

- **File + line:** `mingla-business/src/components/brand/BrandOnboardView.tsx:97, 164, 343-431`
- **Existing pattern:** mutation → openAuthSessionAsync → settle status. Surfaces `cancelled` / `failed-stripe` / `failed-network` / `already-active` states with copy.
- **SPEC question:** does TripBrandWizard call `useStartBrandStripeOnboarding` directly + reuse `WebBrowser.openAuthSessionAsync` inline (300 lines of state-machine to replicate), OR does it create the brand row then `router.push('/brand/${id}/payments')` to land in BrandOnboardView's mature flow? Recommendation: route to existing `/brand/{id}/payments` to avoid duplicating the entry-state machine.

### C. brands table + kind constraint — live DB verified

🔴 **Root cause C-1 (the blocker the migration fixes)** — Live constraint rejects `'trip_planner'`.

- **File + line:** live DB queried via MCP `execute_sql` 2026-05-17:
  ```sql
  SELECT pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conrelid = 'public.brands'::regclass AND conname = 'brands_kind_check';
  -- => CHECK ((kind = ANY (ARRAY['physical'::text, 'popup'::text])))
  ```
- **Source migration (latest):** `supabase/migrations/20260506000000_brand_kind_address_cover_hue_media.sql:18-19`
- **What it does:** Any `INSERT INTO brands (kind) VALUES ('trip_planner')` fails with `23514 check_violation`.
- **What it should do (per Tr1 §5):** DROP + re-ADD as `('physical', 'popup', 'trip_planner')`.
- **Causal chain:** Constraint blocks insert → wizard cannot create a trip-planner brand → entire Tr1 user flow broken at DB boundary.
- **Verification step:** post-migration, `INSERT INTO brands (account_id, name, slug, kind, cover_hue) VALUES (auth.uid(), 'Test', 'test', 'trip_planner', 25)` should succeed.

🔵 **Observation C-2** — Live data: 12 brands, all `kind='popup'`, zero `'physical'`.

- **Probe:** `SELECT kind, count(*) FROM brands WHERE deleted_at IS NULL GROUP BY kind;` → `[{kind:'popup', count:12}]`
- **Implication:** No data backfill needed. Migration is pure DDL. Idempotent. Revertible (DROP + re-ADD original CHECK).

🔵 **Observation C-3** — Seven RLS policies on `brands`; none reference `kind`.

- **Probe:** `SELECT polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid = 'public.brands'::regclass;`
- **Policies:** Account owner SELECT/INSERT/UPDATE, brand-admin-plus UPDATE/DELETE, brand-members SELECT, public read of brands with public events. **Zero `kind`-aware predicates.**
- **Implication:** Tr1 migration is fully RLS-transparent. No policy needs `kind`-aware update. Trip-planner brands inherit the same per-account ownership + brand-member visibility as today's popup brands. ✅

### D. brandsService.createBrand — kind union too narrow

🔴 **Root cause D-1** — `CreateBrandInput.kind` literal-typed `"physical" | "popup"`.

- **File + line:** `mingla-business/src/services/brandsService.ts:82-94`
- **Exact code:**
  ```ts
  export interface CreateBrandInput {
    accountId: string;
    name: string;
    slug: string;
    kind: "physical" | "popup";
    address: string | null;
    coverHue: number;
    bio?: string;
    tagline?: string;
    // …
  }
  ```
- **What it does:** TypeScript compiler rejects `createBrand({...kind: "trip_planner"...})` at the call site.
- **What it should do:** Union widened to `"physical" | "popup" | "trip_planner"`.
- **Causal chain:** Union narrow → TripBrandWizard cannot type-check → cannot ship.
- **Verification step:** post-fix, `createBrand({accountId, name:"X", slug:"x", kind:"trip_planner", address:null, coverHue:25}, "owner")` type-checks.
- **Tr1 brief §4 line "the service already takes a `kind` param":** *shape-true* (param exists, line 86) but *value-false* (admitted values don't include `'trip_planner'`).

🔵 **Observation D-2** — `createBrand` runtime logic itself is kind-agnostic.

- **File + line:** `brandsService.ts:110-151`
- **What it does:** Calls `mapUiToBrandInsert(input)` → `supabase.from('brands').insert(payload).select().single()`. No kind-aware branching. `kind` flows through `mapUiToBrandInsert` (`brandMapping.ts:274`: `if (brand.kind !== undefined) row.kind = brand.kind;`). Once types widen, runtime works.
- **AppsFlyer event** at line 148 fires `mingla_brand_created` with `brand_id`. No kind discriminator on the funnel event. Optional SPEC question: do we want a per-kind funnel breakdown?

🔴 **Root cause D-3** — Same narrow union in `brandMapping.ts` × 2.

- **File + line:** `mingla-business/src/services/brandMapping.ts:45` (BrandRow), `:74` (BrandUiInput)
- **Exact code:**
  ```ts
  kind: "physical" | "popup";   // BrandRow line 45
  kind?: "physical" | "popup";  // BrandUiInput line 74
  ```
- **Same fix as D-1.** Must widen both.

🔴 **Root cause D-4** — Same narrow union in `types/brand.ts`.

- **File + line:** `mingla-business/src/types/brand.ts:192`
- **Exact code:** `kind: "physical" | "popup";`
- **Same fix.** This is the public `Brand` interface type — widening it ripples through every consumer.

### E. useBrands.useCreateBrand — passes `kind` through cleanly

🔵 **Observation E-1** — Optimistic temp-brand construction respects input `kind`.

- **File + line:** `mingla-business/src/hooks/useBrands.ts:218-247`
- **Exact code:** `kind: input.kind` (line 231) in the optimistic tempBrand object.
- **What it does:** Passes `input.kind` through verbatim — no stripping, no transformation.
- **Implication:** No code change to `useBrands.ts` required. Once `CreateBrandInput.kind` widens upstream, the hook compiles and behaves correctly. Tr1 brief §4 hook-layer claim is **fully accurate**.

🔵 **Observation E-2** — React Query invalidation pattern stable.

- **File + line:** `useBrands.ts:261-275` (onSuccess swap temp → server brand) + `brandKeys.all` invalidation on settled (line ~93 area).
- **Implication:** No cache-key drift risk for `kind='trip_planner'`. ✅

### F. Home tab CTA — no kind-aware branching today

🔴 **Root cause F-1** — Home CTA is brand-kind-blind.

- **File + line:** `mingla-business/app/(tabs)/home.tsx:320-332, 342-383, 384+`
- **Exact code (universal "+" button):**
  ```tsx
  <IconChrome icon="plus" size={36}
    onPress={() => setIsUniversalCreatorOpen(true)}
    accessibilityLabel="Create event, experience, or trip" />
  ```
- **What it does:** Renders one universal "+" button (M0 work). Empty state shows "No brands yet". Populated state shows 7-day stats + KPI grid. **Zero `currentBrand.kind ===` branches anywhere.**
- **What it should do (per Tr1 §3-9 / SC-9):** When `currentBrand?.kind === 'trip_planner'`, render a "Plan a trip" CTA card in the empty-event / no-trips state.
- **Causal chain:** No kind branch → trip-planner brand owners see the same Home as popup-brand owners → no actionable next step pointing them to trip creation.
- **Verification step:** SPEC defines a `kind`-aware CTA component; tests render `<Home/>` with mocked `currentBrand.kind='trip_planner'` and assert "Plan a trip" CTA rendered.

🟡 **Hidden flaw F-2** — "Plan a trip" CTA pre-Tr2 has nowhere to go.

- **Context:** Tr1 ships only brand onboarding. Trip CREATION wizard is Tr2 scope. Tr1 SC-9 demands the CTA exists, but tapping it can only:
  (a) open `UniversalCreatorSheet` pre-selected on "Create trip" (which routes to `/trip/coming-soon.tsx` per ORCH-0826 M0), OR
  (b) render an inline "Coming soon — trip creation ships in Tr2" stub.
- **Per ORCH-0826 M0:** `app/trip/coming-soon.tsx` already exists as a stub.
- **SPEC decision:** Tr1 wires the CTA to the existing `/trip/coming-soon` route. Tr2 replaces that route with the real wizard. Clean handoff, no Tr1↔Tr2 coupling.

### G. Cover image upload pipeline — fully reusable

🔵 **Observation G-1** — `brand_covers` storage + service + picker all exist.

- **File + lines:**
  - `mingla-business/src/services/brandCoverService.ts:37` → `export const BRAND_COVERS_BUCKET = "brand_covers";`
  - `mingla-business/src/services/brandCoverService.ts:6` → `uploadBrandCover` (device file → bucket)
  - `mingla-business/src/components/brand/BrandCoverPickerSheet.tsx` (3-tab image/video/gif picker)
- **What it does:** Production-tested pipeline used by `BrandEditView` post-create today.
- **Tr1 §4-5 reuse claim:** ✅ accurate. TripBrandWizard can embed `<BrandCoverPickerSheet>` (or a stripped variant) and call `uploadBrandCover(brandId, file)` after the brand row exists.
- **SPEC question:** does TripBrandWizard upload cover **before** the brand row exists (requires a temp path, then move) or **after** (requires a `brandId` from the insert before cover step)? Recommend AFTER — create brand row first, then cover upload happens with real `brandId`.

### H. Persona-fork scaffolding — none exists; build framework Tr1-first

🔴 **Root cause H-1** — Zero scaffolding anticipates a 3-card persona picker for brand creation.

- **Grep:** `grep -rn "PersonaPicker\|persona" mingla-business/src/components/brand/` → zero hits
- **What exists:** `UniversalCreatorSheet` from ORCH-0826 M0 has a similar 3-card pattern (Create event / experience / trip) but at the *event* creator level, not brand creator level. The visual/interaction pattern is a useful precedent — Tr1 SPEC should mimic it.
- **Sideways with Ve1 (Track 2):** Ve1 wants the same 3-card fork in BrandSwitcherSheet but with the "A place" card wired to the venue claim flow. **Whichever milestone lands first sets the framework.** Tr1 is going first (per operator directive 2026-05-17 prioritizing Track 1 over Track 2 for this single-developer Claude session; Ve1 is owned by a separate developer).
- **SPEC requirement:** Tr1 must define `PersonaPickerCards` with a stable interface that allows Ve1 to add the "A place" card without rewriting the framework. Recommended interface:
  ```ts
  interface PersonaDef {
    id: 'place' | 'event' | 'trip';
    title: string;
    description: string;
    icon: IconName;
    onSelect: () => void;
  }
  // PersonaPickerCards.tsx accepts personas: PersonaDef[] and renders cards in order.
  ```
- **Causal chain:** Without explicit interface, Ve1 developer either rewrites BrandSwitcherSheet (breaking Tr1) or duplicates the pattern (drift). SPEC must lock the contract.

### I. Stripe Connect abandonment recovery — works naturally, needs Home affordance

🔵 **Observation I-1** — Brand row exists pre-Connect; abandonment leaves brand in derivable "stripe-pending" state.

- **Today's flow:** `BrandSwitcherSheet` creates brand row → operator separately opens `/brand/{id}/payments` → `BrandOnboardView` launches Connect. Abandonment leaves `brands.stripe_connect_id = NULL`, `stripe_charges_enabled = false`.
- **Tr1's flow (intended per SPEC):** TripBrandWizard creates brand row → immediately launches Connect → return to Home. Abandonment leaves brand row exists, Stripe fields NULL — exactly the same persistent state as today.
- **Derived state:** `brandMapping.ts:203` derives `stripeStatus` from `(stripe_connect_id, charges_enabled, payouts_enabled, requirements)`. `null,false,false,*` → status `'not_started'`. Existing UI handles this.

🟡 **Hidden flaw I-2** — Home has no "Resume Stripe setup" CTA today.

- **Context:** For popup organizers, Stripe Connect is OPTIONAL until they publish a paid event — abandonment is fine, low cost. For trip planners, Stripe Connect is REQUIRED (DEC-4) — abandonment is high-cost because the trip planner cannot operate without it.
- **SPEC decision:** Should Home render a "Finish Stripe setup" CTA when `currentBrand.kind === 'trip_planner' && stripeStatus !== 'active'`, possibly overriding the "Plan a trip" CTA? Recommend YES — gate "Plan a trip" behind `stripeStatus === 'active'`, otherwise show "Finish Stripe setup" CTA routing to `/brand/{id}/payments`.

### J. Backward-compat — BrandSwitcherSheet is sole brand-creation surface

🔵 **Observation J-1** — `useCreateBrand` has exactly one importer.

- **Grep:** `grep -rn "useCreateBrand\|from.*useBrands" mingla-business/src/ | grep import` → only `BrandSwitcherSheet.tsx:46`
- **Implication:** No alternative brand-creation path exists (no deep link, no admin flow, no API tool). Tr1's refactor of BrandSwitcherSheet is the entire surface area. Backward-compat (Tr1 §3-13: "popup brand creation still accessible") is preserved by routing the "An event" persona card to today's minimal create form (`kind='popup'`, hardcoded `coverHue:25`).

### K. Regression-test infrastructure — Jest is wired

🔵 **Observation K-1** — `mingla-business/` has Jest configured + active test suites.

- **Files:**
  - `mingla-business/jest.config.cjs` exists
  - `mingla-business/src/components/brand/__tests__/` exists (2 test files)
  - `mingla-business/src/services/__tests__/`, `mingla-business/src/hooks/__tests__/` exist with multiple test files
  - `mingla-business/package.json` has 30+ `test:orch-XXXX` scripts using `npx jest <pattern>`
- **Implication:** Tr1 can ship the Step 0.5 regression-test gate without infrastructure work. Implementor writes `__tests__/BrandSwitcherSheet.personaFork.test.tsx`, `TripBrandWizard.test.tsx`, `brandsService.tripPlannerKind.test.ts`; tester writes adversarial counterpart. Both run via `npx jest` and satisfy the META-ORCH-0840 append-only CI requirement.
- **No blocker.** ✅

---

## 4. Open Polish Items §9 — current-state evidence

| Item | Current state evidence | SPEC guidance |
|---|---|---|
| **Persona picker always-visible vs no-match-only** (brief §9-1) | No pool-matching exists in BrandSwitcherSheet today. Create mode opens directly into the input. Tr1 brief default plan "only on no-match" assumes a matcher that doesn't exist. | RECOMMEND: persona picker is ALWAYS shown when create mode opens. Simpler, matches UniversalCreatorSheet's always-shown 3-card pattern. Ve1 may later add pool-matching that pre-skips to "A place" branch. |
| **Stripe Connect failure / stall recovery** (brief §9-2) | `BrandOnboardView:343-431` has mature handling: `cancelled`/`failed-stripe`/`failed-network`/`session-expired`/`already-active` states with copy + haptics + accessibility announcements. Reachable from `/brand/{id}/payments`. | RECOMMEND: TripBrandWizard delegates by routing to `/brand/{id}/payments` after brand insert. Do NOT replicate the 300-line state machine inline. |
| **Trip-planner visual differentiator in brand switcher** (brief §9-3) | Today's brand rows (`BrandSwitcherSheet.tsx:207-254`) render avatar with single-letter initial + display name. No per-`kind` chip or icon. | RECOMMEND: small chip/label "Trip planner" next to displayName when `brand.kind === 'trip_planner'`. Mirror pattern for "Venue" if Ve1 wants similar. Polish-level — SPEC can include or defer. |
| **Resume Stripe Connect CTA on Home** (brief §9-4) | Home has no "Finish Stripe setup" affordance today. For popup organizers this is fine (optional). For trip planners it's a blocker. | STRONGLY RECOMMEND: SPEC includes Home CTA logic: `kind='trip_planner' && stripeStatus !== 'active'` → "Finish Stripe setup" (route `/brand/{id}/payments`); else `kind='trip_planner' && stripeStatus === 'active'` → "Plan a trip" (route `/trip/coming-soon` for Tr1, replaced by Tr2 wizard). |

---

## 5. Risks + Unknowns (P0..P3)

**P0** — None. All infrastructure exists.

**P1** —
- **P1-1: Sideways Ve1 coordination on persona-fork interface.** If Ve1 starts before Tr1 SPEC locks `PersonaPickerCards` interface, the two milestones drift. **Mitigation:** SPEC must lock the `PersonaDef[]` interface explicitly; orchestrator should share the Tr1 SPEC with the Ve1 developer before Ve1 implementation begins. Per Tr1 brief §6, sideways coordination is expected.
- **P1-2: Stripe Connect country picker placement.** `BrandOnboardView` includes `BrandStripeCountryPicker` (defaults to "GB"). TripBrandWizard either includes its own country step BEFORE Connect launch OR routes through BrandOnboardView (which handles country). Recommend routing to BrandOnboardView; otherwise TripBrandWizard inherits the 34-country allowlist UI burden. **SPEC must pick one path explicitly.**

**P2** —
- **P2-1: Cover image required vs optional.** Tr1 brief §1 implies REQUIRED ("enters their brand name + bio + cover image"). DB `cover_media_url` is nullable. SPEC must lock submit-time validation. Recommendation: REQUIRED at submit for trip-planner kind (trip planners need a hero image for trip listings later in Tr2); skippable for popup persona (preserves today's flow).
- **P2-2: Bio field semantics.** Tr1 wizard captures "bio" — `brands` table has `bio` (text, nullable) per `brandMapping.ts`. No constraint changes needed. SPEC should set a sensible max-length (200 chars?) and placeholder copy.
- **P2-3: `kind='physical'` is admitted but unused (0 brands).** Live data has zero `kind='physical'` rows. This is Ve1's slot — Ve1 will start populating it. No Tr1 action.

**P3** —
- **P3-1: Hardcoded `displayName = "Lonely Moth"` default** (Finding A-2). Pre-existing P3 nit. Out of Tr1 scope. Register as DISCOVERY-1.
- **P3-2: AppsFlyer `mingla_brand_created` event** has no `kind` discriminator (`brandsService.ts:148`). Operator may want per-kind funnel split. Optional SPEC inclusion — 1-line change adding `{brand_id, kind}` to event params.
- **P3-3: `selectedCountry` default** in `BrandOnboardView:183` defaults to `DEFAULT_COUNTRY` (likely "GB"). Trip planners from US should land on `country='US'`. SPEC may want to default country based on device locale, but this is a cross-cutting concern affecting all brand kinds — register as DISCOVERY-2.

---

## 6. Files SPEC Will Need to Touch (refined from brief §4)

**Database (1 file):**
1. `supabase/migrations/<timestamp>_orch_0855_brands_kind_trip_planner.sql` (NEW) — DROP + re-ADD `brands_kind_check` with `('physical', 'popup', 'trip_planner')`. No data migration. No RLS change.

**Types + service (3 files, type-only widens):**
2. `mingla-business/src/types/brand.ts` — line 192 widen `kind` union to include `'trip_planner'`.
3. `mingla-business/src/services/brandMapping.ts` — lines 45 + 74 widen kind unions × 2.
4. `mingla-business/src/services/brandsService.ts` — line 86 widen `CreateBrandInput.kind` union.

**Components (3 files: 2 NEW + 1 refactor):**
5. `mingla-business/src/components/brand/PersonaPickerCards.tsx` (NEW) — accepts `PersonaDef[]`, renders 3-card picker.
6. `mingla-business/src/components/brand/TripBrandWizard.tsx` (NEW) — name + bio + cover picker + submit → createBrand + route to `/brand/{id}/payments`.
7. `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (REFACTOR) — add intermediate `"persona"` mode between `"switch"` and the current `"create"` (now becomes one persona's wizard).

**Home (1 file):**
8. `mingla-business/app/(tabs)/home.tsx` — add `kind`-aware CTA logic for `'trip_planner'` brands (with Stripe-status gating per I-2 recommendation).

**No changes needed:**
- `mingla-business/src/hooks/useBrands.ts` (already passes kind through; verify in tests)
- `supabase/functions/brand-stripe-onboard/index.ts` (kind-agnostic)
- `mingla-business/app/connect-onboarding.tsx` (web Embedded Components host; kind-agnostic)
- `mingla-business/app/stripe-onboarding-return.tsx` (kind-transparent HTTPS bounce)
- `mingla-business/src/components/brand/BrandOnboardView.tsx` (Connect entry state machine; Tr1 wizard delegates to it)
- All RLS policies on `brands`

**Tests (3 implementor + 1 tester):**
9. `mingla-business/src/components/brand/__tests__/BrandSwitcherSheet.personaFork.test.tsx` (NEW happy-path regression — Step 0.5 gate)
10. `mingla-business/src/components/brand/__tests__/TripBrandWizard.test.tsx` (NEW)
11. `mingla-business/src/services/__tests__/brandsService.tripPlannerKind.test.ts` (NEW)
12. `mingla-business/scripts/ci/orch-0855-adversarial-check.mjs` (NEW tester adversarial — Step 0.5 gate; structural-grep against persona-fork interface + migration constants)

**Optional strict-grep gate (Tr1↔Ve1 interface lock):**
13. `.github/scripts/strict-grep/i-tr1-persona-picker-interface.mjs` (NEW, optional) — enforces `PersonaPickerCards` accepts `personas: PersonaDef[]` prop so Ve1 cannot fork the interface.

---

## 7. Recommended SPEC Sequencing (each step independently revertible)

| # | Step | Files | Revert path |
|---|---|---|---|
| 1 | **Migration** alone | (1) | DROP + re-ADD original CHECK (`('physical','popup')`). Zero data loss because no rows have `kind='trip_planner'` yet. |
| 2 | **Type union widening** | (2), (3), (4) | Pure type changes. No runtime behavior. Revert by narrowing unions. |
| 3 | **PersonaPickerCards.tsx + BrandSwitcherSheet refactor** | (5), (7) | Existing flow stays usable via "An event" card → today's minimal form. Revert removes intermediate persona mode; original switch/create restored. |
| 4 | **TripBrandWizard.tsx + wire on "A trip" tap** | (6), partial (7) | If reverted, "A trip" card just shows "Coming soon" placeholder. |
| 5 | **Stripe Connect launch** (TripBrandWizard submit → router.push `/brand/{id}/payments`) | partial (6) | Revert: TripBrandWizard creates brand row + closes sheet (no auto-Connect). Operator manually goes to /payments. |
| 6 | **Home `kind`-aware CTA** | (8) | Revert removes the kind branch; Home behaves as today (no CTA for trip planners). |
| 7 | **Tests** | (9), (10), (11), (12), (13 optional) | Append-only post-CLOSE per META-ORCH-0840. |

Step 1 MUST land first (DDL prerequisite). Steps 2-6 are then orderable as the implementor sees fit; recommend the order above for minimal mid-stream breakage. Step 7 lands with the corresponding implementation step.

---

## 8. Five-Layer Cross-Check

| Layer | What says | Contradiction? |
|---|---|---|
| **Docs** | Tr1 brief + project spec §3.1 + §8 + DEC-4: `kind='trip_planner'` is the target value; Stripe Connect is identity proof. | — |
| **Schema** | Live DB `brands_kind_check = ('physical','popup')`. 7 RLS policies, none `kind`-aware. | ⚠️ Schema does NOT yet admit `'trip_planner'` — Tr1 migration fixes. |
| **Code** | `CreateBrandInput.kind: "physical" | "popup"` across types/brand.ts + brandMapping.ts + brandsService.ts. BrandSwitcherSheet hardcodes `kind: "popup"`. Home is kind-blind. | ⚠️ Code does NOT yet produce or consume `'trip_planner'` — Tr1 product code fixes. |
| **Runtime** | Today: brand creation always produces `kind='popup'`. Today: Stripe Connect onboarding works for all popup brands when triggered from `/brand/{id}/payments`. | No contradiction with docs (popup is M0-era default); Tr1 adds the new kind. |
| **Data** | Live: 12 brands, 12 popup, 0 physical, 0 trip_planner. | Consistent with code path producing only popup. |

**Conclusion:** All five layers are internally consistent for today's state. Tr1 advances all five in lockstep (schema → code → runtime → data) to admit the new kind.

---

## 9. Blast Radius

**Direct touch (Tr1 scope):** BrandSwitcherSheet, PersonaPickerCards, TripBrandWizard, brandsService, brandMapping, types/brand.ts, useBrands (verify-only), home.tsx, migration.

**Indirect — verify no downstream consumer breaks:**
- Every component that reads `Brand.kind` as a narrow union. Grep `mingla-business/src/ -E "brand\.kind|kind === \"(physical|popup)\"|kind: \"(physical|popup)\""`:
  - `BrandEditView.tsx` — has kind editor radio buttons. SPEC question: does the kind editor admit trip_planner switching, or is kind immutable post-create? Recommendation: kind IMMUTABLE post-create (avoid weird Stripe-status inheritance mid-stream). Hide trip_planner from BrandEditView toggle.
  - `BrandProfileView.tsx` / `PublicBrandPage.tsx` — render brand kind-conditional layout (physical shows address; popup doesn't). Trip-planner needs a third branch — SPEC adds it OR mirrors popup (no address shown).
  - `brandMapping.ts` mappers — already pass `row.kind` through verbatim. No filter.
- Existing test files importing `Brand` interface — all type-only consumers; once union widens, tests still compile.

**Cross-domain:**
- `mingla-admin/` does NOT touch `brands.kind` for trip-planner specifically (no admin queue for trip planners per DEC-4). ✅ No admin work in Tr1.
- `app-mobile/` (consumer) — does NOT yet surface trip-planner brands publicly (that's C1). ✅ No consumer work in Tr1.
- `supabase/functions/` — only `brand-stripe-onboard` touches `brands` and it's kind-agnostic. ✅
- RLS — fully transparent (Section C). ✅

**Invariant exposure:**
- I-1.2-BRAND-AS-CONTAINER (PROJECT_SPEC §54): `brands.kind` is starting identity, NOT capability gate. Tr1 must NOT add code that gates *event creation capability* on `kind`. ✅ Tr1's Home CTA shows "Plan a trip" preference per kind but does NOT prevent a trip-planner brand from creating events. Universal "+" creator remains universal.
- I-1.2-UNIFIED-EVENT-TYPE: not touched (Tr1 is brand-layer, not events-layer).
- No new invariants required for Tr1 itself, BUT the persona-picker interface should be locked via a SPEC-level invariant (I-PROPOSED-TR1-PERSONA-INTERFACE — draft → active at CLOSE).

---

## 10. Discoveries for Orchestrator

- **DISCOVERY-1:** `BrandSwitcherSheet.tsx:92` hardcodes `displayName = "Lonely Moth"` as create-form default. Pre-existing P3 nit visible to every real user. Out of Tr1 scope per scope discipline; orchestrator may bundle the fix if operator wants. Register as standalone follow-up ORCH if not bundled.
- **DISCOVERY-2:** `BrandOnboardView.tsx:183` `selectedCountry` defaults to `DEFAULT_COUNTRY` (likely "GB"). Cross-brand-kind concern (popup organizers in US also affected). Consider an ORCH to default country from device locale.
- **DISCOVERY-3:** No `AppsFlyer mingla_brand_created` `kind` discriminator (`brandsService.ts:148`). Operator may want per-kind funnel split. 1-line change. Could fold into Tr1 SPEC as a SC if operator wants per-kind analytics from day 1.
- **DISCOVERY-4:** `BrandEditView` likely needs a SPEC decision about whether `kind` is editable post-create. Recommend IMMUTABLE for kind-discrimination cleanliness. If SPEC agrees, edit Tr1 SPEC to hide the kind toggle (or restrict it to physical↔popup, never to/from trip_planner).
- **DISCOVERY-5:** Cross-track coordination — Ve1 (Track 2, different developer) needs Tr1's `PersonaPickerCards` interface before starting. Orchestrator should share Tr1 SPEC (once approved) with Ve1 developer to prevent fork.

---

## 11. Confidence Level

**High (`proven`).** Source-only code audit + live-DB probes (RLS + constraint + row counts via MCP) all corroborate. No UI bug reproducer exists in the dispatch (this is greenfield milestone work, not bug investigation) so Prime Directive 7 sim-repro is exempt per dispatch §"Hard guards". The single uncertainty (P1-2 country picker placement) is a SPEC design choice, not an investigation gap.

---

## 12. Cross-references

- Milestone brief: `Mingla_Artifacts/milestones/Tr1_TRIP_PLANNER_ONBOARDING.md`
- M0 (upstream): `Mingla_Artifacts/reports/QA_ORCH-0826_M0_HUB_FOUNDATION.md`, `Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md`
- Project spec: `Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md` (§54 I-1.2-BRAND-AS-CONTAINER)
- Working doc §6.2: `Mingla_Artifacts/MINGLA_BUSINESS_1_2_WORKING_DOC.md`
- Decision log: `Mingla_Artifacts/DECISION_LOG.md` DEC-4 (Stripe Connect as identity), DEC-152 (TopSheet extension), DEC-121/122 (B2a V3 Connect multi-country)
- Invariants: `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-1.2-UNIFIED-EVENT-TYPE (ACTIVE), I-1.2-BRAND-AS-CONTAINER (PROJECT_SPEC §54)
- Memory: `feedback_topsheet_extended_universal_creator.md` (ACTIVE post-ORCH-0826), `feedback_orchestrator_deploys_edge_functions.md` (informs Tr1 close protocol — no edge fn changes in Tr1 so deploy step is N/A)
