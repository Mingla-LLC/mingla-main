# TEST — ORCH-1138 [trip-page-redesign] · ALL-SURFACE PRE-MERGE (production gate)

**Tester:** mingla-tester · **Date:** 2026-06-15
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` · branch `ORCH-1138-trip-page-redesign`
**HEAD tested:** `a7a0e6db8` (+ tester adversarial commit `401e83bd2`)
**Baseline:** `origin/main` @ `2bcf4e847`
**Mode:** SPEC-COMPLIANCE + TARGETED, web-priority (this merge deploys WEB).

---

## 1. VERDICT

### CONDITIONAL PASS — 0 P0 · 2 P1 (both NON-BLOCKING for the production merge) · 0 unaccepted-blocker

The ORCH-1138 public trip page redesign is **functionally correct and safe to merge to production**.
The two P1 findings are **stale/self-inflicted test assertions, NOT behavior regressions** — the
underlying runtime behavior (byte-identical checkout, plan threading, theming) is fully preserved and
independently proven. They do **not** block the CI that actually runs (strict-grep + bundle budget,
all GREEN) and do **not** affect the shipped WEB bundle. They are P1 only because a red test ships in
the closing diff (hygiene), and should be cleaned up — ideally before merge, acceptably as a fast
follow-on.

**Why CONDITIONAL not PASS:** two test suites that were GREEN on origin/main are RED on the branch
(P1-A), and one NEW app-mobile test in the closing diff ships RED (P1-B). The "ZERO NEW jest failures
vs baseline" dispatch criterion is therefore not literally met. Behavior is proven intact, so this is
not a FAIL — but it is below a clean PASS until the three stale assertions are refreshed.

**Native-surface note (per dispatch):** no native rebuild was run (risk of timeout, pure-JS/RN style
+ theming change = OTA-eligible). Native consumer + business surfaces are verified via the implementor's
sim screenshots + node:assert source tests + the shared-RN parity argument. Stated explicitly here.

---

## 2. P0/P1 BLOCKERS

### P0 — none.

### P1-A — Two ORCH-1130 test suites broke on the branch (stale source-string, behavior PRESERVED)
- **Evidence:** `TripPaymentChoice_orch_1130_regression.test.ts` + `TripPaymentChoice_orch_1130_adversarial.test.ts`
  PASS on origin/main `2bcf4e847`, FAIL on branch `a7a0e6db8`. Independently baselined (symlinked node_modules, identical deps).
  - Regression suite asserts the `/t/` route source literally contains `params: { plan: paymentPlanChoice }`.
    ORCH-1138 rebuilt the route; it now reads `params: { plan: choice ?? paymentPlanChoice }`
    (`app/t/[brandSlug]/[tripSlug].tsx:386`) — a **superset** (per-button explicit choice, falling back to toggle state). Behavior is correct/improved.
  - Adversarial suite asserts `ConsumerTripDetailScreen` contains JSX `paymentPlanChoice={detail.hasPlan ? paymentPlanChoice : undefined}`.
    ORCH-1138 removed the EBES JSX prop; the SAME gate now lives as an object property in the
    `runNativeCheckout` call (`ConsumerTripDetailScreen.tsx:547`: `paymentPlanChoice: detail.hasPlan ? paymentPlanChoice : undefined`). The `useState<"full"|"installments">("full")` explicit default is intact (`:334`).
- **Impact:** zero user impact. DISC-1130-A (explicit pay choice, never silent 'auto') is PRESERVED and
  independently re-proven by the `orch-1130-consumer-payment-choice-check.mjs` CI gate (PASS) and by the
  byte-identical-checkout assertions (below). These are stale string-match tests broken by a legitimate refactor.
- **Required fix:** update the two ORCH-1130 source-string assertions to the new (correct) source under
  `[TEST-MOD-APPROVED ORCH-1138]`, OR refactor them to behavioral assertions. The implementor's reports
  flagged a broad pre-existing red surface but did NOT call out these two as newly-broken-by-1138 — they should.
- **Retest:** re-run both suites; expect green after the assertion refresh.

### P1-B — A NEW app-mobile test in the closing diff ships RED (self-inflicted stale assertion)
- **Evidence:** `app-mobile/src/screens/Trip/__tests__/orch_1138_consumer_trip_foundation.test.ts` is NEW in
  `git diff origin/main...HEAD` and FAILS at HEAD: T3a asserts `style={[styles.wrapper, { bottom: wrapperBottom }]}`
  but a later same-branch commit evolved the component to `styles.floatWrapper`. (Implementor flagged this in
  `IMPLEMENTATION_..._UNIFIED_SEAM_SPLIT...md` §10 as "pre-existing" — but it is in THIS closing diff, so it is self-inflicted, not pre-existing.)
- **Impact:** zero user impact (app-mobile jest is not in the main CI path that gates this merge). Hygiene only:
  a red test shipping in the diff misleads future readers and weakens the regression net.
- **Required fix:** update T3a to assert `styles.floatWrapper` (or retire it) under `[TEST-MOD-APPROVED ORCH-1138]`.
- **Retest:** `node app-mobile/src/screens/Trip/__tests__/orch_1138_consumer_trip_foundation.test.ts` → exit 0.

---

## 3. BYTE-IDENTICAL CHECKOUT + NO-REGRESSION CONFIRMATIONS

| Confirmation | Result | Evidence |
|---|---|---|
| Consumer Reserve → cart DIRECTLY (no EBES detail hop) | CONFIRMED | `ConsumerTripDetailScreen.tsx` has 0 active EBES refs (8 hits all in comments); mounts `<TicketCartSheet>`. Strict-grep gate PASS + fails-on-revert. Sim evidence `SC1_02_reserve_opens_cart_directly.png` (cart opens, no billing/tax form). |
| Checkout request BYTE-IDENTICAL (no address / no taxCalcId; correct paymentPlanChoice / dueTodayCents) | CONFIRMED | `runNativeCheckout({eventId, lines, buyer, ...(intakeFormData), paymentPlanChoice: detail.hasPlan ? choice : undefined})` (`:529-548`) — no `address`, no `taxCalculationId`. Implementor T4a/T4b/T4c/T4d PASS; **I re-ran fails-on-revert (Step 0.5): injecting `taxCalculationId` → T4b AssertionError; restored → 15/15**. `orch-1130-no-buyer-tax-form.mjs` PASS. |
| Each split-CTA half → straight to cart with its OWN pay choice | CONFIRMED | `/t/` route: full→`handleTripReserve("full")`, overTime→`handleTripReserve("installments")` (`:405/414`); my adversarial test proves DISTINCT choices fails-on-revert. |
| Events + experiences still open shared EBES → cart (no regression) | CONFIRMED | `ExpandedBusinessEventSheet.tsx` UNMODIFIED in diff; sim evidence `SC6_01`/`SC6_02` (event opens own path, not trip cart). EBES forwards-choice adversarial test still references EBES (unchanged). |
| Protected callers byte-identical (`/checkout-trip/.../payment`, wizard Step-5) | CONFIRMED | Neither passes a `palette` prop (grep: 0). Additive-prop contract → default-dark branch = today's look. `TripPaymentChoice`/`TripPreview` palette is optional. |
| Public EVENT page byte-identical post `createThemePalette` extraction | CONFIRMED | `PublicEventPage.tsx` −187 lines (pure move), imports `createThemePalette` from `./themePalette.ts` (+300). `createThemePalette.parity.orch1138.test.ts` (exact palette-value snapshot) PASS. Package-isolation gate PASS. (Stale ORCH-0964 BlurView test fails on BOTH branch + baseline → pre-existing, not 1138.) |

---

## 4. GATE RESULTS

| Gate | Result | Detail |
|---|---|---|
| `orch-1138-trip-reserve-straight-to-cart.mjs` (strict-grep) | **PASS** | + fails-on-revert: `ORCH1138_SIMULATE_REVERT=1` → correctly FAILS. |
| `meta-orch-0827-package-isolation.mjs` | **PASS** | New `@mingla/offering-rendering` + `event-rendering` extraction import no app code. |
| `orch-1083-initial-bundle-budget.mjs` (`__common` web budget) | **PASS** | Ran against a fresh `npm run web:export` (isolated TMPDIR, 134 chunks): initial payload 2,959,424 B (ceiling 9,405,478), `__common` within 2.25 MB cap, 0 deferred specifiers leaked. |
| `orch-1130-no-buyer-tax-form.mjs` | **PASS** | No buyer-facing address/tax form on any surface. |
| `orch-1130-consumer-payment-choice-check.mjs` | **PASS** | Explicit `payment_plan_choice` threaded end-to-end; no silent 'auto'. |
| `orch-1105-web-glass-opaque-fallback.mjs` | **PASS** | All 6 glass surfaces route through the shared helper. |
| **Web export (`expo export -p web`)** | **PASS (exit 0)** | Full bundle compiles with all 1138 changes; trip route chunk emitted. This is the load-bearing WEB-surface proof (merge deploys WEB). |
| mingla-business jest — ORCH-1138 suites | **PASS** | 5 core 1138 suites = 119 tests green; full trip dir = 534 pass / 29 fail, of which **27 fails are pre-existing on origin/main** (10 of the 12 failing suites identical on baseline) and **2 are the P1-A stale-string suites**. |
| Live prod data dependencies | **PASS** | `pg_public_ticket_types_remaining` + `pg_brand_can_charge` exist on prod and are `anon`-executable (read-only introspection) — the `/t/` web page's RPC reads work against production; no backend deploy needed. |

---

## 5. STEP 0.5 — Independent re-run of implementor fails-on-revert

- **Implementor happy-path:** `app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_straight_to_cart.test.ts`.
  Re-ran at HEAD `a7a0e6db8`: **15 assertions PASS**. True-edit revert (injected `taxCalculationId: "REVERT_TEST"`
  into the active `runNativeCheckout` call) → **T4b fired `AssertionError [ERR_ASSERTION]: FAIL T4b the trip
  checkout NEVER sends a taxCalculationId`**; restored file → 15/15 PASS, `git diff --stat` clean. **fails-on-revert verified.**
- Other implementor 1138 happy-path tests re-run green: split_buttons (21), float_dock (19), trip_parity_fixes (31),
  brand_cover hook (14); business suites tripReserveSplitButtons / tripReserveFloatDock / offeringRenderingIsolation /
  createThemePalette.parity / contrast-invariant = 119.

## 5b. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-business/src/components/trip/__tests__/reserveSplitDistinctChoice.tester.orch1138.test.ts`
- **Commit:** `401e83bd2` (on-branch; appears in `git diff origin/main...HEAD --name-only`).
- **Angle:** money-correctness of the two-tone seam-split CTA — asserts the "Pay in full" half routes `"full"`
  and the "Pay over time" half routes `"installments"` on both surfaces (a silent mischarge if a refactor
  collapsed both to one choice). Distinct from the implementor's render-structure tests and the prior
  `themePaletteContrastInvariant.tester` (contrast) test.
