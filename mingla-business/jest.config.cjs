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
    "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
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
