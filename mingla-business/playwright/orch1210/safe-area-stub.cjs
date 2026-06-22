// ORCH-1197 — minimal web stub for react-native-safe-area-context used by the
// SheetWeb SSR render. SheetWeb only reads useSafeAreaInsets().bottom. We return
// a 34px bottom inset to mirror an iPhone with a home indicator + Safari toolbar
// region, so the rendered panel's safe-area padding is exercised.
const React = require("react");

const INSETS = { top: 47, right: 0, bottom: 34, left: 0 };
const FRAME = { x: 0, y: 0, width: 390, height: 844 };

function useSafeAreaInsets() {
  return INSETS;
}
function useSafeAreaFrame() {
  return FRAME;
}
const SafeAreaProvider = ({ children }) => React.createElement(React.Fragment, null, children);
const SafeAreaView = ({ children }) => React.createElement(React.Fragment, null, children);
const SafeAreaInsetsContext = React.createContext(INSETS);

module.exports = {
  useSafeAreaInsets,
  useSafeAreaFrame,
  SafeAreaProvider,
  SafeAreaView,
  SafeAreaInsetsContext,
  initialWindowMetrics: { insets: INSETS, frame: FRAME },
};
