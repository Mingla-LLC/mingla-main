// issue #1561 — `lottie-react-native` boundary stub for the WEB render-proof.
//
// `ThemeEntranceAnimation` (a sibling of the hero inside `ParallaxCoverShell`)
// imports Lottie, whose native component registry is unavailable under jest.
// The entrance animation is decoration layered OVER the hero; it neither sets
// nor reads the hero's aspect ratio. Stubbing it keeps the shell mountable
// without touching anything this suite asserts.
const React = require("react");
const LottieView = (props) =>
  React.createElement("LottieViewStub", null, props && props.children);
module.exports = { __esModule: true, default: LottieView, LottieView };
