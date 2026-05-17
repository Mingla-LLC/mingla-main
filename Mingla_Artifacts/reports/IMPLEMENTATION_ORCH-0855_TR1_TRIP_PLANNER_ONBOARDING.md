# IMPLEMENTATION REPORT — ORCH-0855 [Tr1 Trip Planner Brand Onboarding]

**Status:** completed · **Verification:** passed (3 jest suites, 22/22 tests, all fails-on-revert verified at `ff46c3f5`)
**Skill:** Claude `mingla-implementor`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md`
**Pre-implementation HEAD:** `ff46c3f53fe1de59ca87cae8f46d0641545bf732` (fails-on-revert baseline)

---

## 1. Layman summary

The business app now has a 3-card persona fork ("A place" / "An event" / "A trip") when an operator taps "Create a new brand." Tapping "A trip" opens a trip-planner wizard (name + bio + cover image) that creates a `kind='trip_planner'` brand and routes straight into Stripe Connect onboarding. After Stripe is set up, Home shows a "Plan a trip" CTA; before Stripe is done, it shows "Finish Stripe setup." The "An event" card preserves today's minimal popup-brand flow byte-equivalent — zero regression for existing users. "A place" renders as "Coming soon" (Ve1's slot). `brand.kind` is locked as immutable post-create for trip planners; the BrandEditView kind editor is hidden for them.

---

## 2. Spec traceability — all 25 success criteria covered

| SC | Coverage | Evidence |
|---|---|---|
| SC-01 | "Create a new brand" footer routes to `"persona"` mode | `BrandSwitcherSheet.tsx` button `onPress={handleSwitchToPersona}` + handler sets `setMode("persona")` |
| SC-02 | Persona picker shows 3 cards in order [place, event, trip] | `BrandSwitcherSheet.tsx` `personas: PersonaDef[]` array literal |
| SC-03 | "A trip" card icon=`compass`, description matches brief | `personas[2]` (`id:"trip"`, `icon:"compass"`, description literal) |
| SC-04 | "A place" card disabled (Ve1 stub) | `personas[0]` `disabled: true`; `PersonaPickerCards` renders with opacity 0.5 + Pressable `disabled` prop |
| SC-05 | Tap "A trip" opens TripBrandWizard | `personas[2].onSelect: () => setMode("trip-create")` + render branch `mode === "trip-create"` mounts `<TripBrandWizard>` |
| SC-06 | "An event" preserves today's byte-equivalent flow | popup-create render branch preserved verbatim; `handleSubmit` still passes `kind: "popup"`, `coverHue: 25` |
| SC-07 | Wizard captures name (required), bio (≤200, optional), cover | `TripBrandWizard.tsx` form fields + `canSubmit = trimmedName.length > 0` + `BIO_MAX_LENGTH = 200` |
| SC-08 | Cover via `uploadBrandCover` / `brand_covers` bucket | `<BrandCoverPickerSheet>` embedded, which calls `uploadBrandCover` from `brandCoverService.ts` |
| SC-09 | Brand row written with `kind='trip_planner'` | `createBrandMutation.mutateAsync({...kind: "trip_planner"...})` + jest test asserts payload.kind === "trip_planner" |
| SC-10 | DB constraint admits `'trip_planner'` | Live-verified via MCP `execute_sql` after operator's `supabase db push` ran (returned `CHECK ((kind = ANY (ARRAY['physical'::text, 'popup'::text, 'trip_planner'::text])))`) |
| SC-11 | Final navigation = `router.push('/brand/{id}/payments')` | `routeToPayments()` body + jest test asserts route literal |
| SC-12 | Slug collision → inline error, form re-enabled | `handleSubmit` catch block: `error instanceof SlugCollisionError` → `setStatus("error-slug-collision")` + `setErrorMessage(...)` |
| SC-13 | Cover upload failure after insert → banner + routes anyway | `handleCoverPicked` catch block: `routeToPayments(createdBrand)` continues; jest test asserts |
| SC-14 | Home "Finish Stripe setup" CTA when `stripeStatus !== 'active'` | `home.tsx` conditional branch on `currentBrand.stripeStatus === "active"` else "Finish Stripe setup" |
| SC-15 | Home "Plan a trip" CTA when `stripeStatus === 'active'` | Same conditional branch, true side |
| SC-16 | Home CTA renders NOTHING for non-trip-planner brands | Outer conditional `currentBrand.kind === "trip_planner" ? ... : null` |
| SC-17 | BrandEditView hides kind editor for `kind='trip_planner'` | `{draft.kind !== "trip_planner" ? (<>...kind editor...</>) : null}` wraps "BRAND KIND" section |
| SC-18 | Kind toggle never offers `'trip_planner'` as an option | Toggle options array (`physical` / `popup` Pressables) unchanged — visually inspected; structural-grep adversarial check will enforce |
| SC-19 | "A place" stub does NOT open venue claim flow | `personas[0].onSelect` is empty closure; `disabled: true` blocks Pressable onPress |
| SC-20 | Trip-planner brand appears in switch list with standard avatar+initial | Switch-mode render block unchanged — renders all brands via standard `brandRow` regardless of kind |
| SC-21 | softDeleteBrand still works | `softDeleteBrand` untouched in this implementation; kind not a soft-delete predicate |
| SC-22 | Universal "+" creator unchanged for trip-planner brands | `UniversalCreatorSheet` not touched; Home TopBar button render path unchanged |
| SC-23 | Stripe Connect end-to-end via existing BrandOnboardView | Wizard routes to `/brand/{id}/payments` → existing flow untouched; deferred verification (operator live-test) |
| SC-24 | Stripe abandonment leaves brand pending; CTA correctly shows "Finish Stripe setup" | SC-14 + standard BrandOnboardView abandonment behavior unchanged |
| SC-25 | `PersonaDef.id` union locked to `'place' | 'event' | 'trip'` | TypeScript declaration at `PersonaPickerCards.tsx:30` |

---

## 3. Old → New receipts

### 3.1 `supabase/migrations/20260607000000_orch_0855_brands_kind_trip_planner.sql` (NEW, applied)

- **What it did before:** N/A (new file). Live DB `brands_kind_check` was `CHECK ((kind = ANY (ARRAY['physical'::text, 'popup'::text])))`.
- **What it does now:** Transactional DDL — drops + re-adds `brands_kind_check` to admit `('physical', 'popup', 'trip_planner')`. Updates `COMMENT ON COLUMN`. Self-verify `DO $$ ... RAISE EXCEPTION $$` block fires `RAISE EXCEPTION` if the constraint didn't end up correctly in place, else logs `NOTICE: ORCH-0855 migration complete: brands_kind_check widened to (physical, popup, trip_planner)`.
- **Why:** SPEC §4.1 — root cause C-1 (live constraint blocks `'trip_planner'` insert).
- **Lines:** ~50.
- **Applied:** operator ran `supabase db push --linked` 2026-05-17. Live verification (MCP `execute_sql`): `pg_get_constraintdef(oid) = CHECK ((kind = ANY (ARRAY['physical'::text, 'popup'::text, 'trip_planner'::text])))`.

### 3.2 `mingla-business/src/types/brand.ts` (EDIT, line 192)

- **What it did before:** `kind: "physical" | "popup";` with JSDoc citing 2 values.
- **What it does now:** `kind: "physical" | "popup" | "trip_planner";` with expanded JSDoc citing the 3 values + immutability invariant (I-PROPOSED-TR1-KIND-IMMUTABLE) + I-1.2-BRAND-AS-CONTAINER reminder.
- **Why:** SPEC §4.3 root cause D-4 + DISCOVERY-4 immutability documentation.
- **Lines:** ~16.

### 3.3 `mingla-business/src/services/brandMapping.ts` (EDIT, 2 lines)

- **What it did before:** Both `BrandRow.kind: "physical" | "popup"` (line 45) and `BrandUiInput.kind?: "physical" | "popup"` (line 74) were narrow.
- **What it does now:** Both widened to `"physical" | "popup" | "trip_planner"` with comment citing ORCH-0855 migration.
- **Why:** SPEC §4.3 root causes D-3 + D-4.
- **Lines:** ~4 (2 edits × 2 lines including comment).

### 3.4 `mingla-business/src/services/brandsService.ts` (EDIT, line 86)

- **What it did before:** `CreateBrandInput.kind: "physical" | "popup";`.
- **What it does now:** `kind: "physical" | "popup" | "trip_planner";` with comment citing migration + hook-passthrough invariant.
- **Why:** SPEC §4.3 root cause D-1.
- **Lines:** ~5.

### 3.5 `mingla-business/src/components/ui/Icon.tsx` (EDIT, 2 hunks)

- **What it did before:** `IconName` union had 71 icons; no `compass`.
- **What it does now:** Adds `"compass"` to the `IconName` union + a `compass: () => (<Circle/><Path/>)` renderer in the `RENDERERS` map.
- **Why:** SPEC §4.5.1 — persona-card icon for "A trip" was SPEC-LOCKED at `compass`. The icon didn't exist; adding it preserves SPEC fidelity. (Place persona reuses existing `location` icon — semantically identical to the SPEC's `mapPin`; see Deviation D-1 below.)
- **Lines:** ~8.

### 3.6 `mingla-business/src/components/brand/PersonaPickerCards.tsx` (NEW)

- **What it did before:** N/A.
- **What it does now:** Presentation-only 3-card picker. Exports `PersonaDef` (with locked `id: 'place' | 'event' | 'trip'` union) and `PersonaPickerCards` props interface + component. Each card: 44×44 icon touch target (I-38), explicit `accessibilityLabel` (I-39), `accessibilityState.disabled`, "Coming soon" inline label when `disabled`, opacity 0.5 + Pressable `disabled` when disabled.
- **Why:** SPEC §4.5.1; root cause H-1 (no persona-fork scaffolding existed).
- **Lines:** 156.

### 3.7 `mingla-business/src/components/brand/TripBrandWizard.tsx` (NEW)

- **What it did before:** N/A.
- **What it does now:** Trip-planner brand-creation wizard. Form fields: name (required, Input variant=text + clearable), bio (optional, multiline TextInput, maxLength=200, char counter), embedded `BrandCoverPickerSheet` auto-opens after brand insert. Submit sequence (SPEC §4.5.2):
  1. `createBrandMutation.mutateAsync({kind: "trip_planner", ...})`
  2. Open cover picker with new `brand.id`
  3. On picked → `updateBrandMutation` patch cover URL + media type
  4. `updateCreatorAccount({default_brand_id})` fire-and-forget
  5. `setCurrentBrand` zustand
  6. `onBrandCreated` parent callback
  7. `onClose` parent sheet
  8. `router.push(`/brand/${id}/payments`)` (delegates Stripe Connect to existing BrandOnboardView)
- **Error states:**
  - SlugCollisionError → `error-slug-collision` state, inline message "This brand name is taken. Try a small variation (e.g. \"<name> Trips\")."
  - Other errors during create → `error-network` state with banner.
  - Cover patch failure post-insert → banner "Brand created, but cover couldn't save..." + continue to Stripe per SC-13.
  - Cover picker dismissed without pick → continue to Stripe with no cover (brand persists).
- **Keyboard avoidance:** `KeyboardAvoidingView` wraps entire wizard (feedback_keyboard_never_blocks_input).
- **No new Sheet/Modal at root layer** — uses parent BrandSwitcherSheet's TopSheet (sub-sheet-inside-parent rule).
- **Lines:** 335.

### 3.8 `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (REFACTOR)

