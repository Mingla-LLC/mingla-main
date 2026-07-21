// #1036 [remove-contrast-chip] — tester adversarial WEB render-proof config.
//
// DIFFERENT ANGLE from the implementor's source-grep suite
// (issue_1036_contrast_apparatus_removed.test.ts, which readFileSync's the
// module and asserts specific strings/identifiers are absent). This config
// mounts the REAL ThemeSheet through react-native-web via ReactDOMServer and
// asserts, across a SWEEP of colour seeds (including the exact low-contrast
// Ocean #2563eb that previously surfaced "Nudge to AA -> 3.7:1"), that the
// rendered colour-tab tree carries NO contrast-advisory node — no ratio badge,
// no "Nudge"/"Crisp"/"Contrast"/"readable" text — while the real picker
// controls (preview band, hex field, Done) still render.
//
// TRANSFORM: ts-jest (the repo's default transform — already installed), NOT
// babel-preset-expo. The worktree's node_modules is symlinked to the anchor,
// which does not carry babel-preset-expo, so the babel-jest render configs
// (jest.orch1193.* et al.) cannot run here. ts-jest transforms the .ts/.tsx
// under test; react-native-web ships a CJS build (dist/cjs) that node requires
// directly, so no node_modules transform is needed and the heavy native leaves
// are jest.mock'd inside the test file.
//
// Run:
//   npx jest --config jest.issue1036.render.cjs --runInBand

const path = require("path");

const businessRoot = __dirname;

module.exports = {
  rootDir: businessRoot,
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: [
    "**/__tests__/issue1036NoContrastNode.web.render.test.tsx",
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  transform: {
    // isolatedModules: transpile only (no type diagnostics) — matches how the
    // babel render configs never type-check; react-dom/server ships no .d.ts.
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      { isolatedModules: true, tsconfig: { jsx: "react-jsx", esModuleInterop: true } },
    ],
  },
  moduleNameMapper: {
    // Render the deployed business WEB target's components.
    "^react-native$": "react-native-web",
  },
};
