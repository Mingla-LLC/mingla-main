module.exports = {
  // #2178 — the required `mingla-business jest (full suite)` gate was returning a
  // DIFFERENT answer on every run of the same commit: 3 suites red, then 0, and a
  // fourth on CI. Not flaky tests — CPU starvation.
  //
  // MEASURED on afb4b39da, 964 suites / 8309 tests:
  //   --runInBand (1 worker) : 0 failed, every time
  //   default parallel       : 3 failed, then 0, then a different 1 on CI
  // and every one of those failures was the SAME error:
  //   "Exceeded timeout of 5000 ms for a test"
  // in suites that took 37s, 14s and 18s of wall time under contention.
  //
  // Jest's 5s default assumes a test gets a CPU when it asks for one. With ~960
  // suites across N workers on a shared runner it does not, so tests that finish
  // in milliseconds serially blow the budget in parallel — and WHICH ones lose the
  // race changes run to run, because jest deals files to workers from a timing
  // cache that differs by machine and by run.
  //
  // A required gate that cannot be trusted red OR green is worse than none, since
  // it still carries a gate's authority. 20s is generous enough to absorb
  // contention and still short enough that a genuinely hung test fails the job
  // rather than running to the 6h ceiling.
  testTimeout: 20000,
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  // ORCH-1118 / ORCH-1122 — the EditPublishedTripScreen render-proofs run a REAL
  // react-native-testing-library mount and therefore need their dedicated render
  // configs (`jest.orch1118.render.cjs` / `jest.orch1122.render.cjs` — RN preset
  // + the .orch1118-testdeps overlay). They MUST NOT run under this default
  // node/ts-jest config (no RTL installed here). See
  // EditPublishedTripScreen.render.README.md.
  testPathIgnorePatterns: [
    "/node_modules/",
    "EditPublishedTripScreen\\.render\\.test\\.tsx$",
    "EditPublishedTripScreen\\.coverDeadTap\\.render\\.test\\.tsx$",
    // ORCH-1122 tester-owned adversarial render-proof (two-way close binding).
    "EditPublishedTripScreen\\.coverClose\\.adversarial\\.render\\.test\\.tsx$",
    // ORCH-1143 tester runtime render-proof — runs under jest.orch1143.render.cjs
    // (RN preset + RTL via the .orch1118-testdeps overlay); MUST NOT run under
    // this default node/ts-jest config (no RTL).
    "LiveOfferingCard\\.orch1143\\.render\\.test\\.tsx$",
    // ORCH-1147R2 tester adversarial render-proof — mounts the REAL QuantityRow
    // + bottom-bar via react-test-renderer + RTL (the R1 blind spot: the
    // selection SCREEN was never rendered). Runs under jest.orch1147r2.render.cjs
    // (RN preset + RTL); MUST NOT run under this default node/ts-jest config.
    "orch_1147r2_selection_allin\\.render\\.test\\.tsx$",
    // ORCH-1152 tester adversarial render-proof — mounts the REAL CartProvider
    // EMPTY (the shipped RangeError state) + the original unconditional bottom-bar
    // headline, asserting the tree renders "—" without throwing. Runs under
    // jest.orch1152.render.cjs (RN preset + RTL); MUST NOT run under this default
    // node/ts-jest config (no RTL installed here).
    "orch_1152_empty_cart_currency_crash\\.adversarial\\.render\\.test\\.tsx$",
    // ORCH-1193 [sheet-cutoff] implementor render-proof — mounts the REAL
    // VenueTableSheet through react-native-web (ReactDOMServer) to assert the body
    // ScrollView is flex-bounded. Runs under jest.orch1193.sheetscroll.web.render.cjs
    // (react-native→react-native-web alias); MUST NOT run under this default
    // node/ts-jest config (no web alias / react-dom types).
    "sheetBodyScrollBounded\\.orch1193\\.web\\.render\\.test\\.tsx$",
    // ORCH-1335 RsvpStep5Setup chip-in bank-banner render-proof — runs under
    // jest.orch1335.render.cjs (RN preset + RTL via the .orch1118-testdeps
    // overlay); MUST NOT run under this default node/ts-jest config (no RTL).
    "RsvpStep5Setup\\.orch1335\\.render\\.test\\.tsx$",
    // ORCH-1331 PartnerPaystackOnboardForm tester adversarial render-proof —
    // runs under jest.orch1331.render.cjs (RN preset + RTL via the
    // .orch1118-testdeps overlay); MUST NOT run under this default
    // node/ts-jest config (no RTL installed here).
    "PartnerPaystackOnboardForm\\.orch1331\\.render\\.test\\.tsx$",
    // #1834 [keyboard-blocks-bank-field] implementor happy-path render-proof —
    // mounts BrandOnboardView + BrandPaymentsView and asserts the NG
    // account-number field's scroll host is the SmartScrollView wrapper's
    // KeyboardAwareScrollView at bottomOffset=54. Runs under
    // jest.issue1834.render.cjs (RN preset + RTL); MUST NOT run under this
    // default node/ts-jest config (no RTL installed here).
    "issue_1834_bank_field_smartscroll\\.render\\.test\\.tsx$",
    // #1863 [error-toast-covers-bank-field] implementor happy-path render-proof —
    // mounts the three REAL payments ROUTE components and asserts the role gate
    // on the mounted tree (denied → explanation card + zero edge invocations;
    // allowed → byte-identical surface). Runs under jest.issue1863.render.cjs
    // (RN preset + RTL); MUST NOT run under this default node/ts-jest config
    // (no RTL installed here).
    "issue_1863_payments_permission_gate\\.render\\.test\\.tsx$",
    // #1890 [keyboard-clearance-overshoot] implementor happy-path render-proof —
    // mounts the REAL AriChatScreen and reads the composer wrapper's resolved
    // paddingBottom off the mounted tree. Runs under jest.issue1890.render.cjs
    // (RN preset + RTL); MUST NOT run under this default node/ts-jest config
    // (no RTL installed here). Named `.happy.test.ts`, so it is NOT covered by
    // the `\.render\.test\.tsx$` catch-all below.
    "issue_1890_ari_composer_clearance\\.happy\\.test\\.ts$",
    // #1890 C-5 REWORK render-proof — mounts the REAL GroupChatPanel and reads
    // the composer row's resolved paddingBottom plus the offset it passes to the
    // KeyboardAvoidingView. Same config, same reason it must not run here.
    "issue_1890_group_chat_composer_clearance\\.happy\\.test\\.ts$",
    // #1036 [remove-contrast-chip] tester adversarial WEB render-proof — mounts
    // the REAL ThemeSheet through react-native-web (ReactDOMServer) to assert no
    // contrast-advisory node renders for any seed. Runs under
    // jest.issue1036.render.cjs (react-native->react-native-web alias); MUST NOT
    // run under this default node/ts-jest config (no web alias / react-dom).
    "issue1036NoContrastNode\\.web\\.render\\.test\\.tsx$",

    // ======================================================================
    // #1062 [biz-jest-residual-burndown] Wave 1 — B5 WRONG-RUNTIME exclusions.
    // These files match jest's testMatch (*.test.ts) but their REAL runner is
    // NOT jest — each is excluded here (file RETAINED in the repo, never deleted;
    // tests-append-only.yml stays green) with its true runner named. Placed BEFORE
    // the #1047 quarantine marker on purpose: the ORCH-1047 anti-quarantine gate
    // classifies only the #1047 block, and these are wrong-runtime files, not
    // source-text pins.
    // ======================================================================
    "buttonAccentContrast\\.orch1162\\.test\\.ts$", // DENO test (Deno.test + https://deno.land/std import) — runs under Deno, never jest
    "issue_2321_business_retained_copy\\.tester\\.adversarial\\.test\\.ts$", // DENO test — runs in ci-batch:issue-2321-account-deletion-tests (the batched suite that replaced the retired wrapper at #2439 Phase 3C cutover), never jest
    "meta_orch_0952_carousel_adversarial\\.test\\.ts$", // PLAYWRIGHT spec — runs under playwright.config.ts (`npm run test:browser`), never jest
    "meta_orch_0952_carousel_browser\\.test\\.ts$", // PLAYWRIGHT spec — runs under playwright.config.ts (`npm run test:browser`), never jest
    "orch_1138_event_foundation\\.test\\.ts$", // NODE-ASSERT script (node:assert at module scope, zero jest test()/it() blocks; header: "Run with: node …") — runs under node, never jest

    // ======================================================================
    // #1047 [business-jest-suite-audit] — Part 1 quarantine (config-only).
    // Regenerate/verify the exact membership with:
    //   node scripts/ci/select-source-text-pins.mjs
    // NO test file is edited here (tests-append-only.yml stays green); every
    // file remains in the repo (grep-able), it is only excluded from the run.
    // ======================================================================

    // ---- RENDER_EXCLUDE (17) — render/RTL suites mis-swept into this default
    // node/ts-jest config. Each imports a real render lib (react-test-renderer /
    // @testing-library / react-dom/server / react-native-web) and runs under its
    // OWN dedicated jest.<orch>.render.cjs config + per-issue workflow; it can
    // never pass here. Two naming-convention patterns (Discovery D-1) cover all
    // 17 and are drift-resistant — any *.render.test.tsx is a render-proof by
    // construction (verified: 0 currently-green suites match either pattern).
    // The 3 *.orch0976.* react-test-renderer suites are DELIBERATELY NOT excluded:
    // they run under THIS stock config inside ci-batch:orch-0976-draft-promotion-tests
    // (which installs react-test-renderer --no-save), and the nightly suite
    // installs it too — excluding them would break that per-issue workflow.
    // #2737 reservation calendar happy render-proof runs under
    // jest.issue2737.render.cjs in the #1486 batched workflow.
    "\\.render\\.test\\.tsx$", // every web + RN render-proof (subsumes the explicit render entries above)
    // #1486 — these six files now run NOWHERE, and that is a deliberate,
    // recorded decision rather than the silent hole this line used to be.
    // It previously handed off to the orch1355 "tester" and "promotion" render
    // configs; no workflow ever invoked either, and both are now DELETED.
    // (Their filenames are deliberately not spelled in full anywhere in this
    // file: issue-1486-jest-config-invoked-by-workflow.mjs treats ANY
    // `jest.*.cjs` token here as a live hand-off and fails hard when it cannot
    // resolve one — which is the entire point of that gate.)
    //
    // Why deleting was right rather than reviving: #976 (2026-07-20, commit
    // 81a0f0bb7) added `useNavigation` + `useFocusEffect` to both edit routes,
    // which their `jest.mock("expo-router", …)` factories do not provide — so
    // every one of them dies at `useNavigation is not a function` before
    // asserting anything. Reviving them needs edits INSIDE the test files, which
    // `tests-append-only.yml` blocks, and would only duplicate coverage that
    // already gates: the SAME commit shipped
    // `ci-batch:orch-0976-draft-promotion-tests`, which proves the
    // identical no-remount invariant (1 wizard mount, 0 router.replace) on both
    // wizards and is green at 19/19 in CI today. `jest.orch1355.render.cjs`
    // (wired by issue-1486-dormant-render-suites.yml) carries the rest.
    "orch1355\\.(tester|router)\\.test\\.tsx$",

    // ---- QUARANTINE_SAFE (16) — brittle source-text pins: readFileSync the
    // source then assert only on source-derived text (zero behavioral/render
    // assertions, classified by select-source-text-pins.mjs §4.1.1). They guard
    // nothing behavioral and rot on every refactor. Quarantined per #1047 (file
    // retained, not run); NOT deleted (append-only makes deletion absolute).
    "orch_0915_pay_in_full_choice\\.test\\.tsx$", // stale source-text pin — quarantined per #1047, file retained
    "orch_0911_confirm_loading_state\\.test\\.tsx$", // stale source-text pin (checkout confirm) — quarantined per #1047
    "orch_0911_trip_confirm_loading_state\\.test\\.tsx$", // stale source-text pin (trip confirm happy) — quarantined per #1047
    "public-trip-page\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained
    "desktopWebLayoutContracts\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained
    "PublicBrandPage\\.nextEventTeaser\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained
    "PublicBrandPage\\.orch_0962\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained
    "PublicBrandPage\\.orch_0964_smoke_rework\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained
    "PublicBrandPage\\.pastCap\\.adversarial\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained
    "PublicBrandPage\\.pinCtaCount\\.adversarial\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained
    "PublicBrandPage\\.tripBrand\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained
    "PublicBrandPage\\.ve4\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained
    "tr2RewordPolish\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained
    "createExperienceToolContract\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained
    "geminiActivitiesParser\\.contract\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained
    "orch_1092_business_web_restoration_wave\\.test\\.ts$", // stale source-text pin — quarantined per #1047, file retained

    // ---- INVARIANT_CONVERT (11) — each encoded a LOAD-BEARING rule; the rule is
    // now enforced by an ADDITIVE strict-grep gate in .github/scripts/strict-grep/
    // (registered in MANIFEST.json) that ACTUALLY RUNS in CI. The brittle jest pin
    // is quarantined ONLY because its invariant moved to a gate — enforcement is
    // continuous, never dropped.
    "metaOrch1255R2\\.bundleBudgetDeferral\\.happy\\.test\\.ts$", // invariant -> i-1047-biz-bundle-budget-deferral.mjs
    // moved: app/b/[brandSlug]/v/[venueSlug].tsx, packages/brand-rendering/PublicVenueScreen.tsx,
    //   src/components/event/CreatorStep5Tickets.tsx
    // dropped: packages/brand-rendering/PublicMenuSections.tsx — describe block R2-2 (module split) is
    //   dark; rule holds today, enforced by nothing. Unenforced gap recorded in #1850.
    // dropped: packages/brand-rendering/PublicBrandPage.tsx — R2-2 module split, same dark set as
    //   PublicMenuSections. Unenforced gap recorded in #1850.
    // dropped: src/components/venue/VenueDeckReadinessSetup.tsx — R2-4 (reservation-hook split) is dark;
    //   rule holds today, enforced by nothing. Unenforced gap recorded in #1850.
    // dropped: src/components/venue/VenueCreatorWizard.tsx — R2-4 reservation-hook split, dark.
    //   Unenforced gap recorded in #1850.
    // dropped: app/venue/deck-readiness.tsx — R2-4 reservation-hook split, dark. Recorded in #1850.
    // dropped: src/hooks/useBrandReservationSettingsList.ts — R2-4 reservation-hook split, dark.
    //   Unenforced gap recorded in #1850.
    // dropped: src/hooks/useVenueReservationSettings.ts — R2-4 reservation-hook split, dark.
    //   Unenforced gap recorded in #1850.
    // dropped: src/components/venue/VenueCardList.tsx — R2-4 reservation-hook split, dark.
    //   Unenforced gap recorded in #1850.
    // note: #1850 measured 19 assertions kept as 7. Every dark rule holds on the tree today; the loss
    //   is enforcement, not behaviour.
    "liveEventStore-v4-v5-migrator\\.test\\.ts$", // invariant -> i-1047-biz-liveeventstore-v5-drops-server-snapshot.mjs
    // moved: src/store/liveEventStore.ts
    // note: FILE fully covered, ASSERTIONS are not — 16 kept as 4. The legacy v1/v2/v3 branch
    //   preservation and the param-naming rules are inside the covered file and enforced by nothing.
    //   The gate's relax of `version: 5` to a monotonic `>= 5` is correct (the store is at 6). This is
    //   the residue class the ledger gate documents that it cannot see; recorded in #1850.
    "[/\\\\]rsvp[/\\\\].*preview\\.test\\.tsx$", // invariant -> i-1047-biz-rsvp-preview-no-ticket-renderer.mjs
    // moved: app/rsvp/[id]/preview.tsx
    // note: FILE fully covered, ASSERTIONS are not, badly — 29 kept as 4, roughly 24 dark. Only the
    //   negative "do not import the ticket renderer" rule survived; every positive-mount, migration,
    //   guard and UX-state rule inside that file is unguarded. Worst assertion-level residue of the 11;
    //   recorded in #1850 and outside what a file-level ledger can decide.
    "PaymentPlanEditor\\.test\\.ts$", // invariant -> i-1047-biz-payment-plan-editor-constraints.mjs
    // moved: src/components/trip/PaymentPlanEditor.tsx
    // dropped: app/trip/[id]/index.tsx — trip-detail installment surface unguarded after the hand-off.
    //   Unenforced gap recorded in #1850.
    // dropped: src/services/tripsService.ts — installment service contract unguarded. Recorded in #1850.
    // dropped: src/copy/installmentReassurance.ts — installment reassurance copy unguarded.
    //   Unenforced gap recorded in #1850.
    // dropped: src/components/trip/InstallmentScheduleDisplay.tsx — schedule display rules unguarded.
    //   Unenforced gap recorded in #1850.
    // dropped: src/hooks/useOrderInstallments.ts — React-Query cache-invalidation rules for the
    //   real-money retry flow are enforced by nothing. Unenforced gap recorded in #1850.
    // dropped: src/services/orderInstallmentsService.ts — the biz_retry_installment RPC contract
    //   (p_installment_id) is enforced by nothing. Unenforced gap recorded in #1850.
    // note: 53 assertions kept as 8, and the gate's own docstring calls what it dropped "brittle UI/copy
    //   pins". That characterisation is wrong: the dropped set is an RPC contract and cache-invalidation
    //   rules for a REAL-MONEY retry flow. Correcting that docstring is #1047's, per #1850 §S8.
    "orch_0893a_hydration_gate\\.test\\.ts$", // invariant -> i-1047-biz-create-hydration-gate.mjs
    // moved: app/event/create.tsx
    // dropped: app/event/[id]/edit.tsx — the whole live-merge half (10 assertions) is unrehomed; the
    //   gate covers create.tsx only. Unenforced gap recorded in #1850.
    // note: pin drift confirmed inside the COVERED file too — "Getting things ready" became
    //   "Loading local drafts…" (create.tsx), a deliberate copy change the quarantined pin never saw.
    "orch_1165_keyboard_toolbar_mount_coverage\\.test\\.ts$", // invariant -> i-1047-biz-keyboard-toolbar-keyed-offset.mjs
    // moved: app/_layout.tsx, src/components/ui/SheetMobile.tsx, src/components/ui/Modal.tsx,
    //   src/components/auth/BusinessWelcomeScreen.tsx, src/components/waitlist/JoinWaitlistSheet.tsx,
    //   src/components/groupChat/GroupChatPanel.tsx, src/components/support/SupportThread.native.tsx,
    //   src/components/brand/BrandPaystackOnboardView.tsx, src/screens/ari/AriChatScreen.tsx
    // dropped: src/components/marketing/ComposerV2/ComposerV2Editor.tsx — #2262 deleted the
    //   keyboard responsibility from this file entirely. The pinned expression was
    //   `keyboardHeight > 0 ? keyboardHeight + 42` (rule (B)), fed by a bespoke
    //   Keyboard.addListener that was ALSO permanently dead on web (RN-web's Keyboard is a
    //   no-op stub), so two of four surfaces had no compensation at all. Both are gone.
    //   SUCCESSORS, and the coverage is STRICTER than what it replaces:
    //     - the clearance itself -> app/(tabs)/marketing/campaigns/compose.tsx, a NEW target of
    //       the same gate under rule (D). It is deliberately NOT in the moved: line: the
    //       quarantined test never read that file, and padding moved: with a file nobody read is
    //       how the reconciliation subset gets faked. The gate covering MORE than the test did is
    //       allowed and is what happened here. The composer was PROMOTED
    //       from (B) ("if you hand-type a 42, at least gate it on keyboard-open") to (D)
    //       ("never type one — derive it from DONE_BAR_OCCUPIED"), which is the migration that
    //       gate's own header requires before (D) may be widened. The route reads
    //       DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE from wrappers/keyboardClearance and hands
    //       it to SmartKeyboardAvoidingView, whose offset is interpolated off
    //       keyboard.progress.value — so a permanent dead gap, which is what (B) existed to
    //       prevent, is impossible by construction rather than by a hand-rolled ternary.
    //     - the FILE -> i-2262-composer-measured-not-computed-layout.mjs, whose rule R4 forbids
    //       `Keyboard.addListener` in ComposerV2Editor.tsx outright, with or without an inline
    //       orch-0892 marker, and whose R1/R3 forbid the chrome constants that fed it.
    // dropped: app/checkout/[eventId]/buyer.tsx — ORCH-1252 (PR #701) migrated it to SmartScrollView and
    //   deleted the pinned expression on purpose; orch-0892-no-bespoke-keyboard-plumbing.mjs owns it now.
    // dropped: app/checkout-trip/[tripEventId]/buyer.tsx — ORCH-1252 migrated it to SmartScrollView;
    //   orch-0892-no-bespoke-keyboard-plumbing.mjs owns it now.
    // dropped: app/checkout-experience/[experienceEventId]/buyer.tsx — ORCH-1252 migrated it to
    //   SmartScrollView; orch-0892-no-bespoke-keyboard-plumbing.mjs owns it now.
    // dropped: app/checkout/[eventId]/payment.tsx — #1841 deleted the keyboard-OPEN branch after a
    //   closure probe found zero input-rendering modules on the route. NOT "nothing left to pin"
    //   (corrected after #1850 TEST P2-7): the test's second, keyboard-CLOSED assertion
    //   `paddingBottom: insets.bottom + 140` still matches verbatim at :635. It is deliberately not
    //   re-homed — with no +42 anywhere on the route the KEYBOARD invariant is genuinely gone, and
    //   what survives is a plain layout constant carrying no keyboard semantics.
    // dropped: app/checkout-trip/[tripEventId]/payment.tsx — same as above; #1841 deleted the
    //   keyboard-open branch (payment runs in Stripe PaymentSheet's own window, no focusable input
    //   on the route). The plan-aware closed branch `insets.bottom + (isPlanActive ? 260 : 140)`
    //   still matches at :664 and is deliberately not re-homed, for the same reason.
    // dropped: app/checkout-experience/[experienceEventId]/payment.tsx — same as above; #1841
    //   deleted the keyboard-open branch. The closed branch `insets.bottom + 140` still matches at
    //   :543 and is deliberately not re-homed, for the same reason.
    // dropped: app/checkout-trip/[tripEventId]/intake.tsx — #1841 migrated it to SmartScrollView, which
    //   deletes the pinned expression; orch-0892-no-bespoke-keyboard-plumbing.mjs owns it now.
    // note: measured by #1850, not estimated — 41 assertions over 17 files kept as 6. The header of the
    //   named gate said "~13 checkout paddings (some drifted)"; it omitted the entire ORCH-1170
    //   per-Modal-window provider block (8 assertions), now restored as that gate's rule (C). The drift
    //   is exactly 3 assertions, all on the three buyer screens, red since ORCH-1252 on 2026-07-01 —
    //   the PIN was wrong, not the code, and no live defect is attributable to it.
    "orch_0911_trip_confirm_loading_state\\.adversarial\\.test\\.tsx$", // invariant -> i-1047-biz-trip-confirm-hascs-url-only.mjs
    // moved: app/checkout-trip/[tripEventId]/confirm.tsx
    // note: FILE fully covered, ASSERTIONS are not — 16 kept as 2. Three of four groups (exact loading
    //   copy, the sessionStorage negative, and the no-dead-end-UI rule) are dark inside the covered
    //   file. All hold today. Recorded in #1850; outside what a file-level ledger can decide.
    "[/\\\\]home\\.orch_0974\\.test\\.tsx$", // invariant -> updated orch-0974-home-mobile-lock-pane.mjs
    // moved: app/(tabs)/home.tsx
    // dropped: src/components/home/UpcomingListItem.tsx — #2794 replaced Home Upcoming rows with
    //   RecentRow.tsx; orch-0974-home-mobile-lock-pane.mjs owns the successor EventCoverMedia contract
    // note: Home remains file-covered, ASSERTIONS are not — the pair of 0974 suites kept 61 assertions as 10.
    //   To-do toggle wiring, handleTodoAction exhaustiveness, six legacy-derivation negatives, the
    //   empty-state negatives, and three of four refresh keys remain dark inside Home. The retired
    //   UpcomingListItem internals are the explicit drop above. One direct contradiction is correctly won by the gate (hasActiveEvents was
    //   removed by #1616, so the test is stale there). Recorded in #1850.
    "[/\\\\]home\\.orch_0974\\.adversarial\\.test\\.tsx$", // invariant -> updated orch-0974-home-mobile-lock-pane.mjs
    // moved: app/(tabs)/home.tsx
    // dropped: src/components/home/UpcomingListItem.tsx — #2794 replaced Home Upcoming rows with
    //   RecentRow.tsx; orch-0974-home-mobile-lock-pane.mjs owns the successor EventCoverMedia contract
    // note: see the sibling entry above — Home stays covered; the retired row names its successor.
    "[/\\\\]venueAdsDrivenTile\\.issue865pr1\\.test\\.ts$", // invariant -> issue-1403-listing-insights-wiring.mjs
    // inverted -> DECOMMISSIONED. This is NOT a re-homing. #865's "Customers your ads drove" tile was
    //   removed, and issue-1403-listing-insights-wiring.mjs FAILS if that tile or useBrandConversionRollup
    //   is still PRESENT — the exact opposite of what the quarantined test required. The named gate
    //   belongs to an unrelated feature and enforces the decommission, not the invariant.
    // note: nothing of this test survives, and nothing should — the feature is gone. Recorded in #1850
    //   because an arrow that reads as a hand-off while pointing at a 180-degree reversal is worse than
    //   no arrow at all.
    "[/\\\\]venueIntelligence\\.noFabrication\\.test\\.ts$", // invariant -> issue-1421-venue-organic-insights-wiring.mjs
    // inverted -> DECOMMISSIONED for the surface rules. issue-1421-venue-organic-insights-wiring.mjs
    //   FAILS if "COMING SOON", "Busy hours" or "Signal to bookings" are PRESENT; the quarantined test
    //   required them present. #1421 removed the feature, so the gate is right and the arrow is not a
    //   hand-off.
    // dropped: src/components/venue/venueIntelligence.ts — NO SUCCESSOR GATE. Corrected after #1850
    //   TEST P2-8: this helper owns ONLY the INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS = 14 threshold
    //   anchor (:15). It contains zero formatCurrencyRound and zero Intl.NumberFormat — the money
    //   rules were attributed here in error. The anchor still holds and is enforced by nothing.
    //   Live unenforced gap, owned by whoever owns #1421's area; recorded in #1850 §S8 for routing.
    // note: SECOND GAP, and it is invisible to this gate by construction. The Constitution-#9
    //   no-fabrication MONEY rules (formatCurrencyRound only, Intl.NumberFormat banned) assert on
    //   VenueIntelligenceModule.tsx (3x formatCurrencyRound), not on the helper. That file is NOT
    //   dropped and needs no drop line: it satisfies the subset rule because
    //   issue-1421-venue-organic-insights-wiring.mjs reads it — but only for the DECOMMISSION rules.
    //   So the money rules INSIDE it are enforced by nothing while this ledger reads as covered.
    //   That is exactly the file-level limitation stated in
    //   issue-1850-quarantine-invariant-handoff-complete.mjs, biting live. Same owner as above.
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  // #1062 [biz-jest-residual-burndown] Wave 1 — B3a shared-harness (fix-once-
  // clears-many). node-env unit tests transitively import ESM-native packages and
  // an RN-eager workspace barrel that cannot load under this default node/ts-jest
  // config. Each map below redirects ONLY the exact native/ESM boundary to a
  // lightweight manual mock (in ./__manual_mocks__/) or the package's own shipped
  // jest mock — NEVER a src/** module, so real product logic is still executed and
  // no assertion is masked (verified by the mandatory full-suite no-green-regression
  // run, SPEC SC-8). Anchored (^…$) so only the bare specifier maps — react-native-*
  // / react-dom / @mingla/* siblings are untouched. A test's own jest.mock()
  // overrides any map for that file.
  moduleNameMapper: {
    // react is unresolvable FROM workspace packages/*.tsx in CI because the
    // Business install owns the peer dependency. Point the bare specifier at
    // that one real copy, matching the JSX-runtime repair immediately below.
    "^react$": "<rootDir>/node_modules/react",
    // react/jsx-runtime is unresolvable FROM packages/*.tsx (no react in packages/;
    // mingla-business owns the one real copy). Point both automatic-runtime entries
    // at the REAL react — this is resolution repair, not a mock (zero faking). Fixes
    // the phone-input WebOverlayPortal.web unit-under-test (orch1300) directly.
    "^react/jsx-runtime$": "<rootDir>/node_modules/react/jsx-runtime.js",
    "^react/jsx-dev-runtime$": "<rootDir>/node_modules/react/jsx-dev-runtime.js",
    // react-dom is likewise unresolvable FROM packages/*.tsx (phone-input's
    // WebOverlayPortal.web imports `createPortal`). Point the bare specifier at the
    // REAL react-dom mingla-business owns — resolution repair; the orch1300 suite
    // still jest.mock()s react-dom itself (which now resolves so it can be replaced).
    "^react-dom$": "<rootDir>/node_modules/react-dom",
    // react-native: Flow-ESM entry unparseable under node/ts-jest — map the bare
    // specifier to the lightweight manual mock (see __manual_mocks__/react-native.js
    // for the safety argument). Anchored so react-native-* siblings are untouched.
    "^react-native$": "<rootDir>/__manual_mocks__/react-native.js",
    // #2211 — the refund-attention route now reaches the canonical native
    // SmartScrollView wrapper. Its implementation correctly imports
    // react-native-keyboard-controller, whose package entry is ESM and cannot
    // be parsed by this default node/ts-jest runner. Use the library's shipped
    // Jest boundary mock so existing route suites keep executing real route
    // logic without loading a native binary or weakening node_modules
    // transforms globally. Dedicated RN render configs may still override this
    // mapping, and an inline jest.mock() remains authoritative per suite.
    "^react-native-keyboard-controller$":
      "<rootDir>/node_modules/react-native-keyboard-controller/jest",
    // The @mingla/offering-rendering barrel eagerly re-exports RN component .tsx —
    // map to a mock that re-exports the REAL pure helpers + stubs the components.
    "^@mingla/offering-rendering$": "<rootDir>/__manual_mocks__/offering-rendering.js",
    // #1559 — resolution repair, NOT a mock. `node_modules/@mingla/*` is a
    // workspace symlink; inside a git worktree it points at the ANCHOR
    // checkout, so a DEEP `@mingla/brand-rendering/<sub>` specifier resolved
    // the anchor's copy of the file — i.e. a worktree run silently tested
    // somebody else's branch, or failed outright on a module the anchor has not
    // pulled yet. This maps the subpath form to THIS tree. In CI the symlink
    // already points here, so the mapping is the identity. Anchored to the
    // subpath form only: the bare barrel is untouched.
    "^@mingla/brand-rendering/(.+)$": "<rootDir>/../packages/brand-rendering/$1",
    // #1773 — resolution repair, NOT a mock. The phone owner is deliberately a
    // real `.mjs` ESM module for Supabase's hosted ESZip bundler. Metro resolves
    // the workspace symlink, while this node/ts-jest runner must stay on this
    // worktree instead of following the anchor checkout's package symlink.
    "^@mingla/card-identity/phone\\.mjs$":
      "<rootDir>/../packages/card-identity/phone.mjs",
    // #1615 — resolution repair, NOT a mock. The real consumer route mounted
    // by the Business suite imports this workspace package, while CI installs
    // only Business dependencies. Resolve the bare package to this checkout so
    // the eight route tests execute real sharing logic, never the anchor symlink.
    "^@mingla/sharing$": "<rootDir>/../packages/sharing/index.js",
    // #1615 — resolution repair, NOT a mock. The real consumer venue route now
    // reaches the content-share adapter and its Supabase client. This default
    // suite installs Business dependencies only, so resolve the bare package to
    // the identical real version Business already owns.
    "^@supabase/supabase-js$": "<rootDir>/node_modules/@supabase/supabase-js",
    // #2755 — the Consumer venue route now reaches its real native-only
    // reportNonFatal adapter. CI intentionally installs Business dependencies
    // only, so resolving the adapter's @sentry/react-native import from
    // app-mobile fails before the cross-app adoption suite can mount the route.
    // Replace only that native SDK leaf with the existing platform-neutral
    // Business Sentry boundary, matching the dedicated #1834/#1863 render
    // configs. The Consumer adapter and its once-per-error call site still run;
    // production Metro remains on the real @sentry/react-native SDK because
    // this mapping exists only in the node/ts-jest configuration.
    "^@sentry/react-native$": "<rootDir>/src/diagnostics/sentry.ts",
    // #1560 — resolution repair, NOT a mock, and the IDENTITY for every file in
    // this app. `consumerVenueAdoption.issue1560.happy.test.tsx` mounts the REAL
    // consumer venue route (`app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx`) to
    // prove what the consumer app gained when its fork was deleted. Node
    // resolution walks up from THAT file, so these two specifiers resolve
    // `app-mobile/node_modules/...` — which CI never installs (this job runs
    // `npm ci` in mingla-business only). Two consequences, both bad: the route
    // cannot load at all, and a bare `jest.mock("expo-router")` in a test here
    // would register a DIFFERENT resolved path from the one the route requires,
    // so the mock would silently not apply. Pointing both at the copies this app
    // already owns makes the two resolutions converge. A business file's
    // `expo-router` already resolved here (nearest node_modules), so nothing
    // about the existing suite changes.
    "^expo-router$": "<rootDir>/node_modules/expo-router",
    "^expo-router/(.*)$": "<rootDir>/node_modules/expo-router/$1",
    // #2211 — InviteScreenShell is now the real safe-area owner for invitation
    // routes. The package entry eagerly loads React Native codegen, which a
    // default node/ts-jest suite cannot parse. Map only this native boundary to
    // a zero-inset structural mock; route/component logic remains real, and an
    // inline jest.mock() still overrides it for suites that assert custom
    // insets. This also gives cross-app tests one stable resolvable target.
    "^react-native-safe-area-context$":
      "<rootDir>/__manual_mocks__/react-native-safe-area-context.js",
    // ESM-native expo packages (reached via expo-image-picker / expo-file-system /
    // mapboxToken / config reads).
    "^expo-constants$": "<rootDir>/__manual_mocks__/expo-constants.js",
    "^expo-modules-core$": "<rootDir>/__manual_mocks__/expo-modules-core.js",
    // react-native (Flow ESM entry) is pulled only via async-storage in the node
    // chains here — map async-storage to ITS OWN shipped jest mock so react-native
    // is never reached (narrower + safer than a blanket react-native mock).
    "^@react-native-async-storage/async-storage$":
      "<rootDir>/node_modules/@react-native-async-storage/async-storage/jest/async-storage-mock.js",
    // @react-native-google-signin ships ESM (`export { … }`) — pulled transitively
    // via AuthContext; map to a lightweight stub so the auth-context chain loads.
    "^@react-native-google-signin/google-signin$":
      "<rootDir>/__manual_mocks__/google-signin.js",
    // expo-apple-authentication ships ESM (`export * from …`) — also pulled via
    // AuthContext; stub so the auth-context chain loads under node.
    "^expo-apple-authentication$":
      "<rootDir>/__manual_mocks__/expo-apple-authentication.js",
  },
  transform: {
    // ORCH-1147 — `jsx: "react-jsx"` (was "react-native", which PRESERVES JSX
    // and makes node/ts-jest choke on any runtime import of a JSX-bearing .tsx —
    // e.g. importing `useCartTotals` from CartContext.tsx). The automatic JSX
    // runtime transpiles `<X/>` to `_jsx(...)` so node-env unit tests can import
    // hook logic from a .tsx module. Jest-only; the app build is Metro/babel and
    // is unaffected. The existing carousel .tsx tests read source as TEXT
    // (readFileSync), so they are unaffected; the RTL render tests run under
    // their own dedicated configs (ignored here).
    //
    // #1047 [business-jest-suite-audit] Part 2.2 — cross-package ts-jest
    // resolution. A business test that transitively imports a workspace-package
    // .tsx (e.g. packages/offering-rendering/ParallaxCoverShell.tsx,
    // packages/phone-input/WebOverlayPortal.web.tsx) made business ts-jest
    // TYPE-CHECK that package file with business module-resolution, which cannot
    // resolve `react`/JSX types for a file OUTSIDE mingla-business/ (TS2307 →
    // cascade of TS7031/TS2875). Those packages are never typechecked in CI and
    // ship fine via Metro/babel, so `diagnostics.exclude` turns off TYPE-CHECKING
    // for **/packages/** ONLY (the file is still transpiled + executed). This is
    // path-scoped and order-independent — it does NOT touch mingla-business/**/src
    // diagnostics: the real product-source type errors (adapters.ts,
    // eventCoverVideoProcessingService.ts, platformImagePicker.native.ts) + the
    // stale-test compile errors STILL surface (SPEC §4.2.2 hard constraint / §4.5
    // burn-down). DO NOT broaden this glob to src/** — that would mask real drift.
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: { jsx: "react-jsx" },
        // #1560 — `**/app-mobile/**` joins for the IDENTICAL reason, one app
        // over. `consumerVenueAdoption.issue1560.happy.test.tsx` mounts the real
        // consumer venue route to prove what that app gained when its fork was
        // deleted, so ts-jest transpiles an app-mobile .tsx — and type-CHECKED
        // it with THIS app's module resolution, which cannot see app-mobile's
        // peers: TS2307 for `react` / `expo-router` /
        // `react-native-safe-area-context` plus the TS2875 JSX-runtime cascade.
        // ts-jest raises that as a throw whose `message` is EMPTY, so CI printed
        // a `●` heading over five blank lines. app-mobile has its own `npx tsc`
        // gate and is never typechecked by this job, exactly like packages/**.
        // The file is still transpiled and EXECUTED — only type-checking is off.
        // DO NOT broaden either glob to src/** — that would mask real drift.
        diagnostics: { exclude: ["**/packages/**", "**/app-mobile/**"] },
      },
    ],
    // #1773 — execute the real hosted-compatible ESM owner in Jest's CJS
    // runtime. Babel changes module syntax only; the phone implementation and
    // assertions run unchanged.
    "^.+\\.mjs$": ["babel-jest", { presets: ["babel-preset-expo"] }],
    // ORCH-1137 (rework) — the biz-web lucide shim deep-requires per-icon ESM
    // modules from `lucide-react/dist/esm/icons/<kebab>.js` (the tree-shakeable
    // import form that keeps the eager web `__common` chunk under the ORCH-1083
    // budget). Those modules use ESM `export` syntax; jest-runtime cannot load
    // them as bare CJS, so transpile lucide-react's `.js` to CJS via babel-jest
    // (babel-preset-expo is already a dep). Scope is narrow: only lucide-react.
    "lucide-react/.+\\.js$": ["babel-jest", { presets: ["babel-preset-expo"] }],
  },
  // ORCH-1137 (rework) — by default jest ignores ALL of node_modules for
  // transforms; un-ignore lucide-react so the `.js` transform above runs on it.
  transformIgnorePatterns: ["/node_modules/(?!lucide-react/)"],
};