- **What it did before:** `type Mode = "switch" | "create"`. Footer "Create a new brand" → mode="create" → minimal Input form → `createBrand({...kind:"popup", coverHue:25...})`.
- **What it does now:** `type Mode = "switch" | "persona" | "popup-create" | "trip-create"`. Footer "Create a new brand" → mode="persona" → `<PersonaPickerCards personas={[place, event, trip]}/>` → tap card → mode="popup-create" (preserves byte-equivalent submit) OR mode="trip-create" (mounts `<TripBrandWizard>`). Back chevron in either create-mode → mode="persona". Personas array declares `place` (disabled stub, icon=`location`), `event` (icon=`calendar`, routes to popup-create), `trip` (icon=`compass`, routes to trip-create). Imports `PersonaPickerCards`, `PersonaDef`, `TripBrandWizard`.
- **Why:** SPEC §4.5.3 — adds persona fork while preserving today's popup-create flow byte-equivalent.
- **Lines changed:** ~80 additions (imports + handlers + personas array + persona/trip-create render branches); ~5 deletions (handleSwitchToCreate renamed → handleSwitchToPersona); popup-create render branch identical to pre-Tr1 create branch except wrapped in `mode === "popup-create"` check.

### 3.9 `mingla-business/app/(tabs)/home.tsx` (EDIT, 1 hunk + styles)

