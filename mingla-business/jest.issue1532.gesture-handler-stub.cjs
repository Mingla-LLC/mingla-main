/**
 * Issue #1532 [stay-manager-ux] — `react-native-gesture-handler` jest stub.
 *
 * WHY: #1532 puts the Stay offering editor inside the canonical `Sheet`, whose
 * drag-to-dismiss band mounts a real `<GestureDetector>`. Under jest that
 * (a) asks `TurboModuleRegistry` for a native binary that does not exist, and
 * (b) calls `Reanimated.useEvent`, which reanimated 4 removed and the suites'
 * inline reanimated mocks do not provide.
 *
 * Neither is anything a Stay layout suite is trying to assert, so both are
 * stubbed at the BOUNDARY — in the config, not inside any test file, so no
 * existing suite had to be edited. A suite that genuinely cares about gestures
 * can still `jest.mock` the module itself; an inline mock wins over a mapper.
 *
 * Byte-for-byte the same stub shape already shipped inline in
 * `suiteDesktopShell.issue1484.boundary.adversarial.render.test.tsx:138-167`.
 */

const RN = require("react-native");

const chain = () => {
  const api = {};
  for (const key of [
    "onBegin",
    "onStart",
    "onUpdate",
    "onEnd",
    "onFinalize",
    "onTouchesDown",
    "onTouchesUp",
    "activeOffsetY",
    "activeOffsetX",
    "failOffsetY",
    "failOffsetX",
    "enabled",
    "shouldCancelWhenOutside",
    "simultaneousWithExternalGesture",
    "blocksExternalGesture",
    "withTestId",
    "runOnJS",
  ]) {
    api[key] = () => api;
  }
  return api;
};

module.exports = {
  __esModule: true,
  Gesture: {
    Pan: chain,
    Tap: chain,
    Native: chain,
    Simultaneous: chain,
    Exclusive: chain,
    Race: chain,
  },
  GestureDetector: ({ children }) => children,
  GestureHandlerRootView: RN.View,
  ScrollView: RN.ScrollView,
  Pressable: RN.Pressable,
  State: {},
  Directions: {},
};
