// ORCH-1147R2 tester-owned ADVERSARIAL render-proof — worktree-local jest
// config (NOT committed; gitignored infra). Mirrors the ORCH-1118/1122
// render-proof pattern: RN jest preset + babel transform + react-test-renderer
// + @testing-library/react-native, react/react-native pinned to the business
// install (single-copy React).
//
// Unlike the implementor's math+source-text test, this MOUNTS the real
// business-app QuantityRow (→ the shared @mingla/offering-rendering row) and the
// exact bottom-bar JSX from the three checkout index.tsx screens, then asserts
// the RENDERED TEXT shows the all-in (the R1 blind spot: the screen could not
// be rendered, so the selection-display bug shipped unseen).
//
// Provision deps once per worktree (they hoist into mingla-business/node_modules):
//   cd .orch1118-testdeps && npm i react-test-renderer@19.1.0 \
//     @testing-library/react-native@^13 --legacy-peer-deps
//
// Run:
//   npx jest --config jest.orch1147r2.render.cjs --runInBand

const fs = require("fs");
const path = require("path");

const businessRoot = __dirname;
const bizModules = path.join(businessRoot, "node_modules");

const rtlRoot = path.join(bizModules, "@testing-library", "react-native");
const matchersBuild = path.join(rtlRoot, "build", "matchers", "extend-expect.js");
const matchersDist = path.join(rtlRoot, "dist", "matchers", "extend-expect.js");
const extendExpect = fs.existsSync(matchersBuild) ? matchersBuild : matchersDist;

module.exports = {
  rootDir: businessRoot,
  preset: "react-native",
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/orch_1147r2_selection_allin.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom)",
  ],
  moduleNameMapper: {
    // The real barrel index.ts pulls in PublicEventPage → expo-blur →
    // expo-modules-core, which crashes under jest (no native runtime). The
    // QuantityRow under test lives in its own module with no such deps, so we
    // map the bare specifier straight to the QuantityRow source file. This is
    // the SAME real component the wrapper renders — only the unrelated barrel
    // siblings are bypassed.
    "^@mingla/offering-rendering$": path.join(
      businessRoot,
      "..",
      "packages",
      "offering-rendering",
      "QuantityRow.tsx",
    ),
    "^@mingla/offering-rendering/(.*)$": path.join(
      businessRoot,
      "..",
      "packages",
      "offering-rendering",
      "$1",
    ),
    // expo-haptics has no native side under jest; stub selectionAsync.
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
    // expo-blur (BlurView) needs expo-modules-core's native EventEmitter, which
    // is absent under jest. The blur is pure chrome — irrelevant to the price
    // text under test — so stub it to a passthrough View.
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    "^react$": path.join(bizModules, "react"),
    "^react/(.*)$": path.join(bizModules, "react", "$1"),
    "^react-native$": path.join(bizModules, "react-native"),
    "^react-test-renderer$": path.join(bizModules, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(
      bizModules,
      "react-test-renderer",
      "$1",
    ),
    "^@testing-library/react-native$": rtlRoot,
    "^@testing-library/react-native/(.*)$": path.join(rtlRoot, "$1"),
  },
  modulePaths: [bizModules],
  setupFilesAfterEnv: [extendExpect],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