- **What it did before:** No kind-aware CTA. Populated brand state rendered live-event hero + 7-day stats + KPI grid.
- **What it does now:** Adds an ADDITIVE CTA card ABOVE the live-event hero, gated on `currentBrand.kind === "trip_planner"`. Branches further on `stripeStatus`: "Plan a trip" CTA routes `/trip/coming-soon` when active; "Finish Stripe setup" routes `/brand/{id}/payments` otherwise. For popup/physical brands, the block returns null (no regression). New styles: `tripPlannerCtaWrap`, `tripPlannerCtaTitle`, `tripPlannerCtaBody`, `tripPlannerCtaAction`, `tripPlannerCtaActionText`.
- **Why:** SPEC §4.5.4 + investigation Finding I-2 (trip planners need Stripe; CTA reflects readiness).
- **Lines:** ~80.

### 3.10 `mingla-business/src/components/brand/BrandEditView.tsx` (EDIT)

- **What it did before:** "BRAND KIND" section always rendered with `physical` ↔ `popup` toggle.
- **What it does now:** Entire section wrapped in `{draft.kind !== "trip_planner" ? (<>...</>) : null}`. Toggle options array unchanged (still only `physical` and `popup` — does NOT include `trip_planner`).
- **Why:** SPEC §4.5.5 + DISCOVERY-4 + I-PROPOSED-TR1-KIND-IMMUTABLE invariant.
- **Lines:** ~6 (2 hunk wrappers).

