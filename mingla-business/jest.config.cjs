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
  },
};
