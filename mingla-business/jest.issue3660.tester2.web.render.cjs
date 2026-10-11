// #3660 tester2 render-proof config — mounts the REAL Host delete-account route
// (`app/account/delete.tsx`) through react-native-web with react-test-renderer.
// The default `jest.config.cjs` ignores every `*.render.test.tsx`, so this suite
// only runs through this config. Same shape as `jest.issue2726.web.render.cjs`.
const path = require("path");

const businessRoot = __dirname;

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
  testMatch: [
    "**/__tests__/issue_3660_delete_route_states.tester2.web.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|expo|@expo)",
  ],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
  },
  haste: {
    defaultPlatform: "web",
    platforms: ["web"],
  },
};
