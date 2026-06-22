// ORCH-1211 [business notifications inbox crashes on mobile web] — reanimated
// WEB-condition stub for the notif web-render proof.
//
// WHY THIS STUB (faithful reproduction of the proven web bug): forensics proved
// that on the deployed business WEB target, `react-native-reanimated`'s
// `LinearTransition` (every layout-animation builder) is `undefined` at
// module-eval. The OLD code called `LinearTransition.duration(...)` at module top
// level, which threw "Cannot read properties of undefined (reading 'duration')"
// the instant `/notifications` imported the screen — crashing the whole route
// into the global ErrorBoundary ("Something broke.").
//
// Jest's node resolver mis-resolves reanimated to a build where LinearTransition
// IS defined (the §7 caveat in the spec), so a plain rnw render would NOT
// reproduce the crash and would give a FALSE fails-on-revert. This stub pins the
// exact web condition: `LinearTransition` (+ siblings) is `undefined`, while every
// other reanimated API the screen uses is a working no-op. Therefore:
//   - FIXED file (`EXPAND_TRANSITION = isWeb ? undefined : LinearTransition…`):
//     the guard short-circuits on web (Platform.OS==="web" under rnw) → the
//     undefined builder is never touched → the module imports + renders.
//   - REVERTED file (`EXPAND_TRANSITION = LinearTransition.duration(...)`):
//     reading `.duration` on `undefined` THROWS at import → the test FAILS.
// This makes the jest render a TRUE fails-on-revert proof of the actual web crash.

const React = require("react");
const { View } = require("react-native-web");

// Builder constants that are `undefined` on web at module-eval (the crash vector).
const LinearTransition = undefined;
const FadeIn = undefined;
const FadeOut = undefined;

// Default export: `Reanimated.View` etc. — render plain react-native-web views.
const Reanimated = {
  View: (props) => React.createElement(View, props),
  Text: (props) => React.createElement(View, props),
  ScrollView: (props) => React.createElement(View, props),
  createAnimatedComponent: (Comp) => Comp,
};

// Working no-ops for the runtime hooks/helpers the screen calls.
const makeSharedValue = (initial) => ({ value: initial });

module.exports = {
  __esModule: true,
  default: Reanimated,
  LinearTransition,
  FadeIn,
  FadeOut,
  Easing: {
    bezier: () => () => 0,
    linear: () => 0,
    out: (fn) => fn,
    inOut: (fn) => fn,
    ease: () => 0,
  },
  runOnJS: (fn) => fn,
  useAnimatedReaction: () => undefined,
  useAnimatedStyle: (fn) => {
    try {
      return typeof fn === "function" ? fn() : {};
    } catch {
      return {};
    }
  },
  useReducedMotion: () => false,
  useSharedValue: (initial) => makeSharedValue(initial),
  withTiming: (toValue) => toValue,
  withSpring: (toValue) => toValue,
};
