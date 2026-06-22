// ORCH-1197 — no-op stub for react-native-keyboard-controller. The library has
// no web entry; the SheetWeb keyboard wrappers (KeyboardRoot/KeyboardToolbarRoot
// web .tsx variants) are passthroughs that never import it. This stub only guards
// against any transitive native resolution during the web bundle.
const React = require("react");
const Passthrough = ({ children }) => children ?? null;
module.exports = {
  KeyboardProvider: Passthrough,
  KeyboardToolbar: () => null,
  KeyboardStickyView: Passthrough,
  KeyboardAwareScrollView: Passthrough,
  useKeyboardHandler: () => undefined,
  default: {},
};
void React;
