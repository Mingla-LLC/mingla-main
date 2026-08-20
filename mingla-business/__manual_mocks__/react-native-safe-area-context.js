const React = require("react");
const { View } = require("react-native");

const ZERO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const ZERO_FRAME = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

function SafeAreaProvider({ children }) {
  return children;
}

function SafeAreaView({ children, ...props }) {
  return React.createElement(View, props, children);
}

module.exports = {
  SafeAreaProvider,
  SafeAreaView,
  SafeAreaInsetsContext: React.createContext(ZERO_INSETS),
  SafeAreaFrameContext: React.createContext(ZERO_FRAME),
  initialWindowMetrics: { frame: ZERO_FRAME, insets: ZERO_INSETS },
  useSafeAreaInsets: () => ZERO_INSETS,
  useSafeAreaFrame: () => ZERO_FRAME,
};
