// ORCH-1147R2 render-proof — expo-blur stub (worktree-local, uncommitted).
// BlurView depends on expo-modules-core's native EventEmitter, which is absent
// under jest. The blur is purely decorative chrome and has zero bearing on the
// price/Fees-&-tax TEXT under assertion, so render children through a plain View.
const React = require("react");
const { View } = require("react-native");

const BlurView = ({ children, style }) =>
  React.createElement(View, { style }, children);

module.exports = { BlurView, default: BlurView };
