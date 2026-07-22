module.exports = {
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
    // #1036 [remove-contrast-chip] tester adversarial WEB render-proof — mounts
    // the REAL ThemeSheet through react-native-web (ReactDOMServer) to assert no
    // contrast-advisory node renders for any seed. Runs under
    // jest.issue1036.render.cjs (react-native->react-native-web alias); MUST NOT
    // run under this default node/ts-jest config (no web alias / react-dom).
    "issue1036NoContrastNode\\.web\\.render\\.test\\.tsx$",

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
    // they run under THIS stock config inside orch-0976-draft-promotion-tests.yml
    // (which installs react-test-renderer --no-save), and the nightly suite
    // installs it too — excluding them would break that per-issue workflow.
    "\\.render\\.test\\.tsx$", // every web + RN render-proof (subsumes the explicit render entries above)
    "orch1355\\.(tester|router)\\.test\\.tsx$", // orch1355 promotion tester/router render-proofs — run under jest.orch1355.tester.cjs / .promotion.cjs

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

    // ---- INVARIANT_CONVERT (7) — each encoded a LOAD-BEARING rule; the rule is
    // now enforced by an ADDITIVE strict-grep gate in .github/scripts/strict-grep/
    // (registered in MANIFEST.json) that ACTUALLY RUNS in CI. The brittle jest pin
    // is quarantined ONLY because its invariant moved to a gate — enforcement is
    // continuous, never dropped.
    "metaOrch1255R2\\.bundleBudgetDeferral\\.happy\\.test\\.ts$", // invariant -> i-1047-biz-bundle-budget-deferral.mjs
    "liveEventStore-v4-v5-migrator\\.test\\.ts$", // invariant -> i-1047-biz-liveeventstore-v5-drops-server-snapshot.mjs
    "[/\\\\]rsvp[/\\\\].*preview\\.test\\.tsx$", // invariant -> i-1047-biz-rsvp-preview-no-ticket-renderer.mjs
    "PaymentPlanEditor\\.test\\.ts$", // invariant -> i-1047-biz-payment-plan-editor-constraints.mjs
    "orch_0893a_hydration_gate\\.test\\.ts$", // invariant -> i-1047-biz-create-hydration-gate.mjs
    "orch_1165_keyboard_toolbar_mount_coverage\\.test\\.ts$", // invariant -> i-1047-biz-keyboard-toolbar-keyed-offset.mjs
    "orch_0911_trip_confirm_loading_state\\.adversarial\\.test\\.tsx$", // invariant -> i-1047-biz-trip-confirm-hascs-url-only.mjs
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
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
        diagnostics: { exclude: ["**/packages/**"] },
      },
    ],
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
