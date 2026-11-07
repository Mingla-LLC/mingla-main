// issue #1023 — theme entrance motion suites: the default business config
// (node + ts-jest), narrowed to this issue's files. Each suite mocks the
// Lottie players itself (virtual mocks), so they also pass in the full suite.
const path = require("path");
const base = require("../../../../jest.config.cjs");

module.exports = {
  ...base,
  rootDir: path.resolve(__dirname, "../../../.."),
  testMatch: [
    "**/src/components/theme/__tests__/issue_1023_theme_motion_files.implementor.test.ts",
    "**/src/components/theme/__tests__/issue_1023_theme_entrance_native.implementor.test.tsx",
    "**/src/components/theme/__tests__/issue_1023_theme_entrance_web.implementor.test.tsx",
    "**/src/components/theme/__tests__/issue_1023_theme_entrance_web_chunk_failure.implementor.test.tsx",
    "**/src/components/theme/__tests__/issue_1023_motion_metro_resolver.implementor.test.ts",
    "**/src/dev/__tests__/issue_1023_motion_deep_link.implementor.test.ts",
    "**/src/components/theme/__tests__/issue_1023_event_theme_precedence.implementor.test.ts",
  ],
};
