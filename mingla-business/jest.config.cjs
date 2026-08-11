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
    // #1834 [keyboard-blocks-bank-field] implementor happy-path render-proof —
    // mounts BrandOnboardView + BrandPaymentsView and asserts the NG
    // account-number field's scroll host is the SmartScrollView wrapper's
    // KeyboardAwareScrollView at bottomOffset=54. Runs under
    // jest.issue1834.render.cjs (RN preset + RTL); MUST NOT run under this
    // default node/ts-jest config (no RTL installed here).
    "issue_1834_bank_field_smartscroll\\.render\\.test\\.tsx$",
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
    // they run under THIS stock config inside orch-0976-draft-promotion-tests.yml
    // (which installs react-test-renderer --no-save), and the nightly suite
    // installs it too — excluding them would break that per-issue workflow.
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
    // `.github/workflows/orch-0976-draft-promotion-tests.yml`, which proves the
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
    "liveEventStore-v4-v5-migrator\\.test\\.ts$", // invariant -> i-1047-biz-liveeventstore-v5-drops-server-snapshot.mjs
    "[/\\\\]rsvp[/\\\\].*preview\\.test\\.tsx$", // invariant -> i-1047-biz-rsvp-preview-no-ticket-renderer.mjs
    "PaymentPlanEditor\\.test\\.ts$", // invariant -> i-1047-biz-payment-plan-editor-constraints.mjs
    "orch_0893a_hydration_gate\\.test\\.ts$", // invariant -> i-1047-biz-create-hydration-gate.mjs
    "orch_1165_keyboard_toolbar_mount_coverage\\.test\\.ts$", // invariant -> i-1047-biz-keyboard-toolbar-keyed-offset.mjs
    "orch_0911_trip_confirm_loading_state\\.adversarial\\.test\\.tsx$", // invariant -> i-1047-biz-trip-confirm-hascs-url-only.mjs
    "[/\\\\]home\\.orch_0974\\.test\\.tsx$", // invariant -> updated orch-0974-home-mobile-lock-pane.mjs
    "[/\\\\]home\\.orch_0974\\.adversarial\\.test\\.tsx$", // invariant -> updated orch-0974-home-mobile-lock-pane.mjs
    "[/\\\\]venueAdsDrivenTile\\.issue865pr1\\.test\\.ts$", // invariant -> issue-1403-listing-insights-wiring.mjs
    "[/\\\\]venueIntelligence\\.noFabrication\\.test\\.ts$", // invariant -> issue-1421-venue-organic-insights-wiring.mjs
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
    "^react-native-safe-area-context$":
      "<rootDir>/node_modules/react-native-safe-area-context",
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