### 3.11 Tests (3 NEW jest files)

- `mingla-business/src/services/__tests__/brandsService.tripPlannerKind.test.ts` — 3 tests (happy path + popup regression + SlugCollisionError contract).
- `mingla-business/src/components/brand/__tests__/BrandSwitcherSheet.personaFork.test.ts` — 9 structural tests (Mode union, persona ids ordered, trip icon=compass, place disabled=true, trip onSelect routes, event onSelect routes, footer button handler, popup kind preserved + trip_planner not in sheet, imports present).
- `mingla-business/src/components/brand/__tests__/TripBrandWizard.test.ts` — 10 structural tests (createBrand call + kind literal, route to /brand/{id}/payments, SlugCollisionError handled, cover failure routes anyway, BIO_MAX_LENGTH=200 + maxLength prop, sub-sheet-inside-parent rule, accessibilityLabels, KeyboardAvoidingView, DEFAULT_COVER_HUE=25).
- **Total:** 22 tests, all PASS, 7.78s.

---

## 4. Regression Test (Step 0.5 gate — append-only CI compliant)

### Implementor-written happy-path tests (3 files)

| Test path | Pass output | Fails-on-revert verified at |
|---|---|---|
| `mingla-business/src/services/__tests__/brandsService.tripPlannerKind.test.ts` | `PASS · 3 tests passed · 6.866 s` | `ff46c3f5` — temporarily narrowed `brandsService.ts:86` `CreateBrandInput.kind` to `"physical" \| "popup"`; ts-jest blocked with `TS2322: Type '"trip_planner"' is not assignable to type '"physical" \| "popup"'`. Test suite failed to load. Restored. |
| `mingla-business/src/components/brand/__tests__/BrandSwitcherSheet.personaFork.test.ts` | `PASS · 9 tests passed · 7.27 s` | `ff46c3f5` — temporarily reverted `BrandSwitcherSheet.tsx` `type Mode = "switch" \| "create"`; 1 of 9 tests FAILed (Mode-union regex assertion). Restored. |
| `mingla-business/src/components/brand/__tests__/TripBrandWizard.test.ts` | `PASS · 10 tests passed · 7.27 s` | `ff46c3f5` — temporarily changed `TripBrandWizard.tsx` `kind: "trip_planner"` → `"popup"`; 1 of 10 tests FAILed (createBrand kind literal regex). Restored. |

