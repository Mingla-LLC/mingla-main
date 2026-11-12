const path = require("path");

const businessRoot = path.resolve(__dirname, "../../../..");
const modules = path.join(businessRoot, "node_modules");

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
    "**/src/components/door/__tests__/issue_4271_door_pay_screen.render.test.tsx",
    "**/src/components/door/__tests__/issue_4271_door_sale_surfaces.render.test.tsx",
    "**/src/components/door/__tests__/issue_4271_apple_surfaces.render.test.tsx",
    "**/src/components/orders/__tests__/issue_4271_refund_reason.render.test.tsx",
    // #4271 door polish tester adversarial (rendered money controls).
    "**/src/components/door/__tests__/issue_4271_door_polish_money.tester.adversarial.render.test.tsx",
    // #4271 door polish retest: the pay code screen and VoiceOver.
    "**/src/components/door/__tests__/issue_4271_door_polish_retest.tester.adversarial.test.tsx",
    // #4271 Tap to Pay on iPhone review gaps (awareness role, full name, Get help, Settings icon).
    // #4389 also: the awareness splash auto-shows only on Home with setup complete.
    "**/src/components/door/__tests__/issue_4271_review_gaps.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|react-native-reanimated|react-native-svg)",
  ],
  // packages/phone-input lives outside this app; its imports resolve here.
  modulePaths: [modules],
  moduleNameMapper: {
    "^react$": path.join(modules, "react"),
    "^react/(.*)$": path.join(modules, "react", "$1"),
    "^react-native$": path.join(modules, "react-native"),
    "^react-test-renderer$": path.join(modules, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(modules, "react-test-renderer", "$1"),
    // #4389 — door sheets scroll in SheetScrollLayout (SmartScrollView); the
    // library's own jest mock stands in for the native module (as #1532).
    "^react-native-keyboard-controller$": path.join(modules, "react-native-keyboard-controller", "jest"),
    // The keyboard height hook's native half needs Reanimated's native
    // worklets; its platform-neutral half (0, no keyboard) stands in here.
    "^(\\.\\./)+wrappers/useKeyboardHeight$": path.join(businessRoot, "src", "wrappers", "useKeyboardHeight.ts"),
  },
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
