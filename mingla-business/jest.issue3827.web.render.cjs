// #3827 — typing on the Host website never drops letters (Sentry
// MINGLA-BUSINESS-22, "Maximum update depth exceeded").
//
// Mounts the REAL Edit brand view and the REAL event creator wizard through
// react-native-web on a CONCURRENT react-test-renderer root, and types 120
// characters back to back. Each keystroke is delivered through the renderer's
// `unstable_flushSync`, which is how a browser input event reaches React: a
// discrete, synchronous update with its passive effects flushed before the
// next keystroke. On the broken code a second update chained onto every
// keystroke, React's nested-update counter passed 50, and the 51st keystroke
// threw and was lost.
//
// The default `jest.config.cjs` maps `react-native` to a lightweight mock, so
// react-native-web's Image (whose load effect is half of the bug) never runs
// there. Hence this dedicated config.
//
// Worktree trap: `node_modules` (and its `@mingla/*` workspace links) may be a
// link to the anchor checkout. Every workspace package this suite executes is
// mapped to THIS tree, so a worktree run tests this branch's code.
//
// Run (from mingla-business/):
//   npx jest --config jest.issue3827.web.render.cjs --runInBand --ci
const path = require("path");

const businessRoot = __dirname;
const packagesRoot = path.join(businessRoot, "..", "packages");

module.exports = {
  rootDir: businessRoot,
  testEnvironment: "node",
  globals: { __DEV__: true },
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: ["**/__tests__/issue_3827_*.web.render.test.tsx"],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|expo|@expo)",
  ],
  // Files under packages/** have no node_modules of their own; let their bare
  // imports (@babel/runtime helpers, expo-*, react-native-svg) fall back to
  // this app's dependencies, exactly as Metro resolves them.
  modulePaths: ["<rootDir>/node_modules"],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
    // One React for the whole graph, whichever directory imports it.
    "^react$": "<rootDir>/node_modules/react",
    "^react/jsx-runtime$": "<rootDir>/node_modules/react/jsx-runtime.js",
    "^react/jsx-dev-runtime$": "<rootDir>/node_modules/react/jsx-dev-runtime.js",
    "^@mingla/offering-rendering/(.+)$": path.join(packagesRoot, "offering-rendering", "$1"),
  },
  haste: {
    defaultPlatform: "web",
    platforms: ["web"],
  },
};
