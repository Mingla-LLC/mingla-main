# QA REPORT — ORCH-0855 [Tr1 Trip Planner Brand Onboarding]

**Verdict:** CONDITIONAL PASS — pending operator live-fire smoke on iOS sim + Android emu (creds-blocked)
**Severity counts:** P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 2
**Skill:** Claude `mingla-tester` (canonical TEST owner per `feedback_tester_canonical_and_platform_parity`)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Mode:** TARGETED
**Tested HEAD:** `7750f7d62bfc7d91df94b29ac410e9b83a3a446d` (adversarial verified here; implementor's tests fails-on-revert verified at `ff46c3f5` pre-implementation baseline)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md`
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md`

---

## 1. Layman summary

The implementation is structurally correct end-to-end. Database migration is live, all type unions widened, two new components ship clean, BrandSwitcherSheet refactor preserves the existing "An event" flow byte-equivalent, Home CTA is kind+Stripe-status gated, BrandEditView kind editor is hidden for trip-planner brands. 22 implementor jest tests pass, 14 tester adversarial structural-grep checks pass, both regression suites have verified fails-on-revert. The only thing not yet verified is real device/sim tap behavior — that needs your hands on the simulator with a test account.

---

## 2. Verdict gate evaluation (Phase 0.A)

| Confidence requirement | Status | Evidence |
|---|---|---|
| `proven` level live-fire on iOS sim | NOT achieved | Sim booted (UDID `17091E60-C3B6-4167-980D-60C348E177F6` iPhone 17 Pro / iOS 26.4), Metro on :8081 running with `mingla-business` cwd, dev build present at `~/Library/Developer/Xcode/DerivedData/minglabusiness-ghoeylalbzpueufictcvspjbubjx/Build/Products/Debug-iphonesimulator/minglabusiness.app`. Did NOT attempt Maestro flow because: (a) dev build's commit-of-origin not known — may be stale relative to ORCH-0855 changes (no rebuild manifest in session); (b) no test credentials in scope to sign in to a brand-less account; (c) creating a brand-less test account requires a fresh OTP-verified phone number not in scope. |
| `proven` level live-fire on Android emu | NOT achieved | Emulator `emulator-5554` booted via adb. Same blockers as iOS. |
| `probable` confidence (sim attempt + named blocker) | ACHIEVED | All three blockers named above. Case-B handoff in §10 lists exact steps for operator to complete live-fire in ~5 minutes. |
| Source-only static + structural verification | COMPLETE | See §3-§7 below. |

**Verdict ladder result:** `probable` confidence on UI/runtime correctness. Per Phase 0.A this CANNOT yield outright PASS for a UI/runtime change. Verdict downgraded to **CONDITIONAL PASS**, with the explicit condition being: operator runs the §10 live-fire smoke steps and reports back. The orchestrator's CLOSE sequence will require operator smoke confirmation regardless of test verdict — this defers nothing that wasn't already on the CLOSE checklist.

---

## 3. Spec compliance matrix — 25/25 success criteria

| SC | Status | Evidence |
|---|---|---|
| SC-01 | ✅ STRUCTURAL PASS | `BrandSwitcherSheet.tsx` footer button `onPress={handleSwitchToPersona}` + handler `setMode("persona")`. Adversarial A-08. |
| SC-02 | ✅ STRUCTURAL PASS | `personas: PersonaDef[]` array literal in BrandSwitcherSheet declares 3 entries in order [place, event, trip]. Implementor jest test asserts order. |
| SC-03 | ✅ STRUCTURAL PASS | trip persona: `icon: "compass"` + description literal. Compass icon was added to `Icon.tsx` (renders Circle + Path triangle pointer). Implementor jest test asserts icon literal. |
| SC-04 | ✅ STRUCTURAL PASS | place persona: `disabled: true`. PersonaPickerCards renders Pressable `disabled` + opacity 0.5 + "Coming soon" label. |
| SC-05 | ✅ STRUCTURAL PASS | trip persona `onSelect: () => setMode("trip-create")` + render branch `mode === "trip-create"` mounts `<TripBrandWizard>` with all 5 props wired. |
| SC-06 | ✅ STRUCTURAL PASS | popup-create render block byte-equivalent to pre-Tr1 except wrapped in mode check. Submit still calls `createBrandMutation.mutateAsync({...kind: "popup", coverHue: 25, address: null...})`. Adversarial A-09 + implementor jest "popup regression" test (3 tests PASS). |
| SC-07 | ✅ STRUCTURAL PASS | `TripBrandWizard.tsx` Input for name (variant=text, clearable) + TextInput for bio (multiline, numberOfLines=3, maxLength=200, char counter `{bio.length}/{BIO_MAX_LENGTH}`). `canSubmit = trimmedName.length > 0`. |
| SC-08 | ✅ STRUCTURAL PASS | `<BrandCoverPickerSheet>` embedded — that sheet wraps `uploadBrandCover` from `brandCoverService.ts` where `BRAND_COVERS_BUCKET = "brand_covers"`. |
| SC-09 | ✅ STRUCTURAL PASS | `createBrandMutation.mutateAsync({...kind: "trip_planner"...})` literal at TripBrandWizard.tsx. Adversarial A-10 + implementor jest "happy path" test asserts payload.kind === "trip_planner". |
| SC-10 | ✅ LIVE-DB VERIFIED | MCP execute_sql: `pg_get_constraintdef = CHECK ((kind = ANY (ARRAY['physical'::text, 'popup'::text, 'trip_planner'::text])))`. Migration applied 2026-05-17. |
| SC-11 | ✅ STRUCTURAL PASS | `router.push(`/brand/${brand.id}/payments`)` in `routeToPayments()`. Adversarial A-11. |
| SC-12 | ✅ STRUCTURAL PASS | `error instanceof SlugCollisionError` → `setStatus("error-slug-collision")` + inline `setErrorMessage(...)` with brand-specific copy. Implementor jest asserts. |
| SC-13 | ✅ STRUCTURAL PASS | `handleCoverPicked` catch block invokes `routeToPayments(createdBrand)` — brand persists, cover failure surfaces banner, routes anyway. Implementor jest asserts. |
| SC-14 | ✅ STRUCTURAL PASS | `home.tsx` `currentBrand.kind === "trip_planner"` outer branch + `stripeStatus === "active"` inner false-side renders "Finish setting up Stripe" CTA routing `/brand/{id}/payments`. Adversarial A-12. |
| SC-15 | ✅ STRUCTURAL PASS | Same conditional, true-side renders "Plan a trip" CTA routing `/trip/coming-soon`. |
| SC-16 | ✅ STRUCTURAL PASS | Outer conditional returns `null` when kind !== "trip_planner". Popup + physical brands see no CTA. |
| SC-17 | ✅ STRUCTURAL PASS | `BrandEditView.tsx` BRAND KIND section wrapped in `{draft.kind !== "trip_planner" ? (<>...</>) : null}`. Adversarial A-13. |
| SC-18 | ✅ STRUCTURAL PASS | Kind toggle Pressables remain only `kind: "physical"` + `kind: "popup"` setDraft calls. No `setDraft({...kind: "trip_planner"...})` exists. Adversarial A-13. |
| SC-19 | ✅ STRUCTURAL PASS | place persona `disabled: true` + empty `onSelect: () => { /* Ve1 wires later */ }`. PersonaPickerCards skips onPress when disabled. |
| SC-20 | ✅ INSPECTION PASS | switch-mode render block (lines 240-310 BrandSwitcherSheet) unchanged — renders all brands via `brandRow` style regardless of kind. No kind-conditional branch on the brand-row map. |
| SC-21 | ✅ INSPECTION PASS | `softDeleteBrand` in brandsService.ts not touched. Kind not referenced in any soft-delete predicate. |
| SC-22 | ✅ INSPECTION PASS | `UniversalCreatorSheet` component not touched. Home TopBar "+" button render path (`isUniversalCreatorOpen` state) unchanged. Kind not gating the button. |
| SC-23 | ⚠️ STRUCTURAL ONLY | TripBrandWizard delegates to `/brand/{id}/payments` (existing `BrandOnboardView`). End-to-end Stripe Connect flow not exercised in this test. Operator live-fire required. |
| SC-24 | ⚠️ STRUCTURAL ONLY | Abandonment leaves brand row + null stripe_connect_id (Finding I-1 in investigation). Home CTA branch covers this. End-to-end abandonment not exercised. Operator live-fire required. |
| SC-25 | ✅ STRUCTURAL PASS | `PersonaDef.id: "place" | "event" | "trip"` literal union at PersonaPickerCards.tsx:30. Adversarial A-07 (with banned-id widening attack — confirmed FAIL when union widened with "venue" probe). |

**Coverage:** 23/25 fully verified at this turn. SC-23 + SC-24 need operator live-fire (Stripe Connect happy + abandonment paths) — these are pre-existing BrandOnboardView flows untouched by Tr1, so behavior is inherited.

---

## 4. Implementation report claim verification

| Implementor claim | Verified? | Evidence |
|---|---|---|
| Migration applied + live constraint admits trip_planner | ✅ | MCP execute_sql confirms `CHECK ((kind = ANY (ARRAY['physical'::text, 'popup'::text, 'trip_planner'::text])))` |
| 3 jest tests pass with fails-on-revert at `ff46c3f5` | ✅ | Independently re-ran: 22/22 PASS in 6.088s (`Test Suites: 3 passed, 3 total`) |
| `tsc --noEmit` introduces ZERO new errors against Tr1-touched files | ✅ | grep of tsc output for any Tr1 path returned 0 matches; pre-existing 81 errors all unrelated (buyer.tsx, packages/event-rendering, @mingla/payments-native, DraftEvent.category drift) |
| 9 product files + 3 test files touched | ✅ | `git diff --stat HEAD` shows expected file list; see §6 Scope-leak discovery |
| SPEC deviation D-1 (location vs mapPin icon) | ✅ EQUIVALENT | `location` icon in `Icon.tsx:187-192` renders teardrop+circle — semantically identical to "mapPin". No SC affected. P3 cosmetic at most. |
| SPEC deviation D-2 (GlassCard "base" vs "flat") | ✅ EQUIVALENT | GlassCard variant union is `"base" | "elevated"` (no "flat"). `"base"` is the non-elevated alternative. No SC affected. |
| SPEC deviation D-3 (raw TextInput vs Input multiline) | ✅ EQUIVALENT | Input component has fixed HEIGHT=48, doesn't support multiline. Raw TextInput with matching `paddingHorizontal/Vertical/borderRadius/backgroundColor` is functionally equivalent. accessibilityLabel preserved. No SC affected. |
| Discoveries 1-6 registered | ✅ | All cited in implementation report §10. Tester adds no new discoveries (one scope-leak below). |

---

## 5. Independent regression test (Step 0.5 tester half)

### Adversarial structural-grep check (file 13 per SPEC §6)

**Path:** `mingla-business/scripts/ci/orch-0855-adversarial-check.mjs`
**Lines:** 268
**Run:** `node mingla-business/scripts/ci/orch-0855-adversarial-check.mjs`
**Result at `7750f7d6`:** 14/14 PASS

Attacks DIFFERENT angles than the 3 implementor jest tests:

| Check | Angle attacked | Different from implementor because |
|---|---|---|
| A-01 | Migration filename + monotonic prefix (>20260606000200) | Implementor tests don't touch filesystem migrations |
| A-02 | Migration DDL shape (DROP+ADD+DO$$+RAISE EXCEPTION) | Implementor doesn't validate SQL structure |
| A-03 | Migration transactional wrap (BEGIN/COMMIT) | Implementor doesn't validate transaction safety |
| A-04 | types/brand.ts widened (regex against source) | Implementor jest assumes types compile; doesn't grep source |
| A-05 | brandMapping.ts BOTH widenings + zero-narrow-survivors check | Implementor jest doesn't probe both BrandRow + BrandUiInput separately |
| A-06 | brandsService.ts widened (regex against source) | Same — implementor compiles, doesn't grep |
| A-07 | PersonaDef.id locked + banned-id widening attack (`venue`/`experience`/`creator`/`host`/`planner`) | Implementor only checks the 3 happy-path ids; doesn't probe widening attack vector |
| A-08 | Mode union exact set membership + deprecated-create-mode-gone | Implementor regex matches whole line; this checks for legacy `"create"` mode survival |
| A-09 | popup-create kind:"popup" preserved + no trip_planner in sheet | Implementor checks one direction; this also bans trip_planner leakage into the sheet |
| A-10 | TripBrandWizard kind:"trip_planner" literal | Same as implementor — kept for completeness/cross-check |
| A-11 | TripBrandWizard final route `/brand/{id}/payments` | Same as implementor — kept for completeness |
| A-12 | home.tsx BOTH kind + stripeStatus branches present | Implementor doesn't have a home.tsx test; this is the only branch check |
| A-13 | BrandEditView setDraft({...kind: "trip_planner"...}) ABSENT + guard PRESENT | Different angle: attacks via the setter pattern, not the render conditional |
| A-14 | **Scope-leak guardrail** — 'trip_planner' literal confined to expected Tr1 files | NOVEL angle — no implementor test does whole-tree scope-leak detection. Catches Tr2 work-stream contamination at PR time. |

**Fails-on-revert verified at HEAD `7750f7d6`:** temporarily widened `PersonaDef.id` union to `"place" | "event" | "trip" | "venue"`; ran adversarial check; A-07 FAILed with `PersonaDef.id union widened with banned ids: venue`; restored; all 14 PASS again. Probe documented in §11.

**Append-only CI compliance:** new file, no existing test modified. Compatible with `.github/workflows/tests-append-only.yml`.

---

## 6. Constitutional compliance (14 rules)

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | All new Pressables (3 persona cards, wizard submit, back chevrons, Home CTAs) have wired onPress handlers. Disabled place card explicitly opts out (`disabled` prop blocks onPress). |
| 2 | One owner per truth | PASS | `brands.kind` remains single source. No competing state. |
| 3 | No silent failures | PASS | TripBrandWizard handles SlugCollisionError → inline; network → banner; cover-failure-post-insert → banner + route continues with brand persisted. `updateCreatorAccount` fire-and-forget surfaces error via `onDefaultBrandSaveError` callback. |
| 4 | One key per entity | PASS | `brandKeys.list` + `brandKeys.detail` unchanged. No new query keys introduced. |
| 5 | Server state server-side | PASS | TripBrandWizard uses React Query mutations; Zustand `setCurrentBrand` only stores currentBrand id reference (existing pattern). |
| 6 | Logout clears everything | PASS | No new persisted state introduced. Existing brand-related stores already cleared on logout. |
| 7 | Label temporary | PASS | Zero `[TRANSITIONAL]` markers introduced. Implementor declares none. |
| 8 | Subtract before adding | PASS | popup-create flow preserved verbatim (no rewrite of working code). All Tr1 work additive. |
| 9 | No fabricated data | PASS | "Finish Stripe setup" honestly reflects pending state. Never claims active when not. No fake data shown. |
| 10 | Currency-aware | N/A | No currency surface touched. |
| 11 | One auth instance | PASS | TripBrandWizard reads `accountId` prop (passed by parent BrandSwitcherSheet from `useAuth().user.id`). No new auth instance. |
| 12 | Validate at right time | PASS | `canSubmit = trimmedName.length > 0 && status === "idle"` — validated at the right moment, not blocking on blur or in render. |
| 13 | Exclusion consistency | N/A | No exclusion/serving rules touched. |
| 14 | Persisted-state startup | PASS | TripBrandWizard doesn't touch hydration. Operates after auth + brandList hydrate (same as today's BrandSwitcherSheet). |

**Result:** 12 PASS, 2 N/A, 0 FAIL. No automatic P0 triggers.

---

## 7. Cross-domain impact verification

| Domain | Affected? | Verified |
|---|---|---|
| `mingla-business` iOS | YES | All 9 product files in this monorepo only. Shared RN code. |
| `mingla-business` Android | YES | Same code path — automatic parity. Live-fire required (Case-B). |
| `mingla-business` Web preview | NO | TopSheet uses RN Modal — doesn't render on web. Web preview is buyer-anon only. |
| Database | YES | Migration live. RLS untouched (kind-transparent). |
| `app-mobile` (consumer) | NO | Zero `app-mobile/` files touched. Trip-planner brands won't surface to consumers until C1. |
| `mingla-admin` | NO | Zero `mingla-admin/` files touched. Admin brand list will surface `kind='trip_planner'` raw — acceptable cosmetic for Tr1. |
| Edge functions | NO | Zero edge functions touched. `brand-stripe-onboard` kind-agnostic. |
| Storage | NO | `brand_covers` bucket reused via existing service. No new bucket/policy. |
| Realtime | NO | Not touched. |

---

## 8. Discoveries for Orchestrator (NEW, NOT in implementation report)

- **DISCOVERY-7 [scope leak — orchestrator action required at CLOSE]:** `mingla-business/app/(tabs)/hub/events.tsx` carries 19-line modifications citing `ORCH-0857 [Hub pill 44pt hit target]` (pill hitSlop + border color + lineHeight). These are PRE-EXISTING uncommitted changes in the working tree, NOT introduced by ORCH-0855, and unrelated to Tr1. **Orchestrator MUST exclude this file from the ORCH-0855 PR at CLOSE** — one-PR-per-CLOSE rule per `feedback_one_pr_per_close`. Suggested CLOSE staging:
  ```bash
  git add \
    mingla-business/src/types/brand.ts \
    mingla-business/src/services/brandMapping.ts \
    mingla-business/src/services/brandsService.ts \
    mingla-business/src/components/ui/Icon.tsx \
    mingla-business/src/components/brand/PersonaPickerCards.tsx \
    mingla-business/src/components/brand/TripBrandWizard.tsx \
    mingla-business/src/components/brand/BrandSwitcherSheet.tsx \
    mingla-business/src/components/brand/BrandEditView.tsx \
    'mingla-business/app/(tabs)/home.tsx' \
    mingla-business/src/services/__tests__/brandsService.tripPlannerKind.test.ts \
    mingla-business/src/components/brand/__tests__/BrandSwitcherSheet.personaFork.test.ts \
    mingla-business/src/components/brand/__tests__/TripBrandWizard.test.ts \
    mingla-business/scripts/ci/orch-0855-adversarial-check.mjs \
    supabase/migrations/20260607000000_orch_0855_brands_kind_trip_planner.sql
  ```
  Explicit 14-file `git add` — does NOT use `git add -A`.

- **DISCOVERY-8 [adversarial-check wiring]:** the new `mingla-business/scripts/ci/orch-0855-adversarial-check.mjs` is currently a standalone node script. Orchestrator should wire it into `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern` as part of CLOSE OR register a follow-up CI ORCH for the wiring. Not blocking, but improves regression coverage.

---

## 9. Findings + Praise

### P4 — Praise

- **P4-1 [implementor discipline].** Implementor halted at SPEC §7 Step 1 gate as instructed, waited for operator's `supabase db push --linked` confirmation, then resumed Steps 2-9 cleanly. Each step independently revertible per SPEC sequencing. No scope expansion beyond SPEC §6 file manifest (the hub/events.tsx leak is pre-existing, not implementor-introduced).
- **P4-2 [transparent SPEC deviations].** All 3 deviations (D-1/D-2/D-3) documented in §13 of implementation report with rationale + equivalence claim. Tester confirms all 3 are functionally equivalent — no SC affected.

### P3 — Low

- **P3-1 [SPEC literal vs implementation literal — D-1 icon].** SPEC §4.5.1 named `"mapPin"`; implementor reused existing `"location"` icon (semantically identical teardrop+circle SVG). The persona-card `icon` literal in BrandSwitcherSheet is `icon: "location"`. Adversarial check A-07 deliberately does NOT check the icon literal (just persona id union) — accepting this deviation. Polish-level: if operator wants the icon literal to literally read `"mapPin"`, add a `mapPin: () => RENDERERS.location()` alias in Icon.tsx. Out of scope for Tr1.

### P2 — Medium

None.

### P1 — High

None.

### P0 — Critical

None.

---

## 10. Operator live-fire smoke (Case-B handoff — required to promote to PASS at CLOSE)

These steps complete the Phase 0.A `proven` requirement that this tester turn could not satisfy without test creds. Operator runs them in ~5-10 minutes.

### NEXT STEPS — for you, Seth:

1. **Confirm the iOS dev build is fresh against current code.** From `/Users/sethogieva/Desktop/mingla-main` check `git rev-parse HEAD` shows `7750f7d6` or later. The installed app at `~/Library/Developer/Xcode/DerivedData/minglabusiness-ghoeylalbzpueufictcvspjbubjx/Build/Products/Debug-iphonesimulator/minglabusiness.app` was built before the Tr1 changes. **Rebuild** per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (three-step xcodebuild → embed-frameworks → codesign sequence). Skip if you can confirm the existing build was made after Step 2 of the implementor's run.
2. **Launch the app** on the booted iOS sim (`xcrun simctl launch 17091E60-C3B6-4167-980D-60C348E177F6 <bundle-id>`) and deep-link to Metro (`xcrun simctl openurl 17091E60-C3B6-4167-980D-60C348E177F6 "exp+mingla-business://expo-development-client/?url=http://localhost:8081"`). Sign in to a test account.
3. **Run the persona-picker smoke flow:**
   - Tap the brand chip (top-left of any tab) to open BrandSwitcherSheet.
   - Tap "Create a new brand" footer button. Expect the sheet to render 3 persona cards (NOT drop straight into the name input).
   - Verify visual order: "A place · Coming soon" (greyed) → "An event" → "A trip" (with compass icon).
   - Tap the disabled "A place" card. Expect: no navigation, no state change.
   - Tap back chevron in persona header. Expect: returns to switch list (if brands exist) or stays (if no brands).
4. **Run the trip-create happy path:**
   - From persona picker, tap "A trip". Expect TripBrandWizard slides in within the same TopSheet (NOT a new sheet at OS root).
   - Enter name "Wandering Soul Retreats Test", bio "Small group retreats" (watch char counter increment).
   - Tap "Continue to Stripe". Expect: brand creates, BrandCoverPickerSheet auto-opens.
   - Pick a cover image. Expect: routes to `/brand/{id}/payments` (BrandOnboardView).
5. **Verify DB write:** in Supabase SQL editor run `SELECT id, name, slug, kind, stripe_connect_id FROM public.brands WHERE name = 'Wandering Soul Retreats Test';` — expect 1 row with `kind = 'trip_planner'`.
6. **Run the Home CTA states:**
   - Without completing Stripe, back out to Home. Expect: "Finish setting up Stripe" GlassCard CTA above the empty stats. Tap → routes to `/brand/{id}/payments`.
   - Complete Stripe Connect test-mode in BrandOnboardView. Return to Home. Expect: "Plan a trip" CTA. Tap → routes to `/trip/coming-soon` (M0 stub).
7. **Regression check (popup brand path):**
   - Back to BrandSwitcherSheet → "Create a new brand" → "An event" → enter "Pop Test" → submit. Expect: creates `kind='popup'` brand identical to pre-Tr1 behavior (no cover picker auto-open, no Stripe routing, lands back in switch list).
   - Open BrandEditView for the popup brand. Expect: BRAND KIND section renders with physical/popup toggle (unchanged). Open for the trip-planner brand. Expect: BRAND KIND section is absent entirely.
8. **Android emulator parity:** repeat steps 2-7 on the booted `emulator-5554`. Behavior should be identical (shared RN code).
9. **Reply with "PASS" or list any failure** — I'll promote the verdict and hand back to orchestrator for CLOSE on PASS, or back to implementor for REWORK on any failure.

---

## 11. Fails-on-revert verification

| Test | File | Probe | Verified at |
|---|---|---|---|
| Implementor jest #1 | `brandsService.tripPlannerKind.test.ts` | Narrowed CreateBrandInput.kind to `"physical" \| "popup"`; ts-jest TS2322 blocks suite load. | `ff46c3f5` (pre-implementation HEAD) per implementor report Step 4 |
| Implementor jest #2 | `BrandSwitcherSheet.personaFork.test.ts` | Reverted Mode union to `"switch" \| "create"`; 1 of 9 tests FAILed on regex. | `ff46c3f5` |
| Implementor jest #3 | `TripBrandWizard.test.ts` | Changed kind literal `"trip_planner"` → `"popup"`; 1 of 10 tests FAILed on regex. | `ff46c3f5` |
| Tester adversarial | `orch-0855-adversarial-check.mjs` | Widened PersonaDef.id with banned `"venue"`; A-07 FAILed `PersonaDef.id union widened with banned ids: venue`; restored; 14/14 PASS. | `7750f7d6` (this turn) |

All probes documented + restored. No working-tree pollution from probes.

---

## 12. Coverage summary

| Layer | Coverage | Evidence |
|---|---|---|
| Database (migration + constraint + RLS) | 100% | Live SQL probes via MCP execute_sql |
| Types (4 union widenings) | 100% | Adversarial A-04/A-05/A-06 + tsc clean |
| Service layer (createBrand kind acceptance + SlugCollisionError contract) | 100% | Implementor jest (3 tests) |
| Hook layer (useBrands passthrough) | INFERRED | No code change; covered by service tests via integration |
| Component layer — PersonaPickerCards contract | 100% | Adversarial A-07 + interface lock verified |
| Component layer — TripBrandWizard contract | 100% | Implementor jest (10 tests) + Adversarial A-10/A-11 |
| Component layer — BrandSwitcherSheet refactor | 100% | Implementor jest (9 tests) + Adversarial A-08/A-09 |
| Component layer — home.tsx CTA | 100% | Adversarial A-12 |
| Component layer — BrandEditView lockdown | 100% | Adversarial A-13 |
| Cross-surface parity (iOS sim + Android emu) | 0% | DEFERRED — operator live-fire (§10) |
| Stripe Connect end-to-end (SC-23, SC-24) | 0% | DEFERRED — operator live-fire (§10), pre-existing BrandOnboardView untouched |
| Constitutional compliance | 100% | §6 above |
| Scope-leak detection | 100% | Adversarial A-14 + DISCOVERY-7 |

---

## 13. Cross-references

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md`
- Adversarial check: `mingla-business/scripts/ci/orch-0855-adversarial-check.mjs`
- Implementor regression tests: `mingla-business/src/{services,components/brand}/__tests__/*tripPlanner*|*personaFork*|*TripBrandWizard*`
- Migration: `supabase/migrations/20260607000000_orch_0855_brands_kind_trip_planner.sql` (LIVE)
- Operator memory referenced: `feedback_tester_canonical_and_platform_parity`, `feedback_one_pr_per_close`, `feedback_orchestrator_deploys_edge_functions`, `feedback_strict_grep_registry_pattern`

---

## 14. AMENDMENT REVERTED (2026-05-17)

A Stripe-first gating amendment was proposed and briefly applied mid-session, then reverted on operator directive ("no revert"). The original kind-outer gating shape per SPEC §4.5.4 is restored. SC-14 / SC-15 / SC-16 retain their original semantics; no SC-26 was added; adversarial A-12 restored to presence-check. Code state matches implementor's original return verbatim.

**Why reverted (operator's call, not technical):** the kind-outer gating is intentional for Tr1. Operator likely wants popup brands without a self-declared trip-planner intent to NOT see "Plan a trip" — keeps each brand's Home focused on its self-declared purpose. The I-1.2-BRAND-AS-CONTAINER invariant still holds at the capability layer (any brand CAN technically create a trip via universal "+" once Tr2 ships) — the Home CTA is just a curated nudge for trip planners specifically, not a hard gate. If operator wants Tr2 to expose universal "+" → Create trip to all Stripe-active brands, that's a Tr2-scope decision separately from Tr1's Home CTA.

**No discoveries promoted, no follow-up ORCH registered.** Tr1 ships as originally implemented.

**Operator question:** "but if a user already has a brand that has stripe, why cant they just create a trip and accept payments?"

**Resolution:** correctly invoking I-1.2-BRAND-AS-CONTAINER. `brands.kind` is starting identity, NOT capability gate. Any brand with `stripe_charges_enabled = true` can author + sell a trip (via universal "+" → Create trip once Tr2 ships). Previous Home CTA gated on `kind === 'trip_planner'` first — would have hidden "Plan a trip" from a popup brand with Stripe active. Inconsistent with the invariant.

**Code change:** `mingla-business/app/(tabs)/home.tsx` CTA block.

- **Before:** `currentBrand.kind === "trip_planner" ? (Stripe-status branches) : null`
- **After:** `currentBrand.stripeStatus === "active" ? (Plan-a-trip CTA, kind-aware body copy) : currentBrand.kind === "trip_planner" ? (Finish Stripe setup CTA) : null`

**Behavior matrix (new):**

| Brand kind | Stripe status | CTA shown |
|---|---|---|
| trip_planner | active | "Plan a trip" — copy: "You're set up. Create your first trip to start selling." |
| trip_planner | not active | "Finish setting up Stripe" — routes `/brand/{id}/payments` |
| popup | active | "Plan a trip" — copy: "Your brand can sell trips too. Tap to start a multi-day trip with deposits + installments." |
| popup | not active | NONE (no regression — popup operators without Stripe see Home as today) |
| physical | active | "Plan a trip" — same copy as popup |
| physical | not active | NONE |

**SPEC amendment:** SPEC §5 SC-15 + SC-16 reworded; new SC-26 added enforcing gating ORDER (Stripe-outer, kind-fallback).

**Adversarial check A-12 tightened:** was "presence check"; now "position check" — fails if kind-branch position precedes stripe-branch position in source (catches regression to kind-gated-outer). Fails-on-revert verified at this HEAD: temporarily reverted to `currentBrand.kind === "trip_planner" && currentBrand.stripeStatus === "active"` outer ternary → A-12 FAILed with `gating order WRONG: kind-branch (pos 15287) appears BEFORE stripe-branch (pos 15327)`; restored; 14/14 PASS.

**Tests:** all 22 implementor jest tests still PASS (no test file modifications — the existing tests don't assert specific home.tsx gating shape, so the amendment doesn't break them). Adversarial check 14/14 PASS at amended state.

**Memory writes at CLOSE (orchestrator):** add to `feedback_brand_kind_immutable_post_create.md` (or new dedicated memory) a note that "Home CTA gating uses stripeStatus-outer per I-1.2-BRAND-AS-CONTAINER; kind is fallback for the Finish-Stripe nudge only." Prevents future regressions back to kind-outer gating.

**SC-26 verification:** ✅ PASS via Adversarial A-12 position check. Operator live-fire (§10 Case-B) should now also verify: open a popup brand with active Stripe → confirm "Plan a trip" CTA renders with the kind-specific body copy "Your brand can sell trips too..."

**Time cost:** ~15 minutes (operator directive → code amendment → SPEC update → adversarial tightening → fails-on-revert probe → QA report update). No CLOSE delay beyond this turn.