**Final re-run after all probes restored:** 22/22 tests PASS, 7.78s.

**Type-check:** `npx tsc --noEmit` introduces ZERO new errors against any Tr1-touched file. Pre-existing 81 errors are all unrelated (buyer.tsx implicit-any, `packages/event-rendering` missing react types, missing `@mingla/payments-native` module, pre-existing test `DraftEvent.category` field drift).

**Tester adversarial check** (per Step 0.5 second-test requirement) is the next phase's job, at `mingla-business/scripts/ci/orch-0855-adversarial-check.mjs` (per SPEC §6 file 13). Implementor did NOT write this — different-angle adversarial coverage is tester-owned per ORCH-0840 protocol.

---

## 5. Invariant verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| I-1.2-BRAND-AS-CONTAINER | Y | Home CTA is informational ("Plan a trip" suggestion), does NOT prevent trip-planner brand from creating events. Universal "+" creator (M0) untouched. |
| I-1.2-UNIFIED-EVENT-TYPE | Y | Tr1 is brand-layer only; no `events` schema or render code touched. |
| Constitution #2 (one owner per truth) | Y | `brands.kind` remains single source. Wizard reads/writes via existing `useCreateBrand`. |
| Constitution #3 (no silent failures) | Y | All TripBrandWizard error states surface inline or banner. SlugCollisionError → inline; network → banner; cover patch failure → banner + route continues with brand persisted. |
| Constitution #8 (subtract before adding) | Y | popup-create render block preserved verbatim — no rewrite of working code. New code is additive (3 new modes + 2 new components + 1 home CTA branch + 1 kind-lockdown wrapper). |
| Constitution #9 (no fabricated data) | Y | "Finish Stripe setup" honestly reflects pending state; never claims active when not. |
| Constitution #14 (persisted-state startup) | Y | Tr1 doesn't touch hydration; operates after auth + brandList hydrate (same as today's BrandSwitcherSheet). |
| I-38 (WCAG AA touch ≥44pt) | Y | PersonaPickerCards icon wrap is 44×44; full card row is the Pressable hit-area. |
| I-39 (explicit accessibilityLabel on interactive Pressable) | Y | All new Pressables in PersonaPickerCards + TripBrandWizard + Home CTA + BrandSwitcherSheet additions carry accessibilityLabel. |
| `feedback_topsheet_extended_universal_creator` | Y | NO new TopSheet consumer added. New modes embed INSIDE existing BrandSwitcherSheet TopSheet. |
| `feedback_rn_color_formats` | Y | All inline colors use hex (`#EF4444`, `#FAFAFA`, etc.) or accent tokens; no oklch/lab/lch. |
| `feedback_keyboard_never_blocks_input` | Y | TripBrandWizard wraps in `KeyboardAvoidingView` (iOS padding behavior). |
| `feedback_rn_sub_sheet_must_render_inside_parent` | Y | BrandCoverPickerSheet mounts INSIDE TripBrandWizard's render tree (inside parent BrandSwitcherSheet TopSheet). No sibling Modal mount. |

### New invariants (DRAFT — flip ACTIVE on CLOSE)

| ID | Status | Mechanism |
|---|---|---|
| I-PROPOSED-TR1-PERSONA-INTERFACE | DRAFT | `PersonaDef.id` literal union locked. TypeScript enforces at compile time. |
| I-PROPOSED-TR1-KIND-IMMUTABLE | DRAFT | `BrandEditView` wrapper hides kind editor for `kind='trip_planner'`. Toggle options array remains `physical`+`popup` only. |

---

## 6. Cross-Surface Impact (Step 3.5)

| Surface | In/Out | Status |
|---|---|---|
| Business iOS | ✅ IN | All changes apply via shared RN code |
| Business Android | ✅ IN | Same — automatic parity |
| Database | ✅ IN | Migration applied 2026-05-17, live constraint admits `'trip_planner'` |
| Consumer iOS / Android | ❌ OUT | No `app-mobile/` files touched |
| Buyer/anonymous Web | ❌ OUT | `/checkout/`, `/e/`, `/b/` paths untouched. Trip-planner public `/b/{slug}` page will render via existing kind-agnostic RLS policy + popup-style rendering (no address). Polish deferred. |
| Admin Web | ❌ OUT | No `mingla-admin/` files touched. Admin's brand list will surface `kind='trip_planner'` as raw column literal — acceptable cosmetic for Tr1. |
| Business Web preview | ❌ OUT | BrandSwitcherSheet uses RN Modal (TopSheet primitive) — doesn't render on web. Web preview is buyer-anon only. |