- **fails-on-revert verified:** collapsing `handleTripReserve("installments")` → `("full")` reds 2 assertions
  (installments + "do NOT share one choice"); restored → **6/6 PASS**. Route file restored clean.
- Both required tests present in the closing diff: implementor happy-path (`orch_1138_reserve_straight_to_cart.test.ts`)
  + tester adversarial (`reserveSplitDistinctChoice.tester.orch1138.test.ts`). **Regression gate satisfied.**

---

## 6. SC-by-SC (public trip page redesign — SPEC_ORCH-1138_PUBLIC_TRIP_PAGE_REDESIGN)

| SC | Surface | Result | Evidence |
|---|---|---|---|
| SC-1 themed teal+Playfair page | Web | PASS | `loaded-1280.png` (Playfair title, accent eyebrow/chips/spine); `createThemePalette` parity test. |
| SC-3 light brand → light page + contrast | Web | PASS | contrast-invariant tester test (full hue sweep, AA floors); `lightTheme-390.png`; `TREATMENT_B_white_half_390.png` light stress. |
| SC-4 hero image/video/no-cover + entrance | Web | PASS (source+evidence) | `loaded-*.png` parallax cover + fixed chrome; `EventCoverMedia` reuse; `native-trip.png`. |
| SC-5 brand chip "Presented by" + View | Web | PASS | `loaded-1280.png` ("PRESENTED BY / Travel Brand / View"). |
| SC-6 itinerary spine + long-trip collapse | Web | PASS | `loaded-1280.png` numbered accent dots Day 1/Day 2; `tripPageParityRework` test. |
| Route legs "City, Country" | Web | PASS | `loaded-1280.png` ("Raleigh, North Carolina, United States → Washington, DC"); `routeCityCountry.orch1138` test. |
| Cancellation policy BEFORE "Choose how you pay" | Web | PASS | `TripPreview.tsx:430` (cancellation) precedes `:663-668` ("Choose how you pay" + paymentBlock); explicit reorder comment `:656-658`. |
| "Where you'll be" map on web | Web | PASS | `TripPreview.tsx:611-628` `buildStaticMapUrl` + fail-safe null (Constitution #9); `mapboxStaticImage.orch1138` test. |
| SC-8 payment toggle themed, amounts intact | Web | PASS | `tripPaymentAdditivePalette.orch1138` test; 1130 logic untouched. |
| SC-9 NULL theme = today's dark look | Web | PASS | additive-default branch; `loaded-390.png`. |
| SC-10 unthemed callers byte-identical | Web | PASS | protected callers pass no palette (grep 0). |
| SC-11 event page unchanged | Pkg | PASS | parity snapshot test + pure-move diff. |
| SC-14 no fabricated data | Web | PASS | sold-out only on real `pg_public_ticket_types_remaining` RPC (anon, prod-live); fail-open to null; `tripNoFabricatedFields.orch1138` test. |
| Two-tone seam-split Reserve CTA | Web+Consumer | PASS | `TREATMENT_B_white_half_390.png` (accent half white-text + solid-white half accent-text, side-by-side no-wrap, docked+floating, light+dark, ellipsizes); single-button fallback `03-..png`/`TREATMENT_B_noplan_single.png`. |
| Reserve straight-to-cart (SC-1..SC-8 cart SPEC) | Consumer | PASS | `SC1_02`, `SC3_cart_due_today_deposit_125.png`, `SC6_*`; node test 15/15. |

Native (business iOS/Android, consumer iOS/Android): verified via implementor sim screenshots
(`native-trip.png`, `SC1_*`, `DR3/DR4_*`, `BUG1/BUG2_*`) + shared-RN parity + node:assert source tests.
**No native rebuild run (OTA-eligible JS/theming change; rebuild risked timeout per dispatch).**

---

## 7. Constitution (14-rule) — spot matrix on the diff

| # | Rule | Result | Note |
|---|---|---|---|
| 1 | No dead taps | PASS | Reserve fires cart/checkout; both CTA halves tappable. |
| 2 | One owner per truth | PASS | Theme resolved once in route; sold-out from one RPC. |
| 3 | No silent failures | PASS | RPC error path `console.warn` + fail-open (documented). |
| 9 | No fabricated data | PASS | No fake seats-left; sold-out only on real signal; map fail-safe null. |
| 10 | Currency-aware | PASS | price from tier; `formatCurrency`; 1130 untouched. |
| 12 | Validate at right time | PASS | pay choice byte-identical; venue-sourced tax server-side. |
| — | Android glass opaque fallback | PASS | `orch-1105` gate PASS; `Platform.select` opaque ≥0.92 on themed panels. |
| Others (4,5,6,7,8,11,13,14) | N/A or PASS | no auth/persist/query-key surface changed by this diff. |

---

## 8. Device / parity matrix

| Surface | Result | Basis |
|---|---|---|
| Buyer/anon Web (`/t/...`) — PRIMARY | **PASS** | web export exit 0 + bundle budget PASS + `loaded-1280/390.png` + `TREATMENT_B_white_half_390.png` + prod RPCs anon-live. |
| Business iOS | PASS (sim evidence) | shared RN file; `native-trip.png`. No rebuild. |
| Business Android | PASS (source) | opaque-glass gate PASS; shared RN. No rebuild. |
| Consumer iOS | PASS (sim evidence) | `SC1_02`, `SC3`, `DR3/DR4` sim screenshots; node tests. No rebuild. |
| Consumer Android | PASS (parity) | shared RN; opaque-glass honored. No rebuild. |
| Admin Web | N/A | no trip page in admin. |
| Business Web preview / wizard Step-5 | PASS (no-regression) | no palette passed → byte-identical. |

**Physical iPhone (HITL):** not exercised this run — pure-JS/theming change, web is the deploying surface,
and the prior interrupted run + rich sim evidence cover native. If Seth wants a device pass before/after
OTA, that is a fast manual confirm (open a themed `/t/` trip → Reserve → cart-direct).

---

## 9. Discoveries for Orchestrator

1. **P1-A/P1-B stale tests** (above) — refresh the two 1130 source-string suites + the app-mobile foundation T3a under `[TEST-MOD-APPROVED ORCH-1138]`. Best done before merge; acceptable as a fast follow-on since CI gating this merge is green and behavior is proven.
2. **Large pre-existing red surface** in `mingla-business/src/components/trip/__tests__/` (10 suites: TripVisualParity[_adversarial], PaymentPlanEditor[_adversarial], EditPublishedTripScreen.save/refundGate, tr2RewordPolish, IntakeTypePickerSheet_0884, TripPublishStripeBanner, TripCreatorWizard.cover) — confirmed identical-red on origin/main `2bcf4e847`. NOT 1138. Worth a dedicated cleanup ORCH (these are not in the main CI jest path).
3. **Stale ORCH-0964** `PublicEventPage.orch_0964_design_rework` BlurView/color asserts — red on baseline too; pre-existing.
4. The implementor went BEYOND SPEC OQ-1 and wired a REAL anon sold-out RPC (`pg_public_ticket_types_remaining`) rather than omitting the state — good (no fabrication), and verified prod-live + anon-callable.

## 10. Comms Ledger

Read on entry. No BLOCK+OPEN row targets tester/ORCH-1138/ALL. WARN rows factored: COMMS-0027 (OTA cache poison — N/A, no deploy this run; web export used isolated TMPDIR defensively), COMMS-0029 (trip migration clobber — N/A, 1138 is a fetch+render change, no migration). No new ledger entry warranted.

---

## 11. Routing

CONDITIONAL PASS with two NON-BLOCKING P1s (stale tests, behavior proven intact). Surface to Seth:
production merge is SAFE; recommend refreshing the 3 stale assertions (P1-A x2 + P1-B) before or
immediately after merge. Do NOT merge/deploy/close from this skill.
