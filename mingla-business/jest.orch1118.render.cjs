// ORCH-1118 render-proof — worktree-local jest config (NOT committed).
//
// Stands up a REAL react-native-testing-library mount of the production
// EditPublishedTripScreen so the swapped MapboxAddressInput pickers + the save
// gate are proven to FIRE at runtime (kills the dead-tap / conditional-unmount
// class). Uses the RN jest preset (babel-jest transform of the RN tree) + the
// worktree-local .orch1118-testdeps overlay for react-test-renderer + RTL, with
// react / react-native pinned to the business install (single-copy).
//
// This config + its babel sibling are intentionally uncommitted infra; ONLY the
// test file (src/components/trip/__tests__/EditPublishedTripScreen.render.test.tsx)
// is committed to the branch.

const path = require("path");

const businessRoot = __dirname;
const overlay = path.join(businessRoot, ".orch1118-testdeps", "node_modules");
const bizModules = path.join(businessRoot, "node_modules");

module.exports = {
  rootDir: businessRoot,
  preset: "react-native",
  // Pin the babel config to the worktree-local one (RN preset uses babel-jest).
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/EditPublishedTripScreen.render.test.tsx",
  ],
  // Transform the RN + RTL + overlay packages (they ship untranspiled flow/TS).
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom)",
  ],
  moduleNameMapper: {
    // Workspace alias used by the REAL MapboxAddressInput wrapper.
    "^@mingla/location-input$": path.join(
      businessRoot,
      "..",
      "packages",
      "location-input",
      "index.ts",
    ),
    "^@mingla/location-input/(.*)$": path.join(
      businessRoot,
      "..",
      "packages",
      "location-input",
      "$1",
    ),
    // Single-copy react + react-native: force the business install so the
    // production screen and the renderer share one React.
    "^react$": path.join(bizModules, "react"),
    "^react/(.*)$": path.join(bizModules, "react", "$1"),
    "^react-native$": path.join(bizModules, "react-native"),
    // Renderer + RTL come from the overlay only.
    "^react-test-renderer$": path.join(overlay, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(overlay, "react-test-renderer", "$1"),
    "^@testing-library/react-native$": path.join(
      overlay,
      "@testing-library",
      "react-native",
    ),
    "^@testing-library/react-native/(.*)$": path.join(
      overlay,
      "@testing-library",
      "react-native",
      "$1",
    ),
  },
  // Resolve test deps from the overlay first, then the business install.
  modulePaths: [overlay, bizModules],
  setupFilesAfterEnv: [
    path.join(
      overlay,
      "@testing-library",
      "react-native",
      "dist",
      "matchers",
      "extend-expect.js",
    ),
  ],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
