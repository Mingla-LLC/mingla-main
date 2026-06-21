// ORCH-1190 R2 — BrandSwitch WEB render-proof config.
//
// Renders the REAL BrandSwitch through react-native-web (the deployed business
// web target) via ReactDOMServer, so we can assert the rendered inline colors of
// the ON-state thumb/track — the prod web bug that the native (`ios`-platform)
// render configs structurally cannot catch.
//
// `react-native` is aliased to `react-native-web` (both already hoisted into
// mingla-business/node_modules, gitignored, never in the diff). If a fresh
// worktree lacks them: cd mingla-business && npm i react-native-web react-dom
//
// Run:
//   npx jest --config jest.orch1190r2.web.render.cjs --runInBand

const path = require("path");

const businessRoot = __dirname;

module.exports = {
  rootDir: businessRoot,
  testEnvironment: "node",
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/brandSwitch.orch1190r2.web.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community)",
  ],
  moduleNameMapper: {
    // Render the WEB Switch (the deployed business web build's component).
    "^react-native$": "react-native-web",
  },
};
