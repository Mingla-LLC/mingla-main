// #2323 + #2326 — render-proof jest config (react-test-renderer).
//
// Copied from `jest.issue2262.render.cjs`, changing only `testMatch` and the
// comment. Same RN preset, same `jest.orch1118.babel.cjs` transform, same
// boundary stubs — and, critically, the SAME reason for existing: these two
// suites MOUNT real components (`DownloadMinglaCta` -> Pressable/Text/View,
// and a probe around `useAttendanceClaimArm`), which the default node/ts-jest
// config deliberately excludes via its `\.render\.test\.tsx$` catch-all.
//
// `react-test-renderer@19.1.0` is already a real devDependency — no overlay,
// no new dependency, no lockfile touched. Nothing here imports
// `@testing-library/react-native` (absent from package.json; importing it
// would add a TS2307 to the issue-1403 typecheck-delta gate).
//
// WHY A MOUNT AND NOT A SOURCE ASSERTION. #2326's whole defect is a RUNTIME
// property — whether the navigation happens while the user gesture is still
// live. A source grep for "no await in open()" is exactly the decorative shape
// that let the ORCH-1381 double-navigation bug ship green. These suites call
// the real `onPress` and assert the navigation has ALREADY happened when it
// returns.
//
// Run:
//   cd mingla-business && npx jest --config jest.issue2323.render.cjs --runInBand

const path = require("path");

const businessRoot = __dirname;

module.exports = {
  rootDir: businessRoot,
  preset: "react-native",
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.issue2323.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/issue2326CtaGesture.render.test.tsx",
    "**/__tests__/issue2323FreeOrderArm.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-svg|lucide-react-native|react-native-keyboard-controller)",
  ],
  moduleNameMapper: {
    "^react-native-safe-area-context$": path.join(
      businessRoot,
      "jest.issue1532.safearea-stub.cjs",
    ),
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
  },
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
