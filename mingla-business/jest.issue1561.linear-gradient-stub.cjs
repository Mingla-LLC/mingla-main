// issue #1561 — `expo-linear-gradient` boundary stub for the WEB render-proof.
//
// `EventCover`'s bottom vignette is a LinearGradient, whose native module is not
// available under jest. The claims this suite makes are about the hero's
// aspect-ratio box, the answer bar's flex direction and the placeholder's text;
// none of them is about the vignette. Rendering a plain host element in its
// place keeps the tree shape intact without pretending to gradient anything.
const React = require("react");

const LinearGradient = (props) =>
  React.createElement("ExpoLinearGradientStub", null, props.children);

module.exports = { __esModule: true, LinearGradient, default: LinearGradient };
