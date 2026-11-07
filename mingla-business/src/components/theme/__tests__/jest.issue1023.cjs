// issue #1023 — theme entrance motion suites (wave 1) and the Google font /
// gradient suites (wave 2): the default business config
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
    // issue #1023 wave 2 — Google fonts, gradients, #1024.
    "**/src/components/theme/__tests__/issue_1023_font_value_shape_parity.implementor.test.ts",
    "**/src/components/theme/__tests__/issue_1023_theme_resolver_gradient.implementor.test.ts",
    "**/src/components/theme/__tests__/issue_1023_google_font_loader.implementor.test.ts",
    "**/src/components/theme/__tests__/issue_1023_theme_accent_fill.implementor.test.tsx",
    "**/src/components/theme/__tests__/issue_1023_theme_sheet_pickers.implementor.test.tsx",
    "**/src/components/theme/__tests__/issue_1023_offering_theme_columns.implementor.test.ts",
    "**/src/components/theme/__tests__/issue_1023_catalogue_lazy.implementor.test.ts",
  ],
};
