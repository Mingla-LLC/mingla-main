/**
 * Issue #1532 [stay-manager-ux] — `react-native-safe-area-context` jest stub.
 *
 * WHY: #1532 puts the Stay offering editor inside the canonical `Sheet`, and
 * `SheetMobile` reads `useSafeAreaInsets()` to pad the panel past the home
 * indicator. Outside a `SafeAreaProvider` that hook THROWS ("No safe area value
 * available"), so every Stay render suite that mounts the manager would fail on
 * a dependency it does not care about.
 *
 * Mapped in the render configs rather than `jest.mock`ed in each test file, so
 * no existing test file has to be edited to keep passing.
 *
 * Insets are ZERO on purpose: a suite asserting layout must not have a
 * device-shaped constant silently added to its measurements. Any test that
 * cares about real insets should mock this module itself.
 */

const React = require("react");
const { View } = require("react-native");

const INSETS = { top: 0, bottom: 0, left: 0, right: 0 };
const FRAME = { x: 0, y: 0, width: 390, height: 844 };

const Passthrough = (props) => React.createElement(View, props);

module.exports = {
  __esModule: true,
  useSafeAreaInsets: () => INSETS,
  useSafeAreaFrame: () => FRAME,
  SafeAreaProvider: Passthrough,
  SafeAreaView: Passthrough,
  SafeAreaInsetsContext: React.createContext(INSETS),
  SafeAreaFrameContext: React.createContext(FRAME),
  initialWindowMetrics: { insets: INSETS, frame: FRAME },
};
