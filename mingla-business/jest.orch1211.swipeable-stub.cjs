// ORCH-1211 — ReanimatedSwipeable web stub for the notif web-render proof.
//
// `react-native-gesture-handler/ReanimatedSwipeable` is the NATIVE-ONLY swipe
// panel. On web the screen branches off it via `if (isWeb) return <Reanimated.View>`
// BEFORE the <ReanimatedSwipeable> JSX, so it never actually renders on web — but
// the top-level `import ReanimatedSwipeable from ".../ReanimatedSwipeable"` still
// executes at module load. This passthrough stub lets that import resolve under
// the web render without pulling in native gesture-handler internals.
const React = require("react");
const { View } = require("react-native-web");

const ReanimatedSwipeable = React.forwardRef((props, _ref) =>
  React.createElement(View, props, props.children),
);
ReanimatedSwipeable.displayName = "ReanimatedSwipeableStub";

module.exports = ReanimatedSwipeable;
module.exports.default = ReanimatedSwipeable;