**Parity is AUTOMATIC** across business iOS + Android (shared RN code path). No platform-specific files. Tester parity-enforcement check (Step 7) needs both iOS sim + Android emu live-fire.

---

## 7. Cache safety

- No query-key changes. `brandKeys.list(accountId)` + `brandKeys.detail(brandId)` unchanged.
- `useCreateBrand` optimistic temp-brand construction (line 231: `kind: input.kind`) now correctly admits `trip_planner` once upstream union widened — no hook code change.
- `useUpdateBrand` invalidation unchanged.
- No persisted Zustand store mutations (TripBrandWizard sets `currentBrand` via existing `setCurrentBrand` — no new persisted field).

---

## 8. Parity check

- This is a business-app feature with no consumer-app analog (trip planners are sellers, not consumers).
- iOS + Android: AUTOMATIC parity via shared RN code.
- Solo + collab: N/A — brand creation has no collab mode.
- Admin: not in scope per DEC-4.

---

## 9. Regression surface (tester should verify these don't break)

1. **Today's popup brand creation** — operator opens BrandSwitcherSheet, taps "Create a new brand," taps "An event" → enters name → submits. Must create `kind='popup'` brand identical to pre-Tr1 behavior. Covered by SC-06 + jest `brandsService.tripPlannerKind.test.ts` "popup regression" test + jest `BrandSwitcherSheet.personaFork.test.ts` "popup kind preserved" assertion.
2. **Stripe Connect existing flow** — for popup brands going through `/brand/{id}/payments` after Tr1, BrandOnboardView must behave identical to today (no `kind` filtering anywhere in that flow).
3. **`stripe-onboarding-return.tsx`** — bounce route must work for trip-planner brands the same as popup brands (already verified at investigation Finding B-2 — kind-transparent).
4. **BrandEditView for popup/physical brands** — kind toggle still renders, options unchanged. Address input still renders when `physical`. Covered by SC-18.
5. **Home tab for popup brand** — no trip-planner CTA renders, hero + KPIs unchanged. Covered by SC-16.
6. **Universal "+" creator from Home / Hub / Marketing / Account** — opens for trip-planner brand the same as popup brand. Covered by SC-22 + I-1.2-BRAND-AS-CONTAINER invariant.

---

## 10. Discoveries for orchestrator (side issues NOT fixed)

- **DISCOVERY-1 [pre-existing P3]:** `BrandSwitcherSheet.tsx:92` still hardcodes `const [displayName, setDisplayName] = useState<string>("Lonely Moth")`. Implementor explicitly did NOT touch this line per scope discipline + SPEC §11 deferral. Operator may bundle the fix in a follow-up ORCH (1-line replace with empty string).
- **DISCOVERY-2 [pre-existing]:** `BrandOnboardView.tsx:183` `selectedCountry = DEFAULT_COUNTRY` ("GB"). Cross-cutting concern across all brand kinds. Out of Tr1 scope.
- **DISCOVERY-3 [pre-existing]:** `AppsFlyer mingla_brand_created` event at `brandsService.ts:148` has no `kind` discriminator. Operator may want per-kind funnel analytics. 1-line change for a future ORCH.
- **DISCOVERY-6 [NEW, surfaced during implementation]:** Mingla-business `tsc --noEmit` has 81 pre-existing errors unrelated to Tr1 (buyer.tsx implicit-any, `@mingla/payments-native` missing module declaration, `packages/event-rendering/*` missing React types, `DraftEvent.category` field drift in 6 existing test files). These pre-date this implementation and were not introduced by Tr1. Worth registering as a "tsc-clean" cleanup ORCH.

---

## 11. Deno gates / Edge function deploys

- **Edge function deploys:** N/A. Tr1 touches zero edge functions per SPEC §4.2 (`brand-stripe-onboard` is kind-agnostic, reused as-is).
- **Deno gates:** N/A (no Deno code changed).

---

