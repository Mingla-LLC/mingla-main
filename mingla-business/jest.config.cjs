module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  // ORCH-1118 — the EditPublishedTripScreen render-proof runs a REAL
  // react-native-testing-library mount and therefore needs the dedicated
  // `jest.orch1118.render.cjs` config (RN preset + the .orch1118-testdeps
  // overlay). It MUST NOT run under this default node/ts-jest config (no RTL
  // installed here). See EditPublishedTripScreen.render.README.md.
  testPathIgnorePatterns: [
    "/node_modules/",
    "EditPublishedTripScreen\\.render\\.test\\.tsx$",
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: { jsx: "react-native" } }],
  },
};
