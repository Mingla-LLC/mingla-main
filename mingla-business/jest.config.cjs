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
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: { jsx: "react-native" } }],
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