## 12. Files manifest

**Product code (9 files, all on `Seth`):**

```
A  supabase/migrations/20260607000000_orch_0855_brands_kind_trip_planner.sql      (NEW)
M  mingla-business/src/components/brand/BrandEditView.tsx                          (kind editor lockdown)
M  mingla-business/src/components/brand/BrandSwitcherSheet.tsx                     (4-mode refactor)
A  mingla-business/src/components/brand/PersonaPickerCards.tsx                     (NEW)
A  mingla-business/src/components/brand/TripBrandWizard.tsx                        (NEW)
M  mingla-business/src/components/ui/Icon.tsx                                      (+ compass icon)
M  mingla-business/src/services/brandMapping.ts                                    (×2 union widening)
M  mingla-business/src/services/brandsService.ts                                   (union widening)
M  mingla-business/src/types/brand.ts                                              (union widening)
M  mingla-business/app/(tabs)/home.tsx                                             (kind-aware CTA)
```

**Tests (3 files, all on `Seth`):**

```
A  mingla-business/src/components/brand/__tests__/BrandSwitcherSheet.personaFork.test.ts
A  mingla-business/src/components/brand/__tests__/TripBrandWizard.test.ts
A  mingla-business/src/services/__tests__/brandsService.tripPlannerKind.test.ts
```

**Total:** 9 product files + 3 test files + 1 migration = 13 files changed.

---

## 13. SPEC deviations (transparent)

| ID | SPEC said | Implementor shipped | Rationale |
|---|---|---|---|
| **D-1** | Place persona `icon: "mapPin"` (SPEC §4.5.1 example) | `icon: "location"` | The existing `location` icon in `Icon.tsx` IS a map pin (teardrop + circle); semantically identical to SPEC's "mapPin" intent. Reusing avoids icon duplication. Adversarial check should be flexible on the exact identifier or this can be renamed in a polish pass. |
| **D-2** | PersonaPickerCards GlassCard variant `'flat'` when disabled (SPEC §4.5.1) | `variant="base"` when disabled | GlassCard's variant union is `"base" | "elevated"` — `"flat"` does not exist. `"base"` is the non-elevated alternative and is the SPEC's intent (visually de-emphasized). |
| **D-3** | Bio field via "Input multiline" (SPEC §4.5.2 §"Layout") | Raw `TextInput` with matching visual styling | `Input` component has fixed `HEIGHT = 48`; doesn't support multiline. Raw `TextInput` with bordered/padded styling matches the visual treatment without forcing Input refactor. |

None of these deviations affect any success criterion or invariant — all are equivalent implementations of the SPEC intent.

---

## 14. Transition items

None. No `[TRANSITIONAL]` markers introduced.

---

## 15. CLOSE-protocol notes for orchestrator

- **DIAG reap:** zero `[ORCH-0855-DIAG]` markers in code (none introduced).
- **Migration:** applied 2026-05-17 by operator. Live-verified.
- **Edge function deploys:** N/A.
- **EAS OTA eligibility:** YES — pure JS/TS change, no native module additions. Per `feedback_eas_update_no_web`: two separate commands required, `--platform ios` then `--platform android`.
- **New memory files (orchestrator writes at CLOSE):**
  - `feedback_persona_picker_locked_interface.md` (DRAFT → ACTIVE) — codifies I-PROPOSED-TR1-PERSONA-INTERFACE
  - `feedback_brand_kind_immutable_post_create.md` (DRAFT → ACTIVE) — codifies I-PROPOSED-TR1-KIND-IMMUTABLE
- **New DEC entries:**
  - Tr1 persona-fork interface locked to 3 ids per I-PROPOSED-TR1-PERSONA-INTERFACE
  - `brands.kind` immutable post-create for trip_planner per I-PROPOSED-TR1-KIND-IMMUTABLE
- **WORLD_MAP + COVERAGE_MAP + PRODUCT_SNAPSHOT updates:** standard CLOSE Step 1.
- **Working tree state:** dirty with prior in-flight ORCHs (0842, 0852, 0853, 0854). Per one-PR-per-CLOSE rule, ORCH-0855's PR must contain ONLY ORCH-0855 files. Orchestrator stages the 13 files above explicitly — does NOT use `git add -A`.
